import crypto from 'crypto';
import { config } from './env.js';
import { isKeyAllowed, keyUsed, keyTokensUsed, ensureKeyQuotaHydrated, ProviderKind } from './quota.js';

// --- CIRCUIT BREAKER & ADAPTIVE KEY ROUTING (LATENCY OPTIMIZER) ---
const keyCooldownMap = new Map<string, number>(); // `${kind}:${keyHash}` -> timestamp cooldown
const lastSuccessfulKeyMap = new Map<ProviderKind, string>(); // kind -> key
const modelCooldownMap = new Map<string, number>(); // `${kind}:${model}` -> timestamp cooldown

function keyHash(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 12);
}

function recordKeySuccess(kind: ProviderKind, key: string, model: string): void {
  lastSuccessfulKeyMap.set(kind, key);
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

function getOrderedKeys(kind: ProviderKind, keys: string[]): string[] {
  if (keys.length <= 1) return keys;
  const now = Date.now();
  const lastSuccess = lastSuccessfulKeyMap.get(kind);

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

  // Jika key sukses terakhir ada dan sehat, tempatkan di prioritas #1 (sticky key)
  if (lastSuccess && healthy.includes(lastSuccess)) {
    healthy.sort((a, b) => (a === lastSuccess ? -1 : b === lastSuccess ? 1 : 0));
  }

  // Utamakan key yang sehat. Jika seluruh key sedang cooling, gunakan cooling sebagai fallback darurat
  return healthy.length > 0 ? healthy : cooling;
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
    return Math.ceil(chars / 3.8);
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
      run: (k, m, msgs, t) => {
        const isDeepSeek = m.toLowerCase().includes('deepseek');
        return openAiChat('https://api.xkiro.com/v1', k, m, msgs, undefined, {
          // Effort reasoning MINIMAL (keputusan user). Hasil uji: 'none' membuat
          // MiniMax M3 membalas KOSONG, jadi 'minimal' yang dipakai.
          reasoning: { effort: 'minimal' },
          // Sampling luwes agar output DeepSeek mengalir alami & dinamis
          temperature: isDeepSeek ? 0.65 : 0.35,
          presence_penalty: isDeepSeek ? 0.1 : 0.0,
          frequency_penalty: isDeepSeek ? 0.1 : 0.0,
        }, t);
      },
    },
    // --- TIER 2: OpenRouter (free models) ---
    {
      kind: 'openrouter',
      keys: config.pools.openrouter,
      models: [config.models.orPrimary, ...config.models.orBackup],
      cap: config.dailyCap.openrouter,
      run: (k, m, msgs, t) =>
        openAiChat('https://openrouter.ai/api/v1', k, m, msgs, undefined, {
          // Thinking off (keputusan user): 3,5 dtk -> ~1 dtk, output tetap bersih.
          reasoning: { effort: 'none' },
        }, t),
    },
    // --- TIER 3: Groq Cloud API (LPU ultra-cepat) ---
    {
      kind: 'groq',
      keys: config.pools.groq,
      models: [config.models.groqPrimary, ...config.models.groqBackup],
      cap: config.dailyCap.groq,
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
    // --- TIER 4: Cloudflare Workers AI ---
    {
      kind: 'cloudflare',
      keys: config.pools.cloudflare,
      models: [config.models.cfPrimary, ...config.models.cfBackup],
      cap: config.dailyCap.cloudflare,
      run: (k, m, msgs, t) => cloudflareChat(k, m, msgs, t),
    },
    // --- TIER 5: Google Gemini API (1M konteks) ---
    {
      kind: 'gemini',
      keys: config.pools.gemini,
      models: [config.models.geminiPrimary, ...config.models.geminiBackup],
      cap: config.dailyCap.gemini,
      run: (k, m, msgs, t) => geminiChat(k, m, msgs, t),
    },
    // --- TIER 6: Dahl Global API (1B token pool) ---
    {
      kind: 'dahl',
      keys: config.pools.dahl,
      models: [config.models.dahlPrimary, ...config.models.dahlBackup],
      cap: config.dailyCap.dahl,
      run: (k, m, msgs, t) => {
        const isDeepSeek = m.toLowerCase().includes('deepseek');
        return openAiChat(config.dahlProxyUrl, k, m, msgs, 800, {
          // Thinking off (keputusan user): ~0,25 dtk dengan output bersih.
          // 'minimal' justru memunculkan teks berulang + karakter zero-width di model ini.
          reasoning_effort: 'none',
          temperature: isDeepSeek ? 0.65 : 0.45,
          frequency_penalty: isDeepSeek ? 0.1 : 0.5,
          presence_penalty: isDeepSeek ? 0.1 : 0.0,
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
function visionSteps(all: Step[]): Step[] {
  const byKind = new Map(all.map((s) => [s.kind, s]));
  const out: Step[] = [];
  for (const entry of config.models.visionChain) {
    const base = byKind.get(entry.kind);
    if (!base) continue;
    out.push({ ...base, models: [entry.model] });
  }
  return out;
}

/**
 * Chat dengan failover cerdas:
 * - Teks umum / matematika / koding: xKiro (Qwen 3.8 Max > MiniMax M3) > OpenRouter (DeepSeek V4 Flash > Nex N2.5 Pro > Nemotron Lightning) > Groq (Qwen 3.8 > GPT-OSS 120B) > Cloudflare (Qwen 3.8 > GLM 4.7 > GPT-OSS > Llama 3.3) > Gemini (3.8 > 3.5) > Dahl (DeepSeek V4 Flash > GLM 5.3 > MiniMax M2.7).
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
  // Untuk vision: rantai eksplisit dari config.models.visionChain (urutan mutlak sesuai
  // keputusan review user, tidak disusun ulang oleh pengurutan latensi).
  const orderedSteps = needVision ? visionSteps(allSteps) : allSteps;

  // Anggaran waktu TOTAL seluruh rantai failover: pagar agar satu model yang menggantung
  // tidak menghabiskan jatah serverless. Sisa anggaran diteruskan ke tiap attempt (`t`).
  const deadline = Date.now() + config.chainDeadlineMs;

  for (const step of orderedSteps) {
    if (Date.now() >= deadline - 1500) break;
    // Urutkan model dalam tier ini berdasarkan latensi terukur (gesit di depan, lambat di belakang).
    // Rantai vision dibiarkan apa adanya karena tiap step hanya berisi satu model.
    const models = needVision ? step.models : orderModelsByLatency(step.kind, step.models);
    for (const model of models) {
      // Fast-pass: Lewati model yang sedang dalam cooldown server error (0ms overhead)
      if (isModelCoolingDown(step.kind, model)) {
        continue;
      }

      const candidateKeys = getOrderedKeys(step.kind, step.keys);
      let anyKeyAttempted = false;
      let allKeysFailedWithServerError = true;
      let modelUnresponsive = false;

      for (const key of candidateKeys) {
        if (modelUnresponsive) break;
        // Guard RPD + TPD (token/hari): hentikan pool sebelum menabrak 429 upstream.
        // Groq Free Tier: 1.000 RPD DAN 200K TPD — TPD biasanya tercapai lebih dulu.
        if (!(await isKeyAllowed(step.kind, key, step.cap, config.dailyTokenCap[step.kind] || 0))) continue;
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
          if (
            lastError.includes('PROVIDER_404') ||
            lastError.includes('ModelError') ||
            lastError.includes('PROVIDER_413')
          ) {
            console.warn(`[providers] Model ${step.kind}/${model} tidak valid atau payload melampaui batas (${lastError}). Beralih ke model cadangan.`);
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
  throw new Error(`ALL_PROVIDERS_FAILED:${lastError}`);
}
