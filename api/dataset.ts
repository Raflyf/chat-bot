import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db } from '../src/db.js';
import { config } from '../src/env.js';
import { extractSessionToken, verifySessionToken } from '../src/admin_auth.js';

function maskChatId(chatId: string): string {
  if (!chatId) return '-';
  if (chatId.length <= 6) return chatId;
  return `${chatId.slice(0, 3)}...${chatId.slice(-4)}`;
}

export interface DatasetPair {
  id: number;
  platform: string;
  chatIdMasked: string;
  userPrompt: string;
  botReply: string;
  via: string;
  createdAt: string;
  promptTokens: number;
  completionTokens: number;
  contextTokens: number;
  totalTokens: number;
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  // Verifikasi Session Token Admin
  const token = extractSessionToken(req) || (typeof req.query.token === 'string' ? req.query.token : null);
  const isAuthed = token ? await verifySessionToken(token) : false;
  if (!isAuthed) {
    res.status(401).json({
      error: 'Unauthorized. Akses dataset percakapan memerlukan Master PIN admin yang valid.',
      authRequired: true,
    });
    return;
  }

  const c = db();
  if (!c) {
    res.status(503).json({ error: 'Database unavailable' });
    return;
  }

  const format = String(req.query.format || 'json').toLowerCase();
  const search = typeof req.query.q === 'string' ? req.query.q.toLowerCase().trim() : '';
  const platform = typeof req.query.platform === 'string' ? req.query.platform.toLowerCase().trim() : '';
  const range = typeof req.query.range === 'string' ? req.query.range.toLowerCase().trim() : 'all';
  const modelFilter = typeof req.query.model === 'string' ? req.query.model.toLowerCase().trim() : '';
  const limit = Math.min(1000, Math.max(10, Number(req.query.limit) || 200));

  const now = new Date();
  let startDateIso: string | null = null;
  if (range === 'today') {
    const todayStr = now.toISOString().slice(0, 10);
    startDateIso = `${todayStr}T00:00:00.000Z`;
  } else if (range === '7d') {
    startDateIso = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  } else if (range === '14d') {
    startDateIso = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();
  } else if (range === '30d') {
    startDateIso = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  }

  try {
    // Optimasi performa: tarik hanya kolom penting secara descending dari pesan terbaru
    const isExport = format === 'jsonl' || format === 'csv';
    const dbLimit = isExport ? 1500 : Math.min(600, limit * 2 + 60);

    let query = c
      .from('messages')
      .select('id, platform, chat_id, role, content, via, created_at')
      .order('id', { ascending: false })
      .limit(dbLimit);

    if (startDateIso) {
      query = query.gte('created_at', startDateIso);
    }
    if (platform && platform !== 'all') {
      query = query.eq('platform', platform);
    }

    const { data: rawMsgs, error } = await query;
    if (error) throw error;

    // Balik urutan ke kronologis (ascending) agar algoritma pairing user -> bot bekerja sempurna
    const msgs = (rawMsgs || []).reverse();
    const pairs: DatasetPair[] = [];

    for (let i = 0; i < msgs.length; i++) {
      if (msgs[i].role === 'user') {
        const userMsg = msgs[i];
        let botMsg = null;

        // Cari jawaban bot terdekat berikutnya pada chat_id yang sama
        if (i + 1 < msgs.length && msgs[i + 1].chat_id === userMsg.chat_id && msgs[i + 1].role === 'assistant') {
          botMsg = msgs[i + 1];
          i++; // Lewati pesan balasan agar tidak dipasangkan ganda
        }

        const prompt = userMsg.content || '';
        const reply = botMsg ? (botMsg.content || '') : '';
        const via = botMsg?.via || '-';
        const pForm = userMsg.platform || 'whatsapp';

        // Terapkan filter model/via
        if (modelFilter && modelFilter !== 'all' && !via.toLowerCase().includes(modelFilter)) {
          continue;
        }

        // Terapkan filter pencarian
        if (platform && platform !== 'all' && pForm !== platform) continue;
        if (search) {
          const matchUser = prompt.toLowerCase().includes(search);
          const matchBot = reply.toLowerCase().includes(search);
          const matchVia = via.toLowerCase().includes(search);
          if (!matchUser && !matchBot && !matchVia) continue;
        }

        // Estimasi token per chat: Base system context (~650 tk) + prompt user + output bot
        const promptTokens = Math.max(1, Math.ceil(prompt.length / 3.8));
        const completionTokens = reply ? Math.max(1, Math.ceil(reply.length / 3.8)) : 0;
        const contextTokens = 650 + promptTokens;
        const totalTokens = contextTokens + completionTokens;

        pairs.push({
          id: userMsg.id,
          platform: pForm,
          chatIdMasked: maskChatId(userMsg.chat_id),
          userPrompt: prompt,
          botReply: reply,
          via,
          createdAt: botMsg?.created_at || userMsg.created_at,
          promptTokens,
          completionTokens,
          contextTokens,
          totalTokens,
        });
      }
    }

    // Urutkan dari yang terbaru untuk tampilan evaluasi
    pairs.reverse();
    const finalPairs = pairs.slice(0, limit);

    // Format 1: JSONL (Standar Fine-Tuning Model AI / OpenAI / HuggingFace format)
    if (format === 'jsonl') {
      const systemMsg = `Nama kamu ${config.botName}. Sahabat karib sekaligus partner cerdas serbabisa.`;
      const lines = finalPairs
        .filter((p) => p.botReply && p.botReply !== '(menunggu balasan/gagal)')
        .map((p) =>
          JSON.stringify({
            messages: [
              { role: 'system', content: systemMsg },
              { role: 'user', content: p.userPrompt },
              { role: 'assistant', content: p.botReply },
            ],
            metadata: {
              id: p.id,
              platform: p.platform,
              model_via: p.via,
              timestamp: p.createdAt,
              context_tokens: p.contextTokens,
              output_tokens: p.completionTokens,
              total_tokens: p.totalTokens,
            },
          }),
        );

      res.setHeader('Content-Type', 'application/x-jsonlines; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="training_dataset_${new Date().toISOString().slice(0, 10)}.jsonl"`,
      );
      res.status(200).send(lines.join('\n'));
      return;
    }

    // Format 2: CSV (Format Evaluasi Spreadsheet / Excel)
    if (format === 'csv') {
      const escapeCsv = (str: string) => `"${(str || '').replace(/"/g, '""')}"`;
      const csvHeader = 'ID,Waktu,Platform,User_Chat,Jawaban_Bot,Model_Via,Context_Tokens,Output_Tokens,Total_Tokens\n';
      const csvRows = finalPairs
        .map((p) =>
          [
            p.id,
            escapeCsv(p.createdAt),
            escapeCsv(p.platform),
            escapeCsv(p.userPrompt),
            escapeCsv(p.botReply),
            escapeCsv(p.via),
            p.contextTokens,
            p.completionTokens,
            p.totalTokens,
          ].join(','),
        )
        .join('\n');

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="evaluasi_chatbot_${new Date().toISOString().slice(0, 10)}.csv"`,
      );
      res.status(200).send('\uFEFF' + csvHeader + csvRows); // BOM untuk Excel UTF-8
      return;
    }

    // Default: JSON API Response
    res.setHeader('Cache-Control', 'public, s-maxage=10, stale-while-revalidate=30');
    res.status(200).json({
      ok: true,
      totalCount: pairs.length,
      returnedCount: finalPairs.length,
      pairs: finalPairs,
      dataset: finalPairs,
    });
  } catch (err) {
    console.error('[api/dataset] Gagal menyusun dataset:', err);
    res.status(500).json({ ok: false, error: 'Internal Server Error' });
  }
}
