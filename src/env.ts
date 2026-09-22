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
    // Backup WAJIB ada di katalog gateway (diverifikasi live). Model lama
    // 'deepseek/deepseek-v4.1-flash:free' sudah DIHAPUS dari xkiro -> tiap failover
    // ke sana menghasilkan HTTP 404 dan membuang waktu rantai (temuan audit).
    //
    // INSTRUKSI USER (21 Sep): "untuk model dari xkiro itu cukup dari qwen saja,
    // jangan masukan minimax atau mistral" -> seluruh backup adalah Qwen.
    // UJI LANJUTAN 21 Sep (3 prompt berbeda): ketiga Qwen lolos SEMUA (P2 kepatuhan,
    // P3 kepintaran, P4 gaya) dengan 0 pelanggaran. Latensi: 3.6-max 3629ms <
    // 3.7-max 4012ms < 3.8-max 4972ms -> yang lebih gesit didahulukan sebagai backup.
    xkiroBackup: ['qwen/qwen3.6-max-preview:free', 'qwen/qwen3.7-max:free'],
    // Tier 2: OpenRouter (model :free).
    // AUDIT 20 Sep 2026: 'deepseek/deepseek-v4-flash-0731:free' SUDAH TIDAK ADA di
    // katalog OpenRouter (dicek live: 446 model, NOL model deepseek :free) -> setiap
    // request 404 dan membuang waktu rantai. Diganti dengan model yang TERVERIFIKASI
    // ada DAN diuji live (HTTP 200):
    //   - nex-agi/nex-n2.5-pro:free (context 262K, sudah terbukti di produksi)
    //   - nvidia/nemotron-3.5-lightning:free (context 1M)
    // INSTRUKSI USER (21 Sep): primary = nex-agi/nex-n2.5-mini:free.
    // UJI LANJUTAN 21 Sep: nex-n2.5-mini lolos 3/3 prompt (P2/P3/P4), 0 pelanggaran,
    // latensi 506ms = TERCEPAT di seluruh katalog OpenRouter.
    // nex-n2.5-pro DITURUNKAN ke backup: 18,4 detik (terlambat) di uji v1.
    // Backup dipilih dari hasil uji: ling-3.0-flash-fin (1041ms, 3/3 lolos) --
    // hanya 1 backup (user: "cukup 1, maksimal 2 bila masih layak").
    orPrimary: 'nex-agi/nex-n2.5-mini:free',
    orBackup: ['inclusionai/ling-3.0-flash-fin:free'],
    // Tier 3: Groq Cloud API (LPU Ultra-Fast Inference)
    // UJI KEPATUHAN 20 Sep: qwen3.8-27b & gpt-oss-120b = PATUH SEMPURNA + tercepat
    // (763-1202ms). Dua model ini adalah yang paling patuh dari SEMUA provider.
    // UJI LANJUTAN 21 Sep: groq/qwen3.8-27b lolos 3/3 prompt, 0 pelanggaran, 370ms =
    // TERCEPAT dari seluruh 89 model yang diuji. gpt-oss-120b juga 3/3 (878ms).
    groqPrimary: 'qwen/qwen3.8-27b',
    groqBackup: ['openai/gpt-oss-120b'],
    // Tier 2: Cloudflare Workers AI
    // UJI KEPATUHAN 20 Sep: 4/4 model PATUH SEMPURNA.
    // PRIMARY = qwen3.8-27b (PERMINTAAN USER 20 Sep: "coba model dari cf jangan glm, pake
    // qwen aja"). Alasan tambahan: glm-4.7-flash terbukti membuat tebakan kontradiktif
    // ("hewan paling suka diam" -> jawaban "si Lebah") dan respons aneh ("Pertahankan!").
    // INSTRUKSI USER (21 Sep): primary = @cf/qwen/qwen3.8-27b (bukan glm lagi).
    // UJI LANJUTAN 21 Sep: cf/qwen3.8-27b lolos P2 & P4, tapi GAGAL P3 (menjawab "12 jam"
    // untuk soal yang jawabannya 6) -- dicatat sebagai kelemahan yang diterima karena
    // user menetapkannya sebagai primary.
    // BACKUP dipilih dari yang lolos 3/3 + tercepat (user: maksimal 2):
    //   @cf/nvidia/nemotron-3-120b-a12b (891ms, 3/3) -- tercepat & lolos penuh
    //   @cf/openai/gpt-oss-20b (1227ms, 3/3)
    cfPrimary: '@cf/qwen/qwen3.8-27b',
    cfBackup: ['@cf/nvidia/nemotron-3-120b-a12b', '@cf/openai/gpt-oss-20b'],
    // Model vision Cloudflare (sinkron dengan rantai vision runtime): Qwen & Gemma via
    // endpoint OpenAI-compat /ai/v1, LLaVA via endpoint native /ai/run (byte array).
    cfVision: [
      '@cf/meta/llama-4-scout-17b-16e-instruct',
      '@cf/mistralai/mistral-small-3.1-24b-instruct',
      '@cf/qwen/qwen3.8-27b',
    ],
    // Tier 5: Google Gemini API (1M Konteks)
    // INSTRUKSI USER (21 Sep): primary = gemini-3.8-flash.
    // UJI LANJUTAN 21 Sep: gemini-3.8-flash lolos P2 & P4, GAGAL P3 (jawaban kosong).
    // BACKUP: gemini-3.1-flash-lite (1106ms, 3/3 lolos) -- jauh lebih cepat dari
    // 3.5-flash (9714ms) dan lolos penuh. Hanya 1 backup (user: cukup 1).
    geminiPrimary: 'gemini-3.8-flash',
    geminiBackup: ['gemini-3.1-flash-lite'],
    // Model Gemini khusus jalur VISION. gemini-3.8-flash dikecualikan: terbukti hang ~60s
    // tanpa token saat menerima gambar (uji live), jadi tetap primer teks saja.
    // DIROMBAK 21 Sep: 3.1-flash-lite terbukti BENAR+TERCEPAT (1213ms gambar, 3429ms PDF);
    // 3.5-flash-lite DIBUANG (HTTP 400 "invalid argument" saat gambar/PDF).
    // Urutan: cepat -> lambat (3.6-flash terakhir karena 12,5 dtk).
    geminiVision: ['gemini-3.1-flash-lite', 'gemini-2.5-flash', 'gemini-3.6-flash'],
    // Tier 6: Dahl Global API (1B Token Pool - latensi ~0,22s)
    // UJI KEPATUHAN 20 Sep: DeepSeek-V4-Flash = 2164ms, hanya emoji berlebihan (sudah
    // dibatasi sanitizer). MiniMax-M2.7 DIHAPUS dari backup teks: membocorkan <think>,
    // 58 kata, 17 detik (instruksi user: "minimax hilangkan dari backup text, simpan
    // di multimodal saja" — MiniMax tetap dipakai di jalur vision).
    // UJI LANJUTAN 21 Sep (2 prompt berbeda):
    //   deepseek-ai/DeepSeek-V4-Flash-0731 -> 1536ms, v1 bersih (empati+helpful), tapi
    //     GAGAL P2/P3/P4 saat concurrency penuh (HTTP 429 "concurrency capacity").
    //   zai-org/GLM-5.3-Flash   -> KOSONG 27,6 DETIK (tidak layak jadi backup).
    //   MiniMaxAI/MiniMax-M2.7  -> 5993ms tapi MEMBOCORKAN <think> (tidak layak).
    // KEPUTUSAN: Dahl hanya 1 model teks (DeepSeek). Bila gagal, failover LANGSUNG ke
    // tier berikutnya (Gemini) -- lebih baik daripada membuang waktu ke backup yang
    // terbukti kosong/bocor. MiniMax tetap dipakai di jalur VISION.
    dahlPrimary: 'deepseek-ai/DeepSeek-V4-Flash-0731',
    dahlBackup: [],
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
      { kind: 'cloudflare', model: '@cf/meta/llama-4-scout-17b-16e-instruct' },
      { kind: 'cloudflare', model: '@cf/mistralai/mistral-small-3.1-24b-instruct' },
      { kind: 'cloudflare', model: '@cf/qwen/qwen3.8-27b' },
      { kind: 'gemini', model: 'gemini-3.1-flash-lite' },
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
    dahl: numAllowZero('DAILY_TOKEN_CAP_DAHL', 0),
    groq: numAllowZero('DAILY_TOKEN_CAP_GROQ', 200000),
    gemini: numAllowZero('DAILY_TOKEN_CAP_GEMINI', 0),
    cloudflare: numAllowZero('DAILY_TOKEN_CAP_CLOUDFLARE', 0),
    openrouter: numAllowZero('DAILY_TOKEN_CAP_OPENROUTER', 0),
    xkiro: numAllowZero('DAILY_TOKEN_CAP_XKIRO', 0),
  },
  // Cap token PER-KEY (urut sama dengan urutan key di pool). Dipakai bila tiap key
  // punya limit BERBEDA — kasus nyata xKiro: key #1 limit 1.000.000 token/hari
  // sementara key #2/#3 hanya 500.000. Format env: "1000000,500000,500000".
  // Bila kosong, semua key memakai dailyTokenCap[kind].
  dailyTokenCapPerKey: {
    dahl: numList('DAILY_TOKEN_CAP_PER_KEY_DAHL'),
    groq: numList('DAILY_TOKEN_CAP_PER_KEY_GROQ'),
    gemini: numList('DAILY_TOKEN_CAP_PER_KEY_GEMINI'),
    cloudflare: numList('DAILY_TOKEN_CAP_PER_KEY_CLOUDFLARE'),
    openrouter: numList('DAILY_TOKEN_CAP_PER_KEY_OPENROUTER'),
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
    config.pools.dahl.length +
    config.pools.groq.length +
    config.pools.gemini.length +
    config.pools.cloudflare.length +
    config.pools.openrouter.length +
    config.pools.xkiro.length;
  if (totalKeys === 0) throw new Error('Semua pool key kosong. Isi minimal satu provider di .env.');
}
