import 'dotenv/config';

function csv(name: string): string[] {
  const raw = process.env[name] ?? '';
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function num(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

export const config = {
  telegramToken: process.env.TELEGRAM_BOT_TOKEN ?? '',
  ownerChatId: process.env.OWNER_CHAT_ID ?? '',
  pools: {
    openrouter: csv('OPENROUTER_KEYS'),
    groq: csv('GROQ_KEYS'),
    gemini: csv('GEMINI_KEYS'),
    ollama: csv('OLLAMA_KEYS'),
  },
  models: {
    orPrimary: process.env.OR_MODEL_PRIMARY ?? 'nex-agi/nex-n2.5-pro:free',
    orMini: process.env.OR_MODEL_MINI ?? 'nex-agi/nex-n2.5-mini:free',
    orText: process.env.OR_MODEL_TEXT ?? 'nvidia/nemotron-3.5-lightning:free',
    groqPrimary: process.env.GROQ_MODEL_PRIMARY ?? 'qwen/qwen3.8-27b',
    groqBackup: process.env.GROQ_MODEL_BACKUP ?? 'qwen/qwen3.6-27b',
    geminiPrimary: process.env.GEMINI_MODEL_PRIMARY ?? 'gemini-3.8-flash',
    geminiBackup: process.env.GEMINI_MODEL_BACKUP ?? 'gemini-2.5-flash',
    ollamaPrimary: process.env.OLLAMA_MODEL_PRIMARY ?? 'nemotron-3-nano:30b',
    ollamaBackup: process.env.OLLAMA_MODEL_BACKUP ?? 'gpt-oss:20b',
  },
  supabaseUrl: process.env.SUPABASE_URL ?? '',
  // Service-role didahulukan (server-side only); anon sebagai fallback.
  supabaseKey: process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_ANON_KEY ?? '',
  shopName: process.env.SHOP_NAME ?? 'Toko Contoh',
  shopProfile: process.env.SHOP_PROFILE ?? 'Toko kelontong online, jam 08.00-21.00 WIB.',
  botName: process.env.BOT_NAME ?? process.env.SHOP_NAME ?? 'AgentKit',
  botProfile:
    process.env.BOT_PROFILE ??
    process.env.SHOP_PROFILE ??
    'Asisten AI umum berbahasa Indonesia. Jawab pertanyaan apa pun dengan benar dan singkat.',
  timeoutMs: num('REQUEST_TIMEOUT_MS', 15000),
  cacheTtlMs: num('CACHE_TTL_MS', 3600000),
  dailyCap: {
    openrouter: num('DAILY_CAP_OPENROUTER', 180),
    groq: num('DAILY_CAP_GROQ', 800),
    gemini: num('DAILY_CAP_GEMINI', 1400),
    ollama: num('DAILY_CAP_OLLAMA', 500),
  },
};

export function assertRuntime(): void {
  if (!config.telegramToken) throw new Error('TELEGRAM_BOT_TOKEN kosong. Salin .env.example ke .env lalu isi.');
  const totalKeys =
    config.pools.openrouter.length +
    config.pools.groq.length +
    config.pools.gemini.length +
    config.pools.ollama.length;
  if (totalKeys === 0) throw new Error('Semua pool key kosong. Isi minimal satu provider di .env.');
}
