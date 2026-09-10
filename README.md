# FreeAIBot (AgentKit)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22.0.0-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-blue.svg)](https://www.typescriptlang.org/)
[![Platform](https://img.shields.io/badge/Deployment-Vercel%20Serverless-black.svg)](https://vercel.com)
[![Database](https://img.shields.io/badge/Database-Supabase%20PostgreSQL-emerald.svg)](https://supabase.com)

FreeAIBot adalah sistem asisten kecerdasan buatan berbasis TypeScript yang beroperasi multi-platform melalui antarmuka Telegram dan WhatsApp Multi-Device. Sistem ini dirancang untuk berjalan pada lingkungan lokal maupun arsitektur komputasi awan serverless (Vercel untuk Telegram) dan container 24/7 (Render/Koyeb untuk WhatsApp) secara kontinu dengan persistensi data menggunakan Supabase PostgreSQL.

Dilengkapi dengan mesin penelusuran internet real-time multi-sumber, pembaca halaman web otonom, rantai failover multi-provider, memori percakapan berkesinambungan, pengingat terjadwal, serta persistensi sesi WhatsApp cloud otomatis (zero re-scan).

---

## Arsitektur & Spesifikasi Teknis

### 1. Mesin Penelusuran Web Real-Time & Deep Web Reader
- **Matriks Pencarian Multi-Sumber:** Mengintegrasikan Google News Global RSS, Google Berita Indonesia RSS, Bing News RSS, Hacker News Algolia API, Wikipedia Full-Text Search (ID & EN), dan arXiv Preprints API secara paralel sub-detik (~570ms).
- **Deep Webpage Scraper:** Mendeteksi tautan URL atau domain publik secara otomatis, lalu mengekstrak konten halaman menjadi Fit-Markdown bersih menggunakan integrasi Jina AI Reader dan parser HTML lokal.
- **Proteksi Keamanan SSRF:** Memblokir penelusuran ke alamat lokal (`localhost`, `127.0.0.1`), subnet privat LAN (RFC 1918), dan endpoint metadata cloud provider (`169.254.169.254`).
- **Formulasi Kueri Adaptif:** Melakukan normalisasi typo/slang bahasa Indonesia dan memangkas kata pengisi (*filler words*) untuk menghasilkan kueri penelusuran dwibahasa terarah.

### 2. Rantai Failover Multi-Provider & Kontrol Latensi
- **Jalur Cadangan Otomatis:** Mengalirkan request secara berurutan: OpenRouter -> Groq -> Google Gemini -> Ollama Cloud.
- **Arsitektur Dua-Tingkat Timeout:**
  - *Connect Timeout* (8 detik): Mendeteksi kegagalan jaringan atau limit kuota (HTTP 429) secara cepat untuk memicu failover instan.
  - *Thinking Timeout* (90 detik): Memberikan batas waktu leluasa bagi model untuk melakukan inferensi mendalam dan menghasilkan keluaran kode hingga 2500 token.
- **Manajemen Kuota:** Pelacakan error dan pembatasan pemakaian per provider secara persisten di database.

### 3. Memori Berkelanjutan & Koreksi Pengguna
- **Konteks Percakapan:** Menyertakan 10 giliran pesan terakhir ke dalam prompt konteks.
- **Ringkasan Otomatis:** Menghasilkan intisari obrolan setiap 20 pesan untuk menjaga kesinambungan percakapan jangka panjang.
- **Koreksi Dinamis (`/salah`):** Menyimpan preferensi atau koreksi fakta langsung dari pengguna dan menerapkannya sebagai aturan pada respons berikutnya.

### 4. Pengingat Terjadwal (Reminders)
- Perintah `/remind <menit> <pesan>` mencatat antrean pengingat ke Supabase PostgreSQL.
- Dieksekusi otomatis menggunakan Vercel Cron (`GET /api/cron/reminders`) pada mode produksi awan atau pekerja berkala lokal.

### 5. Multimodal Vision
- Menerima dan menganalisis masukan gambar (foto atau dokumen gambar) dengan perutean otomatis ke model berkemampuan penglihatan komputer (*vision-capable*).

---

## Persyaratan Sistem

- Node.js >= 22.0.0
- Akun Telegram dan Token Bot dari [@BotFather](https://t.me/botfather)
- Basis data Supabase PostgreSQL
- Minimal satu API Key model AI (OpenRouter, Groq, Google Gemini, atau Ollama Cloud)

---

## Panduan Instalasi Lokal

1. **Klon Repositori:**
   ```bash
   git clone https://github.com/Raflyf/chat-bot.git
   cd chat-bot
   ```

2. **Pasang Dependensi:**
   ```bash
   npm install
   ```

3. **Konfigurasi Lingkungan:**
   Salin file template `.env.example` menjadi `.env`:
   ```bash
   cp .env.example .env
   ```
   Lengkapi variabel konfigurasi sesuai kredensial Anda.

4. **Migrasi Database:**
   Buka SQL Editor di dasbor Supabase Anda dan jalankan skrip:
   ```
   sql/migrate_v09_hardened.sql
   sql/migrate_v10_whatsapp_sessions.sql
   ```
   Skrip ini membuat tabel yang diperlukan (`messages`, `summaries`, `corrections`, `provider_quota`, `reminders`, `whatsapp_sessions`) sekaligus menerapkan aturan Row Level Security (RLS).

5. **Jalankan Bot:**
   - **Menjalankan Telegram Bot:**
     ```bash
     npm run dev
     ```
   - **Menjalankan WhatsApp Bot (Multi-Device QR):**
     ```bash
     npm run whatsapp
     ```
     Pindai QR Code di terminal dari menu *Perangkat Tertaut* aplikasi WhatsApp di HP Anda.
   - **Mode produksi lokal:**
     ```bash
     npm run build
     npm start
     ```

---

## Panduan Penerapan di Vercel (Produksi 24/7)

Sistem ini mendukung pengoperasian *serverless* penuh di Vercel tanpa memerlukan server lokal yang aktif terus-menerus.

### Langkah 1: Push ke Repositori GitHub
Pastikan seluruh perubahan terbaru telah berada pada branch utama:
```bash
git push origin main
```

### Langkah 2: Impor Proyek di Vercel
1. Masuk ke [Vercel Dashboard](https://vercel.com).
2. Pilih **Add New Project** dan impor repositori ini.
3. Tetapkan Framework Preset ke **Other** (Vercel membaca konfigurasi `api/` dan `vercel.json` secara otomatis).

### Langkah 3: Konfigurasi Environment Variables di Vercel
Tambahkan variabel berikut pada menu **Settings > Environment Variables**:
- `TELEGRAM_BOT_TOKEN`: Token API bot Telegram.
- `OWNER_CHAT_ID`: ID chat Telegram admin pengelola.
- `TELEGRAM_WEBHOOK_SECRET`: String acak untuk verifikasi integritas request Telegram.
- `CRON_SECRET`: String acak untuk proteksi endpoint cron pengingat.
- `SUPABASE_URL`: Endpoint REST project Supabase Anda.
- `SUPABASE_SERVICE_KEY`: Kunci privat `service_role` Supabase (diperlukan untuk operasi tabel ber-RLS).
- Kunci API LLM: `OPENROUTER_KEYS`, `GROQ_KEYS`, `GEMINI_KEYS`, atau `OLLAMA_CLOUD_KEYS`.

Klik **Deploy** dan catat domain produksi yang dihasilkan (contoh: `https://free-chatbot-ai.vercel.app`).

### Langkah 4: Daftarkan Webhook Telegram
Jalankan registrasi webhook satu kali melalui browser atau terminal:
```bash
curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook?url=https://<DOMAIN_VERCEL>/api/webhook&secret_token=<TELEGRAM_WEBHOOK_SECRET>"
```
Respons sukses:
```json
{"ok": true, "result": true, "description": "Webhook was set"}
```

---

## Variabel Lingkungan

| Variabel | Tipe | Wajib | Keterangan |
|---|---|---|---|
| `TELEGRAM_BOT_TOKEN` | String | Ya | Token autentikasi bot dari Telegram BotFather |
| `OWNER_CHAT_ID` | String | Tidak | Chat ID pemilik bot untuk penerimaan notifikasi error fatal |
| `TELEGRAM_WEBHOOK_SECRET` | String | Ya (Vercel) | Token rahasia pada header `X-Telegram-Bot-Api-Secret-Token` |
| `CRON_SECRET` | String | Ya (Vercel) | Token rahasia otorisasi endpoint cron pengingat |
| `SUPABASE_URL` | String | Ya | URL instans Supabase PostgreSQL |
| `SUPABASE_SERVICE_KEY` | String | Ya | Kunci `service_role` privat untuk akses database ber-RLS |
| `OPENROUTER_KEYS` | String (CSV) | Opsional | Kumpulan API key OpenRouter (dipisah koma) |
| `GROQ_KEYS` | String (CSV) | Opsional | Kumpulan API key Groq (dipisah koma) |
| `GEMINI_KEYS` | String (CSV) | Opsional | Kumpulan API key Google Gemini (dipisah koma) |
| `BOT_NAME` | String | Tidak | Nama identitas bot (Default: `FreeAIBot`) |
| `BOT_PROFILE` | String | Tidak | Deskripsi persona perilaku asisten |

---

## Kebijakan Keamanan & Database

- **Row Level Security (RLS):** Seluruh operasi basis data publik (`anon` dan `authenticated`) dinonaktifkan secara ketat. Seluruh manipulasi data hanya dapat dijalankan melalui kunci backend `service_role`.
- **Sanitasi Kredensial:** Fungsi sensor otomatis `redactOutput()` memfilter potensi kebocoran token bot, string `sk-`, dan kunci `sbp_` dari jawaban model sebelum dikirim ke pengguna.
- **Isolasi Masukan:** Pesan pengguna diisolasi di dalam tag struktural `<user_message>` untuk memitigasi teknik manipulasi *prompt injection*.

---

## Lisensi

Proyek ini didistribusikan di bawah lisensi resmi **MIT License**. Lihat berkas [LICENSE](LICENSE) untuk ketentuan penggunaan dan distribusi lengkap.

Hak Cipta (c) 2026 Rafly Firmansyah.
