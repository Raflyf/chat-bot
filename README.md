# FreeAiBot

Asisten AI cerdas, multimodal, dan beroperasi 24/7 di WhatsApp dan Telegram. Dibangun dengan TypeScript, Vercel Serverless, dan Supabase PostgreSQL.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Deployment-Vercel%20Serverless-black.svg)](https://free-chatbot-ai.vercel.app)
[![Telegram](https://img.shields.io/badge/Telegram-%40chatkita__bot-2CA5E0.svg)](https://t.me/chatkita_bot)
[![WhatsApp](https://img.shields.io/badge/WhatsApp-Online%2024%2F7-25D366.svg)](https://wa.me/6283874640066)

---

## Akses Cepat

- **Telegram Bot**: [@chatkita_bot](https://t.me/chatkita_bot)
- **WhatsApp Bot**: [+62 838-7464-0066](https://wa.me/6283874640066)
- **Landing Page & Panel Monitoring**: [free-chatbot-ai.vercel.app](https://free-chatbot-ai.vercel.app)

---

## Fitur Utama

- **Multimodal Lengkap**: Transkripsi Voice Note Whisper (~500ms), analisis dokumen PDF/Word, serta pemahaman foto dan stiker.
- **Rantai Failover 4 Provider**: Otomatis berganti secara cerdas antara xKiro Gateway, Groq, Google Gemini, dan OpenRouter saat limit tercapai.
- **Gaya Percakapan Alami**: Responsif, hangat, dan to-the-point tanpa format robotik yang kaku.
- **Memori Berkelanjutan**: Mengingat riwayat percakapan penting, ringkasan otomatis, dan perintah koreksi `/salah`.
- **Panel Monitoring & Dataset AI**: Dashboard pemantauan kuota API real-time serta ekspor pasangan prompt-completion ke format JSONL dan CSV untuk fine-tuning.

---

## Cara Menjalankan di Lokal

1. **Klon dan Pasang Dependensi:**
   ```bash
   git clone https://github.com/Raflyf/chat-bot.git
   cd chat-bot
   npm install
   ```

2. **Atur Variabel Lingkungan:**
   Salin berkas konfigurasi dan isi API key Anda:
   ```bash
   cp .env.example .env
   ```

3. **Jalankan Bot:**
   - Bot Telegram (Polling Lokal):
     ```bash
     npm run dev
     ```
   - Bot WhatsApp (Pindai QR Code di Terminal):
     ```bash
     npm run whatsapp
     ```
   - Build Produksi:
     ```bash
     npm run build
     ```

---

## Deployment 24/7 di Vercel

1. Hubungkan repositori GitHub ini ke dashboard **Vercel**.
2. Masukkan Environment Variables sesuai berkas `.env` Anda.
3. Daftarkan Webhook Telegram satu kali melalui peramban:
   ```text
   https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook?url=https://<DOMAIN_VERCEL>/api/webhook&secret_token=<TELEGRAM_WEBHOOK_SECRET>
   ```

---

## Lisensi

Didistribusikan di bawah lisensi resmi [MIT License](LICENSE).
Hak Cipta (c) 2026 Rafly Firmansyah.
