# FreeAiBot

Asisten AI cerdas, multimodal, dan beroperasi 24/7 di WhatsApp dan Telegram. Dibangun dengan TypeScript, Vercel Serverless, dan basis data Supabase PostgreSQL.

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

1. **Multimodal Lengkap**: Mendukung transkripsi Voice Note Whisper, analisis dokumen (PDF, Word, teks, kode), serta pemahaman foto dan stiker.
2. **Memori Cerdas & Konteks**: Mengingat alur percakapan aktif (24 pesan terakhir), distilasi profil jangka panjang di Supabase, dan perintah `/reset` untuk membersihkan sesi aktif secara instan.
3. **Zona Waktu & Lokasi Dinamis**: Mengenali waktu akurat (WIB, WITA, WIT, dan waktu internasional), deteksi lokasi otomatis dari nomor telepon, serta penerimaan pin lokasi GPS.
4. **Rantai Failover Multi-Provider**: Rotasi otomatis antara xKiro, Groq, Google Gemini, dan OpenRouter agar bot tetap aktif saat terjadi limit kuota.
5. **Dashboard Monitoring & Dataset AI**: Panel observabilitas kuota API terproteksi PIN dan ekspor riwayat evaluasi ke format JSONL dan CSV untuk fine-tuning.

---

## Daftar Perintah Obrolan

| Perintah / Kata Kunci | Fungsi |
| :--- | :--- |
| `/reset` atau `reset sesi` | Membersihkan memori aktif dan mengembalikan token konteks ke baseline awal (~5.500 token). |
| `/salah <koreksi>` | Menyimpan koreksi atau preferensi penting pengguna secara permanen ke basis data. |
| `/remind <menit> <pesan>` | Menjadwalkan pengingat otomatis yang akan dikirimkan oleh bot sesuai waktu yang ditentukan. |
| *Share Pin Lokasi* | Mengirim lokasi GPS WhatsApp/Telegram agar bot mengunci nama kota dan zona waktu lokal Anda. |

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
