# Arsitektur Agen & Sistem Multi-Model (AGENTS.md)

Dokumen ini mendefinisikan arsitektur teknis, boundary sistem, protokol eksekusi, serta tata kelola agen dan alur data pada Chat Bot Multi-Platform v0.27.0.

---

## 1. Arsitektur Multi-Provider & Rantai Failover (LLM Engine)

Sistem menggunakan strategi inferensi multi-gateway terintegrasi dengan automatic failover, adaptive circuit breaker, dan output sanitization:

1. **Rantai Failover Teks (7 Tier Otomatis):**
   - **Tier 1 (Direct OpenCode Zen API):**
     - Pool: 4 API Key (`sk-Mm56c...`, `sk-YWTsb...`, `sk-dVsDp...`, `sk-kmc7K...`).
     - Primary: `muse-spark-1.3-contributor-free` (bahasa luwes, santai, empatik, 1M context).
     - Cadangan: `muse-spark-1.2-contributor-free` (failover jika versi 1.3 sibuk/timeout).
     - Adapter kustom `{ model, input }` dengan koneksi 10s non-streaming.
   - **Tier 2 (xKiro Gateway):**
     - Pool: 3 API Key (`sk-xt-f785...`, `sk-xt-6c69...`, `sk-xt-061a...`).
     - Primary: `deepseek/deepseek-v4.1-flash:free` (latensi ~2.3s, super cepat, coding & reasoning kuat).
     - Cadangan: `deepseek/deepseek-v4.1-flash`, `deepseek/deepseek-chat-v3.1`, `mistralai/mistral-small-2603`.
     - Penyetelan Sampling DeepSeek: `temperature: 0.65`, `presence_penalty: 0.1`, `frequency_penalty: 0.1` murni dinamis tanpa injeksi template statis agar model leluasa menghasilkan gaya naturalnya sendiri.
   - **Tier 3 (Groq Cloud API):**
     - Pool: 5 API Key (800 RPD/key).
     - Primary: `qwen/qwen3.8-27b`, Cadangan: `qwen/qwen3.6-27b`.
     - Buffer: Message history dipangkas adaptif ke 7.200 token agar aman di bawah limit ketat 8K TPM.
   - **Tier 4 (Google Gemini API):**
     - Pool: 2 API Key (1.400 RPD/key).
     - Primary: `gemini-3.8-flash`, Cadangan: `gemini-2.5-flash`.
   - **Tier 5 (Cloudflare Workers AI):**
     - Pool: 3 Akun Cloudflare (rotasi multi-account dengan auto-resolution ID akun).
     - Primary: `@cf/meta/llama-3.1-70b-instruct` (Llama 3.1 70B).
     - Cadangan: `@cf/qwen/qwen2.5-coder-32b-instruct` (Qwen 2.5 Coder 32B).
   - **Tier 6 (OpenRouter AI):**
     - Pool: 5 API Key pool rotation.
     - Primary: `nex-agi/nex-n2.5-pro:free`, Cadangan: `nvidia/nemotron-3.5-lightning:free`.
   - **Tier 7 (Dahl Global API):**
     - Pool: 10 API Key (`dahl_Kiv1N...` s.d. `dahl_GsHqB...`) dengan kuota 1 Miliar Token via Cloudflare Worker proxy.
     - Primary: `deepseek-ai/DeepSeek-V4-Flash-0731`, Cadangan: `MiniMaxAI/MiniMax-M2.7`.

2. **Rantai Failover Multimodal / Vision (Foto, Gambar, Stiker):**
   - **Vision Prioritas 1:** Google Gemini (`gemini-3.8-flash` > `gemini-2.5-flash`) — Native vision token parser.
   - **Vision Prioritas 2:** Cloudflare Workers AI (`@cf/meta/llama-3.2-11b-vision-instruct`) — Pemanggilan native `/ai/run` endpoint dengan payload byte array biner.
   - **Vision Prioritas 3:** OpenRouter AI (`nex-agi/nex-n2.5-pro:free` > `nex-agi/nex-n2.5-mini:free`).
   - Provider teks murni (`dahl`, `groq`, `opencode`, `xkiro`) dilewati otomatis (0ms overhead) saat query membutuhkan vision.

3. **Audio & Dokumen:**
   - Audio / Voice Note: Groq Whisper (`whisper-large-v3` > `whisper-large-v3-turbo`) dengan fallback transkripsi Gemini Native Audio.
   - File Dokumen (.docx, .txt): Ekstraksi lokal via Mammoth / TextParser -> dialihkan ke Tier 1 (Dahl DeepSeek).
   - Dokumen PDF Visual & Video: Gemini Multimodal (`gemini-3.8-flash` > `gemini-2.5-flash`).

4. **Zero-Configuration Vercel Models (Hardcoded Code Fallback):**
   - Seluruh model default dikonfigurasi langsung di dalam kode (`src/env.ts`), sehingga pengguna tidak perlu mendaftarkan variabel model di dashboard Vercel / `.env`. Cukup menyuplai API key masing-masing provider.

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
   - Master PIN diproteksi hashing SHA-256 dengan per-instance cryptographically strong salt (`PIN_SALT`) dan automatic first-run random PIN provisioning jika belum dikonfigurasi.
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
