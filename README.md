# FreeAIBot

Asisten AI multimodal yang beroperasi 24/7 di WhatsApp dan Telegram. Dibangun dengan TypeScript, Vercel Serverless, dan Supabase PostgreSQL.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-blue.svg?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20.x%20%7C%2022.x-green.svg?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Platform](https://img.shields.io/badge/Deployment-Vercel%20Serverless-black.svg?logo=vercel&logoColor=white)](https://free-chatbot-ai.vercel.app)
[![Database](https://img.shields.io/badge/Database-Supabase%20PostgreSQL-3ECF8E.svg?logo=supabase&logoColor=white)](https://supabase.com)
[![Telegram](https://img.shields.io/badge/Telegram-%40chatkita__bot-2CA5E0.svg?logo=telegram&logoColor=white)](https://t.me/chatkita_bot)
[![WhatsApp](https://img.shields.io/badge/WhatsApp-Online%2024%2F7-25D366.svg?logo=whatsapp&logoColor=white)](https://wa.me/6283874640066)

---

## Akses Cepat

| Layanan | Tautan / Kontak | Keterangan |
| :--- | :--- | :--- |
| **Telegram Bot** | [@chatkita_bot](https://t.me/chatkita_bot) | Siap digunakan 24/7 |
| **WhatsApp Bot** | [+62 838-7464-0066](https://wa.me/6283874640066) | Dukungan WhatsApp Cloud API & Multi-Device |
| **Landing Page** | [free-chatbot-ai.vercel.app](https://free-chatbot-ai.vercel.app) | Beranda informasi produk & panduan |
| **Dashboard** | [free-chatbot-ai.vercel.app/dashboard](https://free-chatbot-ai.vercel.app/dashboard) | Monitoring & telemetri sistem |

---

## Fitur Utama

- **Multimodal Lengkap**: Memproses pesan suara (*Voice Note* via Whisper), dokumen kerja (PDF, Word, TXT, CSV), gambar/foto (*Vision*), serta stiker dan video pendek.
- **Pencarian Web Real-Time**: Dilengkapi mesin pencari internet untuk menyajikan data dan berita terkini secara faktual.
- **Persona Dinamis & Baca Suasana**: Respon menyesuaikan suasana chat (canda, serius, sedih, lemas), mengikuti trajektori emosi lintas giliran, intensitas pesan, dan register bahasa lawan bicara. Tanpa kalimat template hafalan.
- **Memori & Konteks Percakapan**: Menjaga kesinambungan alur obrolan secara alami dengan penyimpanan aman di Supabase PostgreSQL.
- **Keandalan Tinggi**: Sistem failover berlapis antar provider dengan rotasi kunci, circuit breaker, cooldown presisi, dan failover berbasis waktu respons antar model dalam satu tier.
- **Zona Waktu Dinamis**: Mengenali waktu lokal secara akurat (WIB, WITA, WIT, dan waktu internasional) berdasarkan deteksi nomor atau lokasi GPS.
- **Pengingat Terjadwal**: Mendukung penjadwalan pengingat otomatis yang dikirimkan langsung ke ruang obrolan Anda.
- **Konsol Observabilitas**: Panel web terproteksi PIN untuk memantau status sistem, kesehatan koneksi, kuota per key (RPD + TPD), dan metrik penggunaan.
- **Dataset Evaluasi & Fine-Tuning**: Ekspor pasangan tanya-jawab bot dalam format JSONL/CSV untuk audit kualitas dan training ulang model.

---

## Arsitektur Provider (Failover 6 Tier)

Sistem merutekan setiap percakapan melalui enam tingkat provider dengan failover otomatis. Bila seluruh model dalam satu tier gagal, timeout, atau menyentuh batas kuota, rantai berpindah ke tier berikutnya tanpa intervensi manual.

| Tier | Provider | Peran Utama |
| :--- | :--- | :--- |
| 1 | xKiro Gateway | Jalur utama teks; model vision tersedia sebagai cadangan rantai multimodal |
| 2 | OpenRouter | Jalur teks & parser dokumen PDF |
| 3 | Groq Cloud | Inferensi LPU ultra-cepat, transkripsi suara, & vision terdepan |
| 4 | Cloudflare Workers AI | Teks, vision, & transkripsi cadangan |
| 5 | Google Gemini | Konteks 1M, vision, dokumen PDF, video & audio native |
| 6 | Dahl Global | Pool token besar sebagai jaring pengaman akhir |

Di dalam setiap tier, model yang rata-rata merespons lambat diturunkan prioritasnya secara otomatis, sehingga request berikutnya mencoba model cadangan yang lebih gesit terlebih dahulu.

---

## Perintah Obrolan

| Perintah / Aksi | Fungsi & Penjelasan |
| :--- | :--- |
| `/reset` | Membersihkan memori aktif dan memulai sesi obrolan baru dari awal. |
| `/salah <catatan>` | Menyimpan koreksi atau preferensi khusus Anda ke basis data permanen. |
| `/remind <menit> <pesan>` | Menjadwalkan pengingat otomatis yang akan dikirimkan oleh bot sesuai waktu yang diminta. |
| *Kirim Dokumen (PDF/DOCX)* | Membaca isi berkas, merangkum dokumen, atau menganalisis data dan kode pemrograman. |
| *Kirim Gambar / Foto* | Menjelaskan isi gambar, membaca teks dokumen fisik (OCR), atau menganalisis objek. |
| *Kirim Pesan Suara (VN)* | Mentranskripsi rekaman suara ke teks dan langsung menjawab intinya. |
| *Kirim Pin Lokasi GPS* | Menyesuaikan zona waktu lokal dan konteks kota domisili Anda secara otomatis. |

---

## Menjalankan Secara Lokal

### 1. Klon Repositori & Pasang Dependensi
```bash
git clone https://github.com/Raflyf/chat-bot.git
cd chat-bot
npm install
```

### 2. Konfigurasi Variabel Lingkungan
Salin template konfigurasi `.env.example` ke `.env`:
```bash
cp .env.example .env
```
Lengkapi token bot perpesanan, kredensial basis data Supabase, dan API key provider yang digunakan. Seluruh nama model dikelola langsung di dalam kode (`src/env.ts`), sehingga cukup menyuplai API key tanpa konfigurasi model tambahan.

Catatan kuota penting:
- `DAILY_CAP_GROQ=1000` dan `DAILY_TOKEN_CAP_GROQ=200000` mengikuti Free Tier resmi Groq (1.000 RPD + 200K TPD per key). TPD biasanya tercapai lebih dulu, jadi keduanya dibatasi runtime.
- `DAILY_CAP_GEMINI=1500` mengikuti Free Tier resmi Google AI Studio.

### 3. Jalankan Aplikasi
- **Bot Telegram (Polling Lokal):**
  ```bash
  npm run dev
  ```
- **Bot WhatsApp (Multi-Device Pindai QR di Terminal):**
  ```bash
  npm run whatsapp
  ```
- **Validasi Kode TypeScript:**
  ```bash
  npm run typecheck
  ```
- **Kompilasi Bundle:**
  ```bash
  npm run build
  ```

---

## Penerapan Produksi (Deployment)

- **Telegram & Dashboard**: Hubungkan repositori ke **Vercel**, masukkan Environment Variables, dan daftarkan webhook Telegram ke endpoint `/api/webhook`.
- **WhatsApp 24/7 Mandiri**: Jalankan perintah `npm run whatsapp` pada cloud container (seperti Render, Koyeb, atau VPS). Sesi login otomatis tersimpan di Supabase sehingga tidak perlu pindai ulang saat restart.
- **Basis Data**: Jalankan skrip SQL pada folder `sql/` di SQL Editor Supabase secara berurutan untuk inisialisasi skema, keamanan RLS, dan pelacakan kuota token harian (wajib menjalankan `migrate_v18_daily_token_tracking.sql` agar pembatasan TPD Groq tersinkron lintas instance).

Dokumentasi arsitektur mendalam dan riwayat teknis versi dapat dilihat di [DOCUMENTATION.md](DOCUMENTATION.md).

---

## Lisensi

Didistribusikan di bawah lisensi resmi [MIT License](LICENSE).  
Hak Cipta (c) 2026 **Rafly Firmansyah**.
