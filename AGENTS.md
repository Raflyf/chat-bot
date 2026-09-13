# Arsitektur Agen & Sistem Multi-Model (AGENTS.md)

Dokumen ini mendefinisikan arsitektur teknis, boundary sistem, protokol eksekusi, serta tata kelola agen dan alur data pada Chat Bot Multi-Platform v0.26.23.

---

## 1. Arsitektur Multi-Provider & Rantai Failover (LLM Engine)

Sistem menggunakan strategi inferensi multi-gateway terintegrasi dengan automatic failover dan load-balancing:

1. **Gateway Primer (xKiro API):**
   - Endpoint: `https://api.xkiro.com/v1/chat/completions`
   - Model Prioritas:
     1. `deepseek/deepseek-v4-flash` (Model teks utama / failover kecepatan tinggi)
     2. `deepseek/deepseek-chat-v3.1` (Cadangan 1 / penalaran percakapan alami)
     3. `deepseek/deepseek-v4-pro` (Cadangan 2 / penalaran mendalam)
     4. `deepseek/deepseek-v3.2` (Cadangan 3)
   - Multi-Key Rotation: Menggunakan pool API keys dengan rotasi otomatis saat limit tercapai.

2. **Rantai Failover Lintas Provider (Sequential Provider Failover):**
   - **Tingkat 1 (Gateway Utama):** xKiro (`deepseek/deepseek-v4-flash` + 3 model cadangan di atas).
   - **Tingkat 2 (Groq):** Primary: `qwen/qwen3.8-27b`, Cadangan: `qwen/qwen3.6-27b`.
   - **Tingkat 3 (Cloudflare Workers AI):** Primary: `@cf/meta/llama-3.1-70b-instruct` (Llama 3.1 70B), Cadangan: `@cf/qwen/qwen2.5-coder-32b-instruct` (Qwen 2.5 Coder 32B). Multi-account pool rotation dengan auto-resolution account ID.
   - **Tingkat 4 (Gemini API):** Primary: `gemini-3.8-flash`, Cadangan: `gemini-2.5-flash` (termasuk native vision engine).
   - **Tingkat 5 (OpenRouter):** Failover akhir jika seluruh provider sebelumnya mengalami gangguan.
   - **Direct OpenCode Zen API:** Cadangan darurat otonom (`muse-spark-1.3-contributor-free`).

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
