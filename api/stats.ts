import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';
import { config } from '../src/env.js';
import { db } from '../src/db.js';
import { extractSessionToken, verifySessionToken } from '../src/admin_auth.js';
import { xkiroSearchStatus } from '../src/xkiro_web.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Versi aplikasi dibaca dari package.json saat modul dimuat, bukan ditulis ulang
// di HTML. Sebelumnya badge versi di dashboard.html di-hardcode, sehingga setiap
// rilis harus mengingat untuk mengubahnya juga — dan kalau lupa, dashboard
// menampilkan versi lama. Satu sumber kebenaran: package.json.
const APP_VERSION = (() => {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8'));
    return typeof pkg.version === 'string' ? pkg.version : '';
  } catch {
    return '';
  }
})();
import {
  fetchXkiroLimits,
  fetchOpenRouterLimits,
  fetchGroqLimits,
  fetchCloudflareLimits,
  geminiDocumentedLimits,
  dahlDocumentedLimits,
  type LiveLimit,
} from '../src/limits.js';

function detectMessageType(content: string): 'voice' | 'document' | 'image' | 'sticker' | 'video' | 'text' {
  // Tanpa kurung tutup agar varian grup ("[Voice Note dari X]: ...") ikut terdeteksi
  if (content.startsWith('[Voice Note')) return 'voice';
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
  // Token hanya diterima via header Authorization/x-admin-token (tidak via query
  // string — query bocor ke log proxy, history browser, dan Referer).
  const token = extractSessionToken(req);
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

    let quotasData: Array<{ kind: string; key_suffix: string; used: number; tokens_used?: number }> = [];
    let totalMessagesAllTime: number = 0;
    let waPeriod: number = 0;
    let telePeriod: number = 0;
    let assistantMsgs: Array<{ via: string | null }> = [];
    let allTimeAssistantMsgs: Array<{ via: string | null }> = [];
    let userMsgs: Array<{ content: string }> = [];
    let waMonthlyMsgs: Array<{ chat_id: string; created_at: string }> = [];

    // Batas kuota LIVE dari endpoint resmi tiap provider (v0.49).
    // Angka hardcode di .env TERBUKTI SALAH untuk beberapa provider — OpenRouter
    // sebenarnya 50 req/hari (bukan 180), Cloudflare 1200 req/300 detik (bukan 120 RPD),
    // Groq 8000 TPM (bukan 200K TPD). Sumber kebenaran = endpoint provider.
    const limitsPromise = (async (): Promise<Map<string, Map<string, LiveLimit>>> => {
      const result = new Map<string, Map<string, LiveLimit>>();
      const [xk, or, gq, cf] = await Promise.all([
        fetchXkiroLimits(config.pools.xkiro).catch(() => new Map<string, LiveLimit>()),
        fetchOpenRouterLimits(config.pools.openrouter).catch(() => new Map<string, LiveLimit>()),
        fetchGroqLimits(config.pools.groq, config.models.groqPrimary).catch(() => new Map<string, LiveLimit>()),
        fetchCloudflareLimits(config.pools.cloudflare, config.cloudflareAccountId).catch(() => new Map<string, LiveLimit>()),
      ]);
      result.set('xkiro', xk);
      result.set('openrouter', or);
      result.set('groq', gq);
      result.set('cloudflare', cf);
      // Gemini & Dahl: tidak ada endpoint kuota publik -> pakai dokumentasi resmi,
      // ditandai isLive:false agar dashboard jujur soal sumbernya.
      const gm = new Map<string, LiveLimit>();
      for (const k of config.pools.gemini) gm.set(k, geminiDocumentedLimits());
      result.set('gemini', gm);
      const dh = new Map<string, LiveLimit>();
      for (const k of config.pools.dahl) dh.set(k, dahlDocumentedLimits());
      result.set('dahl', dh);
      return result;
    })();

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
    let liveLimitsMap = new Map<string, Map<string, LiveLimit>>();
    let todayQuotasData: Array<{ kind: string; key_suffix: string; used: number; tokens_used?: number }> = [];

    if (c) {
      // Ambil tokens_used juga agar TPD riil bisa ditampilkan (bukan estimasi calls × rata-rata)
      let quotaQuery = c.from('provider_quota').select('kind, key_suffix, used, tokens_used');
      if (startDayStr) {
        if (range === 'today') {
          quotaQuery = quotaQuery.eq('day', startDayStr);
        } else {
          quotaQuery = quotaQuery.gte('day', startDayStr);
        }
      }

      // Kuota HARI INI (terpisah) — dipakai untuk persentase/status saat rentang bukan
      // "hari ini", karena kuota provider bersifat HARIAN (reset 00:00 UTC).
      const todayQuotaQuery = range === 'today'
        ? null
        : c.from('provider_quota').select('kind, key_suffix, used, tokens_used').eq('day', todayStr);

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
        let q = c
          .from('messages')
          .select('via, prompt_tokens, completion_tokens, total_tokens')
          .eq('role', 'assistant')
          .order('id', { ascending: false });
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
        liveLimits,
        dbTodayQuotaRes,
        ] = await Promise.all([
        quotaQuery,
        c.from('messages').select('*', { count: 'exact', head: true }),
        waPeriodQuery,
        telePeriodQuery,
        fetchPagedRange<{
          via: string | null;
          prompt_tokens?: number | null;
          completion_tokens?: number | null;
          total_tokens?: number | null;
        }>(buildAssistantQuery, 1000, 10000),
        fetchPagedRange<{ content: string | null }>(buildUserMsgsQuery, 1000, 10000),
        fetchPagedRange<{ chat_id: string | null; created_at: string }>(buildWaMonthlyQuery, 1000, 15000),
        c.from('messages').select('via').eq('role', 'assistant').order('id', { ascending: false }).limit(300),
        liveFetchPromise,
        limitsPromise,
        todayQuotaQuery ? todayQuotaQuery : Promise.resolve({ data: null }),
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
      liveLimitsMap = liveLimits;
      todayQuotasData = ((dbTodayQuotaRes as any)?.data as any[]) || [];
    } else {
      const [xk, or] = await liveFetchPromise;
      xkiroLiveResults = xk;
      orLiveResults = or;
      liveLimitsMap = await limitsPromise;
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

    // Map kuota HARI INI (dipakai untuk persentase/status saat rentang bukan "hari ini").
    const todayQuotaMap = new Map<string, number>();
    const todayTokenQuotaMap = new Map<string, number>();
    // Pemakaian WEB SEARCH xKiro (kind 'xkiro-search') dihitung TERPISAH:
    // kuotanya berbeda dari chat (10 pencarian/kunci/hari vs token), jadi
    // mencampurnya akan mengacaukan persentase pemakaian token provider.
    let webSearchUsedToday = 0;
    for (const q of todayQuotasData ?? []) {
      if (q.kind === 'xkiro-search') {
        webSearchUsedToday += q.used || 0;
        continue;
      }
      const key = `${q.kind}:${q.key_suffix}`;
      todayQuotaMap.set(key, (todayQuotaMap.get(key) || 0) + (q.used || 0));
      todayTokenQuotaMap.set(key, (todayTokenQuotaMap.get(key) || 0) + (Number(q.tokens_used) || 0));
    }

    const quotaMap = new Map<string, number>();
    // TPD riil per key dari kolom tokens_used (bukan estimasi calls × rata-rata)
    const tokenQuotaMap = new Map<string, number>();
    for (const q of quotasData ?? []) {
      const key = `${q.kind}:${q.key_suffix}`;
      quotaMap.set(key, (quotaMap.get(key) || 0) + (q.used || 0));
      tokenQuotaMap.set(key, (tokenQuotaMap.get(key) || 0) + (Number(q.tokens_used) || 0));
    }

    const totalMessagesPeriod =
      filterPlatform === 'whatsapp'
        ? (waPeriod ?? 0)
        : filterPlatform === 'telegram'
        ? (telePeriod ?? 0)
        : (waPeriod ?? 0) + (telePeriod ?? 0);

    const modelCounts: Record<string, number> = {};
    let totalModelCalls = 0;

    interface ProviderTokenAccumulator {
      realTokens: number;
      promptTokens: number;
      completionTokens: number;
      callsWithRealTokens: number;
      totalCalls: number;
    }

    const providerTokenStats: Record<string, ProviderTokenAccumulator> = {
      dahl: { realTokens: 0, promptTokens: 0, completionTokens: 0, callsWithRealTokens: 0, totalCalls: 0 },
      groq: { realTokens: 0, promptTokens: 0, completionTokens: 0, callsWithRealTokens: 0, totalCalls: 0 },
      gemini: { realTokens: 0, promptTokens: 0, completionTokens: 0, callsWithRealTokens: 0, totalCalls: 0 },
      cloudflare: { realTokens: 0, promptTokens: 0, completionTokens: 0, callsWithRealTokens: 0, totalCalls: 0 },
      openrouter: { realTokens: 0, promptTokens: 0, completionTokens: 0, callsWithRealTokens: 0, totalCalls: 0 },
      xkiro: { realTokens: 0, promptTokens: 0, completionTokens: 0, callsWithRealTokens: 0, totalCalls: 0 },
    };

    let grandTotalRealTokens = 0;
    let grandTotalCallsWithRealTokens = 0;

    // Atribusi provider dari string via. Format bisa berlapis (mis. "local-parser/groq/qwen/...",
    // "dynamic-pdf-error/gemini/..."), jadi cari segmen path yang cocok dengan provider resmi —
    // bukan hanya segmen pertama — agar token tetap terhitung ke pool yang benar.
    const KNOWN_PROVIDER_KINDS = ['groq', 'gemini', 'cloudflare', 'openrouter', 'dahl', 'xkiro'];
    const extractProviderKind = (via: string): string => {
      const segments = via.toLowerCase().split('/');
      return segments.find((s) => KNOWN_PROVIDER_KINDS.includes(s)) || '';
    };

    for (const m of assistantMsgs ?? []) {
      const rawModel = m.via || 'unknown';
      const model = rawModel.split('#')[0].trim();
      modelCounts[model] = (modelCounts[model] || 0) + 1;
      totalModelCalls++;

      const provKind = extractProviderKind(model);
      if (provKind && !providerTokenStats[provKind]) {
        providerTokenStats[provKind] = { realTokens: 0, promptTokens: 0, completionTokens: 0, callsWithRealTokens: 0, totalCalls: 0 };
      }
      if (provKind) {
        providerTokenStats[provKind].totalCalls++;
      }

      let pTokens = Number((m as any).prompt_tokens) || 0;
      let cTokens = Number((m as any).completion_tokens) || 0;
      let tTokens = Number((m as any).total_tokens) || 0;

      if (tTokens === 0 && rawModel.includes('#t=')) {
        const tokenMatch = rawModel.match(/#t=(\d+),(\d+),(\d+)/);
        if (tokenMatch) {
          pTokens = parseInt(tokenMatch[1], 10) || 0;
          cTokens = parseInt(tokenMatch[2], 10) || 0;
          tTokens = parseInt(tokenMatch[3], 10) || 0;
        }
      }

      if (tTokens > 0) {
        grandTotalRealTokens += tTokens;
        grandTotalCallsWithRealTokens++;
        if (provKind && providerTokenStats[provKind]) {
          providerTokenStats[provKind].realTokens += tTokens;
          providerTokenStats[provKind].promptTokens += pTokens;
          providerTokenStats[provKind].completionTokens += cTokens;
          providerTokenStats[provKind].callsWithRealTokens++;
        }
      }
    }

    // Kapan tiap provider terakhir kali menjawab. Diambil dari 300 balasan terbaru
    // (tanpa batas rentang) supaya provider yang belum dipakai hari ini tetap punya
    // konteks: "terakhir 20 Sep" jauh lebih jujur daripada "0" tanpa keterangan.
    const lastUsedByProvider: Record<string, string> = {};
    for (const m of allTimeAssistantMsgs ?? []) {
      const rawModel = (m as any).via || '';
      const model = rawModel.split('#')[0].trim();
      const provKind = extractProviderKind(model);
      if (!provKind) continue;
      const at = (m as any).created_at;
      if (!at) continue;
      if (!lastUsedByProvider[provKind] || at > lastUsedByProvider[provKind]) {
        lastUsedByProvider[provKind] = at;
      }
    }

    const overallAvgTokens = grandTotalCallsWithRealTokens > 0
      ? Math.round(grandTotalRealTokens / grandTotalCallsWithRealTokens)
      : 2500;
    const totalComputedTokensPeriod = grandTotalRealTokens + (Math.max(0, totalModelCalls - grandTotalCallsWithRealTokens) * overallAvgTokens);

    // Daftar model aktif sistem untuk memfilter histori DB lama yang sudah didepresiasi
    // Urutan mengikuti rantai failover teks runtime v0.67: xKiro > Cloudflare > Groq >
    // OpenRouter > Dahl > Gemini (sesuai instruksi user 21 Sep).
    const activeSystemModels = [
      // Tier 1: xKiro (Qwen saja - instruksi user)
      config.models.xkiroPrimary,
      ...config.models.xkiroBackup,
      // Tier 2: Cloudflare Workers AI (teks + seluruh model vision)
      config.models.cfPrimary,
      ...config.models.cfBackup,
      ...config.models.cfVision,
      // Tier 3: Groq
      config.models.groqPrimary,
      ...config.models.groqBackup,
      // Tier 4: OpenRouter
      config.models.orPrimary,
      ...config.models.orBackup,
      // Tier 5: Dahl Global
      config.models.dahlPrimary,
      ...config.models.dahlBackup,
      // Tier 6: Gemini (teks + model vision khusus)
      config.models.geminiPrimary,
      ...config.models.geminiBackup,
      ...config.models.geminiVision,
      // Rantai vision eksplisit (model yang bisa muncul sebagai `via`)
      ...config.models.visionChain.map((v) => v.model),
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

    // 4. Bangun status Pool per Provider & tiap API Key (6 Tier Resmi Runtime Sistem)
    const providerDefs: Array<{
      kind: 'dahl' | 'groq' | 'gemini' | 'cloudflare' | 'openrouter' | 'xkiro';
      displayName: string;
      keys: string[];
      cap: number;
      tokenCapPerKey: number;
      /** Cap token per-key bila tiap key berbeda (mis. xKiro key1 1jt vs key2/3 500k). */
      tokenCapPerKeyList: number[];
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
        tokenCapPerKey: config.dailyTokenCap.xkiro || 5000000,
        tokenCapPerKeyList: config.dailyTokenCapPerKey.xkiro,
        tokenLimitType: 'daily_cap',
        // Label dibangun dari cap per-key NYATA (key1 1jt, key2/3 500k) — bukan angka
        // seragam 5jt yang tidak pernah cocok dengan dashboard penyedia (temuan user).
        tokenLimitLabel: (() => {
          const caps = config.dailyTokenCapPerKey.xkiro.filter((c) => c > 0);
          if (caps.length === 0) return '500.000 Token/hari/key (per-key, sesuai dashboard xKiro)';
          const min = Math.min(...caps);
          const max = Math.max(...caps);
          const fmt = (n: number) => n.toLocaleString('id-ID');
          return min === max
            ? `${fmt(min)} Token/hari/key`
            : `${fmt(min)}-${fmt(max)} Token/hari/key (bervariasi per key)`;
        })(),
        resetCycle: 'Harian (00:00 UTC)',
        contextWindow: '131.072 Token (131K)',
        primaryModel: config.models.xkiroPrimary,
        backupModel: config.models.xkiroBackup.join(' / '),
        allModels: [config.models.xkiroPrimary, ...config.models.xkiroBackup],
      },
      {
        kind: 'openrouter',
        displayName: 'OpenRouter AI',
        keys: config.pools.openrouter,
        cap: config.dailyCap.openrouter,
        tokenCapPerKey: config.dailyTokenCap.openrouter,
        tokenCapPerKeyList: config.dailyTokenCapPerKey.openrouter,
        tokenLimitType: 'requests_tpm',
        tokenLimitLabel: 'Bebas Kuota Harian (Model :free • Rate Limit 50-1.000 RPD)',
        resetCycle: 'Harian (00:00 UTC)',
        contextWindow: '131.072 Token (131K)',
        primaryModel: config.models.orPrimary,
        backupModel: config.models.orBackup.join(' / '),
        allModels: [config.models.orPrimary, ...config.models.orBackup],
      },
      {
        kind: 'groq',
        displayName: 'Groq Cloud API',
        keys: config.pools.groq,
        cap: config.dailyCap.groq,
        tokenCapPerKey: config.dailyTokenCap.groq,
        tokenCapPerKeyList: config.dailyTokenCapPerKey.groq,
        tokenLimitType: 'daily_cap',
        tokenLimitLabel: '1.000 RPD/key • 8K TPM • 200K TPD (Free Tier resmi)',
        resetCycle: 'Harian (00:00 UTC)',
        contextWindow: '131.072 Token (131K)',
        primaryModel: config.models.groqPrimary,
        backupModel: config.models.groqBackup.join(' / '),
        allModels: [config.models.groqPrimary, ...config.models.groqBackup, 'whisper-large-v3-turbo'],
      },
      {
        kind: 'cloudflare',
        displayName: 'Cloudflare Workers AI',
        keys: config.pools.cloudflare,
        cap: config.dailyCap.cloudflare,
        tokenCapPerKey: config.dailyTokenCap.cloudflare,
        tokenCapPerKeyList: config.dailyTokenCapPerKey.cloudflare,
        tokenLimitType: 'daily_cap',
        tokenLimitLabel: '10.000 Neuron/hari/key (Free Tier resmi)',
        resetCycle: 'Harian (00:00 UTC)',
        contextWindow: '131.072 Token (131K)',
        primaryModel: config.models.cfPrimary,
        backupModel: config.models.cfBackup.join(' / '),
        // cfVision sudah tercakup lewat cfBackup (llama-4-scout, mistral-small) + primary,
        // tapi tetap disertakan agar model vision yang muncul sebagai `via` dikenali aktif.
        allModels: [config.models.cfPrimary, ...config.models.cfBackup, ...config.models.cfVision],
      },
      {
        kind: 'gemini',
        displayName: 'Google Gemini API',
        keys: config.pools.gemini,
        cap: config.dailyCap.gemini,
        tokenCapPerKey: config.dailyTokenCap.gemini,
        tokenCapPerKeyList: config.dailyTokenCapPerKey.gemini,
        tokenLimitType: 'requests_tpm',
        tokenLimitLabel: '1.500 RPD/key • 1M TPM Tier (Bebas Kuota Token Harian)',
        resetCycle: 'Harian (00:00 PT / 14:00 WIB)',
        contextWindow: '1.000.000 Token (1M)',
        primaryModel: config.models.geminiPrimary,
        backupModel: config.models.geminiBackup.join(' / '),
        allModels: [config.models.geminiPrimary, ...config.models.geminiBackup, ...config.models.geminiVision],
      },
      {
        kind: 'dahl',
        displayName: 'Dahl Global API',
        keys: config.pools.dahl,
        cap: config.dailyCap.dahl,
        tokenCapPerKey: 100000000,
        tokenCapPerKeyList: config.dailyTokenCapPerKey.dahl,
        tokenLimitType: 'daily_cap',
        tokenLimitLabel: '1 Miliar Token Pool (100M/key • 5.000 RPD)',
        resetCycle: 'Token Balance (1B Pool)',
        contextWindow: '131.072 Token (131K)',
        primaryModel: config.models.dahlPrimary,
        backupModel: config.models.dahlBackup.join(' / '),
        allModels: [config.models.dahlPrimary, ...config.models.dahlBackup],
      },
    ];

    let totalPoolKeys = 0;
    let totalCallsPeriod = 0;

    const pools = providerDefs.map((p) => {
      totalPoolKeys += p.keys.length;
      let poolUsed = 0;

      // Cap efektif: untuk rentang "Semua" (daysCount=0) kita TETAP memakai cap HARIAN
      // sebagai acuan bar/status — karena kuota provider memang harian (reset 00:00 UTC).
      // Sebelumnya daysCount=0 membuat cap 0 -> dashboard menampilkan "Uncapped" padahal
      // key punya limit harian dan sebagian sudah CAPPED (temuan user: "ketika filter hari
      // jadi dipilih semua, matriks penggunaan pool api key jadi begini").
      const effectiveCapPerKey = daysCount > 0 ? p.cap * daysCount : p.cap;
      // Saldo token Dahl adalah pool 1B (bukan kuota harian), jadi TIDAK dikali jumlah hari —
      // sisa saldo tetap sama berapa pun rentang tanggal yang dipilih.
      const effectiveTokenCapPerKey =
        p.kind === 'dahl' ? p.tokenCapPerKey : daysCount > 0 ? p.tokenCapPerKey * daysCount : 0;

      const pStats = providerTokenStats[p.kind] || {
        realTokens: 0,
        promptTokens: 0,
        completionTokens: 0,
        callsWithRealTokens: 0,
        totalCalls: 0,
      };

      const providerAvgTokens = pStats.callsWithRealTokens > 0
        ? Math.round(pStats.realTokens / pStats.callsWithRealTokens)
        : overallAvgTokens;

      const legacyCalls = Math.max(0, pStats.totalCalls - pStats.callsWithRealTokens);
      const providerComputedTokens = pStats.realTokens + (legacyCalls * providerAvgTokens);

      const keysDetail = p.keys.map((k, keyIdx) => {
        const suffix = k.slice(-4);
        const hash12 = crypto.createHash('sha256').update(k).digest('hex').slice(0, 12);
        // Mendukung pencocokan hash12 (standar src/quota.ts) dan suffix 4-karakter (riwayat legacy)
        const used = (quotaMap.get(`${p.kind}:${hash12}`) || 0) + (quotaMap.get(`${p.kind}:${suffix}`) || 0);
        poolUsed += used;
        totalCallsPeriod += used;

        // Limit LIVE dari endpoint provider (v0.49) — sumber kebenaran utama.
        // .env hanya dipakai sebagai fallback bila endpoint tidak menyatakan limit.
        const liveLimit = liveLimitsMap.get(p.kind)?.get(k) ?? null;
        // Cap token untuk KEY INI. Prioritas: (1) endpoint live, (2) daftar cap per-key
        // di .env, (3) cap seragam provider. Endpoint menang karena .env terbukti salah
        // (mis. xKiro key1 sebenarnya 1jt, OpenRouter 50/hari bukan 180).
        // Bila endpoint memberi data limit (isLive) tetapi TIDAK menyatakan TPD,
        // jangan pakai angka .env sebagai fakta — itu klaim tanpa dasar. Contoh: Groq
        // header hanya menyebut 1000 RPD + 8000 TPM (per menit), bukan TPD.
        const endpointAuthoritative = liveLimit?.isLive === true;
        const perKeyTokenCap = endpointAuthoritative
          ? (liveLimit?.tokensPerDay ?? 0)
          : (p.tokenCapPerKeyList.length > keyIdx ? p.tokenCapPerKeyList[keyIdx] : 0);
        // RPD live per key (OpenRouter: free_model_daily_requests; Groq: header).
        const liveRpdCap = liveLimit?.requestsPerDay ?? 0;

        const xkLive = p.kind === 'xkiro' ? xkiroSyncMap.get(k) : null;
        const orLive = p.kind === 'openrouter' ? orSyncMap.get(k) : null;

        // Token riil per key dari DB (kolom tokens_used) — sumber valid untuk TPD.
        // Estimasi (used × rata-rata) hanya dipakai sebagai pelengkap saat data riil kosong.
        const realTokensForKey =
          (tokenQuotaMap.get(`${p.kind}:${hash12}`) || 0) + (tokenQuotaMap.get(`${p.kind}:${suffix}`) || 0);
        const isRealTokenData = realTokensForKey > 0;

        // Pemakaian dari endpoint live lebih akurat daripada catatan internal bot
        // (mencakup pemakaian dari IDE/terminal/alat lain di akun yang sama).
        let tokensUsed = liveLimit?.tokensUsedToday ?? (isRealTokenData
          ? realTokensForKey
          : used > 0
          ? Math.round(used * providerAvgTokens)
          : 0);
        // Pemakaian request dari endpoint (mis. OpenRouter free_model_daily_requests.used).
        const liveCallsUsed = liveLimit?.requestsUsedToday ?? null;
        const effectiveCallsUsed = liveCallsUsed !== null ? liveCallsUsed : used;
        // Cap token efektif key ini.
        // Bila endpoint LIVE menyatakan limit dan TIDAK menyebut TPD (contoh: Groq
        // hanya 1000 RPD + 8000 TPM), maka TIDAK ADA batas token harian — jangan
        // jatuh ke angka .env yang tidak didukung endpoint (itu klaim palsu).
        let tokenCap: number;
        if (endpointAuthoritative) {
          tokenCap = perKeyTokenCap > 0
            ? (p.kind === 'dahl' ? perKeyTokenCap : daysCount > 0 ? perKeyTokenCap * daysCount : perKeyTokenCap)
            : 0;
        } else {
          tokenCap = perKeyTokenCap > 0
            ? (p.kind === 'dahl' ? perKeyTokenCap : daysCount > 0 ? perKeyTokenCap * daysCount : perKeyTokenCap)
            : effectiveTokenCapPerKey;
        }
        // Sisa dari endpoint bila tersedia (paling akurat — sudah memperhitungkan
        // pemakaian dari semua aplikasi di akun yang sama).
        let remainingTokens: number | null =
          liveLimit?.tokensRemaining ?? (tokenCap > 0 ? Math.max(0, tokenCap - tokensUsed) : null);
        // Token percent: sama — pakai data HARIAN. Saat rentang "Semua", xKiro tetap
        // memakai live (sudah harian); provider lain pakai DB harian bila tersedia.
        const tokensForPercent = daysCount > 0 || liveLimit?.tokensUsedToday != null
          ? tokensUsed
          : (todayTokenQuotaMap.get(`${p.kind}:${hash12}`) || 0) + (todayTokenQuotaMap.get(`${p.kind}:${suffix}`) || 0) || tokensUsed;
        let tokenPercent = tokenCap > 0 ? Math.min(100, Math.round((tokensForPercent / tokenCap) * 100)) : 0;

        if (xkLive) {
          // Menggunakan data sinkronisasi langsung dari web server xKiro (global di semua apps)
          tokensUsed = xkLive.usedToday;
          tokenCap = xkLive.limitPerDay;
          remainingTokens = xkLive.remaining;
          tokenPercent = tokenCap > 0 ? Math.min(100, Math.round((tokensUsed / tokenCap) * 100)) : 0;
        }

        // Cap RPD efektif: endpoint live menang; kalau tidak ada, pakai .env.
        // Untuk rentang "Semua", cap tetap HARIAN (kuota provider harian) — bukan cap
        // dikali jumlah hari, karena akumulasi sepanjang waktu selalu melampaui kuota harian
        // dan membuat semua key tampak CAPPED 100%.
        const callCap = liveRpdCap > 0 ? liveRpdCap : (daysCount > 0 ? p.cap * daysCount : p.cap);
        // Persentase/status SELALU mencerminkan kuota HARIAN (provider reset harian).
        // Untuk rentang "Semua": pakai pemakaian HARI INI dari DB (todayQuotaMap), bukan
        // akumulasi — akumulasi selalu melampaui kuota harian dan membuat semua key
        // tampak CAPPED 100% (temuan user pada filter "Semua").
        const todayUsedForKey = (todayQuotaMap.get(`${p.kind}:${hash12}`) || 0) + (todayQuotaMap.get(`${p.kind}:${suffix}`) || 0);
        // Pemakaian HARIAN key ini — SELALU dipakai untuk baris key, karena cap provider
        // bersifat harian. Akumulasi periode dikirim terpisah sebagai `usedPeriod`.
        const dailyCallsUsed = liveCallsUsed ?? (daysCount > 0 ? effectiveCallsUsed : todayUsedForKey);
        const percent = callCap > 0 ? Math.min(100, Math.round((dailyCallsUsed / callCap) * 100)) : 0;
        // Status key mempertimbangkan RPD DAN TPD — mana yang lebih dulu tercapai.
        const bindingPercent = Math.max(percent, tokenPercent);
        const status = bindingPercent >= 100 ? 'capped' : bindingPercent >= 80 ? 'warning' : 'healthy';
        // Metrik yang MENGIKAT (binding) dipakai untuk progress bar & label agar visual
        // konsisten dengan status. Tanpa ini bar bisa 22% (calls) padahal badge CAPPED
        // (token 100%) — sumber kebingungan di dashboard (temuan user).
        const bindingMetric: 'tokens' | 'calls' = tokenPercent >= percent ? 'tokens' : 'calls';

        return {
          suffix,
          used: dailyCallsUsed,
          usedPeriod: effectiveCallsUsed,
          dbUsed: used,
          cap: callCap,
          remaining: callCap > 0 ? Math.max(0, callCap - effectiveCallsUsed) : null,
          percent,
          // Sumber limit: endpoint live atau fallback dokumentasi/.env — dashboard
          // menampilkan ini agar pengguna tahu seberapa valid angkanya.
          limitSource: liveLimit?.source ?? 'konfigurasi .env',
          limitIsLive: liveLimit?.isLive ?? false,
          officialLimitLabel: liveLimit?.officialLabel ?? null,
          tokensPerMinute: liveLimit?.tokensPerMinute ?? null,
          bindingPercent,
          bindingMetric,
          tokensUsed,
          tokenCap,
          tokenPercent,
          isRealTokenData,
          tokenLimitType: p.tokenLimitType,
          tokenLimitLabel: p.tokenLimitLabel,
          resetCycle: p.resetCycle,
          contextWindow: p.contextWindow,
          avgTokensPerChat: providerAvgTokens,
          status,
          // "Live synced" = ada data langsung dari endpoint provider — baik pemakaian
          // (xKiro/OpenRouter) maupun batas kuota (Groq/Cloudflare via header). Sebelumnya
          // hanya xKiro & OpenRouter yang ditandai, sehingga Groq/Cloudflare tampak
          // "tidak tersinkron" padahal limitnya diambil live dari header respons.
          isLiveSynced: !!xkLive || !!orLive || (liveLimit?.isLive ?? false),
          liveUserName: xkLive?.userName ?? null,
          liveUserEmail: xkLive?.userEmail ?? null,
          liveRemainingTokens: remainingTokens,
          liveUsageUsd: orLive?.usageUsd ?? null,
          liveDailyUsageUsd: orLive?.usageDailyUsd ?? null,
          isFreeTier: orLive?.isFreeTier ?? true,
        };
      });

      const totalPoolCap = effectiveCapPerKey * p.keys.length;
      // Total cap token pool = JUMLAH cap tiap key (bukan cap seragam x jumlah key).
      // Untuk xKiro ini 1jt + 500k + 500k = 2jt (sebelumnya salah: 500k x 3 = 1,5jt).
      const totalTokenPoolCap = keysDetail.reduce((acc, kd) => {
        const capForRange = p.kind === 'dahl' ? kd.tokenCap : kd.tokenCap;
        return acc + (capForRange > 0 ? capForRange : 0);
      }, 0);
      const poolPercent = totalPoolCap > 0 ? Math.min(100, Math.round((poolUsed / totalPoolCap) * 100)) : 0;
      
      const isAnyLiveSynced = keysDetail.some((kd) => kd.isLiveSynced);
      const anyRealTokenData = keysDetail.some((kd) => kd.isRealTokenData);
      let poolTokensUsed = 0;
      if (p.kind === 'xkiro' && isAnyLiveSynced) {
        // xKiro: pakai data live dari API (akurat, global semua app) untuk tiap key.
        for (const kd of keysDetail) {
          poolTokensUsed += kd.tokensUsed;
        }
      } else if (anyRealTokenData) {
        // Prioritas data token riil dari DB (valid untuk TPD & pelaporan)
        for (const kd of keysDetail) {
          poolTokensUsed += kd.tokensUsed;
        }
      } else {
        poolTokensUsed = providerComputedTokens > 0
          ? providerComputedTokens
          : keysDetail.reduce((acc, kd) => acc + kd.tokensUsed, 0);
      }
      const poolTokenPercent = totalTokenPoolCap > 0 ? Math.min(100, Math.round((poolTokensUsed / totalTokenPoolCap) * 100)) : 0;
      // Pemakaian HARIAN pool — agar header kartu bisa menampilkan konteks cap harian
      // tanpa mencampur akumulasi periode (temuan: "1728/1500" menyesatkan).
      const poolUsedToday = keysDetail.reduce((acc, kd) => acc + (kd.used || 0), 0);
      // Sisa token pool = jumlah sisa tiap key (menghormati cap per-key & data live).
      const poolTokensRemaining = keysDetail.reduce((acc, kd) => acc + (kd.liveRemainingTokens ?? kd.remaining ?? 0), 0);
      const poolCappedKeys = keysDetail.filter((kd) => kd.status === 'capped').length;

      // Label limit pool: prioritaskan label resmi dari endpoint (mis. Groq
      // "1.000 RPD • 8.000 TPM", Cloudflare "Rate limit 1.200 req/5 menit"), karena
      // label statis di .env terbukti salah (200K TPD Groq, 120 RPD Cloudflare).
      const firstLiveLimit = keysDetail.map((kd) => kd.officialLimitLabel).find((l) => l) ?? null;
      const poolTokenLimitLabel = firstLiveLimit ?? p.tokenLimitLabel;

      return {
        kind: p.kind,
        displayName: p.displayName,
        primaryModel: p.primaryModel,
        backupModel: p.backupModel,
        allModels: p.allModels,
        contextWindow: p.contextWindow,
        tokenLimitType: p.tokenLimitType,
        tokenLimitLabel: poolTokenLimitLabel,
        limitSourceLive: keysDetail.some((kd) => kd.limitIsLive),
        resetCycle: p.resetCycle,
        keyCount: p.keys.length,
        capPerKey: effectiveCapPerKey,
        totalCap: totalPoolCap,
        usedToday: poolUsedToday,
        usedPeriod: poolUsed,
        usedTodayDaily: poolUsedToday,
        percent: poolPercent,
        tokenCapPerKey: effectiveTokenCapPerKey,
        tokenCapPerKeyList: p.tokenCapPerKeyList,
        totalTokenCap: totalTokenPoolCap,
        totalTokensUsed: poolTokensUsed,
        totalTokensRemaining: poolTokensRemaining,
        cappedKeys: poolCappedKeys,
        tokenPercent: poolTokenPercent,
        avgTokensPerChat: providerAvgTokens,
        realUsageCalls: pStats.callsWithRealTokens,
        realTokensUsed: pStats.realTokens,
        isLiveSynced: isAnyLiveSynced,
        lastUsedAt: lastUsedByProvider[p.kind] || null,
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
        totalTokensPeriod: totalComputedTokensPeriod,
        totalTokensToday: totalComputedTokensPeriod,
        avgTokensPerChat: overallAvgTokens,
        realTokensPeriod: grandTotalRealTokens,
        callsWithRealTokens: grandTotalCallsWithRealTokens,
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
      version: APP_VERSION,
      // Pemakaian WEB SEARCH xKiro — kuota terpisah dari kuota token.
      // Batas 10 pencarian/kunci/hari diukur langsung dari respons provider
      // (kunci membalas 429 pada pencarian ke-11), bukan dari dokumentasi.
      //
      // Angka "terpakai" diambil dari DATABASE (persisten lintas instance),
      // bukan dari penghitung in-memory yang selalu 0 di serverless.
      // Bila DB tidak tersedia, nilainya null dan dashboard menampilkannya
      // sebagai tanda pisah — lebih jujur daripada menampilkan 0.
      webSearch: (() => {
        const s = xkiroSearchStatus();
        const capTotal = s.keysTotal * s.capPerKey;
        const usedFromDb = webSearchUsedToday;
        return {
          ...s,
          usedToday: usedFromDb,
          usedPercent: capTotal > 0 ? Math.min(100, Math.round((usedFromDb / capTotal) * 100)) : 0,
          remainingToday: Math.max(0, capTotal - usedFromDb),
        };
      })(),
    });
  } catch (err) {
    console.error('[api/stats] Gagal mengumpulkan metrik:', err);
    res.status(500).json({ ok: false, error: 'Internal Server Error' });
  }
}
