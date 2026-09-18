# Arsitektur Agen & Sistem Multi-Model (CLAUDE.md)

Dokumen ini mendefinisikan arsitektur teknis, boundary sistem, protokol eksekusi, serta tata kelola agen dan alur data pada Chat Bot Multi-Platform v0.32.0.

---

## 1. Arsitektur Multi-Provider & Rantai Failover (LLM Engine)

Sistem menggunakan strategi inferensi multi-gateway terintegrasi dengan automatic failover, adaptive circuit breaker, failover berbasis waktu respons, dan output sanitization:

1. **Rantai Failover Teks (6 Tier Otomatis):**
   - **Tier 1 (xKiro Gateway):**
     - Pool: 3 API Key.
     - Primary: `qwen/qwen3.8-max:free` (latensi ~0,15s, kualitas Qwen terbaru).
     - Cadangan: `minimax/minimax-m3:free` (GPQA 93,0), lalu slot arsip `deepseek/deepseek-v4.1-flash:free` (diaktifkan otomatis begitu kembali tersedia di endpoint xKiro).
     - Penyetelan sampling: `temperature` 0,35 (non-DeepSeek) / 0,65 (DeepSeek) dengan `presence_penalty`/`frequency_penalty` murni dinamis tanpa injeksi template statis.
   - **Tier 2 (OpenRouter AI):**
     - Pool: 5 API Key (rotasi).
     - Primary: `deepseek/deepseek-v4-flash-0731:free` (GPQA 90,8), Cadangan: `nex-agi/nex-n2.5-pro:free`, `nvidia/nemotron-3.5-lightning:free`.
     - Tidak dipakai untuk vision (model free menolak image input); berperan sebagai parser PDF cadangan (plugin `file-parser`).
   - **Tier 3 (Groq Cloud API):**
     - Pool: 5 API Key (1.000 RPD/key).
     - Primary: `qwen/qwen3.8-27b` (~284 tok/s), Cadangan: `openai/gpt-oss-120b`.
     - Buffer: Message history dipangkas adaptif ke 6.800 token (menyisakan margin 400 token di bawah limit ketat 8K TPM bersama output 800).
   - **Tier 4 (Cloudflare Workers AI):**
     - Pool: 3 Akun Cloudflare (rotasi multi-account dengan auto-resolution ID akun).
     - Primary: `@cf/qwen/qwen3.8-27b` (Qwen 3.8 27B).
     - Cadangan: `@cf/zai-org/glm-4.7-flash`, `@cf/openai/gpt-oss-120b`, `@cf/meta/llama-3.3-70b-instruct-fp8-fast`.
   - **Tier 5 (Google Gemini API):**
     - Pool: 2 API Key (1.500 RPD/key).
     - Primary: `gemini-3.8-flash`, Cadangan: `gemini-3.5-flash`.
     - Jalur vision prioritas #1 (foto/PDF/video native).
   - **Tier 6 (Dahl Global API):**
     - Pool: 10 API Key dengan kuota 1 Miliar Token via Cloudflare Worker proxy.
     - Primary: `deepseek-ai/DeepSeek-V4-Flash-0731`, Cadangan: `zai-org/GLM-5.3-Flash`, `MiniMaxAI/MiniMax-M2.7`.

2. **Failover Berbasis Waktu Respons (Intra-Tier):**
   - Setiap model dilacak latensi aktualnya (EWMA 0,7/0,3) via `recordModelLatency`.
   - Model yang rata-rata merespons lebih lambat dari `SLOW_MODEL_MS` (default 12.000 ms) diturunkan prioritasnya di dalam tier yang sama (`orderModelsByLatency`), sehingga request berikutnya mencoba model cadangan yang lebih gesit lebih dulu.
   - Failover antar-tier otomatis: bila SEMUA model dalam satu tier gagal/timeout/rate-limit, rantai langsung turun ke tier berikutnya.

3. **Rantai Failover Multimodal / Vision (Foto, Gambar, Stiker, Gambar di Word):**
   - Urutan eksplisit di `config.models.visionChain` — dihormati mutlak (tidak disusun ulang pengurutan latensi):
     1. Groq `qwen/qwen3.8-27b` (token pertama ~408ms)
     2. Cloudflare `@cf/qwen/qwen3.8-27b` (~429ms)
     3. Cloudflare `@cf/google/gemma-4-26b-a4b-it` (endpoint OpenAI-compat)
     4. xKiro `minimax/minimax-m3:free`
     5. Cloudflare `@cf/llava-hf/llava-1.5-7b-hf` (endpoint native `/ai/run`, field `description`)
     6. Gemini `gemini-3.6-flash`
     7. Gemini `gemini-3.5-flash-lite`
     8. Gemini `gemini-2.5-flash`
     9. xKiro `qwen/qwen3.8-max:free`
     10. xKiro `qwen/qwen3.8-omni-flash:free`
   - `gemini-3.8-flash` **dikecualikan** dari rantai foto: terbukti hang ~60 detik tanpa token saat menerima gambar (uji live), tetap primer teks & dokumen/video saja.
   - Model free OpenRouter tidak mendukung image input (HTTP404) — hanya teks & parser PDF.

4. **Thinking Off / Effort Minimal di Semua Provider (v0.30):**
   - Seluruh model reasoning dimatikan mode "berpikir"nya agar token pertama keluar secepat mungkin (keputusan user; akar masalah respons multimodal lambat):
     - Cloudflare: `chat_template_kwargs: { enable_thinking: false }` (qwen 60 dtk → 0,9 dtk; gemma 996 token thinking → 12 token).
     - Groq: `reasoning_effort: 'none'`.
     - OpenRouter: `reasoning: { effort: 'none' }` (3,5 dtk → 1 dtk).
     - xKiro: `reasoning: { effort: 'minimal' }` (`none` membuat MiniMax M3 membalas kosong).
     - Gemini: `thinkingBudget: 0`; varian `flash-lite` memakai `thinkingLevel: 'low'` (menolak budget 0 dengan HTTP400).
     - Dahl: `reasoning_effort: 'none'` (`minimal` memunculkan teks berulang + karakter zero-width).
   - Berlaku juga di seluruh jalur media (audio Gemini, PDF Gemini, PDF OpenRouter, video Gemini) — bukan hanya chat teks.

5. **Tuning Persona Natural — Tawa Proporsional, Anti-Halu/Anti-Teater (v0.31):**
   - **Tawa proporsional (bukan dihilangkan):** kata tawa (wkwk/haha/hehe/ckck) hanya pantas bila lawan bicara menunjukkan sinyal humor/tertawa lebih dulu. Prompt melarang tawa sebagai hiasan basa-basi dan membuka pesan dengan tawa; sanitizer membuang seluruh kata tawa bila tidak ada sinyal humor dari user, dan menyisakan maksimal 1 bila ada.
   - **Anti-halu & anti-teater:** larangan narasi akting/arahan panggung dalam tanda bintang (`*[mata berkaca-kaca]*`), larangan mengaku/menawarkan diri sebagai pacar tanpa diminta, larangan mengarang kejadian/pengalaman fisik/fakta tentang user.
   - **Anti-template CS:** pembersih pola customer service ("terima kasih telah menghubungi", "jam layanan ... WIB", "admin akan segera membantu") dan penolakan robotik murni; menu pilihan kaku (daftar item yang diperkenalkan "Kamu mau main apa dulu?" / "aku bisa jadi:") dibersihkan — daftar teknis/kode tidak pernah tersentuh.
   - **Zero-hardcode:** seluruh pembersihan hanya MENGHAPUS/menormalkan pola; tidak ada satu pun kalimat balasan yang disuntikkan. Balasan kosong diregenerasi dinamis oleh `autoReply`/`describeImage`.
   - **Batas token ≤8K:** estimasi pemangkasan `trimMessagesToTokenBudget` dikalibrasi 3,3 karakter/token (konservatif) — buffer Groq 6.800 tetap, aman di bawah 8K TPM.
   - Verifikasi dataset 469 baris: tawa 114 → 27 baris (87 dibersihkan, 27 dipertahankan karena user bercanda duluan); template CS 15 → 1; `PROMPT_VERSION` naik ke `v0.31.0`.

6. **Audio, Dokumen & Video:**
   - Audio / Voice Note: Groq Whisper (`whisper-large-v3` > `whisper-large-v3-turbo`), cadangan Cloudflare Whisper (`@cf/openai/whisper-large-v3-turbo`, pool & kuota berbeda), lalu Gemini native audio (3.5 Flash Lite > 2.5 Flash).
   - File Dokumen (.docx, .txt): Ekstraksi lokal via Mammoth / TextParser → rantai teks utama. Jika .docx memuat gambar, gambar diekstrak (maks 3) dan dianalisis via rantai vision (`docx-vision`).
   - Dokumen PDF: Gemini native PDF (3.6 Flash > 3.5 Flash Lite > 2.5 Flash) → cadangan OpenRouter plugin `file-parser` (engine `pdf-text`) → parser teks lokal.
   - Video: Gemini native video (3.6 Flash > 3.5 Flash Lite > 2.5 Flash) → cadangan transkripsi trek audio (Whisper) lalu dijawab rantai teks.

7. **Zero-Configuration Vercel Models (Hardcoded Code Fallback):**
   - Seluruh model default dikonfigurasi langsung di dalam kode (`src/env.ts`), sehingga pengguna tidak perlu mendaftarkan variabel model di dashboard Vercel / `.env`. Cukup menyuplai API key masing-masing provider.

8. **Zero Teks Statis — Semua Balasan 100% Dinamis (v0.32):**
   - **Prinsip mutlak:** tidak ada satu pun kalimat balasan bot yang di-hardcode. Setiap respons (termasuk pesan sistem, konfirmasi perintah, dan pemberitahuan kegagalan) disusun sendiri oleh model dari instruksi kontekstual.
   - **Helper `dynamicNotice(instruction, ctx)`** di `src/skills.ts`: meminta model menyusun pesan pemberitahuan/kontrol secara dinamis; mengembalikan `''` bila seluruh provider mati sehingga pemanggil tidak mengirim apa pun.
   - **Penghapusan fallback statis:** `statusDown()`, `'Lahh kan kamu mah bukan si Rafly.'`, pesan antrean PDF/video, pesan VN gagal, konfirmasi reset sesi, konfirmasi lokasi, pesan error WhatsApp, dan seluruh fallback `reply || '...'` pada perintah `/salah` & `/remind` telah dihapus di ketiga kanal (Telegram, WhatsApp Cloud, WhatsApp Baileys).
   - **Degradasi senyap (fail-silent):** bila model gagal menghasilkan teks (semua provider mati), balasan dibiarkan kosong dan platform tidak mengirim pesan; `escalate: true` tetap memicu notifikasi ke owner di Telegram.
   - **Guard integritas data:** balasan kosong tidak pernah disimpan ke Supabase (`saveMessage`/`updateContextCache` early-return) dan `resetSession` kini `Promise<void>` (tanpa teks konfirmasi statis).
   - **Fallback berbasis data user tetap sah:** emoji asli stiker user dan teks pengingat milik user sendiri (`item.message`) dipakai apa adanya bila model mati — keduanya konten dinamis milik user, bukan template bot.

---

## 2. Saluran Komunikasi & Webhook Pipeline

Bot beroperasi secara paralel pada tiga platform perpesanan utama:

1. **Telegram Bot API:**
   - Polling engine via `node-telegram-bot-api` dengan auto-reconnect backoff.
   - Endpoint webhook didukung untuk deployment serverless Vercel.
   - Penanganan media suara/audio otomatis via Groq Whisper API.
   - Dedup pesan atomik berbasis ID pesan Telegram dan upsert state media.

2. **WhatsApp Cloud API (Meta Official):**
   - Handler webhook HTTP standar industri via endpoint `/api/whatsapp`.
   - Validasi signature payload SHA-256 (`x-hub-signature-256`) dengan timing-safe comparison dan raw-body stream buffer jika `WHATSAPP_APP_SECRET` dikonfigurasi, dengan fallback graceful (didukung Meta verify token handshake) untuk mencegah pemadaman layanan jika secret belum diset di Vercel.
   - Deduplikasi pesan atomik seketika memanfaatkan unique constraint database.

3. **WhatsApp Web (Baileys Engine):**
   - Socket multi-device untuk nomor lokal / alternatif.
   - Auto QR-code generation dan manajemen state sesi.

---

## 3. Sistem Keamanan & Pertahanan Data (Security & Guardrails)

1. **Perlindungan Otentikasi Admin:**
   - Master PIN diproteksi hashing SHA-256 dengan canonical universal salt (`CANONICAL_SALT` default: `'rafly_telemetry_salt'`) serta multi-salt matching resolution (`resolveMatchingHash`) untuk menjamin paritas cross-device tanpa hambatan antara localhost dan Vercel Serverless.
   - Auto-upgrade salt database: saat verifikasi PIN berhasil menggunakan salt legacy/fallback, hash database otomatis di-upgrade ke canonical salt secara transparan.
   - Row-Level Locking (`FOR UPDATE`) pada operasi verifikasi (`rpc_admin_verify_pin`), reset OTP (`rpc_admin_verify_otp_and_reset_pin`), dan penggantian PIN (`rpc_admin_change_pin`) untuk mencegah race condition.
   - Rate limiting bertingkat dan lockout progresif pada kegagalan otentikasi.
   - Strict Origin & Referer checking pada seluruh mutasi kredensial.

2. **Keamanan Jaringan & Web Scraping (SSRF Shield):**
   - `isSafePublicUrl`: Validasi ketat memblokir IP internal (`127.0.0.1`, `10.0.0.0/8`, `192.168.0.0/16`, `169.254.169.254`), metadata cloud, dan DNS localhost.
   - Sanitasi teks pengetahuan web (`sanitizeKnowledgeText`): Menetralisir potensi indirect prompt injection dari hasil pencarian sebelum disuntikkan ke prompt sistem.

3. **HTTP Security Headers:**
   - Content Security Policy (CSP) ketat tanpa `unsafe-eval` dan tanpa `unsafe-inline` pada `script-src` (seluruh skrip antarmuka dan dashboard diekstraksi ke berkas terisolasi `/js/*.js`, dengan `base-uri 'self'`, `object-src 'none'`, `frame-ancestors 'none'`). Seluruh event handler diikat via `addEventListener` di `/js/*.js`; berkas `public/**/*.html` tidak memuat event handler inline (`on*=`). Tidak ada domain CDN eksternal yang tidak terpakai di CSP.
   - HSTS seragam 2 tahun (`Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`) di `vercel.json` dan seluruh endpoint `api/`.
   - X-Frame-Options: `DENY`, X-Content-Type-Options: `nosniff`, Referrer-Policy: `strict-origin-when-cross-origin`.

4. **Tata Kelola Data & RTBF (Right To Be Forgotten):**
   - Ledger migrasi `public.schema_migrations` (RLS, akses `service_role` saja) mencatat versi migrasi yang sudah diterapkan secara idempotent.
   - RPC `service_role`-only `rpc_purge_user_data(p_chat_id text)` menghapus pesan, summaries, corrections, dan reminders pengguna; `rpc_purge_expired_web_knowledge()` menghapus entri `web_knowledge` yang kadaluwarsa.
   - Kedua RPC hanya dapat dipanggil melalui aksi terautentikasi di `api/admin-otp.ts` (`purge_user_data`, `purge_expired_knowledge`) setelah verifikasi session token; tidak ada jalur tanpa autentikasi.

---

## 4. Sistem Dedup Atomik & Concurrency Control

1. **Atomic Message Claiming (`claimIncomingMessage`):**
   - Menggunakan pattern _insert-first_ ke tabel `messages` dengan mengandalkan PostgreSQL unique index `idx_messages_platform_msg_id`.
   - Menghilangkan celah TOCTOU (Time-of-Check to Time-of-Use) ketika webhook simultan masuk dalam selang waktu sub-milidetik.
   - Fail-closed pada database error untuk mencegah duplikasi pemrosesan pesan tak tercatat.
   - Durabilitas anti-lockout crash recovery: jika worker mengalami crash mendadak di tengah proses, pesan yang belum selesai diproses (`processed_at IS NULL`) dan berumur > 45 detik dapat di-claim ulang secara aman saat platform mengirim retry.
   - Update metadata pesan lanjutan (caption media/transkripsi) menggunakan `upsert` pada `(platform, msg_id)` sehingga tidak memicu error duplicate key 23505.

2. **Reminder Lease-Lock & Deadlock Auto-Reaper:**
   - Klaim reminder jatuh tempo menggunakan kolom sewa waktu atomik (`lease_until = now() + 10 minutes`) pada status `'processing'` tanpa memodifikasi `due_at` asli.
   - Auto-reaper otomatis me-reset status `processing` yang sewanya kadaluwarsa (`lease_until <= now()`) kembali menjadi `pending` tanpa mengganggu proses pengiriman aktif yang memakan waktu lama.
   - Status `sent` dan pelepasan sewa (`lease_until = null`) hanya ditulis setelah konfirmasi keberhasilan pengiriman dari client API.

---

## 5. Persistent Memory & Knowledge Retrieval (Supabase)

1. **Stateful Conversation History:**
   - Riwayat percakapan tersimpan di Supabase dengan pagination dinamis.
   - In-memory Conversation Context Cache di `src/memory.ts` dengan rolling TTL 25 detik dan 15 pesan terakhir untuk respons instan 0-5ms tanpa round-trip DB berulang.
   - In-memory Knowledge Web Cache di `src/knowledge.ts` berkapasitas 300 entri dengan FIFO pruning 50 entri tertua saat batas tercapai.

2. **Autonomous Dynamic Timezone Awareness:**
   - Pengenalan konteks waktu dinamis berbasis deteksi domisili/kota pengguna (~100 entri pemetaan kata kunci wilayah/kota terkurasi) tanpa memaksa zona waktu statis tunggal.

3. **Observabilitas & Instrumentasi Dataset:**
   - `src/logger.ts` menyediakan structured logging JSON satu-baris (tanpa dependensi eksternal, mode `LOG_PRETTY=1` opsional); saat ini dipasang di `src/index.ts`, `api/webhook.ts`, dan `api/whatsapp.ts`.
   - Kolom instrumentasi opsional pada tabel `messages` (`latency_ms`, `needs_search`, `split_count`, `prompt_version`, `feedback`) diisi best-effort oleh `src/db.ts` dari ketiga channel untuk evaluasi fine-tuning.
