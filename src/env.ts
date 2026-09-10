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
  supabaseUrl: process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
  // Service-role diutamakan (server-side only); mendukung format integrasi Supabase Vercel
  supabaseKey:
    process.env.SUPABASE_SERVICE_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SECRET_KEY ??
    process.env.SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    '',
  telegramWebhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET ?? '',
  cronSecret: process.env.CRON_SECRET ?? '',
  botName: process.env.BOT_NAME ?? 'FreeAIBot',
  botProfile:
    process.env.BOT_PROFILE ??
    'Asisten AI umum berbahasa Indonesia. Cerdas, adaptif, jujur, dan berwawasan luas.',
  // Waktu tunggu respon koneksi/header API key (jika mati/429/error, langsung failover cepat)
  connectTimeoutMs: num('CONNECT_TIMEOUT_MS', 8000),
  // Waktu tunggu model berpikir & menyelesaikan generasi teks lengkap
  timeoutMs: num('REQUEST_TIMEOUT_MS', 90000),
  // Kapasitas output token agar AI mampu menjelaskan detail & koding tanpa terpotong
  maxOutputTokens: num('MAX_OUTPUT_TOKENS', 2500),
  // Timeout unduhan media terpisah dan pendek
  downloadTimeoutMs: num('DOWNLOAD_TIMEOUT_MS', 25000),
  cacheTtlMs: num('CACHE_TTL_MS', 3600000),
  isServerless: process.env.VERCEL === '1' || !!process.env.AWS_LAMBDA_FUNCTION_NAME,
  dailyCap: {
    openrouter: num('DAILY_CAP_OPENROUTER', 180),
    groq: num('DAILY_CAP_GROQ', 800),
    gemini: num('DAILY_CAP_GEMINI', 1400),
    ollama: num('DAILY_CAP_OLLAMA', 500),
  },
  whatsappPrefix: process.env.WHATSAPP_PREFIX ?? '',
  whatsappRespondGroups: process.env.WHATSAPP_RESPOND_GROUPS === '1' || process.env.WHATSAPP_RESPOND_GROUPS === 'true',
  whatsappPhoneNumber: process.env.WHATSAPP_PHONE_NUMBER ?? '',
  whatsappToken:
    process.env.WHATSAPP_TOKEN ||
    'EAAUA6UZCjT8gBSe1GzfRtZAwKBSTUmZAysbObvsynZAWz15N3ZC1z3M18mGPLtt0ALHZAe9AUvcMpE1lwqlNHbLqKwcmGTOsx2OvuXxDrH2guOc4pmY16Sfik72dgZAQJpd1sa7eOoqOZBhcpPefaGD0E8XMdLdZBY1sUTVezLfsJ3QZBlDSXdaRs3Q1xpOsnYh57WksMDdwtrjPVzoYKJvOAEwjJr4d8ZAWPtZB2rNJmqTuoaStraepQyQaFuICTDkhTXPNusYw5V1xGxZApAwMzm0Jn',
  whatsappPhoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '1224589930748061',
  whatsappVerifyToken: process.env.WHATSAPP_VERIFY_TOKEN || 'wa_verif_secret_2026',
  whatsappAppSecret: process.env.WHATSAPP_APP_SECRET ?? '',
};

export function assertRuntime(target: 'telegram' | 'whatsapp' | 'all' = 'telegram'): void {
  if ((target === 'telegram' || target === 'all') && !config.telegramToken) {
    throw new Error('TELEGRAM_BOT_TOKEN kosong. Salin .env.example ke .env lalu isi.');
  }
  const totalKeys =
    config.pools.openrouter.length +
    config.pools.groq.length +
    config.pools.gemini.length +
    config.pools.ollama.length;
  if (totalKeys === 0) throw new Error('Semua pool key kosong. Isi minimal satu provider di .env.');
}
