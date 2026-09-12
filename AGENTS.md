# Arsitektur Agen & Sistem Multi-Model (AGENTS.md)

Dokumen ini mendefinisikan arsitektur teknis, boundary sistem, protokol eksekusi, serta tata kelola agen dan alur data pada Chat Bot Multi-Platform v0.26.4.

---

## 1. Arsitektur Multi-Provider & Rantai Failover (LLM Engine)

Sistem menggunakan strategi inferensi multi-gateway terintegrasi dengan automatic failover dan load-balancing:

1. **Gateway Primer (xKiro API):**
   - Endpoint: `https://api.xkiro.com/v1/chat/completions`
   - Model Prioritas:
     1. `qwen/qwen3.8-max:free` (Model teks utama)
     2. `deepseek/deepseek-v4-flash` (Failover kecepatan tinggi)
     3. `qwen/qwen3.6-plus:free` (Model penalaran sekunder)
     4. `mistralai/mistral-large-2512` (Model cadangan ketiga)
     5. `deepseek/deepseek-v4-pro` (Model cadangan akhir)
   - Multi-Key Rotation: Menggunakan pool API keys dengan rotasi otomatis saat limit tercapai.

2. **Gateway Sekunder & Model Mandiri:**
   - **Groq:** LLaMA-3.3-70B Versatile, LLaMA-3.2-11B-Vision-Preview (Vision / Multimodal engine cepat).
   - **Gemini API:** Google Gemini 2.5 Flash / Gemini 2.0 Flash untuk inferensi multimodal sekunder.
   - **OpenRouter / Mistral / DeepSeek Direct:** Cadangan independen jika gateway primer mengalami latensi tinggi atau downtime.
   - **Direct OpenCode Zen API:** Fallback darurat akhir (`muse-spark-1.3-contributor-free`).

---

## 2. Saluran Komunikasi & Webhook Pipeline

Bot beroperasi secara paralel pada tiga platform perpesanan utama:

1. **Telegram Bot API:**
   - Polling engine via `node-telegram-bot-api` dengan auto-reconnect backoff.
   - Endpoint webhook didukung untuk deployment serverless Vercel.
   - Penanganan media suara/audio otomatis via Groq Whisper API.
   - Dedup pesan atomik berbasis ID pesan Telegram dan upsert state media.

2. **WhatsApp Cloud API (Meta Official):**
   - Handler webhook HTTP standar industri via endpoint `/api/webhook/whatsapp`.
   - Validasi signature payload SHA-256 (`x-hub-signature-256`) dengan timing-safe comparison dan raw-body stream buffer.
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
   - Content Security Policy (CSP) ketat tanpa `unsafe-eval` dan tanpa `unsafe-inline` pada `script-src` (seluruh skrip antarmuka dan dashboard diekstraksi ke berkas terisolasi `/js/*.js`, dengan `base-uri 'self'`, `object-src 'none'`, `frame-ancestors 'none'`).
   - HSTS seragam 2 tahun (`Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`) di `vercel.json` dan seluruh endpoint `api/`.
   - X-Frame-Options: `DENY`, X-Content-Type-Options: `nosniff`, Referrer-Policy: `strict-origin-when-cross-origin`.

---

## 4. Sistem Dedup Atomik & Concurrency Control

1. **Atomic Message Claiming (`claimIncomingMessage`):**
   - Menggunakan pattern *insert-first* ke tabel `messages` dengan mengandalkan PostgreSQL unique index `idx_messages_platform_msg_id`.
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
   - In-memory Conversation Context Cache di `src/memory.ts` dengan rolling TTL 25 detik dan 24 pesan terakhir untuk respons instan 0-5ms tanpa round-trip DB berulang.
   - In-memory Knowledge Web Cache di `src/knowledge.ts` berkapasitas 300 entri dengan FIFO pruning 50 entri tertua saat batas tercapai.

2. **Autonomous Dynamic Timezone Awareness:**
   - Pengenalan konteks waktu dinamis berbasis deteksi domisili/kota pengguna (~100 entri pemetaan kata kunci wilayah/kota terkurasi) tanpa memaksa zona waktu statis tunggal.
