import { config } from './env.js';
import { keyAllowed, keyUsed } from './quota.js';

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

type ProviderKind = 'xkiro' | 'groq' | 'gemini' | 'openrouter';

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
  if (cache.size > 500) cache.clear();
  cache.set(key, { at: Date.now(), text });
}

async function postJson(url: string, key: string, body: unknown): Promise<unknown> {
  // Tier 1: Cek respon koneksi/header API key (connectTimeoutMs)
  // Jika 429 (rate limit) atau provider down, failover cepat ke key/provider berikutnya
  const connectController = new AbortController();
  const connectTimer = setTimeout(() => connectController.abort(), config.connectTimeoutMs);

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: connectController.signal,
    });
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
  // Berikan waktu berpikir yang leluasa (timeoutMs)
  const thinkPromise = res.json();
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('THINKING_TIMEOUT')), config.timeoutMs),
  );

  return (await Promise.race([thinkPromise, timeoutPromise])) as unknown;
}

async function openAiChat(baseUrl: string, key: string, model: string, messages: ChatMsg[]): Promise<string> {
  const data = (await postJson(`${baseUrl}/chat/completions`, key, {
    model,
    messages,
    max_tokens: config.maxOutputTokens,
    temperature: 0.7,
  })) as { choices?: Array<{ message?: { content?: string } }> };
  const text = data.choices?.[0]?.message?.content?.trim() ?? '';
  if (!text) throw new Error('EMPTY_RESPONSE');
  return text;
}

async function geminiChat(key: string, model: string, messages: ChatMsg[]): Promise<string> {
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
  if (system) body.systemInstruction = { parts: [{ text: system.content }] };

  const connectController = new AbortController();
  const connectTimer = setTimeout(() => connectController.abort(), config.connectTimeoutMs);

  let res: Response;
  try {
    res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: connectController.signal,
      },
    );
  } finally {
    clearTimeout(connectTimer);
  }

  if (res.status === 429) {
    const err = new Error('RATE_LIMITED') as Error & { code?: string };
    err.code = 'RATE_LIMITED';
    throw err;
  }
  if (!res.ok) throw new Error(`PROVIDER_${res.status}`);

  const thinkPromise = res.json() as Promise<{ candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }>;
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('THINKING_TIMEOUT')), config.timeoutMs),
  );
  const data = (await Promise.race([thinkPromise, timeoutPromise])) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('').trim() ?? '';
  if (!text) throw new Error('EMPTY_RESPONSE');
  return text;
}

interface Step {
  kind: ProviderKind;
  keys: string[];
  models: string[];
  /** Subset models yang terbukti vision-capable. Kosong = step dilewati saat butuh vision. */
  visionModels: string[];
  cap: number;
  run: (key: string, model: string, messages: ChatMsg[]) => Promise<string>;
}

function steps(): Step[] {
  return [
    {
      kind: 'xkiro',
      keys: config.pools.xkiro,
      models: [config.models.xkiroPrimary, ...config.models.xkiroBackup],
      visionModels: [
        'qwen/qwen3.8-max:free',
        'qwen/qwen3.6-plus:free',
        'qwen/qwen3-vl-plus:free',
        'mistralai/mistral-large-2512',
      ],
      cap: config.dailyCap.xkiro,
      run: (k, m, msgs) => openAiChat('https://api.xkiro.com/v1', k, m, msgs),
    },
    {
      kind: 'groq',
      keys: config.pools.groq,
      models: [config.models.groqPrimary, config.models.groqBackup],
      visionModels: [],
      cap: config.dailyCap.groq,
      run: (k, m, msgs) => openAiChat('https://api.groq.com/openai/v1', k, m, msgs),
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
      kind: 'openrouter',
      keys: config.pools.openrouter,
      models: [config.models.orPrimary, config.models.orMini, config.models.orText],
      visionModels: [config.models.orPrimary, config.models.orMini],
      cap: config.dailyCap.openrouter,
      run: (k, m, msgs) => openAiChat('https://openrouter.ai/api/v1', k, m, msgs),
    },
  ];
}

/**
 * Chat dengan failover cerdas:
 * - Teks umum / matematika / koding: Groq (ultra-cepat ~2s) > Gemini > OpenRouter.
 * - Vision / gambar: Gemini (nativ multimodal ~1.7s) > OpenRouter Vision.
 * Melempar jika semua gagal agar caller memutuskan retry/pesan status.
 */
export async function chat(messages: ChatMsg[], opts?: { vision?: boolean }): Promise<{ text: string; via: string }> {
  const needVision = opts?.vision === true;
  const cacheKey = JSON.stringify({ v: needVision, messages });
  const hit = cacheGet(cacheKey);
  if (hit) return { text: hit, via: 'cache' };

  let lastError = 'NO_PROVIDER_KEYS';
  const allSteps = steps();
  // Untuk vision: utamakan provider yang stabil menangani base64 buffer (Gemini -> OpenRouter -> xKiro)
  const orderedSteps = needVision
    ? allSteps
        .filter((s) => s.visionModels.length > 0)
        .sort((a, b) => {
          const priority: Record<string, number> = { gemini: 1, openrouter: 2, xkiro: 3, groq: 4 };
          return (priority[a.kind] ?? 99) - (priority[b.kind] ?? 99);
        })
    : allSteps;

  for (const step of orderedSteps) {
    const models = needVision ? step.visionModels : step.models;
    for (const model of models) {
      for (const key of step.keys) {
        if (!keyAllowed(step.kind, key, step.cap)) continue;
        try {
          const text = await step.run(key, model, messages);
          keyUsed(step.kind, key);
          cacheSet(cacheKey, text);
          return { text, via: `${step.kind}/${model}` };
        } catch (e) {
          lastError = e instanceof Error ? e.message : 'UNKNOWN';
          // Catat pemakaian hanya jika rate limited (agar pool beralih), bukan pada error 500 atau kegagalan jaringan
          if (lastError === 'RATE_LIMITED' || (e as { code?: string })?.code === 'RATE_LIMITED') {
            keyUsed(step.kind, key);
          }
        }
      }
    }
  }
  throw new Error(`ALL_PROVIDERS_FAILED:${lastError}`);
}
