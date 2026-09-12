# DOKUMENTASI SISTEM - FreeAIBot / AgentKit
**Versi:** v0.25.15  
**Status Lingkungan:** Produksi Aktif 24/7 (Vercel Serverless untuk Telegram & Dashboard + Baileys Multi-Device 24/7 untuk WhatsApp + Supabase PostgreSQL)  
**Terakhir Diperbarui:** 2026-09-12 02:48 WIB  

---

## 1. Arsitektur Multi-Platform (Telegram & WhatsApp)

Sistem dirancang dengan fleksibilitas tinggi menggunakan prinsip *Single Unified Brain, Multi-Channel Execution*:
1. **Telegram Bot (Vercel Serverless 24/7)**:
   - Webhook endpoint (`POST /api/webhook`) berjalan di Vercel Serverless gratis selamanya.
   - Dilindungi verifikasi `X-Telegram-Bot-Api-Secret-Token` menggunakan algoritma *constant-time* `crypto.timingSafeEqual`.
   - Vercel Cron (`GET /api/cron/reminders`) mengeksekusi pengingat terjadwal langsung dari database.
2. **WhatsApp Bot (Baileys Multi-Device 24/7 Unlimited)**:
   - Berjalan sebagai client WhatsApp Multi-Device resmi via `@whiskeysockets/baileys` (`src/whatsapp_baileys.ts`).
   - **Supabase Cloud Session Persistence (`src/whatsapp_session.ts`)**: File sesi otentikasi disinkronkan otomatis ke tabel Supabase `whatsapp_sessions` dengan proteksi Row Level Security (RLS). Pengguna hanya perlu scan QR Code satu kali; bot langsung login otomatis saat container cloud gratis (seperti Render.com atau Koyeb) melakukan restart berkala.
   - Bebas batas kuota 1.000 pesan ($0 gratis selamanya).
   - Mendukung chat teks dengan *safe paragraph chunking* (> 4000 karakter) dan analisis gambar multimodal via Gemini Vision.
3. **Unified Monitoring & Dataset Console (Vercel Serverless + Obsidian Web UI)**:
   - Dashboard observabilitas real-time di `/` dan `/dashboard` untuk memantau status kesehatan 12 API key, konsumsi kuota harian, metrik platform, dan model AI terpopuler.
   - **Otentikasi Kriptografis Master PIN**: Dilindungi oleh PIN default (`080402`), hashing SHA-256 + salt statis (`rafly_telemetry_salt`), komparasi timing-safe, token sesi acak (`adm_<hex32>`), serta sistem penguncian anti-brute force (5x salah = lockout 1 menit).
   - **Pemulihan Lupa PIN via Resend Email OTP**: Kode OTP 6-digit acak dikirim ke email admin (`raflyfirmansyah02@gmail.com`) dengan validasi kedaluwarsa 10 menit dan pembatasan rate limiter 60 detik.
   - **Dataset Engine Evaluasi & Fine-Tuning**: Endpoint `GET /api/dataset` memasangkan setiap pesan pengguna dengan balasan bot, mendukung ekspor instan JSONL (format fine-tuning OpenAI/ShareGPT) dan format CSV.

---

## 2. Panduan Operasional & Deployment 24 Jam Gratis

### A. Persiapan Basis Data (Supabase)
Sebelum menjalankan WhatsApp bot untuk pertama kali, jalankan skrip migrasi [sql/migrate_v10_whatsapp_sessions.sql](file:///d:/code/project/projek_no_name/sql/migrate_v10_whatsapp_sessions.sql) di **Supabase SQL Editor**:
1. Buka dashboard Supabase proyek Anda -> menu **SQL Editor**.
2. Salin isi berkas `sql/migrate_v10_whatsapp_sessions.sql` lalu klik **Run**.
3. Tabel `whatsapp_sessions` siap mengamankan sesi Baileys dengan proteksi Row Level Security (RLS).

### B. Menjalankan Bot di Komputer / Laptop Lokal
1. Pastikan dependensi terpasang: `npm install`.
2. Jalankan perintah:
   ```bash
   npm run whatsapp
   ```
3. Terminal akan memunculkan **QR Code**.
4. Buka aplikasi WhatsApp di HP (nomor khusus bot Anda) -> ketuk **Titik Tiga / Pengaturan** -> **Perangkat Tertaut** -> **Tautkan Perangkat** -> pindai QR Code di layar.
5. Bot WhatsApp langsung aktif dan membalas pesan.

### C. Menjalankan WhatsApp 24 Jam Nonstop di Vercel (Meta Cloud API - Tanpa Server Tambahan)
Ini adalah metode paling ringkas karena WhatsApp langsung berjalan di Vercel yang sudah ada, tanpa server eksternal, tanpa laptop menyala, dan tanpa kartu kredit:
1. Masuk ke [developers.facebook.com](https://developers.facebook.com) dan login dengan akun Facebook Anda.
2. Buat App baru: pilih tipe **Other** -> pilih **Business** -> beri nama (misal `FreeAIBot WhatsApp`).
3. Pada dashboard aplikasi, tambahkan produk **WhatsApp** -> klik **Set up**.
4. Di menu **WhatsApp > API Setup**:
   - Salin **Temporary access token** (atau buat Permanent Token di System Users).
   - Salin **Phone number ID**.
5. Di dasbor **Vercel** proyek Anda (`Raflyf/chat-bot`), tambahkan Environment Variables:
   - `WHATSAPP_TOKEN`: (token akses dari Meta)
   - `WHATSAPP_PHONE_NUMBER_ID`: (Phone number ID dari Meta)
   - `WHATSAPP_VERIFY_TOKEN`: buat string rahasia acak Anda sendiri (misal `wa_verif_secret_2026`)
6. Kembali ke Meta Developer Dashboard -> menu **WhatsApp > Configuration**:
   - Klik **Edit** pada bagian Webhook.
   - **Callback URL**: `https://<domain-vercel-anda>.vercel.app/api/whatsapp`
   - **Verify token**: (string rahasia yang sama dengan `WHATSAPP_VERIFY_TOKEN` di Vercel)
   - Klik **Verify and save**.
   - Pada bagian **Webhook fields**, klik **Manage** -> centang opsi **messages** -> klik **Subscribe**.
7. Selesai! Bot WhatsApp Anda aktif 24 jam nonstop di Vercel selamanya.

### D. Menjalankan Bot di Cloud Baileys (Opsional)
Agar bot WhatsApp tetap aktif 24 jam meski laptop Anda dimatikan:
1. Masuk ke [Render.com](https://render.com) (gratis menggunakan akun GitHub Anda).
2. Klik **New +** -> pilih **Web Service**.
3. Pilih repositori GitHub Anda: `Raflyf/chat-bot`.
4. Konfigurasi layanan:
   - **Name**: `whatsapp-chatbot` (atau nama pilihan Anda)
   - **Environment**: `Node`
   - **Plan**: `Free` ($0)
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm run whatsapp:prod`
5. Masukkan **Environment Variables** (salin nilai yang sama dari berkas `.env` Anda):
   - `GROQ_KEYS`
   - `GEMINI_KEYS`
   - `OPENROUTER_KEYS`
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_KEY`
   - `BOT_NAME`, `BOT_PROFILE`
6. Klik **Deploy Web Service**.
7. Buka tab **Logs** di dashboard Render. Saat proses booting, QR Code akan muncul di log.
8. Pindai QR Code tersebut sekali dari HP WhatsApp Anda.
9. Sesi otomatis disinkronkan ke Supabase. Selesai! Bot WhatsApp Anda kini online 24 jam nonstop secara mandiri dan gratis.

### E. Mengakses Dashboard Pemantauan & Evaluasi Dataset
1. Buka URL deployment Vercel Anda di browser (misal `https://<domain-vercel-anda>.vercel.app`). Halaman utama (`/`) menyajikan Landing Page publik berisi fitur multimodal dan status bot online 24/7.
2. Klik tombol **"Monitoring Dashboard"** di bilah navigasi atau tombol CTA untuk diarahkan ke `/dashboard` (`/dashboard.html`).
3. Masukkan Master PIN (default: `080402`) langsung melalui keyboard atau numpad perangkat Anda (desain bersih tanpa keypad angka virtual manual).
4. Setelah masuk, token sesi aktif tersimpan selama 24 jam di browser Anda.
5. Jika salah memasukkan PIN sebanyak 5 kali berturut-turut, sistem terkunci selama 1 menit (60 detik) untuk pencegahan brute force.
6. Jika lupa PIN, klik tombol **"Lupa PIN? Reset via Email"** -> klik **"Kirim Kode OTP ke Email"** -> periksa email admin `raflyfirmansyah02@gmail.com` -> masukkan 6-digit kode OTP dan PIN baru Anda. Reset PIN otomatis menghanguskan sesi aktif di seluruh perangkat lain secara real-time.
7. Untuk melatih ulang (*fine-tuning*) model AI atau audit percakapan, buka bagian **"Evaluasi & Dataset Training AI"**, lalu klik tombol **Unduh JSONL** atau **Unduh CSV**.

---

## 3. Alur Eksekusi Sistem (Pipeline End-to-End)

```
[Pengguna Telegram]
       │
       ▼
[Update Telegram (Webhook / Polling)]
       │
       ▼
[Sanitasi & Filter Preprocessing]
       │
       ▼
[Ekstraksi Memori & RAG Context (`src/memory.ts`)]
  ├── 10 Riwayat Pesan Terakhir
  ├── Ringkasan Otomatis Percakapan Lampau
  └── Koreksi Tersimpan Pengguna (/salah)
       │
       ▼
[Klasifikasi Kueri Cerdas & Penelusuran Web (`src/web.ts`)]
  ├── Bypassed untuk Sapaan Murni, Jam/Kalender Lokal, Identitas Bot, & Aritmatika Baku
  └── Diaktifkan Universal untuk Semua Fakta, Situs/Web, Link URL, Produk, & Berita:
        ├── Bing Universal Web Search (Full-Web Engine Scraper)
        ├── Google News Global & ID RSS
        ├── Hacker News Algolia API
        ├── Wikipedia Full-Text Search (ID & EN)
        └── Autonomous Deep Webpage Scraper (Jina Reader r.jina.ai & Direct Fetch)
       │
       ▼
[Skills, Prompt Polymath & Multi-Domain Excellence (`src/skills.ts`)]
  ├── Standar Unggul: Matematika (Rumus abc), Koding (Type-Safe), Sains, Bahasa
  ├── Mandat Grounding Fakta Real-Time 2026 & Penyerapan Isi Web Lengkap (8.500 Karakter)
  └── Larangan Residu Berpikir Internal (Zero-Noise Mandate)
       │
       ▼
[Router Cepat Kilat & Rantai Failover (`src/providers.ts`)]
  ├── Mode Teks/Matematika/Koding:
  │     Groq (qwen3.8-27b ~2s) ──(fail)──> Gemini (2.5-flash) ──(fail)──> OpenRouter Pool ──(fail)──> Ollama
  └── Mode Vision/Gambar:
        Gemini (Native Vision ~1.7s) ──(fail)──> OpenRouter Vision
       │
       ▼
[Post-Processing & Formatter Telegram (`cleanMathAndNoise`)]
  ├── Pembersihan Tag <think> & CoT Monologue Scratchpad
  ├── Konversi Rumus LaTeX Mentah ke Notasi Aljabar & Simbol Unicode Bersih
  └── Redaksi Kredensial Sensitif: redactOutput()
       │
       ▼
[Pengiriman Pesan Aman (`sendTelegramMessageSafe` di `src/telegram.ts`)]
  ├── Pemecahan Paragraf Cerdas jika Karakter > 4000 (Anti-Error 400 Bad Request)
  └── Penyimpanan Riwayat ke Supabase PostgreSQL RLS
```

---

## 3. Fitur Utama Sistem

### 3.1. Mesin Penelusuran & Penjelajahan Web Universal (v0.23.4)
- **Universal Full-Web Coverage**: Mengadopsi mesin penelusuran terbuka berbasis Bing Web Search scraper yang mampu menjangkau seluruh situs, layanan, tools, SaaS, dokumentasi, dan tautan di dunia tanpa terkekang hanya pada feed berita publisher.
- **Autonomous Deep Web Scraper**: Jika pengguna menanyakan sebuah situs/website/layanan atau menyertakan tautan URL (misal `https://...` atau kueri "apakah web X bisa dipercaya?"), sistem otomatis menjelajahi URL target secara mendalam menggunakan Jina AI LLM Reader (`r.jina.ai`) dan direct fetch, menyedot isi halaman penuh (hingga ribuan karakter konten nyata) dan menyuntikkannya ke konteks LLM.
- **Buffer Injeksi Diperluas**: Batas karakter konteks fakta web dinaikkan dari 4.500 menjadi 8.500 karakter di `src/skills.ts` agar sanggup menampung struktur dokumentasi, harga, fitur, dan terms of service dari situs yang dijelajahi.
- **Multi-Source Fallback**: Terintegrasi harmonis dengan Google News Global/ID RSS, Bing News RSS, Hacker News API, dan Wikipedia full-text search.

### 3.2. Memori Berkelanjutan & Koreksi Dinamis
- Riwayat percakapan disimpan secara aman di tabel `messages`.
- Setiap 20 giliran percakapan, sistem membuat ringkasan padat di tabel `summaries`.
- Fitur koreksi pengguna via `/salah <instruksi_koreksi>` disimpan di tabel `corrections` dan dipatuhi secara absolut pada setiap giliran berikutnya.

### 3.3. Pemrosesan Multimodal & Media Komprehensif (WhatsApp & Telegram)
- **Teks & Chat:** Percakapan natural, flow-conscious, ramah sahabat, dan zero unsolicited advice.
- **Foto & Gambar:** Dianalisis oleh model vision (Gemini & OpenRouter) dengan penjelasan dan pemecahan masalah visual.
- **Dokumen PDF:** Dianalisis secara native multimodal via Google Gemini API (`inlineData`) untuk membaca teks, tabel, bagan, dan rangkuman.
- **Dokumen Word (.docx):** Diekstrak teks mentahnya via pustaka murni JavaScript `mammoth` dan dianalisis mendalam oleh AI.
- **Dokumen Teks, Data & Kode (.txt, .md, .csv, .json, kode):** Dibaca secara langsung via UTF-8 dengan batas token aman hingga 32.000 karakter.
- **Voice Note (VN / Audio):** Ditranskripsi otomatis sub-detik (~500ms) menggunakan Groq Whisper (`whisper-large-v3-turbo`) 100% gratis ($0 free-tier), kemudian dibalas secara alami oleh asisten.
- **Stiker WhatsApp & Telegram:** Diunduh (.webp) dan dianalisis ekspresi serta konteks humornya via model Vision AI, dengan fallback cerdas berbasis representasi emoji untuk stiker animasi/video.
- **Video & Catatan:** Merespons video kiriman pengguna secara kontekstual berbasis teks catatan (*caption*).

### 3.4. Pengingat Terjadwal (Reminders)
- Perintah `/remind <menit> <pesan>` mencatat jadwal ke tabel `reminders`.
- Pada mode lokal diproses oleh interval 30 detik; pada mode cloud diproses oleh endpoint cron Vercel.

---

## 4. Keamanan & Kebijakan Database (RLS)

- **Row Level Security (RLS) Mutlak:** Seluruh tabel database (`messages`, `summaries`, `corrections`, `provider_quota`, `reminders`) wajib dilindungi RLS via `sql/migrate_v09_hardened.sql`.
- **Isolasi Role:** Hak akses `SELECT`, `INSERT`, `UPDATE`, `DELETE` dicabut total dari publik (`anon` dan `authenticated`), hanya dapat diakses melalui kredensial privat `service_role`.
- **SSRF & Private Network Shield:** Pemblokiran penjelajahan URL lokal (`localhost`, `127.0.0.1`), rentang IP privat (RFC 1918), serta metadata cloud (`169.254.169.254`).
- **Pencegahan Injeksi Prompt:** Input pengguna dibatasi di dalam kontainer `<user_message>` agar tidak dapat mengganti aturan dasar sistem.
- **Sensor Otomatis API Key:** Mekanisme regex otomatis menyensor token Telegram, API key provider (`sk-`), dan Supabase key (`sbp_`) sebelum balasan dikirim keluar.

---

## 5. Riwayat Versi & Kronologi Perubahan

### v0.25.23 - 2026-09-12 13:12 WIB
**Penyelesaian Tuntas Masalah Interogasi Berulang & Penghapusan Pertanyaan Penutup Klise (`src/skills.ts`)**
- **Eliminasi Mandat Pancingan & Pertanyaan Lanjutan**:
  - Menghapus instruksi lama yang menyuruh bot menutup respons dengan "pancingan santai atau ajakan ngobrol" atau "1 pertanyaan lanjutan".
  - Menetapkan Aturan 5 baru: **LARANGAN MUTLAK INTEROGASI & SELALU BERTANYA DI SETIAP AKHIR CHAT (STRICT NO FORCED CLOSING QUESTIONS)**.
  - Melarang keras pertanyaan klise seperti: *"Mau coba yang lain gak nih?"*, *"Mau bahas apa nih biar gak bosen?"*, *"Lagi santai atau lagi gabut aja?"*, *"Mau digombalin lagi atau ganti topik?"*, *"Bener kan tebakanku?"*, *"Mau tebak-tebakan receh atau cerita random aja?"*.
  - Mengembalikan esensi chatting normal: cukup menanggapi, berkomentar wajar, bercanda, atau memberikan jawaban tuntas selesai tanpa tanda tanya (?) di akhir.
- **Penanganan Sapaan Singkat & Keluhan Gabut (`src/skills.ts`)**:
  - `isGreetingOnly`: Sapaan murni ("Halo", "Hai", "P", "Pagi") dibalas hangat dan tuntas ("Halo juga!", "Oy, tumben nih nyapa haha.") tanpa pertanyaan bercabang.
  - `isGabutOrBored`: Keluhan gabut/bosen ditanggapi secara empati/relate layaknya sahabat tanpa menyodorkan menu pilihan kaku.
- **Penyelesaian Tebak-Tebakan & Teka-Teki (`src/skills.ts`)**:
  - Saat user menyerah ("Ih gak tau", "kenapa?"), bot memberikan punchline/jawaban secara lucu dan tuntas, dilarang keras menambahkan ekor "Mau coba yang lain gak nih?".
- **Filter Sanitizer Regex Tambahan (`src/skills.ts`)**:
  - Menyaring pola-pola pertanyaan klise penutup, memangkas ekor pertanyaan validasi, dan menormalisasi typo pembuka seperti "HHumben" menjadi "Tumben".

### v0.25.22 - 2026-09-12 13:08 WIB
**Tuning & Peningkatan Respon Alami Multimodal (Stiker, Foto, Emoji, Dokumen, Video)**
- **Eliminasi Total Deskripsi Robotik Stiker (`src/skills.ts`, `src/media.ts`)**:
  - Melarang keras model mendeskripsikan ulang isi stiker ("Stiker ini menampilkan seekor kucing...").
  - Mengarahkan respon langsung ke esensi emosi, ekspresi wajah (komuk), banyolan, atau suasana stiker selayaknya teman akrab di WhatsApp/Telegram ("Wkwkwk komuknya tolong", "Ngece bener mukanya haha", "Siapp laksanakan!").
- **Eliminasi Pembuka Robotik pada Foto / Gambar (`src/skills.ts`)**:
  - Melarang keras kalimat pembuka klise seperti "Gambar ini menampilkan...", "Foto tersebut memperlihatkan...", "Pada gambar terdapat...", "Berdasarkan gambar...".
  - Jika ada pertanyaan/caption: langsung jawab to-the-point dan akurat.
  - Jika foto santai tanpa caption: tanggapi secara wajar, hangat, dan bersahabat (1-2 kalimat alami) tanpa memuji lebay dan tanpa mengomentari periferal di luar layar (merek laptop, casing HP, meja, dinding).
- **Penanganan Pesan Emoji Murni (`src/skills.ts`)**:
  - Menambahkan deteksi pesan yang murni berisi emoji (👍, 👌, 🔥, 🗿, ❤️, 🥺, 👀, 🙏).
  - Melarang menguliahi arti emoji dan merespon emosi secara instan dan alami (misal 👍 -> "Siapp!", 🗿 -> "Buset komuk batu haha", 🔥 -> "Menyala abangku haha").
- **Tuning Bahasa Dokumen (PDF, Word, Teks) & Video (`src/media.ts`)**:
  - Mengubah gaya sekretaris/birokrasi kaku menjadi gaya partner diskusi hangat: *"Udah kubaca nih dokumennya. Intinya..."*
  - Merespon video secara alami layaknya teman yang baru saja menonton video bersama.
- **Pembersihan Otomatis di Sanitizer (`src/skills.ts`)**:
  - Regex cleaner otomatis memangkas sisa-sisa pembuka robotik visual, aksi panggung dalam asteris (*menggigit jari*, *goyang-goyang*), tawaran penutup basa-basi (*kalo mau cerita lebih lanjut...*), dan normalisasi singkatan acak.

### v0.25.21 - 2026-09-12 12:55 WIB
**Implementasi Arsitektur Pipeline Multimodal Presisi (Vision, Audio VN, Dokumen PDF, Word, Video)**
- **Rantai Failover Vision & Foto (`src/providers.ts`)**:
  - Primary: `mistralai/mistral-large-2512`
  - Cadangan 1: `qwen/qwen3.8-max:free`
  - Cadangan 2: `mistralai/mistral-medium-3.5`
  - Cadangan 3: `qwen/qwen3.6-plus:free`
  - Cadangan 4: `gemini-3.8-flash`
  - Cadangan 5: `gemini-2.5-flash`
- **Rantai Failover Audio & Voice Note VN (`src/media.ts`)**:
  - Primary: `whisper-large-v3` (Groq Dedicated STT)
  - Cadangan 1: `gemini-3.8-flash` (Google Native Audio Transcription)
  - Cadangan 2: `whisper-large-v3-turbo` (Groq Dedicated STT)
  - Cadangan 3: `gemini-2.5-flash` (Google Native Audio Transcription)
- **Rantai Failover Dokumen PDF (`src/media.ts`)**:
  - Primary: `gemini-3.8-flash` (Native Multimodal Document)
  - Cadangan 1: `gemini-2.5-flash` (Native Multimodal Document)
  - Fallback: Parser Teks PDF Lokal (`extractPdfTextSimple`) diteruskan ke penalaran xKiro Qwen 3.8.
- **Rantai Dokumen Word (.docx) & Teks (`src/media.ts`)**:
  - Parser lokal Mammoth (21 ms) mengekstrak teks Word lalu menyuntikkan teks ke model xKiro primary (`qwen/qwen3.8-max:free`) dan cadangan (`mistralai/mistral-medium-3.5`).
- **Penanganan Video (MP4/WebM) (`src/media.ts`, `src/telegram.ts`, `src/whatsapp_baileys.ts`)**:
  - Mengintegrasikan `processIncomingVideo` via Google Gemini Multimodal API di WhatsApp Baileys dan Telegram.
- **Klarifikasi Peran OpenRouter**:
  - OpenRouter gratis berstatus murni teks (*text-only*). Berperan sebagai jaring pengaman terakhir (*ultimate fallback*) saat xKiro, Groq, dan Gemini limit untuk chat teks biasa.

### v0.25.20 - 2026-09-12 12:46 WIB
**Audit & Benchmark Komprehensif Gemini 3.8 Flash Lintas Seluruh Modalitas (Teks, Vision, PDF, Audio, Video)**
- **Hasil Benchmark Faktual `gemini-3.8-flash`**:
  - **Spesifikasi Model**: Input context window 1.048.576 token (1M), output window 65.536 token, mendukung `generateContent` untuk teks, gambar, audio, dokumen PDF, dan video.
  - **Teks / Chat**: Latensi 3.5–4.5s dengan arsitektur penalaran mendalam (*deep reasoning* thoughts token).
  - **Foto / Gambar (Vision)**: 5.489 ms (Prompt: 1.112 token [1.100 image tokens], Thoughts: 362 token, Candidates: 41 token). Analisis visual dan OCR tingkat tinggi.
  - **Dokumen PDF**: 12.919 ms (Prompt: 553 token [544 document tokens], Thoughts: 98 token). Membaca struktur dan judul dokumen native PDF secara presisi tanpa konverter eksternal.
  - **Audio / VN**: 2.780 ms (Prompt: 31 token [25 audio tokens], Thoughts: 102 token). Native speech and audio sound interpretation.
  - **Video (MP4)**: Native multi-frame video reasoning via Google AI Multimodal API.

### v0.25.19 - 2026-09-12 12:40 WIB
**Konfigurasi Urutan Model Pengguna & Audit Multimodal Lintas Provider (Foto, Video, VN, PDF, Dokumen)**
- **Penyusunan Rantai Failover Presisi xKiro (`src/env.ts`, `src/providers.ts`)**:
  - Mengonfigurasi urutan model sesuai instruksi pengguna:
    - **Primary**: `qwen/qwen3.8-max:free`
    - **Cadangan 1**: `mistralai/mistral-medium-3.5`
    - **Cadangan 2**: `deepseek/deepseek-v4-flash`
    - **Cadangan 3**: `mistralai/mistral-large-2512`
    - **Cadangan 4**: `deepseek/deepseek-chat-v3.1`
    - **Cadangan 5**: `qwen/qwen3.7-max:free`
    - **Cadangan 6**: `deepseek/deepseek-v4-pro`
    - **Cadangan 7**: `qwen/qwen3.6-plus:free`
    - **Cadangan 8**: `mistralai/mistral-small-2603`
  - Menyelaraskan rantai vision xKiro pada model-model pendukung visual:
    `['qwen/qwen3.8-max:free', 'mistralai/mistral-medium-3.5', 'mistralai/mistral-large-2512', 'qwen/qwen3.6-plus:free', 'mistralai/mistral-small-2603']`.
- **Audit Faktual Multimodal Lintas Provider (Foto, Audio/VN, PDF, Word, Video)**:
  - Menguji kapabilitas seluruh penyedia (`xKiro`, `Groq`, `Google Gemini`, `OpenRouter`) pada semua jenis media WhatsApp & Telegram:
    - **Foto/Gambar**: xKiro (Qwen 3.8, Mistral Large, Mistral Medium, Qwen 3.6, Mistral Small) dan Gemini 2.5/3.8 Flash terbukti unggul dengan OCR dan pemahaman visual tinggi.
    - **Audio / Voice Note (VN)**: Groq Whisper (`whisper-large-v3-turbo` dan `whisper-large-v3`) terbukti tercepat dengan latensi 283–334 ms; Gemini 2.5 Flash mendukung input audio langsung.
    - **Dokumen PDF**: Google Gemini 2.5/3.8 Flash menjadi jawara native multimodal PDF (analisis layout, tabel, dan grafik hingga 1M token context).
    - **Dokumen Word (.docx) & Teks**: Mesin ekstraksi lokal Mammoth mengekstrak dokumen dalam 21 ms untuk diteruskan ke penalaran LLM.
    - **Video (MP4)**: Didukung secara native oleh Google Gemini Multimodal API.

### v0.25.18 - 2026-09-12 12:10 WIB
**Penyegaran Rantai Model Cadangan xKiro & Penyelarasan Prioritas Multimodal Vision**
- **Restrukturisasi Pool Model xKiro (`src/env.ts`)**:
  - Menyederhanakan dan merapikan urutan failover xKiro:
    1. Primary: `qwen/qwen3.8-max:free`
    2. Backup 1: `mistralai/mistral-large-2512`
    3. Backup 2: `sensenova/sensenova-6.8-flash-lite` (model penalaran/reasoning dari SenseTime)
    4. Backup 3: `mistralai/mistral-medium-3.5`
    5. Backup 4: `qwen/qwen3.6-plus:free`
    6. Backup 5: `deepseek/deepseek-v4-flash`
    7. Backup 6: `deepseek/deepseek-v4-pro`
    8. Backup 7: `qwen/qwen3.7-plus:free`
  - Mengeliminasi model yang tidak lagi digunakan (`minimax-m2.7-highspeed:free`, `minimax-m3:free`, `codestral-2508`).
- **Penyelarasan Urutan Prioritas Multimodal Vision (`src/providers.ts`)**:
  - Mengurutkan `visionModels` pada provider xKiro agar selaras dengan prioritas model terbaru:
    `['qwen/qwen3.8-max:free', 'mistralai/mistral-large-2512', 'mistralai/mistral-medium-3.5', 'qwen/qwen3.6-plus:free']`.
  - Memastikan jika input gambar dikirimkan pengguna, failover vision langsung beralih ke `mistral-large-2512` dan `mistral-medium-3.5` sebelum `qwen3.6-plus`.

### v0.25.17 - 2026-09-12 12:05 WIB
**Penyatuan Tombol Unduh CSV Tunggal & Sinkronisasi Ekspor dengan Filter Dinamis (Waktu, Platform, Model, Pencarian)**
- **Penyatuan Tombol Unduh CSV Tunggal (`public/dashboard.html`)**:
  - Menghapus tombol ganda "Unduh CSV (Hari Ini)" dan "Unduh CSV (Semua)", menggantikannya dengan satu tombol terpadu **"Unduh CSV"**.
  - Mengarahkan aksi unduh agar 100% patuh pada status aktif kontrol filter dropdown:
    - **Filter Waktu (`#dataset-range-filter`)**: Hari Ini Saja (WIB), Semua Waktu, 7 Hari, 14 Hari, atau 30 Hari.
    - **Filter Platform (`#dataset-platform-filter`)**: Semua Platform, WhatsApp, atau Telegram.
    - **Filter Model (`#dataset-model-filter`)**: Semua Model, xKiro, OpenCode Zen, Groq, Gemini, atau OpenRouter.
    - **Filter Pencarian (`#dataset-search`)**: Menyaring percakapan berdasarkan kata kunci teks pertanyaan pengguna atau balasan bot.
- **Ekspor Menyeluruh & Penamaan Berkas Dinamis (`api/dataset.ts`, `public/dashboard.html`)**:
  - Mengangkat batas kuota ekspor (`dbLimit = 3000` dan mengembalikan seluruh `pairs` yang lolos filter) agar data tidak terpotong saat diunduh.
  - Menyematkan label filter aktif pada nama berkas yang diunduh (contoh: `evaluasi_chatbot_hari_ini_2026-09-12_jam_12-05_whatsapp_xkiro.csv`).

### v0.25.16 - 2026-09-12 11:59 WIB
**Penyempurnaan Dataset Evaluasi: Kolom Tanggal & Jam Lokal Terpisah serta Penanda Waktu pada Nama Berkas**
- **Penambahan Kolom Tanggal, Jam, dan Waktu Lokal Terpisah (`api/dataset.ts`)**:
  - Memecah timestamp mentah ISO UTC database Supabase (`createdAt`) menjadi komponen lokal yang presisi sesuai zona waktu pengguna (default: `Asia/Jakarta` / WIB):
    - `Tanggal`: format `YYYY-MM-DD` (contoh: `2026-09-12`).
    - `Jam`: format `HH:mm:ss` 24 jam (contoh: `01:20:01`).
    - `Waktu_Lokal`: format lengkap berlabel zona waktu (contoh: `2026-09-12 01:20:01 WIB`).
    - `Waktu_UTC`: mempertahankan timestamp ISO mentah asli database untuk kebutuhan audit teknis.
  - Memastikan lembar kerja Excel, Google Sheets, atau aplikasi spreadsheet lainnya dapat langsung membaca, memfilter, dan mengurutkan data berdasarkan jam percakapan tanpa terpotong atau mengalami pergeseran selisih waktu UTC.
- **Timestamp Jam pada Penamaan Berkas Unduhan (`api/dataset.ts`, `public/dashboard.html`)**:
  - Menyematkan jam dan menit ekspor pada nama berkas unduhan dataset:
    - Contoh: `evaluasi_chatbot_hari_ini_2026-09-12_jam_11-59.csv` atau `evaluasi_chatbot_semua_2026-09-12_jam_11-59.csv`.
    - Format JSONL: `training_dataset_hari_ini_2026-09-12_jam_11-59.jsonl`.
  - Mencegah penumpukan berkas dengan akhiran duplikasi browser seperti `(1)`, `(6)`, `(7)` sehingga pengguna dapat langsung mengetahui waktu pasti saat dataset diunduh.
- **Integrasi Metadata Waktu Lokal pada Format JSONL (`api/dataset.ts`)**:
  - Menyertakan field `timestamp_lokal`, `tanggal_lokal`, dan `jam_lokal` pada metadata tiap pasangan dialog JSONL untuk mempermudah pipeline training dan evaluasi.

### v0.25.15 - 2026-09-12 02:48 WIB
**Evaluasi Tebakan Dinamis Anti-Template (Ketebak vs Tebakan Salah vs Nyerah)**
- **Penanganan Tebakan Benar / Ketebak (`src/skills.ts`)**:
  - Jika pengguna berhasil menebak atau tebakannya mengenai punchline humor/gombalan, bot dilarang keras mengabaikan tebakannya atau menjawab seolah tidak ada tebakan.
  - Bot merespons dengan reaksi kaget, geregetan lucu, atau kagum secara spontan dan dinamis (contoh: "Yahh kok ketebak sih wkwk!", "Buset kok tahu aja bjir haha!", "Anjir langsung bener wkwk").
- **Penanganan Tebakan Salah / Kurang Tepat (`src/skills.ts`)**:
  - Jika pengguna mencoba menebak tapi salah atau jawaban serius yang bukan punchline recehnya, bot dilarang langsung membocorkan jawaban asli.
  - Bot memberitahu bahwa tebakannya salah secara santai dan lucu, lalu menantang pengguna untuk menebak lagi (contoh: "Salahhh wkwk, bukan itu! Coba tebak lagi dong", "Masih kurang tepat bjir haha, coba tebak lagi!").
- **Penanganan Nyerah / Tanya Langsung (`src/skills.ts`)**:
  - Jika pengguna menyatakan menyerah atau bertanya langsung ("kenapa?", "apaan tuh?", "gatau", "nyerah"), bot langsung mengirimkan punchline lelucon atau gombalan dengan natural.

### v0.25.14 - 2026-09-12 02:44 WIB
**Gombalan Interaktif Dua Arah & Resolusi Transisi Roleplay ke Rayuan**
- **Format Gombalan Interaktif Dua Arah (`src/skills.ts`)**:
  - Mengubah paradigma gombalan dari eksekusi langsung satu pesan menjadi format pancingan tebak-tebakan gombal dua arah (contoh: "Eh, kamu tahu gak bedanya kamu sama jam dinding? Coba tebak!").
  - Menahan punchline rayuan manis hingga pengguna merespons di giliran berikutnya ("kenapa?", "apaan tuh?", "emang apa?"), menciptakan sensasi interaksi mengobrol yang hidup, seru, dan membuat penasaran.
- **Resolusi Transisi Pergantian Topik dari Penutupan Peran (`src/skills.ts`)**:
  - Memperbaiki `stopRoleplayMatch` agar tidak menekan permintaan gombalan ketika pengguna menggunakan frasa peralihan seperti "cukup deh ganti ke gombalan".
- **Pengaman Kode Terprogram Pemisah Punchline Rayuan (`src/skills.ts`)**:
  - Menambahkan deteksi pola rayuan deklaratif ("Kamu tuh kayak X ya, soalnya Y") pada `autoReply` yang otomatis mengubah kalimat menjadi pertanyaan pancingan interaktif ("Kamu tahu gak kenapa kamu tuh kayak X? Coba tebak!") jika model secara tidak sengaja memuntahkan rayuan lengkap dalam satu putaran.

### v0.25.13 - 2026-09-12 02:36 WIB
**Jokes & Tebak-tebakan Interaktif Dua Arah, Pemahaman Emoji Tawa Gaul & Eliminasi Repetisi Respons**
- **Mekanisme Joke & Tebak-tebakan Interaktif Dua Arah (`src/skills.ts`)**:
  - Menetapkan aturan mutlak bahwa saat pengguna meminta joke atau tebak-tebakan, bot HANYA memberikan pertanyaan setup tebakan dan mengajak menebak tanpa membocorkan punchline langsung di pesan yang sama.
  - Menunggu respon lawan bicara (seperti pertanyaan "kenapa?", "emang kenapa?", atau tebakan pengguna) sebelum memberikan jawaban punchline di giliran berikutnya.
  - Menambahkan pengaman kode terprogram pada `autoReply` untuk mendeteksi dan memisahkan punchline jika model secara tidak sengaja menggabungkan pertanyaan dan jawaban dalam satu pesan.
  - Memperluas variasi humor ke lelucon umum sehari-hari (bukan hanya lelucon koding/programming) serta mematuhi larangan jika pengguna meminta menghindari joke programming.
- **Pemahaman Slang & Emoji Tawa Gaul (Emoji 😭 / 😭😭 = Ngakak Brutal, `src/skills.ts`)**:
  - Mengedukasi model bahwa emoji `😭` atau `😭😭` yang digabung dengan kata tawa (seperti `ngakak😭`, `anjggg ngakak😭`, `lucu banget😭`) merupakan ekspresi tertawa terbahak-bahak sampai menangis (ngakak brutal), bukan menangis sedih.
  - Melarang keras bot meminta maaf seolah-olah membuat pengguna sedih ("maaf ya kalo bikin lu nangis", dsb) dan mengarahkan bot untuk ikut tertawa lepas bersama pengguna.
- **Eliminasi Total Repetisi Respons & Pemutusan Attractor Loop (`src/skills.ts`, `src/providers.ts`)**:
  - Mengimplementasikan deduplikasi pesan asisten pada `buildMessages` agar riwayat percakapan yang tersimpan di basis data tidak memasukkan respons identik berulang ke dalam context few-shot model.
  - Menambahkan sanitasi otomatis untuk membersihkan template lelucon lama (seperti lelucon kucing ngintip laptop) dan kalimat salah paham tangisan dari riwayat percakapan.
  - Menambahkan deteksi pengulangan balasan identik pada `autoReply` yang otomatis mengganti respon menjadi tebakan segar jika model mencoba mengulang pesan sebelumnya.
  - Meningkatkan `presence_penalty` menjadi 0.5 dan menambahkan `frequency_penalty: 0.3` pada inferensi provider OpenAI-compatible untuk menekan probabilitas pengulangan token dan frasa identik.

### v0.25.12 - 2026-09-12 02:20 WIB
**Proteksi Anti-Bocor Memori & Penguncian Fitur Gombal Eksklusif On-Demand**
- **Proteksi Anti-Bocor Memori (Zero Memory Leakage & Noise Isolation, `src/skills.ts`)**:
  - Mengunci `ctx.summary` sebagai referensi pasif internal murni berlabel `[MEMORI & LATAR BELAKANG TEMAN BICARA]`, disertai direktif mutlak agar model tidak mengungkit topik masa lalu yang tidak relevan dengan pesan saat ini.
  - Melarang keras membawa-bawa riwayat lama (seperti rekomendasi skincare, curhatan lampau, atau nama pihak ketiga) ke percakapan baru yang tidak membahas hal tersebut.
- **Isolasi Fitur Gombalan Eksklusif Berbasis Permintaan Eksplisit (`src/skills.ts`)**:
  - Menghapus total inisiatif penawaran gombalan dari bot ("mau digombalin lagi?", "siap ngegombal kapan aja").
  - Menetapkan aturan bahwa gombalan hanya dan eksklusif aktif apabila lawan bicara meminta secara eksplisit (misal: "coba gombalin aku").
  - Menghilangkan kata "gombalan" dari deskripsi umum gaya bahasa WhatsApp agar tidak terjadi over-priming pada model.
- **Sanitasi Riwayat Asisten & Pembersih Output Lanjutan (`src/skills.ts`)**:
  - Membersihkan residu penawaran gombal atau racauan lama yang tersimpan di riwayat pesan basis data sebelum disuntikkan ke model pada `buildMessages`.
  - Menambahkan filter pemotong sisa penawaran gombal yang tidak diminta pada `cleanMathAndNoise`.

### v0.25.11 - 2026-09-12 02:16 WIB
**Normalisasi Newline Obrolan Santai & Penyatuan Paragraf Mengalir Alami**
- **Penyatuan Kalimat Obrolan Santai Alami (`src/skills.ts`)**:
  - Menghapus kebiasaan memecah obrolan santai 1-3 kalimat menjadi baris-baris terpisah dengan enter kosong di tengah pesan.
  - Mengimplementasikan Rule 16 pada `cleanMathAndNoise` di `src/skills.ts`: secara otomatis menyatukan obrolan santai pendek (< 400 karakter) yang terpecah newline ganda tanpa daftar poin atau blok kode menjadi satu paragraf yang mengalir lancar.
  - Format teknis yang membutuhkan baris baru (daftar poin `-`, blok kode, heading teks) tetap terlindungi dan mempertahankan newline secara rapi.
- **Pedoman Prompt Struktur Paragraf Wajar (`src/skills.ts`)**:
  - Menambahkan instruksi eksplisit agar model tidak memecah percakapan santai dengan baris baru yang mengganggu, menjaga pesan menyerupai gaya berkirim pesan WhatsApp manusia normal.

### v0.25.10 - 2026-09-12 02:11 WIB
**Pembatasan Ketat Penggunaan Emoji & Naturalisasi Sapaan Identitas**
- **Pembatasan Ketat Emoji (Anti-Over-Emoji & Zero Robot Emoji, `src/skills.ts`)**:
  - Menetapkan aturan prompt sistem agar emoji digunakan secara sangat hemat (maksimal 1 emoji per pesan atau tanpa emoji sama sekali jika tidak perlu).
  - Menghapus total emoji robot yang terkesan kaku dan murahan.
  - Mengimplementasikan sanitasi kode terprogram pada Rule 6 di `cleanMathAndNoise` (`src/skills.ts`): secara otomatis memangkas emoji berlebih jika model mengeluarkan lebih dari 1 emoji (maksimal 2 untuk teks sangat panjang), menjamin obrolan di WhatsApp dan Telegram tidak dibanjiri emoji di setiap baris kalimat.
- **Naturalisasi Respon Identitas Diri & Sapaan Developer (`src/skills.ts`)**:
  - Jika pengguna bertanya siapa bot tersebut, bot menjawab santai sebagai teman ngobrol bernama FreeAIBot tanpa memuntahkan daftar panjang kemampuan teknis atau pamer fitur.
  - Jika lawan bicara mengaku sebagai Rafly, bot menyapa akrab dan santai layaknya teman ngobrol biasa tanpa reaksi berlebihan.

### v0.25.9 - 2026-09-12 02:05 WIB
**Eliminasi Jawaban Template, Respon Dinamis Inti Developer, & Pembersihan Negative Priming**
- **Penyederhanaan Inti Identitas Developer Tanpa Template Kaku (`src/skills.ts`)**:
  - Menghapus seluruh kalimat skrip template dalam tanda kutip pada instruksi developer.
  - Menggantinya dengan fakta inti esensial: developer utama adalah Rafly Firmansyah (Rafly atau Rflyyyf).
  - Membebaskan model untuk menyusun kalimat balasan secara dinamis, santai, dan mengalir natural sesuai gaya obrolan akrab tanpa bertele-tele.
- **Eliminasi Total Negative Priming & Racauan Boilerplate (`src/skills.ts`)**:
  - Menghapus daftar larangan kata yang memicu model menyebut teknologi (Vercel, Supabase, PostgreSQL) atau julukan fisik di luar konteks.
  - Menghapus frasa defensif bot ("aku kan cuma bot", "aku lagi belajar") yang sebelumnya memicu model meniru pola tersebut saat diledek.
  - Menambahkan filter pembersih racauan pada `cleanMathAndNoise` dan sanitasi riwayat percakapan di `buildMessages` agar kalimat rusak sebelumnya tidak menular ke giliran chat berikutnya.
- **Penghentian Instan Saat Kata "Cukup" Diterima (`src/skills.ts`)**:
  - Menambahkan kata `cukup` ke dalam regex `stopRoleplayMatch`.
  - Menginstruksikan bot untuk langsung menyudahi akting atau gombalan tanpa menawarkan kembali rayuan atau menu peran baru.
- **Pembersihan Aksi Panggung Asteris (`*ngakak*`, `*ketawa*`, `src/skills.ts`)**:
  - Memperluas pembersih gestur fisik Rule 13b di `cleanMathAndNoise` agar kata tawa diapit bintang dibersihkan sehingga teks percakapan tampil bersih di WhatsApp dan Telegram.

### v0.25.8 - 2026-09-12 01:42 WIB
**Tuning Respon Percakapan High-EQ, Bahasa Gaul Indonesia & Pengenalan Identitas Developer**
- **Adopsi Slang & Bahasa Gaul Indonesia Terkontrol (`src/skills.ts`)**:
  - Memasukkan slang percakapan anak muda Indonesia (seperti anjir, bjir, anjay, wkwk, santai, dsb) secara luwes, kasual, dan kontekstual.
  - Mendukung penggunaan emoji ekspresif yang relevan dengan kondisi emosional kalimat secara proporsional.
- **Penegasan Identitas Lengkap Developer (`src/skills.ts`)**:
  - Menetapkan nama resmi developer adalah Rafly Firmansyah (Rafly atau Rflyyyf).
  - Mendukung sinonim pertanyaan identitas pembuat (developer, author, pembuat, pencipta, programmer, yang bikin).
  - Menerima candaan dan ledekan nama panggilan untuk developer secara santai tanpa perlu membela diri secara kaku.
- **Penyempurnaan Kecerdasan Emosional (High-EQ Conversational Tuning, `src/skills.ts`)**:
  - Merespons curhatan atau obrolan santai pengguna dengan empati mendalam tanpa menggurui atau terkesan mekanis.
  - Menghapus frasa aksi fisik dalam kurung siku atau tanda bintang agar format pesan terasa seperti percakapan nyata.

### v0.25.7 - 2026-09-12 01:28 WIB
**Ekspor CSV Filter Hari Ini, Exit Roleplay Protocol, Resolusi Lokasi & Optimasi Failover Model**
- **Fitur Ekspor CSV Khusus Hari Ini (`api/dataset.ts`, `public/dashboard.html`)**:
  - Menambahkan tombol aksi cepat `Unduh CSV (Hari Ini)` di panel dataset evaluasi dashboard monitoring dengan penataan visual kontras hijau aksen `.btn-today`.
  - Mengizinkan pengunduhan langsung data interaksi hari ini saja tanpa mengunduh seluruh data historis basis data (~21 KB vs ~87 KB).
  - Memperbarui kalkulasi `range === 'today'` pada `api/dataset.ts` menggunakan batas awal dan akhir hari WIB (`Asia/Jakarta` / UTC+7) yang presisi (`startDateIso` dan `endDateIso`), serta mendukung parameter `date=YYYY-MM-DD` atau `date=today`.
  - Memberikan penamaan berkas unduhan yang terstruktur dan deskriptif (`evaluasi_chatbot_hari_ini_YYYY-MM-DD.csv`, `training_dataset_hari_ini_YYYY-MM-DD.jsonl`, `evaluasi_chatbot_semua_YYYY-MM-DD.csv`).
  - Menyelaraskan filter dropdown `dataset-range-filter` dengan opsi `Hari Ini Saja (WIB)` dan menyertakan parameter `tz` pada fetch request tabel.
- **Protokol Keluar Peran / Instant Exit Roleplay Protocol (`src/skills.ts`)**:
  - Memperbaiki kegagalan bot keluar dari sandiwara/peran (seperti tetap berakting pacar/drakor dan mengulang template pilihan bertumpuk) saat pengguna meminta berhenti (`stop berperan`, `kita putus`, `stop peran`).
  - Menambahkan deteksi intent penghentian peran secara dinamis pada `systemPrompt`: jika terdeteksi, instruksi prioritas tertinggi disuntikkan seketika agar model 100% berhenti berakting, tidak merajuk/baper seolah patah hati, dan kembali ke persona ramah FreeAIBot normal.
  - Memperkaya pembersihan output di `cleanMathAndNoise` untuk melenyapkan ekspresi kurung siku panggung (`*[suara jadi dingin]*`, `*(sengau dalam-dalam)*`, dll) serta memotong trailer menu pilihan kaku (`--- *Pilihan kamu:*`).
- **Resolusi False-Positive Lokasi 'Tua Bangka' & Identitas Developer (`src/timezone.ts`, `src/skills.ts`)**:
  - Memperketat regex lokasi di `src/timezone.ts` dengan mewajibkan preposisi tempat eksplisit dan mengabaikan idiom peyoratif seperti `tua bangka` agar tidak keliru mendeteksi provinsi Bangka Belitung.
  - Menghapus riwayat koreksi halusinasi Bangka Belitung yang sempat tersimpan pada tabel `corrections` Supabase.
  - Menegaskan identitas pencipta/developer utama bot adalah Rafly (Rflyyyf) pada prompt sistem dan melarang bot menyangkal atau berhalusinasi pacaran dengan developernya.
- **Optimalisasi Failover Model & Pencegahan Perulangan Kaku (`src/env.ts`, `src/providers.ts`, `.env`)**:
  - Mengurutkan ulang failover chain xKiro dengan menempatkan model percakapan alami berkinerja tinggi (`mistralai/mistral-large-2512`, `mistralai/mistral-medium-3.5`, `sensenova/sensenova-6.8-flash-lite`) di posisi terdepan, serta mendemosi model kode kaku (`codestral-2508`) ke urutan cadangan terakhir.
  - Mengaktifkan `presence_penalty: 0.3` pada inferensi OpenAI-compatible untuk mencegah perulangan frasa dan lelucon yang identik.

### v0.25.6 - 2026-09-12 01:05 WIB
**Audit & Peningkatan Desain Responsif Multi-Device (Mobile, Tablet, Desktop)**
- **Penyesuaian Responsif Landing Page (`public/index.html`)**:
  - Mengubah kalkulasi grid fitur `features-grid` menjadi `minmax(min(100%, 280px), 1fr)` untuk melenyapkan resiko horizontal overflow pada smartphone kecil (320px - 375px).
  - Mengimplementasikan fluid typography judul hero (`clamp(1.75rem, 5vw + 0.5rem, 2.25rem)`) dan konversi tombol aksi chat menjadi selebar 100% pada tampilan smartphone (<= 580px).
  - Merapikan header bilah navigasi dengan menyembunyikan subtitle merek dan mengoptimalkan padding tombol tanpa melanggar standar minimum target sentuh WCAG 2.2.
  - Menata kartu promosi dashboard (`dashboard-teaser`) agar terkonfigurasi vertikal terpadu di layar mobile/tablet.
  - Memperbarui nomor versi di footer halaman beranda ke `v0.25.6`.
- **Penyesuaian Responsif Dashboard Pemantauan (`public/dashboard.html`)**:
  - Mengurangi padding tepi body pada layar mobile (<= 640px) dari 1.5rem menjadi 0.75rem dan menyelaraskan margin header agar pas di tepian layar.
  - Memperbaiki grup filter waktu dan pill model provider (`pill-filter-group`, `matrix-time-filters`) dengan dukungan scroll horizontal (`overflow-x: auto; -webkit-overflow-scrolling: touch; scrollbar-width: none;`) tanpa pemotongan atau wrap bertumpuk.
  - Memperbaiki batas minimal grid kartu ringkasan KPI (`kpi-grid`), pool provider (`pool-grid`), dan pita statistik upstream (`live-stats-ribbon`) menjadi nilai fleksibel `min(100%, ...)` agar beralih otomatis ke mode 1 kolom di layar ponsel sempit.
  - Memastikan seluruh kontainer tabel data (`table-container`, `token-table-container`) mendukung gestur gulir sentuh akselerasi hardware iOS/Android (`-webkit-overflow-scrolling: touch`).
  - Mengoptimasi tata letak modal Master PIN dan reset OTP di layar ponsel kecil.

### v0.25.5 - 2026-09-12 00:45 WIB
**Sinkronisasi Model Aktif ke Dashboard Monitor, Perapihan Tata Letak Kartu #1 & Pembersihan Judul Provider**
- **Sinkronisasi Katalog Model Lengkap (`public/dashboard.html`, `api/stats.ts`)**:
  - Seluruh 19 model aktif rantai failover runtime (xKiro 11 model, Groq 3 model, Gemini 2 model, OpenRouter 3 model) terdaftar 100% pada matriks kartu inferensi dashboard.
  - Endpoint `api/stats.ts` meneruskan properti `allModels` untuk setiap pool provider sehingga antarmuka dashboard memiliki visibilitas penuh atas seluruh model primer dan model cadangannya.
- **Perapihan Tata Letak Kartu #1 & Penataan Lencana Kapabilitas (`public/dashboard.html`)**:
  - Memperbaiki lencana status aktif (`.badge-active-live`) dengan `white-space: nowrap` dan `flex-shrink: 0`, mengeliminasi pembungkusan teks dua baris ("AKTIF TERBARU") yang merusak proporsi visual kartu.
  - Memindahkan lencana kapabilitas (`Code`, `Reasoning`, `Vision`, `Voice Note`, `Fast Text`) ke baris khusus (`.card-caps-row`) di bawah nama model, menjaga baris atas kartu tetap bersih dan seimbang.
  - Menghapus imbuhan provider dalam tanda kurung pada nama model katalog (misal `DeepSeek V4 Pro` alih-alih `DeepSeek V4 Pro (xKiro)`).
- **Pembersihan Nama Model Redundan pada Judul Provider (`api/stats.ts`, `public/dashboard.html`)**:
  - Mengubah `displayName` di `api/stats.ts` menjadi nama provider murni tanpa embel-embel nama model di dalam tanda kurung (`xKiro Gateway`, `Groq Cloud API`, `Google Gemini API`, `OpenRouter AI`).
  - Mengubah judul kolom tabel di `public/dashboard.html` dari `Provider & Model Flagship` menjadi `Provider`.
- **Perbaikan Inferensi Tipe Data Serverless (`api/stats.ts`)**:
  - Menyelesaikan error kompilasi TypeScript pada `liveResults` dengan mendeklarasikan tipe eksplisit `XkiroLiveItem[]` dan `OrLiveItem[]`, mencegah union collapse pada array perantara.

### v0.25.4 - 2026-09-12 00:20 WIB
**Penyelarasan Model xKiro: SenseNova 6.8, Mistral Medium 3.5 & Eliminasi Model Berbayar**
- **Penyesuaian Model Cadangan xKiro (`src/env.ts`, `src/providers.ts`)**:
  - Menghapus `openai/gpt-5.3-codex-spark` karena berstatus berbayar (*paying customers only* / HTTP 403).
  - Menghapus `qwen/qwen3-vl-plus:free` dari daftar model teks cadangan dan model vision.
  - Menambahkan `mistralai/mistral-medium-3.5` (Terbukti aktif 100%, mendukung teks & multimodal vision).
  - Menambahkan `sensenova/sensenova-6.8-flash-lite` (Terbukti aktif 100% untuk pemrosesan teks berkecepatan tinggi).
  - Menambahkan `minimax/minimax-m2.7-highspeed:free` dan `minimax/minimax-m3:free` sebagai model cadangan standby.
- **Hasil Pengujian Faktual Live**:
  1. `mistralai/mistral-large-2512`: HTTP 200 OK (Teks & Vision aktif).
  2. `mistralai/mistral-medium-3.5`: HTTP 200 OK (Teks & Vision aktif).
  3. `sensenova/sensenova-6.8-flash-lite`: HTTP 200 OK (Teks cepat aktif).
  4. Varian MiniMax: Server upstream xKiro saat ini mengembalikan HTTP 500 internal server error; aman di-handle oleh auto-failover.

### v0.25.3 - 2026-09-12 00:08 WIB
**Persistent Knowledge Memory with Dynamic TTL, Shared Multi-Platform Intelligence & Sub-Millisecond Cache Lookup**
- **Sistem Memori Pengetahuan Bersama Permanen (`src/knowledge.ts`, `sql/migrate_v14_web_knowledge.sql`)**:
  - Mengubah hasil penelusuran web dan penjelajahan internet menjadi pengetahuan kumulatif permanen bagi AI, sehingga bot tidak perlu mengulang penelusuran atau men-scrap ulang data yang sudah pernah dipelajari sebelumnya.
  - Pengetahuan disimpan pada tabel `web_knowledge` di Supabase dan disinkronkan ke dalam *Hot In-Memory Cache* lokal untuk respon sub-milidetik (<0.06ms).
  - Sekali sebuah fakta dipelajari dari pertanyaan pengguna tertentu (baik di WhatsApp maupun Telegram), seluruh pengguna lain yang menanyakan hal serupa langsung mendapatkan jawaban seketika tanpa scraping internet.
- **Klasifikasi Umur Pengetahuan Cerdas (Tiered Dynamic TTL)**:
  - Mengeliminasi risiko data basi (*stale data*) dengan membagi masa berlaku pengetahuan secara dinamis:
    1. **Real-time (Cuaca, Kurs, Harga Emas, Skor Bola, Gempa)**: TTL 2 jam (7.200 detik). Otomatis di-refresh jika sudah kedaluwarsa.
    2. **News / Breaking Events (Politik, Hukum, Viral, Menteri, Pemilu)**: TTL 12 jam (43.200 detik).
    3. **Tech & Product Releases (Xiaomi, iPhone, Samsung, DeepSeek, Claude, Qwen, Spesifikasi Hardware)**: TTL 21 hari (1.814.400 detik).
    4. **Fakta Statis / Ilmiah / Sejarah**: TTL 90 hari (7.776.000 detik).
- **Pencocokan Entitas Normalisasi & Token Overlap (`normalizeEntityKey`, `getKnowledge`)**:
  - Menyaring stopwords dan filler kata tanya secara presisi sehingga pertanyaan seperti *"Kapan rilis Xiaomi 15 di Indonesia?"* dan *"info rilis xiaomi 15 dong kak"* dipetakan ke entitas kunci yang sama (`xiaomi_15`).
  - Mendukung pencocokan prefix dan token overlap sehingga pencarian pengetahuan berjalan cepat dan akurat.
- **Integrasi Seamless Tanpa Regresi (`src/web.ts`)**:
  - Diintegrasikan langsung di dalam `searchWeb(query)` sebelum live scraper dijalankan.
  - Handler WhatsApp Cloud, WhatsApp Baileys, dan Telegram otomatis menikmati fitur ini tanpa perubahan struktur kode di lapisan controller.
  - Penulisan ke `web_knowledge` berjalan asinkron non-blocking (*fire-and-forget*), menjamin tidak ada latensi tambahan pada interaksi pengguna.

### v0.25.2 - 2026-09-11 23:55 WIB
**Autonomous Latency Optimization, Fast-Path In-Memory Context Cache & Non-Blocking Asynchronous Persistence**
- **Eliminasi Latensi Web Search Agresif pada Percakapan Umum (`src/web.ts`)**:
  - Mengatasi akar masalah utama respons lambat (*slow response* 8 hingga 12 detik): sebelumnya modul `needsSearch` mengeksekusi penelusuran web Bing, Google News RSS, Hugging Face, Wikipedia, serta deep-scraping 3 URL eksternal untuk hampir setiap pesan santai (seperti sapaan, curhat, "aku laper", "tugas akhir", rekomendasi makanan/film, dan koding dasar).
  - Mengintegrasikan *Smart Intent Classifier*: obrolan santai, tugas kuliah/jurnal umum, curhat, dan pertanyaan logika langsung diproses lewat jalur ekspres (*fast-pass* ~0.01ms) tanpa penelusuran web eksternal, memangkas latensi hingga 7-10 detik.
  - Penelusuran web dipertahankan 100% aktif dan akurat untuk kueri berita terkini, nama model AI (DeepSeek, Claude, Qwen, Gemini, GPT), gawai (Xiaomi, iPhone, Samsung), harga/kurs/cuaca, dan tautan URL.
  - Memangkas timeout `searchWeb()` dari 6500ms menjadi 3200ms dan membatasi deep-scraping halaman hanya jika kueri memuat tautan eksplisit atau snippet minim.
- **In-Memory Fast-Path Context Cache (`src/memory.ts`)**:
  - Mengurangi beban 3 query database Supabase paralel berulang setiap ada pesan masuk pada sesi percakapan aktif dengan in-memory cache TTL 25 detik (`contextCache`).
  - Percakapan berkelanjutan memperoleh riwayat konteks secara instan (0ms) tanpa menunggu roundtrip jaringan REST Supabase (menghemat 300-800ms).
- **Asynchronous Non-Blocking Message Persistence (`src/whatsapp_cloud.ts`, `src/whatsapp_baileys.ts`, `src/telegram.ts`)**:
  - Mengubah penyimpanan pesan pengguna (`saveMessage` peran `user`) dari pola `await` blocking menjadi asinkronus non-blocking berstatus *fire-and-forget* aman (`void saveMessage(...)`), sekaligus memperbarui cache memori aktif secara serentak. Model AI langsung mulai berpikir tanpa terhambat penulisan ke database.
  - Penyimpanan balasan asisten ke database juga dieksekusi secara non-blocking setelah pesan berhasil terkirim ke antarmuka chat pengguna.
- **Penyelarasan Prompt Context & TTFT Acceleration (`src/skills.ts`, `src/env.ts`)**:
  - Memangkas batas potongan hasil penelusuran web pada system prompt dari 8.500 karakter menjadi 3.800 karakter. Mengurangi ukuran prefill token ke model LLM hingga 55%, mempercepat pembentukan token pertama (*Time to First Token / TTFT*).
  - Menyesuaikan batas waktu tunggu header koneksi `CONNECT_TIMEOUT_MS` menjadi 4.500ms agar mekanisme auto-failover antar key/model berjalan 2x lebih responsif jika salah satu gateway mengalami kendala.
- **Integritas Urutan Rolling Model (Zero Alteration)**:
  - Urutan hierarki rolling penggunaan model (`xkiro` -> `groq` -> `gemini` -> `openrouter`) dipertahankan 100% utuh tanpa modifikasi apa pun sesuai syarat mutlak pengguna.

### v0.25.1 - 2026-09-11 23:15 WIB
**Perbaikan Kritis: Cryptographic Stateless HMAC Session Tokens, Cross-Lambda Sync & Anti-Clock-Skew Guard**
- **Akar Masalah Sesi Tertendang Seketika (*Immediate Session Kick-Out*)**:
  - Pengguna memasukkan Master PIN dengan benar dan diarahkan masuk ke dashboard, namun dalam hitungan milidetik langsung tertendang kembali ke modal PIN dengan pesan "Sesi admin 15 menit telah berakhir untuk keamanan".
  - **Penyebab Utama 1 (Cross-Lambda Memory Desync)**: Pada infrastruktur Vercel Serverless, endpoint verifikasi PIN (`/api/admin-otp`) dan endpoint data (`/api/stats` serta `/api/dataset`) dieksekusi pada container Lambda terpisah. Sebelumnya, token disimpan secara lokal di memori serverless jika penulisan Supabase belum tersinkronisasi, sehingga saat dashboard memanggil `/api/stats`, container data menganggap token tidak dikenal dan mengembalikan HTTP 401 Unauthorized yang langsung memicu `triggerSessionExpired()`.
  - **Penyebab Utama 2 (Client-Server Clock Skew)**: Perhitungan hitung mundur kedaluwarsa sesi pada antarmuka pengguna sebelumnya membandingkan timestamp absolut server dengan `Date.now()` browser klien (`remainingMs = exp - Date.now()`). Jika jam perangkat pengguna memiliki selisih waktu mendahului server, `remainingMs` bernilai non-positif sehingga sesi langsung dipaksa kedaluwarsa.
- **Implementasi Token Sesi Kriptografis Stateless HMAC-SHA256 (`src/admin_auth.ts`)**:
  - Merancang sistem token sesi mandiri bertanda tangan kriptografis (`createSessionToken` & `verifySessionToken`) berformat `adm_<payload_base64url>.<signature_hex>`.
  - Kunci tanda tangan HMAC diturunkan secara deterministik dari kombinasi `PIN_SALT` dan `pinHash`.
  - Seluruh container Vercel Serverless (`api/stats.ts`, `api/dataset.ts`, `api/admin-otp.ts`) dapat memverifikasi keabsahan tanda tangan token dan masa berlaku 15 menit secara instan (<0.1 milidetik) tanpa ketergantungan roundtrip database atau shared memory.
  - **Pencabutan Global Instan**: Jika PIN diubah atau direset via OTP, `pinHash` otomatis berganti sehingga seluruh token sesi aktif lama gugur secara universal di semua container tanpa perlu invalidasi manual.
  - Pembersihan pemanggilan rekursif tak sengaja antara `getAuthConfig` dan `saveAuthConfig` untuk menjamin eksekusi fail-safe.
- **Resiliensi Clock Drift & Durasi Relatif Klien (`public/dashboard.html`)**:
  - Mengubah penanganan kedaluwarsa sesi di frontend menjadi berbasis durasi relatif (`duration_ms: 15 menit`) yang dihitung dari jam lokal browser klien saat verifikasi PIN berhasil (`clientExp = Date.now() + duration`).
  - Menambahkan batas toleransi toleransi waktu (*clock drift grace window*) 30 detik pada pemeriksaan token dan hitung mundur `startSessionExpiryCountdown`.
- **Ekspansi Variabel Lingkungan Supabase (`src/env.ts`)**:
  - Menambahkan penanganan `SUPABASE_KEY` dan `NEXT_PUBLIC_SUPABASE_KEY` pada rantai fallback kredensial Supabase.

### v0.25.0 - 2026-09-11 21:35 WIB
**Eliminasi Format Kuliah / Outline Skripsi Tanpa Perintah, Definisi Ensiklopedia & Nada Korporat CS**
- **Larangan Format / Panduan / Outline Dokumen Tanpa Perintah Eksplisit (`src/skills.ts`)**:
  - Mengatasi kendala bot yang tiba-tiba membuatkan panduan lengkap tugas akhir 5 bab (Bab 1 Pendahuluan s/d Bab 5, format font Times New Roman 12, APA/IEEE) ketika pengguna hanya menjawab santai "tugas akhir kuliah".
  - Menegakkan pemisahan tegas: menyebutkan aktivitas atau tugas (sedang ngerjain jurnal, skripsi, tugas akhir, koding) adalah topik obrolan santai biasa (curhat/cerita), BUKAN perintah untuk membuatkan dokumen atau modul akademik.
  - Melarang keras bot mengeluarkan outline skripsi/makalah/jurnal, daftar bab, format font/spasi/margin, atau panduan tugas akhir jika tidak diminta secara eksplisit dengan perintah seperti "buatkan outline", "buatkan draf", atau "tuliskan bab 1".
- **Pelarangan Definisi Ensiklopedia Kata ("X adalah...") & Nada CS Korporat**:
  - Melarang keras bot mengawali jawaban dengan mendefinisikan istilah yang disebut pengguna (contoh: "Tugas akhir kuliah adalah tahap akhir dari studi sarjana..."). Pengguna sudah mengetahui artinya dan ingin mengobrol santai, bukan membaca ensiklopedia.
  - Menghapus pola penawaran bantuan CS berlebihan: "aku bisa bantu dari awal sampai akhir, mulai dari brainstorming ide... Kamu mau mulai dari mana?".
  - Mengembalikan respon ke nada sahabat karib yang santai dan wajar (1-2 kalimat: menanyakan topik atau perkembangan tugas secara santai).
- **Penegakan Larangan Kata Formal "Anda" & Pembersihan Boilerplate CS (`cleanMathAndNoise`)**:
  - Mengharamkan kata formal "Anda" dalam seluruh interaksi, mewajibkan penggunaan sapaan akrab "kamu".
  - Memperluas pembersihan sanitasi output (`cleanMathAndNoise`) untuk menyingkirkan kalimat klise CS otomatis: "Jika Anda membutuhkan bantuan lebih lanjut...", "Ada yang bisa dibantu?", "Ada yang bisa saya bantu?".

### v0.24.9 - 2026-09-11 21:30 WIB
**Comprehensive 514-Regency Indonesia Geo-Mapping, Auto-Location Persistence & Zero-Prompt-Leakage on Non-Time Queries**
- **Pemetaan Komprehensif Seluruh Kabupaten & Kota Indonesia (`src/timezone.ts`)**:
  - Mengatasi kendala kota seperti Cianjur, Garut, Subang, Purwakarta, dll yang sebelumnya belum terdaftar di `LOCATION_MAP` sehingga menyebabkan model AI keliru menebak zona waktu (seperti mengira Cianjur adalah WITA).
  - Mendaftarkan seluruh 38 provinsi di Indonesia beserta ratusan kabupaten/kota lengkap ke dalam zona waktu resmi masing-masing: WIB (Jawa, Sumatera, Kalbar, Kalteng), WITA (Bali, NTB, NTT, Kalsel, Kaltim, Kaltara, Sulawesi), dan WIT (Maluku, Maluku Utara, Papua).
- **Deteksi & Penyimpanan Otomatis Pernyataan Lokasi Teks Pengguna (`detectUserLocationDeclaration`, `src/skills.ts`)**:
  - Mengintegrasikan deteksi otomatis deklarasi lokasi tempat tinggal atau keberadaan pengguna dari pesan teks percakapan (seperti "saya di cianjur", "aku di bali", "lagi di surabaya", atau jawaban kota saat ditanya).
  - Secara otomatis memvalidasi dan menyimpan lokasi tersebut ke tabel Supabase `corrections` dan array `ctx.corrections` secara permanen, sehingga bot mengingat kota pengguna untuk seterusnya tanpa perlu bertanya ulang.
- **Eliminasi Total Kebocoran Waktu & Pertanyaan Kota pada Kueri Non-Waktu (`isAskingTime`, `buildUniversalTimePrompt`)**:
  - Mengatasi bug kritis: sebelumnya prompt aturan waktu disuntikkan secara seragam di setiap giliran chat tanpa memeriksa apakah pengguna bertanya jam, sehingga ketika pengguna sekadar membalas "lg ngerjain jurnal aja di kamar", model malah mengulangi jam dan menanyakan kembali "Kamu lagi di kota mana nih?".
  - Memisahkan secara ketat 3 skenario konteks:
    1. **Kueri Non-Waktu (`!isAskingTime && !userDeclaringLoc`)**: Waktu server disajikan pasif sebagai background temporal grounding, disertai larangan mutlak (*absolute directive*) bagi bot untuk mengawali jawaban dengan jam atau menanyakan kota/lokasi pengguna. Bot fokus 100% pada topik obrolan (misal membahas jurnal).
    2. **Konfirmasi Lokasi (`userDeclaringLoc`)**: Bot mengonfirmasi kota pengguna dengan ramah, menyebutkan waktu di kotanya secara presisi, dan mencatatnya ke memori.
    3. **Pertanyaan Waktu (`isAskingTime`)**: Jika lokasi tersimpan di profil, bot langsung menjawab jam lokasi tersebut tanpa menanyakan lokasi lagi. Jika lokasi belum diketahui, barulah bot menyebutkan rentang waktu 3 zona Indonesia dan menanyakan kotanya secara santai.

### v0.24.8 - 2026-09-11 21:10 WIB
**Native Location Pin Processing, Anti-WIB Default Rule & Persistent Geolocation Profile**
- **Penanganan Pesan Lokasi Asli WhatsApp & Telegram (`src/whatsapp_baileys.ts`, `src/whatsapp_cloud.ts`, `src/telegram.ts`)**:
  - Mengaktifkan penanganan pesan lokasi (`locationMessage` di WhatsApp Baileys, `type === 'location'` di WhatsApp Cloud API, dan `msg.location` di Telegram Bot API).
  - Ketika pengguna membagikan pin lokasi (*Share Location / Live Location*), bot membaca koordinat GPS (`latitude` & `longitude`), menentukan zona waktu via `resolveTimezoneFromCoords()`, dan menyimpannya secara persisten ke tabel Supabase `corrections`.
- **Eliminasi Asumsi Tunggal WIB (Anti-WIB Defaulting Rule)**:
  - Melarang keras bot mengasumsikan atau hanya menjawab waktu WIB ketika lokasi pengguna belum diketahui pada nomor Indonesia (+62).
  - Sistem secara otomatis menyajikan ketiga zona waktu Indonesia sekaligus (WIB, WITA, WIT) secara ramah dan ringkas, sembari menawarkan pengguna untuk menyebutkan kota atau membagikan pin lokasi agar bot dapat mengingatnya secara permanen.
- **Integrasi Memori Profil Lokasi Berkelanjutan (`src/skills.ts`)**:
  - Menghubungkan seluruh memori profil pengguna (`corrections`, `summary`, dan riwayat pesan) ke dalam parser waktu. Jika pengguna pernah menyebutkan kotanya atau pernah mengirim lokasi, bot secara otomatis mengingat dan mengunci waktu lokal pengguna pada setiap interaksi berikutnya.

### v0.24.7 - 2026-09-11 21:05 WIB
**Universal Dynamic Global Timezone Engine, Phone Country Auto-Detection & Multi-Continent Real-Time Clock**
- **Mesin Zona Waktu Global & Universal Real-Time Clock (`src/timezone.ts`)**:
  - Mengatasi keterbatasan zona waktu tunggal (WIB): mengintegrasikan mesin zona waktu global berbasis API native `Intl.DateTimeFormat` yang mendukung seluruh 418 zona waktu IANA dunia secara presisi tanpa ketergantungan paket eksternal.
  - **Waktu Universal Standar (UTC/GMT)**: Menyediakan basis waktu universal koordinat global sebagai acuan matematis ground truth.
  - **Matriks 3 Zona Waktu Indonesia Lengkap**: Menyajikan waktu presisi serentak untuk WIB (UTC+7 / Asia/Jakarta), WITA (UTC+8 / Asia/Makassar - Bali, NTB, NTT, Kalimantan Timur/Selatan/Utara, Sulawesi), dan WIT (UTC+9 / Asia/Jayapura - Papua, Maluku).
- **Deteksi Otomatis Negara Asal dari Nomor Telepon Pengguna (`detectUserCountry`)**:
  - Menganalisis prefiks kode panggilan negara internasional (E.164) pada akun WhatsApp (`chatKey` / `chatId`).
  - Secara otomatis mengenali pengguna luar negeri (seperti +1 AS/Kanada, +44 Inggris, +49 Jerman, +33 Prancis, +81 Jepang, +82 Korea, +60 Malaysia, +65 Singapura, +61 Australia, +966 Arab Saudi, +971 UAE, dll) dan menyajikan waktu lokal negara tempat pengguna berada secara otomatis saat mereka bertanya jam tanpa harus menyebutkan negaranya.
- **Deteksi Entitas Kota, Daerah & Wilayah Dinamis (`detectLocation`)**:
  - Memetakan ratusan nama kota, provinsi, dan daerah di Indonesia (Bali, Denpasar, Lombok, Kupang, Makassar, Manado, Samarinda, Balikpapan, Jayapura, Merauke, Ambon, Surabaya, Medan, dll) serta kota-kota metropolitan dunia (Tokyo, London, Paris, Berlin, New York, Los Angeles, Chicago, Sydney, Perth, Mekkah, Dubai, dll).
  - Jika pengguna menyebutkan atau menanyakan jam di kota tertentu ("jam berapa di Bali?", "kalo di Tokyo jam berapa?", "sekarang jam berapa di London?"), sistem secara otomatis menghitung waktu presisi di lokasi target tersebut.
- **Pengalihan Cerdas Kueri Jam di Web Search (`src/web.ts`)**:
  - Memperbarui filter `needsSearch`: kueri yang menanyakan jam/waktu saat ini di kota atau daerah manapun dialihkan langsung ke mesin jam internal presisi berkecepatan 0ms, mencegah ketergantungan pada potongan hasil web search yang lambat atau usang.
- **Penyelarasan System Prompt & Multi-Turn Memory (`src/skills.ts`, `src/memory.ts`)**:
  - Menyematkan field `chatId` ke dalam interface `ChatContext` Supabase memory agar identitas nomor pengguna selalu tersedia di seluruh saluran.
  - Menghubungkan teks pesan pengguna (`userPrompt`) ke dalam generator prompt sistem sehingga deteksi lokasi langsung aktif pada giliran pesan pertama.

### v0.24.6 - 2026-09-11 20:55 WIB
**Universal Real-Time Search Engine, Bing Redirect Decoders, Dual News RSS, Hugging Face AI Catalog, Anaphora Context Resolution & Anti-Refusal Tuning**
- **Universal Multi-Engine Web Scraping & Bing Base64 Redirect Decoding (`src/web.ts`)**:
  - Mengatasi kendala URL hasil penelusuran Bing yang berupa tautan redirect terenkripsi (`https://www.bing.com/ck/a?...&u=a1<base64>&ntb=1`). Mengintegrasikan `decodeBingUrl()` untuk mengekstrak URL artikel tujuan asli secara presisi sehingga scraper dapat mengunduh isi halaman lengkap dari portal berita atau situs produsen.
  - Memperbaiki parameter kueri Bing: menghapus parameter `&sortby=Date` yang sebelumnya merusak relevansi dan hanya memunculkan halaman kosong atau portal acak, mengembalikan akurasi penelusuran tingkat tinggi.
- **Pembersihan Noise Percakapan & Normalisasi Entitas Universal (`extractCoreEntity`, `formulateSmartSearchQueries`)**:
  - Mengeliminasi kata pengantar percakapan kasual yang sering mengaburkan kueri pencarian (seperti "coba sekarang saya nanya", "coba deh ganti topik", "kalo hp", "yg kamu tahu", "kamu kenal").
  - Menangani resolusi anafora (pertanyaan bertumpuk / referensi percakapan sebelumnya seperti "kalo calude", "kalo deepseek", "kalo dia") dengan memanfaatkan riwayat 3 pesan terakhir dari konteks percakapan.
  - Memperbaiki typo umum nama model dan produk (misal "calude" -> "claude", "deepsik" -> "deepseek", "xiomi" -> "xiaomi") serta konversi istilah gawai ("hp <brand>" -> "<brand> smartphone") guna menjamin hasil penelusuran akurat.
- **Dual Google News RSS Feed (Indonesia & Global English)**:
  - Mengintegrasikan dua feed Google News RSS secara serentak (`hl=id-ID&gl=ID&ceid=ID:id` untuk berita nasional berbahasa Indonesia dan `hl=en-US&gl=US&ceid=US:en` untuk rilis global terkini) dengan parser XML toleran CDATA.
- **Integrasi Langsung Hugging Face Model Hub API**:
  - Menghubungkan endpoint resmi Hugging Face API (`https://huggingface.co/api/models?author=...&sort=lastModified&direction=-1&limit=5`) untuk organisasi model AI terkemuka (DeepSeek, Qwen, Mistral AI, Meta Llama) guna memperoleh nama model, versi rilis, dan tanggal modifikasi terkini dalam hitungan milidetik tanpa risiko halusinasi.
- **Penjelajahan Halaman Rilis & Berita Produsen Global**:
  - Menyediakan fallback penjelajahan langsung ke portal berita dan rilis resmi (Anthropic, OpenAI, Xiaomi Indonesia/Global, Samsung Newsroom, Apple Newsroom) dengan buffer hingga 4.500 karakter.
- **Injeksi Waktu Real-Time WIB Presisi (`src/skills.ts`)**:
  - Menambahkan fungsi `currentDateTimeStr()` pada system prompt yang menyuntikkan waktu WIB (Waktu Indonesia Barat / Asia/Jakarta), jam, menit, detik, hari, tanggal, dan UTC secara presisi ke dalam memori dasar model AI. Bot tidak akan lagi menolak pertanyaan seputar waktu atau jam lokal.
- **Pengerasan Instruksi Anti-Penolakan & Anti-Disclaimer (Anti-Refusal Directives)**:
  - Menetapkan larangan mutlak bagi model AI untuk mengeluarkan disclaimer pasif seperti "belum ada info resmi", "tidak mau ngarang", "batas pengetahuan training", atau "sering ketinggalan zaman" ketika data internet dan waktu riil telah disediakan.
  - Mengharuskan bot menyebutkan nama model atau produk terbaru secara tegas dan percaya diri.
  - Penegakan larangan tanda pisah em-dash (`—`) pada seluruh lapisan sanitasi teks keluaran asisten.
- **Integrasi Riwayat Konteks pada Seluruh Saluran Komunikasi**:
  - Mengalirkan riwayat percakapan sebelumnya (`prevContext`) ke dalam fungsi `searchWeb` pada Meta WhatsApp Cloud API (`src/whatsapp_cloud.ts`), WhatsApp Baileys Multi-Device (`src/whatsapp_baileys.ts`), dan Telegram Bot API (`src/telegram.ts`) untuk pesan teks maupun rekaman suara (Voice Note).

### v0.24.4 — 2026-09-11 17:55 WIB
**Dynamic MRU Recency Shift for AI Model Matrix Cards (No Fixed Dropdown Fallback)**
- **Mekanisme Pergeseran Kartu Berbasis Riwayat Inferensi Terkini (*Most Recently Used / MRU*) (`public/dashboard.html`)**:
  - Mengatasi kendala pengurutan kartu: sebelumnya saat ada model baru yang aktif menjadi #1, model yang sebelumnya menempati #1 langsung terlempar kembali ke posisi statis tetap di bawah (misal ke slot #10), sementara model yang belum pernah dipakai (0x eksekusi) berada di posisi atasnya (#2, #3).
  - Mengimplementasikan stack MRU dinamis: ketika model baru aktif melayani inferensi, ia langsung menempati posisi **#1** (`AKTIF TERBARU`), sedangkan model yang sebelumnya menempati #1 bergeser secara alami menjadi **#2**, model #2 sebelumnya bergeser menjadi **#3**, dan seterusnya.
  - Model yang belum pernah dieksekusi (0x calls) tetap tersusun rapi di bagian bawah daftar sesuai urutan prioritas bawaan katalog.
- **Backend Chronological Model Sequence Tracking (`api/stats.ts`)**:
  - Menyaring urutan unik model yang melayani percakapan asisten dari `messages` terurut menurun (`order('id', { ascending: false })`).
  - Mengirimkan array `recentModels` pada respons API serverless sehingga frontend selalu memiliki urutan kronologis inferensi nyata dari basis data Supabase lintas sesi dan refresh.

### v0.24.3 — 2026-09-11 17:45 WIB
**Strict Vision Grounding, Anti-Overreact Engine & Peripheral Distraction Elimination**
- **Eliminasi Respons Over-React & Basa-Basi Klise (`src/skills.ts`)**:
  - Mengatasi kendala model multimodal yang merespons foto secara berlebihan (*over-reacting*), seperti pujian hiperbolis ("Wah, ini kokpitnya ya? Rapi banget..."), tebakan periferal fisik di luar layar (mengomentari merek laptop ASUS, lampu RGB menyala-nyala, keyboard), serta pertanyaan retoris tak bermutu di akhir ("Gimana, performanya nge-lag gak di situ?").
  - Menegakkan prinsip *Anti-Distraksi Hardware/Periferal*: model AI diwajibkan memfokuskan analisis HANYA pada subjek utama/isi konten layar yang diperlihatkan pengguna, serta dilarang keras mengomentari perangkat keras fisik di luar layar kecuali ditanyakan secara spesifik.
- **Strict Grounding & Presisi OCR Metrik Dashboard (`src/skills.ts`)**:
  - Mengatasi halusinasi pertukaran angka antar kartu/provider (sebelumnya model menukar metrik 93 calls milik Groq dengan Gemini 7 calls).
  - Menyuntikkan direktif OCR ketat pada `describeImage` dan `systemPrompt` (Bagian 5): model diwajibkan membaca teks dan kartu metrik secara teliti per kolom dari kiri ke kanan, memetakan setiap angka tepat ke judul provider masing-masing, serta dilarang menebak atau menukar nilai.
  - Membatasi panjang respon visual menjadi proporsional, santai, tenang, dan to-the-point (1-2 kalimat padat atau butir poin terstruktur).

### v0.24.2 — 2026-09-11 17:35 WIB
**Fine-Tuned 4-Tier Vision Failover Sequence, MistralAI Restoration & Standard CSS background-clip Compliance**
- **Penataan Ulang 4-Tier Rantai Prioritas Vision (`src/providers.ts`)**:
  - Menyusun urutan prioritas eksekusi model penglihatan (*vision*) sesuai permintaan pengguna:
    1. **Tier 1 (Utama)**: `xkiro` (model `qwen/qwen3.8-max:free`, `qwen/qwen3.6-plus:free`, `qwen/qwen3-vl-plus:free`, dan `mistralai/mistral-large-2512`).
    2. **Tier 2**: `groq` (model `qwen/qwen3.8-27b`, `qwen/qwen3.6-27b`).
    3. **Tier 3**: `gemini` (`gemini-3.8-flash`, `gemini-2.5-flash`).
    4. **Tier 4 (Fallback Akhir)**: `openrouter` (`nex-agi/nex-n2.5:free`, `nex-agi/nex-n2.5-mini:free`).
- **Restorasi Model Mistral Large di xKiro (`src/providers.ts`)**:
  - Mengembalikan `mistralai/mistral-large-2512` ke dalam daftar `visionModels` pada provider xKiro.
- **Kepatuhan Standar CSS W3C & Cross-Browser Styling (`public/index.html`)**:
  - Menambahkan deklarasi properti standar `background-clip: text` berdampingan dengan `-webkit-background-clip: text` pada elemen `.hero-title` di Landing Page untuk memastikan kompatibilitas penuh lintas peramban modern (Firefox, Chrome, Safari, Edge) dan membersihkan peringatan CSS linter.

### v0.24.1 — 2026-09-11 17:30 WIB
**Qwen xKiro Primary Vision Prioritization, WhatsApp 1,000 Monthly Sessions Tracker & Flush-Top Compact Navbar**
- **Prioritas Utama Model Vision Qwen xKiro (`src/providers.ts`)**:
  - Mengubah urutan prioritas pemrosesan foto/gambar (*vision modality*): menempatkan xKiro (model `qwen/qwen3.8-max:free`, `qwen/qwen3.6-plus:free`, `qwen/qwen3-vl-plus:free`) sebagai prioritas nomor 1 (`priority: 1`).
  - Menempatkan OpenRouter Vision sebagai cadangan (`priority: 2`) dan Google Gemini sebagai fallback terakhir (`priority: 3`), sehingga Gemini hanya digunakan jika xKiro dan OpenRouter tidak merespons.
- **Monitoring Kuota Sesi Bulanan WhatsApp Meta Cloud API (`api/stats.ts`, `public/dashboard.html`)**:
  - Menghitung jumlah sesi percakapan WhatsApp bulan ini berbasis jendela waktu 24 jam per nomor pengguna (*Service Conversations*).
  - Edukasi Kuota Meta 1.000 Sesi/Bulan: Jendela 24 jam dihitung sejak pesan pertama pengguna; interaksi chat bolak-balik tanpa batas selama 24 jam tersebut hanya dihitung 1 sesi tunggal ($0 free-tier).
  - Menyematkan kartu metrik *Sesi WhatsApp (Meta Cloud)* pada ribbon monitoring dashboard (`used / 1.000 limit`, sisa kuota sesi gratis bulan ini, dan status Free Tier).
- **Redesain Navbar Dashboard: Rapat ke Atas & Lebih Ramping (`public/dashboard.html`)**:
  - Menghilangkan celah melayang: navbar kini rapat menempel persis ke batas atas peramban (`top: 0`, `margin: 0 -1.5rem 1.25rem -1.5rem`, `border-radius: 0`, `border-bottom: 1px solid var(--border-subtle)`).
  - Desain lebih ramping dan proporsional: ukuran icon dikecilkan dari 44px menjadi 32px, tipografi disederhanakan, dan padding tombol header diperkecil agar tidak memakan ruang vertikal layar.

### v0.24.0 — 2026-09-11 17:20 WIB
**Strict Admin Session Isolation, Zero Tab Persistence & 15-Minute Auto-Lock Timeout**
- **Isolasi Sesi Per Tab (Zero Persistent Storage)**:
  - Mengeliminasi penyimpanan token sesi admin di `localStorage`, beralih murni menggunakan `sessionStorage`.
  - Sesi otomatis hancur seketika saat tab atau peramban ditutup; membuka kembali tab admin wajib memasukkan Master PIN dari awal.
- **Pembersihan Otomatis Saat Navigasi ke Beranda (Leave-to-Home)**:
  - Menyematkan handler `leaveToHome(event)` pada tombol `← Beranda` di modal login dan navbar header dashboard yang membersihkan seluruh sisa token sebelum beralih ke halaman utama.
  - Memasang skrip pembersih sesi di `<head>` landing page (`public/index.html`) guna menjamin setiap kali pengunjung kembali ke landing page, sesi admin dimusnahkan secara menyeluruh.
- **Batas Waktu Sesi 15 Menit Ketat (15-Minute Auto-Lock)**:
  - Backend (`src/admin_auth.ts`): Memperketat masa berlaku token sesi dari 24 jam menjadi 15 menit (`now + 15 * 60 * 1000`) dan menyertakan timestamp `expires_at` pada respons autentikasi `api/admin-otp.ts`.
  - Frontend (`public/dashboard.html`): Mengimplementasikan countdown timer dinamis (`startSessionExpiryCountdown`). Ketika durasi 15 menit tercapai, sistem secara otomatis mengunci tampilan dashboard (`triggerSessionExpired`), menghancurkan token, dan memunculkan modal PIN dengan notifikasi bahwa sesi telah berakhir untuk keamanan.
  - Penanganan Terpadu Status HTTP 401: Pemanggilan `fetchData` atau `fetchDataset` yang menemui token kedaluwarsa langsung memicu penguncian layar otomatis.

### v0.23.9 — 2026-09-11 17:05 WIB
**Refined 5-Column Ledger & Universal Quota Aggregation Across All Providers**
- **Pemangkasan Kolom Tabel Kuota Upstream (`public/dashboard.html`)**:
  - Menghapus kolom *Model Utama & Tier* serta kolom *Batas Upstream Resmi* yang redundan/tidak diperlukan sesuai permintaan pengguna.
  - Memfokuskan tabel ke dalam 5 kolom esensial:
    1. *Provider & Kunci API* (Masked Key).
    2. *Akun Terdaftar* (Nama & Email Akun).
    3. *Penggunaan Hari Ini* (Token terpakai global, persentase, dan bar progress visual).
    4. *Sisa Kuota Hari Ini* (Sisa token riil berwarna hijau emerald tebal).
    5. *Status Validasi* (Badge sinkronisasi & health check).
- **Agregasi Metrik Universal pada Ribbon Ringkasan**:
  - Menghitung total limit kuota harian secara universal dari seluruh provider (xKiro, Groq, dll), bukan hanya terbatas pada xKiro.
  - Menghitung total sisa kuota bersih universal gabungan dari seluruh kunci API aktif.
  - Menampilkan total kunci dan pool terhubung secara global di 4 provider AI.

### v0.23.8 — 2026-09-11 16:49 WIB
**Smart Sticky Navbar with Smooth Scroll Reveal & Dynamic Glassmorphism**
- **Navigasi Sticky Dinamis & Auto-Hide/Reveal (`public/dashboard.html`)**:
  - Mengubah navbar `<header>` menjadi `position: sticky; top: 1rem; z-index: 1000;` dengan efek glassmorphism blur (`backdrop-filter: blur(16px)`).
  - Mengimplementasikan pengontrol scroll interaktif berbasis `requestAnimationFrame`:
    - **Scroll ke Bawah (Scroll Down)**: Navbar otomatis meluncur naik dan tersembunyi halus (`transform: translateY(calc(-100% - 2.5rem)); opacity: 0;`).
    - **Scroll ke Atas (Scroll Up)**: Navbar otomatis meluncur turun kembali ke pandangan pengguna (`transform: translateY(0); opacity: 1;`).
    - **Puncak Halaman (Scroll Top <= 30px)**: Kembali ke styling natural awal tanpa bayangan berlebih.
  - Memanfaatkan kurva easing organik (`cubic-bezier(0.16, 1, 0.3, 1)`) dan mendukung preferensi aksesibilitas `prefers-reduced-motion`.

### v0.23.7 — 2026-09-11 16:47 WIB
**Dedicated Live Upstream Quota & Token Table Card (UI/UX Refactoring & Zero Clutter)**
- **Penyempurnaan Tampilan Kartu Pool API Key (`public/dashboard.html`)**:
  - Mengembalikan tata letak baris kunci (`.key-row`) di dalam kartu provider menjadi bersih, rapi, dan proporsional tanpa teks bertumpuk atau wrap yang terpotong.
  - Menghilangkan badge dan kotak rincian token yang sebelumnya memadati baris kunci sempit di kartu pool.
- **Card Tabel Terpisah Khusus Monitoring Kuota & Sisa Token Upstream (`#live-upstream-section`)**:
  - Membangun komponen card tabel mandiri baru yang mewah dan berkarakter tepat di bawah seksi kartu pool.
  - Dilengkapi *Mini KPI Summary Ribbon* di bagian atas: Total Limit Kuota Upstream (10M Token), Token Terpakai Hari Ini, Sisa Kuota Bersih xKiro (99.7% Tersedia), dan Status Kunci OpenRouter.
  - Menampilkan tabel rincian horizontal lapang 7 kolom: Provider & Kunci Masked, Akun/Email Terdaftar, Model Utama & Tier, Batas Upstream Resmi, Penggunaan Global Hari Ini (dengan visual bar progress), Sisa Kuota Riil Upstream (font mono tebal hijau emerald), serta Status Validasi Live Synced.
  - Mengintegrasikan seluruh kunci provider (xKiro, OpenRouter, Groq, Gemini) ke dalam satu ledger terpusat yang mudah dibaca.

### v0.23.6 — 2026-09-11 16:38 WIB
**Live Remote Quota Sync (Real-Time Upstream Platform Token Tracking for xKiro & OpenRouter)**
- **Integrasi Sinkronisasi Langsung dari Server Upstream (`api/stats.ts`)**:
  - Mengatasi kendala penggunaan API key xKiro di luar chatbot (misal di IDE, CLI, atau skrip lain) yang sebelumnya tidak terlacak oleh database lokal bot.
  - Menjalankan kueri paralel zero-latency bersamaan dengan database Supabase ke endpoint resmi xKiro (`GET https://api.xkiro.com/v1/usage`) dan OpenRouter (`GET https://openrouter.ai/api/v1/auth/key`).
  - Menarik data faktual akun:
    - **xKiro**: Mengambil `free_tokens.used_today`, `free_tokens.limit_per_day` (5M/hari), dan `free_tokens.remaining` langsung dari server web xKiro serta profil pengguna pemilik kunci.
    - **OpenRouter**: Mengambil status tier, kredit akumulasi (`usage`), dan sisa limit kunci secara real-time.
- **Antarmuka Observabilitas Live Sync (`public/dashboard.html`)**:
  - Menambahkan badge hijau/cyan `● Live Sync` pada kartu kunci API dan header provider yang berhasil tersinkronisasi.
  - Menampilkan baris metrik riil web per kunci: token terpakai hari ini vs limit harian, serta sisa kuota faktual.
  - Menampilkan badge `● Live API Sync (Global di Semua App & IDE)` pada tabel matriks kuota token provider.
- **Klarifikasi Provider Lain (Groq & Google Gemini)**:
  - Groq dan Google Gemini (Google AI Studio) tidak menyediakan endpoint REST publik untuk pengecekan saldo/kuota via standard API key (Gemini memerlukan OAuth2 GCP IAM, Groq hanya menyertakan rate limit di header respons inferensi).
  - Oleh karena itu, Groq dan Gemini tetap menggunakan pencatatan kuota internal database Supabase (`provider_quota`) yang akurat per panggilan bot.

### v0.23.5 — 2026-09-11 16:22 WIB
**Comprehensive Ground-Zero Deep Audit & System Hardening (Ruflo Swarm Sub-Agents)**
- **Audit Kode & Arsitektur Menyeluruh Multi-Perspektif**:
  - Mengeksekusi inferensi LLM nyata tanpa batasan token via Ruflo Swarm runner (`swarm_runner.cjs`) yang menghubungkan 3 peran spesialis:
    - *Security & RLS Architect* (Backend & Frontend Security Coder + OWASP + Timing-safe checks).
    - *Database Optimizer & Concurrency Specialist* (Lost updates + Serverless lifecycle + Indexes).
    - *Senior Code Reviewer* (Ponytail YAGNI + Karpathy Guidelines + Dead code hunting).
- **Pengamanan Proteksi Data Sesi WhatsApp (`src/whatsapp_session.ts`)**:
  - **Akar Masalah**: Fungsi `clearSessionInSupabase()` sebelumnya menjalankan `delete().neq('filename', '')` yang berisiko menghapus berkas `__admin_auth_config.json` saat sesi Baileys dibersihkan/direset pada mode dual-store.
  - **Solusi**: Menambahkan klausa proteksi eksplisit `.neq('filename', '__admin_auth_config.json')` guna menjamin kredensial Master PIN admin tidak pernah terhapus saat pembersihan sesi WhatsApp.
- **Penyempurnaan Penghitungan Kuota Provider (`src/providers.ts`)**:
  - **Akar Masalah**: Blok catch `chat()` sebelumnya memanggil `keyUsed(step.kind, key)` untuk semua jenis error, memotong kuota harian kunci secara keliru saat terjadi kegagalan jaringan sementara (`ECONNRESET`, timeout) atau HTTP 500 dari upstream provider.
  - **Solusi**: Menjaga integritas kuota dengan hanya memanggil `keyUsed` di blok catch jika error adalah `RATE_LIMITED` (429), mencegah penalti kuota pada kunci yang sebenarnya masih valid.
- **Hardening Keamanan XSS Dashboard Evaluasi (`public/dashboard.html`)**:
  - **Akar Masalah**: Tombol *Copy* pada tabel evaluasi menggunakan event handler inline `onclick="copyPrompt('${escapeJs(p.userPrompt)}')"` yang berisiko jika prompt memuat string khusus atau karakter penutup tag.
  - **Solusi**: Mengganti mekanisme inline string interpolation dengan pencarian berbasis ID yang aman (`copyPromptById(p.id)`), mengambil isi teks prompt langsung dari memori aman JavaScript tanpa injeksi atribut HTML.
- **Routing Pengingat Multi-Platform Telegram & WhatsApp (`api/cron/reminders.ts`)**:
  - **Akar Masalah**: Cron pengingat sebelumnya hanya mengarahkan pengiriman ke `bot.sendMessage(chatId, text)` (Telegram). Jika pengingat dibuat oleh pengguna WhatsApp, pengiriman gagal dengan error Telegram 400 Bad Request.
  - **Solusi**: Mengintegrasikan router cerdas yang mendeteksi nomor/JID WhatsApp dan mengirimkannya via `sendWhatsAppCloudMessageSafe`, serta menggunakan Telegram Bot untuk chatId numerik Telegram.

### v0.23.4 — 2026-09-11 16:00 WIB
**Universal Full-Web Search Engine & Autonomous Deep Webpage Scraper**
- **Penjelajahan Web Universal Bebas Domain (`src/web.ts`)**:
  - **Akar Masalah Sebelumnya**: Mesin penelusuran lama hanya menembak Google News RSS dan Bing News RSS. Akibatnya, kueri mengenai produk, website SaaS, repositori, platform AI, atau tools baru (seperti situs `xkiro`, landing page, docs) menghasilkan 0 artikel berita dan mengembalikan string kosong, sehingga bot beralasan "kurang familiar" atau "belum menemukan referensi".
  - **Bing Universal Web Engine**: Mengintegrasikan scraper live Bing Web Search (`https://www.bing.com/search?q=...`) untuk mengindeks seluruh halaman web di dunia tanpa batas API key atau sensor lokal (kebal blokir Telkomsel/Kominfo yang sebelumnya memblokir DuckDuckGo).
  - **Normalisasi Kueri Bersih**: Mengoptimasi `extractCoreEntity` dan `formulateSmartSearchQueries` untuk membuang filler percakapan Indonesia/Inggris (`apakah`, `tolong carikan`, `web nya`, `pokoknya`, `bisa dipercaya`, dll), menghasilkan kata kunci tajam yang tepat sasaran.
- **Autonomous Deep Web Scraper (`src/web.ts`)**:
  - Jika kueri membahas sebuah situs/platform dan Bing menemukan URL tujuan teratas, atau jika pengguna menyertakan URL eksplisit (`https://...`), scraper secara otonom mendownload isi halaman penuh situs tersebut melalui Jina AI LLM Reader (`https://r.jina.ai/${url}`) atau direct fetch.
  - Teks halaman web nyata (isi fitur, harga, deskripsi, terms, dokumentasi) disuntikkan secara utuh ke prompt bot sebagai `[Isi Lengkap Halaman Web (<host>)]: ...`.
- **Ekspansi Buffer Konteks Fakta Web (`src/skills.ts`)**:
  - Menaikkan kapasitas buffer penyerapan konteks web dari 4.500 karakter menjadi **8.500 karakter** (`web.slice(0, 8500)`) agar AI leluasa membaca dokumentasi dan isi halaman web yang panjang tanpa terpotong.
- **Perluasan Trigger Pencarian Cerdas (`needsSearch`)**:
  - Melonggarkan batasan pencarian agar seluruh pertanyaan tentang fakta, entitas, website, link, atau produk otomatis mengaktifkan web search, hanya mengecualikan sapaan murni, identitas bot, waktu lokal, dan aritmatika sederhana.
- **Pembaruan Dashboard Observabilitas (`public/dashboard.html`)**:
  - Menghapus teks `(Qwen 3.8)` pada pill filter xKiro menjadi `xKiro` murni.
  - Menambahkan opsi model `xKiro` pada dropdown filter evaluasi dataset AI.

### v0.23.3 — 2026-09-11 15:48 WIB
**Pengangkatan Penuh Provider Ollama, Perbaikan Tombol Paginasi Next, & Pelacakan Konsumsi Token per Chat di Dataset**
- **Penghapusan Total Integrasi & API Key Ollama**:
  - **Backend Runtime (`src/env.ts`, `src/quota.ts`, `src/providers.ts`, `api/stats.ts`)**: Menghapus definisi `ollama` dari `pools`, `models`, `dailyCap`, `ProviderKind`, rantai failover `steps()`, dan pemetaan prioritas. Seluruh fungsi pembantu `ollamaChat()` diangkat total.
  - **Environment Configuration (`.env`, `.env.example`)**: Menghapus variabel `OLLAMA_KEYS`, `OLLAMA_MODEL_PRIMARY`, `OLLAMA_MODEL_BACKUP`, dan `DAILY_CAP_OLLAMA`.
  - **Frontend UI & Katalog (`public/dashboard.html`, `public/index.html`, `README.md`)**: Menghapus tombol filter Ollama, pilihan dataset select, styling CSS `.tag-ollama`, teks siklus reset, kartu model Ollama (`Nemotron 3 Nano`, `GPT-OSS 20B`), serta merapikan narasi failover 4 provider (xKiro, Groq, Gemini, OpenRouter).
- **Perbaikan Tombol Paginasi "Next" (`public/dashboard.html`)**:
  - **Akar Masalah**: Terdapat kesalahan kutip pada atribut template literal `<button class="pagination-btn ${nextDisabled} onclick="...">` di mana tanda kutip penutup `class` hilang. Hal ini menyebabkan browser menganggap string `onclick="goToDatasetPage(...)"` sebagai bagian dari nilai atribut `class`, sehingga event handler klik tidak pernah terdaftar pada DOM.
  - **Solusi**: Mengisolasi atribut `class="pagination-btn"`, mendefinisikan flag disabled HTML native secara terpisah (`${nextDisabledAttr}`), dan memastikan `onclick` terikat valid saat tombol aktif.
- **Pelacakan Konsumsi Token Context & Total per Chat (`api/dataset.ts`, `public/dashboard.html`)**:
  - Menambahkan kolom baru **Konsumsi Token** pada tabel evaluasi percakapan (`#dataset-tbody`).
  - Menghitung secara presisi per interaksi chat:
    - **Total Token**: Akumulasi token input context + token balasan bot.
    - **Context Tokens (`Ctx`)**: Estimasi jendela konteks yang disuntikkan (System Prompt dasar ~650 token + Prompt pengguna).
    - **Output Tokens (`Out`)**: Estimasi token generasi balasan AI.
  - Memperbarui skema ekspor dataset (`api/dataset.ts`) baik CSV (kolom `Context_Tokens`, `Output_Tokens`, `Total_Tokens`) maupun JSONL (`metadata.context_tokens`, `metadata.output_tokens`, `metadata.total_tokens`).
- **Penyederhanaan Label Filter Provider & Penambahan Opsi xKiro (`public/dashboard.html`)**:
  - Mengubah teks tombol pill filter provider dari `xKiro (Qwen 3.8)` menjadi `xKiro`.
  - Menambahkan opsi filter model `xKiro` pada dropdown dataset evaluasi (`#dataset-model-filter`) dengan label ringkas `xKiro`.

### v0.23.2 — 2026-09-11 15:35 WIB
**Restrukturisasi UI Observabilitas: Pemisahan Tabel Matriks Kuota Token & Perampingan Kartu Rotasi Kunci Provider**
- **Pemisahan Matriks Token & Konteks dari Kartu Kunci (`public/dashboard.html`)**:
  - Menjawab umpan balik tata letak: Menghilangkan sub-box ganda yang berdesakan di dalam kartu baris API key sempit.
  - Mengembalikan baris kartu kunci API (`#pool-grid`) ke format minimalis, lega, dan elegan (sufiks kunci, badge status optimal/waspada/capped, total calls, dan progress bar mulus).
  - Membangun **Panel Tabel Khusus "Matriks Kuota Token & Siklus Limit Provider"** (`#token-matrix-section`) terpisah di bawah pool key, menyajikan perbandingan komprehensif tingkat provider secara horizontal dan luas tanpa berdesakan.
- **Validasi Empiris & Penyelarasan Faktual Batasan Kuota Provider**:
  - **xKiro Gateway**: 5.000.000 Token/hari per key (Daily Token Cap), 1M Context Window, reset harian 00:00 UTC.
  - **Groq Cloud API**: 200.000 Token/hari (200K TPD untuk model teks seperti Qwen 3.8 / GPT-OSS) & 1.000 RPD, Whisper 2.000 RPD, 131K Context Window, reset harian 00:00 UTC.
  - **Google Gemini (Google AI Studio Free Tier)**: Bebas kuota token harian mutlak! Pembatasan murni berdasarkan **Permintaan (1.500 RPD Flash/Flash-Lite)**, 1M TPM, dan 1M Context Window, reset harian 00:00 Pacific Time.
  - **OpenRouter AI Pool**: Bebas kuota token harian mutlak untuk model free! Dibatasi murni **50 RPD (Free Baru) / 1.000 RPD (Deposit $10)** dan 20 RPM, 131K Context Window, reset harian 00:00 UTC.
  - **Ollama Cloud**: Terbukti empiris menggunakan **Siklus Reset Bulanan (Monthly Included Usage Credits)**, bukan reset harian.
- **Pembaruan Default Runtime (`src/env.ts`, `api/stats.ts`)**:
  - Menyelaraskan nilai default `dailyCap` dengan angka RPD aktual: Groq (1.000 RPD), Gemini (1.500 RPD), OpenRouter (50 RPD).

### v0.23.1 — 2026-09-11 15:25 WIB
**Observabilitas Lanjut: Monitoring Dual-Metric (Token per Chat & Token per Context Window) pada Seluruh API Key Provider**
- **Dual-Metric Key Tracking (`api/stats.ts`, `public/dashboard.html`)**:
  - Menerapkan pelacakan dua dimensi metrik kuota untuk **seluruh API Key** di seluruh provider (xKiro Gateway, Groq Cloud, Google Gemini, OpenRouter, dan Ollama Cloud).
  - **Dimensi 1: Panggilan Chat (Requests/Calls)**: Menghitung total panggilan API yang dieksekusi vs batas chat harian (cap) per key, persentase keterpakaian, sisa kuota chat, dan progress bar status (`Optimal`, `Waspada`, atau `Limit Habis`).
  - **Dimensi 2: Konsumsi Token vs Kuota Harian**: Mengestimasi akumulasi token yang terpakai hari ini (berdasarkan rerata percakapan ~380 token/chat dengan riwayat konteks) vs batas token harian per key (misal 5.000.000 token/hari di xKiro, 1.000.000 di Gemini, 500.000 di Groq, 250.000 di OpenRouter, 200.000 di Ollama). Dilengkapi indikator progress bar bergradien cyan.
  - **Dimensi 3: Token Context Window (Token per Context)**: Menampilkan kapasitas jendela konteks maksimal per model (1M context untuk xKiro Qwen 3.8 & Gemini, 131K context untuk Groq & OpenRouter, 32K context untuk Ollama) pada tag kartu kunci maupun badge header provider.
- **Pembaruan Ringkasan Eksekutif & Provider Header**:
  - Kartu KPI *Panggilan API* di bagian atas dashboard kini menampilkan metrik ganda: jumlah panggilan dan estimasi total token (`~X Token • N Keys Terpantau`).
  - Header setiap kartu provider menyajikan rangkuman total panggilan, total estimasi token terpakai, dan persentase kuota token harian seluruh key gabungan di pool tersebut.

### v0.23.0 — 2026-09-11 15:00 WIB
**Perombakan Arsitektur AI: Integrasi xKiro Qwen 3.8 Max Flagship, 8-Layer Failover Chain & Konsol Matriks Model AI**
- **xKiro Provider Flagship Tier 1 (`src/env.ts`, `src/providers.ts`)**:
  - Mengintegrasikan xKiro API dengan model `qwen/qwen3.8-max:free` sebagai prioritas #1 (1M konteks, frontier reasoning & koding).
  - Menyusun 7 model cadangan internal bertingkat di xKiro: `qwen/qwen3.6-plus:free`, `deepseek/deepseek-v4-pro`, `deepseek/deepseek-v4-flash`, `mistralai/codestral-2508`, `qwen/qwen3-vl-plus:free`, `qwen/qwen3.7-plus:free`, dan `mistralai/mistral-large-2512`.
  - Multi-Key Pooling: Menggabungkan 2 API Key xKiro (`sk-xt-f785...` dan `sk-xt-6c69...`) dengan kuota harian gabungan 10.000.000 token/hari secara 100% gratis.
- **Rantai Failover Router 5-Provider Cascades (`src/providers.ts`)**:
  - Tier 1: xKiro Gateway (8 model, 2 keys) -> Tier 2: Groq Cloud LPU -> Tier 3: Google Gemini -> Tier 4: OpenRouter -> Tier 5: Ollama Cloud.
- **Spesialisasi Multimodal WhatsApp & Telegram Mutakhir (`src/media.ts`, `src/skills.ts`)**:
  - **Audio / Voice Note (VN)**: Ditranskripsi otomatis sub-detik (~500ms) via Groq Whisper (`whisper-large-v3-turbo` dengan auto-fallback ke `whisper-large-v3`).
  - **Foto / Vision / Stiker**: Diproses stabil oleh Google Gemini Vision (`gemini-2.5-flash` / `3.8-flash`) yang mendukung parsing base64 inlineData secara native tanpa risiko error payload.
  - **Dokumen (Word, PDF, CSV, Teks, Kode)**: Teks diekstrak secara cerdas melalui parser internal (`mammoth` dsb) dan diteruskan ke Qwen 3.8 Max yang didukung jendela konteks 1.000.000 token.
- **Konsol Matriks Model AI & Monitoring Inferensi (`public/dashboard.html`)**:
  - Menghadirkan antarmuka Matriks Model AI responsif 4-kolom yang memetakan status kesehatan, tag provider, dan total eksekusi dari 17 model AI di router sistem.
  - Kartu aktif otomatis disorot dengan glowing cyan border (`● AKTIF TERBARU`).
  - Banner Auto Gateway Router (Smart Cascades) menyajikan total resolusi inferensi real-time dengan filter rentang waktu instan (Hari Ini, 7 Hari, 30 Hari, Semua).
- **Logo & Favicon Browser Tab Resmi (`public/favicon.svg`)**:
  - Menyematkan logo favicon neural chip AI berbasis vektor SVG beresolusi tinggi di seluruh halaman web (`index.html`, `dashboard.html`, `privacy.html`) agar logo bot tampil elegan di tab browser desktop maupun mobile.
- **Scrollable Dataset Response Container (`public/dashboard.html`)**:
  - Memasang batasan ketinggian `max-height: 220px` dan `overflow-y: auto` dengan scrollbar ramping bernuansa cyber-cyan pada sel jawaban chatbot (`.dataset-reply`) dan prompt pengguna (`.dataset-prompt`), menjaga tabel tetap proporsional dan mudah digulir saat teks jawaban sangat panjang.
- **Validasi Empiris Status MiniMax xKiro**:
  - Penelusuran langsung melalui pemanggilan API membuktikan bahwa seluruh varian `minimax/*:free` di xKiro saat ini mengalami HTTP 500 (`internal_error`) dari upstream provider, sedangkan varian non-free mewajibkan deposit saldo (HTTP 403).

### v0.22.7 — 2026-09-11 14:21 WIB
**Dokumentasi Publik: Perampingan README.md & Akses Cepat Ramah Pengunjung**
- **Perampingan Berkas README (`README.md`)**:
  - Mengeliminasi dinding teks teoritis dan penjelasan berulang agar pengunjung GitHub dapat memahami kapabilitas bot dalam hitungan detik.
  - Menyajikan seksi Akses Cepat dengan tautan langsung ke Telegram Bot (`@chatkita_bot`), nomor WhatsApp resmi, dan tautan dashboard produksi (`free-chatbot-ai.vercel.app`).
  - Merangkum 5 pilar fitur utama (Multimodal, Failover 4-Provider, Percakapan Alami, Memori Berkelanjutan, dan Panel Dataset AI) secara padat dan lugas.
  - Mempersingkat panduan instalasi lokal dan deployment Vercel menjadi 3 langkah cepat.

### v0.22.6 — 2026-09-11 14:10 WIB
**Sinkronisasi Identitas: Profil Resmi Bot Telegram FreeAiBot (@chatkita_bot) pada Landing Page**
- **Koreksi Tautan & Identitas Telegram (`public/index.html`)**:
  - Mengoreksi tautan tombol CTA Telegram yang sebelumnya keliru mengarah ke `https://t.me/FreeAIBot` menjadi URL resmi `https://t.me/chatkita_bot`.
  - Menyelaraskan teks tampilan tombol menjadi `Mulai Chat di Telegram (@chatkita_bot)` dan title tooltip agar pengguna langsung mengetahui username bot Telegram yang valid.
  - Memastikan konsistensi penulisan nama bot `FreeAiBot` pada judul navigasi, title dokumen, dan footer rilis aplikasi.

### v0.22.5 — 2026-09-11 14:05 WIB
**Optimasi Performa Ekstrem: Paralelisasi Kueri Penuh, Client SWR Caching & Indeks Database PostgreSQL**
- **Paralelisasi & Sampling Terukur (`api/stats.ts`)**:
  - Mengubah rantai query yang sebelumnya berjalan sekuensial (berurutan 4 roundtrip jaringan) menjadi 1 `Promise.all` paralel utuh.
  - Membatasi penarikan pesan untuk kalkulasi model AI (`limit 400`) dan media (`limit 300`) secara selektif, menghilangkan pengunduhan teks penuh ribuan baris tanpa limit yang sebelumnya membuat filter `7d` dan `all` lambat.
  - Menghilangkan query redundan `msgPeriodQuery`, digantikan dengan komputasi agregat instan `waPeriod + telePeriod`.
  - Menambahkan header `Cache-Control: public, s-maxage=10, stale-while-revalidate=30` untuk akselerasi Edge Serverless.
- **Optimasi Kueri Dataset Cerdas (`api/dataset.ts`)**:
  - Mengganti `select('*').limit(3000)` dari awal tabel menjadi penarikan kolom selektif (`id, platform, chat_id, role, content, via, created_at`) terurut menurun (`order('id', { ascending: false })`) dengan limit adaptif (maks. 600 untuk dashboard, 1500 untuk ekspor).
  - Membalik array di memori (*in-memory reverse*) untuk pairing, memangkas durasi pembacaan basis data dari ~3 detik menjadi ~40 milidetik.
- **Client-Side SWR Memory Cache (`public/dashboard.html`)**:
  - Mengintegrasikan `statsCache` dan `datasetCache` berbasis `Map` di peramban. Pergantian filter rentang waktu (`today`, `7d`, `14d`, `30d`, `all`) kini dirender secara instan (**0 milidetik**) dari memori jika pernah dimuat, sementara background fetch memperbarui data di latar belakang.
  - Tombol manual *Segarkan* disetel untuk membypass cache (`force = true`).
- **Skrip Akselerator Indeks Supabase (`sql/migrate_v13_performance_indexes.sql`)**:
  - Menyediakan berkas migrasi SQL yang menambahkan 4 indeks B-tree krusial: `idx_messages_created_at_desc`, `idx_messages_role_created_at`, `idx_messages_platform_created_at`, dan `idx_provider_quota_day_desc` untuk menghapuskan *full table scan* di Supabase.

### v0.22.4 — 2026-09-11 13:50 WIB
**Optimasi Dashboard & Efisiensi Database: Eliminasi Tabel Live Log Redundan & Sistem Pagination 5 Baris**
- **Pelebaran Responsif Kolom Jawaban Chatbot (`public/dashboard.html`)**:
  - Mengeliminasi pembatasan kaku `max-width: 520px` pada sel `.dataset-reply`, menggantinya dengan `max-width: 100%` serta mengalokasikan sisa ruang horizontal tabel secara maksimal untuk kolom *Jawaban Chatbot (Completion)*.
  - Teks jawaban bot kini membentang luas ke kanan memanfaatkan ruang layar yang lega, sehingga baris tabel tidak lagi memanjang ke bawah dan jauh lebih nyaman dipindai.
- **Sistem Penomoran Halaman (Pagination 5 Baris) Dataset Evaluasi (`public/dashboard.html`)**:
  - Membatasi tampilan tabel dataset evaluasi secara presisi menjadi 5 pasangan percakapan per halaman sehingga layout panel tetap rapi dan tidak memanjang ke bawah.
  - Mengintegrasikan kontrol navigasi pagination interaktif (tombol `Prev`, nomor halaman `1`, `2`, `3`, ..., dan `Next`) serta teks indikator jumlah percakapan yang ditampilkan.
  - Menambahkan pembatasan ketinggian maksimum (*max-height: 220px*) dengan scrollbar ramping pada prompt pengguna dan balasan bot agar isi teks yang sangat panjang tetap proporsional tanpa merusak estetika antarmuka.
- **Anti-Flicker / Anti-FOUC Authentication Guard (`public/dashboard.html`)**:
  - Mengatasi kendala modal masukkan PIN yang berkedip (*blink/flicker*) saat halaman dashboard di-refresh oleh pengguna yang telah login.
  - Memasang skrip sinkron fast-path di `<head>` dan menyetel class default `.hidden` pada `#auth-modal` untuk memeriksa ketersediaan session token sebelum peramban merender piksel pertama ke layar.
  - Mengimplementasikan sistem guard level `html` (`authenticated` vs `not-authenticated`) dengan penegakan CSS strict, menjamin modal PIN tidak pernah muncul sekejap pun saat admin me-refresh halaman, serta mencegah kebocoran konten utama bagi pengguna yang belum terotentikasi.
- **Eliminasi Tabel Live Log Redundan (`public/dashboard.html`)**:
  - Menghapus seksi tabel "Aktivitas Percakapan Terbaru (Live Log)" di dashboard monitoring karena redundan dengan tabel "Evaluasi & Dataset Training AI" di atasnya yang sudah memuat pasangan prompt-completion terstruktur secara jauh lebih informatif dan kaya fitur (pencarian, filter platform, rentang waktu, ekspor JSONL/CSV).
  - Menghapus fungsi JavaScript `filterActivityTable()` dan variabel memori `cachedRecentActivity` guna memperkecil ukuran bundle HTML dan merampingkan siklus render UI.
- **Streamlining Endpoint Serverless (`api/stats.ts`)**:
  - Mengeliminasi query `messages.select().limit(50)` dan pemetaan `recentFormatted` pada endpoint `/api/stats`.
  - Menghemat kuota query database Supabase sebanyak 1 pemanggilan per 15 detik auto-refresh dan mempercepat waktu respons payload serverless.

### v0.22.3 — 2026-09-11 13:38 WIB
**Optimasi Respon & Kepadatan Bahasa: Universal Conciseness & Anti-Wall-of-Text Engine**
- **Prinsip Anti-Wall-of-Text Universal (`src/skills.ts`)**:
  - Mengatasi kendala respons bertele-tele dan panjang yang membuat pengguna pusing atau malas membaca di layar ponsel.
  - Standarisasi panjang jawaban secara universal: obrolan santai/sapaan/curhat (1–3 kalimat hangat), tanya jawab/konsultasi/rekomendasi (maksimal 2–3 paragraf pendek atau 1 pengantar ringkas + 2–3 butir poin inti, ~50–120 kata), dan koding/tugas teknis (langsung kode solusi presisi tanpa pengantar teoritis panjang).
  - Melarang daftar poin bertingkat atau penjelasan ensiklopedia yang tidak ditanyakan; langsung menyajikan inti masalah dan 1–2 rekomendasi terbaik.
  - Mempertahankan 100% kepribadian asli bot: tetap menjadi sahabat karib yang hangat, santai, akrab, dan peka rasa.
- **Penyempurnaan Prompt Multimodal Vision & Dokumen**:
  - Instruksi analisis gambar, stiker, dan dokumen PDF disetel agar menghasilkan ringkasan padat dan to-the-point.

### v0.22.2 — 2026-09-11 13:32 WIB
**Fitur & Analitik: Multi-Level Time Range & Section-Specific Filtering System**
- **Filter Rentang Waktu Global (`Hari Ini`, `7 Hari`, `14 Hari`, `30 Hari`, `Semua Waktu`)**:
  - Filter segmented pill terintegrasi di bagian atas dashboard yang mengontrol KPI cards, matriks provider, distribusi model, dan statistik media secara serentak.
  - Perhitungan metrik kuota dan pesan adaptif di backend `api/stats.ts`: menjumlahkan penggunaan `provider_quota` dan riwayat `messages` sesuai periode yang dipilih.
- **Filter Platform Global (`Semua`, `WhatsApp`, `Telegram`)**:
  - Memungkinkan admin mengisolasi performa pesan, model AI, dan kuota untuk platform tertentu secara instan.
- **Filter Matriks Pool API Key (`api/stats.ts`, `public/dashboard.html`)**:
  - Filter Provider per tab: `Semua Provider`, `Groq`, `Google Gemini`, `OpenRouter`, `Ollama Cloud`.
  - Filter Status Key: `Semua Status`, `Sehat (<80%)`, `Waspada (>=80%)`, `Limit Habis (Capped)`.
- **Filter Dataset Evaluasi & Training AI (`api/dataset.ts`, `public/dashboard.html`)**:
  - Tambahan filter rentang waktu (`today`, `7d`, `14d`, `30d`, `all`), platform (`whatsapp`, `telegram`), dan model/provider pada antarmuka tabel serta URL unduhan ekspor JSONL/CSV.
- **Filter Log Aktivitas Percakapan (Live Table)**:
  - Pencarian kata kunci live, filter platform, filter peran (`User`/`Bot`), dan filter jenis media (`Teks`, `Voice Note`, `Foto/Vision`, `Dokumen`, `Stiker`, `Video`).

### v0.22.1 — 2026-09-11 13:18 WIB
**Penyempurnaan UI/UX: Restorasi Landing Page Publik di Root (/) & Eliminasi Keypad Virtual Manual**
- **Restorasi Landing Page Publik (`public/index.html`)**: Rute utama (`/`) difungsikan sebagai Landing Page publik yang menyajikan status operasional bot online 24/7, kapabilitas multimodal (Voice Note Whisper, Dokumen PDF/Word, Gemini Vision, 4-Provider Failover), dan tombol CTA menuju panel monitoring.
- **Pemisahan Dashboard Observabilitas (`public/dashboard.html` / `/dashboard`)**: Panel monitoring dipisahkan ke rute `/dashboard` dengan proteksi Master PIN keamanan.
- **Eliminasi Keypad Angka Virtual**: Menghapus seluruh tombol keypad kalkulator manual (`1 2 3 4 5 6 7 8 9 C 0 ⌫`) pada modal autentikasi admin, digantikan dengan input password keyboard native yang bersih, elegan, dan autofocus.

### v0.22.0 — 2026-09-11 13:10 WIB
**Keamanan & Observabilitas: Master PIN Gateway, Email OTP Reset & Fine-Tuning Dataset Engine**
- **Master PIN Security Gateway (`src/admin_auth.ts`, `api/admin-otp.ts`)**:
  - Panel pemantauan (`/` dan `/dashboard`) kini dilindungi secara penuh oleh otentikasi Master PIN kriptografis.
  - Hashing PIN menggunakan algoritma SHA-256 dipadu garam statis (`PIN_SALT = rafly_telemetry_salt`), komparasi timing-safe (`crypto.timingSafeEqual`) untuk menangkal serangan side-channel, dan penerbitan session token CSPRNG acak (`adm_<hex32>`).
  - Proteksi anti-brute force bertingkat: 5 kali percobaan PIN salah langsung mengaktifkan penguncian (*lockout*) sistem selama 1 menit.
- **Pemulihan Lupa PIN via Resend Email OTP**:
  - Fitur "Lupa PIN?" terintegrasi dengan Resend REST API (`RESEND_API_KEY`) yang mengirimkan kode OTP 6-digit acak (*CSPRNG*) ke email admin (`raflyfirmansyah02@gmail.com`).
  - Dilengkapi pembatasan frekuensi pengiriman OTP (*rate limiting*: jeda minimum 60 detik, maksimal 3 pengiriman per 10 menit per IP) dan validasi batas kedaluwarsa OTP 10 menit.
  - Reset PIN otomatis menganulir (*invalidate*) seluruh token sesi aktif demi menjaga keamanan lintas perangkat secara real-time.
- **Proteksi Endpoint Data Serverless (`api/stats.ts`, `api/dataset.ts`)**:
  - Seluruh permintaan data metrik dan dataset wajib menyertakan token sesi valid via header `x-admin-token` atau `Authorization: Bearer <token>`. Akses tanpa otorisasi langsung ditolak (`401 Unauthorized`).
- **Dataset Evaluasi Percakapan & Fine-Tuning LLM (`api/dataset.ts`, `public/index.html`)**:
  - Engine dataset memasangkan setiap pertanyaan pengguna dengan balasan chatbot yang tersimpan di Supabase PostgreSQL.
  - UI interaktif menampilkan tabel pasangan chat, pencarian kata kunci, dan filter platform (WhatsApp/Telegram).
  - Ekspor instan ke format JSONL standar ShareGPT/OpenAI (siap pakai untuk fine-tuning model LLM lokal/cloud) dan format CSV untuk audit spreadsheet.
- **Skrip Migrasi Supabase & Dual-Store Resilient (`sql/migrate_v12_admin_auth.sql`)**:
  - Menyediakan skema tabel `admin_auth_config` dengan Row Level Security dan 3 fungsi PostgreSQL `SECURITY DEFINER` (`rpc_admin_verify_pin`, `rpc_admin_save_otp`, `rpc_admin_verify_otp_and_reset_pin`).
  - Arsitektur dual-store otomatis memanfaatkan tabel `whatsapp_sessions` sebagai fallback penyimpanan persisten jika tabel `admin_auth_config` belum dieksekusi di Supabase SQL Editor.

### v0.21.0 — 2026-09-11 12:55 WIB
**Pembaruan Utama: Unified Real-Time Monitoring Dashboard & Stats Engine**
- **Dashboard Pemantauan Terpadu (`public/index.html` & `public/dashboard.html`)**:
  - Halaman web monitoring modern bertema dark-mode yang menyajikan visualisasi menyeluruh dalam satu layar tanpa perlu login terpisah ke provider atau database.
  - Memuat metrik performa real-time dengan auto-refresh otomatis per 15 detik (dapat diaktifkan/dinonaktifkan dan di-refresh manual).
- **Endpoint Analitik Real-Time (`api/stats.ts`)**:
  - Mengagregasi data kuota langsung dari tabel Supabase `provider_quota` dan log percakapan tabel `messages`.
  - Melacak status kesehatan 12 API Key secara individual (Groq, Gemini, OpenRouter, Ollama) berdasarkan akhiran 4 karakter (*masked suffix*), kuota terpakai, batas harian, dan persentase penggunaan dengan penanda visual (Healthy, Warning >80%, Capped).
  - Menghitung statistik pesan hari ini vs semua waktu, proporsi traffic WhatsApp vs Telegram, distribusi pemanggilan model AI, dan kuantitas pemrosesan media (Voice Note Whisper, Dokumen PDF/Word, Foto, Stiker, dan Teks).
  - Menampilkan log aktivitas 25 percakapan terbaru dengan penyamaran nomor telepon (*privacy masking*) demi keamanan privasi data pengguna.

### v0.20.1 — 2026-09-11 11:20 WIB
**Perbaikan: Eliminasi Halusinasi Penolakan VN & Voice Note Self-Awareness**
- **Penetapan Kesadaran Multimodal di `systemPrompt` (`src/skills.ts`)**:
  - Menambahkan Bagian 5 pada instruksi sistem: menegaskan bahwa bot terhubung penuh ke sistem pendengaran dan penglihatan mutakhir.
  - Melarang keras respons disclaimer bawaan model ("aku cuma bisa baca teks", "aku tidak bisa mendengar suara/VN").
- **Pembingkaian Konteks Audio (*Voice Note Prompt Framing*)**:
  - Pada `src/whatsapp_cloud.ts`, `src/whatsapp_baileys.ts`, dan `src/telegram.ts`, transkripsi audio dibingkai secara eksplisit sebagai `[Pesan Suara / Voice Note dari Temanmu]: "..." (Kamu mendengar rekaman suara ini secara jernih...)` agar AI sadar bahwa ia sedang merespons rekaman suara dan menjawab pertanyaannya secara alami tanpa menyangkal kemampuannya.

### v0.20.0 — 2026-09-11 10:50 WIB
**Pembaruan Utama: Comprehensive Multimodal Media Engine (PDF, Word, Code/Data, Voice Note Whisper, Stickers & Videos)**
- **Dokumen PDF Multimodal Native (`src/media.ts`)**:
  - Memanfaatkan kapabilitas native multimodal Google Gemini API (`inlineData` dengan `application/pdf`) untuk membaca isi teks, tabel, bagan, dan analisis struktur dokumen secara utuh tanpa parser pihak ketiga yang berat.
- **Dokumen Microsoft Word (.docx) (`mammoth`)**:
  - Mengintegrasikan parser murni JavaScript `mammoth` untuk mengekstrak teks mentah dari file `.docx` secara cepat, aman, dan kompatibel 100% dengan Vercel Serverless.
- **Dokumen Teks, Data & Kode Sumber**:
  - Mendukung pembacaan UTF-8 langsung untuk berbagai format berkas: `.txt`, `.md`, `.csv`, `.json`, `.js`, `.ts`, `.py`, `.html`, `.css`, `.sql`, `.yaml`, `.yml`, `.xml`, `.env`, `.log`.
  - Kapasitas input teks diperluas dari 3.000 karakter menjadi 32.000 karakter pada `autoReply` di `src/skills.ts` agar dokumen berukuran puluhan halaman dapat dianalisis tuntas tanpa terpotong.
- **Voice Note (VN) & Audio Transcription Sub-Detik via Groq Whisper**:
  - Mengintegrasikan model Whisper mutakhir (`whisper-large-v3-turbo` dengan auto-fallback ke `whisper-large-v3`) melalui Groq API pool.
  - Transkripsi ultra-cepat (~500ms), 100% gratis ($0 free-tier), sangat akurat mengenali Bahasa Indonesia, dialek lokal, maupun Bahasa Inggris.
  - Hasil transkripsi disimpan ke riwayat percakapan dengan label `[Voice Note]: "..."`, langsung diproses oleh AI, dan dibalas secara alami.
- **Pemahaman Konteks Stiker WhatsApp & Telegram**:
  - Mengunduh berkas stiker (`image/webp`) dan mengumpankannya ke model Vision AI untuk memahami ekspresi emosi, humor, atau maksud visual dari stiker tersebut.
  - Dilengkapi mekanisme fallback berbasis representasi emoji stiker untuk stiker animasi (TGS) atau stiker video (WebM) di Telegram.
- **Penanganan Video & Catatan Kontekstual**:
  - Merespons video kiriman pengguna secara kontekstual berbasis teks catatan (*caption*) yang disertakan.
- **Integrasi Universal Lintas Platform**:
  - Diaktifkan serentak dan identik pada Meta WhatsApp Cloud API (`src/whatsapp_cloud.ts`), Telegram Bot API (`src/telegram.ts`), dan WhatsApp Baileys Multi-Device (`src/whatsapp_baileys.ts`).

### v0.19.0 — 2026-09-11 10:35 WIB
**Kecerdasan Relasional & Siklus Belajar Adaptif: Flow-Conscious, Professional Excellence & Continuous Memory**
- Penegakan prinsip *Conversational Flow & Emotional Resonance*: bot sepenuhnya mengikuti alur percakapan yang dibawa pengguna tanpa mendahului atau membelokkan topik secara sepihak.
- Larangan keras terhadap saran/nasihat yang tidak diminta (*No Unsolicited Advice*): bot dilarang mengobral tips, evaluasi, atau solusi jika pengguna sekadar bercerita atau curhat.
- Penegakan standar profesionalisme tinggi pada tugas (*Professional Excellence*): saat mengerjakan koding, matematika, sains, analisis bisnis, riset data, atau dokumen resmi, bot beralih menjadi rekan profesional berstandar industri tinggi (disiplin, presisi, type-safe, aman, tanpa bercanda berlebihan).
- Implementasi inisiatif bertahap (*Clarifying Inquiry First*): jika mendeteksi kebingungan atau masalah, bot menanyakan detail konteks spesifik terlebih dahulu secara bersahabat sebelum memberikan opini atau masukan.
- Peningkatan frekuensi dan kedalaman siklus belajar (*Continuous Learning Loop*): interval distilasi memori dipercepat dari 20 pesan menjadi setiap 8 pesan, secara otomatis mengekstrak profil lawan bicara (gaya komunikasi, topik kesukaan, cerita berjalan, dan preferensi personal) ke tabel `summaries` Supabase agar bot semakin hari semakin mengenal dan memahami penggunanya.

### v0.18.0 — 2026-09-11 00:52 WIB
**Persona & Intelegensi Universal: True Companion Polymath & Clean Dynamic Pipeline**
- Transformasi menyeluruh persona bot menjadi Sahabat Karib Sejati & Partner Diskusi Cerdas Serbabisa (*Universal Polymath Companion*) di WhatsApp: interaksi setara, hangat, manusiawi, berakal sehat, dan berwawasan luas tanpa batas.
- Integrasi *Universal Situational Intelligence (Read the Room)*: bot membaca mood, tempo, dan maksud lawan bicara secara dinamis tanpa terjebak dalam sekat-sekat kategori kaku.
- Pembersihan arsitektur payload pesan (*Zero Prompt Pollution*): membuang tag pembungkus XML `<user_message>` dan mengintegrasikan memori percakapan, preferensi koreksi, serta fakta internet real-time langsung ke dalam instruksi sistem latar belakang.
- Penyempurnaan pipeline riwayat percakapan: pencegahan duplikasi pesan pengguna di ujung riwayat dan pemulihan giliran memori multi-turn Gemini secara mulus.
- Peningkatan parameter `temperature` ke 0.7 pada provider LLM untuk menghasilkan percakapan yang mengalir luwes, hangat, ekspresif, dan tidak deterministik/kaku.

### v0.17.0 — 2026-09-11 00:41 WIB
**Kecerdasan Kontekstual: Conversational Proportionality & Anti-Over-Explaining**
- Penegakan prinsip proporsionalitas pesan: obrolan santai, curhat, dan cerita harian dibalas ringkas (1-3 kalimat) layaknya teman berkirim pesan di WhatsApp.
- Larangan keras terhadap pengeluaran daftar langkah bernomor (1., 2., 3.), SOP darurat, atau panduan aksi yang tidak diminta saat pengguna sekadar bercerita santai.
- Pengkhususan format daftar langkah teknis hanya untuk pertanyaan yang secara eksplisit meminta panduan, analisis mendalam, atau tutorial koding/akademik.

### v0.16.0 — 2026-09-11 00:36 WIB
**Interaksi Percakapan: Two-Way Conversational Flow & Interactive Banter**
- Implementasi dinamika dialog interaktif dua arah (setup & punchline) saat diminta lelucon, tebak-tebakan, atau humor.
- Larangan keras menyodorkan daftar panjang monolog lelucon sekaligus yang merusak suasana obrolan.
- Pembagian giliran bicara (*conversational turn-taking*) agar interaksi chat WhatsApp terasa hidup, alami, dan menyenangkan.

### v0.15.0 — 2026-09-11 00:32 WIB
**Optimasi Percakapan: Dynamic Natural Intelligence & Template Elimination**
- Pemangkasan seluruh instruksi sistem yang preskriptif dan bertele-tele guna membebaskan model LLM menjawab secara organik, luwes, dan dinamis.
- Pelarangan tegas terhadap template sapaan pembuka dan penutup klise ("Ada yang bisa saya bantu hari ini?", "Tentu saja!", dll).
- Eliminasi monolog perkenalan diri yang kaku dan repetitif.

### v0.14.0 — 2026-09-11 00:21 WIB
**Kecerdasan Emosional: Dynamic Tone Chameleon & Human Warmth Enhancement**
- Desain ulang system prompt dengan integrasi Emotional Intelligence (EQ): beralih luwes menjadi teman hangat dan berempati saat pengguna curhat/sedih.
- Larangan keras terhadap respons kaku ala robot konsultan medis/neurosains saat berinteraksi emosional.
- Fleksibilitas gaya bahasa multi-konteks: hangat untuk curhat, akrab untuk kasual, presisi dan tajam untuk koding/sains teknis.
- Eliminasi seluruh klise identitas robotik ("Sebagai AI", "Sebagai asisten yang analitis").

### v0.13.0 — 2026-09-11 00:07 WIB
**Penyempurnaan: WhatsApp Clean Output Formatting & Zero-Emoji Enforcement**
- Eliminasi total emoji dan simbol dekoratif dari seluruh balasan model AI via regex range Unicode komprehensif.
- Normalisasi sintaks markdown heading (`###`, `##`, `#`) menjadi format cetak tebal WhatsApp (`*Judul*`).
- Normalisasi format bold ganda (`**teks**`) ke bold tunggal (`*teks*`) dan perbaikan otomatis asteris yang menggantung/tanpa pasangan.
- Pembersihan format bullet list bertumpuk (`*   *teks*`) menjadi daftar terstruktur bersih (`- *teks*`).
- Penyempurnaan system prompt agar model langsung menyampaikan substansi teknis tanpa basa-basi pengantar template dan tanpa membocorkan aturan internal.

### v0.12.0 — 2026-09-10 23:33 WIB
**Integrasi: Meta WhatsApp Cloud API Production Phone Registration**
- Pendaftaran nomor produksi (+62 838-7464-0066) ke Meta WhatsApp Cloud API dengan Phone Number ID: 1248930498311083.
- Konfigurasi serverless webhook Vercel (/api/whatsapp) terhubung dengan Meta Graph API v21.0.
- Pembersihan dependensi Python/Gradio untuk memastikan build pipeline Vercel murni Node.js ultra-cepat.

### v0.10.0 — 2026-09-10 20:12 WIB
**Arsitektur: Hardened AI Assistant, Persistent Memory & Vercel 24/7 Deployment Ready**
- Implementasi endpoint Webhook Vercel (`api/webhook.ts`) dengan verifikasi secret token timing-safe.
- Pengingat persisten Supabase (`reminders`) yang terhubung dengan endpoint Vercel Cron (`api/cron/reminders.ts`).
- Arsitektur timeout dua tingkat pada `src/providers.ts`: connect timeout 8 detik untuk failover instan saat error 429, serta durasi berpikir 90 detik.
- Kapasitas output token ditingkatkan hingga 2500 token untuk mendukung penalaran mendalam dan pembuatan kode lengkap.
- Pengerasan Row Level Security (RLS) pada seluruh tabel database via `sql/migrate_v09_hardened.sql`.

### v0.9.1 — 2026-09-10 19:47 WIB
**Penyempurnaan: Clean Answer Filtering & Noise Elimination**
- Penyaringan hasil pencarian web agar selalu disintesis oleh model AI dalam narasi alami, mencegah penempelan teks mentah yang berantakan ke pengguna.

### v0.9.0 — 2026-09-10 19:43 WIB
**Fitur: Smart Memory & Zero-Template Assistant**
- Integrasi memori berkelanjutan: 10 riwayat percakapan aktif + ringkasan otomatis setiap 20 interaksi.
- Perintah `/salah <koreksi>` untuk menyimpan preferensi dan koreksi pengguna ke database Supabase.
- Penghapusan seluruh respons template hardcoded; seluruh sapaan dan jawaban dihasilkan dinamis oleh model AI.

### v0.7.0 — 2026-09-10 19:30 WIB
**Refactoring: Shop Logic Purge & AI General Assistant Focus**
- Pembersihan menyeluruh kode lama toko/e-commerce menjadi asisten kecerdasan buatan umum (*general personal assistant*).

### v0.5.0 — 2026-09-10 19:14 WIB
**Fitur: Dynamic Vision & Resilient Multimodal Engine**
- Penanganan berkas gambar pengguna dengan auto-routing ke model AI vision-capable.
- Implementasi mekanisme retry berdelay untuk menjaga ketahanan koneksi terhadap kegagalan jaringan sementara.

### v0.3.0 — 2026-09-10 18:59 WIB
**Konfigurasi: Centralized Environment & Identity System**
- Sentralisasi variabel lingkungan (`src/env.ts`) dan pengaturan identitas persona (`BOT_NAME`, `BOT_PROFILE`, dll).

### v0.2.0 — 2026-09-10 18:15 WIB
**Fondasi: P0 Telegram Bot & 4-Provider Failover Chain**
- Inisialisasi arsitektur bot Telegram dengan rantai failover 4 provider (OpenRouter, Groq, Gemini, Ollama Cloud).
- Pelacakan kuota dan pencatatan riwayat percakapan awal ke Supabase.
