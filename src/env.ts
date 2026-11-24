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

function numAllowZero(name: string, fallback: number): number {
  const raw = cleanStr(name);
  if (!raw) return fallback;
  const v = Number(raw);
  return Number.isFinite(v) && v >= 0 ? v : fallback;
}
/**
 * Flag boolean yang AKTIF secara default. Hanya nilai penolakan eksplisit
 * (0/false/off/mati/...) yang mematikan; nilai tak dikenal jatuh ke default.
 */
function enabledByDefault(name: string, fallback: boolean): boolean {
  const raw = cleanStr(name).toLowerCase();
  if (!raw) return fallback;
  if (['0', 'false', 'off', 'no', 'tidak', 'mati', 'nonaktif', 'disabled'].includes(raw)) {
    return false;
  }
  if (['1', 'true', 'on', 'yes', 'ya', 'hidup', 'aktif', 'enabled'].includes(raw)) {
    return true;
  }
  return fallback;
}

function num(name: string, fallback: number): number {
  const v = Number(cleanStr(name));
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

/**
 * Daftar angka dari env (mis. "1000000,500000,500000").
 * Dipakai untuk cap token PER-KEY ketika tiap key punya limit berbeda — kasus nyata
 * xKiro: key #1 limit 1.000.000 token/hari sedangkan key #2/#3 hanya 500.000.
 * Satu nilai tunggal untuk semua key membuat guard memblokir key #1 di 500K
 * (padahal kuotanya masih 500K lagi) atau membiarkan key #2/#3 lewat batas.
 */
function numList(name: string): number[] {
  return csv(name)
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n) && n > 0);
}

export const config = {
  telegramToken: cleanStr('TELEGRAM_BOT_TOKEN'),
  ownerChatId: cleanStr('OWNER_CHAT_ID'),
  ownerWaNumber: cleanStr('OWNER_WA_NUMBER'),
  pools: {
    localai: csv('LOCAL_AI_API_KEY'),
    opencode: csv('OPENCODE_KEYS'),
    cloudflare: csv('CLOUDFLARE_KEYS'),
    groq: csv('GROQ_KEYS'),
    dreamprompting: csv('DREAMPROMPTING_KEYS'),
    openrouter: csv('OPENROUTER_KEYS'),
    gemini: csv('GEMINI_KEYS'),
  },
  // Self-hosted OpenAI-compatible AI server (opsional, mis. llama-server di VPS kedua).
  // Aktif HANYA bila LOCAL_AI_URL dan LOCAL_AI_API_KEY keduanya terisi (fail-closed).
  localAiUrl: cleanStr('LOCAL_AI_URL').replace(/\/+$/, ''),
  localAiModel: cleanStr('LOCAL_AI_MODEL') || 'ternary-bonsai-2-9b',
  localAiPriority: (cleanStr('LOCAL_AI_PRIORITY').toLowerCase() === 'primary' ? 'primary' : 'fallback') as 'primary' | 'fallback',
  localAiVision: enabledByDefault('LOCAL_AI_VISION', true),
  localAiFirstTokenMs: num('LOCAL_AI_FIRST_TOKEN_MS', 25000),
  localAiMaxContextTokens: num('LOCAL_AI_MAX_CONTEXT_TOKENS', 14500),
  // Kontrol lifecycle InstaBox khusus VPS 2 (AI Model VPS), terpisah dari VPS 1 (Baileys).
  localAiInstaboxApiKey: cleanStr('LOCAL_AI_INSTABOX_API_KEY'),
  localAiInstaboxMachineId: cleanStr('LOCAL_AI_INSTABOX_MACHINE_ID'),
  cloudflareAccountId: cleanStr('CLOUDFLARE_ACCOUNT_ID'),
  models: {
    // Tier 1: OpenCode Free. Model ID mengikuti katalog yang sudah diuji.
    opencodePrimary: 'deepseek-v4.1-flash-free',
    opencodeBackup: ['mimo-v2.6-flash-free'],

    // Tier 2: Cloudflare Workers AI.
    cfPrimary: '@cf/qwen/qwen3.8-27b',
    cfBackup: ['@cf/google/gemma-4-26b-a4b-it'],
    cfVision: [
      '@cf/qwen/qwen3.8-27b',
      '@cf/meta/llama-3.2-11b-vision-instruct',
      '@cf/meta/llama-4-scout-17b-16e-instruct',
    ],

    // Tier 3: Groq. GPT-OSS hanya teks, Qwen juga menangani gambar.
    groqPrimary: 'qwen/qwen3.8-27b',
    groqBackup: ['openai/gpt-oss-120b'],
    groqWhisperPrimary: 'whisper-large-v3',
    groqWhisperBackup: 'whisper-large-v3-turbo',
    cfWhisper: '@cf/openai/whisper-large-v3-turbo',

    // Tier 4: DreamPrompting, Qwen 3.8 saja.
    dpPrimary: 'groq/qwen/qwen3.8-27b',
    dpBackup: [] as string[],

    // Tier 5: prefix provider openrouter/ tidak dikirim ke upstream.
    orPrimary: 'nvidia/nemotron-3.5-super-vl:free',
    orBackup: ['nvidia/nemotron-3-ultra-550b-a55b:free'],

    // Tier 6: model yang sudah merespons; 3.8 tidak dipilih karena timeout.
    geminiPrimary: 'gemini-2.5-flash',
    geminiBackup: ['gemini-flash-lite-latest'],
    geminiVision: ['gemini-2.5-flash', 'gemini-flash-lite-latest'],

    // Foto, stiker, dan gambar Word memakai urutan vision, bukan race teks.
    visionChain: [
      { kind: 'groq', model: 'qwen/qwen3.8-27b' },
      { kind: 'openrouter', model: 'nvidia/nemotron-3.5-super-vl:free' },
      { kind: 'gemini', model: 'gemini-2.5-flash' },
      { kind: 'gemini', model: 'gemini-flash-lite-latest' },
      { kind: 'cloudflare', model: '@cf/qwen/qwen3.8-27b' },
      { kind: 'cloudflare', model: '@cf/meta/llama-3.2-11b-vision-instruct' },
      { kind: 'cloudflare', model: '@cf/meta/llama-4-scout-17b-16e-instruct' },
      { kind: 'opencode', model: 'deepseek-v4.1-flash-free' },
      { kind: 'opencode', model: 'mimo-v2.6-flash-free' },
    ] as Array<{
      kind: 'opencode' | 'cloudflare' | 'groq' | 'dreamprompting' | 'openrouter' | 'gemini';
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
  // ── GRUP TELEGRAM (permintaan pemilik produk 16 Okt 2026) ──
  // Bot BOLEH masuk grup, tetapi TIDAK pernah menyahut sendiri: di grup bot hanya
  // menjawab bila DIPANGGIL — tulis pertanyaannya lalu panggil dengan
  // `/namabot` (mis. "/chatkita_bot harga emas hari ini"), atau mention
  // @namabot, atau reply pesan bot. Ini mencegah bot berisik di grup.
  //
  // Daftar putih grup (opsional, dipisah koma): bila DIISI, bot HANYA melayani
  // grup yang terdaftar. Kosong = semua grup boleh (tetap wajib dipanggil).
  // Isi dengan id grup (angka, mis. -1001234567890).
  telegramGroupAllowlist: csv('TELEGRAM_GROUP_ALLOWLIST'),
  cronSecret: cleanStr('CRON_SECRET'),
  botName: cleanStr('BOT_NAME') || 'FreeAIBot',
  botProfile:
    process.env.BOT_PROFILE ??
    'Asisten AI umum berbahasa Indonesia. Cerdas, adaptif, jujur, dan berwawasan luas.',
  // Waktu tunggu respon koneksi/header API key (jika mati/429/error, langsung failover cepat)
  connectTimeoutMs: num('CONNECT_TIMEOUT_MS', 6000),
  // Waktu tunggu model berpikir & menyelesaikan generasi teks lengkap (aman untuk batas serverless Vercel)
  timeoutMs: num('REQUEST_TIMEOUT_MS', 35000),
  // FASE 1 (model TIDAK merespon): batas menunggu token pertama. Sesingkat mungkin —
  // begitu terlampaui, langsung failover tanpa menunggu model yang menggantung.
  firstTokenTimeoutMs: num('FIRST_TOKEN_TIMEOUT_MS', 7000),
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
  // BALAPAN MODEL (permintaan user 04 Okt): bila aktif, model utama & cadangan dalam
  // satu tier dikirim BERSAMAAN, lalu yang jawabannya tiba paling cepat yang dipakai.
  // Ini memangkas latensi karena tidak perlu menunggu model utama gagal/lambat dulu.
  // 0 = mati (perilaku lama: utama dulu, baru cadangan bila gagal).
  raceModels: numAllowZero('RACE_MODELS', 1),
  // Jeda (ms) sebelum model cadangan ikut balapan. Model utama diberi sedikit keunggulan
  // agar tidak selalu dihabiskan kuotanya, tapi cadangan tetap menyusul bila utama lambat.
  raceStaggerMs: num('RACE_STAGGER_MS', 400),
  // Kapasitas output token agar AI mampu menjelaskan detail & koding tanpa terpotong
  maxOutputTokens: num('MAX_OUTPUT_TOKENS', 2500),
  // Batas maksimal total token konteks prompt (agar muat di kuota ketat Groq 8K TPM)
  maxTokensLimit: num('MAX_TOKENS_LIMIT', 8000),
  // Timeout unduhan media terpisah dan pendek
  downloadTimeoutMs: num('DOWNLOAD_TIMEOUT_MS', 25000),
  cacheTtlMs: num('CACHE_TTL_MS', 3600000),
  isServerless: process.env.VERCEL === '1' || !!process.env.AWS_LAMBDA_FUNCTION_NAME,
  dailyCap: {
    localai: num('DAILY_CAP_LOCAL_AI', 1_000_000),
    dreamprompting: num('DAILY_CAP_DREAMPROMPTING', 1000),
    cloudflare: num('DAILY_CAP_CLOUDFLARE', 120),
    openrouter: num('DAILY_CAP_OPENROUTER', 50),
    groq: num('DAILY_CAP_GROQ', 1000),
    gemini: num('DAILY_CAP_GEMINI', 1500),
    opencode: num('DAILY_CAP_OPENCODE', 1000),
  },
  // Batas TOKEN per hari (TPD) per key. 0 = tidak dibatasi.
  // Groq Free Tier resmi: 200K TPD untuk qwen3.8-27b & qwen3.6-27b
  // (tercapai jauh lebih cepat daripada RPD 1.000 pada ~2.5K token/call).
  dailyTokenCap: {
    localai: numAllowZero('DAILY_TOKEN_CAP_LOCAL_AI', 0),
    opencode: numAllowZero('DAILY_TOKEN_CAP_OPENCODE', 0),
    dreamprompting: numAllowZero('DAILY_TOKEN_CAP_DREAMPROMPTING', 0),
    cloudflare: numAllowZero('DAILY_TOKEN_CAP_CLOUDFLARE', 0),
    openrouter: numAllowZero('DAILY_TOKEN_CAP_OPENROUTER', 0),
    groq: numAllowZero('DAILY_TOKEN_CAP_GROQ', 200000),
    gemini: numAllowZero('DAILY_TOKEN_CAP_GEMINI', 0),
  },
  // Cap token PER-KEY (urut sama dengan urutan key di pool). Dipakai bila tiap key
  // punya limit BERBEDA — kasus nyata xKiro: key #1 limit 1.000.000 token/hari
  // sementara key #2/#3 hanya 500.000. Format env: "1000000,500000,500000".
  // Bila kosong, semua key memakai dailyTokenCap[kind].
  dailyTokenCapPerKey: {
    localai: numList('DAILY_TOKEN_CAP_PER_KEY_LOCAL_AI'),
    opencode: numList('DAILY_TOKEN_CAP_PER_KEY_OPENCODE'),
    dreamprompting: numList('DAILY_TOKEN_CAP_PER_KEY_DREAMPROMPTING'),
    cloudflare: numList('DAILY_TOKEN_CAP_PER_KEY_CLOUDFLARE'),
    openrouter: numList('DAILY_TOKEN_CAP_PER_KEY_OPENROUTER'),
    groq: numList('DAILY_TOKEN_CAP_PER_KEY_GROQ'),
    gemini: numList('DAILY_TOKEN_CAP_PER_KEY_GEMINI'),
  },
  whatsappPrefix: process.env.WHATSAPP_PREFIX ?? '',
  whatsappRespondGroups: process.env.WHATSAPP_RESPOND_GROUPS !== '0' && process.env.WHATSAPP_RESPOND_GROUPS !== 'false',
  whatsappPhoneNumber: cleanStr('WHATSAPP_PHONE_NUMBER'),
  whatsappBackupNumber: cleanStr('WHATSAPP_BACKUP_NUMBER') || '6287789587654',
  whatsappToken: cleanStr('WHATSAPP_TOKEN'),
  whatsappPhoneNumberId: cleanStr('WHATSAPP_PHONE_NUMBER_ID'),
  whatsappVerifyToken: cleanStr('WHATSAPP_VERIFY_TOKEN'),
  whatsappAppSecret: cleanStr('WHATSAPP_APP_SECRET'),
  // ── MODE PEMELIHARAAN WHATSAPP (sementara) ──
  // DEFAULT: NONAKTIF (operasional normal). Aktifkan EKSPLISIT dengan
  // `WHATSAPP_MAINTENANCE_MODE=true` saat pengiriman WhatsApp Cloud API
  // terblokir Meta (mis. payment method belum tertaut -> error 141006
  // "There is an error with the payment method").
  //
  // Saat aktif: bot TIDAK memanggil AI untuk pesan WhatsApp (hemat kuota) dan
  // hanya mengirim pemberitahuan pemeliharaan + mengarahkan pengguna ke Telegram.
  // Set kembali ke `false` (atau hapus) setelah payment method beres.
  //
  // CATATAN: sebelumnya memakai `!== 'false'`, sehingga env yang TIDAK diset
  // berarti AKTIF. Itu membuat status tidak jelas — mode pemeliharaan bisa
  // menyala tanpa sengaja (mis. preview deployment tanpa env) dan sulit
  // dibedakan dari kerusakan. Sekarang harus eksplisit.
  whatsappMaintenanceMode: ['true', '1', 'yes', 'on'].includes(
    String(process.env.WHATSAPP_MAINTENANCE_MODE ?? '').trim().toLowerCase(),
  ),
  resendApiKey: cleanStr('RESEND_API_KEY'),
  resendFrom: cleanStr('RESEND_FROM') || 'ChatBot Security <notifications@resend.dev>',
  adminEmail: cleanStr('ADMIN_EMAIL'),
  // PERBAIKAN KEAMANAN (06 Okt 2026, diperkuat 14 Okt 2026): DULU ada fallback
  // salt hardcoded yang bisa dibaca siapa pun dari repo publik (namanya sengaja
  // tidak ditulis lagi di sini). SEKARANG kosong bila tidak diset — admin_auth.ts
  // akan menolak verifikasi (fail-closed) atau menurunkan salt dari
  // SUPABASE_SERVICE_KEY. Salt legacy opsional lewat env LEGACY_PIN_SALTS.
  pinSalt: cleanStr('PIN_SALT'),
  adminPin: cleanStr('ADMIN_PIN'),
  // Monitor lifecycle VPS eksternal (GET /v1/machines/{id}).
  instaboxApiKey: cleanStr('INSTABOX_API_KEY'),
  instaboxMachineId: cleanStr('INSTABOX_MACHINE_ID'),
  instaboxApiBase: cleanStr('INSTABOX_API_BASE') || 'https://api.instabox.sh',
  vpsWarnBeforeMinutes: num('VPS_WARN_BEFORE_MINUTES', 5),
  vpsMaxRunMinutes: numAllowZero('VPS_MAX_RUN_MINUTES', 120),
  // Anti auto-pause: lease aktivitas control-plane (PUT /activity-leases).
  // Bukan terminal I/O palsu; lihat src/vps_keepalive.ts.
  vpsKeepaliveEnabled: enabledByDefault('VPS_KEEPALIVE_ENABLED', true),
  vpsKeepaliveIntervalSeconds: num('VPS_KEEPALIVE_INTERVAL_SECONDS', 600),
  vpsKeepaliveLeaseTtlSeconds: num('VPS_KEEPALIVE_LEASE_TTL_SECONDS', 3600),
  vpsIdlePauseMinutes: num('VPS_IDLE_PAUSE_MINUTES', 30),
  // ── BALASAN VOICE NOTE (VN) & NYANYI ACAPELLA ──
  // Semua VN (obrolan santai ~5:1 & nyanyi acapella) memakai rantai Gemini TTS
  // (gemini-3.8-flash-lite-tts -> gemini-3.8-flash-tts -> gemini-2.5-flash-preview-tts)
  // agar suara bahasa Indonesia natural seperti manusia. Edge-TTS hanya dipakai bila
  // VOICE_EDGE_FALLBACK=1 diaktifkan eksplisit.
  voiceNoteEnabled: enabledByDefault('VOICE_NOTE_ENABLED', true),
  voiceEdgeFallback: ['true', '1', 'yes', 'on'].includes(
    String(process.env.VOICE_EDGE_FALLBACK ?? '').trim().toLowerCase(),
  ),
  ttsVoice: cleanStr('TTS_VOICE') || 'id-ID-ArdiNeural',
  ttsRate: cleanStr('TTS_RATE') || '+0%',
  ttsPitch: cleanStr('TTS_PITCH') || '+0Hz',
  edgeTtsGecVersion: cleanStr('EDGE_TTS_GEC_VERSION') || '1-143.0.3650.75',
  geminiTtsModel: cleanStr('GEMINI_TTS_MODEL') || 'gemini-3.8-flash-tts',
  geminiTtsLiteModel: cleanStr('GEMINI_TTS_LITE_MODEL') || 'gemini-3.8-flash-lite-tts',
  geminiTtsBackupModel: cleanStr('GEMINI_TTS_BACKUP_MODEL') || 'gemini-2.5-flash-preview-tts',
  geminiTtsVoice: cleanStr('GEMINI_TTS_VOICE') || 'Puck',
  vnSpontaneousInterval: num('VN_SPONTANEOUS_INTERVAL', 5),
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
    (config.localAiUrl ? config.pools.localai.length : 0) +
    config.pools.dreamprompting.length +
    config.pools.cloudflare.length +
    config.pools.openrouter.length +
    config.pools.groq.length +
    config.pools.gemini.length +
    config.pools.opencode.length;

  if (totalKeys === 0) throw new Error('Semua pool key kosong. Isi minimal satu provider di .env.');
}
