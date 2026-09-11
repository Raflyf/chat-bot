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
  const limit = Math.min(1000, Math.max(10, Number(req.query.limit) || 200));

  try {
    // Ambil riwayat pesan terurut dari awal percakapan
    const { data: allMsgs, error } = await c
      .from('messages')
      .select('*')
      .order('id', { ascending: true })
      .limit(3000);

    if (error) throw error;

    // Pasangkan pesan pengguna dengan balasan bot berikutnya di chat yang sama
    const pairs: DatasetPair[] = [];
    const msgs = allMsgs || [];

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

        // Terapkan filter pencarian
        if (platform && pForm !== platform) continue;
        if (search) {
          const matchUser = prompt.toLowerCase().includes(search);
          const matchBot = reply.toLowerCase().includes(search);
          const matchVia = via.toLowerCase().includes(search);
          if (!matchUser && !matchBot && !matchVia) continue;
        }

        pairs.push({
          id: userMsg.id,
          platform: pForm,
          chatIdMasked: maskChatId(userMsg.chat_id),
          userPrompt: prompt,
          botReply: reply,
          via,
          createdAt: botMsg?.created_at || userMsg.created_at,
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
      const csvHeader = 'ID,Waktu,Platform,User_Chat,Jawaban_Bot,Model_Via\n';
      const csvRows = finalPairs
        .map((p) =>
          [
            p.id,
            escapeCsv(p.createdAt),
            escapeCsv(p.platform),
            escapeCsv(p.userPrompt),
            escapeCsv(p.botReply),
            escapeCsv(p.via),
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
    res.setHeader('Cache-Control', 'no-store, max-age=0');
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
