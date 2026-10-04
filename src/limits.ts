/**
 * Batas kuota LIVE dari endpoint resmi tiap provider.
 *
 * Kenapa modul ini ada: sebelumnya limit di-hardcode di .env dan TERBUKTI SALAH
 * untuk beberapa provider (temuan audit v0.49):
 *   - OpenRouter: hardcode 180 RPD, endpoint bilang free_model_daily_requests = 50/hari
 *   - Cloudflare: hardcode 120 RPD, endpoint bilang 1200 req / 300 detik (rate limit)
 *   - Groq: hardcode 200K TPD, endpoint bilang limit-tokens 8000 (itu TPM, bukan TPD)
 *   - xKiro: hardcode 500K seragam, endpoint bilang 1jt/500K/500K per key
 *
 * Modul ini mengambil angka dari sumber otoritatif dan mengembalikan hasil + sumbernya,
 * sehingga dashboard menampilkan limit yang VALID dan bisa diaudit (bukan asumsi).
 */

export interface LiveLimit {
  /** Batas request harian per key (null = tidak dibatasi / tidak diketahui). */
  requestsPerDay: number | null;
  /** Batas token harian per key (null = tidak dibatasi / tidak diketahui). */
  tokensPerDay: number | null;
  /** Batas token per menit (TPM) bila endpoint menyatakannya. */
  tokensPerMinute: number | null;
  /** Pemakaian request hari ini (bila endpoint menyatakannya). */
  requestsUsedToday: number | null;
  /** Pemakaian token hari ini (bila endpoint menyatakannya). */
  tokensUsedToday: number | null;
  /** Sisa kuota request (bila endpoint menyatakannya). */
  requestsRemaining: number | null;
  /** Sisa kuota token (bila endpoint menyatakannya). */
  tokensRemaining: number | null;
  /** Label resmi dari provider (untuk ditampilkan apa adanya). */
  officialLabel: string;
  /** Dari mana angka ini diambil — agar dashboard bisa menampilkan sumbernya. */
  source: string;
  /** True bila data berasal dari endpoint live; false bila fallback dokumentasi. */
  isLive: boolean;
}

const TIMEOUT_MS = 6000;

function numOrNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * xKiro Gateway: GET /v1/usage per key.
 * Mengembalikan limit & pemakaian PER-KEY (tiap key bisa berbeda limitnya).
 */
async function fetchXkiroLimitsUncached(keys: string[]): Promise<Map<string, LiveLimit>> {
  const out = new Map<string, LiveLimit>();
  await Promise.all(
    keys.map(async (key) => {
      try {
        const res = await fetch('https://api.xkiro.com/v1/usage', {
          headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        // KOREKSI AUDIT (04 Okt): sebelumnya `if (!res.ok) return;` membuat key yang
        // AKUN-NYA DISUSPEND tampak "tidak ada data" — dashboard lalu menampilkan
        // fallback .env seolah sehat, padahal provider itu MATI TOTAL.
        // Terverifikasi live: GET /v1/usage -> 403 account_suspended
        // ("operating multiple accounts to get around free-tier limits").
        // Sekarang kondisi gagal ditampilkan jujur di dashboard.
        if (!res.ok) {
          let alasan = `HTTP ${res.status}`;
          try {
            const e = (await res.json()) as { error?: { code?: string; message?: string } };
            if (e.error?.code) alasan = e.error.code;
            if (e.error?.message) alasan += ` — ${e.error.message.slice(0, 120)}`;
          } catch {
            // biarkan alasan = HTTP <status>
          }
          out.set(key, {
            requestsPerDay: null,
            tokensPerDay: null,
            tokensPerMinute: null,
            requestsUsedToday: null,
            tokensUsedToday: null,
            requestsRemaining: null,
            tokensRemaining: null,
            officialLabel: `TIDAK AKTIF: ${alasan}`,
            source: 'api.xkiro.com/v1/usage (gagal)',
            isLive: true,
          });
          return;
        }
        const j = (await res.json()) as {
          free_tokens?: { used_today?: number; limit_per_day?: number; remaining?: number };
        };
        const used = numOrNull(j.free_tokens?.used_today);
        const limit = numOrNull(j.free_tokens?.limit_per_day);
        const remaining = numOrNull(j.free_tokens?.remaining);
        out.set(key, {
          requestsPerDay: null,
          tokensPerDay: limit,
          tokensPerMinute: null,
          requestsUsedToday: null,
          tokensUsedToday: used,
          requestsRemaining: null,
          tokensRemaining: remaining,
          officialLabel: limit !== null ? `${limit.toLocaleString('id-ID')} Token/hari` : 'Kuota token harian',
          source: 'api.xkiro.com/v1/usage',
          isLive: true,
        });
      } catch {
        // biarkan kosong -> dashboard pakai fallback .env
      }
    }),
  );
  return out;
}

/**
 * OpenRouter: GET /auth/key.
 * Field penting: `free_model_daily_requests` = { used, limit, remaining } untuk model :free.
 * Ini batas NYATA untuk rute gratis (bukan angka RPD generik).
 */
async function fetchOpenRouterLimitsUncached(keys: string[]): Promise<Map<string, LiveLimit>> {
  const out = new Map<string, LiveLimit>();
  await Promise.all(
    keys.map(async (key) => {
      try {
        const res = await fetch('https://openrouter.ai/api/v1/auth/key', {
          headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!res.ok) return;
        const j = (await res.json()) as {
          data?: {
            free_model_daily_requests?: { used?: number; limit?: number; remaining?: number };
            usage?: number;
            usage_daily?: number;
            is_free_tier?: boolean;
          };
        };
        const fm = j.data?.free_model_daily_requests;
        const limit = numOrNull(fm?.limit);
        const used = numOrNull(fm?.used);
        const remaining = numOrNull(fm?.remaining);
        out.set(key, {
          requestsPerDay: limit,
          tokensPerDay: null,
          tokensPerMinute: null,
          requestsUsedToday: used,
          tokensUsedToday: null,
          requestsRemaining: remaining,
          tokensRemaining: null,
          officialLabel:
            limit !== null ? `${limit.toLocaleString('id-ID')} request model :free/hari` : 'Model :free (rate limit per menit)',
          source: 'openrouter.ai/api/v1/auth/key → free_model_daily_requests',
          isLive: true,
        });
      } catch {
        // fallback .env
      }
    }),
  );
  return out;
}

/**
 * Groq: header rate limit dari response chat completions.
 * Header menyatakan `x-ratelimit-limit-requests` (RPD) dan `x-ratelimit-limit-tokens`
 * (TPM — token per MENIT, bukan per hari). Ini penting: label lama "200K TPD" salah konsep.
 */
async function fetchGroqLimitsUncached(keys: string[], model: string): Promise<Map<string, LiveLimit>> {
  const out = new Map<string, LiveLimit>();
  await Promise.all(
    keys.map(async (key) => {
      try {
        const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, messages: [{ role: 'user', content: 'hi' }], max_tokens: 1 }),
          signal: AbortSignal.timeout(15000),
        });
        // KOREKSI AUDIT (04 Okt, diverifikasi ke endpoint nyata):
        // Header rate limit Groq TERSEDIA JUGA saat status 200 — bukan hanya 429.
        // Diukur live: x-ratelimit-limit-requests=1000, limit-tokens=8000,
        // remaining-requests=999, remaining-tokens=7986. Komentar lama
        // ("header hanya muncul saat 429") SALAH dan membuat dashboard kehilangan
        // data sisa kuota yang sebenarnya tersedia.
        let rpd = numOrNull(res.headers.get('x-ratelimit-limit-requests'));
        let tpm = numOrNull(res.headers.get('x-ratelimit-limit-tokens'));
        const rpdRemaining = numOrNull(res.headers.get('x-ratelimit-remaining-requests'));
        const tpmRemaining = numOrNull(res.headers.get('x-ratelimit-remaining-tokens'));
        // Saat 429, pesan error menyebut limit ITPM ASLI model (lebih akurat dari header).
        // Contoh: "on input tokens per minute (ITPM): Limit 7000, Used 4690".
        if (res.status === 429) {
          try {
            const errBody = (await res.json()) as { error?: { message?: string } };
            const msg = errBody.error?.message ?? '';
            const itpm = msg.match(/Limit\s+(\d{3,})/i);
            if (itpm) {
              tpm = Number(itpm[1]);
              rpd = null; // limit yang berlaku adalah ITPM, bukan RPD
            }
          } catch {
            // abaikan
          }
        }
        // PEMISAHAN JENDELA WAKTU (penting agar dashboard tidak menyesatkan):
        //  - x-ratelimit-remaining-requests -> jendela HARIAN (RPD). Valid sebagai sisa harian.
        //  - x-ratelimit-remaining-tokens   -> jendela PER MENIT (TPM), reset ~detik.
        //    Nilai ini TIDAK dipakai sebagai "sisa harian" (itu kesalahan lama yang
        //    menampilkan sisa 39.930 padahal kuota harian penuh). Disimpan apa adanya
        //    sebagai info TPM saja, tidak diklaim sebagai sisa token harian.
        if (rpd === null && tpm === null) return;
        out.set(key, {
          requestsPerDay: rpd,
          // TPD & RPM dari CONSOLE GROQ (sumber: console.groq.com, dikonfirmasi user).
          // AUDIT: endpoint API Groq TIDAK menyatakan TPD di header mana pun (sudah dicek
          // semua header terkait "day/daily/tpd" = tidak ada). Jadi angka ini bersumber
          // dari console resmi Groq, BUKAN dari endpoint — ditandai di `source`.
          tokensPerDay: 200000,
          tokensPerMinute: tpm,
          requestsUsedToday: rpd !== null && rpdRemaining !== null ? Math.max(0, rpd - rpdRemaining) : null,
          tokensUsedToday: null,
          requestsRemaining: rpdRemaining,
          tokensRemaining: null,
          // Label lengkap sesuai console Groq: 30 RPM • 8K TPM • 1K RPD • 200K TPD
          officialLabel:
            rpd !== null && tpm !== null
              ? `${tpm.toLocaleString('id-ID')} TPM • ${rpd.toLocaleString('id-ID')} RPD • 200.000 TPD (console Groq)`
              : rpd !== null
              ? `${rpd.toLocaleString('id-ID')} RPD • 200.000 TPD (console Groq)`
              : `${(tpm ?? 0).toLocaleString('id-ID')} TPM (console Groq)`,
          // Sumber gabungan: RPD & TPM dari header endpoint (terverifikasi), TPD dari
          // console resmi Groq (endpoint tidak menyatakannya).
          source: 'api.groq.com header x-ratelimit-* (RPD, TPM, sisa) + console.groq.com (TPD)',
          isLive: true,
        });
      } catch {
        // fallback .env
      }
    }),
  );
  return out;
}

/**
 * Cloudflare Workers AI: header `ratelimit-policy` dari endpoint API.
 * Format: `"default";q=1200;w=300` -> q = kuota, w = jendela dalam DETIK.
 * Ini rate limit per jendela waktu, BUKAN kuota harian — label lama "120 RPD" salah.
 */
async function fetchCloudflareLimitsUncached(
  keys: string[],
  accountId: string,
): Promise<Map<string, LiveLimit>> {
  const out = new Map<string, LiveLimit>();
  await Promise.all(
    keys.map(async (rawKey) => {
      try {
        const acc = rawKey.includes(':') ? rawKey.split(':')[0].trim() : accountId.trim();
        const token = rawKey.includes(':') ? rawKey.split(':')[1].trim() : rawKey.trim();
        if (!acc) return;
        const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${acc}/ai/models/search?per_page=1`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        const policy = res.headers.get('ratelimit-policy');
        if (!policy) return;
        let quota: number | null = null;
        let windowSec: number | null = null;
        const q = policy.match(/q=(\d+)/);
        const w = policy.match(/w=(\d+)/);
        if (q) quota = Number(q[1]);
        if (w) windowSec = Number(w[1]);
        const windowLabel = windowSec !== null ? (windowSec >= 60 ? `${Math.round(windowSec / 60)} menit` : `${windowSec} detik`) : 'jendela';
        // PENTING: ini RATE LIMIT per jendela (300 detik), BUKAN kuota harian.
        // Tidak diisi ke requestsPerDay agar dashboard tidak mengklaim "120 RPD"
        // (angka .env lama yang terbukti salah). Kuota harian Cloudflare sebenarnya
        // berbasis Neuron (10.000/hari) dari dokumentasi, bukan RPD.
        out.set(rawKey, {
          requestsPerDay: null,
          tokensPerDay: null,
          tokensPerMinute: null,
          requestsUsedToday: null,
          tokensUsedToday: null,
          requestsRemaining: null,
          tokensRemaining: null,
          // JUJUR SOAL DUA BATAS (temuan 04 Okt):
          // Cloudflare punya DUA batas yang berjalan bersamaan:
          //   1. Rate limit per jendela (dari header ratelimit-policy) — 1.200 req/5 menit
          //   2. Kuota NEURON harian — 10.000 neuron/hari (ini yang PALING SERING habis)
          // Kasus nyata: 3 key tampak "51% OPTIMAL" (request) padahal neuron SUDAH
          // habis dan semua request membalas 429 "used up your daily free allocation
          // of 10,000 neurons". Label harus menyebut neuron agar tidak menyesatkan.
          officialLabel:
            quota !== null
              ? `Rate limit ${quota.toLocaleString('id-ID')} req/${windowLabel} • kuota NEURON 10.000/hari (yang biasanya habis lebih dulu)`
              : 'Rate limit per jendela • kuota NEURON 10.000/hari (biasanya habis lebih dulu)',
          source: 'api.cloudflare.com header ratelimit-policy (rate limit) + kuota neuron (dokumentasi resmi)',
          isLive: true,
        });
      } catch {
        // fallback .env
      }
    }),
  );
  return out;
}

/**
 * Gemini: Google tidak menyediakan endpoint publik untuk sisa kuota.
 * Limit resmi diambil dari dokumentasi resmi (rate limits) — ditandai isLive: false
 * agar dashboard jujur bahwa angkanya dari dokumentasi, bukan dari endpoint.
 */
export function geminiDocumentedLimits(): LiveLimit {
  return {
    // AUDIT: endpoint kuota Gemini TIDAK tersedia — sudah diuji /v1beta/models (200),
    // /v1beta/operations (404), /v1beta/quotas (404), /v1beta/rateLimits (404), dan
    // header response tidak memuat info rate/limit/quota sama sekali.
    // Angka dari DOKUMENTASI RESMI Google AI (bukan endpoint) — ditandai isLive:false.
    requestsPerDay: 1500,
    tokensPerDay: null,
    tokensPerMinute: 1_000_000,
    requestsUsedToday: null,
    tokensUsedToday: null,
    requestsRemaining: null,
    tokensRemaining: null,
    officialLabel: '1.500 RPD • 1M TPM (dokumentasi resmi Google)',
    source: 'dokumentasi resmi Google AI — endpoint kuota TIDAK tersedia (diuji 4 kandidat)',
    isLive: false,
  };
}

/**
 * Dahl: AUDIT LIVE 04 Okt — 10/10 key TERVERIFIKASI bisa inference (HTTP 200).
 *
 * Endpoint yang diuji: /v1/usage, /v1/me, /v1/credits, /v1/balance, /v1/quota
 * -> semua mengembalikan HTML (bukan JSON), /v1/account -> 401.
 * Jadi sisa saldo token TIDAK diekspos lewat API — hanya lewat dashboard akun.
 * Karena itu isLive: false (jujur: angka dari dashboard, bukan endpoint).
 */
export function dahlDocumentedLimits(): LiveLimit {
  return {
    // SUMBER VALID (dashboard akun Dahl, dikonfirmasi user 20 Sep 2026):
    //   "On keys: 100.0M   Total: 100.0M"  -> saldo akun 100 juta token
    //   "Tokens are charged only for successful responses. Errors such as 429, 402,
    //    and technical failures do not consume your balance."
    //
    // Kesimpulan dari sumber resmi + audit endpoint:
    // 1. Kuota 100M token per key TERKONFIRMASI (bukan asumsi).
    // 2. Model billing Dahl = SALDO TOKEN (pool), BUKAN rate limit harian ->
    //    karena itu RPD memang tidak berlaku (bukan "tidak diketahui").
    // 3. Endpoint API tidak mengekspos sisa saldo -> sisa hanya di dashboard akun.
    // 4. DIUJI EMPIRIS 04 Okt: ke-10 key Dahl di pool SEMUANYA inference HTTP 200
    //    dengan model deepseek-ai/DeepSeek-V4-Flash-0731 (usage terukur: 148 token).
    //    Jadi tidak ada key tanpa saldo.
    requestsPerDay: null,
    tokensPerDay: 100_000_000,
    tokensPerMinute: null,
    requestsUsedToday: null,
    tokensUsedToday: null,
    requestsRemaining: null,
    tokensRemaining: null,
    officialLabel: 'Saldo 100M Token/key (dashboard akun Dahl) • tanpa batas RPD • 10/10 key aktif',
    source: 'dashboard akun inference.dahl.global/account — saldo token, bukan rate limit harian',
    isLive: false,
  };
}

/**
 * DreamPrompting: AUDIT LIVE 04 Okt — DITEMUKAN endpoint kuota JSON resmi!
 *
 * Endpoint: GET https://dreamprompting.com/api/v1/quota
 * Respons terverifikasi (bukan asumsi):
 *   {
 *     "daily_quota": {
 *       "allowed": false,
 *       "limit": 5000, "remaining": 4907, "used": 93,      <- REQUEST
 *       "scope": "account",
 *       "tokens": { "limit": 500000, "remaining": 0, "used": 504797 }  <- TOKEN
 *     },
 *     "key": "Default",
 *     "limits": { "max_input_tokens_per_request": 32000, "max_tokens_per_response": 8192 },
 *     "rate_limit": { "limit": 100, "remaining": 100, "reset_seconds": 0 }
 *   }
 *
 * Fakta penting:
 *   - Kuota berlaku per AKUN ("scope": "account"), bukan per key.
 *   - Dua batas berjalan bersamaan: 5.000 REQUEST/hari DAN 500.000 TOKEN/hari.
 *   - Ada rate limit 100 request/menit.
 *   - Sisa kuota BISA dibaca live dari endpoint ini (sebelumnya disangka tidak bisa).
 */
async function fetchDreamPromptingLimitsUncached(keys: string[]): Promise<Map<string, LiveLimit>> {
  const out = new Map<string, LiveLimit>();
  await Promise.all(
    keys.map(async (key) => {
      try {
        const res = await fetch('https://dreamprompting.com/api/v1/quota', {
          headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!res.ok) {
          out.set(key, {
            requestsPerDay: null, tokensPerDay: null, tokensPerMinute: null,
            requestsUsedToday: null, tokensUsedToday: null,
            requestsRemaining: null, tokensRemaining: null,
            officialLabel: `TIDAK AKTIF: HTTP ${res.status}`,
            source: 'dreamprompting.com/api/v1/quota (gagal)',
            isLive: true,
          });
          return;
        }
        const j = (await res.json()) as {
          daily_quota?: {
            limit?: number; remaining?: number; used?: number;
            scope?: string;
            requests?: { limit?: number; remaining?: number; used?: number };
            tokens?: { limit?: number; remaining?: number; used?: number };
          };
          rate_limit?: { limit?: number; remaining?: number };
          limits?: { max_input_tokens_per_request?: number; max_tokens_per_response?: number };
        };
        const dq = j.daily_quota || {};
        const req = dq.requests || {};
        const tok = dq.tokens || {};
        const rl = j.rate_limit || {};
        const scope = dq.scope === 'account' ? 'akun' : (dq.scope || 'key');

        const reqLimit = numOrNull(req.limit);
        const reqUsed = numOrNull(req.used);
        const reqRemaining = numOrNull(req.remaining);
        const tokLimit = numOrNull(tok.limit);
        const tokUsed = numOrNull(tok.used);
        const tokRemaining = numOrNull(tok.remaining);

        // Label ringkas namun lengkap — semua angka dari endpoint.
        const bagian: string[] = [];
        if (reqLimit !== null) bagian.push(`${reqLimit.toLocaleString('id-ID')} req/hari (sisa ${reqRemaining?.toLocaleString('id-ID') ?? '?'})`);
        if (tokLimit !== null) bagian.push(`${tokLimit.toLocaleString('id-ID')} token/hari (sisa ${tokRemaining?.toLocaleString('id-ID') ?? '?'})`);
        if (rl.limit !== null && rl.limit !== undefined) bagian.push(`${rl.limit} req/menit`);
        const maks = j.limits?.max_input_tokens_per_request;
        if (maks) bagian.push(`maks ${maks.toLocaleString('id-ID')} token input/request`);

        out.set(key, {
          requestsPerDay: reqLimit,
          tokensPerDay: tokLimit,
          tokensPerMinute: rl.limit ?? null,
          requestsUsedToday: reqUsed,
          tokensUsedToday: tokUsed,
          requestsRemaining: reqRemaining,
          tokensRemaining: tokRemaining,
          officialLabel: `[${scope}] ${bagian.join(' • ')}`,
          source: 'dreamprompting.com/api/v1/quota (endpoint resmi)',
          isLive: true,
        });
      } catch {
        // biarkan kosong -> dashboard pakai fallback dokumentasi
      }
    }),
  );
  return out;
}

/**
 * DreamPrompting: fallback dokumentasi bila endpoint kuota gagal.
 *
 * Batas terverifikasi: 500.000 token/24 jam (dijumlah semua key, scope akun)
 * dan 5.000 request/hari. Sumber: respons /api/v1/quota + pesan 429.
 */
export function dreampromptingDocumentedLimits(): LiveLimit {
  return {
    requestsPerDay: 5000,
    tokensPerDay: 500_000,
    tokensPerMinute: 100,
    requestsUsedToday: null,
    tokensUsedToday: null,
    requestsRemaining: null,
    tokensRemaining: null,
    officialLabel: '5.000 req/hari • 500.000 token/hari • 100 req/menit (scope akun)',
    source: 'dreamprompting.com/api/v1/quota (fallback dokumentasi)',
    isLive: false,
  };
}

/**
 * NVIDIA NIM: 1.000 Free Credits per key untuk inferensi model akselerasi NIM.
 */
export function nvidiaDocumentedLimits(): LiveLimit {
  return {
    requestsPerDay: 1000,
    tokensPerDay: null,
    tokensPerMinute: null,
    requestsUsedToday: null,
    tokensUsedToday: null,
    requestsRemaining: null,
    tokensRemaining: null,
    officialLabel: '1.000 Free Credits / Key (NVIDIA NIM)',
    source: 'dokumentasi resmi NVIDIA NIM integrate.api.nvidia.com',
    isLive: false,
  };
}

// ============================================================================
// CACHE HASIL PROBE LIMIT (temuan audit v0.79 — F3)
// ============================================================================
//
// MASALAH YANG DIPERBAIKI: `fetchGroqLimits` mengirim CHAT COMPLETION NYATA
// (`messages: [{role:'user',content:'hi'}]`, max_tokens 1) ke setiap key Groq untuk
// membaca header rate limit. `api/stats.ts` memanggilnya TANPA CACHE setiap kali
// dashboard di-refresh (setiap 15 detik), sehingga:
//   - 5 key Groq x 4 refresh/menit = 20 request/menit terbuang ke kuota Groq
//   - dashboard dibuka 10 menit = 200 request terbuang -> RPD Groq (1.000/key)
//     habis lebih cepat dari perkiraan guard -> bot kena 429 lebih awal.
// Ini bertentangan langsung dengan tujuan "optimasi token agar Groq tetap terpakai".
// Tiga probe lain (xKiro/OpenRouter/Cloudflare) memakai endpoint read-only sehingga
// tidak membakar kuota, tapi tetap di-cache agar latensi dashboard turun.
//
// TTL: Groq 30 menit (mahal — membakar kuota nyata), lainnya 5 menit (gratis).
// Cache in-memory per instance serverless; instance dingin probe sekali lagi, yang
// tetap jauh lebih hemat daripada probe tiap refresh dashboard.
const LIMIT_CACHE_TTL_MS: Record<string, number> = {
  groq: 30 * 60 * 1000,
  xkiro: 5 * 60 * 1000,
  openrouter: 5 * 60 * 1000,
  cloudflare: 5 * 60 * 1000,
  // DreamPrompting: endpoint kuota gratis & ringan -> 5 menit.
  dreamprompting: 5 * 60 * 1000,
};

interface LimitCacheEntry {
  at: number;
  data: Map<string, LiveLimit>;
}

const limitCache = new Map<string, LimitCacheEntry>();

/** Ambil dari cache bila masih segar; `probe` dijalankan hanya saat cache kosong/basi. */
async function withLimitCache(
  kind: string,
  cacheKey: string,
  probe: () => Promise<Map<string, LiveLimit>>,
): Promise<Map<string, LiveLimit>> {
  const ttl = LIMIT_CACHE_TTL_MS[kind] ?? 5 * 60 * 1000;
  const hit = limitCache.get(cacheKey);
  if (hit && Date.now() - hit.at < ttl) return hit.data;
  const data = await probe();
  // Simpan hanya bila probe mengembalikan isi — kegagalan sementara jangan di-cache
  // (kalau tidak, dashboard menampilkan "tidak diketahui" selama TTL penuh).
  if (data.size > 0) limitCache.set(cacheKey, { at: Date.now(), data });
  return data;
}

/** Bersihkan cache (untuk pengujian / saat key berubah). */
export function clearLimitCache(): void {
  limitCache.clear();
}

// ---------------------------------------------------------------------------
// Pembungkus publik: tiap fungsi probe WAJIB lewat cache (temuan F3).
// Signature dipertahankan agar pemanggil (api/stats.ts) tidak perlu diubah.
// ---------------------------------------------------------------------------
export async function fetchXkiroLimits(keys: string[]): Promise<Map<string, LiveLimit>> {
  return withLimitCache('xkiro', `xkiro:${keys.length}`, () => fetchXkiroLimitsUncached(keys));
}

export async function fetchOpenRouterLimits(keys: string[]): Promise<Map<string, LiveLimit>> {
  return withLimitCache('openrouter', `openrouter:${keys.length}`, () => fetchOpenRouterLimitsUncached(keys));
}

export async function fetchGroqLimits(keys: string[], model: string): Promise<Map<string, LiveLimit>> {
  return withLimitCache('groq', `groq:${keys.length}:${model}`, () => fetchGroqLimitsUncached(keys, model));
}

export async function fetchCloudflareLimits(
  keys: string[],
  accountId: string,
): Promise<Map<string, LiveLimit>> {
  return withLimitCache('cloudflare', `cloudflare:${keys.length}:${accountId}`, () =>
    fetchCloudflareLimitsUncached(keys, accountId),
  );
}


/**
 * DreamPrompting: pembungkus publik dengan cache (5 menit).
 * Endpoint /api/v1/quota mengembalikan limit + sisa request & token.
 */
export async function fetchDreamPromptingLimits(keys: string[]): Promise<Map<string, LiveLimit>> {
  return withLimitCache('dreamprompting', `dreamprompting:${keys.length}`, () => fetchDreamPromptingLimitsUncached(keys));
}