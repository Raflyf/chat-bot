import crypto from 'crypto';
import { config } from './env.js';
import { isKeyAllowed, keyUsed, keyTokensUsed, keyTokensUsedToday, keyRequestsUsedToday, ensureKeyQuotaHydrated, ProviderKind } from './quota.js';

// --- CIRCUIT BREAKER & ADAPTIVE KEY ROUTING (LATENCY OPTIMIZER) ---
const keyCooldownMap = new Map<string, number>(); // `${kind}:${keyHash}` -> timestamp cooldown
// ROTASI KEY (round-robin) — keputusan user: "apikey 1 2 3 dipakai bergiliran".
// Sebelumnya sistem memakai STICKY key (key sukses terakhir selalu diprioritaskan),
// akibatnya key pertama dipakai terus sampai kuotanya habis sementara key lain nyaris
// tak tersentuh (temuan nyata: key ...6386 tembus 1.004.173 token, key ...8a6b masih 0).
// Sekarang indeks rotasi bergilir tiap panggilan sehingga pemakaian merata.
const keyRotationIndexMap = new Map<ProviderKind, number>();
const modelCooldownMap = new Map<string, number>(); // `${kind}:${model}` -> timestamp cooldown

function keyHash(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 12);
}

function recordKeySuccess(kind: ProviderKind, key: string, model: string): void {
  // Tidak ada lagi sticky key: rotasi ditangani getOrderedKeys (round-robin).
  keyCooldownMap.delete(`${kind}:${keyHash(key)}`);
  modelCooldownMap.delete(`${kind}:${model}`);
}

function recordKeyFailure(kind: ProviderKind, key: string, err: unknown): void {
  const kh = `${kind}:${keyHash(key)}`;
  const msg = err instanceof Error ? err.message : String(err);

  // Jika rate limited (429), cooldown 60s
  if (msg === 'RATE_LIMITED' || (err as { code?: string })?.code === 'RATE_LIMITED' || msg.includes('429')) {
    keyCooldownMap.set(kh, Date.now() + 60_000);
    return;
  }

  // Jika 401/403 atau CreditsError (kunci salah / izin ditolak / kredit akun habis), cooldown 5 menit
  if (msg.includes('PROVIDER_401') || msg.includes('PROVIDER_403') || msg.includes('CreditsError')) {
    keyCooldownMap.set(kh, Date.now() + 300_000);
    return;
  }

  // Jika timeout koneksi atau hang, cooldown 2 menit agar request berikutnya langsung ke kunci sehat
  if (msg === 'CONNECT_TIMEOUT' || msg === 'THINKING_TIMEOUT') {
    keyCooldownMap.set(kh, Date.now() + 120_000);
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
    const cd = keyCooldownMap.get(kh) || 0;
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

  // Pengaman keseimbangan: dahulukan key yang paling sedikit terpakai hari ini
  // (request sebagai metrik utama, token sebagai tie-break) agar rotasi tidak
  // perlahan drift ke satu key ketika jumlah request tidak persis merata.
  rotated.sort((a, b) => {
    const reqDiff = keyUsageToday(kind, a, 'req') - keyUsageToday(kind, b, 'req');
    if (reqDiff !== 0) return reqDiff;
    return keyUsageToday(kind, a, 'tokens') - keyUsageToday(kind, b, 'tokens');
  });
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
    const err = new Error('RATE_LIMITED') as Error & { code?: string };
    err.code = 'RATE_LIMITED';
    throw err;
  }
  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    console.warn(`[providers] Upstream error dari ${url}: status=${res.status}, body=${errBody.slice(0, 300)}`);
    throw new Error(`PROVIDER_${res.status}:${errBody.slice(0, 100)}`);
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
      const err = new Error('RATE_LIMITED') as Error & { code?: string };
      err.code = 'RATE_LIMITED';
      throw err;
    }
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      console.warn(`[providers] Upstream error dari ${url}: status=${res.status}, body=${errBody.slice(0, 300)}`);
      throw new Error(`PROVIDER_${res.status}:${errBody.slice(0, 100)}`);
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
  const j = json as { choices?: Array<{ delta?: { content?: string | null; reasoning?: string | null } }> };
  const delta = j.choices?.[0]?.delta;
  if (!delta) return {};
  const out: StreamDelta = {};
  if (typeof delta.content === 'string' && delta.content.length > 0) out.text = delta.content;
  // Reasoning tersembunyi (thinking model) juga bukti model AKTIF — reset idle timer
  // agar model reasoning panjang tidak salah dianggap hang.
  if (typeof delta.reasoning === 'string' && delta.reasoning.length > 0) out.active = true;
  return out;
}

function openAiUsage(json: unknown): ProviderResult['tokens'] | undefined {
  const u = (json as { usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } }).usage;
  if (!u) return undefined;
  return {
    prompt: Number(u.prompt_tokens) || 0,
    completion: Number(u.completion_tokens) || 0,
    total: Number(u.total_tokens) || 0,
  };
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
  const body = {
    model,
    messages,
    max_tokens: maxTokensOverride ?? config.maxOutputTokens,
    temperature: 0.7,
    presence_penalty: 0.5,
    frequency_penalty: 0.3,
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
    const firstTokenMs = hasImage ? config.visionFirstTokenMs : Math.min(connectMs, config.firstTokenTimeoutMs);
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
      temperature: 0.7,
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
  if (messages.length <= 2) return messages;

  const estimateTokens = (msgs: ChatMsg[]) => {
    let chars = 0;
    for (const m of msgs) {
      if (typeof m.content === 'string') {
        chars += m.content.length;
      } else if (Array.isArray(m.content)) {
        for (const part of m.content) {
          if (part.type === 'text') chars += part.text.length;
        }
      }
    }
    // Rasio konservatif 3,3 karakter/token (terukur ~3,4 pada output nyata) agar
    // pemakaian token AKTUAL tetap di bawah ambang — termasuk batas ketat 8K TPM Groq.
    return Math.ceil(chars / 3.3);
  };

  let totalTokens = estimateTokens(messages);
  if (totalTokens <= maxBudgetTokens) return messages;

  const systemMsg = messages[0];
  const lastUserMsg = messages[messages.length - 1];
  const history = messages.slice(1, -1);

  // Buang riwayat tertua satu per satu hingga estimasi token muat di bawah budget
  while (history.length > 0 && totalTokens > maxBudgetTokens) {
    history.shift();
    totalTokens = estimateTokens([systemMsg, ...history, lastUserMsg]);
  }

  return [systemMsg, ...history, lastUserMsg];
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

function steps(): Step[] {
  return [
    // --- TIER 1: xKiro Gateway (primer teks) ---
    {
      kind: 'xkiro',
      keys: config.pools.xkiro,
      models: [config.models.xkiroPrimary, ...config.models.xkiroBackup],
      cap: config.dailyCap.xkiro,
      maxPromptTokens: 0, // tidak ada batas ITPM ketat yang diketahui
      run: (k, m, msgs, t) => {
        const isDeepSeek = m.toLowerCase().includes('deepseek');
        return openAiChat('https://api.xkiro.com/v1', k, m, msgs, undefined, {
          // Effort reasoning MINIMAL (keputusan user). Hasil uji: 'none' membuat
          // MiniMax M3 (kini khusus rantai multimodal) membalas KOSONG, jadi 'minimal' yang dipakai.
          reasoning: { effort: 'minimal' },
          // Sampling luwes agar output DeepSeek mengalir alami & dinamis
          temperature: isDeepSeek ? 0.65 : 0.35,
          presence_penalty: isDeepSeek ? 0.1 : 0.0,
          frequency_penalty: isDeepSeek ? 0.1 : 0.0,
        }, t);
      },
    },
    // --- TIER 2: Cloudflare Workers AI (KEPATUHAN SEMPURNA 4/4) ---
    // DINAIKKAN ke Tier 2 (20 Sep) berdasarkan UJI KEPATUHAN LIVE: satu-satunya
    // provider dengan hasil SEMPURNA MENYELURUH — 4 dari 4 model patuh penuh pada
    // aturan inti (tidak sebut diri bot, tidak bocorkan proses berpikir, tidak pakai
    // template CS, tidak ada narasi aksi, emoji wajar, panjang wajar).
    // Latensi terukur: glm-4.7-flash 1224ms (tercepat) s/d llama-3.3-70b 3163ms.
    // Kapasitas: 3 key x 10.000 Neuron/hari — dipakai lebih dulu sampai habis, lalu
    // otomatis jatuh ke tier berikutnya (guard cap sudah menangani).
    {
      kind: 'cloudflare',
      keys: config.pools.cloudflare,
      models: [config.models.cfPrimary, ...config.models.cfBackup],
      cap: config.dailyCap.cloudflare,
      maxPromptTokens: 0,
      run: (k, m, msgs, t) => cloudflareChat(k, m, msgs, t),
    },
    // --- TIER 3: Groq Cloud API (KEPATUHAN SEMPURNA 2/2 + TERCEPAT) ---
    // UJI KEPATUHAN LIVE: qwen3.8-27b & gpt-oss-120b = PATUH SEMPURNA, dan keduanya
    // adalah model TERCEPAT dari seluruh pool (763-1202ms).
    // KETERBATASAN: ITPM ketat 7.000 (429 terbukti) — untuk prompt besar provider ini
    // otomatis DILEWATI oleh guard maxPromptTokens, jadi tidak pernah jadi bottleneck.
    {
      kind: 'groq',
      keys: config.pools.groq,
      models: [config.models.groqPrimary, ...config.models.groqBackup],
      cap: config.dailyCap.groq,
      // LIMIT GROQ — dua sumber, dan yang dipakai adalah yang EMPIRIS:
      //   Console Groq menampilkan : 30 RPM | 8K TPM | 1K RPD | 200K TPD
      //   429 dari API menyebut    : "Limit 7000" (diuji 4 ukuran prompt, konsisten)
      // Guard memakai 7000 karena itulah ambang yang BENAR-BENAR menolak request.
      //
      // EFISIENSI TOKEN (instruksi user: Groq harus tetap terpakai bila model lain mati):
      // nilai ini diperiksa SEBELUM trim, jadi diset LEBIH TINGGI dari batas efektif
      // (6.800) agar percakapan dengan riwayat panjang TIDAK dilewati — trim di `run`
      // yang akan memangkasnya sampai muat. Tanpa ini Groq selalu dilewati begitu
      // riwayat obrolan sedikit menumpuk, padahal setelah dipangkas masih muat.
      // 1.4x dari 6.800 = 9.520: cukup longgar untuk riwayat wajar, tetap menolak
      // prompt yang benar-benar raksasa (yang tidak bisa diselamatkan trim).
      maxPromptTokens: 9500,
      run: (k, m, msgs, t) => {
        // Pangkas pesan agar total (prompt + output 800) benar-benar di bawah limit ketat Groq 8K TPM
        // (6.800 + 800 = 7.600, menyisakan margin 400 token agar tidak mudah kena 429).
        const groqMsgs = trimMessagesToTokenBudget(msgs, 6800);
        return openAiChat('https://api.groq.com/openai/v1', k, m, groqMsgs, 800, {
          reasoning_effort: 'none',
          // Jinakkan sampling Qwen kecil: suhu + repetisi rendah agar tahan prompt panjang
          temperature: 0.45,
          presence_penalty: 0.0,
          frequency_penalty: 0.4,
        }, t);
      },
    },
    // --- TIER 4: OpenRouter (free models — cadangan luas) ---
    // INSTRUKSI USER (21 Sep): primary = nex-agi/nex-n2.5-mini:free (uji: 3/3 lolos,
    // 506ms = tercepat di katalog OR). Backup: ling-3.0-flash-fin (1041ms, 3/3 lolos).
    // Kuota per-key 50 request :free/hari -> lapisan cadangan sebelum Dahl & Gemini.
    {
      kind: 'openrouter',
      keys: config.pools.openrouter,
      models: [config.models.orPrimary, ...config.models.orBackup],
      cap: config.dailyCap.openrouter,
      maxPromptTokens: 0,
      run: (k, m, msgs, t) =>
        openAiChat('https://openrouter.ai/api/v1', k, m, msgs, undefined, {
          // Thinking off (keputusan user): 3,5 dtk -> ~1 dtk, output tetap bersih.
          reasoning: { effort: 'none' },
        }, t),
    },
    // --- TIER 5: Dahl Global (SALDO BESAR 1 MILIAR TOKEN — penyelamat jangka panjang) ---
    // INSTRUKSI USER (21 Sep): primary = deepseek-ai/DeepSeek-V4-Flash-0731.
    // KENAPA PENTING: saldo 10 key x 100M = 1 MILIAR token (bukan kuota harian),
    // TIDAK ada rate limit ITPM ketat, latensi p50 ~0,23 dtk. Penyelamat ketika semua
    // kuota harian (Cloudflare/Groq/Gemini) habis.
    // BACKUP = KOSONG (bukan kelalaian): uji lanjutan 21 Sep membuktikan 2 model lain Dahl
    // TIDAK LAYAK — GLM-5.3-Flash membalas KOSONG selama 27,6 dtk, MiniMax-M2.7
    // membocorkan <think>. Lebih baik failover langsung ke Gemini daripada membuang
    // waktu rantai ke backup yang terbukti rusak.
    {
      kind: 'dahl',
      keys: config.pools.dahl,
      models: [config.models.dahlPrimary, ...config.models.dahlBackup],
      cap: config.dailyCap.dahl,
      maxPromptTokens: 0,
      run: (k, m, msgs, t) => {
        const isDeepSeek = m.toLowerCase().includes('deepseek');
        // Tuning terbukti: thinking off + temperature/penalty luwes -> output bersih.
        return openAiChat(config.dahlProxyUrl, k, m, msgs, 800, {
          reasoning_effort: 'none',
          temperature: isDeepSeek ? 0.65 : 0.45,
          frequency_penalty: isDeepSeek ? 0.1 : 0.5,
          presence_penalty: isDeepSeek ? 0.1 : 0.0,
        }, t);
      },
    },
    // --- TIER 6: Google Gemini API (1M konteks — lapisan terakhir) ---
    // UJI KEPATUHAN LIVE (dengan thinkingBudget:0 sesuai konfig produksi): gemini-3.8-flash
    // 3506ms & gemini-3.5-flash 11210ms — keduanya PATUH SEMPURNA.
    // Diletakkan terakhir karena: (a) hanya 1 key (1.500 RPD), (b) gemini-3.5-flash
    // lambat (11 dtk), (c) berguna sebagai jaring terakhir dengan konteks 1M.
    {
      kind: 'gemini',
      keys: config.pools.gemini,
      models: [config.models.geminiPrimary, ...config.models.geminiBackup],
      cap: config.dailyCap.gemini,
      maxPromptTokens: 0, // 1M TPM — jauh di atas kebutuhan
      run: (k, m, msgs, t) => geminiChat(k, m, msgs, t),
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
  opts?: { vision?: boolean },
): Promise<{ text: string; via: string; tokens?: { prompt: number; completion: number; total: number } }> {
  const needVision = opts?.vision === true;
  // Batasi total token maksimal sesuai batas config.maxTokensLimit (default 8000)
  const messages = trimMessagesToTokenBudget(rawMessages, config.maxTokensLimit);
  const cacheKey = JSON.stringify({ v: needVision, messages });
  const hit = cacheGet(cacheKey);
  if (hit) return { text: hit, via: 'cache' };

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
  // Untuk vision: rantai eksplisit dari config.models.visionChain (urutan mutlak sesuai
  // keputusan review user, tidak disusun ulang oleh pengurutan latensi).
  const orderedSteps = needVision ? visionSteps(allSteps, messages) : allSteps;

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
    if (step.maxPromptTokens > 0 && promptTokensEstimate > step.maxPromptTokens) {
      if (!allowCoolingPass) {
        console.warn(
          `[providers] Lewati ${step.kind}: prompt ~${promptTokensEstimate} token melebihi batas ITPM ${step.maxPromptTokens}.`,
        );
      }
      continue;
    }
    // Urutkan model dalam tier ini berdasarkan latensi terukur (gesit di depan, lambat di belakang).
    // Rantai vision dibiarkan apa adanya karena tiap step hanya berisi satu model.
    const models = needVision ? step.models : orderModelsByLatency(step.kind, step.models);
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

      for (const key of candidateKeys) {
        if (modelUnresponsive) break;
        // Guard RPD + TPD (token/hari): hentikan pool sebelum menabrak 429 upstream.
        // Groq Free Tier: 1.000 RPD DAN 200K TPD — TPD biasanya tercapai lebih dulu.
        // try/catch: kegagalan DB kuota (mis. URL Supabase buruk) tidak boleh membatalkan
        // seluruh rantai failover — tanpa ini satu error DB melempar keluar dari chat() (audit H2).
        let keyAllowed = true;
        try {
          // Cap token per-key bila dikonfigurasi (limit tiap key bisa berbeda — kasus xKiro:
          // key #1 1jt token vs key #2/#3 500k). Fallback ke cap seragam provider.
          const perKeyCaps = config.dailyTokenCapPerKey[step.kind] || [];
          const keyIndex = step.keys.indexOf(key);
          const keyTokenCap =
            keyIndex >= 0 && keyIndex < perKeyCaps.length
              ? perKeyCaps[keyIndex]
              : config.dailyTokenCap[step.kind] || 0;
          keyAllowed = await isKeyAllowed(step.kind, key, step.cap, keyTokenCap);
        } catch (quotaErr) {
          console.warn(`[providers] Gagal cek kuota key ${step.kind} (${String((quotaErr as Error)?.message ?? quotaErr).slice(0, 80)}). Lanjut tanpa guard kuota.`);
          keyAllowed = true;
        }
        if (!keyAllowed) continue;
        const remainingMs = deadline - Date.now();
        if (remainingMs < 1500) {
          lastError = 'CHAIN_DEADLINE';
          break;
        }
        anyKeyAttempted = true;
        const attemptStart = Date.now();
        try {
          // `t` = sisa anggaran rantai (dibatasi timeout per-request) agar attempt ini tidak melewati deadline
          const result = await step.run(key, model, messages, Math.min(remainingMs, config.timeoutMs));
          recordKeySuccess(step.kind, key, model);
          // Catat latensi aktual untuk failover berbasis waktu respons pada request berikutnya
          recordModelLatency(step.kind, model, Date.now() - attemptStart);
          keyUsed(step.kind, key);
          // Catat token harian (TPD) agar limit token upstream terpantau presisi
          if (result.tokens?.total) {
            keyTokensUsed(step.kind, key, result.tokens.total);
          }
          cacheSet(cacheKey, result.text);
          return { text: result.text, via: `${step.kind}/${model}`, tokens: result.tokens };
        } catch (e) {
          lastError = e instanceof Error ? e.message : 'UNKNOWN';
          recordKeyFailure(step.kind, key, e);
          console.warn(`[providers] Kegagalan key pada ${step.kind}/${model} (key: ${key.slice(0, 10)}...): ${lastError}. Mencoba key berikutnya...`);

          // FASE 1 timeout: model TIDAK merespon sama sekali dalam batas singkat.
          // Ini masalah model/provider (bukan key) → failover LANGSUNG ke model berikutnya,
          // tanpa mencoba key lain untuk model yang sama (menghindari tunggu berulang).
          if (lastError === ERR_NO_FIRST_TOKEN) {
            console.warn(`[providers] Model ${step.kind}/${model} tidak merespon (fase-1 ${config.firstTokenTimeoutMs}ms). Failover cepat ke model berikutnya.`);
            recordModelFailure(step.kind, model, 3 * 60_000);
            modelUnresponsive = true;
            break;
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
  throw new Error(`ALL_PROVIDERS_FAILED:${lastError}`);
}
