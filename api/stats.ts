import { hitungNeuron, NEURON_HARIAN_GRATIS } from '../src/neuron.js';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';
import { config } from '../src/env.js';
import { db } from '../src/db.js';
import { extractSessionToken, verifySessionToken } from '../src/admin_auth.js';
// (xKiro DIHAPUS 04 Okt 2026 — semua akun disuspend permanen 403)
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
  fetchOpenRouterLimits,
  getCachedLimits,
  fetchDreamPromptingLimits,
  type LiveLimit,
} from '../src/limits.js';

type QuotaRow = { kind: string; key_suffix: string; used: number; tokens_used?: number | null };

export function getStatsPeriod(range: string, now = new Date()) {
  const todayStr = now.toISOString().slice(0, 10);
  const daysCount = range === 'all' ? 0 : ({ '7d': 7, '14d': 14, '30d': 30 }[range] ?? 1);
  const startDateIso = daysCount ? new Date(Date.parse(todayStr + 'T00:00:00.000Z') - (daysCount - 1) * 86400000).toISOString() : null;
  return { todayStr, daysCount, startDateIso, startDayStr: startDateIso?.slice(0, 10) ?? null,
    rangeLabel: daysCount === 0 ? 'Semua waktu (UTC)' : daysCount === 1 ? 'Hari ini (UTC)' : daysCount + ' hari kalender (UTC)' };
}

export function quotaUsage(rows: QuotaRow[], kind: string, hashes: string[]) {
  const selected = rows.filter((r) => r.kind === kind && hashes.includes(r.key_suffix));
  const used = selected.reduce((sum, r) => sum + Math.max(0, Number(r.used) || 0), 0);
  const recorded = selected.reduce((sum, r) => sum + Math.max(0, Number(r.tokens_used) || 0), 0);
  const complete = selected.every((r) => !r.used || (typeof r.tokens_used === 'number' && r.tokens_used > 0));
  return { used, tokens: complete ? recorded : null, recorded };
}

// Katalog untuk UI berasal dari konfigurasi runtime; tidak memuat kredensial.
export function getModelCatalog() {
  const m = config.models;
  const tiers = [
    { provider: 'opencode', primary: m.opencodePrimary, backup: m.opencodeBackup },
    { provider: 'cloudflare', primary: m.cfPrimary, backup: m.cfBackup },
    { provider: 'groq', primary: m.groqPrimary, backup: m.groqBackup },
    { provider: 'dreamprompting', primary: m.dpPrimary, backup: m.dpBackup },
    { provider: 'openrouter', primary: m.orPrimary, backup: m.orBackup },
    { provider: 'gemini', primary: m.geminiPrimary, backup: m.geminiBackup },
  ];
  return tiers.flatMap((p, index) => {
    const textModels = [p.primary, ...p.backup];
    const visionModels = m.visionChain.filter((v) => v.kind === p.provider).map((v) => v.model);
    const nativeModels = p.provider === 'gemini' ? m.geminiVision : [];
    const audioModels = p.provider === 'groq' ? [m.groqWhisperPrimary, m.groqWhisperBackup]
      : p.provider === 'cloudflare' ? [m.cfWhisper] : [];
    return [...new Set([...textModels, ...visionModels, ...nativeModels, ...audioModels])].map((model) => {
      const capabilities = [];
      if (textModels.includes(model)) capabilities.push('Text');
      if (visionModels.includes(model)) capabilities.push('Vision');
      if (nativeModels.includes(model)) capabilities.push('Audio', 'PDF', 'Video');
      if (audioModels.includes(model)) capabilities.push('Voice');
      const textIndex = textModels.indexOf(model);
      const visionIndex = m.visionChain.findIndex((v) => v.kind === p.provider && v.model === model);
      return {
        id: p.provider + '/' + model, model, provider: p.provider, tier: index + 1, capabilities,
        desc: ['Tier ' + (index + 1), textIndex === 0 ? 'Primer teks' : textIndex > 0 ? 'Cadangan teks #' + textIndex : '',
          visionIndex >= 0 ? 'Vision #' + (visionIndex + 1) : '', nativeModels.includes(model) ? 'Media native' : '',
          audioModels.includes(model) ? 'Transkripsi' : ''].filter(Boolean).join(' · '),
      };
    });
  });
}

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

  const requestedRange = String(req.query.range || 'today').toLowerCase();
  const range = ['today', '7d', '14d', '30d', 'all'].includes(requestedRange) ? requestedRange : 'today';
  const filterPlatform = ['whatsapp', 'telegram'].includes(String(req.query.platform)) ? String(req.query.platform) : 'all';
  const now = new Date();
  const { todayStr, startDateIso, startDayStr, rangeLabel, daysCount } = getStatsPeriod(range, now);


  const c = db();
  if (!c) {
    res.status(503).json({ ok: false, error: 'Data monitoring belum tersedia', isDatabaseConnected: false });
    return;
  }

  try {
    let quotasData: Array<{ kind: string; key_suffix: string; used: number; tokens_used?: number }> = [];
    let totalMessagesAllTime: number = 0;
    let waPeriod: number = 0;
    let telePeriod: number = 0;
    let assistantMsgs: Array<{ via: string | null }> = [];
    let allTimeAssistantMsgs: Array<{ via: string | null }> = [];
    let userMsgs: Array<{ content: string }> = [];
    let waMonthlyMsgs: Array<{ chat_id: string; created_at: string }> = [];

    // Monitoring tidak mengirim inferensi; endpoint kuota murah memakai cache 30 menit.
    const cacheKeys: Record<string, string> = {
      groq: 'groq:' + config.pools.groq.length + ':' + config.models.groqPrimary,
      cloudflare: 'cloudflare:' + config.pools.cloudflare.length + ':' + config.cloudflareAccountId,
      openrouter: 'openrouter:' + config.pools.openrouter.length,
      dreamprompting: 'dreamprompting:' + config.pools.dreamprompting.length,
    };
    const limitsPromise = Promise.all([
      fetchOpenRouterLimits(config.pools.openrouter).catch(() => new Map<string, LiveLimit>()),
      fetchDreamPromptingLimits(config.pools.dreamprompting).catch(() => new Map<string, LiveLimit>()),
    ]).then(([or, dp]) => new Map<string, Map<string, LiveLimit>>([
      ['openrouter', or], ['dreamprompting', dp],
      ['groq', getCachedLimits(cacheKeys.groq)?.data ?? new Map()],
      ['cloudflare', getCachedLimits(cacheKeys.cloudflare)?.data ?? new Map()],
    ]));
    let liveLimitsMap = new Map<string, Map<string, LiveLimit>>();
    let todayQuotasData: QuotaRow[] = [];
    let cooldownAvailable = true;
    let dataTruncated = false;

    const cooldownAktif = new Map<string, { alasan: string; until: string }>();
    if (c) {
      try {
        const { data: cds, error: cooldownError } = await c
          .from('provider_cooldown')
          .select('kind, key_hash, alasan, until_at')
          .gt('until_at', new Date().toISOString());
        if (cooldownError) throw cooldownError;
        for (const cd of (cds ?? []) as Array<{ kind: string; key_hash: string; alasan: string; until_at: string }>) {
          cooldownAktif.set(`${cd.kind}:${cd.key_hash}`, { alasan: cd.alasan, until: cd.until_at });
        }
      } catch {
        cooldownAvailable = false;
      }
    }

    if (c) {
      // Ambil tokens_used juga agar TPD riil bisa ditampilkan (bukan estimasi calls × rata-rata)
      const quotaQuery = () => {
        let query = c.from('provider_quota').select('kind, key_suffix, used, tokens_used').order('day').order('kind').order('key_suffix');
        if (startDayStr) query = range === 'today' ? query.eq('day', startDayStr) : query.gte('day', startDayStr);
        return query;
      };

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
          if (error) throw error;
          if (!data || data.length === 0) break;
          rows.push(...(data as T[]));
          if (data.length < batchSize) break;
          from += batchSize;
        }
        if (rows.length >= maxRecords) dataTruncated = true;
        return rows;
      }

      const buildAssistantQuery = () => {
        let q = c
          .from('messages')
          .select('via, created_at, prompt_tokens, completion_tokens, total_tokens')
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
        liveLimits,
        dbTodayQuotaRes,
        ] = await Promise.all([
        fetchPagedRange<QuotaRow>(quotaQuery),
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
        c.from('messages').select('via, created_at').eq('role', 'assistant').order('id', { ascending: false }).limit(300),
        limitsPromise,
        todayQuotaQuery ? todayQuotaQuery : Promise.resolve({ data: null }),
      ]);

      for (const result of [dbTotalRes, dbWaRes, dbTeleRes, allTimeAssistantRes, dbTodayQuotaRes]) {
        if ((result as any)?.error) throw (result as any).error;
      }
      quotasData = dbQuotaRes as any;
      totalMessagesAllTime = dbTotalRes.count || 0;
      waPeriod = dbWaRes.count || 0;
      telePeriod = dbTeleRes.count || 0;
      assistantMsgs = assistantMsgsRes as any;
      allTimeAssistantMsgs = ((allTimeAssistantRes?.data as any) || []) as Array<{ via: string | null }>;
      userMsgs = userMsgsRes as any;
      waMonthlyMsgs = waMonthlyMsgsRes as any;

      liveLimitsMap = liveLimits;
      todayQuotasData = range === 'today' ? quotasData : (((dbTodayQuotaRes as any)?.data as any[]) || []);
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
      opencode: { realTokens: 0, promptTokens: 0, completionTokens: 0, callsWithRealTokens: 0, totalCalls: 0 },
      openrouter: { realTokens: 0, promptTokens: 0, completionTokens: 0, callsWithRealTokens: 0, totalCalls: 0 },
    };

    let grandTotalRealTokens = 0;
    let grandTotalCallsWithRealTokens = 0;

    // Atribusi provider dari string via. Format bisa berlapis (mis. "local-parser/groq/qwen/...",
    // "dynamic-pdf-error/gemini/..."), jadi cari segmen path yang cocok dengan provider resmi —
    // bukan hanya segmen pertama — agar token tetap terhitung ke pool yang benar.
    const KNOWN_PROVIDER_KINDS = ['dreamprompting', 'cloudflare', 'nvidia', 'openrouter', 'groq', 'gemini', 'dahl', 'opencode'];
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
      : 0;

    const modelCatalog = getModelCatalog();
    const activeSystemModels = new Set(modelCatalog.map((m) => m.id.toLowerCase()));
    const isModelActive = (modelStr: string): boolean => {
      const parts = modelStr.toLowerCase().split('/');
      const at = parts.findIndex((part) => KNOWN_PROVIDER_KINDS.includes(part));
      return at >= 0 && activeSystemModels.has(parts.slice(at).join('/'));
    };

    // Urutan MRU (Most Recently Used) All-Time:
    // Urutan kronologis model diambil dari riwayat all-time agar tumpukan MRU tidak terputus/reset saat berganti filter tanggal
    const recentModelOrder: string[] = [];
    const seenRecent = new Set<string>();

    const candidateRecentMsgs = allTimeAssistantMsgs.length > 0 ? allTimeAssistantMsgs : (assistantMsgs ?? []);
    for (const m of candidateRecentMsgs) {
      const rawModel = m?.via || 'unknown';
      const model = rawModel.split('#')[0].trim();
      if (model && model !== 'unknown' && model !== 'cache' && !model.startsWith('system/') && !seenRecent.has(model)) {
        seenRecent.add(model);
        recentModelOrder.push(model);
      }
    }

    // Edge case: jika ada model pada periode aktif yang belum masuk ke tumpukan candidate
    for (const m of assistantMsgs ?? []) {
      const rawModel = m?.via || 'unknown';
      const model = rawModel.split('#')[0].trim();
      if (model && model !== 'unknown' && model !== 'cache' && !model.startsWith('system/') && !seenRecent.has(model)) {
        seenRecent.add(model);
        recentModelOrder.push(model);
      }
    }

    const latestActiveModel = recentModelOrder.find(isModelActive) || null;

    const modelsBreakdown = Object.entries(modelCounts)
      .map(([name, count]) => ({
        name,
        count,
        percent: totalModelCalls > 0 ? Math.round((count / totalModelCalls) * 100) : 0,
      }))
      .sort((a, b) => b.count - a.count);

    // 4. Bangun status Pool per Provider & tiap API Key (6 Tier Runtime)
    const providerDefs: Array<{
      kind: 'opencode' | 'cloudflare' | 'groq' | 'dreamprompting' | 'openrouter' | 'gemini';
      displayName: string;
      keys: string[];
      cap: number;
      tokenCapPerKey: number;
      /** Cap token per-key bila tiap key berbeda (mis. xKiro key1 1jt vs key2/3 500k). */
      tokenCapPerKeyList: number[];
      tokenLimitType: 'daily_cap' | 'requests_tpm' | 'monthly_credits' | 'neuron' | 'neuron';
      tokenLimitLabel: string;
      resetCycle: string;
      contextWindow: string;
      primaryModel: string;
      backupModel: string;
      allModels: string[];
    }> = [
      {
        kind: 'opencode',
        displayName: 'OpenCode Free',
        keys: config.pools.opencode,
        cap: config.dailyCap.opencode,
        tokenCapPerKey: config.dailyTokenCap.opencode,
        tokenCapPerKeyList: config.dailyTokenCapPerKey.opencode,
        tokenLimitType: 'daily_cap',
        // OpenCode Free: TIDAK BISA LIVE-SYNCED. Diuji 04 Okt ke 10 endpoint kandidat
        // (/zen/v1/usage, /quota, /limits, /me, /account, /key, /credits, /api/v1/...)
        // -> SEMUA 404; header respons chat juga TIDAK memuat info kuota/limit.
        // Karena itu dashboard memakai catatan internal bot (dihitung dari pemakaian
        // nyata), ditandai "Bot Monitored" — bukan "Live Synced" — agar jujur.
        tokenLimitLabel: 'Tanpa API key; batas upstream belum diketahui',
        resetCycle: 'Mengikuti kuota upstream',
        contextWindow: 'Belum terverifikasi per model',
        primaryModel: config.models.opencodePrimary,
        backupModel: config.models.opencodeBackup.join(' / '),
        allModels: modelCatalog.filter((m) => m.provider === 'opencode').map((m) => m.model),
      },
      {
        kind: 'cloudflare',
        displayName: 'Cloudflare Workers AI',
        keys: config.pools.cloudflare,
        cap: config.dailyCap.cloudflare,
        tokenCapPerKey: config.dailyTokenCap.cloudflare,
        tokenCapPerKeyList: config.dailyTokenCapPerKey.cloudflare,
        // DIPERBAIKI 04 Okt: Cloudflare membatasi NEURON (bukan request/token biasa).
        // Kasus nyata: 3 key tampak "51% OPTIMAL" dari sisi request, padahal kuota
        // neuron SUDAH HABIS dan semua request 429. Label harus menegaskan neuron
        // sebagai batas utama, dan pemakaian neuron dihitung dari data nyata.
        tokenLimitType: 'neuron',
        tokenLimitLabel: '10.000 Neuron/hari (batas utama) • 1.200 req/5 menit (rate limit)',
        resetCycle: 'Harian (00:00 UTC)',
        contextWindow: 'Belum terverifikasi per model',
        primaryModel: config.models.cfPrimary,
        backupModel: config.models.cfBackup.join(' / '),
        allModels: modelCatalog.filter((m) => m.provider === 'cloudflare').map((m) => m.model),
      },
      {
        kind: 'groq',
        displayName: 'Groq Cloud API',
        keys: config.pools.groq,
        cap: config.dailyCap.groq,
        tokenCapPerKey: config.dailyTokenCap.groq,
        tokenCapPerKeyList: config.dailyTokenCapPerKey.groq,
        tokenLimitType: 'daily_cap',
        tokenLimitLabel: 'Batas per model mengikuti header upstream; pemakaian bot dicatat terpisah',
        resetCycle: 'Harian (00:00 UTC)',
        contextWindow: 'Belum terverifikasi per model',
        primaryModel: config.models.groqPrimary,
        backupModel: config.models.groqBackup.join(' / '),
        allModels: modelCatalog.filter((m) => m.provider === 'groq').map((m) => m.model),
      },
      {
        kind: 'dreamprompting',
        displayName: 'DreamPrompting',
        keys: config.pools.dreamprompting,
        cap: config.dailyCap.dreamprompting,
        tokenCapPerKey: config.dailyTokenCap.dreamprompting,
        tokenCapPerKeyList: config.dailyTokenCapPerKey.dreamprompting,
        // DIPERBAIKI 04 Okt: label lama "100 RPM • Rolling 24h Free Tier" SALAH.
        // Endpoint /api/v1/quota menyatakan: 5.000 req/hari DAN 500.000 token/hari,
        // scope AKUN (bukan per key), dengan rate limit 100 req/menit.
        // Dua batas berjalan bersamaan — mana yang habis lebih dulu mengikat.
        tokenLimitType: 'daily_cap',
        tokenLimitLabel: 'Batas akun mengikuti endpoint kuota; fallback dokumentasi ditandai',
        resetCycle: 'Rolling 24 jam',
        contextWindow: 'Belum terverifikasi per model',
        primaryModel: config.models.dpPrimary,
        backupModel: config.models.dpBackup.join(' / '),
        allModels: modelCatalog.filter((m) => m.provider === 'dreamprompting').map((m) => m.model),
      },
      {
        kind: 'openrouter',
        displayName: 'OpenRouter AI',
        keys: config.pools.openrouter,
        cap: config.dailyCap.openrouter,
        tokenCapPerKey: config.dailyTokenCap.openrouter,
        tokenCapPerKeyList: config.dailyTokenCapPerKey.openrouter,
        tokenLimitType: 'requests_tpm',
        tokenLimitLabel: 'Model :free tetap memiliki batas request; ikuti endpoint kuota',
        resetCycle: 'Harian (00:00 UTC)',
        contextWindow: 'Belum terverifikasi per model',
        primaryModel: config.models.orPrimary,
        backupModel: config.models.orBackup.join(' / '),
        allModels: modelCatalog.filter((m) => m.provider === 'openrouter').map((m) => m.model),
      },
      {
        kind: 'gemini',
        displayName: 'Google Gemini API',
        keys: config.pools.gemini,
        cap: config.dailyCap.gemini,
        tokenCapPerKey: config.dailyTokenCap.gemini,
        tokenCapPerKeyList: config.dailyTokenCapPerKey.gemini,
        tokenLimitType: 'requests_tpm',
        tokenLimitLabel: 'Batas per model/proyek belum terverifikasi; bukan kuota tak terbatas',
        resetCycle: 'Mengikuti kuota upstream',
        contextWindow: 'Belum terverifikasi per model',
        primaryModel: config.models.geminiPrimary,
        backupModel: config.models.geminiBackup.join(' / '),
        allModels: modelCatalog.filter((m) => m.provider === 'gemini').map((m) => m.model),
      },
    ];

    const pools = providerDefs.map((p) => {
      const publicAccess = p.kind === 'opencode';
      const keys = publicAccess ? ['public'] : p.keys;
      const cached = cacheKeys[p.kind] ? getCachedLimits(cacheKeys[p.kind]) : null;
      const cacheTtl = p.kind === 'groq' ? 6 * 3600000 : 30 * 60000;
      const cacheFresh = !!cached && now.getTime() - cached.at < cacheTtl;
      const usageFresh = cacheFresh && new Date(cached!.at).toISOString().slice(0, 10) === todayStr;
      const pStats = providerTokenStats[p.kind];
      const keysDetail = keys.map((key) => {
        const hash = crypto.createHash('sha256').update(key).digest('hex').slice(0, 12);
        const hashes = [hash, key.slice(-4)];
        const period = quotaUsage(quotasData, p.kind, hashes);
        const day = quotaUsage(todayQuotasData, p.kind, hashes);
        const upstream = cacheFresh ? liveLimitsMap.get(p.kind)?.get(key) : null;
        const upstreamUsed = usageFresh ? upstream?.requestsUsedToday ?? null : null;
        const upstreamTokens = usageFresh ? upstream?.tokensUsedToday ?? null : null;
        const cap = upstream?.requestsPerDay ?? null;
        const isNeuron = p.kind === 'cloudflare';
        const tokenCap = isNeuron ? NEURON_HARIAN_GRATIS : upstream?.tokensPerDay ?? null;
        const tokensUsed = isNeuron && day.tokens !== null
          ? hitungNeuron(Math.round(day.tokens * 0.99), Math.round(day.tokens * 0.01), p.primaryModel)
          : day.tokens;
        const percent = cap && cap > 0 ? Math.min(100, Math.round(day.used / cap * 100)) : null;
        const tokenPercent = tokenCap && tokenCap > 0 && tokensUsed !== null ? Math.min(100, Math.round(tokensUsed / tokenCap * 100)) : null;
        const cd = cooldownAktif.get(p.kind + ':' + hash) || cooldownAktif.get(p.kind + ':' + key.slice(-4));
        const quotaBlocked = cd && ['neuron', 'rpd', 'quota', 'tpd'].includes(cd.alasan);
        const bindingPercent = cd ? null : percent === null && tokenPercent === null ? null : Math.max(percent ?? 0, tokenPercent ?? 0);
        const upstreamRemaining = usageFresh ? upstream?.requestsRemaining ?? null : null;
        const status = cd ? (quotaBlocked ? 'capped' : 'cooldown') : !cooldownAvailable ? 'unknown'
          : upstreamRemaining === 0 ? 'capped'
          : bindingPercent !== null && bindingPercent >= 80 ? 'warning'
          : upstreamUsed !== null && cap !== null ? 'healthy' : 'unknown';
        return {
          suffix: publicAccess ? 'public' : key.slice(-4), publicAccess,
          used: day.used, usedPeriod: period.used, dbUsed: period.used,
          rawTokensToday: day.tokens, recordedTokensToday: day.recorded,
          rawTokensPeriod: period.tokens, recordedTokensPeriod: period.recorded,
          cap, guardCap: p.cap || null, remaining: upstreamRemaining, percent,
          tokensUsed, tokenCap, tokenPercent, bindingPercent,
          bindingMetric: (tokenPercent ?? -1) >= (percent ?? 0) ? 'tokens' : 'calls',
          satuanToken: isNeuron ? 'neuron' : 'token', tokenEstimated: isNeuron,
          isRealTokenData: !isNeuron && day.tokens !== null,
          neuronUsed: isNeuron ? tokensUsed : undefined, neuronCap: isNeuron ? tokenCap : undefined,
          limitSource: upstream?.source ?? (isNeuron ? 'Dokumentasi Cloudflare' : 'Belum terverifikasi'),
          limitIsLive: !!upstream?.isLive, officialLimitLabel: upstream?.officialLabel ?? null,
          tokensPerMinute: upstream?.tokensPerMinute ?? null,
          usageSource: 'bot', isLiveSynced: false,
          upstreamRequestsUsed: upstreamUsed, upstreamTokensUsed: upstreamTokens,
          upstreamTokensRemaining: usageFresh ? upstream?.tokensRemaining ?? null : null,
          upstreamCheckedAt: cached ? new Date(cached.at).toISOString() : null, upstreamStale: !usageFresh,
          status, cooldownAlasan: cd?.alasan ?? null, cooldownSampai: cd?.until ?? null,
        };
      });
      const sumKnown = (field: 'rawTokensToday' | 'rawTokensPeriod' | 'tokensUsed') => keysDetail.every((k) => k[field] !== null)
        ? keysDetail.reduce((sum, k) => sum + (k[field] ?? 0), 0) : null;
      const usedToday = keysDetail.reduce((sum, k) => sum + k.used, 0);
      const usedPeriod = keysDetail.reduce((sum, k) => sum + k.usedPeriod, 0);
      const totalTokenCap = keysDetail.length && keysDetail.every((k) => k.tokenCap !== null)
        ? keysDetail.reduce((sum, k) => sum + (k.tokenCap ?? 0), 0) : null;
      return {
        kind: p.kind, tier: modelCatalog.find((m) => m.provider === p.kind)?.tier,
        displayName: p.displayName, primaryModel: p.primaryModel, backupModel: p.backupModel, allModels: p.allModels,
        endpoint: publicAccess ? 'opencode.ai/inference/v1' : null, publicAccess,
        keyCount: publicAccess ? 0 : keys.length, accessCount: keys.length,
        usedToday, usedTodayDaily: usedToday, usedPeriod,
        repliesPeriod: pStats?.totalCalls ?? 0, recordedReplyTokensPeriod: pStats?.realTokens ?? 0,
        rawTokensToday: sumKnown('rawTokensToday'), rawTokensPeriod: sumKnown('rawTokensPeriod'),
        recordedTokensToday: keysDetail.reduce((sum, k) => sum + k.recordedTokensToday, 0),
        recordedTokensPeriod: keysDetail.reduce((sum, k) => sum + k.recordedTokensPeriod, 0),
        totalTokensUsed: sumKnown('tokensUsed'), totalTokenCap,
        satuanToken: p.kind === 'cloudflare' ? 'neuron' : 'token', tokenEstimated: p.kind === 'cloudflare',
        tokenLimitLabel: p.tokenLimitLabel, resetCycle: p.resetCycle,
        lastUsedAt: lastUsedByProvider[p.kind] || null,
        cappedKeys: keysDetail.filter((k) => k.status === 'capped' || k.status === 'cooldown').length,
        keys: keysDetail,
      };
    });
    const totalPoolKeys = pools.reduce((sum, p) => sum + p.keyCount, 0);
    const totalCallsPeriod = pools.reduce((sum, p) => sum + p.usedPeriod, 0);
    const totalCallsToday = pools.reduce((sum, p) => sum + p.usedToday, 0);
    const totalRecordedTokensPeriod = pools.reduce((sum, p) => sum + p.recordedTokensPeriod, 0);
    const totalRecordedTokensToday = pools.reduce((sum, p) => sum + p.recordedTokensToday, 0);
    const tokensPeriodComplete = pools.every((p) => p.rawTokensPeriod !== null);
    const tokensTodayComplete = pools.every((p) => p.rawTokensToday !== null);

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
      serverTime: new Date().toISOString(),
      period: { start: startDateIso, end: now.toISOString(), timeZone: 'UTC' },
      quotaDay: todayStr, quotaTimeZone: 'UTC', quotaPlatform: 'all',
      dataTruncated, cooldownAvailable, refreshIntervalMs: 5000,
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
        totalMessagesToday: range === 'today' ? totalMessagesPeriod : null,
        whatsappPeriod: waPeriod ?? 0,
        whatsappToday: range === 'today' ? waPeriod : null,
        telegramPeriod: telePeriod ?? 0,
        telegramToday: range === 'today' ? telePeriod : null,
        totalKeys: totalPoolKeys,
        totalCallsPeriod,
        totalCallsToday,
        totalTokensPeriod: tokensPeriodComplete ? totalRecordedTokensPeriod : null,
        totalTokensToday: tokensTodayComplete ? totalRecordedTokensToday : null,
        recordedTokensPeriod: totalRecordedTokensPeriod, recordedTokensToday: totalRecordedTokensToday,
        totalRepliesPeriod: totalModelCalls, quotaPlatform: 'all',
        publicAccessCount: pools.filter((p) => p.publicAccess).length,
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
      modelCatalog,
      activeModel: latestActiveModel,
      recentModels: recentModelOrder,
      modelsBreakdown,
      mediaCounts,
      version: APP_VERSION,
      webSearch: {
        mode: 'public-engines', keysTotal: 0, quotaApplicable: false,
        usedToday: null, remainingToday: null, capTotal: null, capPerKey: null,
        usedSource: 'unmeasured', availability: 'unverified',
        note: 'Mesin pencari publik tanpa API key. Jumlah pencarian dan ketersediaan upstream belum diukur; pembatasan layanan tetap dapat berlaku.',
      },
    });
  } catch (err) {
    console.error('[api/stats] Gagal mengumpulkan metrik:', err);
    res.status(500).json({ ok: false, error: 'Internal Server Error' });
  }
}
