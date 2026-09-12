# FreeAiBot

Asisten AI cerdas, multimodal, dan beroperasi 24/7 di WhatsApp dan Telegram. Dibangun dengan TypeScript murni, arsitektur Vercel Serverless, dan basis data Supabase PostgreSQL.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Deployment-Vercel%20Serverless-black.svg)](https://free-chatbot-ai.vercel.app)
[![Telegram](https://img.shields.io/badge/Telegram-%40chatkita__bot-2CA5E0.svg)](https://t.me/chatkita_bot)
[![WhatsApp](https://img.shields.io/badge/WhatsApp-Online%2024%2F7-25D366.svg)](https://wa.me/6283874640066)

---

## Akses Cepat

- **Telegram Bot**: [@chatkita_bot](https://t.me/chatkita_bot)
- **WhatsApp Bot**: [+62 838-7464-0066](https://wa.me/6283874640066)
- **Landing Page Publik**: [free-chatbot-ai.vercel.app](https://free-chatbot-ai.vercel.app)
- **Panel Observabilitas & Dataset**: [free-chatbot-ai.vercel.app/dashboard](https://free-chatbot-ai.vercel.app/dashboard)

---

## Fitur Utama

### 1. Kapabilitas Multimodal
- **Voice Note Whisper (~500ms)**: Transkripsi audio otomatis sub-detik menggunakan Groq Whisper (`whisper-large-v3-turbo`) dengan pemahaman dialek lokal dan Bahasa Indonesia.
- **Analisis Dokumen Komprehensif**: Pembacaan native dokumen PDF via Google Gemini Multimodal, ekstraksi file Microsoft Word (`.docx`), serta analisis berkas data dan kode sumber (`.txt`, `.csv`, `.json`, `.ts`, `.py`, dll) hingga 32.000 karakter.
- **Vision & Stiker WhatsApp/Telegram**: Pemahaman ekspresi visual, foto, dan stiker secara proporsional dalam balasan santai satu kalimat tanpa halusinasi narasi fiktif.
- **Video Multimodal**: Pemahaman konteks video berbasis catatan teks (*caption*).

### 2. Memori Cerdas & Manajemen Konteks
- **Sliding Window Optimal (24 Pesan Teks + 8 Pesan Vision)**: Mempertahankan riwayat obrolan aktif 12 putaran tanya-jawab bolak-balik dengan retensi konteks seimbang (~8.000 – 9.800 token) untuk menjaga waktu respon tetap sub-detik (< 2 detik).
- **Distilasi Memori Jangka Panjang**: Rangkuman profil lawan bicara (nama, preferensi, topik utama) otomatis didistilasi setiap 8 pesan ke tabel `summaries` Supabase dengan proteksi *anti-noise* (tidak mengungkit masa lalu jika tidak relevan).
- **Perintah Reset Sesi Non-Destruktif (`/reset`)**: Mengosongkan memori aktif secara instan tanpa menghapus rekaman riwayat database untuk dataset evaluasi.

### 3. Mesin Jam & Lokasi Presisi Global
- **Pemetaan 514 Kabupaten/Kota Indonesia**: Mengenali zona waktu otomatis seluruh kabupaten dan kota di Indonesia (WIB, WITA, WIT).
- **Pendeteksi Negara Asal Nomor Telepon**: Memetakan kode panggilan internasional (E.164) untuk menyajikan waktu lokal negara pengguna secara otomatis.
- **Pin Lokasi Asli (GPS)**: Membaca koordinat *Share Location* WhatsApp dan Telegram, mengidentifikasi zona waktu, serta mengunci kota pengguna secara persisten.

### 4. Ketahanan Infrastruktur (Multi-Provider Failover)
- Rantai failover cerdas dengan rotasi otomatis:
  1. **Tier 1 (Utama)**: xKiro Gateway (`qwen/qwen3.8-max:free`, `mistralai/mistral-medium-3.5`, `deepseek/deepseek-v4-flash`, `mistralai/mistral-large-2512`, `sensenova/sensenova-6.8-flash-lite`).
  2. **Tier 2**: Groq API (`qwen/qwen3.8-27b`, `qwen/qwen3.6-27b`).
  3. **Tier 3**: Google Gemini API (`gemini-2.5-flash`).
  4. **Tier 4**: OpenRouter API (`nex-agi/nex-n2.5:free`).
- **Pengetahuan Terdistribusi (Web Knowledge Cache)**: Hasil penelusuran web disimpan ke database Supabase dengan sistem kedaluwarsa dinamis (TTL 2 jam untuk cuaca/kurs hingga 21 hari untuk rilis gadget) guna memangkas latensi pencarian berulang.

### 5. Panel Observabilitas & Engine Dataset
- Dashboard bertema dark-mode yang dilindungi Master PIN kriptografis (SHA-256 + salt) dan pemulihan lupa PIN via email OTP Resend.
- Monitoring konsumsi kuota harian seluruh API Key secara individual dengan visualisasi status kesehatan.
- Penelusuran riwayat chat dan ekspor instan dataset evaluasi fine-tuning ke format JSONL (standar OpenAI/ShareGPT) dan format spreadsheet CSV.

---

## Daftar Perintah Obrolan

| Perintah / Kata Kunci | Fungsi |
| :--- | :--- |
| `/reset` atau `reset sesi` | Membersihkan memori aktif dan mengembalikan token konteks ke baseline awal (~5.500 token). |
| `/salah <koreksi>` | Menyimpan koreksi atau preferensi penting pengguna secara permanen ke basis data. |
| `/remind <menit> <pesan>` | Menjadwalkan pengingat otomatis yang akan dikirimkan oleh bot sesuai waktu yang ditentukan. |
| *Share Pin Lokasi* | Mengirim lokasi GPS WhatsApp/Telegram agar bot mengunci nama kota dan zona waktu lokal Anda. |

---

## Arsitektur Basis Data (Supabase)

Tabel basis data dilindungi kebijakan ketat *Row Level Security (RLS)* dan hanya dapat diakses melalui kredensial `service_role`:

* `messages`: Log percakapan lengkap (platform, chat_id, role, content, token usage).
* `summaries`: Ringkasan profil dan konteks pengguna jangka panjang.
* `corrections`: Catatan koreksi, preferensi, dan lokasi kota pengguna.
* `provider_quota`: Pelacak kuota token harian per API key.
* `whatsapp_sessions`: Penyimpanan file sesi kredensial Baileys terenkripsi di cloud.
* `web_knowledge`: Cache permanen hasil penelusuran internet dengan TTL berjenjang.
* `reminders`: Penjadwalan pengingat cron.

---

## Panduan Menjalankan Lokal

### 1. Klon dan Pasang Dependensi
```bash
git clone https://github.com/Raflyf/chat-bot.git
cd chat-bot
npm install
```

### 2. Konfigurasi Lingkungan
Salin berkas template dan lengkapi API key Anda:
```bash
cp .env.example .env
```

### 3. Eksekusi Script
* **Bot Telegram (Polling Lokal):**
  ```bash
  npm run dev
  ```
* **Bot WhatsApp (Baileys Multi-Device - Pindai QR Terminal):**
  ```bash
  npm run whatsapp
  ```
* **Validasi Build Kompilasi TypeScript:**
  ```bash
  npm run build
  ```

---

## Panduan Deployment Serverless 24/7 (Vercel)

1. Impor repositori ini ke dashboard **Vercel**.
2. Masukkan Environment Variables sesuai konfigurasi pada `.env`.
3. Daftarkan Webhook Telegram satu kali:
   ```text
   https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook?url=https://<DOMAIN_VERCEL>/api/webhook&secret_token=<TELEGRAM_WEBHOOK_SECRET>
   ```
4. Untuk WhatsApp 24 Jam Mandiri: Jalankan `npm run whatsapp` di container cloud gratis (seperti Render.com atau Koyeb). Sesi login otomatis tersimpan di Supabase sehingga tidak perlu scan ulang saat restart.

---

## Lisensi

Didistribusikan di bawah lisensi resmi [MIT License](LICENSE).  
Hak Cipta (c) 2026 Rafly Firmansyah.
