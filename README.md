# FreeAIBot (AgentKit)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22.0.0-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-blue.svg)](https://www.typescriptlang.org/)
[![Platform](https://img.shields.io/badge/Deployment-Vercel%20Serverless-black.svg)](https://vercel.com)
[![Database](https://img.shields.io/badge/Database-Supabase%20PostgreSQL-emerald.svg)](https://supabase.com)
[![WhatsApp](https://img.shields.io/badge/WhatsApp-Cloud%20API%20%26%20Baileys-25D366.svg)](https://developers.facebook.com/)
[![Telegram](https://img.shields.io/badge/Telegram-Bot%20API-2CA5E0.svg)](https://t.me/)

FreeAIBot adalah sistem agen kecerdasan buatan berbasis TypeScript yang beroperasi multi-platform melalui WhatsApp Cloud API, WhatsApp Baileys Multi-Device, dan Telegram Bot API. Sistem ini dirancang untuk beroperasi secara kontinu 24 jam nonstop pada arsitektur komputasi awan serverless (Vercel) dengan persistensi data menggunakan Supabase PostgreSQL.

Dilengkapi dengan mesin pemahaman situasi percakapan (Read the Room), persona sahabat karib serbabisa (Universal Polymath Companion), penelusuran internet real-time multi-sumber, pembaca web otonom, rantai failover multi-provider, memori percakapan berkesinambungan, dan sanitasi output pesan WhatsApp yang bersih.

---

## Arsitektur & Fitur Utama

### 1. Persona Sahabat Karib & Intelegensi Situasional (Read the Room)
- **Universal Polymath Companion:** Berinteraksi selayaknya manusia sungguhan yang hangat, punya akal sehat, dan berwawasan luas tanpa sekat kaku antarmuka bot.
- **Proporsionalitas Percakapan:** Obrolan santai, curhat, sapaan, atau keluh kesah harian dibalas secara ringkas dan hangat (1-3 kalimat). Menghilangkan ceramah panjang, teori psikologi, atau checklist SOP yang tidak diminta.
- **Interaksi Humor Dua Arah:** Lelucon dan tebak-tebakan disajikan secara interaktif melalui pembagian giliran (setup pertanyaan dilempar terlebih dahulu sebelum jawaban).
- **Keahlian Teknis & Sains:** Beralih menjadi rekan ahli yang tajam, presisi, dan langsung menyajikan kode yang bersih, aman, type-safe, serta siap jalan tanpa basa-basi pengantar.
- **Zero Prompt Pollution:** Membuang pembungkus tag XML buatan. Memori ringkasan, koreksi pengguna, dan fakta internet dimasukkan langsung ke instruksi sistem latar belakang.

### 2. Integrasi Multi-Platform
- **WhatsApp Cloud API (Resmi Meta):** Berjalan secara serverless di endpoint `POST /api/whatsapp` pada Vercel, online 24 jam nonstop tanpa memerlukan laptop menyala atau server lokal.
- **WhatsApp Baileys Multi-Device:** Mendukung login sesi QR mandiri dengan persistensi kredensial otomatis ke Supabase PostgreSQL (`whatsapp_sessions`).
- **Telegram Bot API:** Berjalan melalui webhook serverless di `POST /api/webhook` dengan verifikasi header `X-Telegram-Bot-Api-Secret-Token`.

### 3. Mesin Penelusuran Web Real-Time & Deep Web Reader
- **Matriks Pencarian Paralel:** Mengintegrasikan Google News RSS, Google Berita Indonesia RSS, Bing News RSS, Hacker News Algolia API, Wikipedia Search, dan arXiv API secara bersamaan (~570ms).
- **Deep Webpage Scraper:** Mendeteksi tautan URL publik pada obrolan dan mengekstrak konten teks bersih via parser HTML mandiri dan Jina AI Reader.
- **Proteksi SSRF:** Memblokir akses ke alamat lokal (`localhost`, `127.0.0.1`), subnet privat LAN (RFC 1918), dan endpoint metadata cloud provider (`169.254.169.254`).

### 4. Rantai Failover Multi-Provider & Kontrol Latensi
- **Perutean Cerdas:** Mengalirkan request secara berurutan: Groq (kecepatan tinggi) -> Google Gemini (multimodal) -> OpenRouter -> Ollama Cloud.
- **Dua Tingkat Timeout:**
  - *Connect Timeout* (8 detik): Deteksi kegagalan jaringan atau limit kuota (HTTP 429) untuk failover cepat.
  - *Thinking Timeout* (90 detik): Alokasi waktu berpikir bagi model untuk menyelesaikan penalaran dan koding lengkap hingga 2500 token.
- **Dinamika Temperatur:** Ditetapkan pada `0.7` untuk keluwesan bahasa manusiawi tanpa mengorbankan akurasi faktual.

### 5. Memori Berkelanjutan & Koreksi Pengguna
- **Konteks Percakapan:** Menyertakan 10 giliran pesan terakhir dengan penggabungan riwayat multi-turn Gemini yang mulus.
- **Ringkasan Otomatis:** Merangkum fakta penting obrolan setiap 20 pertukaran pesan ke tabel `summaries`.
- **Koreksi Dinamis (`/salah`):** Menyimpan preferensi atau koreksi pengguna ke tabel `corrections` sebagai aturan yang dipatuhi pada giliran berikutnya.

### 6. Sanitasi Output & Kepatuhan Format
- **Zero Emoji Mutlak:** Seluruh emotikon dan simbol grafis dekoratif difilter otomatis dari respon model.
- **Format Bersih WhatsApp:** Mengonversi heading markdown (`#`, `##`, `###`) menjadi format tebal WhatsApp (`*Judul*`), merapikan poin daftar (`-`), menormalkan ekspresi matematika LaTeX menjadi simbol Unicode, serta membersihkan asteris tanpa pasangan.

---

## Persyaratan Sistem

- Node.js >= 22.0.0
- Akun Meta for Developers (untuk WhatsApp Cloud API) atau Akun Telegram ([@BotFather](https://t.me/botfather))
- Basis data Supabase PostgreSQL
- Minimal satu API Key model AI (Groq, Google Gemini, OpenRouter, atau Ollama Cloud)

---

## Variabel Lingkungan

| Variabel | Wajib | Keterangan |
|---|---|---|
| `WHATSAPP_TOKEN` | Ya (WhatsApp Cloud) | Permanent System User Token dari Meta Business Suite |
| `WHATSAPP_PHONE_NUMBER_ID` | Ya (WhatsApp Cloud) | Phone Number ID dari dasbor WhatsApp API Setup |
| `WHATSAPP_VERIFY_TOKEN` | Ya (WhatsApp Cloud) | String token verifikasi webhook WhatsApp |
| `TELEGRAM_BOT_TOKEN` | Ya (Telegram) | Token autentikasi bot dari Telegram BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | Ya (Telegram) | Token verifikasi header `X-Telegram-Bot-Api-Secret-Token` |
| `OWNER_CHAT_ID` | Tidak | ID chat admin pemilik untuk penerimaan peringatan error fatal |
| `CRON_SECRET` | Ya (Vercel) | Kunci otorisasi pengingat terjadwal via cron |
| `SUPABASE_URL` | Ya | URL REST proyek Supabase PostgreSQL |
| `SUPABASE_SERVICE_KEY` | Ya | Kunci `service_role` privat Supabase untuk akses tabel ber-RLS |
| `GROQ_KEYS` | Opsional | Kumpulan API key Groq (dipisah koma) |
| `GEMINI_KEYS` | Opsional | Kumpulan API key Google Gemini (dipisah koma) |
| `OPENROUTER_KEYS` | Opsional | Kumpulan API key OpenRouter (dipisah koma) |
| `BOT_NAME` | Tidak | Nama panggilan bot (Default: `FreeAIBot`) |
| `BOT_PROFILE` | Tidak | Deskripsi persona perilaku asisten |

---

## Panduan Penerapan di Vercel (Produksi 24/7)

### 1. Hubungkan Repositori ke Vercel
1. Masuk ke [Vercel Dashboard](https://vercel.com).
2. Tambahkan proyek baru dari repositori ini.
3. Isi seluruh Variabel Lingkungan pada menu **Settings > Environment Variables**.
4. Lakukan Deployment dan catat domain produksi Anda (contoh: `https://free-chatbot-ai.vercel.app`).

### 2. Konfigurasi Webhook WhatsApp Cloud API
1. Buka [Meta for Developers](https://developers.facebook.com/) > Aplikasi Anda > **WhatsApp > Configuration**.
2. Klik **Edit** pada bagian Webhook:
   - **Callback URL:** `https://<DOMAIN_VERCEL>/api/whatsapp`
   - **Verify Token:** Masukkan nilai string yang sama dengan `WHATSAPP_VERIFY_TOKEN` di Vercel.
3. Klik **Verify and Save**.
4. Pada bagian **Webhook fields**, klik **Manage** dan centang **messages** (Subscribe).

### 3. Konfigurasi Webhook Telegram
Jalankan perintah registrasi webhook satu kali via browser atau cURL:
```bash
curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook?url=https://<DOMAIN_VERCEL>/api/webhook&secret_token=<TELEGRAM_WEBHOOK_SECRET>"
```

---

## Menjalankan Secara Lokal

1. **Klon dan Pasang Dependensi:**
   ```bash
   git clone https://github.com/Raflyf/chat-bot.git
   cd chat-bot
   npm install
   ```

2. **Salin Konfigurasi:**
   ```bash
   cp .env.example .env
   ```

3. **Migrasi Database:**
   Jalankan seluruh skrip SQL pada folder `sql/` di SQL Editor Supabase untuk membuat tabel `messages`, `summaries`, `corrections`, `reminders`, `whatsapp_sessions`, dan mengaktifkan RLS.

4. **Jalankan Bot:**
   - Bot Telegram (Long Polling Lokal):
     ```bash
     npm run dev
     ```
   - Bot WhatsApp Baileys (Pindai QR Code di Terminal):
     ```bash
     npm run whatsapp
     ```
   - Verifikasi Tipe Data dan Build:
     ```bash
     npm run typecheck
     npm run build
     ```

---

## Kebijakan Keamanan

- **Row Level Security (RLS):** Akses publik (`anon`) dinonaktifkan secara ketat pada Supabase. Seluruh operasi penulisan dan pembacaan pesan hanya dapat dilakukan melalui backend terotorisasi menggunakan `service_role`.
- **Sensor Kredensial:** Fungsi `redactOutput()` menyaring kunci API (`sk-`, `sbp_`) dan token bot dari respon sebelum terkirim ke pengguna.
- **Perlindungan Data Lokal:** Variabel rahasia dan sesi autentikasi WhatsApp disimpan secara terenkripsi dan terisolasi dari pelacakan Git (`.gitignore`).

---

## Lisensi

Didistribusikan di bawah lisensi resmi **MIT License**. Lihat berkas [LICENSE](LICENSE) untuk informasi lebih lanjut.

Hak Cipta (c) 2026 Rafly Firmansyah.
