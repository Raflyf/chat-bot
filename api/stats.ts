import type { VercelRequest, VercelResponse } from '@vercel/node';
import { config } from '../src/env.js';
import { db } from '../src/db.js';
import { extractSessionToken, verifySessionToken } from '../src/admin_auth.js';

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

  // Verifikasi Session Token Admin
  const token = extractSessionToken(req) || (typeof req.query.token === 'string' ? req.query.token : null);
  const isAuthed = token ? await verifySessionToken(token) : false;
  if (!isAuthed) {
    res.status(401).json({
      ok: false,
      error: 'Unauthorized. Akses dashboard memerlukan Master PIN admin yang valid.',
      authRequired: true,
    });
    return;
  }

  const c = db();
  if (!c) {
    res.status(503).json({ error: 'Database client unavailable' });
    return;
  }

  const range = String(req.query.range || 'today').toLowerCase();
  const filterPlatform = typeof req.query.platform === 'string' ? req.query.platform.toLowerCase().trim() : '';

  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);

  let startDateIso: string | null = null;
  let startDayStr: string | null = null;
  let rangeLabel = 'Hari Ini';
  let daysCount = 1;

  if (range === '7d') {
    const d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    startDateIso = d.toISOString();
    startDayStr = d.toISOString().slice(0, 10);
    rangeLabel = '7 Hari Terakhir';
    daysCount = 7;
  } else if (range === '14d') {
    const d = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    startDateIso = d.toISOString();
    startDayStr = d.toISOString().slice(0, 10);
    rangeLabel = '14 Hari Terakhir';
    daysCount = 14;
  } else if (range === '30d') {
    const d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    startDateIso = d.toISOString();
    startDayStr = d.toISOString().slice(0, 10);
    rangeLabel = '30 Hari Terakhir';
    daysCount = 30;
  } else if (range === 'all') {
    startDateIso = null;
    startDayStr = null;
    rangeLabel = 'Semua Waktu';
    daysCount = 0;
  } else {
    // default: today
    startDateIso = `${todayStr}T00:00:00.000Z`;
    startDayStr = todayStr;
    rangeLabel = 'Hari Ini';
    daysCount = 1;
  }

  try {
    // 1. Ambil data kuota dari provider_quota sesuai rentang waktu
    let quotaQuery = c.from('provider_quota').select('*');
    if (startDayStr) {
      if (range === 'today') {
        quotaQuery = quotaQuery.eq('day', startDayStr);
      } else {
        quotaQuery = quotaQuery.gte('day', startDayStr);
      }
    }
    const { data: quotasData } = await quotaQuery;

    const quotaMap = new Map<string, number>();
    for (const q of quotasData ?? []) {
      const key = `${q.kind}:${q.key_suffix}`;
      quotaMap.set(key, (quotaMap.get(key) || 0) + (q.used || 0));
    }

    // 2. Hitung jumlah total pesan all-time & pesan dalam rentang waktu
    let msgPeriodQuery = c.from('messages').select('*', { count: 'exact', head: true });
    let waPeriodQuery = c.from('messages').select('*', { count: 'exact', head: true }).eq('platform', 'whatsapp');
    let telePeriodQuery = c.from('messages').select('*', { count: 'exact', head: true }).eq('platform', 'telegram');

    if (startDateIso) {
      msgPeriodQuery = msgPeriodQuery.gte('created_at', startDateIso);
      waPeriodQuery = waPeriodQuery.gte('created_at', startDateIso);
      telePeriodQuery = telePeriodQuery.gte('created_at', startDateIso);
    }

    if (filterPlatform && filterPlatform !== 'all') {
      msgPeriodQuery = msgPeriodQuery.eq('platform', filterPlatform);
    }

    const [
      { count: totalMessagesAllTime },
      { count: totalMessagesPeriod },
      { count: waPeriod },
      { count: telePeriod },
    ] = await Promise.all([
      c.from('messages').select('*', { count: 'exact', head: true }),
      msgPeriodQuery,
      waPeriodQuery,
      telePeriodQuery,
    ]);

    // 3. Ambil distribusi model 'via' dalam rentang waktu
    let assistantQuery = c.from('messages').select('via').eq('role', 'assistant');
    if (startDateIso) {
      assistantQuery = assistantQuery.gte('created_at', startDateIso);
    }
    if (filterPlatform && filterPlatform !== 'all') {
      assistantQuery = assistantQuery.eq('platform', filterPlatform);
    }
    const { data: assistantMsgs } = await assistantQuery;

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
    let totalCallsPeriod = 0;

    const pools = providerDefs.map((p) => {
      totalPoolKeys += p.keys.length;
      let poolUsed = 0;

      const effectiveCapPerKey = daysCount > 0 ? p.cap * daysCount : 0;

      const keysDetail = p.keys.map((k) => {
        const suffix = k.slice(-4);
        const used = quotaMap.get(`${p.kind}:${suffix}`) || 0;
        poolUsed += used;
        totalCallsPeriod += used;

        const percent = effectiveCapPerKey > 0 ? Math.min(100, Math.round((used / effectiveCapPerKey) * 100)) : 0;
        const status = effectiveCapPerKey > 0 && used >= effectiveCapPerKey ? 'capped' : percent >= 80 ? 'warning' : 'healthy';

        return {
          suffix,
          used,
          cap: effectiveCapPerKey,
          remaining: effectiveCapPerKey > 0 ? Math.max(0, effectiveCapPerKey - used) : null,
          percent,
          status,
        };
      });

      const totalPoolCap = effectiveCapPerKey * p.keys.length;
      const poolPercent = totalPoolCap > 0 ? Math.min(100, Math.round((poolUsed / totalPoolCap) * 100)) : 0;

      return {
        kind: p.kind,
        displayName: p.displayName,
        primaryModel: p.primaryModel,
        backupModel: p.backupModel,
        keyCount: p.keys.length,
        capPerKey: effectiveCapPerKey,
        totalCap: totalPoolCap,
        usedToday: poolUsed,
        usedPeriod: poolUsed,
        percent: poolPercent,
        keys: keysDetail,
      };
    });

    // 5. Hitung jenis media dari pesan user dalam rentang waktu
    let userMsgsQuery = c.from('messages').select('content').eq('role', 'user');
    if (startDateIso) {
      userMsgsQuery = userMsgsQuery.gte('created_at', startDateIso);
    }
    if (filterPlatform && filterPlatform !== 'all') {
      userMsgsQuery = userMsgsQuery.eq('platform', filterPlatform);
    }
    const { data: userMsgs } = await userMsgsQuery;

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

    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.status(200).json({
      ok: true,
      botName: config.botName,
      serverTime: now.toISOString(),
      range,
      rangeLabel,
      platform: filterPlatform || 'all',
      today: todayStr,
      summary: {
        range,
        rangeLabel,
        daysCount,
        totalMessagesAllTime: totalMessagesAllTime ?? 0,
        totalMessagesPeriod: totalMessagesPeriod ?? 0,
        totalMessagesToday: totalMessagesPeriod ?? 0,
        whatsappPeriod: waPeriod ?? 0,
        whatsappToday: waPeriod ?? 0,
        telegramPeriod: telePeriod ?? 0,
        telegramToday: telePeriod ?? 0,
        totalKeys: totalPoolKeys,
        totalCallsPeriod,
        totalCallsToday: totalCallsPeriod,
        modelsActiveCount: modelsBreakdown.length,
      },
      pools,
      modelsBreakdown,
      mediaCounts,
    });
  } catch (err) {
    console.error('[api/stats] Gagal mengumpulkan metrik:', err);
    res.status(500).json({ ok: false, error: 'Internal Server Error' });
  }
}
