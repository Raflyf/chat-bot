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
| **WhatsApp Bot** | [+62 838-7464-0066](https://wa.me/6283874640066) | Dukungan resmi WhatsApp Cloud API (Obrolan Pribadi) |
| **Landing Page** | [free-chatbot-ai.vercel.app](https://free-chatbot-ai.vercel.app) | Beranda informasi produk & panduan |
| **Dashboard** | [free-chatbot-ai.vercel.app/dashboard](https://free-chatbot-ai.vercel.app/dashboard) | Monitoring & telemetri sistem |

---

## Fitur Utama

- **Multimodal Lengkap**: Memproses pesan suara (*Voice Note*), dokumen kerja (PDF, Word, TXT, CSV), gambar/foto (*Vision*), serta stiker dan video pendek.
- **Pencarian Web Real-Time**: Dilengkapi mesin pencari internet untuk menyajikan data dan berita terkini secara faktual.
- **Persona Dinamis & Baca Suasana**: Respon menyesuaikan suasana chat (canda, serius, sedih, lemas), mengikuti trajektori emosi lintas giliran, intensitas pesan, dan register bahasa lawan bicara. Tanpa kalimat template hafalan.
- **Memori & Konteks Percakapan**: Menjaga kesinambungan alur obrolan secara alami dengan penyimpanan aman di Supabase PostgreSQL.
- **Keandalan Tinggi**: Sistem failover berlapis multi-provider dengan rotasi kunci, circuit breaker, cooldown presisi, dan pemilihan rute berbasis waktu respons tercepat.
- **Zona Waktu Dinamis**: Mengenali waktu lokal secara akurat (WIB, WITA, WIT, dan waktu internasional) berdasarkan deteksi nomor atau lokasi GPS.
- **Pengingat Terjadwal**: Mendukung penjadwalan pengingat otomatis yang dikirimkan langsung ke ruang obrolan Anda.
- **Konsol Observabilitas**: Panel web terproteksi PIN untuk memantau status sistem, kesehatan koneksi, kuota per key (RPD + TPD), dan metrik penggunaan.
- **Dataset Evaluasi & Fine-Tuning**: Ekspor pasangan tanya-jawab bot dalam format JSONL/CSV untuk audit kualitas dan training ulang model.

---

## Sistem Failover Otomatis

Sistem merutekan setiap percakapan melalui rantai failover bertingkat secara mandiri. Bila pemrosesan pada satu jalur mengalami kegagalan, timeout, atau menyentuh batas kapasitas, sistem secara otomatis mengalihkan permintaan ke jalur berikutnya tanpa intervensi manual.

Algoritma pemantau latensi dan circuit breaker terus mengevaluasi kesehatan tiap rute, memprioritaskan jalur yang paling responsif, dan memastikan kelangsungan layanan percakapan tetap stabil 24/7.

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
Lengkapi token bot perpesanan, kredensial basis data Supabase, dan API key yang digunakan. Seluruh konfigurasi model dan pembatasan kuota dikelola secara fleksibel melalui variabel lingkungan tanpa perlu mengubah logika inti aplikasi.

### 3. Jalankan Aplikasi
- **Bot Telegram (Polling Lokal):**
  ```bash
  npm run dev
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
- **WhatsApp Cloud API**: Terintegrasi langsung di **Vercel Serverless** pada endpoint `/api/whatsapp`, siap menerima webhook pesan masuk Meta Cloud API untuk obrolan pribadi 24/7 tanpa membutuhkan server VPS.
- **Basis Data**: Jalankan skrip SQL pada folder `sql/` di SQL Editor Supabase secara berurutan untuk inisialisasi skema, keamanan RLS, dan pelacakan kuota token harian (wajib menjalankan `migrate_v18_daily_token_tracking.sql` agar pembatasan TPD Groq tersinkron lintas instance).

Dokumentasi arsitektur mendalam dan riwayat teknis versi dikelola secara internal dan tidak dipublikasikan di repositori ini.

---

## Lisensi

Didistribusikan di bawah lisensi resmi [MIT License](LICENSE).  
Hak Cipta (c) 2026 **Rafly Firmansyah**.
