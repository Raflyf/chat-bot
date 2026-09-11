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
    // 1. Siapkan query kuota provider (hanya kolom yang diperlukan)
    let quotaQuery = c.from('provider_quota').select('kind, key_suffix, used');
    if (startDayStr) {
      if (range === 'today') {
        quotaQuery = quotaQuery.eq('day', startDayStr);
      } else {
        quotaQuery = quotaQuery.gte('day', startDayStr);
      }
    }

    // 2. Siapkan query count pesan per platform
    let waPeriodQuery = c.from('messages').select('*', { count: 'exact', head: true }).eq('platform', 'whatsapp');
    let telePeriodQuery = c.from('messages').select('*', { count: 'exact', head: true }).eq('platform', 'telegram');

    if (startDateIso) {
      waPeriodQuery = waPeriodQuery.gte('created_at', startDateIso);
      telePeriodQuery = telePeriodQuery.gte('created_at', startDateIso);
    }

    // 3. Siapkan query sampel representatif distribusi model AI (terbaru, limit 400 untuk respon instan)
    let assistantQuery = c
      .from('messages')
      .select('via')
      .eq('role', 'assistant')
      .order('id', { ascending: false })
      .limit(400);

    if (startDateIso) {
      assistantQuery = assistantQuery.gte('created_at', startDateIso);
    }
    if (filterPlatform && filterPlatform !== 'all') {
      assistantQuery = assistantQuery.eq('platform', filterPlatform);
    }

    // 4. Siapkan query sampel representatif media pesan pengguna (terbaru, limit 300 untuk respon instan)
    let userMsgsQuery = c
      .from('messages')
      .select('content')
      .eq('role', 'user')
      .order('id', { ascending: false })
      .limit(300);

    if (startDateIso) {
      userMsgsQuery = userMsgsQuery.gte('created_at', startDateIso);
    }
    if (filterPlatform && filterPlatform !== 'all') {
      userMsgsQuery = userMsgsQuery.eq('platform', filterPlatform);
    }

    // 5. Query sesi bulanan WhatsApp untuk pelacakan kuota 1.000 sesi/bulan (Meta Cloud API)
    const startOfMonthIso = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
    const waMonthlyQuery = c
      .from('messages')
      .select('chat_id, created_at')
      .eq('platform', 'whatsapp')
      .gte('created_at', startOfMonthIso)
      .order('created_at', { ascending: true })
      .limit(2000);

    // Fetch live usage dari remote provider API (xKiro & OpenRouter) secara paralel
    const xkiroLivePromises = config.pools.xkiro.map(async (k) => {
      try {
        const res = await fetch('https://api.xkiro.com/v1/usage', {
          headers: { Authorization: `Bearer ${k}`, Accept: 'application/json' },
          signal: AbortSignal.timeout(2800),
        });
        if (!res.ok) return null;
        const data = (await res.json()) as {
          user?: { name?: string; email?: string };
          free_tokens?: { used_today?: number; limit_per_day?: number; remaining?: number };
        };
        return {
          key: k,
          userName: data.user?.name || null,
          userEmail: data.user?.email || null,
          usedToday: Number(data.free_tokens?.used_today) || 0,
          limitPerDay: Number(data.free_tokens?.limit_per_day) || 5000000,
          remaining: Number(data.free_tokens?.remaining) || 0,
        };
      } catch {
        return null;
      }
    });

    const orLivePromises = config.pools.openrouter.map(async (k) => {
      try {
        const res = await fetch('https://openrouter.ai/api/v1/auth/key', {
          headers: { Authorization: `Bearer ${k}`, Accept: 'application/json' },
          signal: AbortSignal.timeout(2800),
        });
        if (!res.ok) return null;
        const json = (await res.json()) as {
          data?: {
            usage?: number;
            usage_daily?: number;
            is_free_tier?: boolean;
            limit_remaining?: number | null;
          };
        };
        return {
          key: k,
          usageUsd: Number(json.data?.usage) || 0,
          usageDailyUsd: Number(json.data?.usage_daily) || 0,
          isFreeTier: json.data?.is_free_tier ?? true,
          limitRemaining: json.data?.limit_remaining ?? null,
        };
      } catch {
        return null;
      }
    });

    // 6. Eksekusi SEMUA query database & live provider fetch secara PARALEL (1 kali roundtrip)
    const [
      { data: quotasData },
      { count: totalMessagesAllTime },
      { count: waPeriod },
      { count: telePeriod },
      { data: assistantMsgs },
      { data: userMsgs },
      { data: waMonthlyMsgs },
      xkiroLiveResults,
      orLiveResults,
    ] = await Promise.all([
      quotaQuery,
      c.from('messages').select('*', { count: 'exact', head: true }),
      waPeriodQuery,
      telePeriodQuery,
      assistantQuery,
      userMsgsQuery,
      waMonthlyQuery,
      Promise.all(xkiroLivePromises),
      Promise.all(orLivePromises),
    ]);

    const xkiroSyncMap = new Map<string, {
      key: string;
      userName: string | null;
      userEmail: string | null;
      usedToday: number;
      limitPerDay: number;
      remaining: number;
    }>();
    for (const r of xkiroLiveResults) {
      if (r) xkiroSyncMap.set(r.key, r);
    }

    const orSyncMap = new Map<string, {
      key: string;
      usageUsd: number;
      usageDailyUsd: number;
      isFreeTier: boolean;
      limitRemaining: number | null;
    }>();
    for (const r of orLiveResults) {
      if (r) orSyncMap.set(r.key, r);
    }

    const quotaMap = new Map<string, number>();
    for (const q of quotasData ?? []) {
      const key = `${q.kind}:${q.key_suffix}`;
      quotaMap.set(key, (quotaMap.get(key) || 0) + (q.used || 0));
    }

    const totalMessagesPeriod =
      filterPlatform === 'whatsapp'
        ? (waPeriod ?? 0)
        : filterPlatform === 'telegram'
        ? (telePeriod ?? 0)
        : (waPeriod ?? 0) + (telePeriod ?? 0);

    const modelCounts: Record<string, number> = {};
    let totalModelCalls = 0;
    const latestActiveModel = assistantMsgs?.[0]?.via || null;
    const recentModelOrder: string[] = [];
    const seenRecent = new Set<string>();

    for (const m of assistantMsgs ?? []) {
      const model = m.via || 'unknown';
      modelCounts[model] = (modelCounts[model] || 0) + 1;
      totalModelCalls++;
      if (m.via && !seenRecent.has(m.via)) {
        seenRecent.add(m.via);
        recentModelOrder.push(m.via);
      }
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
      kind: 'xkiro' | 'groq' | 'gemini' | 'openrouter';
      displayName: string;
      keys: string[];
      cap: number;
      tokenCapPerKey: number;
      tokenLimitType: 'daily_cap' | 'requests_tpm' | 'monthly_credits';
      tokenLimitLabel: string;
      resetCycle: string;
      contextWindow: string;
      primaryModel: string;
      backupModel: string;
    }> = [
      {
        kind: 'xkiro',
        displayName: 'xKiro Gateway (Qwen 3.8 Flagship)',
        keys: config.pools.xkiro,
        cap: config.dailyCap.xkiro,
        tokenCapPerKey: 5000000,
        tokenLimitType: 'daily_cap',
        tokenLimitLabel: '5.000.000 Token/hari (5M)',
        resetCycle: 'Harian (00:00 UTC)',
        contextWindow: '1.000.000 Token (1M)',
        primaryModel: config.models.xkiroPrimary,
        backupModel: config.models.xkiroBackup[0] || 'qwen/qwen3.6-plus:free',
      },
      {
        kind: 'groq',
        displayName: 'Groq Cloud API (LPU Speed)',
        keys: config.pools.groq,
        cap: config.dailyCap.groq,
        tokenCapPerKey: 200000,
        tokenLimitType: 'daily_cap',
        tokenLimitLabel: '200.000 Token/hari (200K TPD)',
        resetCycle: 'Harian (00:00 UTC)',
        contextWindow: '131.072 Token (131K)',
        primaryModel: config.models.groqPrimary,
        backupModel: config.models.groqBackup,
      },
      {
        kind: 'gemini',
        displayName: 'Google Gemini API (Google AI Studio)',
        keys: config.pools.gemini,
        cap: config.dailyCap.gemini,
        tokenCapPerKey: 0,
        tokenLimitType: 'requests_tpm',
        tokenLimitLabel: 'Bebas Kuota Harian (1M TPM & 1.500 RPD)',
        resetCycle: 'Harian (00:00 Pacific Time)',
        contextWindow: '1.000.000 Token (1M)',
        primaryModel: config.models.geminiPrimary,
        backupModel: config.models.geminiBackup,
      },
      {
        kind: 'openrouter',
        displayName: 'OpenRouter AI Pool',
        keys: config.pools.openrouter,
        cap: config.dailyCap.openrouter,
        tokenCapPerKey: 0,
        tokenLimitType: 'requests_tpm',
        tokenLimitLabel: 'Bebas Kuota Harian (Dibatasi 50-1.000 RPD)',
        resetCycle: 'Harian (00:00 UTC)',
        contextWindow: '131.072 Token (131K)',
        primaryModel: config.models.orPrimary,
        backupModel: config.models.orMini,
      },
    ];

    let totalPoolKeys = 0;
    let totalCallsPeriod = 0;

    const pools = providerDefs.map((p) => {
      totalPoolKeys += p.keys.length;
      let poolUsed = 0;

      const effectiveCapPerKey = daysCount > 0 ? p.cap * daysCount : 0;
      const effectiveTokenCapPerKey = daysCount > 0 ? p.tokenCapPerKey * daysCount : 0;

      const keysDetail = p.keys.map((k) => {
        const suffix = k.slice(-4);
        const used = quotaMap.get(`${p.kind}:${suffix}`) || 0;
        poolUsed += used;
        totalCallsPeriod += used;

        const xkLive = p.kind === 'xkiro' ? xkiroSyncMap.get(k) : null;
        const orLive = p.kind === 'openrouter' ? orSyncMap.get(k) : null;

        let tokensUsed = used * 380;
        let tokenCap = effectiveTokenCapPerKey;
        let remainingTokens: number | null = effectiveTokenCapPerKey > 0 ? Math.max(0, effectiveTokenCapPerKey - tokensUsed) : null;
        let tokenPercent = effectiveTokenCapPerKey > 0 ? Math.min(100, Math.round((tokensUsed / effectiveTokenCapPerKey) * 100)) : 0;

        if (xkLive) {
          // Menggunakan data sinkronisasi langsung dari web server xKiro (global di semua apps)
          tokensUsed = xkLive.usedToday;
          tokenCap = xkLive.limitPerDay;
          remainingTokens = xkLive.remaining;
          tokenPercent = tokenCap > 0 ? Math.min(100, Math.round((tokensUsed / tokenCap) * 100)) : 0;
        }

        const percent = effectiveCapPerKey > 0 ? Math.min(100, Math.round((used / effectiveCapPerKey) * 100)) : 0;
        const status = effectiveCapPerKey > 0 && used >= effectiveCapPerKey ? 'capped' : percent >= 80 ? 'warning' : 'healthy';

        return {
          suffix,
          used,
          cap: effectiveCapPerKey,
          remaining: effectiveCapPerKey > 0 ? Math.max(0, effectiveCapPerKey - used) : null,
          percent,
          tokensUsed,
          tokenCap,
          tokenPercent,
          tokenLimitType: p.tokenLimitType,
          tokenLimitLabel: p.tokenLimitLabel,
          resetCycle: p.resetCycle,
          contextWindow: p.contextWindow,
          avgTokensPerChat: 380,
          status,
          isLiveSynced: !!xkLive || !!orLive,
          liveUserName: xkLive?.userName ?? null,
          liveUserEmail: xkLive?.userEmail ?? null,
          liveRemainingTokens: remainingTokens,
          liveUsageUsd: orLive?.usageUsd ?? null,
          liveDailyUsageUsd: orLive?.usageDailyUsd ?? null,
          isFreeTier: orLive?.isFreeTier ?? true,
        };
      });

      const totalPoolCap = effectiveCapPerKey * p.keys.length;
      const totalTokenPoolCap = effectiveTokenCapPerKey * p.keys.length;
      const poolPercent = totalPoolCap > 0 ? Math.min(100, Math.round((poolUsed / totalPoolCap) * 100)) : 0;
      
      let poolTokensUsed = 0;
      for (const kd of keysDetail) {
        poolTokensUsed += kd.tokensUsed;
      }
      const poolTokenPercent = totalTokenPoolCap > 0 ? Math.min(100, Math.round((poolTokensUsed / totalTokenPoolCap) * 100)) : 0;
      const isAnyLiveSynced = keysDetail.some((kd) => kd.isLiveSynced);

      return {
        kind: p.kind,
        displayName: p.displayName,
        primaryModel: p.primaryModel,
        backupModel: p.backupModel,
        contextWindow: p.contextWindow,
        tokenLimitType: p.tokenLimitType,
        tokenLimitLabel: p.tokenLimitLabel,
        resetCycle: p.resetCycle,
        keyCount: p.keys.length,
        capPerKey: effectiveCapPerKey,
        totalCap: totalPoolCap,
        usedToday: poolUsed,
        usedPeriod: poolUsed,
        percent: poolPercent,
        tokenCapPerKey: effectiveTokenCapPerKey,
        totalTokenCap: totalTokenPoolCap,
        totalTokensUsed: poolTokensUsed,
        tokenPercent: poolTokenPercent,
        isLiveSynced: isAnyLiveSynced,
        keys: keysDetail,
      };
    });

    // 6. Hitung jenis media dari sampel pesan pengguna
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

    // 7. Hitung Sesi Layanan WhatsApp Meta Cloud API (1.000 Sesi Percakapan Gratis per Bulan)
    // 1 sesi = jendela waktu 24 jam per pengguna unik (chat bolak-balik tanpa batas selama 24 jam dihitung 1 sesi)
    const waSessionsByUser = new Map<string, number>();
    const userLastSessionEnd = new Map<string, number>();
    const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

    for (const m of waMonthlyMsgs ?? []) {
      const chatId = String(m.chat_id || 'unknown');
      const msgTime = new Date(m.created_at).getTime();
      const lastEnd = userLastSessionEnd.get(chatId) || 0;

      if (msgTime >= lastEnd) {
        userLastSessionEnd.set(chatId, msgTime + TWENTY_FOUR_HOURS_MS);
        waSessionsByUser.set(chatId, (waSessionsByUser.get(chatId) || 0) + 1);
      }
    }

    let totalWaSessionsMonth = 0;
    for (const count of waSessionsByUser.values()) {
      totalWaSessionsMonth += count;
    }
    const waMonthlyLimit = 1000;
    const waMonthlyRemaining = Math.max(0, waMonthlyLimit - totalWaSessionsMonth);
    const waMonthlyPercent = Math.min(100, Math.round((totalWaSessionsMonth / waMonthlyLimit) * 100));
    const waMonthLabel = now.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });

    res.setHeader('Cache-Control', 'public, s-maxage=10, stale-while-revalidate=30');
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
        totalTokensPeriod: totalCallsPeriod * 380,
        totalTokensToday: totalCallsPeriod * 380,
        avgTokensPerChat: 380,
        modelsActiveCount: modelsBreakdown.length,
        whatsappMonthlySessions: {
          used: totalWaSessionsMonth,
          limit: waMonthlyLimit,
          remaining: waMonthlyRemaining,
          percent: waMonthlyPercent,
          monthLabel: waMonthLabel,
          uniqueUsers: waSessionsByUser.size,
        },
      },
      pools,
      activeModel: latestActiveModel,
      recentModels: recentModelOrder,
      modelsBreakdown,
      mediaCounts,
    });
  } catch (err) {
    console.error('[api/stats] Gagal mengumpulkan metrik:', err);
    res.status(500).json({ ok: false, error: 'Internal Server Error' });
  }
}
