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
  // Jika DAHL_PROXY_URL diset, semua request Dahl dialihkan ke Cloudflare Worker
  // (bypass Cloudflare WAF Dahl yang memblokir IP AWS/Vercel).
  // Bila kosong: pakai DAHL_BASE_URL (endpoint langsung) atau default resmi Dahl.
  dahlProxyUrl: cleanStr('DAHL_PROXY_URL') || cleanStr('DAHL_BASE_URL') || 'https://inference.dahl.global/v1',
  pools: {
    dreamprompting: csv('DREAMPROMPTING_KEYS'),
    cloudflare: csv('CLOUDFLARE_KEYS'),
    nvidia: csv('NVIDIA_KEYS'),
    openrouter: csv('OPENROUTER_KEYS'),
    groq: csv('GROQ_KEYS'),
    gemini: csv('GEMINI_KEYS'),
    dahl: csv('DAHL_KEYS'),
    xkiro: csv('XKIRO_KEYS'),
    opencode: csv('OPENCODE_KEYS'),
  },
  cloudflareAccountId: cleanStr('CLOUDFLARE_ACCOUNT_ID'),
  models: {
    // Tier 1: DreamPrompting (100 RPM, Rolling Free Tier)
    // Model Utama: groq/qwen/qwen3.6-27b (teruji cepat dan patuh penuh)
    // Cadangan: groq/openai/gpt-oss-120b (penalaran kuat)
    dpPrimary: 'groq/qwen/qwen3.6-27b',
    dpBackup: [
      'groq/openai/gpt-oss-120b',
    ],

    // Tier 2: Cloudflare Workers AI
    cfPrimary: '@cf/qwen/qwen3.8-27b',
    cfBackup: ['@cf/nvidia/nemotron-3-120b-a12b', '@cf/openai/gpt-oss-20b'],
    cfVision: [
      '@cf/meta/llama-4-scout-17b-16e-instruct',
      '@cf/mistralai/mistral-small-3.1-24b-instruct',
      '@cf/qwen/qwen3.8-27b',
    ],

    // Tier 3: NVIDIA NIM (1.000 Free Credits / key)
    // Model Utama: google/diffusiongemma-26b-a4b-it (590ms)
    // Cadangan: meta/llama-3.2-11b-vision-instruct (711ms, multimodal & reasoning)
    // OpenCode Free (langsung ke opencode.ai, TANPA 9Router):
    // 2 model sesuai permintaan user. Terverifikasi 3/3 stabil.
    // Wajib: 4 tool fingerprint + format per-endpoint (lihat opencodeChat).
    opencodePrimary: 'muse-spark-1.3-contributor-free',
    opencodeBackup: ['mimo-v2.6-flash-free'],
    nvidiaPrimary: 'google/diffusiongemma-26b-a4b-it',
    nvidiaBackup: [
      'meta/llama-3.2-11b-vision-instruct',
    ],

    // Tier 4: OpenRouter (model :free)
    // Model Utama: nvidia/nemotron-3-ultra-550b-a55b:free (1M konteks, 409ms)
    // Cadangan: inclusionai/ling-3.0-flash-sante:free (262K konteks, 723ms)
    orPrimary: 'nvidia/nemotron-3-ultra-550b-a55b:free',
    orBackup: ['inclusionai/ling-3.0-flash-sante:free'],

    // Tier 5: Groq Cloud API (LPU Ultra-Fast Inference)
    groqPrimary: 'qwen/qwen3.8-27b',
    groqBackup: ['openai/gpt-oss-120b'],

    // Tier 6: Google Gemini API (1M Konteks)
    geminiPrimary: 'gemini-3.8-flash',
    geminiBackup: ['gemini-flash-lite-latest'],
    geminiVision: ['gemini-flash-lite-latest', 'gemini-3.6-flash'],

    // Tier 7: Dahl Global API (1B Token Pool)
    // Model Utama: deepseek-ai/DeepSeek-V4-Flash-0731
    // Cadangan: zai-org/GLM-5.3-Flash (teruji live HTTP 200, 1.794ms)
    dahlPrimary: 'deepseek-ai/DeepSeek-V4-Flash-0731',
    dahlBackup: [
      'zai-org/GLM-5.3-Flash',
    ],

    // Provider Cadangan & Multimodal / Search: xKiro Gateway
    xkiroPrimary: 'qwen/qwen3.8-max:free',
    xkiroBackup: [
      'qwen/qwen3.7-max:free',
      'qwen/qwen3.6-max-preview:free',
    ],
    // Rantai vision eksplisit. DIROMBAK 21 Sep berdasarkan UJI GAMBAR NYATA (2 blok
    // biru/kuning): model yang terbukti BENAR + cepat didahulukan, yang membalas KOSONG
    // atau error 400 DIBUANG (bukan ditebak):
    //   BENAR  : groq/qwen3.8-27b, cf/llama-4-scout (716ms!), cf/mistral-small-3.1,
    //            cf/qwen3.8-27b, gemini-3.1-flash-lite (1213ms), gemini-2.5-flash,
    //            gemini-3.6-flash, xkiro qwen3.8-max, xkiro qwen3.8-omni-flash
    //   DIBUANG: @cf/google/gemma-4-26b-a4b-it (KOSONG), @cf/llava-1.5-7b (KOSONG),
    //            @cf/meta/llama-3.2-11b-vision (HTTP 400 "unable to add image"),
    //            gemini-3.5-flash-lite (HTTP 400 invalid argument), minimax-m3 (tidak lolos)
    // Dipakai chat({ vision: true }) untuk foto, stiker, dan gambar di dalam dokumen Word.
    visionChain: [
      { kind: 'groq', model: 'qwen/qwen3.8-27b' },
      // ---- DITAMBAHKAN 04 Okt (hasil ukur nyata dengan gambar uji) ----
      // xKiro DISUSPEND (403) & Cloudflare NEURON HABIS -> 5 dari 11 model lama mati.
      // Tiga model berikut diukur langsung dan terbukti BERFUNGSI + CEPAT:
      //   openrouter/nemotron-3-nano-omni-free  441ms  benar + taat instruksi (TERCEPAT)
      //   nvidia/llama-3.2-11b-vision-instruct  769ms  benar (kurang taat format)
      { kind: 'openrouter', model: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free' },
      { kind: 'nvidia', model: 'meta/llama-3.2-11b-vision-instruct' },
      // DITAMBAHKAN 04 Okt (uji nyata): OpenCode ternyata BISA VISION.
      // Diuji dengan gambar nyata — 4 model menjawab BENAR & taat instruksi:
      //   big-pickle       1261ms
      //   mimo-v2.5-free   1536ms | mimo-v2.6-flash   1821ms
      // CATATAN: muse-spark-1.3 (model utama OpenCode) TIDAK bisa vision —
      // dia menjawab "Saya cek dulu gambarnya..." alih-alih membacanya.
      { kind: 'opencode', model: 'big-pickle' },
      { kind: 'opencode', model: 'mimo-v2.5-free' },
      // DITAMBAHKAN 25 Sep: Command A Vision — terukur 4/4 akurat untuk OCR tabel
      // angka (2.557ms), jauh lebih cepat dari xkiro/qwen3-vl-plus (4.828ms) dan
      // mengisi celah antara Groq (primer) dan Cloudflare (lemah baca digit halus).
      { kind: 'xkiro', model: 'cohere/command-a-vision' },
      // ---------------------------------------------------------------------
      // DIKOREKSI 24 Sep (temuan pemilik produk): `@cf/meta/llama-4-scout` dan
      // `@cf/mistralai/mistral-small-3.1` DIKELUARKAN dari jalur vision.
      //
      // Keluhan nyata: user meminta ekstraksi angka dari tabel harga kayu, bot
      // membalas deretan tanda pisah ("- - - - -") alih-alih angkanya. Setelah
      // diuji, akarnya BUKAN kode kita (tidak ada satu pun aturan yang mengubah
      // digit jadi dash — sudah dipindai seluruh src/), melainkan kedua model itu
      // memang tidak sanggup membaca digit di dalam sel tabel.
      //
      // Uji pembanding pada gambar yang sama (50 angka kunci), hasil terukur:
      //   groq/qwen3.8-27b        49/50 benar,  5,4 dtk  <- tetap primer
      //   xkiro/qwen3.8-max       50/50 benar, 16,7 dtk
      //   xkiro/qwen3-vl-plus     50/50 benar, 22,3 dtk
      //   gemini-2.5-flash         2/50 benar, 76 dtk   (gagal)
      // Kedua model Cloudflare di bawah ini tidak dipakai lagi karena alasan itu;
      // Cloudflare tetap ada di rantai lewat qwen3.8-27b yang jauh lebih akurat.
      //
      // Catatan: `@cf/meta/llama-4-scout` tetap BENAR dan cepat (716ms) untuk
      // gambar biasa (foto, stiker) — yang gagal adalah pembacaan digit halus.
      // Karena itu ia dipindah ke urutan paling akhir sebagai jaring terakhir,
      // bukan dibuang: lebih baik memberi jawaban umum daripada tidak menjawab.
      // ---------------------------------------------------------------------
      { kind: 'cloudflare', model: '@cf/qwen/qwen3.8-27b' },
      { kind: 'gemini', model: 'gemini-flash-lite-latest' },
      { kind: 'gemini', model: 'gemini-2.5-flash' },
      { kind: 'gemini', model: 'gemini-3.6-flash' },
      { kind: 'xkiro', model: 'qwen/qwen3.8-max:free' },
      // Dua model multimodal xKiro lain yang TERBUKTI bekerja saat uji 22 Sep (gambar
      // stiker nyata, semua terbaca benar). Ditaruh setelah qwen3.8-max karena keduanya
      // lebih lambat pada gambar BARU (qwen3-vl-plus 5.293ms, qwen3.5-omni-flash 10.153ms,
      // sedangkan qwen3.8-max 4.269-6.486ms) — tapi tetap berguna sebagai lapisan
      // tambahan sebelum jaring terakhir, karena kuotanya terpisah per kunci.
      { kind: 'xkiro', model: 'qwen/qwen3-vl-plus:free' },
      { kind: 'xkiro', model: 'qwen/qwen3.5-omni-flash:free' },
      // Jaring TERAKHIR: model Cloudflare yang cepat tapi lemah membaca digit halus.
      // Dipakai hanya bila seluruh model di atas gagal, agar user tetap dapat balasan.
      { kind: 'cloudflare', model: '@cf/meta/llama-4-scout-17b-16e-instruct' },
      // xKiro Qwen 3.8 Omni Flash (model multimodal terbaru xKiro). DIUJI 22 Sep dengan
      // 10 stiker nyata dan hasilnya TIDAK ANDAL, jadi sengaja ditaruh PALING AKHIR:
      //   - 2/5 berhasil pada gambar baru (60% timeout 90 dtk); pembanding xKiro
      //     qwen3.8-max 5/5 berhasil pada gambar yang sama.
      //   - Saat berhasil pun lebih lambat: rata-rata 13.967ms vs qwen3.8-max 6.324ms.
      //   - Kesan pertama "90ms" menipu: itu gambar yang SAMA dikirim berulang sehingga
      //     kena cache. Pada gambar baru, cold start-nya 9-17 dtk atau timeout.
      // Tetap dipasang sebagai jaring terakhir (bukan dibuang) karena model ini BENAR
      // saat berhasil ("Ipin dari Upin & Ipin", "anak kucing menangis") dan tidak
      // memakai kuota provider lain. Catatan: model ini TIDAK punya batas token ketat.
      { kind: 'xkiro', model: 'qwen/qwen3.8-omni-flash:free' },
    ] as Array<{
      kind: 'dreamprompting' | 'cloudflare' | 'nvidia' | 'openrouter' | 'groq' | 'gemini' | 'dahl' | 'xkiro' | 'opencode';
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
  // Kapasitas output token agar AI mampu menjelaskan detail & koding tanpa terpotong
  maxOutputTokens: num('MAX_OUTPUT_TOKENS', 2500),
  // Batas maksimal total token konteks prompt (agar muat di kuota ketat Groq 8K TPM)
  maxTokensLimit: num('MAX_TOKENS_LIMIT', 8000),
  // Timeout unduhan media terpisah dan pendek
  downloadTimeoutMs: num('DOWNLOAD_TIMEOUT_MS', 25000),
  cacheTtlMs: num('CACHE_TTL_MS', 3600000),
  isServerless: process.env.VERCEL === '1' || !!process.env.AWS_LAMBDA_FUNCTION_NAME,
  dailyCap: {
    dreamprompting: num('DAILY_CAP_DREAMPROMPTING', 1000),
    cloudflare: num('DAILY_CAP_CLOUDFLARE', 120),
    nvidia: num('DAILY_CAP_NVIDIA', 1000),
    openrouter: num('DAILY_CAP_OPENROUTER', 50),
    groq: num('DAILY_CAP_GROQ', 1000),
    gemini: num('DAILY_CAP_GEMINI', 1500),
    dahl: num('DAILY_CAP_DAHL', 5000),
    xkiro: num('DAILY_CAP_XKIRO', 500),
    opencode: num('DAILY_CAP_OPENCODE', 1000),
  },
  // Batas TOKEN per hari (TPD) per key. 0 = tidak dibatasi.
  // Groq Free Tier resmi: 200K TPD untuk qwen3.8-27b & qwen3.6-27b
  // (tercapai jauh lebih cepat daripada RPD 1.000 pada ~2.5K token/call).
  dailyTokenCap: {
    opencode: numAllowZero('DAILY_TOKEN_CAP_OPENCODE', 0),
    dreamprompting: numAllowZero('DAILY_TOKEN_CAP_DREAMPROMPTING', 0),
    cloudflare: numAllowZero('DAILY_TOKEN_CAP_CLOUDFLARE', 0),
    nvidia: numAllowZero('DAILY_TOKEN_CAP_NVIDIA', 0),
    openrouter: numAllowZero('DAILY_TOKEN_CAP_OPENROUTER', 0),
    groq: numAllowZero('DAILY_TOKEN_CAP_GROQ', 200000),
    gemini: numAllowZero('DAILY_TOKEN_CAP_GEMINI', 0),
    dahl: numAllowZero('DAILY_TOKEN_CAP_DAHL', 0),
    xkiro: numAllowZero('DAILY_TOKEN_CAP_XKIRO', 0),
  },
  // Cap token PER-KEY (urut sama dengan urutan key di pool). Dipakai bila tiap key
  // punya limit BERBEDA — kasus nyata xKiro: key #1 limit 1.000.000 token/hari
  // sementara key #2/#3 hanya 500.000. Format env: "1000000,500000,500000".
  // Bila kosong, semua key memakai dailyTokenCap[kind].
  dailyTokenCapPerKey: {
    opencode: numList('DAILY_TOKEN_CAP_PER_KEY_OPENCODE'),
    dreamprompting: numList('DAILY_TOKEN_CAP_PER_KEY_DREAMPROMPTING'),
    cloudflare: numList('DAILY_TOKEN_CAP_PER_KEY_CLOUDFLARE'),
    nvidia: numList('DAILY_TOKEN_CAP_PER_KEY_NVIDIA'),
    openrouter: numList('DAILY_TOKEN_CAP_PER_KEY_OPENROUTER'),
    groq: numList('DAILY_TOKEN_CAP_PER_KEY_GROQ'),
    gemini: numList('DAILY_TOKEN_CAP_PER_KEY_GEMINI'),
    dahl: numList('DAILY_TOKEN_CAP_PER_KEY_DAHL'),
    xkiro: numList('DAILY_TOKEN_CAP_PER_KEY_XKIRO'),
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
    config.pools.dreamprompting.length +
    config.pools.cloudflare.length +
    config.pools.nvidia.length +
    config.pools.openrouter.length +
    config.pools.groq.length +
    config.pools.gemini.length +
    config.pools.dahl.length +
    config.pools.xkiro.length;
  if (totalKeys === 0) throw new Error('Semua pool key kosong. Isi minimal satu provider di .env.');
}
