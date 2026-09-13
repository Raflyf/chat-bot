import crypto from 'crypto';
import { config } from './env.js';
import { isKeyAllowed, keyUsed, ensureKeyQuotaHydrated, ProviderKind } from './quota.js';

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

  // Jika 401/403 (kunci salah / izin ditolak), cooldown 5 menit
  if (msg.includes('PROVIDER_401') || msg.includes('PROVIDER_403')) {
    keyCooldownMap.set(kh, Date.now() + 300_000);
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
  if (!res.ok) throw new Error(`PROVIDER_${res.status}`);

  // Tier 2: Model aktif dan sedang berpikir / menghasilkan konten
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

async function postJson(url: string, key: string, body: unknown): Promise<unknown> {
  return await fetchJsonWithLifecycle(
    url,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    config.connectTimeoutMs,
    config.timeoutMs,
  );
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
): Promise<ProviderResult> {
  const data = (await postJson(`${baseUrl}/chat/completions`, key, {
    model,
    messages,
    max_tokens: maxTokensOverride ?? config.maxOutputTokens,
    temperature: 0.7,
    presence_penalty: 0.5,
    frequency_penalty: 0.3,
    ...extraBody,
  })) as {
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
    config.connectTimeoutMs,
    config.timeoutMs,
  )) as {
    result?: {
      response?: string;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };
  };

  const rawText = data.result?.response?.trim() ?? '';
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
): Promise<ProviderResult> {
  const { accountId, token } = await resolveCloudflareKey(rawKey);
  if (!accountId) {
    throw new Error('CLOUDFLARE_ACCOUNT_ID_MISSING');
  }
  if (model === config.models.cfVision || model.includes('vision')) {
    return await cloudflareVisionChat(accountId, token, model, messages);
  }
  const baseUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1`;
  return await openAiChat(baseUrl, token, model, messages);
}

async function openCodeChat(
  key: string,
  model: string,
  messages: ChatMsg[],
): Promise<ProviderResult> {
  const lines: string[] = [];
  for (const m of messages) {
    const content =
      typeof m.content === 'string'
        ? m.content
        : m.content
            .map((p) => (p.type === 'text' ? p.text : ''))
            .filter(Boolean)
            .join(' ');
    if (!content.trim()) continue;
    if (m.role === 'system') {
      lines.push(`[Instruksi Sistem]\n${content}`);
    } else if (m.role === 'user') {
      lines.push(`User: ${content}`);
    } else if (m.role === 'assistant') {
      lines.push(`Assistant: ${content}`);
    }
  }
  const input = lines.join('\n\n');

  const headers: Record<string, string> = {
    'Authorization': `Bearer ${key}`,
    'Content-Type': 'application/json',
    'User-Agent': 'opencode',
    'x-opencode-client': 'desktop',
    'x-opencode-project': 'global',
    'x-opencode-session': crypto.randomUUID(),
    'x-opencode-request': crypto.randomUUID(),
  };

  const data = (await fetchJsonWithLifecycle(
    'https://opencode.ai/zen/v1/responses',
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        input,
        reasoning: { effort: 'minimal' },
      }),
    },
    Math.max(config.connectTimeoutMs, 10000),
    config.timeoutMs,
  )) as {
    output?: Array<{ type?: string; content?: Array<{ text?: string }> }>;
    usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
  };

  const msg = data.output?.find((o) => o.type === 'message');
  const rawText = msg?.content?.[0]?.text?.trim() ?? '';
  const text = cleanModelOutput(rawText);
  if (!text) throw new Error('EMPTY_RESPONSE');

  const tokens = data.usage
    ? {
        prompt: Number(data.usage.input_tokens) || 0,
        completion: Number(data.usage.output_tokens) || 0,
        total: Number(data.usage.total_tokens) || 0,
      }
    : undefined;

  return { text, tokens };
}

async function geminiChat(key: string, model: string, messages: ChatMsg[]): Promise<ProviderResult> {
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
    generationConfig: { maxOutputTokens: config.maxOutputTokens, temperature: 0.7 },
  };
  if (system) {
    const sysText = typeof system.content === 'string'
      ? system.content
      : Array.isArray(system.content)
        ? system.content.map(p => typeof p === 'string' ? p : (p as any).text || '').join('\n')
        : String(system.content || '');
    body.systemInstruction = { parts: [{ text: sysText }] };
  }

  const data = (await fetchJsonWithLifecycle(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    config.connectTimeoutMs,
    config.timeoutMs,
  )) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
      totalTokenCount?: number;
    };
  };

  const rawText = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('').trim() ?? '';
  const text = cleanModelOutput(rawText);
  if (!text) throw new Error('EMPTY_RESPONSE');
  const tokens = data.usageMetadata
    ? {
        prompt: Number(data.usageMetadata.promptTokenCount) || 0,
        completion: Number(data.usageMetadata.candidatesTokenCount) || 0,
        total: Number(data.usageMetadata.totalTokenCount) || 0,
      }
    : undefined;
  return { text, tokens };
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
  /** Subset models yang terbukti vision-capable. Kosong = step dilewati saat butuh vision. */
  visionModels: string[];
  cap: number;
  run: (key: string, model: string, messages: ChatMsg[]) => Promise<ProviderResult>;
}

function steps(): Step[] {
  return [
    {
      kind: 'dahl',
      keys: config.pools.dahl,
      models: [config.models.dahlPrimary, config.models.dahlBackup],
      visionModels: [],
      cap: config.dailyCap.dahl,
      run: (k, m, msgs) => openAiChat('https://inference.dahl.global/v1', k, m, msgs),
    },
    {
      kind: 'groq',
      keys: config.pools.groq,
      models: [config.models.groqPrimary, config.models.groqBackup],
      visionModels: [],
      cap: config.dailyCap.groq,
      run: (k, m, msgs) => {
        // Pangkas pesan agar total (prompt + output 800) muat di bawah limit ketat Groq 8K TPM
        const groqMsgs = trimMessagesToTokenBudget(msgs, 7200);
        return openAiChat('https://api.groq.com/openai/v1', k, m, groqMsgs, 800, {
          reasoning_effort: 'none',
        });
      },
    },
    {
      kind: 'opencode',
      keys: config.pools.opencode,
      models: [config.models.openCodePrimary, config.models.openCodeBackup],
      visionModels: [],
      cap: config.dailyCap.opencode,
      run: (k, m, msgs) => openCodeChat(k, m, msgs),
    },
    {
      kind: 'gemini',
      keys: config.pools.gemini,
      models: [config.models.geminiPrimary, config.models.geminiBackup],
      visionModels: [config.models.geminiPrimary, config.models.geminiBackup],
      cap: config.dailyCap.gemini,
      run: (k, m, msgs) => geminiChat(k, m, msgs),
    },
    {
      kind: 'cloudflare',
      keys: config.pools.cloudflare,
      models: [config.models.cfPrimary, config.models.cfBackup],
      visionModels: [config.models.cfVision],
      cap: config.dailyCap.cloudflare,
      run: (k, m, msgs) => cloudflareChat(k, m, msgs),
    },
    {
      kind: 'openrouter',
      keys: config.pools.openrouter,
      models: [config.models.orPrimary, config.models.orText, config.models.orMini],
      visionModels: [config.models.orPrimary, config.models.orMini],
      cap: config.dailyCap.openrouter,
      run: (k, m, msgs) => openAiChat('https://openrouter.ai/api/v1', k, m, msgs),
    },
    {
      kind: 'xkiro',
      keys: config.pools.xkiro,
      models: [config.models.xkiroPrimary, ...config.models.xkiroBackup],
      visionModels: [],
      cap: config.dailyCap.xkiro,
      run: (k, m, msgs) =>
        openAiChat('https://api.xkiro.com/v1', k, m, msgs, undefined, {
          temperature: 0.35,
          presence_penalty: 0.0,
          frequency_penalty: 0.0,
        }),
    },
  ];
}

/**
 * Chat dengan failover cerdas:
 * - Teks umum / matematika / koding: xKiro (DeepSeek) > Groq > Cloudflare (Llama 3.1 70B > Qwen 2.5 Coder) > Gemini > OpenRouter.
 * - Vision / foto / gambar: xKiro (Standby Qwen Free) > Gemini (3.8 Flash > 2.5 Flash) > OpenRouter (Nex Pro > Mini).
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
  // Untuk vision: Urutan sesuai instruksi (xKiro -> Gemini -> OpenRouter)
  const orderedSteps = needVision
    ? allSteps
        .filter((s) => s.visionModels.length > 0)
        .sort((a, b) => {
          const priority: Record<string, number> = { gemini: 1, cloudflare: 2, openrouter: 3 };
          return (priority[a.kind] ?? 99) - (priority[b.kind] ?? 99);
        })
    : allSteps;

  for (const step of orderedSteps) {
    const models = needVision ? step.visionModels : step.models;
    for (const model of models) {
      // Fast-pass: Lewati model yang sedang dalam cooldown server error (0ms overhead)
      if (isModelCoolingDown(step.kind, model)) {
        continue;
      }

      const candidateKeys = getOrderedKeys(step.kind, step.keys);
      let anyKeyAttempted = false;
      let allKeysFailedWithServerError = true;

      for (const key of candidateKeys) {
        if (!(await isKeyAllowed(step.kind, key, step.cap))) continue;
        anyKeyAttempted = true;
        try {
          const result = await step.run(key, model, messages);
          recordKeySuccess(step.kind, key, model);
          keyUsed(step.kind, key);
          cacheSet(cacheKey, result.text);
          return { text: result.text, via: `${step.kind}/${model}`, tokens: result.tokens };
        } catch (e) {
          lastError = e instanceof Error ? e.message : 'UNKNOWN';
          recordKeyFailure(step.kind, key, e);

          // Jika model 404 (tidak ditemukan), 403 (model berbayar uang asli), atau 503/502 (upstream server outage/kapasitas habis),
          // jangan buang waktu mencoba kunci lain untuk model yang sama karena server upstream pasti mengembalikan error yang sama
          if (
            lastError.includes('PROVIDER_404') ||
            lastError.includes('PROVIDER_403') ||
            lastError.includes('PROVIDER_401') ||
            lastError.includes('PROVIDER_503') ||
            lastError.includes('PROVIDER_502') ||
            lastError.includes('CreditsError') ||
            lastError.includes('ModelError')
          ) {
            recordModelFailure(step.kind, model, 15 * 60_000);
            break;
          }

          // Jika model 413 (payload terlalu besar untuk kuota ITPM model ini), langsung lompat
          if (lastError.includes('PROVIDER_413')) {
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
      if (anyKeyAttempted && allKeysFailedWithServerError) {
        recordModelFailure(step.kind, model);
      }
    }
  }
  throw new Error(`ALL_PROVIDERS_FAILED:${lastError}`);
}
