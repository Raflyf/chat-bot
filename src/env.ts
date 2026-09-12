import 'dotenv/config';

function cleanStr(name: string): string {
  const val = process.env[name];
  if (!val) return '';
  return val.trim().replace(/^["']|["']$/g, '').trim();
}

function firstEnv(...names: string[]): string {
  for (const n of names) {
    const v = cleanStr(n);
    if (v.length > 0) return v;
  }
  return '';
}

function csv(name: string): string[] {
  const raw = process.env[name] ?? '';
  return raw
    .split(',')
    .map((s) => s.trim().replace(/^["']|["']$/g, '').trim())
    .filter((s) => s.length > 0);
}

function num(name: string, fallback: number): number {
  const v = Number(cleanStr(name));
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

export const config = {
  telegramToken: cleanStr('TELEGRAM_BOT_TOKEN'),
  ownerChatId: cleanStr('OWNER_CHAT_ID'),
  ownerWaNumber: cleanStr('OWNER_WA_NUMBER'),
  pools: {
    xkiro: csv('XKIRO_KEYS'),
    openrouter: csv('OPENROUTER_KEYS'),
    groq: csv('GROQ_KEYS'),
    gemini: csv('GEMINI_KEYS'),
  },
  models: {
    xkiroPrimary: cleanStr('XKIRO_MODEL_PRIMARY') || 'deepseek/deepseek-v4-flash',
    xkiroBackup: (() => {
      const envList = csv('XKIRO_MODEL_BACKUPS');
      return envList.length > 0
        ? envList
        : [
            'deepseek/deepseek-chat-v3.1',
            'deepseek/deepseek-v4-pro',
            'deepseek/deepseek-v3.2',
          ];
    })(),
    orPrimary: cleanStr('OR_MODEL_PRIMARY') || 'nex-agi/nex-n2.5-pro:free',
    orMini: cleanStr('OR_MODEL_MINI') || 'nex-agi/nex-n2.5-mini:free',
    orText: cleanStr('OR_MODEL_TEXT') || 'nvidia/nemotron-3.5-lightning:free',
    groqPrimary: cleanStr('GROQ_MODEL_PRIMARY') || 'qwen/qwen3.8-27b',
    groqBackup: cleanStr('GROQ_MODEL_BACKUP') || 'qwen/qwen3.6-27b',
    geminiPrimary: cleanStr('GEMINI_MODEL_PRIMARY') || 'gemini-3.8-flash',
    geminiBackup: cleanStr('GEMINI_MODEL_BACKUP') || 'gemini-2.5-flash',
  },
  supabaseUrl: (() => {
    const raw = firstEnv('SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL');
    if (!raw) return '';
    if (raw.startsWith('postgres://') || raw.startsWith('postgresql://')) {
      console.warn('[env] SUPABASE_URL menggunakan skema postgres:// yang tidak valid untuk REST client. Abaikan.');
      return '';
    }
    return raw;
  })(),
  // Service-role diutamakan (server-side only); mendukung format integrasi Supabase Vercel
  supabaseKey: firstEnv(
    'SUPABASE_SERVICE_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'SUPABASE_SECRET_KEY',
    'SUPABASE_KEY',
    'SUPABASE_ANON_KEY',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'NEXT_PUBLIC_SUPABASE_KEY',
  ),
  telegramWebhookSecret: cleanStr('TELEGRAM_WEBHOOK_SECRET'),
  cronSecret: cleanStr('CRON_SECRET'),
  botName: cleanStr('BOT_NAME') || 'FreeAIBot',
  botProfile:
    process.env.BOT_PROFILE ??
    'Asisten AI umum berbahasa Indonesia. Cerdas, adaptif, jujur, dan berwawasan luas.',
  // Waktu tunggu respon koneksi/header API key (jika mati/429/error, langsung failover cepat)
  connectTimeoutMs: num('CONNECT_TIMEOUT_MS', 3000),
  // Waktu tunggu model berpikir & menyelesaikan generasi teks lengkap (aman untuk batas serverless Vercel)
  timeoutMs: num('REQUEST_TIMEOUT_MS', 35000),
  // Kapasitas output token agar AI mampu menjelaskan detail & koding tanpa terpotong
  maxOutputTokens: num('MAX_OUTPUT_TOKENS', 2500),
  // Batas maksimal total token konteks prompt (agar muat di kuota ketat Groq 8K TPM)
  maxTokensLimit: num('MAX_TOKENS_LIMIT', 8000),
  // Timeout unduhan media terpisah dan pendek
  downloadTimeoutMs: num('DOWNLOAD_TIMEOUT_MS', 25000),
  cacheTtlMs: num('CACHE_TTL_MS', 3600000),
  isServerless: process.env.VERCEL === '1' || !!process.env.AWS_LAMBDA_FUNCTION_NAME,
  dailyCap: {
    xkiro: num('DAILY_CAP_XKIRO', 50000),
    openrouter: num('DAILY_CAP_OPENROUTER', 50),
    groq: num('DAILY_CAP_GROQ', 1000),
    gemini: num('DAILY_CAP_GEMINI', 1500),
  },
  whatsappPrefix: process.env.WHATSAPP_PREFIX ?? '',
  whatsappRespondGroups: process.env.WHATSAPP_RESPOND_GROUPS === '1' || process.env.WHATSAPP_RESPOND_GROUPS === 'true',
  whatsappPhoneNumber: cleanStr('WHATSAPP_PHONE_NUMBER'),
  whatsappToken: cleanStr('WHATSAPP_TOKEN'),
  whatsappPhoneNumberId: cleanStr('WHATSAPP_PHONE_NUMBER_ID'),
  whatsappVerifyToken: cleanStr('WHATSAPP_VERIFY_TOKEN'),
  whatsappAppSecret: cleanStr('WHATSAPP_APP_SECRET'),
  resendApiKey: cleanStr('RESEND_API_KEY'),
  resendFrom: cleanStr('RESEND_FROM') || 'ChatBot Security <notifications@resend.dev>',
  adminEmail: cleanStr('ADMIN_EMAIL'),
  pinSalt: cleanStr('PIN_SALT'),
  adminPin: cleanStr('ADMIN_PIN'),
};

export function assertRuntime(target: 'telegram' | 'whatsapp' | 'all' = 'telegram'): void {
  if ((target === 'telegram' || target === 'all') && !config.telegramToken) {
    throw new Error('TELEGRAM_BOT_TOKEN kosong. Salin .env.example ke .env lalu isi.');
  }
  if (target === 'whatsapp' || target === 'all') {
    if (config.whatsappToken) {
      if (!config.whatsappPhoneNumberId || !config.whatsappVerifyToken) {
        throw new Error('WHATSAPP_TOKEN terisi namun WHATSAPP_PHONE_NUMBER_ID atau WHATSAPP_VERIFY_TOKEN belum lengkap.');
      }
      if (!config.whatsappAppSecret && config.isServerless) {
        console.warn('[env] WHATSAPP_APP_SECRET belum diset di serverless. Sangat disarankan untuk verifikasi HMAC Meta.');
      }
    }
  }
  if (config.isServerless) {
    if (!config.cronSecret) {
      console.warn('[env] CRON_SECRET belum diset di serverless: endpoint /api/cron/reminders akan fail-closed.');
    }
    if (!config.telegramWebhookSecret && config.telegramToken) {
      console.warn('[env] TELEGRAM_WEBHOOK_SECRET belum diset di serverless: webhook Telegram akan fail-closed.');
    }
  }
  if (config.supabaseUrl && !config.supabaseKey) {
    throw new Error('SUPABASE_URL terisi tetapi SUPABASE_KEY / SUPABASE_SERVICE_ROLE_KEY kosong.');
  }
  const totalKeys =
    config.pools.xkiro.length +
    config.pools.openrouter.length +
    config.pools.groq.length +
    config.pools.gemini.length;
  if (totalKeys === 0) throw new Error('Semua pool key kosong. Isi minimal satu provider di .env.');
}
