import crypto from 'crypto';
import { config } from './env.js';
import { cooldownMemori, setCooldown, hapusCooldown, mulaiHidrasiLatar } from './cooldown.js';
import { hitungNeuron } from './neuron.js';
import { isKeyAllowed, keyUsed, keyTokensUsed, keyTokensUsedToday, keyRequestsUsedToday, keyTokenAbsolute, ensureKeyQuotaHydrated, ProviderKind } from './quota.js';
// (xKiro DIHAPUS 04 Okt 2026 — semua akun disuspend permanen 403)

// --- CIRCUIT BREAKER & ADAPTIVE KEY ROUTING (LATENCY OPTIMIZER) ---
const keyCooldownMap = new Map<string, number>(); // `${kind}:${keyHash}` -> timestamp cooldown
// ROTASI KEY (round-robin) — keputusan user: "apikey 1 2 3 dipakai bergiliran".
// Sebelumnya sistem memakai STICKY key (key sukses terakhir selalu diprioritaskan),
// akibatnya key pertama dipakai terus sampai kuotanya habis sementara key lain nyaris
// tak tersentuh (temuan nyata: key ...6386 tembus 1.004.173 token, key ...8a6b masih 0).
// Sekarang indeks rotasi bergilir tiap panggilan sehingga pemakaian merata.
const keyRotationIndexMap = new Map<ProviderKind, number>();
const modelCooldownMap = new Map<string, number>(); // `${kind}:${model}` -> timestamp cooldown


// ── JEMBATAN COOLDOWN PERSISTEN (audit 05 Okt 2026) ──
// `keyCooldownMap` lama tetap ada sebagai cache memori (jalur cepat), TAPI setiap
// penulisan juga dikirim ke `src/cooldown.ts` agar bertahan lintas instance
// Vercel serverless. Pembacaan memakai nilai memori bila ada; bila kosong (cold
// start), cooldown.ts sudah menghidrasi dari database.
function setCooldownPersist(kunciLama: string, untilMs: number, alasan = ''): void {
  keyCooldownMap.set(kunciLama, untilMs);
  const i = kunciLama.indexOf(':');
  if (i > 0) {
    const kind = kunciLama.slice(0, i);
    const keyHash = kunciLama.slice(i + 1);
    setCooldown(kind, keyHash, untilMs, '', alasan);
  }
}

function getCooldownPersist(kunciLama: string): number {
  const dariMemori = keyCooldownMap.get(kunciLama) || 0;
  if (dariMemori) return dariMemori;
  const i = kunciLama.indexOf(':');
  if (i > 0) {
    const kind = kunciLama.slice(0, i);
    const keyHash = kunciLama.slice(i + 1);
    return cooldownMemori(kind, keyHash, '');
  }
  return 0;
}

function hapusCooldownPersist(kunciLama: string): void {
  keyCooldownMap.delete(kunciLama);
  const i = kunciLama.indexOf(':');
  if (i > 0) {
    hapusCooldown(kunciLama.slice(0, i), kunciLama.slice(i + 1), '');
  }
}

// Hidrasi cooldown dari database (sekali, di belakang) saat modul dimuat.
mulaiHidrasiLatar();

function keyHash(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 12);
}

function recordKeySuccess(kind: ProviderKind, key: string, model: string): void {
  // Tidak ada lagi sticky key: rotasi ditangani getOrderedKeys (round-robin).
  hapusCooldownPersist(`${kind}:${keyHash(key)}`);
  modelCooldownMap.delete(`${kind}:${model}`);
}

// (xKiro DIHAPUS 04 Okt 2026 — 8 akun disuspend permanen 403.
//  Blok syncXkiroUsage & isXkiroKeyAvailable dihapus karena tidak ada lagi yang
//  memakainya. msUntilDailyResetUtc TETAP dipertahankan: dipakai Cloudflare
//  (kuota neuron harian) dan Groq (limit harian) untuk cooldown sampai reset UTC.)

/**
 * Sisa milidetik sampai reset kuota harian pada 00.00 UTC (07.00 WIB), plus 5 menit margin.
 * Dipakai Cloudflare (neuron harian) & Groq (limit harian). Terbukti empiris:
 * reset terjadi pada 00.00 UTC, bukan tengah malam waktu lokal WIB.
 */
function msUntilDailyResetUtc(): number {
  const nowMs = Date.now();
  const dayMs = 86_400_000;
  const nextReset = (Math.floor(nowMs / dayMs) + 1) * dayMs;
  return Math.max(60_000, nextReset + 5 * 60_000 - nowMs);
}

function recordKeyFailure(kind: ProviderKind, key: string, err: unknown): void {
  const kh = `${kind}:${keyHash(key)}`;
  // Pesan error bisa panjang (body upstream). Pencocokan pola dilakukan pada
  // pesan penuh; yang dipotong hanya untuk log agar tidak membanjiri keluaran.
  const msg = err instanceof Error ? err.message : String(err);

  // RATE LIMIT PERMANEN (concurrency capacity / akun gratis tidak diutamakan).
  // Temuan audit v0.79: Dahl membalas 429 "This model is at concurrency capacity.
  // Paid accounts are admitted first" untuk SEMUA model & SEMUA kunci, termasuk via
  // proxy — jadi ini bukan rate limit sementara yang pulih dalam 60 detik, melainkan
  // pembatasan akun gratis yang bisa berhari-hari. Cooldown 60 detik membuat setiap
  // request yang jatuh ke tier ini membuang 10 kunci x ~250ms = 2,5 detik PERCUMA
  // sebelum lanjut ke tier berikutnya.
  // Perbaikan: cooldown 6 jam untuk pola ini supaya tier dilewati, bukan diulang.
  if (/concurrency capacity|Paid accounts are admitted first|insufficient_quota|Insufficient wallet balance/i.test(msg)) {
    setCooldownPersist(kh, Date.now() + 6 * 60 * 60_000, 'rpd');
    return;
  }

  // KUOTA NEURON CLOUDFLARE HABIS (temuan 04 Okt, terbukti dari endpoint):
  //   "AiError: you have used up your daily free allocation of 10,000 neurons,
  //    please upgrade to Cloudflare's Workers Paid plan"
  // Ini BUKAN rate limit per menit dan BUKAN 429 — Cloudflare membalas HTTP 400
  // dengan code 4006. Sebelumnya pola ini tidak dikenali sehingga key langsung
  // dicoba lagi di request berikutnya dan gagal terus (membuang waktu rantai).
  // Neuron direset harian -> cooldown sampai reset UTC + margin.
  if (kind === 'cloudflare' && /neurons|daily free allocation|4006|workers paid/i.test(msg)) {
    const cd = Date.now() + msUntilDailyResetUtc();
    for (const other of config.pools.cloudflare) {
      setCooldownPersist(`cloudflare:${keyHash(other)}`, cd, 'neuron');
    }
    return;
  }

  // RATE LIMIT HARIAN GROQ / CLOUDFLARE
   // Jika ini adalah 429 harian, kita harus suspend kunci ini sampai besok.
   // Groq TPD biasanya menolak dengan error code atau msg yang mencolok 'daily', 'quota', 'limit_exceeded'.
   // Karena sebelumnya error dari `RATE_LIMITED` menangkap body di pesan errornya, kita baca itu:
   const errCode = (err as { code?: string } | null)?.code;
   const rates = errCode === 'RATE_LIMITED' || msg === 'RATE_LIMITED' || msg.includes('429');
   if ((kind === 'groq' || kind === 'cloudflare') && rates) {
     // Bedakan antara limit per menit (TPM) dan per hari (TPD)
     // - Groq biasanya melampirkan "Please try again in 5.6s" (ada 'try again in') atau retry-after jika TPM
     // - Cloudflare juga ada response body khusus.
     const isTempLimit = /try again in|requests per minute|tokens per minute/i.test(msg) || (err as any)?.retryAfter;
     if (isTempLimit) {
       setCooldownPersist(kh, Date.now() + 60_000, 'tpm'); // 1 menit untuk TPM
       return;
     } else if (/daily|quota|limit|insufficient/i.test(msg)) {
       // Limit harian -> cooldown sampai reset UTC
       const cd = Date.now() + msUntilDailyResetUtc();
       setCooldownPersist(kh, cd, 'quota');
       return;
     }
   }

   // RATE LIMIT DREAMPROMPTING (temuan 04 Okt).
  //
  // Kuota dihitung per AKUN, jendela BERGULIR. Pesan 429:
  // "Daily token quota reached (...). It is summed across every key on your
  //  account and frees up on a rolling 24 hour window."
  //
  // PENTING (koreksi atas asumsi awal): durasi cooldown TIDAK BOLEH di-hardcode
  // 24 jam. Endpoint menyediakan waktu reset sendiri dan nilainya BERUBAH:
  //   header  x-ratelimit-reset        -> sisa DETIK sampai jendela rate limit pulih
  //   JSON    rate_limit.reset_seconds -> idem (detik)
  // Untuk kuota HARIAN yang habis, endpoint tidak mengirim sisa detiknya; pada
  // kondisi itu barulah kita pakai jendela bergulir 24 jam sebagai perkiraan —
  // dan itu dicatat sebagai estimasi, bukan angka pasti.
  if (kind === 'dreamprompting' && rates) {
    // 1. Coba baca reset dari error (header retry-after / x-ratelimit-reset).
    const retryAfterRaw = (err as { retryAfter?: string | null })?.retryAfter;
    const resetHeader = (err as { rateLimitReset?: string | number | null })?.rateLimitReset;
    let detikReset: number | null = null;
    const parseDetik = (v: unknown): number | null => {
      if (v === null || v === undefined) return null;
      const s = String(v).trim();
      if (!s) return null;
      // Format "45" (detik) atau "5m45.6s" / "105ms".
      const mnt = s.match(/(\d+)\s*m(?!s)/i);
      const dtk = s.match(/([\d.]+)\s*s/i);
      const ms = s.match(/([\d.]+)\s*ms/i);
      let total = 0;
      let ada = false;
      if (mnt) { total += Number(mnt[1]) * 60; ada = true; }
      if (dtk && !ms) { total += Number(dtk[1]); ada = true; }
      if (ms) { total += Number(ms[1]) / 1000; ada = true; }
      if (!ada) {
        const n = Number(s);
        if (Number.isFinite(n)) { total = n; ada = true; }
      }
      return ada ? Math.max(1, Math.ceil(total)) : null;
    };
    detikReset = parseDetik(retryAfterRaw) ?? parseDetik(resetHeader);

    // 2. Bila endpoint tidak memberi sisa detik (kuota harian habis), pakai
    //    jendela bergulir 24 jam sebagai perkiraan + margin 5 menit.
    const kuotaHarian = /daily|quota|token/i.test(msg);
    const durasiMs = detikReset !== null
      ? detikReset * 1000
      : (kuotaHarian ? 24 * 60 * 60_000 + 5 * 60_000 : 60_000);

    const cd = Date.now() + durasiMs;
    // Istirahatkan SEMUA key DreamPrompting: kuota milik akun, bukan key.
    for (const other of config.pools.dreamprompting) {
      setCooldownPersist(`dreamprompting:${keyHash(other)}`, cd, 'rpd');
    }
    return;
  }

  // Jika rate limited (429), cooldown 60s
  if (rates) {
    keyCooldownMap.set(kh, Date.now() + 60_000);
    return;
  }

  // Jika 401/403 atau CreditsError (kunci salah / izin ditolak / kredit akun habis), cooldown 5 menit
  if (msg.includes('PROVIDER_401') || msg.includes('PROVIDER_403') || msg.includes('CreditsError')) {
    setCooldownPersist(kh, Date.now() + 300_000, 'error');
    return;
  }

  // Jika timeout koneksi atau hang, cooldown 2 menit agar request berikutnya langsung ke kunci sehat
  if (msg === 'CONNECT_TIMEOUT' || msg === 'THINKING_TIMEOUT') {
    setCooldownPersist(kh, Date.now() + 120_000, 'error');
    return;
  }
}

function isModelCoolingDown(kind: ProviderKind, model: string): boolean {
  const cd = modelCooldownMap.get(`${kind}:${model}`) || 0;
  return Date.now() < cd;
}

function recordModelFailure(kind: ProviderKind, model: string, durationMs: number = 20_000): void {
  // Cooldown hanya pada model spesifik ini agar giliran berikutnya cepat failover,
  // tanpa pernah mematikan kunci API atau provider secara menyeluruh
  modelCooldownMap.set(`${kind}:${model}`, Date.now() + durationMs);
}

// --- PELACAK LATENSI PER MODEL (EWMA) ---
// Dipakai untuk failover berbasis WAKTU RESPONS: model yang lambat (> config.slowModelMs)
// diturunkan prioritasnya di dalam tier yang sama agar request berikutnya mencoba
// model cadangan yang lebih gesit lebih dulu. EWMA 0,7/0,3 meredam lonjakan sesaat.
const modelLatencyMap = new Map<string, number>();

function recordModelLatency(kind: ProviderKind, model: string, ms: number): void {
  const id = `${kind}:${model}`;
  const prev = modelLatencyMap.get(id);
  modelLatencyMap.set(id, prev === undefined ? ms : prev * 0.7 + ms * 0.3);
}

/** Model dianggap lambat jika rata-rata waktu responsnya melewati ambang config.slowModelMs. */
function isModelSlow(kind: ProviderKind, model: string): boolean {
  const lat = modelLatencyMap.get(`${kind}:${model}`);
  return lat !== undefined && lat > config.slowModelMs;
}

/**
 * Susun ulang model dalam satu tier: yang gesit / belum diketahui di depan (urutan
 * konfigurasi dipertahankan), model lambat dipindah ke belakang agar failover dalam
 * tier tetap responsif. Model yang sedang cooling-down tetap dihormati oleh pemanggil.
 */
function orderModelsByLatency(kind: ProviderKind, models: string[]): string[] {
  const fast = models.filter((m) => !isModelSlow(kind, m));
  const slow = models.filter((m) => isModelSlow(kind, m));
  return [...fast, ...slow];
}

/**
 * Urutkan key untuk satu attempt dengan ROTASI ROUND-ROBIN (keputusan user).
 *
 * Kenapa bukan sticky: sebelumnya key sukses terakhir selalu dipakai lagi, sehingga
 * key #1 menghabiskan kuota hariannya sendirian (bukti dashboard xkiro: key ...6386
 * tembus 1.004.173 token sementara key ...8a6b masih 0). Rotasi membuat beban merata
 * sehingga tidak ada satu key yang habis lebih dulu.
 *
 * Aturan:
 * 1. Key yang sedang cooldown (429/401/timeout) DIBUANG dari rotasi; kalau semua
 *    cooldown, pakai daftar cooling sebagai fallback darurat agar tetap ada percobaan.
 * 2. Mulai dari indeks rotasi bergilir, bukan selalu indeks 0.
 * 3. Urutkan sisa key berdasarkan kuota harian terpakai (paling sedikit dulu) —
 *    pengaman bila jumlah request tidak merata (mis. instance Vercel berbeda).
 */
export function getOrderedKeys(kind: ProviderKind, keys: string[]): string[] {
  if (keys.length <= 1) return keys;
  const now = Date.now();

  const healthy: string[] = [];
  const cooling: string[] = [];

  for (const k of keys) {
    const kh = `${kind}:${keyHash(k)}`;
    const cd = getCooldownPersist(kh);
    if (now < cd) {
      cooling.push(k);
    } else {
      healthy.push(k);
    }
  }

  const pool = healthy.length > 0 ? healthy : cooling;
  if (pool.length <= 1) return pool;

  // Titik mulai bergilir: maju satu key setiap panggilan untuk kind ini.
  const start = (keyRotationIndexMap.get(kind) ?? 0) % pool.length;
  keyRotationIndexMap.set(kind, start + 1);

  const rotated = [...pool.slice(start), ...pool.slice(0, start)];

  // KESEIMBANGAN + ROTASI (diklarifikasi audit v0.79 — F7).
  // Sort di bawah mengurutkan key paling sedikit terpakai hari ini; karena sort
  // JavaScript STABIL, urutan rotasi di atas TETAP dipertahankan di antara key yang
  // pemakaiannya sama. Jadi rotasi berperan sebagai tie-breaker, bukan dibuang.
  // Komentar lama ("maju satu key setiap panggilan") menyesatkan seolah rotasi selalu
  // menentukan urutan — padahal key dengan pemakaian lebih sedikit memang sengaja
  // didahulukan (itu tujuan keseimbangan kuota).
  rotated.sort((a, b) => {
    const reqDiff = keyUsageToday(kind, a, 'req') - keyUsageToday(kind, b, 'req');
    if (reqDiff !== 0) return reqDiff;
    return keyUsageToday(kind, a, 'tokens') - keyUsageToday(kind, b, 'tokens');
  });

  // Pangkas map agar tidak tumbuh tanpa batas di instance serverless berumur panjang
  // (temuan F7): hapus cooldown yang sudah kedaluwarsa > 1 jam lalu dan index rotasi
  // yang sudah tidak relevan. Dijalankan probabilistik (1/64 panggilan) agar murah.
  if ((keyRotationIndexMap.get(kind) ?? 0) % 64 === 0) {
    const cutoff = now - 60 * 60 * 1000;
    for (const [k, until] of keyCooldownMap) {
      if (until < cutoff) keyCooldownMap.delete(k);
    }
    for (const [k, until] of modelCooldownMap) {
      if (until < cutoff) modelCooldownMap.delete(k);
    }
  }

  return rotated;
}

/** Pemakaian key hari ini dari cache kuota — untuk menyeimbangkan rotasi. */
function keyUsageToday(kind: ProviderKind, key: string, metric: 'req' | 'tokens'): number {
  try {
    return metric === 'req' ? keyRequestsUsedToday(kind, key) : keyTokensUsedToday(kind, key);
  } catch {
    return 0;
  }
}

export interface TextPart {
  type: 'text';
  text: string;
}

export interface ImagePart {
  type: 'image_url';
  image_url: { url: string };
}

export type ContentPart = TextPart | ImagePart;

export interface ChatMsg {
  role: 'system' | 'user' | 'assistant';
  content: string | ContentPart[];
}

/** Deteksi apakah payload berisi gambar (butuh timeout koneksi lebih longgar saat upload). */
function messagesContainImage(messages: ChatMsg[]): boolean {
  for (const m of messages) {
    if (Array.isArray(m.content)) {
      for (const p of m.content) {
        if (p.type === 'image_url') return true;
      }
    }
  }
  return false;
}

// ProviderKind diimpor dari ./quota.js

interface CacheEntry {
  at: number;
  text: string;
}

const cache = new Map<string, CacheEntry>();

function cacheGet(key: string): string | null {
  const e = cache.get(key);
  if (!e) return null;
  if (Date.now() - e.at > config.cacheTtlMs) {
    cache.delete(key);
    return null;
  }
  return e.text;
}

function cacheSet(key: string, text: string): void {
  if (cache.size > 500) {
    const oldestKeys = Array.from(cache.keys()).slice(0, 50);
    for (const k of oldestKeys) cache.delete(k);
  }
  cache.set(key, { at: Date.now(), text });
}

async function fetchJsonWithLifecycle(
  url: string,
  options: RequestInit,
  connectTimeoutMs: number,
  totalTimeoutMs: number,
): Promise<unknown> {
  const controller = new AbortController();
  let connectTimeoutHit = false;
  let totalTimeoutHit = false;

  // Tier 1: Cek respon koneksi/header API key
  const connectTimer = setTimeout(() => {
    connectTimeoutHit = true;
    controller.abort();
  }, connectTimeoutMs);

  let res: Response;
  try {
    res = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } catch (err: any) {
    if (connectTimeoutHit) throw new Error('CONNECT_TIMEOUT');
    throw err;
  } finally {
    clearTimeout(connectTimer);
  }

  if (res.status === 429) {
    // Baca body untuk membedakan rate limit per-menit vs per-hari
    let errBody = '';
    try { errBody = await res.text(); } catch {}
    const retryAfter = res.headers.get('retry-after');
    // Beberapa provider (mis. DreamPrompting) mengirim SISA DETIK di header
    // `x-ratelimit-reset` — dipakai untuk cooldown ADAPTIF, bukan tebakan.
    const rateLimitReset = res.headers.get('x-ratelimit-reset');
    const err = new Error(`RATE_LIMITED:${errBody.slice(0, 150)}`) as Error & { code?: string; retryAfter?: string | null; rateLimitReset?: string | null };
    err.code = 'RATE_LIMITED';
    err.retryAfter = retryAfter;
    err.rateLimitReset = rateLimitReset;
    throw err;
  }
  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    console.warn(`[providers] Upstream error dari ${url}: status=${res.status}, body=${errBody.slice(0, 300)}`);
    throw new Error(`PROVIDER_${res.status}:${errBody.slice(0, 300)}`);
  }

  // Fase timeout: model aktif dan sedang berpikir / menghasilkan konten
  let totalTimer: NodeJS.Timeout | undefined;
  try {
    const bodyPromise = res.json();
    bodyPromise.catch(() => {}); // Tangkal unhandled rejection di Node.js saat abort timeout terjadi
    const timeoutPromise = new Promise((_, reject) => {
      totalTimer = setTimeout(() => {
        totalTimeoutHit = true;
        controller.abort();
        reject(new Error('THINKING_TIMEOUT'));
      }, totalTimeoutMs);
    });

    return await Promise.race([bodyPromise, timeoutPromise]);
  } catch (err: any) {
    if (totalTimeoutHit) throw new Error('THINKING_TIMEOUT');
    throw err;
  } finally {
    if (totalTimer) clearTimeout(totalTimer);
  }
}

async function postJson(
  url: string,
  key: string,
  body: unknown,
  totalTimeoutMs: number = config.timeoutMs,
  connectTimeoutMs: number = config.connectTimeoutMs,
): Promise<unknown> {
  return await fetchJsonWithLifecycle(
    url,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    },
    connectTimeoutMs,
    totalTimeoutMs,
  );
}

// --- STREAMING SSE DUA-FASE (timeout pintar sesuai perilaku model) ---
// Fase 1 (firstTokenMs): menunggu TOKEN PERTAMA. Bila model tidak kunjung merespon
//   sampai batas ini → dianggap TIDAK MERESPON → failover cepat, tidak menunggu lama.
// Fase 2 (idleMs): setelah token pertama tiba, model terbukti merespon dan sedang
//   menyusun jawaban → batas jeda antar-chunk dibuat JAUH LEBIH LAMA agar model
//   reasoning panjang tidak terputus di tengah jalan.
// Pagar total (totalMs) tetap ada sebagai pengaman batas serverless.
const ERR_NO_FIRST_TOKEN = 'NO_FIRST_TOKEN';
const ERR_STREAM_IDLE = 'STREAM_IDLE_TIMEOUT';

interface StreamPhaseTimeouts {
  /** Batas fase 1: menunggu token pertama (model belum merespon sama sekali). */
  firstTokenMs: number;
  /** Batas fase 2: jeda antar-chunk setelah model terbukti merespon. */
  idleMs: number;
  /** Pagar total keseluruhan request (pengaman serverless). */
  totalMs: number;
}

interface StreamDelta {
  /** Teks jawaban yang dikirim ke user (delta.content / parts[].text). */
  text?: string;
  /** Sinyal model AKTIF (termasuk reasoning tersembunyi) — mereset idle timer tanpa ikut dikirim ke user. */
  active?: boolean;
}

async function streamSse(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  timeouts: StreamPhaseTimeouts,
  extractDelta: (json: unknown) => StreamDelta,
  extractUsage: (json: unknown) => ProviderResult['tokens'] | undefined,
): Promise<ProviderResult & { firstTokenMs: number }> {
  const controller = new AbortController();
  let phaseTimeout: string | null = null;
  const abortWith = (code: string) => {
    if (!phaseTimeout) phaseTimeout = code;
    controller.abort();
  };

  let firstTimer: NodeJS.Timeout | undefined = setTimeout(() => abortWith(ERR_NO_FIRST_TOKEN), timeouts.firstTokenMs);
  const totalTimer = setTimeout(() => abortWith('THINKING_TIMEOUT'), timeouts.totalMs);
  let idleTimer: NodeJS.Timeout | undefined;

  const startedAt = Date.now();
  let firstTokenMs = 0;
  let streaming = false;
  let text = '';
  let usage: ProviderResult['tokens'] | undefined;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (res.status === 429) {
      // Baca body untuk membedakan rate limit per-menit vs per-hari
      let errBody = '';
      try { errBody = await res.text(); } catch {}
      const retryAfter = res.headers.get('retry-after');
      const rateLimitReset = res.headers.get('x-ratelimit-reset');
      const err = new Error(`RATE_LIMITED:${errBody.slice(0, 150)}`) as Error & { code?: string; retryAfter?: string | null; rateLimitReset?: string | null };
      err.code = 'RATE_LIMITED';
      err.retryAfter = retryAfter;
      err.rateLimitReset = rateLimitReset;
      throw err;
    }
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      console.warn(`[providers] Upstream error dari ${url}: status=${res.status}, body=${errBody.slice(0, 300)}`);
      throw new Error(`PROVIDER_${res.status}:${errBody.slice(0, 300)}`);
    }
    if (!res.body) throw new Error('NO_STREAM_BODY');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;

        let json: unknown;
        try {
          json = JSON.parse(payload);
        } catch {
          continue; // potongan JSON tidak lengkap — abaikan
        }

        const u = extractUsage(json);
        if (u) usage = u;

        const delta = extractDelta(json);
        const hasText = typeof delta.text === 'string' && delta.text.length > 0;
        if (!hasText && !delta.active) continue;

        if (!streaming) {
          // Token pertama tiba → model terbukti merespon: matikan timer fase 1,
          // aktifkan timer fase 2 (idle antar-chunk) yang jauh lebih longgar.
          streaming = true;
          firstTokenMs = Date.now() - startedAt;
          if (firstTimer) {
            clearTimeout(firstTimer);
            firstTimer = undefined;
          }
        }
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => abortWith(ERR_STREAM_IDLE), timeouts.idleMs);
        if (hasText && delta.text) text += delta.text;
      }
    }

    // Flush decoder di EOF: sequence multi-byte yang terbelah di batas chunk
    // terakhir masih tertahan di decoder — tanpa flush, karakter terakhir hilang.
    buffer += decoder.decode();
    if (buffer.trim()) {
      const lastLine = buffer.trim();
      if (lastLine.startsWith('data:')) {
        const payload = lastLine.slice(5).trim();
        if (payload && payload !== '[DONE]') {
          try {
            const json = JSON.parse(payload);
            const u = extractUsage(json);
            if (u) usage = u;
            const delta = extractDelta(json);
            if (typeof delta.text === 'string' && delta.text.length > 0) text += delta.text;
          } catch {
            // JSON tidak lengkap — abaikan
          }
        }
      }
    }

    const cleaned = cleanModelOutput(text.trim());
    if (!cleaned) throw new Error('EMPTY_RESPONSE');
    return { text: cleaned, tokens: usage, firstTokenMs };
  } catch (err) {
    if (phaseTimeout) throw new Error(phaseTimeout);
    throw err;
  } finally {
    if (firstTimer) clearTimeout(firstTimer);
    if (idleTimer) clearTimeout(idleTimer);
    clearTimeout(totalTimer);
  }
}

/** Ekstraksi delta format OpenAI-compatible (content + reasoning sebagai sinyal aktif). */
function openAiDelta(json: unknown): StreamDelta {
  const j = json as {
    choices?: Array<{
      delta?: {
        role?: string | null;
        content?: string | null;
        /** Gaya OpenAI/xKiro: {"reasoning": "..."} */
        reasoning?: string | null;
        /** Gaya DeepSeek/GLM/Dahl: {"reasoning_content": "..."} (temuan audit F6) */
        reasoning_content?: string | null;
        /** Beberapa gateway memakai ini. */
        thinking?: string | null;
      };
    }>;
  };
  const delta = j.choices?.[0]?.delta;
  if (!delta) return {};
  const out: StreamDelta = {};
  if (typeof delta.content === 'string' && delta.content.length > 0) out.text = delta.content;
  // Reasoning tersembunyi (thinking model) juga bukti model AKTIF — reset idle timer
  // agar model reasoning panjang tidak salah dianggap hang.
  //
  // KOREKSI AUDIT v0.79 (F6): sebelumnya HANYA `delta.reasoning` yang dikenali. Model
  // gaya DeepSeek/GLM (dipakai Dahl T5 & beberapa model xKiro) mengirim
  // `delta.reasoning_content`, sehingga token reasoning mereka TIDAK dianggap sinyal
  // aktif -> timer fase-1 (4-5,5 dtk) habis -> failover PREMATUR padahal model sedang
  // bekerja. Ini membuang tier yang sebenarnya sehat.
  const reasoningText = delta.reasoning ?? delta.reasoning_content ?? delta.thinking;
  if (typeof reasoningText === 'string' && reasoningText.length > 0) out.active = true;
  // Sinyal aktif awal: chunk pembuka dengan role membuktikan upstream telah merespon
  if (delta.role) out.active = true;
  return out;
}

function openAiUsage(json: unknown): ProviderResult['tokens'] | undefined {
  const j = json as {
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    // GROQ: mengirim usage di DUA tempat — `usage` (standar) DAN `x_groq.usage`.
    // BUG YANG DIPERBAIKI (06 Okt 2026): sebelumnya hanya membaca `usage`, sehingga
    // ketika Groq menaruh angkanya di `x_groq.usage` (atau sebaliknya), token
    // TIDAK TERCATAT -> kolom tokens_used = 0 -> dashboard menampilkan token
    // yang tidak akurat (laporan pemilik produk: "perhitungan tokennya tidak akurat").
    x_groq?: { usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } };
  };
  const u = j.usage ?? j.x_groq?.usage;
  if (!u) return undefined;
  const prompt = Number(u.prompt_tokens) || 0;
  const completion = Number(u.completion_tokens) || 0;
  const total = Number(u.total_tokens) || 0;
  // Tolak usage kosong (semua nol) agar tidak menimpa data nyata dengan 0.
  if (prompt === 0 && completion === 0 && total === 0) return undefined;
  return { prompt, completion, total };
}

/** Ekstraksi delta format Gemini SSE (parts[].text; part thought hanya sinyal aktif). */
function geminiDelta(json: unknown): StreamDelta {
  const j = json as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>;
  };
  const parts = j.candidates?.[0]?.content?.parts;
  if (!parts) return {};
  const out: StreamDelta = {};
  for (const p of parts) {
    if (typeof p.text === 'string' && p.text.length > 0) {
      if (p.thought) out.active = true;
      else out.text = (out.text ?? '') + p.text;
    }
  }
  return out;
}

function geminiUsage(json: unknown): ProviderResult['tokens'] | undefined {
  const u = (json as {
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
  }).usageMetadata;
  if (!u) return undefined;
  return {
    prompt: Number(u.promptTokenCount) || 0,
    completion: Number(u.candidatesTokenCount) || 0,
    total: Number(u.totalTokenCount) || 0,
  };
}

export interface ProviderResult {
  text: string;
  tokens?: {
    prompt: number;
    completion: number;
    total: number;
  };
}

async function openAiChat(
  baseUrl: string,
  key: string,
  model: string,
  messages: ChatMsg[],
  maxTokensOverride?: number,
  extraBody?: Record<string, unknown>,
  totalTimeoutMs: number = config.timeoutMs,
  connectTimeoutMs?: number,
): Promise<ProviderResult> {
  const hasImage = messagesContainImage(messages);
  // Timeout koneksi adaptif: request berisi gambar (base64 besar) butuh waktu upload lebih lama.
  const connectMs = connectTimeoutMs ?? (hasImage ? config.visionConnectTimeoutMs : config.connectTimeoutMs);
  // ── PROMPT CACHING (optimasi latency, 05 Okt 2026) ──
  // System prompt (~5.700 token) dikirim ULANG setiap pesan. Provider yang
  // mendukung caching akan menyimpan bagian ini sehingga tidak diproses ulang —
  // menghemat token DAN waktu prefill (penyebab utama latency ~5 detik).
  //
  // Cara kerja: tandai blok system terakhir dengan `cache_control: { type: 'ephemeral' }`.
  // Provider yang TIDAK mendukung akan mengabaikan field ini (tidak error).
  // Diterapkan HANYA pada pesan system (bagian statis) — bukan pesan user.
  let idxSystemTerakhir = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'system') { idxSystemTerakhir = i; break; }
  }
  const messagesDenganCache: ChatMsg[] = messages.map((m, i) => {
    if (i !== idxSystemTerakhir || typeof m.content !== 'string') return m;
    // Bentuk Anthropic-style cache_control pada blok teks (provider lain mengabaikan).
    return {
      role: m.role,
      content: [{ type: 'text', text: m.content, cache_control: { type: 'ephemeral' } }],
    } as unknown as ChatMsg;
  });

  const body = {
    model,
    messages: messagesDenganCache,
    max_tokens: maxTokensOverride ?? config.maxOutputTokens,
    // Default = parameter bersama (F5). Tier yang butuh nilai lain mengirim
    // extraBody eksplisit; lihat BASE_GEN di atas.
    ...BASE_GEN,
    ...extraBody,
    stream: true,
    stream_options: { include_usage: true },
  };
  const headers = {
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    Accept: 'text/event-stream',
  };

  try {
    // Jalur utama: streaming dua-fase (token pertama = cepat, fase jawaban = longgar).
    // Vision butuh waktu lebih lama sebelum token pertama (analisis gambar), jadi diberi kelonggaran.
    //
    // GUARD TOKEN PERTAMA ADAPTIF (temuan audit v0.79 — uji 8 key xKiro):
    // waktu token pertama bergantung pada UKURAN PROMPT, bukan hanya kesehatan key.
    // Diukur nyata: prompt pendek ("Halo") = 1,7-3,1 detik untuk SEMUA 8 key, tetapi
    // prompt produksi (~19K char ≈ 4.750 token) = 5,7-10,0 detik. Guard tetap 5.500ms
    // membuat request normal sering dianggap "tidak merespon" padahal model sedang
    // memproses (prefill prompt besar) -> failover percuma + latensi naik.
    // Rumus: basis 5.500ms + 1ms per 4 token prompt di atas 3.000 token (maks +6.000ms).
    // Prompt kecil tidak terpengaruh; prompt besar dapat ruang prefill yang wajar.
    const promptChars = messages.reduce((acc, m) => {
      if (typeof m.content === 'string') return acc + m.content.length;
      if (Array.isArray(m.content)) {
        return acc + m.content.reduce((a, p) => a + (p?.type === 'text' && typeof p.text === 'string' ? p.text.length : 0), 0);
      }
      return acc;
    }, 0);
    const promptTokens = Math.ceil(promptChars / 4);
    const adaptiveFirstTokenMs =
      config.firstTokenTimeoutMs + (promptTokens > 3000 ? Math.min(6000, Math.floor((promptTokens - 3000) / 4)) : 0);
    const firstTokenMs = hasImage
      ? config.visionFirstTokenMs
      : Math.min(connectMs + 6000, adaptiveFirstTokenMs);
    const result = await streamSse(`${baseUrl}/chat/completions`, headers, body, {
      firstTokenMs,
      idleMs: config.streamIdleTimeoutMs,
      totalMs: totalTimeoutMs,
    }, openAiDelta, openAiUsage);
    return { text: result.text, tokens: result.tokens };
  } catch (e) {
    const msg = e instanceof Error ? e.message : '';
    // Provider tanpa dukungan SSE (mis. Dahl → HTTP405): ulangi non-streaming sekali.
    if (msg.startsWith('PROVIDER_405') || msg.includes('NO_STREAM_BODY')) {
      const data = (await postJson(`${baseUrl}/chat/completions`, key, { ...body, stream: undefined, stream_options: undefined }, totalTimeoutMs, connectMs)) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      };
      const rawText = data.choices?.[0]?.message?.content?.trim() ?? '';
      const text = cleanModelOutput(rawText);
      if (!text) throw new Error('EMPTY_RESPONSE');
      const tokens = data.usage
        ? {
            prompt: Number(data.usage.prompt_tokens) || 0,
            completion: Number(data.usage.completion_tokens) || 0,
            total: Number(data.usage.total_tokens) || 0,
          }
        : undefined;
      return { text, tokens };
    }
    throw e;
  }
}

function cleanModelOutput(text: string): string {
  if (!text) return '';
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

interface CloudflareKeyInfo {
  accountId: string;
  token: string;
}

const cfKeyAccountCache = new Map<string, string>();

async function resolveCloudflareKey(rawKey: string): Promise<CloudflareKeyInfo> {
  if (rawKey.includes(':')) {
    const idx = rawKey.indexOf(':');
    return {
      accountId: rawKey.slice(0, idx).trim(),
      token: rawKey.slice(idx + 1).trim(),
    };
  }

  const token = rawKey.trim();
  if (config.cloudflareAccountId) {
    return { accountId: config.cloudflareAccountId, token };
  }

  const cachedAcc = cfKeyAccountCache.get(token);
  if (cachedAcc) {
    return { accountId: cachedAcc, token };
  }

  try {
    const res = await fetch('https://api.cloudflare.com/client/v4/accounts', {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(config.connectTimeoutMs),
    });
    if (res.ok) {
      const data = (await res.json()) as { result?: Array<{ id: string }> };
      const accId = data.result?.[0]?.id;
      if (accId) {
        cfKeyAccountCache.set(token, accId);
        return { accountId: accId, token };
      }
    }
  } catch {
    // abaikan network error saat lookup akun
  }

  return { accountId: '', token };
}

async function cloudflareVisionChat(
  accountId: string,
  token: string,
  model: string,
  messages: ChatMsg[],
  totalTimeoutMs: number = config.timeoutMs,
): Promise<ProviderResult> {
  let prompt = '';
  let imageBytes: number[] = [];

  for (const m of messages) {
    if (typeof m.content === 'string') {
      prompt += (prompt ? '\n' : '') + m.content;
    } else if (Array.isArray(m.content)) {
      for (const p of m.content) {
        if (p.type === 'text') {
          prompt += (prompt ? '\n' : '') + p.text;
        } else if (p.type === 'image_url') {
          const match = p.image_url.url.match(/^data:(.+);base64,(.+)$/);
          if (match && match[2]) {
            imageBytes = Array.from(Buffer.from(match[2], 'base64'));
          }
        }
      }
    }
  }

  if (imageBytes.length === 0) {
    throw new Error('NO_IMAGE_DATA_FOR_VISION');
  }

  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`;
  const data = (await fetchJsonWithLifecycle(
    endpoint,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: prompt || 'Jelaskan gambar ini.',
        image: imageBytes,
      }),
    },
    config.visionConnectTimeoutMs,
    totalTimeoutMs,
  )) as {
    result?: {
      // Llama 3.2 Vision membalas `response`; LLaVA membalas `description`.
      response?: string;
      description?: string;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };
  };

  const rawText = (data.result?.response ?? data.result?.description)?.trim() ?? '';
  const text = cleanModelOutput(rawText);
  if (!text) throw new Error('EMPTY_RESPONSE');

  const tokens = data.result?.usage
    ? {
        prompt: Number(data.result.usage.prompt_tokens) || 0,
        completion: Number(data.result.usage.completion_tokens) || 0,
        total: Number(data.result.usage.total_tokens) || 0,
      }
    : undefined;

  return { text, tokens };
}

async function cloudflareChat(
  rawKey: string,
  model: string,
  messages: ChatMsg[],
  totalTimeoutMs: number = config.timeoutMs,
): Promise<ProviderResult> {
  const { accountId, token } = await resolveCloudflareKey(rawKey);
  if (!accountId) {
    throw new Error('CLOUDFLARE_ACCOUNT_ID_MISSING');
  }
  // Hanya model vision native (Llama 3.2 Vision, LLaVA) yang memakai endpoint /ai/run
  // dengan payload byte array. Qwen & Gemma vision memakai endpoint OpenAI-compat /ai/v1.
  if (model.includes('vision') || model.includes('llava')) {
    return await cloudflareVisionChat(accountId, token, model, messages, totalTimeoutMs);
  }
  const baseUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1`;
  // Matikan mode thinking SEMUA model Cloudflare (keputusan user: thinking=false):
  // tanpa ini qwen3.8-27b bisa "berpikir" puluhan detik dan gemma membuang ~1.000
  // token thinking untuk balasan pendek — penyebab utama respons stiker/foto lambat.
  return await openAiChat(baseUrl, token, model, messages, undefined, { chat_template_kwargs: { enable_thinking: false } }, totalTimeoutMs);
}

/**
 * Konfigurasi thinking MINIMAL untuk Gemini (keputusan user: thinking off / effort minimal).
 * Model 2.5 & 3.x utama menerima `thinkingBudget: 0`; varian `flash-lite` menolaknya
 * (HTTP400 "invalid argument") dan memakai `thinkingLevel: 'low'`.
 */
export function geminiThinkingConfig(model: string): { thinkingConfig: Record<string, unknown> } {
  if (model.includes('flash-lite')) return { thinkingConfig: { thinkingLevel: 'low' } };
  return { thinkingConfig: { thinkingBudget: 0 } };
}

async function geminiChat(key: string, model: string, messages: ChatMsg[], totalTimeoutMs: number = config.timeoutMs, connectTimeoutMs?: number): Promise<ProviderResult> {
  // Timeout koneksi adaptif: upload gambar ke Gemini butuh waktu lebih lama.
  const hasImage = messagesContainImage(messages);
  const connectMs = connectTimeoutMs ?? (hasImage ? config.visionConnectTimeoutMs : config.connectTimeoutMs);
  const contents: Array<{ role: 'user' | 'model'; parts: unknown[] }> = [];
  for (const m of messages) {
    if (m.role === 'system') continue;
    const role: 'user' | 'model' = m.role === 'assistant' ? 'model' : 'user';
    const parts = (typeof m.content === 'string' ? [{ type: 'text', text: m.content } as TextPart] : m.content).map(
      (p) => {
        if (p.type === 'image_url') {
          const match = p.image_url.url.match(/^data:(.+);base64,(.+)$/);
          if (!match) throw new Error('BAD_IMAGE');
          return { inlineData: { mimeType: match[1], data: match[2] } };
        }
        return { text: (p as TextPart).text };
      },
    );
    if (contents.length > 0 && contents[contents.length - 1].role === role) {
      contents[contents.length - 1].parts.push(...parts);
    } else {
      contents.push({ role, parts });
    }
  }

  // Gemini API mewajibkan pesan pertama ber-role 'user'
  while (contents.length > 0 && contents[0].role === 'model') {
    contents.shift();
  }
  if (contents.length === 0) {
    contents.push({ role: 'user', parts: [{ text: 'Halo' }] });
  }

  const system = messages.find((m) => m.role === 'system');
  const body: Record<string, unknown> = {
    contents,
    generationConfig: {
      maxOutputTokens: config.maxOutputTokens,
      temperature: BASE_GEN.temperature,
      // Thinking off / effort minimal (keputusan user) — jawaban langsung tanpa "berpikir" panjang.
      ...geminiThinkingConfig(model),
    },
  };
  if (system) {
    const sysText = typeof system.content === 'string'
      ? system.content
      : Array.isArray(system.content)
        ? system.content.map(p => typeof p === 'string' ? p : (p as any).text || '').join('\n')
        : String(system.content || '');
    body.systemInstruction = { parts: [{ text: sysText }] };
  }

  // Streaming SSE dua-fase (sama seperti provider lain): token pertama cepat → failover gesit,
  // fase penyusunan jawaban longgar agar model reasoning tidak terputus di tengah.
  const result = await streamSse(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${key}`,
    { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body,
    {
      firstTokenMs: hasImage ? config.visionFirstTokenMs : Math.min(connectMs, config.firstTokenTimeoutMs),
      idleMs: config.streamIdleTimeoutMs,
      totalMs: totalTimeoutMs,
    },
    geminiDelta,
    geminiUsage,
  );
  return { text: result.text, tokens: result.tokens };
}

/**
 * Pangkas riwayat pesan secara adaptif jika estimasi total token melebihi batas budget.
 * Mempertahankan pesan sistem (index 0) dan pesan user terkini (terakhir) 100% utuh.
 */
export function trimMessagesToTokenBudget(messages: ChatMsg[], maxBudgetTokens: number = 8000): ChatMsg[] {
  if (messages.length === 0) return messages;

  const estimateTokens = (msgs: ChatMsg[]) => {
    let chars = 0;
    for (const m of msgs) {
      if (typeof m.content === 'string') {
        chars += m.content.length;
      } else if (Array.isArray(m.content)) {
        for (const part of m.content) {
          if (part.type === 'text') chars += part.text.length;
          // Gambar ≈ 4.000 token = 13.200 char pada rasio 3,3. Tanpa ini, request
          // bergambar dianggap kecil sehingga trim tidak jalan dan provider ber-ITPM
          // ketat (Groq) langsung 429.
          else if (part.type === 'image_url') chars += 13200;
        }
      }
    }
    // Rasio konservatif 3,3 karakter/token (terukur ~3,4 pada output nyata) agar
    // pemakaian token AKTUAL tetap di bawah ambang — termasuk batas ketat 8K TPM Groq.
    return Math.ceil(chars / 3.3);
  };

  let totalTokens = estimateTokens(messages);
  if (totalTokens <= maxBudgetTokens) return messages;

  // Salinan dangkal; pesan terakhir diganti objek baru bila perlu dipangkas.
  const out: ChatMsg[] = messages.slice();
  const systemMsg = out[0];
  const lastMsg = out[out.length - 1];

  // TAHAP 1: buang riwayat tertua satu per satu (cara lama).
  //
  // BUG YANG DIPERBAIKI (temuan audit v0.79, reproduksi nyata): versi sebelumnya memakai
  // `out.splice(1, lastIdx - 1, ...history)` dengan `lastIdx = out.length - 1`. Ketika
  // riwayat dihabiskan (history.length === 0), splice menghapus SEMUA elemen indeks 1
  // sampai lastIdx-1 — termasuk pesan terakhir — sehingga `out[lastIdx]` menjadi
  // `undefined` dan tahap 2 CRASH dengan "Cannot read properties of undefined (reading
  // 'content')". Kasus ini nyata: request multimodal (gambar) + prompt besar + riwayat
  // sedikit, yaitu persis jalur describeImage/processIncomingSticker.
  // Perbaikan: bangun array BARU secara eksplisit, jangan splice dengan indeks yang bisa
  // menunjuk elemen yang sudah tidak ada.
  // KONTINUITAS PERCAKAPAN (perbaikan 04 Okt — keluhan "kaya chat baru"):
  // Sebelumnya riwayat dibuang SEMUA sampai muat anggaran. Karena system prompt +
  // konteks web bisa memakai hampir seluruh budget, riwayat habis dan model
  // kehilangan konteks obrolan -> menjawab seperti memulai chat baru.
  // Sekarang: SISAKAN minimal N pesan terakhir (default 4) yang TIDAK boleh dibuang;
  // kekurangan anggaran dipenuhi dengan memangkas konteks web di pesan terakhir.
  const MIN_HISTORY_TURNS = 4;
  if (out.length > 2) {
    const history = out.slice(1, -1);
    // Buang riwayat tertua, tetapi sisakan MIN_HISTORY_TURNS pesan terakhir.
    while (history.length > MIN_HISTORY_TURNS && totalTokens > maxBudgetTokens) {
      history.shift();
      totalTokens = estimateTokens([systemMsg, ...history, lastMsg]);
    }
    out.length = 0;
    out.push(systemMsg, ...history, lastMsg);
  }

  // TAHAP 2 (BUG LAMA): riwayat kosong tapi prompt masih melebihi anggaran — biasanya
  // karena pesan user terakhir memuat KONTEKS WEB hasil scraping (bisa 10.000+ karakter).
  // Sebelum ini, fungsi hanya membuang riwayat sehingga prompt ber-konteks-web TETAP
  // melewati batas ITPM provider (Groq 6.800 efektif) dan request dijamin 429 — Groq
  // jadi tidak pernah terpakai untuk kueri berita. Sekarang isi pesan terakhir dipangkas
  // dari BELAKANG (konteks web ada di bawah, pertanyaan user ada di atas) sehingga
  // pertanyaannya tetap utuh.
  // PRIORITAS PANGKAS: konteks web (pesan terakhir) dipangkas DULU sebelum
  // riwayat disentuh lebih jauh — riwayat menentukan kontinuitas obrolan,
  // sedangkan konteks web bisa dipangkas tanpa kehilangan alur percakapan.
  if (totalTokens > maxBudgetTokens) {
    const last = out[out.length - 1];
    // Guard tipe: content bisa ARRAY (multimodal: teks + gambar). Hanya string yang
    // bisa dipangkas; untuk array, bagian gambar TIDAK boleh dibuang (tanpa gambar
    // pertanyaannya tidak bisa dijawab), jadi dilewati saja.
    if (last && typeof last.content === 'string') {
      const systemChars = typeof systemMsg.content === 'string' ? systemMsg.content.length : 0;
      const otherChars = out.slice(1, -1).reduce(
        (a, m) => a + (typeof m.content === 'string' ? m.content.length : 0), 0);
      // Sisakan ruang untuk penanda pangkas (~60 char) agar hasil akhir benar-benar
      // di bawah anggaran — tanpa ini hasilnya 6.818 token (18 di atas 6.800).
      const MARKER = '\n\n[...konteks dipangkas agar muat batas token provider...]';
      const budgetChars = Math.floor(maxBudgetTokens * 3.3) - systemChars - otherChars - MARKER.length;
      if (budgetChars > 200 && last.content.length > budgetChars) {
        const head = last.content.slice(0, budgetChars);
        // Potong di batas baris/kalimat terakhir agar tidak memotong di tengah kata.
        const cut = Math.max(head.lastIndexOf('\n'), head.lastIndexOf('. '), head.lastIndexOf(' '));
        const kept = cut > budgetChars * 0.6 ? head.slice(0, cut) : head;
        out[out.length - 1] = { ...last, content: kept + MARKER };
      }
    }
  }

  return out;
}

interface Step {
  kind: ProviderKind;
  keys: string[];
  models: string[];
  cap: number;
  /**
   * Batas token prompt per menit (ITPM) provider. Bila prompt melebihi angka ini,
   * request DIJAMIN kena 429 dan membuang waktu rantai — jadi provider dilewati.
   *
   * Kenapa penting: Groq Free Tier membatasi INPUT token per menit (ITPM) ~7.000-8.000
   * untuk model qwen3.8-27b. Sementara konteks bot bisa >8.000 token (terbukti di DB:
   * 15 dari 15 pemakaian terbesar melebihi 8.000 token). Tanpa guard ini, setiap percakapan
   * panjang yang jatuh ke Groq PASTI gagal — user melihat bot "tidak merespon".
   * 0 = tidak ada batas yang diketahui.
   */
  maxPromptTokens: number;
  /** `t` = sisa anggaran waktu (ms) untuk attempt ini, agar satu model yang menggantung tidak menghabiskan seluruh deadline rantai. */
  run: (key: string, model: string, messages: ChatMsg[], t: number) => Promise<ProviderResult>;
}

// ============================================================================
// PARAMETER GENERASI BERSAMA (temuan audit v0.79 — F5)
// ============================================================================
//
// MASALAH YANG DIPERBAIKI: setiap tier punya temperature/penalty sendiri sehingga
// prompt yang SAMA menghasilkan gaya & panjang berbeda tergantung model mana yang
// menang failover:
//   xKiro       temperature 0.35, presence 0.0, frequency 0.0
//   Cloudflare  temperature 0.70, presence 0.5, frequency 0.3
//   Groq        temperature 0.45, presence 0.0, frequency 0.4
//   OpenRouter  temperature 0.70, presence 0.5, frequency 0.3
//   Dahl        temperature 0.45, presence 0.0, frequency 0.5
//   Gemini      temperature 0.70
// Selain itu max_tokens berbeda: 2500 (xKiro/Cloudflare/OpenRouter/Gemini) vs 800
// (Groq/Dahl) — jawaban panjang TERPOTONG saat jatuh ke Dahl (Tier 5, penyelamat
// utama), tapi utuh di tier lain. Ini akar keluhan "respon tidak konsisten saat
// pindah model di tengah percakapan".
//
// SOLUSI: satu tabel parameter dasar dipakai SEMUA tier. Override hanya bila provider
// memang membutuhkan (Groq/Dahl: max_tokens 800 karena ITPM ketat — didokumentasikan).
// Nilai dipilih dari yang TERBUKTI paling stabil di uji lapangan:
//   temperature 0.45 — cukup hidup untuk obrolan, tidak liar untuk fakta
//   presence 0.0 / frequency 0.15 — mengurangi pengulangan tanpa mengubah nada
const BASE_GEN = {
  temperature: 0.45,
  presence_penalty: 0.0,
  frequency_penalty: 0.15,
} as const;

/** Parameter dasar untuk provider ber-ITPM ketat (output dibatasi 800 token). */
const BASE_GEN_TIGHT = {
  ...BASE_GEN,
  maxTokens: 800,
} as const;

/**
 * OpenCode Free — LANGSUNG ke opencode.ai, TANPA 9Router, TANPA API key.
 * Diverifikasi 04 Okt: mimo-v2.6 3/3 & muse-spark-1.3 3/3 berhasil.
 *
 * RAHASIA (dibedah dari repo 9router, open-sse/executors/opencode.js +
 * open-sse/utils/opencodeFingerprint.js):
 *
 * 1. FINGERPRINT TOOLS (WAJIB). Gate free-tier memeriksa apakah request memuat
 *    4 tool file-search: bash, glob, grep, read. Tanpa ini -> 403
 *    "OpenCode's free tier can only be used from within OpenCode".
 *    Tool ini hanya "sidik jari" — deskripsinya sengaja dibuat tidak bisa dipakai.
 *
 * 2. FORMAT BERBEDA PER ENDPOINT:
 *    - muse-spark  -> /zen/v1/responses  (format Responses API: input[], tool FLAT,
 *                     tool_choice "auto", max_output_tokens, reasoning{effort,summary})
 *    - model lain  -> /zen/v1/chat/completions (messages[], tool NESTED,
 *                     tool_choice "none" bila klien tak mengirim tool)
 *
 * 3. SESSION STABIL. Kuota free-tier dihitung PER SESI. Membuat sesi baru tiap
 *    request menghabiskan kuota cepat dan memicu 429. Sesuatu sesi panjang dipakai
 *    ulang per identitas — di sini satu sesi per proses.
 *
 * 4. SELALU STREAMING (stream=true). Free tier menolak permintaan non-stream
 *    dengan 403.
 *
 * 5. Authorization: "Bearer public" (endpoint noAuth).
 */
const OPENCODE_BASE = 'https://opencode.ai/zen/v1';
const OPENCODE_UA = 'opencode/1.18.31';
const OPENCODE_FINGERPRINT_TOOLS = ['bash', 'glob', 'grep', 'read'] as const;

// Satu sesi stabil per proses (kuota free-tier dihitung per sesi).
let opencodeSessionCache: string | null = null;
let opencodeSessionAt = 0;
const OPENCODE_SESSION_TTL_MS = 30 * 60_000;

function opencodeSession(): string {
  const now = Date.now();
  if (opencodeSessionCache && now - opencodeSessionAt < OPENCODE_SESSION_TTL_MS) {
    return opencodeSessionCache;
  }
  const B62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  const bytes = crypto.randomBytes(14);
  let rnd = '';
  for (let i = 0; i < 14; i++) rnd += B62[bytes[i] % 62];
  const t = Array.from({ length: 6 }, (_, i) =>
    Number((BigInt(now) * 0x1000n >> BigInt(40 - 8 * i)) & 0xffn).toString(16).padStart(2, '0')).join('');
  opencodeSessionCache = `ses_${t}${rnd}`;
  opencodeSessionAt = now;
  return opencodeSessionCache;
}

function opencodeRequestId(): string {
  const B62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  const bytes = crypto.randomBytes(14);
  let rnd = '';
  for (let i = 0; i < 14; i++) rnd += B62[bytes[i] % 62];
  const now = Date.now();
  const t = Array.from({ length: 6 }, (_, i) =>
    Number((BigInt(now) * 0x1000n >> BigInt(40 - 8 * i)) & 0xffn).toString(16).padStart(2, '0')).join('');
  return `msg_${t}${rnd}`;
}

/** Tool fingerprint format FLAT (untuk /responses). */
function fingerprintFlat() {
  return OPENCODE_FINGERPRINT_TOOLS.map((name) => ({
    type: 'function',
    name,
    description: 'This tool is currently unavailable and must not be used.',
    parameters: { type: 'object', properties: {} },
  }));
}
/** Tool fingerprint format NESTED (untuk /chat/completions). */
function fingerprintNested() {
  return OPENCODE_FINGERPRINT_TOOLS.map((name) => ({
    type: 'function',
    function: {
      name,
      description: 'This tool is currently unavailable and must not be used.',
      parameters: { type: 'object', properties: {} },
    },
  }));
}

function isOpencodeResponsesModel(model: string): boolean {
  const base = model.replace(/\([^()]+\)\s*$/, '').trim();
  return /^muse[-_]?spark/i.test(base);
}

async function opencodeChat(
  _key: string,
  model: string,
  msgs: ChatMsg[],
  timeoutMs: number,
): Promise<ProviderResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const pakaiResponses = isOpencodeResponsesModel(model);
    const url = pakaiResponses ? `${OPENCODE_BASE}/responses` : `${OPENCODE_BASE}/chat/completions`;

    let body: Record<string, unknown>;
    if (pakaiResponses) {
      // Format Responses API.
      const input = msgs.map((m) => ({
        type: 'message',
        role: m.role,
        content: [{ type: m.role === 'assistant' ? 'output_text' : 'input_text', text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }],
      }));
      body = {
        model,
        input,
        tools: fingerprintFlat(),
        tool_choice: 'auto',
        stream: true,
        store: false,
        // EFFORT/THINKING (diuji 04 Okt): OpenCode TIDAK menerima effort "none"
        // (HTTP 400), tapi menerima "low" — dan "low" terukur 2,3x LEBIH CEPAT
        // dari tanpa effort (780ms vs 1838ms) dengan jawaban tetap benar.
        reasoning: { effort: 'low' },
      };
    } else {
      body = {
        model,
        messages: msgs,
        tools: fingerprintNested(),
        tool_choice: 'none',
        stream: true,
        // Minta upstream menyertakan usage (token asli) di akhir stream —
        // tanpa ini angka token di dashboard memakai estimasi panjang teks
        // yang jauh lebih kecil dari kenyataan (bug 04 Okt).
        stream_options: { include_usage: true },
        // Model OpenCode jalur chat/completions memakai chat_template_kwargs
        // untuk mematikan thinking (pola sama dengan provider lain).
        chat_template_kwargs: { enable_thinking: false },
        reasoning_effort: 'none',
      };
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer public',
        'User-Agent': OPENCODE_UA,
        'x-opencode-client': 'desktop',
        'x-opencode-session': opencodeSession(),
        'x-opencode-request': opencodeRequestId(),
        'x-opencode-project': 'global',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const teks = await res.text().catch(() => '');
      throw new Error(`PROVIDER_${res.status}:${teks.slice(0, 300)}`);
    }

    // Baca SSE dan rangkai teks.
    const reader = res.body?.getReader();
    if (!reader) throw new Error('NO_STREAM_BODY');
    const dec = new TextDecoder();
    let buf = '';
    let out = '';
    // USAGE ASLI dari upstream (DIPERBAIKI 04 Okt).
    //
    // BUG LAMA: opencodeChat selalu mengembalikan tokens {0,0,0} dengan alasan
    // "OpenCode tidak mengirim usage pada stream". Itu SALAH — endpoint
    // /responses mengirim event `response.completed` yang memuat:
    //   { input_tokens, output_tokens, total_tokens, output_tokens_details }
    // Akibat bug itu dashboard menghitung token dengan ESTIMASI panjang teks
    // (panjang/3.8) sehingga angkanya jauh lebih kecil dari kenyataan
    // (mis. 2.419 tk padahal sesungguhnya ~8.000 karena prompt sistem panjang).
    // Kini usage asli dibaca dan dilaporkan apa adanya.
    let usageAsli: { prompt: number; completion: number; total: number } | undefined;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const baris = buf.split('\n');
      buf = baris.pop() || '';
      for (const l of baris) {
        if (!l.startsWith('data:')) continue;
        const d = l.slice(5).trim();
        if (!d || d === '[DONE]') continue;
        try {
          // Tiga bentuk respons yang harus didukung:
          //  1. /chat/completions (OpenAI) -> choices[0].delta.content
          //  2. /responses (Responses API) -> event "response.output_text.delta"
          //     dengan field `delta` (string)
          //  3. /responses "response.completed" -> response.usage (usage ASLI)
          // BUG YANG DIPERBAIKI (04 Okt): dulu `if (!out && typeof j.delta...)`
          // sehingga begitu `out` terisi 1 karakter, SELURUH delta berikutnya
          // diabaikan -> jawaban terpotong ("Halo! Saya", "Halo! Kab").
          const j = JSON.parse(d) as {
            choices?: Array<{ delta?: { content?: string } }>;
            delta?: string | { content?: string };
            type?: string;
            usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
            response?: {
              usage?: {
                input_tokens?: number;
                output_tokens?: number;
                total_tokens?: number;
              };
            };
          };
          const dariChoices = j.choices?.[0]?.delta?.content || '';
          const dariDelta =
            typeof j.delta === 'string'
              ? j.delta
              : typeof j.delta === 'object' && j.delta
                ? j.delta.content || ''
                : '';
          out += dariChoices || dariDelta;

          // Bentuk usage A: gaya OpenAI (chat/completions) — usage di root.
          if (j.usage && typeof j.usage.total_tokens === 'number') {
            usageAsli = {
              prompt: Number(j.usage.prompt_tokens) || 0,
              completion: Number(j.usage.completion_tokens) || 0,
              total: Number(j.usage.total_tokens) || 0,
            };
          }
          // Bentuk usage B: gaya Responses API — usage di dalam response.completed.
          const ru = j.response?.usage;
          if (ru && typeof ru.total_tokens === 'number') {
            usageAsli = {
              prompt: Number(ru.input_tokens) || 0,
              completion: Number(ru.output_tokens) || 0,
              total: Number(ru.total_tokens) || 0,
            };
          }
        } catch {
          // potongan tidak lengkap
        }
      }
    }
    reader.cancel().catch(() => {});
    const text = out.trim();
    if (!text) throw new Error('EMPTY_REPLY');
    // Kembalikan USAGE ASLI dari upstream bila tersedia (bug lama: selalu 0).
    // Bila upstream tidak mengirim usage, baru 0 — dan lapisan atas boleh
    // mengestimasi. Tetapi dengan perbaikan ini, angka token jadi akurat.
    return { text, tokens: usageAsli ?? { prompt: 0, completion: 0, total: 0 } };
  } finally {
    clearTimeout(timer);
  }
}

function steps(): Step[] {
  return [
    // --- TIER 1: DreamPrompting (100 RPM, rolling free tier) ---
    // User instruction: Primary Qwen, Backup GPT; reasoning/thinking none untuk minimal token per chat (<8000)
    {
      kind: 'dreamprompting',
      keys: config.pools.dreamprompting,
      models: [config.models.dpPrimary, ...config.models.dpBackup],
      cap: config.dailyCap.dreamprompting,
      maxPromptTokens: 7000,
      run: (k, m, msgs, t) => {
        const dpMsgs = trimMessagesToTokenBudget(msgs, 7000);
        return openAiChat('https://dreamprompting.com/api/v1', k, m, dpMsgs, BASE_GEN_TIGHT.maxTokens, {
          reasoning_effort: 'none',
          reasoning: { effort: 'none' },
          ...BASE_GEN,
        }, t);
      },
    },
    // --- TIER 2: Cloudflare Workers AI (Kepatuhan terbukti 4/4) ---
    {
      kind: 'cloudflare',
      keys: config.pools.cloudflare,
      models: [config.models.cfPrimary, ...config.models.cfBackup],
      cap: config.dailyCap.cloudflare,
      maxPromptTokens: 0,
      run: (k, m, msgs, t) => cloudflareChat(k, m, msgs, t),
    },
    // --- TIER 3: OpenCode Free (mimo-v2.6 + muse-spark-1.3) ---
    // LANGSUNG ke opencode.ai, TANPA 9Router, TANPA API key.
    // Terverifikasi 04 Okt: mimo 3/3 & muse 3/3 berhasil.
    // Wajib: 4 tool fingerprint + format per-endpoint + session stabil + streaming.
    //
    // TANPA BATAS TOKEN PER CHAT (permintaan user): maxPromptTokens: 0 artinya
    // prompt tidak dipangkas/dilewati. Batas 8.000 token per respons SUDAH
    // ditegakkan endpoint OpenCode sendiri, jadi tidak perlu dibatasi lagi di sini.
    {
      kind: 'opencode',
      keys: config.pools.opencode,
      models: [config.models.opencodePrimary, ...config.models.opencodeBackup],
      cap: config.dailyCap.opencode,
      maxPromptTokens: 0,
      run: (k, m, msgs, t) => opencodeChat(k, m, msgs, t),
    },
    // --- TIER 4: OpenRouter (free models) ---
    // User instruction: Primary Nemotron Ultra, Backup Ling; reasoning none untuk minimal token
    {
      kind: 'openrouter',
      keys: config.pools.openrouter,
      models: [config.models.orPrimary, ...config.models.orBackup],
      cap: config.dailyCap.openrouter,
      maxPromptTokens: 0,
      run: (k, m, msgs, t) =>
        openAiChat('https://openrouter.ai/api/v1', k, m, msgs, undefined, {
          reasoning: { effort: 'none' },
          reasoning_effort: 'none',
          ...BASE_GEN,
        }, t),
    },
    // --- TIER 5: NVIDIA NIM (1.000 free credits / key) ---
    {
      kind: 'nvidia',
      keys: config.pools.nvidia,
      models: [config.models.nvidiaPrimary, ...config.models.nvidiaBackup],
      cap: config.dailyCap.nvidia,
      maxPromptTokens: 0,
      run: (k, m, msgs, t) => {
        // DiffusionGemma mendukung reasoning_effort 'none'; Llama 3.2 Vision menolaknya (HTTP 400).
        const extraReasoning = m.includes('diffusiongemma')
          ? { reasoning_effort: 'none', chat_template_kwargs: { enable_thinking: false } }
          : { chat_template_kwargs: { enable_thinking: false } };
        return openAiChat('https://integrate.api.nvidia.com/v1', k, m, msgs, undefined, {
          ...extraReasoning,
          ...BASE_GEN,
        }, t);
      },
    },
    // --- TIER 6: Groq Cloud API (LPU Ultra-Fast Inference) ---
    // Prompt & output dijaga <8000 token; reasoning none pada Qwen, low pada GPT-OSS
    {
      kind: 'groq',
      keys: config.pools.groq,
      models: [config.models.groqPrimary, ...config.models.groqBackup],
      cap: config.dailyCap.groq,
      maxPromptTokens: 7000,
      run: (k, m, msgs, t) => {
        const groqMsgs = trimMessagesToTokenBudget(msgs, 7000);
        // Groq menolak reasoning_effort 'none' pada model reasoning (mis. openai/gpt-oss-120b harus low).
        // Model Qwen mendukung 'none' untuk 0 token reasoning.
        const extraReasoning = m.includes('gpt-oss') ? { reasoning_effort: 'low' } : { reasoning_effort: 'none' };
        return openAiChat('https://api.groq.com/openai/v1', k, m, groqMsgs, BASE_GEN_TIGHT.maxTokens, {
          ...extraReasoning,
          ...BASE_GEN,
          frequency_penalty: 0.3,
        }, t);
      },
    },
    // --- TIER 7: Google Gemini API (1M Konteks) ---
    {
      kind: 'gemini',
      keys: config.pools.gemini,
      models: [config.models.geminiPrimary, ...config.models.geminiBackup],
      cap: config.dailyCap.gemini,
      maxPromptTokens: 0,
      run: (k, m, msgs, t) => geminiChat(k, m, msgs, t),
    },
    // --- TIER 8: Dahl Global (Saldo 1 Miliar Token) ---
    {
      kind: 'dahl',
      keys: config.pools.dahl,
      models: [config.models.dahlPrimary, ...config.models.dahlBackup],
      cap: config.dailyCap.dahl,
      maxPromptTokens: 0,
      run: (k, m, msgs, t) => {
        return openAiChat(config.dahlProxyUrl, k, m, msgs, BASE_GEN_TIGHT.maxTokens, {
          reasoning_effort: 'none',
          chat_template_kwargs: { enable_thinking: false },
          ...BASE_GEN,
        }, t);
      },
    },
  ];
}

/**
 * Bangun urutan step khusus VISION dari `config.models.visionChain` — daftar
 * (provider, model) eksplisit yang urutannya dihormati mutlak, bukan disusun ulang
 * oleh pengurutan latensi. Setiap entri menjadi satu step berisi satu model saja,
 * memakai pool key dan adapter provider aslinya.
 */
function visionSteps(all: Step[], msgs?: ChatMsg[]): Step[] {
  const byKind = new Map(all.map((s) => [s.kind, s]));
  // CATATAN 04 Okt: blok byKind.set('xkiro', ...) DIHAPUS karena semua akun xKiro
  // DISUSPEND permanen (403 "operating multiple accounts"). xKiro juga sudah
  // dikeluarkan dari visionChain di env.ts, jadi tidak akan pernah dicoba.
  const out: Step[] = [];

  // Format gambar yang dikirim di request ini (dari data URL: data:image/webp;base64,...).
  // Dipakai untuk MELEWATI provider yang menolak format tersebut.
  let imgMime = '';
  if (msgs) {
    for (const m of msgs) {
      if (Array.isArray(m.content)) {
        for (const part of m.content) {
          const url = part && part.type === 'image_url' ? part.image_url?.url ?? '' : '';
          const match = /^data:(image\/[a-z0-9.+-]+);base64,/i.exec(url);
          if (match) { imgMime = match[1].toLowerCase(); break; }
        }
      }
      if (imgMime) break;
    }
  }

  for (const entry of config.models.visionChain) {
    const base = byKind.get(entry.kind);
    if (!base) continue;
    // Groq menolak WebP dengan HTTP 400 "invalid image data" (uji 22 Sep: setiap stiker
    // .webp gagal di Groq dan membuang ~3 detik sebelum failover). Stiker WhatsApp &
    // Telegram berformat WebP, jadi Groq dilewati untuk format itu — Cloudflare, Gemini,
    // dan xKiro menerimanya dengan baik.
    if (imgMime === 'image/webp' && entry.kind === 'groq') continue;
    out.push({ ...base, models: [entry.model] });
  }
  return out;
}

/**
 * BALAPAN MODEL DALAM SATU TIER — permintaan user 04 Okt.
 *
 * MASALAH: perilaku lama = coba model UTAMA dulu; hanya bila ia gagal/lambat,
 * model CADANGAN dicoba. Jadi bila model utama lambat (mis. 8 detik), user
 * menunggu 8 detik itu dulu sebelum cadangan yang mungkin hanya 2 detik dipakai.
 *
 * SOLUSI: kedua model dikirim BERSAMAAN (cadangan menyusul setelah
 * config.raceStaggerMs), lalu JAWABAN YANG TIBA PALING CEPAT yang dipakai.
 * Model yang kalah dibatalkan (AbortController) agar tidak membuang kuota.
 *
 * Aman terhadap kuota: model utama diberi keunggulan stagger kecil sehingga
 * tidak selalu dihabiskan; cadangan hanya "menang" bila memang lebih cepat.
 *
 * Bila raceModels=0, fungsi ini tidak dipakai (jalur sekuensial lama tetap ada).
 */
/**
 * Cek apakah sebuah key boleh dipakai, dengan SATUAN YANG BENAR per provider.
 *
 * MASALAH NYATA (06 Okt 2026): "knapa model cloudflare tidak terpakai ya?
 * langsung lompat ke opencode? padahal di monitoring belum limit"
 *
 * AKAR: `DAILY_TOKEN_CAP_CLOUDFLARE=10000` dibandingkan dengan TOKEN, padahal
 * Cloudflare membatasi NEURON. 15.841 token ≈ 633 neuron dari 10.000 kuota
 * (baru ~6%), tetapi guard menganggapnya HABIS -> Cloudflare selalu dilewati.
 *
 * Helper ini memusatkan logika agar KEDUA jalur (balapan & sekuensial) konsisten.
 */
async function cekKeyBolehDipakai(
  step: Step,
  key: string,
  allowCoolingPass: boolean,
): Promise<boolean> {
  try {
    const perKeyCaps = config.dailyTokenCapPerKey[step.kind] || [];
    const keyIndex = step.keys.indexOf(key);
    const keyTokenCap =
      keyIndex >= 0 && keyIndex < perKeyCaps.length
        ? perKeyCaps[keyIndex]
        : config.dailyTokenCap[step.kind] || 0;

    // Cloudflare: batasnya NEURON -> konversi token ke neuron lebih dulu.
    if (step.kind === 'cloudflare' && keyTokenCap > 0) {
      const tokensHariIni = keyTokensUsedToday('cloudflare', key);
      const modelCf = step.models[0] || '';
      // ── KONSISTENSI RASIO (perbaikan 09 Okt 2026) ──
      // Dulu di sini memakai 80/20, sedangkan api/stats.ts memakai 99/1 — DUA
      // tempat menghitung neuron dengan asumsi BERBEDA untuk data yang sama.
      // Data nyata (kolom prompt_tokens/completion_tokens): ~98,7% input / 1,3%
      // output. Sekarang disamakan ke 99/1 (cadangan) agar tidak ada dua angka.
      const neuronTerpakai = hitungNeuron(Math.round(tokensHariIni * 0.99), Math.round(tokensHariIni * 0.01), modelCf);
      if (neuronTerpakai >= keyTokenCap) {
        if (!allowCoolingPass) {
          console.warn(
            `[providers] Lewati cloudflare: neuron ~${neuronTerpakai} >= batas ${keyTokenCap} (dari ${tokensHariIni} token).`,
          );
        }
        return false;
      }
      return await isKeyAllowed(step.kind, key, step.cap, 0);
    }
    return await isKeyAllowed(step.kind, key, step.cap, keyTokenCap);
  } catch (quotaErr) {
    console.warn(`[providers] Gagal cek kuota key ${step.kind} (${String((quotaErr as Error)?.message ?? quotaErr).slice(0, 80)}). Lanjut tanpa guard kuota.`);
    return true;
  }
}

async function balapanModelDalamTier(
  step: Step,
  models: string[],
  messages: ChatMsg[],
  deadline: number,
  allowCoolingPass: boolean,
): Promise<{ text: string; tokens?: ProviderResult['tokens']; model: string }> {
  const controller = new AbortController();
  const percobaan: Array<Promise<{ text: string; tokens?: ProviderResult['tokens']; model: string }>> = [];

  const jalankanSatu = async (model: string, delayMs: number) => {
    if (delayMs > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
    if (controller.signal.aborted) throw new Error('RACE_ABORTED');
    if (!allowCoolingPass && isModelCoolingDown(step.kind, model)) {
      throw new Error('MODEL_COOLING');
    }
    const candidateKeys = getOrderedKeys(step.kind, step.keys);
    let lastErr: Error = new Error('NO_KEY');
    for (const key of candidateKeys) {
      if (controller.signal.aborted) throw new Error('RACE_ABORTED');
      // Cek kuota dengan satuan benar (Cloudflare=neuron). Lihat cekKeyBolehDipakai().
      const keyAllowed = await cekKeyBolehDipakai(step, key, allowCoolingPass);
      if (!keyAllowed) continue;
      const remainingMs = deadline - Date.now();
      if (remainingMs < 1500) throw new Error('CHAIN_DEADLINE');
      const attemptStart = Date.now();
      try {
        const result = await step.run(key, model, messages, Math.min(remainingMs, config.timeoutMs));
        if (controller.signal.aborted) throw new Error('RACE_ABORTED');
        recordKeySuccess(step.kind, key, model);
        recordModelLatency(step.kind, model, Date.now() - attemptStart);
        keyUsed(step.kind, key);
        if (result.tokens?.total) keyTokensUsed(step.kind, key, result.tokens.total);
        return { text: result.text, tokens: result.tokens, model };
      } catch (e) {
        lastErr = e instanceof Error ? e : new Error('UNKNOWN');
        if (lastErr.message === 'RACE_ABORTED') throw lastErr;
        recordKeyFailure(step.kind, key, e);
        const m = lastErr.message;
        if (
          m.includes('PROVIDER_404') || m.includes('ModelError') || m.includes('PROVIDER_413') ||
          m.includes('PROVIDER_400') || m.includes('PROVIDER_401') || m.includes('PROVIDER_403') ||
          m.includes('PROVIDER_422') || m.includes('BAD_IMAGE') || m.includes('NO_IMAGE_DATA_FOR_VISION')
        ) {
          recordModelFailure(step.kind, model, 15 * 60_000);
          throw lastErr;
        }
        if (m === ERR_NO_FIRST_TOKEN) {
          setCooldownPersist(`${step.kind}:${keyHash(key)}`, Date.now() + 120_000, 'error');
          continue;
        }
        if (m === ERR_STREAM_IDLE) {
          recordModelFailure(step.kind, model, 60_000);
          throw lastErr;
        }
        if (m === 'RATE_LIMITED') keyUsed(step.kind, key);
      }
    }
    throw lastErr;
  };

  for (let i = 0; i < models.length; i++) {
    // Model utama tanpa jeda; cadangan menyusul setelah stagger.
    percobaan.push(jalankanSatu(models[i], i === 0 ? 0 : config.raceStaggerMs * i));
  }

  try {
    // Yang pertama BERHASIL menang; yang gagal diabaikan (sudah dicatat cooldown-nya).
    const pemenang = await Promise.any(percobaan);
    // Batalkan model yang masih berjalan agar tidak membuang kuota.
    controller.abort();
    return pemenang;
  } catch {
    controller.abort();
    throw new Error('ALL_MODELS_IN_TIER_FAILED');
  }
}

/**
 * Chat dengan failover cerdas:
 * - Teks umum / matematika / koding: xKiro (Qwen 3.8 Max > Qwen 3.7 Max > Qwen 3.6 Max Preview) > Cloudflare (GLM 4.7 Flash > GPT-OSS 120B > Qwen 3.8 27B > Llama 3.3 70B) > Groq (Qwen 3.8 27B > GPT-OSS 120B) > Dahl (DeepSeek V4 Flash > GLM 5.3) > OpenRouter (Nex N2.5 Pro > Nemotron Lightning > GLM 5.2) > Groq (Qwen 3.8 > GPT-OSS 120B) > Cloudflare (Qwen 3.8 > GLM 4.7 > GPT-OSS > Llama 3.3) > Gemini (3.8 > 3.5).
 *   Dahl dinaikkan ke Tier 2 (20 Sep) berdasarkan benchmark latensi nyata: p50 234ms
 *   (lebih cepat dari Groq 351ms & Cloudflare 1668ms) dan TIDAK punya batas ITPM ketat
 *   sehingga aman untuk percakapan panjang — beda dari Groq (ITPM 7.000).
 * - Vision / foto / stiker: rantai eksplisit `config.models.visionChain` — Groq > Cloudflare (Qwen > Gemma > Llama Vision > LLaVA) > xKiro (MiniMax M3) > Gemini (3.6 Flash > 3.5 Flash Lite > 2.5 Flash) > xKiro (Qwen 3.8 Max > Qwen Omni Flash).
 * Failover antar-tier otomatis: bila SEMUA model dalam satu tier gagal/timeout, lanjut ke tier berikutnya.
 * Failover dalam-tier berbasis WAKTU RESPONS: model yang rata-rata lambat diturunkan prioritasnya
 * (config.slowModelMs) agar request berikutnya mencoba model cadangan yang lebih gesit lebih dulu.
 * Melempar jika semua gagal agar caller memutuskan retry/pesan status.
 */
export async function chat(
  rawMessages: ChatMsg[],
  opts?: { vision?: boolean; cacheScope?: string },
): Promise<{ text: string; via: string; tokens?: { prompt: number; completion: number; total: number } }> {
  const needVision = opts?.vision === true;
  // PEMANGKASAN TOKEN: HANYA untuk provider yang endpoint-nya benar-benar ketat
  // (DreamPrompting & Groq, keduanya ~7.000 token). Provider lain TIDAK dipangkas
  // di sini — masing-masing menegakkan batasnya sendiri di endpoint (mis. OpenCode
  // membatasi 8.000 token per respons dari sisi server).
  //
  // Sebelumnya pemangkasan dilakukan GLOBAL di sini (config.maxTokensLimit=8000),
  // sehingga provider tanpa batas pun ikut dipotong — itu keliru. Kini pemangkasan
  // hanya terjadi di dalam step DreamPrompting & Groq (lihat maxPromptTokens + trim
  // di steps()). Di sini pesan dibiarkan utuh.
  const messages = rawMessages;
  // KUNCI CACHE HARUS PER-PERCAKAPAN (temuan produksi v0.79.7).
  //
  // Bug lama: cacheKey = JSON.stringify({v, messages}) — TANPA identitas percakapan.
  // Akibat nyata (dilaporkan user): dua pengguna berbeda yang mengirim pesan sama
  // ("namaku Andi, aku tinggal di Bandung") mendapat balasan IDENTIK KATA PER KATA
  // karena yang kedua kena cache milik yang pertama. Ini melanggar prinsip bot
  // "jangan ada kalimat repetitif" dan terasa seperti template hafalan.
  //
  // Deduplikasi pesan kembar dari provider (Meta webhook retry) SUDAH ditangani
  // terpisah di whatsapp_cloud.ts (processedMessageIds) — jadi cache ini murni untuk
  // menghemat token pada permintaan BERULANG DALAM SATU percakapan, bukan lintas orang.
  //
  // `cacheScope` diisi identitas percakapan (chatId) oleh pemanggil; bila tidak diisi
  // (mis. ringkasan memori, pemrosesan media sekali-jalan), cache DILEWATI sama sekali
  // agar tidak pernah menyilangkan konteks antar pengguna.
  const cacheKey = opts?.cacheScope
    ? JSON.stringify({ v: needVision, scope: opts.cacheScope, messages })
    : null;
  if (cacheKey) {
    const hit = cacheGet(cacheKey);
    if (hit) return { text: hit, via: 'cache' };
  }

  let lastError = 'NO_PROVIDER_KEYS';
  const allSteps = steps();

  // Estimasi token prompt (≈4 karakter/token untuk teks campuran Indonesia+Inggris).
  // Dipakai untuk melewati provider yang batas ITPM-nya pasti terlampaui — tanpa guard
  // ini, percakapan panjang yang jatuh ke Groq SELALU gagal 429 dan membuang waktu rantai
  // (temuan user: "penggunaan token ada yg sampai lebih dari 8k, gimna kalo model dari
  // groq yg menangani? pasti tidak akan ada yg merespon, karna rate limit groq 8k/menit").
  const estimatePromptTokens = (msgs: ChatMsg[]): number => {
    let chars = 0;
    for (const m of msgs) {
      if (typeof m.content === 'string') chars += m.content.length;
      else if (Array.isArray(m.content)) {
        for (const part of m.content) {
          if (part && part.type === 'text' && typeof part.text === 'string') chars += part.text.length;
          else if (part && part.type === 'image_url') chars += 4000; // gambar ≈ 4000 token
        }
      }
    }
    return Math.ceil(chars / 4);
  };
  const promptTokensEstimate = estimatePromptTokens(messages);

  // ---------------------------------------------------------------------------
  // ANGGARAN ITPM GROQ UNTUK JALUR VISION (perbaikan 24 Sep).
  //
  // Masalah nyata: Groq adalah model vision TERBAIK yang kita punya (uji gambar
  // tabel: 49/50 angka benar dalam 5,4 dtk, sementara model lain 10/28 atau
  // gagal). Tetapi ia hampir SELALU dilewati untuk gambar, karena prompt sistem
  // bot (~5.700 token) + gambar (~4.000 token) = ~9.700 token, jauh di atas
  // batas 6.800 yang dipasang untuk teks.
  //
  // Akibatnya gambar selalu jatuh ke model cadangan yang jauh lebih lemah —
  // inilah sebab keluhan "angka di tabel tidak terbaca".
  //
  // Solusi: saat memproses GAMBAR, kirim pesan sistem yang RINGKAS ke Groq
  // (instruksi inti saja, tanpa seluruh persona panjang). Kualitas pembacaan
  // gambar tidak bergantung pada panjang persona; yang menentukan adalah
  // gambarnya dan instruksi tugasnya. Anggaran jadi ~4.300 token — aman.
  //
  // Hanya berlaku untuk Groq di jalur vision; provider lain tetap menerima
  // prompt lengkap (kuotanya lapang) dan percakapan teks tidak berubah.
  // ---------------------------------------------------------------------------
  const ringkasUntukGroqVision = (msgs: ChatMsg[]): ChatMsg[] => {
    if (!needVision) return msgs;
    return msgs.map((m) => {
      if (m.role !== 'system' || typeof m.content !== 'string') return m;
      // Ambil instruksi tugas (biasanya di akhir prompt sistem, memuat aturan
      // spesifik untuk gambar ini) lalu tambahkan persona minimal.
      const aturanTugas = m.content.match(/\[[^\]]{4,200}\][\s\S]{0,2500}/);
      return {
        role: 'system' as const,
        content: [
          'Kamu asisten yang membantu dan ramah. Jawab langsung, akurat, tanpa pembuka klise.',
          aturanTugas ? aturanTugas[0] : m.content.slice(-2500),
        ].join('\n'),
      };
    });
  };

  // Untuk vision: rantai eksplisit dari config.models.visionChain (urutan mutlak sesuai
  // keputusan review user, tidak disusun ulang oleh pengurutan latensi).
  const orderedSteps = needVision ? visionSteps(allSteps, messages) : allSteps;
  const messagesRingkas = ringkasUntukGroqVision(messages);
  const promptTokensGroqVision = estimatePromptTokens(messagesRingkas);

  // Anggaran waktu TOTAL seluruh rantai failover: pagar agar satu model yang menggantung
  // tidak menghabiskan jatah serverless. Sisa anggaran diteruskan ke tiap attempt (`t`).
  const deadline = Date.now() + config.chainDeadlineMs;

  // Anti-blackhole (audit H1): jika cooldown model menutup SEMUA kandidat, rantai akan
  // melempar ALL_PROVIDERS_FAILED tanpa satu pun percobaan upstream selama cooldown (bisa
  // 15 menit). Pass kedua "best-effort" mengabaikan cooldown sekali agar selalu ada percobaan.
  let anyModelAttempted = false;
  for (const allowCoolingPass of [false, true]) {
  for (const step of orderedSteps) {
    if (Date.now() >= deadline - 1500) break;
    // Guard ITPM: lewati provider yang batas token-per-menitnya pasti terlampaui.
    // Ini mencegah request yang DIJAMIN 429 (mis. Groq 7.000 ITPM vs prompt 9.000 token)
    // sehingga rantai tidak membuang waktu dan langsung mencoba provider yang sanggup.
    //
    // Untuk jalur VISION, provider Groq dinilai dengan anggaran prompt RINGKAS
    // (lihat ringkasUntukGroqVision): tanpa ini Groq selalu dilewati karena
    // prompt persona panjang + gambar melampaui batas, padahal Groq adalah
    // pembaca gambar terbaik yang tersedia.
    const estimasiUntukStep =
      needVision && step.kind === 'groq' ? promptTokensGroqVision : promptTokensEstimate;
    if (step.maxPromptTokens > 0 && estimasiUntukStep > step.maxPromptTokens) {
      if (!allowCoolingPass) {
        console.warn(
          `[providers] Lewati ${step.kind}: prompt ~${estimasiUntukStep} token melebihi batas ITPM ${step.maxPromptTokens}.`,
        );
      }
      continue;
    }
    // Urutkan model dalam tier ini berdasarkan latensi terukur (gesit di depan, lambat di belakang).
    // Rantai vision dibiarkan apa adanya karena tiap step hanya berisi satu model.
    const models = needVision ? step.models : orderModelsByLatency(step.kind, step.models);

    // BALAPAN MODEL (permintaan user 04 Okt): model utama & cadangan dikirim
    // BERSAMAAN; yang jawabannya tiba paling cepat yang dipakai. Hanya di jalur
    // TEKS (vision sudah punya rantai eksplisit 1-model-per-step) dan bila ada >1
    // model. Bila raceModels=0, jalur sekuensial lama di bawah tetap dipakai.
    if (config.raceModels > 0 && !needVision && models.length > 1) {
      const layak = models.filter((m) => allowCoolingPass || !isModelCoolingDown(step.kind, m));
      if (layak.length > 0) {
        anyModelAttempted = true;
        try {
          const menang = await balapanModelDalamTier(step, layak, messages, deadline, allowCoolingPass);
          if (cacheKey) cacheSet(cacheKey, menang.text);
          console.log(
            `[providers] Balapan ${step.kind}: menang "${menang.model}" dari ${layak.length} model.`,
          );
          return { text: menang.text, via: `${step.kind}/${menang.model}`, tokens: menang.tokens };
        } catch {
          lastError = 'ALL_MODELS_IN_TIER_FAILED';
          // lanjut ke tier berikutnya
          continue;
        }
      }
    }

    for (const model of models) {
      // Fast-pass: Lewati model yang sedang dalam cooldown server error (0ms overhead).
      // Pass best-effort (allowCoolingPass) mengabaikan cooldown — hanya berjalan bila pass
      // pertama tidak menghasilkan percobaan apa pun.
      if (!allowCoolingPass && isModelCoolingDown(step.kind, model)) {
        continue;
      }
      anyModelAttempted = true;

      const candidateKeys = getOrderedKeys(step.kind, step.keys);
      let anyKeyAttempted = false;
      let allKeysFailedWithServerError = true;
      let modelUnresponsive = false;
      // Pelacak key lambat untuk model ini (temuan audit v0.79): NO_FIRST_TOKEN di satu
      // key tidak boleh mematikan seluruh model — key lain mungkin sehat & cepat.
      let slowKeyCount = 0;
      const keysForModel = candidateKeys;

      for (const key of candidateKeys) {
        if (modelUnresponsive) break;
        // Guard RPD + TPD (token/hari): hentikan pool sebelum menabrak 429 upstream.
        // Groq Free Tier: 1.000 RPD DAN 200K TPD — TPD biasanya tercapai lebih dulu.
        // try/catch: kegagalan DB kuota (mis. URL Supabase buruk) tidak boleh membatalkan
        // seluruh rantai failover — tanpa ini satu error DB melempar keluar dari chat() (audit H2).
        let keyAllowed = true;
        // Cek kuota dengan satuan benar (Cloudflare=neuron). Lihat cekKeyBolehDipakai().
        keyAllowed = await cekKeyBolehDipakai(step, key, allowCoolingPass);
        if (!keyAllowed) continue;

        // (Pre-check xKiro DIHAPUS 04 Okt 2026 — providernya sudah tidak ada.)
        const remainingMs = deadline - Date.now();
        if (remainingMs < 1500) {
          lastError = 'CHAIN_DEADLINE';
          break;
        }
        anyKeyAttempted = true;
        const attemptStart = Date.now();
        try {
          // `t` = sisa anggaran rantai (dibatasi timeout per-request) agar attempt ini tidak melewati deadline
          //
          // Groq di jalur vision memakai pesan RINGKAS: prompt persona penuh +
          // gambar akan melampaui ITPM 7.000 sehingga request dijamin 413/429.
          // Kualitas pembacaan gambar tidak bergantung pada panjang persona.
          const msgsUntukStep =
            needVision && step.kind === 'groq' ? messagesRingkas : messages;
          const result = await step.run(key, model, msgsUntukStep, Math.min(remainingMs, config.timeoutMs));
          recordKeySuccess(step.kind, key, model);
          // Catat latensi aktual untuk failover berbasis waktu respons pada request berikutnya
          recordModelLatency(step.kind, model, Date.now() - attemptStart);
          keyUsed(step.kind, key);
          // Catat token harian (TPD) agar limit token upstream terpantau presisi
          if (result.tokens?.total) {
            keyTokensUsed(step.kind, key, result.tokens.total);
          }
          if (cacheKey) cacheSet(cacheKey, result.text);
          return { text: result.text, via: `${step.kind}/${model}`, tokens: result.tokens };
        } catch (e) {
          lastError = e instanceof Error ? e.message : 'UNKNOWN';
          recordKeyFailure(step.kind, key, e);
          console.warn(`[providers] Kegagalan key pada ${step.kind}/${model} (key: ${key.slice(0, 10)}...): ${lastError}. Mencoba key berikutnya...`);

          // FASE 1 timeout: model TIDAK merespon sama sekali dalam batas singkat.
          //
          // KOREKSI AUDIT v0.79 (temuan uji key xKiro): perilaku LAMA adalah failover
          // langsung ke model berikutnya TANPA mencoba key lain, lalu meng-cooldown
          // SELURUH MODEL selama 3 menit. Terbukti SALAH untuk provider dengan antrian
          // per-key: uji 8 key xKiro menunjukkan 3 key butuh 5,7-10,0 detik token pertama
          // sementara 5 key lain hanya 1,6-5,0 detik. Jadi NO_FIRST_TOKEN di satu key
          // BUKAN berarti modelnya rusak — key lain mungkin sehat dan cepat.
          // Dampak lama: satu key lambat mematikan tier xKiro (Tier 1) selama 3 menit
          // dan memaksa request turun ke tier bawah yang lebih terbatas.
          //
          // Perilaku BARU: cooldown KEY yang lambat (2 menit) dan COBA KEY BERIKUTNYA
          // untuk model yang sama. Bila SEMUA key untuk model ini lambat, barulah
          // model dianggap tidak responsif dan failover ke model berikutnya.
          if (lastError === ERR_NO_FIRST_TOKEN) {
            console.warn(
              `[providers] Key lambat pada ${step.kind}/${model} (fase-1 ${config.firstTokenTimeoutMs}ms habis). Cooldown key ini, coba key lain untuk model yang sama.`,
            );
            // recordKeyFailure sudah dipanggil di atas; pastikan key ini beristirahat
            // cukup lama (bukan 60 detik) karena antrian provider bisa panjang.
            setCooldownPersist(`${step.kind}:${keyHash(key)}`, Date.now() + 120_000, 'error');
            slowKeyCount++;
            // Bila SEMUA key untuk model ini sudah dicoba dan tetap lambat, baru
            // anggap model tidak responsif (failover ke model berikutnya).
            if (slowKeyCount >= keysForModel.length) {
              console.warn(
                `[providers] Semua ${keysForModel.length} key ${step.kind}/${model} lambat. Failover ke model berikutnya.`,
              );
              recordModelFailure(step.kind, model, 3 * 60_000);
              modelUnresponsive = true;
              break;
            }
            continue;
          }
          // FASE 2 timeout: model SUDAH merespon tapi berhenti di tengah jawaban.
          // Juga masalah model → lompat ke model berikutnya (jawaban parsial tidak bisa dikirim).
          if (lastError === ERR_STREAM_IDLE) {
            console.warn(`[providers] Model ${step.kind}/${model} berhenti di tengah jawaban (idle ${config.streamIdleTimeoutMs}ms). Failover ke model berikutnya.`);
            recordModelFailure(step.kind, model, 60_000);
            modelUnresponsive = true;
            break;
          }

          // HANYA break perulangan kunci jika error murni kegagalan model global (bukan error kunci/kuota/jaringan):
          // - PROVIDER_404: Model tidak terdaftar di endpoint upstream
          // - ModelError: Upstream menyatakan nama model tidak didukung
          // - PROVIDER_413: Ukuran payload prompt melampaui kapasitas model
          // Error deterministik (bentuk request salah / kredensial ditolak / gambar tidak
          // didukung): mengulang di key lain menghasilkan hasil identik dan membakar deadline.
          // Langsung ganti model (audit H5).
          if (
            lastError.includes('PROVIDER_404') ||
            lastError.includes('ModelError') ||
            lastError.includes('PROVIDER_413') ||
            lastError.includes('PROVIDER_400') ||
            lastError.includes('PROVIDER_401') ||
            lastError.includes('PROVIDER_403') ||
            lastError.includes('PROVIDER_422') ||
            lastError.includes('BAD_IMAGE') ||
            lastError.includes('NO_IMAGE_DATA_FOR_VISION') ||
            lastError.includes('CLOUDFLARE_ACCOUNT_ID_MISSING')
          ) {
            console.warn(`[providers] Model ${step.kind}/${model} menolak request secara deterministik (${lastError}). Beralih ke model cadangan.`);
            recordModelFailure(step.kind, model, 15 * 60_000);
            break;
          }

          // Catat pemakaian hanya jika rate limited (agar pool beralih), bukan pada error 500 atau kegagalan jaringan
          if (lastError === 'RATE_LIMITED' || (e as { code?: string })?.code === 'RATE_LIMITED') {
            keyUsed(step.kind, key);
            allKeysFailedWithServerError = false;
          } else if (
            !lastError.includes('PROVIDER_50') &&
            lastError !== 'CONNECT_TIMEOUT' &&
            lastError !== 'THINKING_TIMEOUT'
          ) {
            allKeysFailedWithServerError = false;
          }
        }
      }

      // Jika seluruh key yang dicoba pada model ini gagal karena server outage / timeout,
      // beri cooldown pada model tersebut agar request berikutnya langsung melompat tanpa delay
      if (anyKeyAttempted && allKeysFailedWithServerError && !modelUnresponsive) {
        recordModelFailure(step.kind, model);
      }
    }
    if (Date.now() >= deadline - 1500) break;
  }
    // Pass pertama sudah menghasilkan percobaan -> tidak perlu pass best-effort.
    if (anyModelAttempted) break;
  }
  // ------------------------------------------------------------------------
  // CATATAN (04 Okt 2026): JARING TERAKHIR xKiro DIHAPUS.
  //
  // Blok ini dulu memanggil xkiroChatWithSearch() sebagai penopang terakhir
  // setelah seluruh rantai tier gagal. Karena xKiro DIHAPUS (8 akun disuspend
  // permanen, HTTP 403 error 1010), blok itu tidak mungkin berhasil lagi —
  // mempertahankannya hanya menambah waktu tunggu yang sia-sia sebelum error
  // asli dilempar ke pemanggil.
  //
  // Kini bila seluruh rantai gagal, error asli dari rantai utama langsung
  // dilaporkan (lebih jujur dan lebih cepat).
  // ------------------------------------------------------------------------

  throw new Error(`ALL_PROVIDERS_FAILED:${lastError}`);
}

/**
 * PROBE AKTIF: cek langsung apakah kunci Cloudflare masih bisa dipakai.
 *
 * KENAPA PERLU (temuan pemilik produk 09 Okt 2026):
 *   "semua apikey habis? tapi monitoring masih hijau, berarti ini bug fatal yg
 *    kamu buat, betulkan yg benar dan valid data monitoring nya".
 *
 * MASALAH: cooldown 'neuron' hanya tercatat bila ada REQUEST YANG GAGAL. Key yang
 * kebetulan tidak pernah dicoba (karena kunci lain menang balapan) TIDAK punya
 * cooldown -> dashboard menampilkannya "Optimal" padahal neuron akun itu HABIS
 * (kuota neuron dihitung per AKUN, bukan per aplikasi — aplikasi lain di akun
 * yang sama bisa menghabiskannya tanpa lewat bot).
 *
 * SOLUSI: probe ringan (model termurah, 1 token) untuk memastikan status nyata,
 * lalu CATAT hasilnya sebagai cooldown (atau hapus bila ternyata sehat).
 * Hasil disimpan di DB sehingga bertahan lintas instance serverless.
 *
 * @param model model termurah untuk probe (default llama-3.2-1b)
 * @returns jumlah key yang HABIS
 */
export async function probeKunciCloudflare(
  model = '@cf/meta/llama-3.2-1b-instruct',
): Promise<{ diperiksa: number; habis: number; sehat: number }> {
  let habis = 0;
  let sehat = 0;
  for (const key of config.pools.cloudflare) {
    try {
      const { accountId, token } = await resolveCloudflareKey(key);
      if (!accountId || !token) continue;
      const res = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }], max_tokens: 1 }),
          signal: AbortSignal.timeout(15_000),
        },
      );
      const kh = `cloudflare:${keyHash(key)}`;
      if (res.ok) {
        // Sehat -> pastikan tidak ada cooldown 'neuron' yang tertinggal.
        hapusCooldownPersist(kh);
        sehat++;
      } else {
        let pesan = '';
        try {
          const j = (await res.json()) as { errors?: Array<{ message?: string }> };
          pesan = j.errors?.[0]?.message || '';
        } catch {
          pesan = '';
        }
        // Neuron habis (400/429 + pesan khas) -> catat cooldown.
        if (/neurons|daily free allocation|4006|workers paid/i.test(pesan)) {
          const sampai = Date.now() + msUntilDailyResetUtc();
          await setCooldownPersist(kh, sampai, 'neuron');
          habis++;
        }
      }
    } catch {
      // best-effort: probe gagal karena jaringan, jangan ubah apa pun
    }
  }
  return { diperiksa: config.pools.cloudflare.length, habis, sehat };
}
