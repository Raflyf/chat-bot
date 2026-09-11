import type { VercelRequest, VercelResponse } from '@vercel/node';
import { config } from '../src/env.js';
import { db } from '../src/db.js';

function maskChatId(chatId: string): string {
  if (!chatId) return '-';
  if (chatId.length <= 6) return chatId;
  const prefix = chatId.slice(0, 3);
  const suffix = chatId.slice(-4);
  return `${prefix}...${suffix}`;
}

function detectMessageType(content: string): 'voice' | 'document' | 'image' | 'sticker' | 'video' | 'text' {
  if (content.startsWith('[Voice Note]')) return 'voice';
  if (content.startsWith('[Dokumen:')) return 'document';
  if (content.startsWith('[Gambar')) return 'image';
  if (content.startsWith('[Stiker')) return 'sticker';
  if (content.startsWith('[Video')) return 'video';
  return 'text';
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  // Hanya menerima GET
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  const c = db();
  if (!c) {
    res.status(503).json({ error: 'Database client unavailable' });
    return;
  }

  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const startOfDay = `${today}T00:00:00.000Z`;

  try {
    // 1. Ambil data kuota hari ini dari provider_quota
    const { data: quotasToday } = await c
      .from('provider_quota')
      .select('*')
      .eq('day', today);

    const quotaMap = new Map<string, number>();
    for (const q of quotasToday ?? []) {
      quotaMap.set(`${q.kind}:${q.key_suffix}`, q.used || 0);
    }

    // 2. Hitung jumlah total pesan & pesan hari ini
    const [
      { count: totalMessagesAllTime },
      { count: totalMessagesToday },
      { count: waToday },
      { count: teleToday },
    ] = await Promise.all([
      c.from('messages').select('*', { count: 'exact', head: true }),
      c.from('messages').select('*', { count: 'exact', head: true }).gte('created_at', startOfDay),
      c.from('messages').select('*', { count: 'exact', head: true }).eq('platform', 'whatsapp').gte('created_at', startOfDay),
      c.from('messages').select('*', { count: 'exact', head: true }).eq('platform', 'telegram').gte('created_at', startOfDay),
    ]);

    // 3. Ambil distribusi model 'via' hari ini
    const { data: assistantMsgs } = await c
      .from('messages')
      .select('via')
      .eq('role', 'assistant')
      .gte('created_at', startOfDay);

    const modelCounts: Record<string, number> = {};
    let totalModelCalls = 0;
    for (const m of assistantMsgs ?? []) {
      const model = m.via || 'unknown';
      modelCounts[model] = (modelCounts[model] || 0) + 1;
      totalModelCalls++;
    }

    const modelsBreakdown = Object.entries(modelCounts)
      .map(([name, count]) => ({
        name,
        count,
        percent: totalModelCalls > 0 ? Math.round((count / totalModelCalls) * 100) : 0,
      }))
      .sort((a, b) => b.count - a.count);

    // 4. Bangun status Pool per Provider & tiap API Key
    const providerDefs: Array<{
      kind: 'groq' | 'gemini' | 'openrouter' | 'ollama';
      displayName: string;
      keys: string[];
      cap: number;
      primaryModel: string;
      backupModel: string;
    }> = [
      {
        kind: 'groq',
        displayName: 'Groq Cloud API',
        keys: config.pools.groq,
        cap: config.dailyCap.groq,
        primaryModel: config.models.groqPrimary,
        backupModel: config.models.groqBackup,
      },
      {
        kind: 'gemini',
        displayName: 'Google Gemini API',
        keys: config.pools.gemini,
        cap: config.dailyCap.gemini,
        primaryModel: config.models.geminiPrimary,
        backupModel: config.models.geminiBackup,
      },
      {
        kind: 'openrouter',
        displayName: 'OpenRouter AI Pool',
        keys: config.pools.openrouter,
        cap: config.dailyCap.openrouter,
        primaryModel: config.models.orPrimary,
        backupModel: config.models.orMini,
      },
      {
        kind: 'ollama',
        displayName: 'Ollama Cloud',
        keys: config.pools.ollama,
        cap: config.dailyCap.ollama,
        primaryModel: config.models.ollamaPrimary,
        backupModel: config.models.ollamaBackup,
      },
    ];

    let totalPoolKeys = 0;
    let totalCallsToday = 0;

    const pools = providerDefs.map((p) => {
      totalPoolKeys += p.keys.length;
      let poolUsed = 0;

      const keysDetail = p.keys.map((k) => {
        const suffix = k.slice(-4);
        const used = quotaMap.get(`${p.kind}:${suffix}`) || 0;
        poolUsed += used;
        totalCallsToday += used;

        const percent = p.cap > 0 ? Math.min(100, Math.round((used / p.cap) * 100)) : 0;
        const status = used >= p.cap ? 'capped' : percent >= 80 ? 'warning' : 'healthy';

        return {
          suffix,
          used,
          cap: p.cap,
          remaining: Math.max(0, p.cap - used),
          percent,
          status,
        };
      });

      const totalPoolCap = p.keys.length * p.cap;
      const poolPercent = totalPoolCap > 0 ? Math.min(100, Math.round((poolUsed / totalPoolCap) * 100)) : 0;

      return {
        kind: p.kind,
        displayName: p.displayName,
        primaryModel: p.primaryModel,
        backupModel: p.backupModel,
        keyCount: p.keys.length,
        capPerKey: p.cap,
        totalCap: totalPoolCap,
        usedToday: poolUsed,
        percent: poolPercent,
        keys: keysDetail,
      };
    });

    // 5. Hitung jenis media dari pesan user hari ini
    const { data: userMsgs } = await c
      .from('messages')
      .select('content')
      .eq('role', 'user')
      .gte('created_at', startOfDay);

    const mediaCounts = {
      voice: 0,
      document: 0,
      image: 0,
      sticker: 0,
      video: 0,
      text: 0,
    };

    for (const msg of userMsgs ?? []) {
      const type = detectMessageType(msg.content || '');
      mediaCounts[type]++;
    }

    // 6. Ambil 25 aktivitas interaksi percakapan terbaru
    const { data: recentMsgs } = await c
      .from('messages')
      .select('id, platform, chat_id, role, content, via, created_at')
      .order('id', { ascending: false })
      .limit(25);

    const recentFormatted = (recentMsgs ?? []).map((m) => {
      const type = detectMessageType(m.content || '');
      // Potong konten untuk preview aman
      let preview = m.content || '';
      if (preview.length > 280) {
        preview = preview.slice(0, 280) + '...';
      }

      return {
        id: m.id,
        platform: m.platform,
        chatIdMasked: maskChatId(m.chat_id),
        role: m.role,
        type,
        preview,
        via: m.via,
        createdAt: m.created_at,
      };
    });

    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.status(200).json({
      ok: true,
      botName: config.botName,
      serverTime: now.toISOString(),
      today,
      summary: {
        totalMessagesAllTime: totalMessagesAllTime ?? 0,
        totalMessagesToday: totalMessagesToday ?? 0,
        whatsappToday: waToday ?? 0,
        telegramToday: teleToday ?? 0,
        totalKeys: totalPoolKeys,
        totalCallsToday,
        modelsActiveCount: modelsBreakdown.length,
      },
      pools,
      modelsBreakdown,
      mediaCounts,
      recentActivity: recentFormatted,
    });
  } catch (err) {
    console.error('[api/stats] Gagal mengumpulkan metrik:', err);
    res.status(500).json({ ok: false, error: 'Internal Server Error' });
  }
}
