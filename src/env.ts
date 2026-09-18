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
  // Jika DAHL_PROXY_URL diset, semua request Dahl dialihkan ke Cloudflare Worker
  // (bypass Cloudflare WAF Dahl yang memblokir IP AWS/Vercel).
  // Bila kosong: pakai DAHL_BASE_URL (endpoint langsung) atau default resmi Dahl.
  dahlProxyUrl: cleanStr('DAHL_PROXY_URL') || cleanStr('DAHL_BASE_URL') || 'https://inference.dahl.global/v1',
  pools: {
    dahl: csv('DAHL_KEYS'),
    groq: csv('GROQ_KEYS'),
    gemini: csv('GEMINI_KEYS'),
    cloudflare: csv('CLOUDFLARE_KEYS'),
    openrouter: csv('OPENROUTER_KEYS'),
    xkiro: csv('XKIRO_KEYS'),
  },
  cloudflareAccountId: cleanStr('CLOUDFLARE_ACCOUNT_ID'),
  models: {
    // Tier 1: xKiro Gateway (Qwen 3.8 Max Free → slot DeepSeek arsip bila pulih;
    // MiniMax M3 dipakai KHUSUS di rantai multimodal, bukan cadangan teks)
    xkiroPrimary: 'qwen/qwen3.8-max:free',
    xkiroBackup: ['deepseek/deepseek-v4.1-flash:free'],
    // Tier 2: OpenRouter (DeepSeek V4 Flash 0731 Free → Nex N2.5 Pro / Nemotron Lightning)
    orPrimary: 'deepseek/deepseek-v4-flash-0731:free',
    orBackup: ['nex-agi/nex-n2.5-pro:free', 'nvidia/nemotron-3.5-lightning:free'],
    // Tier 3: Groq Cloud API (LPU Ultra-Fast Inference)
    groqPrimary: 'qwen/qwen3.8-27b',
    groqBackup: ['openai/gpt-oss-120b'],
    // Tier 4: Cloudflare Workers AI (Qwen 3.8 → GLM 4.7 / GPT-OSS 120B / Llama 3.3 70B)
    cfPrimary: '@cf/qwen/qwen3.8-27b',
    cfBackup: ['@cf/zai-org/glm-4.7-flash', '@cf/openai/gpt-oss-120b', '@cf/meta/llama-3.3-70b-instruct-fp8-fast'],
    // Model vision Cloudflare (sinkron dengan rantai vision runtime): Qwen & Gemma via
    // endpoint OpenAI-compat /ai/v1, LLaVA via endpoint native /ai/run (byte array).
    cfVision: [
      '@cf/qwen/qwen3.8-27b',
      '@cf/google/gemma-4-26b-a4b-it',
      '@cf/llava-hf/llava-1.5-7b-hf',
    ],
    // Tier 5: Google Gemini API (1M Konteks)
    geminiPrimary: 'gemini-3.8-flash',
    geminiBackup: ['gemini-3.5-flash'],
    // Model Gemini khusus jalur VISION. gemini-3.8-flash dikecualikan: terbukti hang ~60s
    // tanpa token saat menerima gambar (uji live), jadi tetap primer teks saja.
    geminiVision: ['gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-2.5-flash'],
    // Tier 6: Dahl Global API (1B Token Pool - latensi ~0,22s)
    dahlPrimary: 'deepseek-ai/DeepSeek-V4-Flash-0731',
    dahlBackup: ['zai-org/GLM-5.3-Flash', 'MiniMaxAI/MiniMax-M2.7'],
    // Rantai vision eksplisit (urutan keputusan review user; seluruhnya terbukti aktif via uji live).
    // Dipakai chat({ vision: true }) untuk foto, stiker, dan gambar di dalam dokumen Word.
    visionChain: [
      { kind: 'groq', model: 'qwen/qwen3.8-27b' },
      { kind: 'cloudflare', model: '@cf/qwen/qwen3.8-27b' },
      { kind: 'cloudflare', model: '@cf/google/gemma-4-26b-a4b-it' },
      { kind: 'xkiro', model: 'minimax/minimax-m3:free' },
      { kind: 'cloudflare', model: '@cf/llava-hf/llava-1.5-7b-hf' },
      { kind: 'gemini', model: 'gemini-3.6-flash' },
      { kind: 'gemini', model: 'gemini-3.5-flash-lite' },
      { kind: 'gemini', model: 'gemini-2.5-flash' },
      { kind: 'xkiro', model: 'qwen/qwen3.8-max:free' },
      { kind: 'xkiro', model: 'qwen/qwen3.8-omni-flash:free' },
    ] as Array<{
      kind: 'dahl' | 'groq' | 'gemini' | 'cloudflare' | 'openrouter' | 'xkiro';
      model: string;
    }>,
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
  // Service-role diutamakan (server-side only). Fallback anon DIHAPUS dari runtime:
  // memakai anon key di server berarti setiap query tunduk pada RLS `anon` — jika ada
  // kebijakan yang lolos, seluruh data bot bisa terbaca/tertulis. Untuk mencegah
  // kejadian senyap itu, hanya key service/secret yang diterima (audit v19 F3).
  supabaseKey: firstEnv(
    'SUPABASE_SERVICE_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'SUPABASE_SECRET_KEY',
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
  // FASE 1 (model TIDAK merespon): batas menunggu token pertama. Sesingkat mungkin —
  // begitu terlampaui, langsung failover tanpa menunggu model yang menggantung.
  firstTokenTimeoutMs: num('FIRST_TOKEN_TIMEOUT_MS', 4000),
  // FASE 2 (model SUDAH merespon & menyusun jawaban): batas jeda antar-chunk. Dilamakan
  // agar model reasoning panjang tidak terputus saat sedang menyusun jawaban.
  streamIdleTimeoutMs: num('STREAM_IDLE_TIMEOUT_MS', 30000),
  // Batas token pertama khusus request VISION: analisis gambar butuh waktu sebelum token pertama,
  // jadi diberi kelonggaran lebih dari teks, tapi tetap dibatasi agar model mati cepat di-failover.
  visionFirstTokenMs: num('VISION_FIRST_TOKEN_MS', 12000),
  // Pagar TOTAL seluruh rantai failover (semua tier). Sisa anggaran ini dibagi ke tiap attempt
  // agar satu model yang menggantung tidak menghabiskan jatah serverless.
  chainDeadlineMs: num('CHAIN_DEADLINE_MS', 45000),
  // Timeout koneksi khusus request berisi gambar/vision (upload base64 besar butuh waktu lebih lama,
  // tapi tetap dibatasi agar model yang menggantung cepat di-failover ke cadangan)
  visionConnectTimeoutMs: num('VISION_CONNECT_TIMEOUT_MS', 8000),
  // Ambang "model lambat" (ms) untuk failover berbasis waktu respons di dalam tier yang sama.
  // Model yang rata-rata merespons lebih lambat dari ini diturunkan prioritasnya.
  slowModelMs: num('SLOW_MODEL_MS', 12000),
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
  pinSalt: cleanStr('PIN_SALT') || 'rafly_telemetry_salt',
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
    config.pools.gemini.length +
    config.pools.cloudflare.length +
    config.pools.openrouter.length +
    config.pools.xkiro.length;
  if (totalKeys === 0) throw new Error('Semua pool key kosong. Isi minimal satu provider di .env.');
}
