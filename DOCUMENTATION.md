# DOKUMENTASI SISTEM — FreeAIBot / AgentKit
**Versi:** v0.22.6  
**Status Lingkungan:** Produksi Aktif 24/7 (Vercel Serverless untuk Telegram & Dashboard + Baileys Multi-Device 24/7 untuk WhatsApp + Supabase PostgreSQL)  
**Terakhir Diperbarui:** 2026-09-11 14:10 WIB  

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
  ├── Bypassed untuk Soal Matematika, Algoritma Koding, & Definisi Baku (Hemat 3-4s)
  └── Diaktifkan untuk Berita, Fakta Live, Harga, & Kueri URL/Domain:
        ├── Google News Global & ID RSS
        ├── Bing News RSS
        ├── Hacker News Algolia API
        ├── Wikipedia Full-Text Search (ID & EN)
        └── Deep Webpage Scraper (Jina Reader)
       │
       ▼
[Skills, Prompt Polymath & Multi-Domain Excellence (`src/skills.ts`)]
  ├── Standar Unggul: Matematika (Rumus abc), Koding (Type-Safe), Sains, Bahasa
  ├── Mandat Grounding Fakta Real-Time 2026
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

### 3.1. Mesin Penelusuran Web Real-Time Bebas (v0.11.0)
- Mengadopsi arsitektur pencarian terbuka dari Terminal AI Portofolio.
- Menyediakan akses data mutakhir tanpa batas cut-off pelatihan model lama.
- Penelusuran paralel sub-detik (~570ms) untuk mengumpulkan fakta terverifikasi lintas feed berita internasional dan nasional.
- Pembaca halaman web otomatis (*Deep Webpage Reader*) yang mampu membedah isi tautan publik atau domain yang disertakan pengunjung.

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
