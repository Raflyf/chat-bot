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

type ProviderKind = 'openrouter' | 'groq' | 'gemini' | 'ollama';

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
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(config.timeoutMs),
  });
  if (res.status === 429) {
    const err = new Error('RATE_LIMITED') as Error & { code?: string };
    err.code = 'RATE_LIMITED';
    throw err;
  }
  if (!res.ok) throw new Error(`PROVIDER_${res.status}`);
  return (await res.json()) as unknown;
}

async function openAiChat(baseUrl: string, key: string, model: string, messages: ChatMsg[]): Promise<string> {
  const data = (await postJson(`${baseUrl}/chat/completions`, key, {
    model,
    messages,
    max_tokens: 500,
    temperature: 0.4,
  })) as { choices?: Array<{ message?: { content?: string } }> };
  const text = data.choices?.[0]?.message?.content?.trim() ?? '';
  if (!text) throw new Error('EMPTY_RESPONSE');
  return text;
}

async function geminiChat(key: string, model: string, messages: ChatMsg[]): Promise<string> {
  const contents = messages
    .filter((m) => m.role === 'user')
    .map((m) => {
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
      return { parts };
    });
  const system = messages.find((m) => m.role === 'system');
  const body: Record<string, unknown> = {
    contents,
    generationConfig: { maxOutputTokens: 500, temperature: 0.4 },
  };
  if (system) body.systemInstruction = { parts: [{ text: system.content }] };
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(config.timeoutMs) },
  );
  if (res.status === 429) {
    const err = new Error('RATE_LIMITED') as Error & { code?: string };
    err.code = 'RATE_LIMITED';
    throw err;
  }
  if (!res.ok) throw new Error(`PROVIDER_${res.status}`);
  const data = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('').trim() ?? '';
  if (!text) throw new Error('EMPTY_RESPONSE');
  return text;
}

async function ollamaChat(key: string, model: string, messages: ChatMsg[]): Promise<string> {
  const data = (await postJson('https://ollama.com/api/chat', key, {
    model,
    messages,
    stream: false,
  })) as { message?: { content?: string } };
  const text = data.message?.content?.trim() ?? '';
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
      kind: 'openrouter',
      keys: config.pools.openrouter,
      models: [config.models.orPrimary, config.models.orMini, config.models.orText],
      visionModels: [config.models.orPrimary, config.models.orMini],
      cap: config.dailyCap.openrouter,
      run: (k, m, msgs) => openAiChat('https://openrouter.ai/api/v1', k, m, msgs),
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
      kind: 'ollama',
      keys: config.pools.ollama,
      models: [config.models.ollamaPrimary, config.models.ollamaBackup],
      visionModels: [],
      cap: config.dailyCap.ollama,
      run: (k, m, msgs) => ollamaChat(k, m, msgs),
    },
  ];
}

/**
 * Chat dengan failover berurutan OpenRouter > Groq > Gemini > Ollama.
 * needVision=true: hanya model vision-capable yang dicoba.
 * Melempar jika semua gagal agar caller memutuskan retry/pesan status.
 */
export async function chat(messages: ChatMsg[], opts?: { vision?: boolean }): Promise<{ text: string; via: string }> {
  const needVision = opts?.vision === true;
  const cacheKey = JSON.stringify({ v: needVision, messages });
  const hit = cacheGet(cacheKey);
  if (hit) return { text: hit, via: 'cache' };

  let lastError = 'NO_PROVIDER_KEYS';
  for (const step of steps()) {
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
          keyUsed(step.kind, key);
        }
      }
    }
  }
  throw new Error(`ALL_PROVIDERS_FAILED:${lastError}`);
}
