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
  // Jika DAHL_PROXY_URL diset, semua request Tier 1 dialihkan ke Cloudflare Worker
  // (bypass Cloudflare WAF Dahl yang memblokir IP AWS/Vercel).
  // Kosongkan / hapus var ini untuk kembali ke endpoint langsung.
  dahlProxyUrl: cleanStr('DAHL_PROXY_URL') || 'https://inference.dahl.global/v1',
  pools: {
    dahl: csv('DAHL_KEYS'),
    groq: csv('GROQ_KEYS'),
    opencode: csv('OPENCODE_KEYS'),
    gemini: csv('GEMINI_KEYS'),
    cloudflare: csv('CLOUDFLARE_KEYS'),
    openrouter: csv('OPENROUTER_KEYS'),
    xkiro: csv('XKIRO_KEYS'),
  },
  cloudflareAccountId: cleanStr('CLOUDFLARE_ACCOUNT_ID'),
  models: {
    // Tier 1: Dahl Global API (1B Token Pool - latensi ~0,22s)
    dahlPrimary: 'deepseek-ai/DeepSeek-V4-Flash-0731',
    dahlBackup: 'MiniMaxAI/MiniMax-M2.7',
    // Tier 2: Groq Cloud API (LPU Ultra-Fast Inference)
    groqPrimary: 'qwen/qwen3.8-27b',
    groqBackup: 'qwen/qwen3.6-27b',
    // Tier 3: OpenCode Zen Direct API (1.048.576 Konteks Teks & Penalaran Empatik)
    openCodePrimary: 'muse-spark-1.3-contributor-free',
    openCodeBackup: 'muse-spark-1.2-contributor-free',
    // Tier 4: Google Gemini API (1M Konteks & Vision Prioritas 1)
    geminiPrimary: 'gemini-3.8-flash',
    geminiBackup: 'gemini-2.5-flash',
    // Tier 5: Cloudflare Workers AI (Llama 3.1 70B & Vision Prioritas 2)
    cfPrimary: '@cf/meta/llama-3.1-70b-instruct',
    cfBackup: '@cf/qwen/qwen2.5-coder-32b-instruct',
    cfVision: '@cf/meta/llama-3.2-11b-vision-instruct',
    // Tier 6: OpenRouter AI (Koleksi Bebas Kuota & Vision Prioritas 3)
    orPrimary: 'nex-agi/nex-n2.5-pro:free',
    orMini: 'nex-agi/nex-n2.5-mini:free',
    orText: 'nvidia/nemotron-3.5-lightning:free',
    // Tier 2: xKiro Gateway (DeepSeek v4.1 Flash Free & Failover)
    xkiroPrimary: 'deepseek/deepseek-v4.1-flash:free',
    xkiroBackup: ['deepseek/deepseek-v4.1-flash', 'deepseek/deepseek-chat-v3.1', 'mistralai/mistral-small-2603'],
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
  telegramBotUsername: cleanStr('TELEGRAM_BOT_USERNAME') || 'chatkita_bot',
  cronSecret: cleanStr('CRON_SECRET'),
  botName: cleanStr('BOT_NAME') || 'FreeAIBot',
  botProfile:
    process.env.BOT_PROFILE ??
    'Asisten AI umum berbahasa Indonesia. Cerdas, adaptif, jujur, dan berwawasan luas.',
  // Waktu tunggu respon koneksi/header API key (jika mati/429/error, langsung failover cepat)
  connectTimeoutMs: num('CONNECT_TIMEOUT_MS', 5000),
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
    dahl: num('DAILY_CAP_DAHL', 5000),
    // Selaras limit resmi platform: Groq Free Tier 1.000 RPD/key
    groq: num('DAILY_CAP_GROQ', 1000),
    opencode: num('DAILY_CAP_OPENCODE', 1000),
    // Selaras limit resmi platform: Gemini Free Tier 1.500 RPD/key
    gemini: num('DAILY_CAP_GEMINI', 1500),
    cloudflare: num('DAILY_CAP_CLOUDFLARE', 300),
    openrouter: num('DAILY_CAP_OPENROUTER', 180),
    xkiro: num('DAILY_CAP_XKIRO', 500),
  },
  // Batas TOKEN per hari (TPD) per key. 0 = tidak dibatasi.
  // Groq Free Tier resmi: 200K TPD untuk qwen3.8-27b & qwen3.6-27b
  // (tercapai jauh lebih cepat daripada RPD 1.000 pada ~2.5K token/call).
  dailyTokenCap: {
    dahl: num('DAILY_TOKEN_CAP_DAHL', 0),
    groq: num('DAILY_TOKEN_CAP_GROQ', 200000),
    opencode: num('DAILY_TOKEN_CAP_OPENCODE', 0),
    gemini: num('DAILY_TOKEN_CAP_GEMINI', 0),
    cloudflare: num('DAILY_TOKEN_CAP_CLOUDFLARE', 0),
    openrouter: num('DAILY_TOKEN_CAP_OPENROUTER', 0),
    xkiro: num('DAILY_TOKEN_CAP_XKIRO', 0),
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
    config.pools.dahl.length +
    config.pools.groq.length +
    config.pools.opencode.length +
    config.pools.gemini.length +
    config.pools.cloudflare.length +
    config.pools.openrouter.length +
    config.pools.xkiro.length;
  if (totalKeys === 0) throw new Error('Semua pool key kosong. Isi minimal satu provider di .env.');
}
