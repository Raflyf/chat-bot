import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';
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
  // Security headers
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');

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

  const c = db();

  try {
    // Siapkan live usage fetch dari remote provider API (xKiro & OpenRouter) secara paralel
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

    let quotasData: Array<{ kind: string; key_suffix: string; used: number }> = [];
    let totalMessagesAllTime: number = 0;
    let waPeriod: number = 0;
    let telePeriod: number = 0;
    let assistantMsgs: Array<{ via: string | null }> = [];
    let allTimeAssistantMsgs: Array<{ via: string | null }> = [];
    let userMsgs: Array<{ content: string }> = [];
    let waMonthlyMsgs: Array<{ chat_id: string; created_at: string }> = [];

    const liveFetchPromise = Promise.all([
      Promise.all(xkiroLivePromises),
      Promise.all(orLivePromises),
    ]);

    type XkiroLiveItem = {
      key: string;
      userName: string | null;
      userEmail: string | null;
      usedToday: number;
      limitPerDay: number;
      remaining: number;
    } | null;

    type OrLiveItem = {
      key: string;
      usageUsd: number;
      usageDailyUsd: number;
      isFreeTier: boolean;
      limitRemaining: number | null;
    } | null;

    let xkiroLiveResults: XkiroLiveItem[] = [];
    let orLiveResults: OrLiveItem[] = [];

    if (c) {
      let quotaQuery = c.from('provider_quota').select('kind, key_suffix, used');
      if (startDayStr) {
        if (range === 'today') {
          quotaQuery = quotaQuery.eq('day', startDayStr);
        } else {
          quotaQuery = quotaQuery.gte('day', startDayStr);
        }
      }

      let waPeriodQuery = c.from('messages').select('*', { count: 'exact', head: true }).eq('platform', 'whatsapp');
      let telePeriodQuery = c.from('messages').select('*', { count: 'exact', head: true }).eq('platform', 'telegram');

      if (startDateIso) {
        waPeriodQuery = waPeriodQuery.gte('created_at', startDateIso);
        telePeriodQuery = telePeriodQuery.gte('created_at', startDateIso);
      }

      // Helper pagination bertahap (.range()) untuk mencegah pemotongan senyap data (B9)
      async function fetchPagedRange<T>(
        buildQuery: () => any,
        batchSize: number = 1000,
        maxRecords: number = 10000,
      ): Promise<T[]> {
        const rows: T[] = [];
        let from = 0;
        while (from < maxRecords) {
          const to = from + batchSize - 1;
          const { data, error } = await buildQuery().range(from, to);
          if (error || !data || data.length === 0) break;
          rows.push(...(data as T[]));
          if (data.length < batchSize) break;
          from += batchSize;
        }
        return rows;
      }

      const buildAssistantQuery = () => {
        let q = c.from('messages').select('via').eq('role', 'assistant').order('id', { ascending: false });
        if (startDateIso) q = q.gte('created_at', startDateIso);
        if (filterPlatform && filterPlatform !== 'all') q = q.eq('platform', filterPlatform);
        return q;
      };

      const buildUserMsgsQuery = () => {
        let q = c.from('messages').select('content').eq('role', 'user').order('id', { ascending: false });
        if (startDateIso) q = q.gte('created_at', startDateIso);
        if (filterPlatform && filterPlatform !== 'all') q = q.eq('platform', filterPlatform);
        return q;
      };

      const startOfMonthIso = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
      const buildWaMonthlyQuery = () => {
        return c
          .from('messages')
          .select('chat_id, created_at')
          .eq('platform', 'whatsapp')
          .gte('created_at', startOfMonthIso)
          .order('created_at', { ascending: true });
      };

      const [
        dbQuotaRes,
        dbTotalRes,
        dbWaRes,
        dbTeleRes,
        assistantMsgsRes,
        userMsgsRes,
        waMonthlyMsgsRes,
        allTimeAssistantRes,
        liveResults,
      ] = await Promise.all([
        quotaQuery,
        c.from('messages').select('*', { count: 'exact', head: true }),
        waPeriodQuery,
        telePeriodQuery,
        fetchPagedRange<{ via: string | null }>(buildAssistantQuery, 1000, 10000),
        fetchPagedRange<{ content: string | null }>(buildUserMsgsQuery, 1000, 10000),
        fetchPagedRange<{ chat_id: string | null; created_at: string }>(buildWaMonthlyQuery, 1000, 15000),
        c.from('messages').select('via').eq('role', 'assistant').order('id', { ascending: false }).limit(300),
        liveFetchPromise,
      ]);

      quotasData = (dbQuotaRes.data as any) || [];
      totalMessagesAllTime = dbTotalRes.count || 0;
      waPeriod = dbWaRes.count || 0;
      telePeriod = dbTeleRes.count || 0;
      assistantMsgs = assistantMsgsRes as any;
      allTimeAssistantMsgs = ((allTimeAssistantRes?.data as any) || []) as Array<{ via: string | null }>;
      userMsgs = userMsgsRes as any;
      waMonthlyMsgs = waMonthlyMsgsRes as any;

      xkiroLiveResults = liveResults[0];
      orLiveResults = liveResults[1];
    } else {
      const [xk, or] = await liveFetchPromise;
      xkiroLiveResults = xk;
      orLiveResults = or;
    }

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

    for (const m of assistantMsgs ?? []) {
      const rawModel = m.via || 'unknown';
      const model = rawModel.split('#')[0].trim();
      modelCounts[model] = (modelCounts[model] || 0) + 1;
      totalModelCalls++;
    }

    // Daftar model aktif sistem untuk memfilter histori DB lama yang sudah didepresiasi
    const activeSystemModels = [
      config.models.xkiroPrimary,
      ...config.models.xkiroBackup,
      config.models.groqPrimary,
      config.models.groqBackup,
      config.models.cfPrimary,
      config.models.cfBackup,
      config.models.geminiPrimary,
      config.models.geminiBackup,
      config.models.orPrimary,
      config.models.orMini,
      config.models.orText,
      'whisper-large-v3-turbo',
      'whisper-large-v3',
    ].map((m) => m.toLowerCase());

    const isModelActive = (modelStr: string): boolean => {
      const lower = modelStr.toLowerCase();
      return activeSystemModels.some(
        (act) => lower === act || lower.endsWith('/' + act) || act.endsWith('/' + lower)
      );
    };

    // Urutan MRU (Most Recently Used) All-Time:
    // Urutan kronologis model diambil dari riwayat all-time agar tumpukan MRU tidak terputus/reset saat berganti filter tanggal
    const recentModelOrder: string[] = [];
    const seenRecent = new Set<string>();

    const candidateRecentMsgs = allTimeAssistantMsgs.length > 0 ? allTimeAssistantMsgs : (assistantMsgs ?? []);
    for (const m of candidateRecentMsgs) {
      const rawModel = m?.via || 'unknown';
      const model = rawModel.split('#')[0].trim();
      if (model && model !== 'unknown' && model !== 'cache' && !model.startsWith('system/') && isModelActive(model) && !seenRecent.has(model)) {
        seenRecent.add(model);
        recentModelOrder.push(model);
      }
    }

    // Edge case: jika ada model pada periode aktif yang belum masuk ke tumpukan candidate
    for (const m of assistantMsgs ?? []) {
      const rawModel = m?.via || 'unknown';
      const model = rawModel.split('#')[0].trim();
      if (model && model !== 'unknown' && model !== 'cache' && !model.startsWith('system/') && isModelActive(model) && !seenRecent.has(model)) {
        seenRecent.add(model);
        recentModelOrder.push(model);
      }
    }

    const latestActiveModel = recentModelOrder[0] || null;

    const modelsBreakdown = Object.entries(modelCounts)
      .map(([name, count]) => ({
        name,
        count,
        percent: totalModelCalls > 0 ? Math.round((count / totalModelCalls) * 100) : 0,
      }))
      .sort((a, b) => b.count - a.count);

    // 4. Bangun status Pool per Provider & tiap API Key
    const providerDefs: Array<{
      kind: 'xkiro' | 'groq' | 'cloudflare' | 'gemini' | 'openrouter';
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
      allModels: string[];
    }> = [
      {
        kind: 'xkiro',
        displayName: 'xKiro Gateway',
        keys: config.pools.xkiro,
        cap: config.dailyCap.xkiro,
        tokenCapPerKey: 5000000,
        tokenLimitType: 'daily_cap',
        tokenLimitLabel: '5.000.000 Token/hari (~1.500 RPD)',
        resetCycle: 'Harian (00:00 UTC)',
        contextWindow: '1.000.000 Token (1M)',
        primaryModel: config.models.xkiroPrimary,
        backupModel: config.models.xkiroBackup[0] || 'deepseek/deepseek-v4-pro',
        allModels: [config.models.xkiroPrimary, ...config.models.xkiroBackup],
      },
      {
        kind: 'groq',
        displayName: 'Groq Cloud API',
        keys: config.pools.groq,
        cap: config.dailyCap.groq,
        tokenCapPerKey: 200000,
        tokenLimitType: 'daily_cap',
        tokenLimitLabel: '200.000 Token/hari (200K TPD)',
        resetCycle: 'Harian (00:00 UTC)',
        contextWindow: '131.072 Token (131K)',
        primaryModel: config.models.groqPrimary,
        backupModel: config.models.groqBackup,
        allModels: [config.models.groqPrimary, config.models.groqBackup],
      },
      {
        kind: 'cloudflare',
        displayName: 'Cloudflare Workers AI',
        keys: config.pools.cloudflare,
        cap: config.dailyCap.cloudflare,
        tokenCapPerKey: 10000,
        tokenLimitType: 'daily_cap',
        tokenLimitLabel: '10.000 Neuron/hari (~120 RPD Free Tier)',
        resetCycle: 'Harian (00:00 UTC)',
        contextWindow: '131.072 Token (131K)',
        primaryModel: config.models.cfPrimary,
        backupModel: config.models.cfBackup,
        allModels: [config.models.cfPrimary, config.models.cfBackup],
      },
      {
        kind: 'gemini',
        displayName: 'Google Gemini API',
        keys: config.pools.gemini,
        cap: config.dailyCap.gemini,
        tokenCapPerKey: 0,
        tokenLimitType: 'requests_tpm',
        tokenLimitLabel: 'Bebas Kuota Harian (1M TPM & 1.500 RPD)',
        resetCycle: 'Harian (00:00 Pacific Time)',
        contextWindow: '1.000.000 Token (1M)',
        primaryModel: config.models.geminiPrimary,
        backupModel: config.models.geminiBackup,
        allModels: [config.models.geminiPrimary, config.models.geminiBackup],
      },
      {
        kind: 'openrouter',
        displayName: 'OpenRouter AI',
        keys: config.pools.openrouter,
        cap: config.dailyCap.openrouter,
        tokenCapPerKey: 0,
        tokenLimitType: 'requests_tpm',
        tokenLimitLabel: 'Bebas Kuota Harian (Dibatasi 50-1.000 RPD)',
        resetCycle: 'Harian (00:00 UTC)',
        contextWindow: '131.072 Token (131K)',
        primaryModel: config.models.orPrimary,
        backupModel: config.models.orMini,
        allModels: [config.models.orPrimary, config.models.orMini, config.models.orText],
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
        const hash12 = crypto.createHash('sha256').update(k).digest('hex').slice(0, 12);
        // Mendukung pencocokan hash12 (standar src/quota.ts) dan suffix 4-karakter (riwayat legacy)
        const used = (quotaMap.get(`${p.kind}:${hash12}`) || 0) + (quotaMap.get(`${p.kind}:${suffix}`) || 0);
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
        allModels: p.allModels,
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

    res.status(200).json({
      ok: true,
      botName: config.botName,
      serverTime: now.toISOString(),
      range,
      rangeLabel,
      platform: filterPlatform || 'all',
      today: todayStr,
      isDatabaseConnected: !!c,
      databaseNotice: !c
        ? `Supabase belum terhubung di container Vercel. Status: SUPABASE_URL (${config.supabaseUrl ? 'ADA' : 'KOSONG'}), SUPABASE_SERVICE_KEY (${config.supabaseKey ? 'ADA' : 'KOSONG'}). Pastikan Redeploy berhasil.`
        : null,
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
