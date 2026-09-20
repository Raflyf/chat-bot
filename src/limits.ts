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
export async function fetchXkiroLimits(keys: string[]): Promise<Map<string, LiveLimit>> {
  const out = new Map<string, LiveLimit>();
  await Promise.all(
    keys.map(async (key) => {
      try {
        const res = await fetch('https://api.xkiro.com/v1/usage', {
          headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!res.ok) return;
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
export async function fetchOpenRouterLimits(keys: string[]): Promise<Map<string, LiveLimit>> {
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
export async function fetchGroqLimits(keys: string[], model: string): Promise<Map<string, LiveLimit>> {
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
        // Header rate limit tersedia bahkan saat 429 — itulah sumber otoritatifnya.
        let rpd = numOrNull(res.headers.get('x-ratelimit-limit-requests'));
        let tpm = numOrNull(res.headers.get('x-ratelimit-limit-tokens'));
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
        // PENTING: header `x-ratelimit-remaining-*` Groq merujuk JENDELA PENDEK
        // (per menit), BUKAN sisa harian. Memakainya sebagai "sisa harian" menghasilkan
        // angka palsu (temuan: sisa tampil 39.930 padahal kuota harian masih penuh).
        // Karena itu remaining TIDAK diisi dari header ini.
        if (rpd === null && tpm === null) return;
        out.set(key, {
          requestsPerDay: rpd,
          // TPD & RPM dari CONSOLE GROQ (sumber: console.groq.com, dikonfirmasi user).
          // AUDIT: endpoint API Groq TIDAK menyatakan TPD di header mana pun (sudah dicek
          // semua header terkait "day/daily/tpd" = tidak ada). Jadi angka ini bersumber
          // dari console resmi Groq, BUKAN dari endpoint — ditandai di `source`.
          tokensPerDay: 200000,
          tokensPerMinute: tpm,
          requestsUsedToday: null,
          tokensUsedToday: null,
          requestsRemaining: null,
          tokensRemaining: null,
          // Label lengkap sesuai console Groq: 30 RPM • 8K TPM • 1K RPD • 200K TPD
          officialLabel:
            rpd !== null && tpm !== null
              ? `30 RPM • ${tpm.toLocaleString('id-ID')} TPM • ${rpd.toLocaleString('id-ID')} RPD • 200.000 TPD (console Groq)`
              : rpd !== null
              ? `${rpd.toLocaleString('id-ID')} RPD • 200.000 TPD (console Groq)`
              : `${(tpm ?? 0).toLocaleString('id-ID')} TPM (console Groq)`,
          // Sumber gabungan: RPD & TPM dari header endpoint (terverifikasi), TPD dari
          // console resmi Groq (endpoint tidak menyatakannya).
          source: 'api.groq.com header x-ratelimit-* (RPD, TPM) + console.groq.com (TPD)',
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
export async function fetchCloudflareLimits(
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
          officialLabel:
            quota !== null
              ? `Rate limit ${quota.toLocaleString('id-ID')} req/${windowLabel} • 10.000 Neuron/hari (dokumentasi)`
              : 'Rate limit per jendela • 10.000 Neuron/hari (dokumentasi)',
          source: 'api.cloudflare.com header ratelimit-policy (rate limit)',
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
 * Dahl: halaman resmi menyatakan "First 100M tokens free"; tidak ada endpoint JSON
 * untuk sisa saldo. Ditandai isLive: false agar tidak mengklaim lebih dari yang diketahui.
 */
export function dahlDocumentedLimits(): LiveLimit {
  return {
    // SUMBER VALID (dashboard akun Dahl, dikonfirmasi user 20 Sep 2026):
    //   "On keys: 100.0M   Total: 100.0M"  -> saldo akun 100 juta token
    //   key "chatbot" (dahl_Kiv...YNRcXK = key #10 di pool) -> kuota "100M/100M"
    //   "Tokens are charged only for successful responses. Errors such as 429, 402,
    //    and technical failures do not consume your balance."
    //
    // Kesimpulan dari sumber resmi ini:
    // 1. Kuota 100M token per key TERKONFIRMASI (bukan asumsi).
    // 2. Model billing Dahl = SALDO TOKEN (pool), BUKAN rate limit harian ->
    //    karena itu RPD memang tidak berlaku (bukan "tidak diketahui").
    // 3. Endpoint API tidak mengekspos sisa saldo (audit: /v1/usage, /v1/me,
    //    /v1/credits, /v1/balance, /v1/account = HTML/401) -> sisa saldo hanya
    //    bisa dilihat di dashboard akun.
    // 4. DIUJI EMPIRIS: ke-10 key Dahl di pool SEMUANYA bisa inference (HTTP 200),
    //    jadi tidak ada key tanpa saldo — tidak perlu ada penanganan khusus.
    requestsPerDay: null,
    tokensPerDay: 100_000_000,
    tokensPerMinute: null,
    requestsUsedToday: null,
    tokensUsedToday: null,
    requestsRemaining: null,
    tokensRemaining: null,
    officialLabel: 'Saldo 100M Token/key (dashboard akun Dahl) • tanpa batas RPD',
    source: 'dashboard akun inference.dahl.global/account — saldo token, bukan rate limit harian',
    isLive: false,
  };
}
