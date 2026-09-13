# DOKUMENTASI SISTEM - FreeAIBot / AgentKit

**Versi:** v0.26.25 (Redesain Navigasi Utama Dashboard: Frosted Glass, Ambient Glow Line, Telemetry Radar Pill & Unified Actions Cluster)  
**Status Lingkungan:** Produksi Aktif 24/7 (Vercel Serverless untuk Telegram & Dashboard + Baileys Multi-Device 24/7 untuk WhatsApp + Supabase PostgreSQL)  
**Terakhir Diperbarui:** 2026-09-13 10:45 WIB

---

## 1. Arsitektur Multi-Platform (Telegram & WhatsApp)

Sistem dirancang dengan fleksibilitas tinggi menggunakan prinsip _Single Unified Brain, Multi-Channel Execution_:

1. **Telegram Bot (Vercel Serverless 24/7)**:
   - Webhook endpoint (`POST /api/webhook`) berjalan di Vercel Serverless gratis selamanya.
   - Dilindungi verifikasi `X-Telegram-Bot-Api-Secret-Token` menggunakan algoritma _constant-time_ `crypto.timingSafeEqual`.
   - Vercel Cron (`GET /api/cron/reminders`) mengeksekusi pengingat terjadwal langsung dari database.
2. **WhatsApp Bot (Baileys Multi-Device 24/7 Unlimited)**:
   - Berjalan sebagai client WhatsApp Multi-Device resmi via `@whiskeysockets/baileys` (`src/whatsapp_baileys.ts`).
   - **Supabase Cloud Session Persistence (`src/whatsapp_session.ts`)**: File sesi otentikasi disinkronkan otomatis ke tabel Supabase `whatsapp_sessions` dengan proteksi Row Level Security (RLS). Pengguna hanya perlu scan QR Code satu kali; bot langsung login otomatis saat container cloud gratis (seperti Render.com atau Koyeb) melakukan restart berkala.
   - Bebas batas kuota 1.000 pesan ($0 gratis selamanya).
   - Mendukung chat teks dengan _safe paragraph chunking_ (> 4000 karakter) dan analisis gambar multimodal via Gemini Vision.
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
   - `XKIRO_KEYS`
   - `GROQ_KEYS`
   - `CLOUDFLARE_KEYS`
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
7. Untuk melatih ulang (_fine-tuning_) model AI atau audit percakapan, buka bagian **"Evaluasi & Dataset Training AI"**, lalu klik tombol **Unduh JSONL** atau **Unduh CSV**.

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
  │     xKiro (DeepSeek) ──(fail)──> Groq (Qwen 3.8) ──(fail)──> Cloudflare (Llama 3.1 70B) ──(fail)──> Gemini (3.8 Flash) ──(fail)──> OpenRouter Pool
  └── Mode Vision/Gambar:
        xKiro (Standby Qwen Free) ──(fail)──> Gemini (3.8 Flash / 2.5 Flash) ──(fail)──> OpenRouter Vision
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
- **Video & Catatan:** Merespons video kiriman pengguna secara kontekstual berbasis teks catatan (_caption_).

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

### v0.26.25 - 2026-09-13 10:45 WIB

**Redesain Navigasi Utama Dashboard Observabilitas: Frosted Glass, Ambient Glow Line, Telemetry Radar Pill & Unified Actions Cluster**

- **Rombak Desain Bilah Navigasi (`public/dashboard.html`)**:
  - **Frosted Glass & Ambient Glow Line**: Bilah atas (`header`) ditingkatkan menggunakan material transparan `rgba(11, 17, 32, 0.82)` dengan filter blur 20px `saturate(180%)`, serta garis pendar luminous horizontal (cyan ke ungu) pada batas bawah (`header::after`).
  - **Elevasi Responsif Saat Scroll**: Transisi mulus `box-shadow` dan opasitas latar belakang saat pengguna menggulir ke bawah (`header.header-scrolled`).
- **Grup Identitas & Tombol Navigasi Kiri (`.nav-brand-group`)**:
  - **Pill Navigasi Beranda (`#link-home-header`)**: Tombol kembali beranda diubah menjadi pill kaca minimalis dengan animasi gerak mikro panah (`←`) saat disentuh kursor.
  - **Divider & Badge AI**: Garis pemisah transparan vertikal dan lencana AI kubus gradien 3D dengan rotasi halus dan efek pendar saat di-hover.
  - **Tipografi & Status Sinkronisasi**: Judul `FreeAIBot Console` dengan gradien putih-perak, tag versi `v0.26`, serta indikator sinkronisasi waktu bersanding dengan micro-pulse dot.
- **Kluster Aksi & Telemetri Kanan (`.header-actions`)**:
  - **Telemetry Radar Pill (`.status-pill`)**: Indikator status sistem dengan efek radar ganda (*pulse-ring animation*) yang memancarkan pendar gelombang hijau secara halus.
  - **Unified Action Controls Segment (`.nav-control-group`)**: Tiga tombol kontrol (`#btn-auto`, `#btn-manual-refresh`, `#btn-logout`) disatukan ke dalam satu kontainer segmen kaca terpadu dengan feedback hover dan active-state spring physics (`scale(0.96)`).
  - **Animasi Ikon Segarkan**: Ikon refresh berputar 180 derajat secara elastis saat kursor mendekat dan berputar kontinu saat pemuatan data aktif.
  - **Tombol Kunci Keluar**: Desain pengaman dengan rona merah transparan dan aurora glow saat disentuh kursor.

### v0.26.24 - 2026-09-13 10:10 WIB

**Penyelarasan Matriks Model AI Dashboard dengan Runtime v0.26 & Penguatan Tumpukan MRU All-Time Anti-Reset**

- **Penyelarasan Katalog Model AI Dashboard (`public/js/dashboard.js`)**:
  - Mengeliminasi 6 model hantu xKiro usang yang sudah tidak aktif di runtime (`Qwen 3.8 Max Free`, `Mistral Medium 3.5`, `Mistral Large 2512`, `Qwen 3.7 Max Free`, `Qwen 3.6 Plus Free`, `Mistral Small 2603`).
  - Mendaftarkan 13 model aktif runtime yang sinkron 100% dengan hierarki failover sistem:
    1. **Tier 1 (xKiro Gateway)**: `DeepSeek V4 Flash` (Primary), `DeepSeek V4 Pro` (Backup 1), `DeepSeek V3.2` (Backup 2).
    2. **Tier 2 (Groq Cloud API)**: `Qwen 3.8 27B` (Primary), `Qwen 3.6 27B` (Backup), `Groq Whisper Turbo` (Voice Note STT).
    3. **Tier 3 (Cloudflare Workers AI)**: `Llama 3.1 70B Instruct` (Primary), `Qwen 2.5 Coder 32B` (Backup).
    4. **Tier 4 (Google Gemini API)**: `Gemini 3.8 Flash` (Multimodal Vision/PDF/Video Primary), `Gemini 2.5 Flash` (Backup).
    5. **Tier 5 (OpenRouter AI)**: `Nex N2.5 Pro Free` (Primary), `Nex N2.5 Mini Free` (Backup), `Nemotron 3.5 Lightning` (Fast Text).
- **Arsitektur Urutan Dinamis MRU All-Time (`api/stats.ts`, `public/js/dashboard.js`)**:
  - **Pemisahan Metrik Agregasi vs Urutan Kronologis**: Backend `api/stats.ts` kini memisahkan agregasi hitungan eksekusi (yang tetap menghormati filter tanggal aktif: "Hari Ini", "7 Hari", "30 Hari", "Semua") dengan penentuan urutan kronologis MRU.
  - **Query Riwayat All-Time**: Backend mengeksekusi query cepat terhadap 300 pesan asisten terbaru lintas seluruh waktu (`allTimeAssistantRes`) untuk membangun tumpukan urutan MRU yang utuh.
  - **Perilaku Pergeseran Kartu Anti-Reset**:
    - Model yang paling baru dieksekusi secara otomatis menempati posisi `#1` (`AKTIF TERBARU`).
    - Model yang sebelumnya berada di `#1` secara otomatis bergeser menjadi `#2`, `#2` menjadi `#3`, dan seterusnya.
    - Model yang sudah pernah dieksekusi dijamin tidak akan pernah kembali/merosot ke posisi statis bawaannya di bawah, bahkan saat berganti filter tanggal ("Hari Ini" / "Semua") atau saat terjadi pergantian hari/midnight.
    - Model yang belum pernah dieksekusi sama sekali tetap berada di bawah model-model yang pernah aktif sesuai prioritas tier katalog bawaan.
  - **Persistensi Sesi Klien (`localStorage`)**: Frontend mengamankan tumpukan MRU ke `localStorage` (`freeaibot_mru_models_stack`) sehingga urutan pergeseran dinamis tetap persisten saat halaman dashboard dimuat ulang (refresh) di browser.

### v0.26.23 - 2026-09-13 09:48 WIB

**Audit & Kalibrasi Kuota Faktual Harian: xKiro 1.500 RPD & Cloudflare 120 RPD Berbasis Metrik Token & Neuron Riil**

- **Audit & Penyelarasan Kuota xKiro Gateway (`DAILY_CAP_XKIRO=1500`, `src/env.ts`, `.env`, `.env.example`, `api/stats.ts`)**:
  - **Data Faktual Live**: Endpoint upstream `https://api.xkiro.com/v1/usage` membuktikan bahwa tier gratis xKiro menetapkan kuota sebesar **5.000.000 token/hari** per akun (bukan 50.000 request).
  - **Kalkulasi Matematis Empiris**: Pengukuran payload nyata dengan bot system prompt (~9.150 karakter) + riwayat chat + output token menghasilkan konsumsi rata-rata ~3.500 token per panggilan. Dengan kuota 5.000.000 token, kapasitas riil adalah `5.000.000 / 3.500 ≈ 1.428 panggilan/hari`.
  - **Kalibrasi Angka Batas**: Nilai `DAILY_CAP_XKIRO` dikalibrasi dari angka asumsi keliru `50000` menjadi **`1500`** panggilan/hari/kunci (~5M token/hari).
- **Audit & Penyelarasan Kuota Cloudflare Workers AI (`DAILY_CAP_CLOUDFLARE=120`, `src/env.ts`, `.env`, `.env.example`, `api/stats.ts`, `public/js/dashboard.js`)**:
  - **Data Faktual Dokumentasi Resmi**: Dokumentasi Workers AI membuktikan batas gratis Cloudflare adalah **10.000 Neurons/hari** per akun (bukan 10.000 request).
  - **Kalkulasi Matematis Model**: Model `@cf/meta/llama-3.1-70b-instruct` mengonsumsi rata-rata ~97,2 neurons per panggilan (~3.500 token). Kapasitas riil per akun adalah `10.000 / 97,2 ≈ 102–120 panggilan/hari`.
  - **Kalibrasi Angka Batas**: Nilai `DAILY_CAP_CLOUDFLARE` dikalibrasi dari `10000` menjadi **`120`** panggilan/hari/akun agar tidak terputus di tengah jalan sebelum batas neuron habis.
- **Penyelarasan Dashboard Observabilitas & Label Kuota (`api/stats.ts`, `public/js/dashboard.js`)**:
  - Label kuota xKiro diperjelas menjadi `5.000.000 Token/hari (~1.500 RPD)`.
  - Mekanisme batas Cloudflare ditampilkan sebagai `Batas Neuron Harian` dengan limit `10.000 Neuron (~120 RPD)` dan deskripsi `Limit: 120 RPD (~10K Neurons) • Bot Monitored`.
- **Verifikasi Rantai Provider Lainnya**:
  - **Groq Cloud API**: Live HTTP headers membuktikan `x-ratelimit-limit-requests: 1000` (RPD). Nilai `DAILY_CAP_GROQ=800` valid (memberikan margin aman 20%).
  - **Google Gemini API**: Batas resmi Google AI Studio Free Tier adalah 1.500 RPD & 1M TPM. Nilai `DAILY_CAP_GEMINI=1400` valid.
  - **OpenRouter AI**: Batas resmi rute model `:free` adalah ~200 RPD. Nilai `DAILY_CAP_OPENROUTER=180` valid.

### v0.26.22 - 2026-09-13 09:25 WIB

**Integrasi Provider Cloudflare Workers AI (Llama 3.1 70B & Qwen 2.5 Coder 32B), Multi-Account Key Pool & Failover Tier 3 Sebelum Gemini**

- **Integrasi Penuh Provider Cloudflare Workers AI (`src/env.ts`, `src/quota.ts`, `src/providers.ts`, `api/stats.ts`)**:
  - **Penempatan Hierarki Rantai Failover**: Cloudflare Workers AI ditempatkan secara presisi sebagai **Tingkat 3** tepat sebelum fallback ke Gemini (`xkiro` -> `groq` -> `cloudflare` -> `gemini` -> `openrouter`).
  - **Model Terverifikasi**:
    1. **Primary Model**: `@cf/meta/llama-3.1-70b-instruct` (Llama 3.1 70B Instruct untuk penalaran tinggi, teks umum, dan koding).
    2. **Backup Model**: `@cf/qwen/qwen2.5-coder-32b-instruct` (Qwen 2.5 Coder 32B Instruct).
  - **Dukungan Multi-Account & Format Fleksibel**:
    - Parsing otomatis format `accountId:token` maupun bare token dengan fallback konfigurasi `CLOUDFLARE_ACCOUNT_ID` atau in-memory dynamic auto-resolution via Cloudflare API endpoint `/client/v4/accounts`.
    - Mengintegrasikan 3 pool akun & API key Cloudflare pengguna dengan verifikasi live HTTP 200 pass di kedua model.
  - **Pelacak Kuota & Dashboard Observabilitas**:
    - `type ProviderKind` di `src/quota.ts`, `src/providers.ts`, dan `api/stats.ts` diperluas mencakup `'cloudflare'`.
    - Dashboard observabilitas (`public/dashboard.html`, `public/js/dashboard.js`) dilengkapi kartu katalog model, indikator status `.tag-cloudflare`, pill filter interaktif, dan pelacakan limit harian 10.000 RPD per akun.

### v0.26.21 - 2026-09-13 00:30 WIB

**Proteksi Kebocoran Karakter Mandarin (CJK Leakage Defense), Penyetelan Penggunaan Emoji Kontekstual Minimal & Integrasi Sanitasi Multi-Kanal**

- **Pertahanan Kebocoran Token Mandarin / China (`sanitizeAssistantOutput`, `src/skills.ts`)**:
  - **Akar Masalah**: Model keluarga Qwen (`qwen/qwen3.8-27b`, `qwen/qwen3.8-max`, dll) yang dilatih dengan korpus multibahasa intensif terkadang mengalami anomali *token bleeding* (kebocoran token partikel Mandarin seperti `毕竟` [bìjìng] di tengah kalimat bahasa Indonesia saat menjelaskan alasan/keahlian lawan bicara).
  - **Solusi Dua Lapis (Dual-Layer Defense)**:
    1. **Lapisan Prompt Sistem**: Menambahkan aturan tegas di Bagian 2 System Prompt yang melarang keras penyelipan karakter atau kata Mandarin/China (`毕竟`, `其实`, `但是`, `而且`, dll) ke dalam obrolan kasual.
    2. **Lapisan Deterministic Sanitizer (`sanitizeAssistantOutput`)**: Mengintegrasikan kamus pemetaan otomatis partikel CJK ke bahasa Indonesia yang luwes (misal `毕竟` -> `lagian`, `其实` -> `sebenarnya`, `但是` -> `tapi`, `而且` -> `lagipula`), serta pembersihan bersih karakter CJK asing yang tersisa jika pengguna tidak secara eksplisit meminta bahasa Mandarin/China/Jepang.
- **Penyelarasan Penggunaan Emoji Kontekstual Minimal (Contextual Balanced Emojis)**:
  - Mengklarifikasi aturan emoji: emoji TIDAK 100% dilarang, melainkan digunakan secara minimal (maksimal 1 emoji yang pas) HANYA jika konteks percakapan memang tepat untuk menghidupkan ekspresi/emosi (seperti tawa santai, kehangatan apresiasi, atau empati kawan).
  - Sanitizer secara deterministik membatasi akumulasi emoji maksimal 1 buah per balasan teks dan membersihkan emoji robot (`🤖`).
- **Integrasi Sanitasi Terpusat Lintas Seluruh Kanal**:
  - `sanitizeAssistantOutput` kini aktif di seluruh saluran balasan teks utama dan multimodal vision (`describeImage`), menjamin tidak ada kebocoran karakter CJK atau emoji berlebihan di WhatsApp Baileys, WhatsApp Cloud, maupun Telegram.

### v0.26.20 - 2026-09-13 00:15 WIB

**Arsitektur Respon Universal Lintas Domain, Eliminasi Pengondisian Khusus Satu Topik, Optimasi Zero-Reasoning Groq & Kepatuhan Token <= 4.000**

- **Arsitektur Respon Universal Lintas Domain (`src/skills.ts`)**:
  - Menghapus blok-blok pengondisian khusus satu topik (`isCurhatOpening`, `isRomanticCrush`) yang sebelumnya memecah logika obrolan ke sekat-sekat sempit.
  - Memperluas aturan inti pada Bagian 1 & 2 system prompt menjadi aturan universal yang memandu seluruh percakapan tanpa memandang topik: sapaan, cerita hubungan, curhat santai, koding, matematika, sains, fakta umum, hingga ledekan/banter.
  - Menegakkan prinsip *Universal Conversational Warmth*: jawaban wajib hangat, mengalir luwes, dan bernyawa kawan akrab WhatsApp dengan susunan kalimat yang dirangkai mandiri secara spontan (tanpa template/skrip hafalan).
  - Melarang nada analitis dingin/kaku di seluruh domain (seperti awalan dingin "Menarik...", "Klasik banget...", "Dinamika...", "Silakan, dengerin nih", "Iya, ada apa?").
  - Menghidupkan intonasi percakapan dengan partikel santai Indonesia (`nihh`, `tuhh`, `dongg`, `kan`, `sih`, `yaa`, `deh`, `lah`, `kok`) secara organik dan variatif.
- **Optimasi Groq Zero-Reasoning Token (`src/providers.ts`)**:
  - Mengatasi kendala model fallback Groq (`qwen/qwen3.6-27b`) yang secara default melakukan internal reasoning `<think>` hingga menghabiskan 800 token completion dan memicu pemotongan kalimat.
  - Memperluas `openAiChat` dengan parameter `extraBody` dan menyuntikkan `{ reasoning_effort: 'none' }` pada seluruh panggilan inferensi Groq.
  - Model inferensi Groq kini merespons instan (sub-detik) tanpa membuang kuota token pada proses berpikir internal yang tidak perlu.
- **Validasi Kepatuhan Anggaran Token (Strictly <= 4.000 Token)**:
  - Validasi alur percakapan 5 putaran dialog intensif dan pengujian 6 domain berbeda (sapaan, koding, matematika PEMDAS, banter lelucon garing, kapabilitas diri, keluhan lelah) membuktikan konsumsi token konteks stabil di kisaran **3.715–3.905 token**, selalu aman di bawah batas 4.000 token dan terhindar dari error HTTP 413/429.

### v0.26.19 - 2026-09-12 23:55 WIB

**Respons Dinamis Universal, Eliminasi Script Template Hafalan, Sitasi Berita Real-Time Hari Ini & Pembatasan Kuota <= 4.000 Token**

- **Eliminasi Kunci Jawaban Hardcoded & Template Dialog (`src/skills.ts`)**:
  - Menghapus seluruh contoh script dialog verbatim dari system prompt yang sebelumnya dihafal dan diulang secara kaku oleh model LLM (seperti respons hafalan *"Wkwk maap ya, makasih udah sabar ngaturin aku..."*).
  - Menggantinya dengan aturan batasan perilaku (*boundary directives*): model wajib menyusun respons secara dinamis, orisinal, dan mengalir natural menggunakan bahasanya sendiri sesuai konteks percakapan.
- **Larangan Mutlak Wejangan Hidup & Basa-Basi Kepo (`src/skills.ts`)**:
  - Menegakkan larangan keras membuat paragraf kedua berisi wejangan hidup ("santai dulu deh", "istirahat sejenak", "rebahan dulu", "biar otak gak overheat"), pertanyaan kepo ("udah makan belum?"), tips kerja tanpa diminta ("fokus satu-satu dulu"), dan tawaran bantuan klise ("lempar aja ke sini").
  - Respons santai/curhat dibatasi dalam 1 paragraf ringkas (1-2 kalimat alami, maksimal 20-30 kata) tanpa newline kosong ganda.
- **Penyempurnaan Penelusuran Berita Real-Time & Sitasi Waktu/Tanggal (`src/web.ts`, `src/skills.ts`)**:
  - Memperluas deteksi `needsSearch` dan `formulateSmartSearchQueries` untuk mengenali kueri ketinggalan berita, pertanyaan akses internet, dan pertanyaan resolusi anaphora terkait waktu ("itutuh kapan beritanya?").
  - Untuk berita umum/headline, scraper langsung menarik Google News Indonesia Top Headlines RSS (`https://news.google.com/rss?hl=id&gl=ID&ceid=ID:id`) sehingga berita yang disajikan akurat hari ini (12 September 2026) lengkap dengan nama media dan tanggal publikasi.
  - System prompt mewajibkan bot menyertakan waktu/tanggal terbit berita (misal: "berdasarkan berita hari ini 12 September 2026...") dan melarang keras dalih "aku tidak punya akses internet real-time".
- **Kalibrasi Anggaran Token (Strictly <= 4.000 Token)**:
  - Memotong duplikasi aturan antarseksi dan mengondisikan blok curhat hanya aktif jika bukan kueri pencarian web (`!web`).
  - Memangkas potongan referensi web menjadi 500 karakter (~150 token).
  - Seluruh skenario uji riil (berita real-time, followup waktu, curhat dinamis) terbukti menghabiskan **3.300–3.890 token**, selalu berada di bawah batas maksimal 4.000 token.

### v0.26.18 - 2026-09-12 23:25 WIB

**Kalibrasi Persona High-EQ Universal & Penyelarasan Emosional Dinamis (Budget Maksimal <= 4.000 Token)**

- **Resolusi Jawaban Datar & Hilangnya Jiwa Percakapan**:
  - Menyusul perampingan agresif pada v0.26.17, respons bot sempat menjadi terlalu dingin dan mekanis (contoh: sapaan "tes" dijawab "Iya, koneksi stabil.", pertanyaan diri dijawab ala brosur asisten korporat, dan candaan "garing anjir" dijawab kaku/defensif).
  - Dilakukan pengembalian dan penyelarasan kembali elemen-elemen instruksi bernuansa tinggi (*high-EQ dynamic tuning*) secara universal di seluruh domain percakapan.
- **Penyelarasan Presisi Prompt Sistem (`src/skills.ts`)**:
  - **Sapaan & Ping WhatsApp Alami**: Restorasi panduan sapaan ramah bersahaja ("Masuk kok, ada apa nih?", "Iya halo, kenapa?") dan pencegahan respons diagnostik server.
  - **Identitas Teman Serbabisa (Bukan Brosur CS)**: Panduan dinamis saat ditanya kemampuan diri ("bisa apa saja kamu") dijawab luwes layaknya teman nongkrong serbabisa.
  - **Resonansi Emosional & Humor Santai**: Menambahkan panduan reaksi santai saat dicandai/diledek ("Wkwk maap dah, namanya juga usaha receh haha") tanpa rasa tersinggung atau defensif.
  - **Punchline Tebak-Tebakan Nyambung**: Format dua arah diperkuat agar punchline tebakan selalu receh, segar, dan ber-punchline kocak (bukan penjelasan teknis kaku).
  - **Restorasi Penanganan Curhat Gabut & Jawaban Gak Tau**: Pengembalian blok penanganan rasa bosan/gabut dan respons "gak tau" agar tidak salah dipicu sebagai tebak-tebakan palsu.
- **Hasil Pengujian & Verifikasi Token**:
  - Ukuran prompt sistem terkalibrasi pada **~11.900 karakter (~3.500–3.700 token)**, secara presisi memenuhi batas maksimal permintaan pengguna (<= 4.000 token).
  - Seluruh skenario uji riil pada **Groq `qwen/qwen3.8-27b`** lolos dengan hasil alami:
    * "tes" -> *"Masuk kok, ada apa nih?"* (Ctx: ~3.715 tk).
    * "bisa apa saja kamu" -> *"Bisa diajak ngobrol apa aja sih, mau diskusi serius, curhat santai, ngerjain tugas, ngoding..."* (Ctx: ~3.539 tk).
    * "garing anjir" -> *"Wkwk maap dah, namanya juga tebakan receh."* (Ctx: ~3.599 tk).
    * "itu anjing lagi pose love buat kamu" -> *"Haha gemes banget, makasih ya udah dikasih love."* (Ctx: ~3.386 tk).
    * Matematika PEMDAS & 9:0 -> Jawaban 16 akurat dan 9:0 tidak terdefinisi (*undefined*).

### v0.26.17 - 2026-09-12 23:06 WIB

**Perampingan Universal System Prompt, Eliminasi Duplikasi & Penuntasan Overprompting (Penurunan Ukuran Prompt dari ~8.500 Token Menjadi ~2.100 Token)**

- **Audit & Penemuan Akar Masalah Token Menumpuk (`src/skills.ts`)**:
  - Investigasi riil membuktikan bahwa penggunaan token >8.000 (Ctx: ~8.912) bukan disebabkan oleh riwayat obrolan (chat history hanya menyumbang ~350 token), melainkan oleh *System Prompt* inti bot yang berukuran ~43.600 karakter (~8.500–9.500 token).
  - Hal ini menyebabkan inferensi ke model Groq `qwen/qwen3.8-27b` selalu ditolak oleh upstream dengan error `HTTP 413: Request too large ... Limit 7000 ITPM, Requested 8518`.
- **Eliminasi Total Duplikasi Instruksi Prompt Sistem (`src/skills.ts`)**:
  - Menghapus redundansi *triple duplication* pada aturan penyelarasan gaya bahasa (*style mirroring*), larangan kata formal "Anda", penanganan tawa/slang, dan instruksi penutup CS yang sebelumnya berulang kali ditulis pada 3–5 sub-seksi berbeda dan blok kondisional.
  - Memadatkan aturan lelucon dan tebak-tebakan interaktif dua arah menjadi instruksi tegas satu tempat yang diperkuat dengan satu contoh konkret (`"Kenapa programmer selalu bawa payung? Coba tebak!"`), mempertahankan kepatuhan model tanpa membocorkan punchline.
  - Menyingkirkan redundansi instruksi multimodal stiker dan foto yang sebelumnya mencapai 40 baris pada prompt teks biasa, karena `describeImage` di `src/skills.ts` telah memiliki prompt penglihatan terisolasi tersendiri.
- **Pembersihan Overprompting dengan Preservasi Penuh Kualitas & Persona**:
  - Memadatkan instruksi tanpa mengubah karakter alami bot sebagai sahabat karib sejati (polymath companion).
  - Mempertahankan 100% seluruh guardrail krusial:
    1. Verifikasi kepemilikan dan identitas developer Rafly Firmansyah (@Rflyyyf) serta proteksi anti-impersonasi akun lain.
    2. Integritas objektif dan anti-sycophancy (sains, fakta, matematika PEMDAS/KABATAKU, pembagian nol *undefined*, kunci jawaban baku tebak-tebakan).
    3. Penyelarasan gaya bahasa dinamis (formal vs santai bersih vs slang gaul proporsional) dan kepekaan rasa tinggi (*read between the lines* pada godaan akrab/manis).
    4. Anti-latah kata seru "Wah", kontrol slang "bjir/anjir", dan pencegahan filler penutup klise.
    5. Aturan format WhatsApp (*bold*, blok kode, daftar strip, bebas em-dash).
    6. Penanganan memori pasif dan referensi data internet terkini.
- **Hasil Pengujian & Verifikasi Faktual**:
  - Ukuran prompt sistem terpangkas dari **~43.600 karakter (~8.500 token)** menjadi **~6.500 karakter (~1.600 token)**.
  - Total token per giliran obrolan (prompt sistem + riwayat + pesan pengguna) turun drastis dari **~8.912 token** menjadi **~2.100 token** (penghematan ~76% token).
  - Pengujian langsung `autoReply` membuktikan bahwa seluruh request kini berhasil dieksekusi oleh **Groq `qwen/qwen3.8-27b`** dengan latensi sub-detik (500–680ms) dan bebas dari error 413/429.

### v0.26.16 - 2026-09-12 22:42 WIB

**Sinkronisasi Pelacakan Kuota Kunci API Gemini & Groq pada Dashboard Observabilitas (Resolusi Hash Suffix Mismatch)**

- **Sinkronisasi Agregasi Kunci API (`api/stats.ts`)**:
  - Memperbaiki ketidaksinkronan data pemanggilan kunci API pada tabel dashboard observabilitas, di mana model Gemini tercatat berjalan beberapa kali namun kolom panggilan kunci menampilkan 0.
  - Akar masalah: `src/quota.ts` mencatat entri `provider_quota` menggunakan hash SHA-256 12-karakter (`keyHash`), sementara `api/stats.ts` sebelumnya hanya mencocokkan potongan 4-karakter terakhir (`k.slice(-4)`).
  - Mengupdate fungsi agregasi kuota di `api/stats.ts` untuk secara adaptif menjumlahkan kedua format (`hash12` dan `slice(-4)`), sehingga statistik pemanggilan riil kunci Google Gemini dan Groq kini 100% sinkron dan akurat.

### v0.26.15 - 2026-09-12 22:35 WIB

**Pembatasan Maksimal 8.000 Token Konteks Global, Pemangkasan Memori Lokal Percakapan Jangka Pendek Menjadi 15 Pesan, dan Adaptasi Kuota Groq 8K TPM**

- **Penyesuaian Memori Lokal Jangka Pendek Menjadi 15 Pesan (`src/memory.ts`, `src/skills.ts`, `AGENTS.md`)**:
  - Mengurangi batas cache riwayat pesan lokal in-memory dari 24 menjadi 15 pesan (`updateContextCache` dan `getContext`).
  - Menyesuaikan batas pembacaan riwayat pada `buildMessages` di `src/skills.ts` dari 24 menjadi 15 pesan terakhir.
  - Menghemat ~1.500 hingga 2.500 token konteks tanpa memotong integritas instruksi prompt dasar sistem.
- **Budget Token Adaptif & Penegakan Batas 8.000 Token (`src/providers.ts`, `src/env.ts`)**:
  - Mengimplementasikan helper `trimMessagesToTokenBudget(messages, maxBudget)` yang secara dinamis membuang pesan riwayat percakapan tertua jika akumulasi token melebihi batas, sambil tetap mempertahankan pesan sistem (*system prompt*) dan pesan pengguna terkini 100% utuh.
  - Menetapkan batas global `maxTokensLimit: 8000` di `src/env.ts` (`MAX_TOKENS_LIMIT`).
  - Menerapkan pemangkasan khusus pada langkah eksekusi Groq ke 7.200 token prompt (sehingga total prompt + 800 output token tidak pernah melampaui batas ketat 8.000 TPM pada model Qwen Groq), mengeliminasi error `HTTP 413 / 429 rate limit exceeded`.

### v0.26.14 - 2026-09-12 22:20 WIB

**Fast-Break Circuit Breaker untuk Outage Server 503/502, Sinkronisasi .env Lokal, dan Pemangkasan Latensi Failover Menjadi Sub-Detik**

- **Fast-Break HTTP 503 & 502 (`src/providers.ts`)**:
  - Menambahkan penanganan langsung untuk `PROVIDER_503` (Service Unavailable / Upstream Outage) dan `PROVIDER_502` (Bad Gateway) ke dalam logika *fast-break circuit breaker*.
  - Saat server provider (seperti xKiro yang mengalami gangguan kapasitas hulu pada model DeepSeek) mengembalikan status 503, bot tidak lagi membuang waktu mencoba kunci-kunci API lain di pool untuk model yang sama. Model langsung di-break dan di-cooldown selama 15 menit, memangkas latensi kegagalan dari ~24 detik menjadi < 100ms.
- **Sinkronisasi Konfigurasi `.env` Lokal**:
  - Memperbarui `.env` lokal untuk menurunkan `CONNECT_TIMEOUT_MS` dari 8000ms menjadi 3000ms.
  - Menyelaraskan `XKIRO_MODEL_PRIMARY` dan `XKIRO_MODEL_BACKUPS` dengan konfigurasi v0.26.13 terbaru tanpa sisa model Qwen yang sudah tidak ada di tier gratis xKiro.
- **Arsitektur Terbuka untuk AgentRouter**:
  - Memvalidasi kompatibilitas penuh OpenAI API gateway untuk platform AgentRouter (`https://agentrouter.org/v1`), siap diintegrasikan sebagai gateway berbayar berkecepatan tinggi menggunakan sisa kredit pengguna.

### v0.26.13 - 2026-09-12 21:58 WIB

**Pembersihan Total Varian Qwen Berbayar dari xKiro, Sentralisasi Kluster Murni DeepSeek di xKiro Gateway, dan Pengalihan Vision Langsung ke Native Gemini**

- **Eliminasi Model Qwen dari Gateway xKiro (`src/env.ts`, `AGENTS.md`, `api/stats.ts`)**:
  - Menghapus seluruh varian Qwen (`qwen3.8-max:free`, `qwen3.7-max:free`, `qwen3.6-plus:free`) dari daftar model xKiro karena pihak hulu xKiro telah mengubah seluruh model Qwen menjadi berbayar uang asli (`HTTP 403: requires real deposited balance`) atau `HTTP 404`.
  - Mengeliminasi jeda panggilan jaringan sia-sia (memangkas ~300–500ms kegagalan berulang) saat bot mencoba menghubungi model Qwen yang tidak bisa diakses di tier gratis.
- **Sentralisasi Kluster Murni DeepSeek pada Gateway xKiro**:
  - Mengonfigurasi xKiro murni terfokus pada model DeepSeek gratis:
    * **Primary xKiro**: `deepseek/deepseek-v4-flash`
    * **Cadangan Terurut**: `deepseek/deepseek-chat-v3.1`, `deepseek/deepseek-v4-pro`, `deepseek/deepseek-v3.2`
- **Pengelolaan Vision Multimodal dengan Circuit Breaker Siaga (`src/providers.ts`)**:
  - Menghapus total seluruh varian Mistral dari `visionModels` karena respons terjemahan rusak / tidak stabil.
  - Mempertahankan varian Qwen gratis (`qwen/qwen3.8-max:free`, `qwen/qwen3.6-plus:free`) dalam daftar `visionModels` xKiro sebagai model siaga (*standby*).
  - Berkat mekanisme *fast-break circuit breaker* 30 menit pada error 404/403, model yang tidak aktif dilewati instan dalam 50ms tanpa membuang kuota kunci, dan vision langsung dialihkan ke Google Gemini (`gemini-3.8-flash` -> `gemini-2.5-flash`), dengan OpenRouter (`nex-agi/nex-n2.5-pro:free`) aktif sebagai jaring pengaman visual otonom. Jika xKiro mengaktifkan kembali Qwen gratis di kemudian hari, sistem akan mendeteksinya secara otomatis tanpa perlu modifikasi kode ulang.

### v0.26.12 - 2026-09-12 21:35 WIB

**Penyetelan Latensi Respons Lintas Provider Tanpa Modifikasi Aturan Prompt: Fast-Break Circuit Breaker (HTTP 404 & 413), In-Memory Model Cooldown, Non-Blocking Webhook Ingestion, dan Restorasi 100% Utuh Aturan Skills**

- **Restorasi Penuh 100% Aturan Prompt (`src/skills.ts`)**:
  - Menolak dan mengeliminasi seluruh pemangkasan aturan atau instruksi persona di `src/skills.ts`.
  - Memulihkan berkas `src/skills.ts` secara 100% utuh tanpa selisih (`git diff src/skills.ts` bersih 0 baris) demi menjamin guardrail anti-sycophancy, pembatasan tebak-tebakan, kontrol tone, dan integritas grounding tetap kokoh.
- **Fast-Break Circuit Breaker & Model-Level Cooldown (`src/providers.ts`)**:
  - **Penanganan HTTP 404 (Model Not Found)**: Jika model tidak terdaftar di endpoint provider (seperti kasus varian free xKiro yang dinonaktifkan upstream), sistem seketika memutus perulangan kunci (`break`) dan menandai model tersebut dalam status cooldown 30 menit. Menghilangkan 12 panggilan jaringan sia-sia yang sebelumnya mencoba seluruh API key secara berulang untuk model yang tidak ada.
  - **Penanganan HTTP 413 (Payload Too Large / ITPM Exceeded)**: Jika ukuran prompt melebihi kuota ITPM model (seperti limit 7.000 ITPM pada tier gratis Groq), sistem langsung melompat ke provider berikutnya (`break`) dan mencatat cooldown 15 menit, mencegah pemborosan 8 panggilan jaringan ke 4 API key Groq.
  - **Fast-Pass 0ms untuk Model Bermasalah**: Pada giliran obrolan berikutnya, model-model yang sedang dalam masa cooldown otomatis dilewati dalam 0ms, mengarahkan inferensi langsung ke model yang sehat.
  - **Koreksi & Isolasi Cooldown Kunci**: Memisahkan error model (404/413/50x) dari error kredensial (401/403). Kunci API tidak lagi dihukum atau dibekukan saat sebuah model mengalami server error (503), dan durasi pendinginan model dipersingkat menjadi 20 detik agar inferensi langsung mencoba kembali ke model tersebut begitu server xKiro pulih.
- **Non-Blocking Webhook Pre-Inference Ingestion (`src/whatsapp_cloud.ts`, `src/telegram.ts`)**:
  - Mengubah penyimpanan pesan masuk pengguna (`saveMessage`) menjadi asynchronous background task non-blocking (`void saveMessage(...).catch(...)`).
  - Mengeliminasi jeda blocking 300–600ms dari round-trip Supabase sebelum inferensi AI dimulai, karena pesan pengguna sudah tersimpan aman di cache memori instan (`updateContextCache`, 0ms).
- **Penyetelan Ambang Batas Timeout Jaringan (`src/env.ts`)**:
  - Mengoptimasi default `CONNECT_TIMEOUT_MS` dari 4.500ms menjadi 3.000ms untuk failover koneksi yang lebih agresif saat endpoint penyedia mengalami hang.
  - Mengoptimasi default `REQUEST_TIMEOUT_MS` menjadi 35.000ms yang aman untuk siklus serverless Vercel.

### v0.26.11 - 2026-09-12 21:05 WIB

**Penerapan Protokol Universal Anti-Sycophancy (Anti-Penjilat), Penegakan Integritas Faktual, dan Eliminasi Persetujuan Buta (*Zero Blind Yes-Man*)**

- **Prinsip Universal Anti-Sycophancy (Prinsip 0 di `src/skills.ts`)**:
  - **Akar Masalah**: Model AI memiliki bias bawaan (*sycophancy*) untuk selalu menyenangkan dan menyetujui pernyataan lawan bicara, termasuk mengarang-ngarang alasan pembenaran saat tebakan/fakta yang diutarakan pengguna sebenarnya keliru atau sekadar plesetan.
  - **Larangan Mutlak Menjadi "Yes-Man"**: Dilarang keras bot selalu mengangguk, membenarkan, atau pura-pura sepakat jika klaim pengguna secara fakta, logika, sains, matematika, atau aturan adalah keliru.
  - **Koreksi Santai & Bersahabat**: Jika pengguna membuat klaim salah (misal hitungan salah, fakta geografis keliru, atau logika bengkok), bot wajib meluruskan secara santai, jujur, dan membumi layaknya sahabat sejati yang tidak menjilat.
- **Integritas Kunci Jawaban Tebak-Tebakan (Bagian 3 `src/skills.ts`)**:
  - Bot wajib konsisten dengan 1 kunci jawaban baku saat melempar tebak-tebakan.
  - Jika tebakan pengguna bukan kunci jawaban asli lelucon tersebut (meskipun terdengar lucu/masuk akal seperti kasus "bebek goreng"), bot dilarang mengarang pembenaran dan wajib menyatakan dengan santai bahwa tebakannya meleset/salah.
- **Penegakan Grounding Matematika & Logika (Bagian 7 `src/skills.ts`)**:
  - Melarang bot mengaminkan perhitungan atau klaim angka yang salah dari pengguna (seperti 1+1=3 atau pembagian nol = 0).

### v0.26.10 - 2026-09-12 20:58 WIB

**Penyederhanaan Logika Konfigurasi Model xKiro (Refactoring Clean Code) & Otomasi Fallback Tanpa Dependensi Env Vercel**

- **Refactoring Bersih `src/env.ts`**:
  - Mengeliminasi kode perulangan `Set`, `for...of`, dan filter defensif berlapis yang redundan (*YAGNI*).
  - Mengganti seluruh blok tersebut dengan idiom TypeScript sederhana: jika `XKIRO_MODEL_BACKUPS` tidak ada (misalnya telah dihapus dari Dashboard Vercel), sistem otomatis langsung menggunakan 5 model cadangan terurut (`deepseek-v4-flash`, `qwen3.7-max`, `deepseek-chat-v3.1`, `qwen3.6-plus`, `deepseek-v4-pro`).
  - Memastikan deployment Vercel bebas perawatan manual (*zero-maintenance env*).

### v0.26.9 - 2026-09-12 20:55 WIB

**Restrukturisasi Urutan Model xKiro, Penegasan Failover Antar-Provider (xKiro -> Groq -> Gemini -> OpenRouter), dan Purging Multimodal Vision**

- **Restrukturisasi Urutan Prioritas Model Teks xKiro (`src/env.ts`, `.env`, `AGENTS.md`)**:
  - **Primer**: `qwen/qwen3.8-max:free` (Model teks utama dengan pemahaman konteks terbaik).
  - **Cadangan Terurut**:
    1. `deepseek/deepseek-v4-flash` (Cadangan 1 / failover kecepatan tinggi)
    2. `qwen/qwen3.7-max:free` (Cadangan 2 / penalaran presisi tinggi)
    3. `deepseek/deepseek-chat-v3.1` (Cadangan 3 / percakapan santai alami)
    4. `qwen/qwen3.6-plus:free` (Cadangan 4)
    5. `deepseek/deepseek-v4-pro` (Cadangan 5 / penalaran mendalam)
  - **Model yang Dieliminasi**: Menghapus total `qwen/qwen3.5-plus:free`, `qwen/qwen3.5-omni-plus:free`, `qwen/qwen3.7-plus:free` agar alur request tidak terdistraksi model lawas/bermasalah.
- **Urutan Bertingkat Lintas Provider (`src/providers.ts`)**:
  - **Tingkat 1**: xKiro (Primary: `qwen/qwen3.8-max:free` + 5 model cadangan di atas).
  - **Tingkat 2 (Jika xKiro gagal)**: Groq (Primary: `qwen/qwen3.8-27b`, Cadangan: `qwen/qwen3.6-27b`).
  - **Tingkat 3 (Jika Groq gagal)**: Gemini (Primary: `gemini-3.8-flash`, Cadangan: `gemini-2.5-flash`).
  - **Tingkat 4 (Failover Akhir)**: OpenRouter.
- **Pembersihan Model Multimodal Vision (`src/providers.ts`)**:
  - Menghapus model vision Mistral bermasalah (`mistral-medium-3.5` dan `mistral-small-2603`).
  - Menyisakan hanya 1 model vision Mistral paling waras dan tercepat (`mistralai/mistral-large-2512`, latensi 2.3s) di belakang model vision native Qwen: `qwen/qwen3.8-max:free` -> `qwen/qwen3.6-plus:free` -> `mistralai/mistral-large-2512`, disusul engine Gemini (`gemini-3.8-flash` -> `gemini-2.5-flash`).

### v0.26.8 - 2026-09-12 20:45 WIB

**Pembersihan Total Seluruh Varian Model Mistral, Eliminasi Refleks Tawa Monoton di Pembuka Pesan, dan Penangkalan Pertanyaan Basa-Basi Penutup (Anti-Eager Assistant)**

- **Pembersihan Total Seluruh Varian Mistral (`src/env.ts`, `AGENTS.md`, `.env`)**:
  - **Akar Masalah**: Model keluarga Mistral (`mistral-large`, `mistral-medium`, `mistral-small`) memiliki bias pelatihan bawaan (*RLHF eager assistant*) yang selalu menyodorkan tawaran pertanyaan basa-basi di akhir respon ("Jadi mau yang lagi? Aku siap kasih joke lagi atau mau cerita apa nih?") serta pembawaan gaya yang melantur dan over-acting.
  - **Tindakan**: Menghapus seluruh varian Mistral dari rantai failover gateway xKiro. Rantai failover kini 100% dialihkan dan dikawal murni oleh duet model elit **DeepSeek** (`deepseek-v4-flash`, `deepseek-chat-v3.1`, `deepseek-v4-pro`, `deepseek-v3.2`) dan **Qwen** (`qwen3.8-max`, `qwen3.7-max`, `qwen3.7-plus`, `qwen3.6-plus`, `qwen3.5-plus`).
- **Eliminasi Refleks Tawa Monoton di Awal Pesan (`src/skills.ts`)**:
  - Menghentikan pola kaku bot yang selalu mengawali respon lelucon/banyol dengan kata tawa ("Haha iya...", "Haha tepat...", "Wkwk iya aja...").
  - Mengarahkan bot untuk langsung masuk ke reaksi substansial yang natural seperti manusia asli mengobrol ("Tuh kan bener", "Hoki bener emang", "Nah itu dia jawabannya"), dengan tawa diletakkan secara wajar di tengah/akhir kalimat atau tanpa tawa jika respon sudah santai.
- **Pencegahan Tawaran Konten & Interogasi Lanjutan (`cleanMathAndNoise`, `src/skills.ts`)**:
  - Melarang keras bot menanyakan pertanyaan penutup yang memaksakan sesi obrolan berlanjut layaknya customer service (seperti "Mau yang lagi?", "Mau cerita apa nih?", "Ada yang mau diceritain lagi?").
  - Menambahkan filter regex otomatis untuk membersihkan sisa-sisa pola penawaran konten lanjutan.

### v0.26.7 - 2026-09-12 20:30 WIB

**Pendaftaran Deterministik Nomor WhatsApp Developer (Rafly) & Proteksi Identitas Anti-Impersonation**

- **Registrasi Kredensial Developer di Basis Data Supabase & Konfigurasi Lingkungan**:
  - Mendaftarkan akun WhatsApp resmi Rafly ke dalam tabel `corrections` Supabase dengan penanda otoritas resmi `IDENTITAS RESMI TERVERIFIKASI`.
  - Mengintegrasikan konfigurasi lingkungan `config.ownerWaNumber` (via `OWNER_WA_NUMBER` pada `.env` / environment variable) di [src/env.ts](file:///d:/code/project/projek_no_name/src/env.ts) tanpa hardcode string sensitif di repositori.
- **Verifikasi Deterministik & Eliminasi Asumsi Buta (`src/skills.ts`)**:
  - Menghentikan kebiasaan bot menebak-nebak nama Rafly secara sembarangan kepada pengguna umum.
  - Jika pengguna terverifikasi sebagai Rafly (melalui `OWNER_WA_NUMBER`, `ownerChatId`, atau record Supabase terverifikasi), bot mengenali penciptanya secara pasti, akrab, dan bersahabat ("Ingat jelas lah, kamu kan Rafly (Rflyyyf), pencipta yang ngoding dan ngerawat aku! Akun kamu sudah terdaftar resmi di database.").
  - Jika pengguna lain (nomor tidak terdaftar) mencoba mengaku-ngaku sebagai Rafly atau developer, bot secara deterministik menolak klaim tersebut dengan tegas dan santai ("Bukan ah, Rafly asli nomornya bukan ini haha. Jangan ngaku-ngaku ya!").

### v0.26.6 - 2026-09-12 20:20 WIB

**Tuning Persona Dinamis High-EQ, Penggunaan Emoji Kontekstual Tepat Waktu, Prioritas Failover DeepSeek, dan Sinkronisasi Persistensi Awaited Serverless**

- **Restorasi Tuning Interaksi Alami & Gradual Pacing Persona (Acuan v0.25.1)**:
  - **Sapaan Awal & Ping Singkat Bersahaja**: Sapaan singkat atau ping awal ("oyyy", "p", "halo", "lagi apa") kini disambut dengan tenang, hangat, dan membumi (contoh: "Oy, ada apa nih?", "Iya halo, kenapa?"). Menghilangkan total pembuka tawa histeris "Hahaha" yang tidak dipicu kelucuan, eliminasi lelucon halusinasi aneh ("nyanyi Oyyy seperti lagu lama"), dan penghapusan interogasi klise opsi ganda di pesan pembuka.
  - **Penggunaan Emoji Dinamis & Kontekstual**: Emoji diperbolehkan secara tepat waktu dan proporsional (maksimal 1 emoji per pesan) saat konteks percakapan memang hangat, banyol, menghibur, atau memberi semangat, dan dinonaktifkan pada sapaan awal/formal agar tidak terkesan over-react atau cringe.
  - **Adaptasi Dinamis & Penyelarasan Alur Suasana**: Gaya bahasa bot 100% membaca situasi dan emosi percakapan pengguna (dynamic style mirroring). Respons santai jika santai, empati tulus jika pengguna curhat lelah/capek, dan playfully banter jika pengguna bercanda/meledek.
- **Restrukturisasi Failover Model & Eliminasi Halusinasi Mistral Medium (`src/env.ts`)**:
  - Model DeepSeek native (`deepseek/deepseek-v4-flash`, `deepseek/deepseek-chat-v3.1`, `deepseek/deepseek-v4-pro`) diposisikan pada prioritas teratas rantai failover xKiro mendahului model lain.
  - Mengeluarkan `mistralai/mistral-medium-3.5` dan `mistralai/mistral-small-2603` dari inferensi chat teks untuk mencegah kemunculan terjemahan rusak ("ngoyy begini", "nge-venta lelah", unprompted emojis).
- **Penegakan Awaited Persistence di Vercel Serverless (`src/telegram.ts`, `src/whatsapp_cloud.ts`)**:
  - Seluruh pemanggilan `saveMessage` untuk balasan asisten kini di-`await` secara sinkron sebelum siklus request HTTP selesai. Hal ini mencegah Vercel Lambda membekukan atau mematikan proses penyimpanan sebelum data terkirim ke Supabase, menuntaskan masalah riwayat asisten kosong di Dashboard.
  - Penyeragaman klaim pesan atomik Telegram (`claimIncomingMessage`) untuk berbagai jenis media (`[Gambar]`, `[Pesan Suara]`, `[Dokumen]`, dll).

### v0.26.5 - 2026-09-12 19:20 WIB

**Hardening Operasional & Observabilitas: CSP Tanpa `unsafe-inline`, Lease-Lock Pengingat `lease_until`, Migrasi Ops v17 (Ledger + RTBF), Structured Logger, dan Instrumentasi Dataset**

- **Perbaikan CSP Dashboard Tanpa `unsafe-inline` (`vercel.json`, `public/dashboard.html`, `public/js/*.js`)**:
  - Seluruh event handler inline (`on*=`) pada `public/**/*.html` dihapus dan dipindahkan menjadi pengikatan `addEventListener` di berkas terisolasi `public/js/dashboard.js`, `public/js/dashboard-pre.js`, dan `public/js/home.js`.
  - `script-src` kini hanya `'self'` (tanpa `unsafe-inline` dan tanpa `unsafe-eval`), diperkuat `base-uri 'self'; object-src 'none'; frame-ancestors 'none';`.
  - Menghapus domain `cdn.jsdelivr.net` yang sudah tidak terpakai dari CSP.
- **Lease-Lock Pengingat `lease_until` & Fallback Reaper Aman (`src/remind.ts`)**:
  - Klaim pengingat jatuh tempo menggunakan kolom sewa atomik `lease_until = now() + 10 minutes` pada status `'processing'` tanpa memodifikasi `due_at` asli.
  - Reaper utama hanya me-reset baris dengan `lease_until <= now()`; fallback reaper terpisah hanya menyasar baris `lease_until IS NULL` (database pra-migrasi) dengan ambang aman 30 menit agar tidak mengganggu pengiriman aktif yang lama.
  - Status `sent`/`failed` dan pelepasan sewa (`lease_until = null`) hanya ditulis setelah konfirmasi keberhasilan/kegagalan dari client API.
- **Migrasi Operasional v17 (`sql/migrate_v17_ops.sql`)**:
  - Ledger migrasi `public.schema_migrations` (RLS + akses `service_role` saja) dengan pencatatan idempotent v08..v17.
  - Indeks retensi `idx_messages_created_at` untuk pemindaian pesan lama.
  - Kolom instrumentasi nullable pada `messages`: `latency_ms`, `needs_search`, `split_count`, `prompt_version`, `feedback`.
  - RPC service_role-only `rpc_purge_user_data(p_chat_id text)` (RTBF) dan `rpc_purge_expired_web_knowledge()`.
- **Endpoint RTBF Terautentikasi (`api/admin-otp.ts`)**:
  - Aksi baru `purge_user_data` (memerlukan session token; `401` bila token tidak valid, `400` bila `chat_id` kosong) memanggil `rpc_purge_user_data` dan mengembalikan jumlah baris terhapus.
  - Aksi baru `purge_expired_knowledge` (memerlukan session token) memanggil `rpc_purge_expired_web_knowledge`.
  - Aksi lama tidak diubah; tidak ada jalur akses tanpa autentikasi.
- **Structured Logging (`src/logger.ts`)**:
  - Logger JSON satu-baris tanpa dependensi eksternal dengan mode `LOG_PRETTY=1` opsional; dipasang di entrypoint `src/index.ts`, `api/webhook.ts`, dan `api/whatsapp.ts`.
- **Instrumentasi Dataset (`src/db.ts`, `src/telegram.ts`, `src/whatsapp_cloud.ts`, `src/whatsapp_baileys.ts`)**:
  - `saveMessage` mengirim kolom opsional `latency_ms`, `needs_search`, dan `prompt_version` (`v0.26.5`) secara best-effort untuk evaluasi fine-tuning.
- **Pembersihan Kode Mati (`src/quota.ts`, `src/providers.ts`)**:
  - Menghapus helper `keyAllowed` yang tidak lagi dipakai setelah hidrasi kuota eksplisit.
- **Pemulihan Toleransi Webhook Meta WhatsApp Cloud API (`src/whatsapp_cloud.ts`, `src/env.ts`)**:
  - Memperbaiki regresi fail-closed signature Meta di mana webhook otomatis menolak seluruh pesan (HTTP 401) jika `WHATSAPP_APP_SECRET` belum terpasang di environment variable Vercel.
  - Menjadikan verifikasi HMAC SHA-256 aktif jika secret ada, dan beralih ke fallback terproteksi Verify Token handshake jika secret belum diset agar bot tidak mengalami pemadaman total.
- **Preservasi Konten Teks Asli Pengguna di WhatsApp Cloud (`src/whatsapp_cloud.ts`)**:
  - Memperbaiki bug pada klaim atomik webhook di mana isi pesan teks pengguna tersimpan sebagai placeholder statis `[text]` ke database, yang menyebabkan konteks percakapan di Supabase menjadi kosong dan AI kehilangan topik obrolan.
  - Mengekstrak teks riil pengguna secara langsung pada `claimIncomingMessage` dan memastikan sinkronisasi teks pesan ke tabel `messages` Supabase.
- **Restorasi Prioritas Failover Model xKiro (`src/env.ts`, `.env`)**:
  - Menyelaraskan urutan model cadangan xKiro ke `deepseek/deepseek-v4-flash` sebagai prioritas pertama saat `qwen/qwen3.8-max:free` mengalami kendala upstream, menyingkirkan `mistralai/mistral-medium-3.5` yang rentan over-reacting dan menghasilkan lelucon repetitif di luar konteks.

### v0.26.4 - 2026-09-12 18:35 WIB

**Penyelesaian Menyeluruh Seluruh Sisa Audit Putaran 4: Auto-Provisioning Random PIN First-Run, Eliminasi Race Reaper Reminders, Dedup Upsert Platform & msg_id 3 Channel, Verifikasi OTP RPC Atomik, Pembersihan False-Positive Zona Waktu, dan Penyelarasan Penuh Dokumen AGENTS.md**

- **Auto-Provisioning Master PIN Acak First-Run (`src/admin_auth.ts`)**:
  - Jika database belum memiliki konfigurasi PIN dan variabel `ADMIN_PIN` kosong di environment, sistem secara otomatis membangkitkan PIN 6-digit acak aman via CSPRNG (`crypto.randomInt`), menyimpan hash-nya ke database, dan menampilkan instruksi di console satu kali.
- **Eliminasi Race Condition Reaper vs In-Flight Reminders (`src/remind.ts`)**:
  - Saat reminder diklaim ke status `'processing'`, `due_at` dimundurkan ke masa depan (`now + 5 minutes`) sebagai batas sewa (lease-lock).
  - Background reaper diubah untuk hanya me-reset baris jika `status = 'processing' AND due_at <= now`, mencegah pengiriman pengingat dobel saat proses kirim sedang berlangsung.
- **Deduplikasi Pesan Handal & Eliminasi Unique Violation 23505 (`src/db.ts`, `src/telegram.ts`, `src/whatsapp_baileys.ts`, `src/whatsapp_cloud.ts`)**:
  - Fungsi `saveMessage` menggunakan mekanisme `upsert` pada `(platform, msg_id)` saat `msg_id` disertakan, sehingga pembaruan caption media atau transkripsi suara tidak memicu duplicate key error 23505.
  - Menghapus pengecekan rapuh `data.length > 0` di `claimIncomingMessage` dan memastikan klaim berhasil dievaluasi berdasarkan `!error`.
  - Menyertakan `msg_id` pada seluruh alur pesan media user di Telegram dan WhatsApp Baileys.
- **Eksekusi Atomik Reset PIN via OTP (`src/admin_auth.ts`)**:
  - Mengintegrasikan pemanggilan stored procedure atomik `rpc_admin_verify_otp_and_reset_pin` yang dilindungi baris `FOR UPDATE` di tingkat database dengan fallback ke mesin JS.
- **Pembersihan False-Positive Singkatan Zona Waktu (`src/timezone.ts`)**:
  - Menghapus singkatan kata pendek ambigu (`brt`, `art`, `sast`, `eat`) dari peta lokasi agar percakapan biasa ("seni art", "eat dulu") tidak memicu pergeseran zona waktu palsu ke Argentina atau Kenya.
- **Optimasi Akurasi `needsSearch` & Query Statistik (`src/web.ts`, `api/stats.ts`)**:
  - Memperketat regex kata kunci recency agar tidak memicu penelusuran web live untuk kata tunggal "terbaru" atau "rilis" tanpa konteks berita/produk, dan menghapus fallback panjang string > 25 karakter.
  - Memperluas limit query agregasi statistik pesan asisten hingga 2.000 baris untuk mencegah pemotongan data representatif.
- **Standardisasi Header Keamanan Global & Penyelarasan `AGENTS.md` (`vercel.json`, `api/*.ts`, `AGENTS.md`)**:
  - Menyatukan header `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` dan `Referrer-Policy: strict-origin-when-cross-origin` di seluruh endpoint API dan konfigurasi Vercel.
  - Memperkuat CSP dengan direktif `base-uri 'self'; object-src 'none'; frame-ancestors 'none';`.
  - Menyelaraskan seluruh 8 poin dokumentasi `AGENTS.md` agar 100% akurat dengan implementasi kode aktual.

### v0.26.3 - 2026-09-12 18:05 WIB

**Eliminasi Sisa Regresi Konkurensi & Hardening Penuh: Auto-Reaper Pengingat & Lease Lock 5 Menit, Deduplikasi Atomik Anti-TOCTOU 3 Channel, Row-Level Locking FOR UPDATE Admin Auth, Sanitasi Prompt Injection Hasil Web Live, dan Header Keamanan Global**

- **Reminder Deadlock Auto-Reaper & Lease-Lock Atomik (`src/remind.ts`)**:
  - Menambahkan mekanisme auto-reaper di awal `checkDueReminders()` untuk memulihkan entri status `processing` yang macet lebih dari 5 menit kembali menjadi `pending`.
  - Mengganti fallback penandaan dini `sent` dengan perpanjangan sewa waktu atomik (`due_at = now() + 5 minutes`) jika database tidak mendukung status `processing`. Penandaan status `sent` dijamin HANYA dieksekusi setelah pesan terbukti berhasil terkirim via client API.
- **Deduplikasi Pesan Atomik Tanpa Celah TOCTOU (`src/db.ts`, `src/telegram.ts`, `src/whatsapp_cloud.ts`, `src/whatsapp_baileys.ts`)**:
  - Mengimplementasikan `claimIncomingMessage(platform, msgId, chatId, content)` dengan strategi _insert-as-first-claim_ langsung ke tabel `messages`.
  - Mengandalkan Postgres unique constraint `idx_messages_platform_msg_id` (PostgreSQL Error 23505) untuk menolak webhook retry konkuren dalam skala sub-milidetik secara 100% konsisten.
- **Lockout Atomicity & Row Locking `FOR UPDATE` (`sql/migrate_v12_admin_auth.sql`, `sql/migrate_v16_security_hardening_and_rpc.sql`, `src/admin_auth.ts`)**:
  - Menambahkan baris `FOR UPDATE` pada `SELECT ... FROM public.admin_auth_config WHERE id = 'master_auth' FOR UPDATE;` di seluruh stored procedure verifikasi PIN dan reset OTP untuk mencegah bypass lockout melalui brute-force paralel.
  - Membuat stored procedure baru `rpc_admin_change_pin(p_old_pin_hash, p_new_pin_hash)` dengan row lock atomik dan mengintegrasikannya ke `src/admin_auth.ts:updatePin`.
  - Membungkus `sql/migrate_v16` dalam blok `DO $$ BEGIN IF EXISTS ... END $$;` agar migrasi bersifat order-independent (tidak gagal bila urutan eksekusi dibalik).
- **Sanitasi Prompt Injection Hasil Web Live (`src/skills.ts`)**:
  - Menyaring teks data pencarian web real-time menggunakan `sanitizeKnowledgeText` sebelum digabungkan ke instruksi model, memblokir upaya indirect prompt injection dari artikel eksternal.
- **Security Headers Global & Pembersihan Template Kredensial (`vercel.json`, `.env.example`)**:
  - Menerapkan Content Security Policy (CSP) dan HTTP Strict Transport Security (HSTS) berdurasi 2 tahun secara global di `vercel.json` pada route `/(.*)`.
  - Mengosongkan contoh nilai `PIN_SALT=` dan `ADMIN_PIN=` di `.env.example` untuk memastikan konfigurasi aman secara default.
- **Dokumentasi Arsitektur Agen (`AGENTS.md`)**:
  - Menuliskan dokumen arsitektur komprehensif `AGENTS.md` di root repositori mencakup gateway failover, webhook pipeline, concurrency control, dan guardrails keamanan.

### v0.26.2 - 2026-09-12 17:45 WIB

**Penyelesaian Seluruh Sisa Audit Putaran 2 (v0.26.1): Klaim Atomik Pengingat, Deduplikasi Persisten msg_id 3 Channel, Raw Body HMAC Meta, Quota Hydration Race, MIME Sniffing, Lockout 15 Menit & Proteksi Master Auth**

- **R1 & E1: Eliminasi Race Condition Kirim Pengingat Ganda (`src/remind.ts`)**:
  - Menambahkan `.select('id')` pada pembaruan klaim status `'processing'` dan fallback direct CAS ke `'sent'`.
  - Memeriksa jumlah baris terdampak secara ketat: jika 0 baris ter-update (berarti pengingat sudah diklaim worker atau cron lain), eksekusi langsung `continue` melewati proses pengiriman.
- **C1, C3, E2, E7: Hardening Admin Auth, Pencegahan Lockout Permanen & Atomik RPC (`src/admin_auth.ts`, `sql/migrate_v12_admin_auth.sql`, `sql/migrate_v16_security_hardening_and_rpc.sql`, `.env.example`)**:
  - Menghapus toleransi input 64-char langsung dari client; server sekarang mewajibkan kalkulasi `hashValue(input)` secara server-side.
  - Mengintegrasikan pemanggilan RPC `rpc_admin_verify_pin` atomik di tingkat PostgreSQL dengan fallback aman ke mesin JS.
  - Memperbaiki `sql/migrate_v16`: mengubah DELETE `master_auth` menjadi UPSERT netralisasi `pin_hash = NULL`, `lockout_attempts = 0`, `locked_until = NULL` agar baris `master_auth` tetap ada dan fitur OTP reset tidak menyebabkan lockout permanen.
  - Menyediakan first-run auto provisioning `pin_hash` ke database jika belum terkonfigurasi tetapi `ADMIN_PIN` ada di environment.
  - Mengubah durasi lockout SQL `migrate_v12` dari `'1 minute'` menjadi `'15 minutes'` dan menambahkan `REVOKE ALL ... FROM PUBLIC, anon, authenticated` sebelum `GRANT ... TO service_role`.
  - Membersihkan salt statis dari `.env.example` dan menyertakan panduan salt unik minimal 16 karakter beserta `ADMIN_PIN`.
- **D2 & E3: Raw Body Streaming Webhook Meta WhatsApp HMAC (`api/whatsapp.ts`)**:
  - Mengaktifkan `export const config = { api: { bodyParser: false } };`.
  - Membaca stream Buffer mentah (`readRawBody`) sebelum payload di-parse untuk validasi tanda tangan `x-hub-signature-256` secara kriptografis akurat.
- **C5 & E8: Resolusi Quota Hydration Race (`src/quota.ts`, `src/providers.ts`)**:
  - Memindahkan penandaan `hydratedKeys.add` hanya jika pembacaan tabel `provider_quota` berhasil mengembalikan data (mencegah sticky failure sepanjang hari akibat error transien).
  - Menyediakan fungsi `ensureKeyQuotaHydrated(kind, key)` dan melakukan `await` sebelum evaluasi `keyAllowed` di `src/providers.ts` untuk mencegah cold-start over-quota.
- **D4 & E4: Aktivasi Efektif MIME Magic-Byte Sniffing (`src/media.ts`)**:
  - Menerapkan `effectiveMime` hasil sniffing buffer secara konsisten pada seluruh percabangan dokumen Word (.docx), berkas teks/kode sumber, dan dokumen PDF untuk menangkal MIME spoofing secara nyata.
- **D3: Deduplikasi Persisten Menggunakan Kolom msg_id di 3 Channel (`src/db.ts`, `src/whatsapp_cloud.ts`, `src/telegram.ts`, `src/whatsapp_baileys.ts`)**:
  - Menambahkan kolom `msg_id` pada pemanggilan `saveMessage` dan mengekspor fungsi `isMessageProcessed(platform, msgId)`.
  - Mencegah pemrosesan pesan duplikat pada Telegram (pesan & webhook update_id), Meta WhatsApp Cloud, dan WhatsApp Baileys secara lintas container serverless.
- **E5: Eliminasi Regex Collision Keyword Lokasi GPS (`src/timezone.ts`)**:
  - Meng-escape karakter regex khusus (`+`, `.`, dll.) saat kompilasi keyword lokasi dan memisahkan keyword WITA/WIT/WIB dari label generic `UTC+8`.
- **E9 & D5: Parameter Limit Ekspor & Header Keamanan Publik (`api/dataset.ts`, `vercel.json`)**:
  - Menghormati parameter `req.query.limit` pada ekspor JSONL/CSV (`api/dataset.ts`).
  - Menambahkan security headers (CSP, nosniff, DENY, strict-origin) untuk seluruh rute file statis di `vercel.json`.

### v0.25.33 - 2026-09-12 15:18 WIB

**Fitur Universal /reset Sesi Bersih, Pemotong Riwayat Checkpoint Supabase, & Sinkronisasi Lintas WhatsApp & Telegram**

- **Mekanisme Checkpoint Reset Sesi Non-Destruktif (`src/memory.ts`)**:
  - Menyediakan perintah universal `/reset`, `/clear`, `reset sesi`, `mulai sesi baru`, `clear chat`, `hapus riwayat`, `reset chat`.
  - **Prinsip Anti-Penghapusan Data**: Tidak menghapus rekaman riwayat pesan di tabel `messages` Supabase sehingga data log evaluasi di CSV/JSONL dan dasbor tetap 100% utuh dan akurat.
  - Menyematkan baris penanda checkpoint `[SESSION_RESET]` pada riwayat percakapan nomor akun tersebut, membersihkan ringkasan `summaries` lama, dan memusnahkan cache lokal `contextCache`.
  - Pada pembacaan memori berikutnya (`getContext`), seluruh pesan yang terjadi sebelum titik checkpoint reset otomatis dipotong dan diabaikan, sehingga memori model AI langsung kembali segar murni ke baseline awal (~5.500 token, zero noise).
- **Sinkronisasi Terpadu Lintas Saluran (`src/telegram.ts`, `src/whatsapp_baileys.ts`, `src/whatsapp_cloud.ts`)**:
  - Diintegrasikan secara identik dan serentak pada Telegram Bot, WhatsApp Baileys Multi-Device, dan Meta WhatsApp Cloud API.
  - Respon bot diformat lugas, bersih, dan elegan tanpa basa-basi penutup CS: _"Sesi percakapan berhasil di-reset. Memori aktif sudah kembali bersih."_.

### v0.25.32 - 2026-09-12 15:08 WIB

**Penyetelan Sweet Spot Riwayat Konteks Aktif (24 Pesan Teks & 8 Pesan Vision) untuk Keseimbangan Memori dan Latensi Cepat**

- **Penyetelan Sliding Window Memori Aktif (`src/memory.ts`, `src/skills.ts`)**:
  - Menetapkan kuota penarikan riwayat percakapan dari basis data Supabase (`getContext`) menjadi 24 pesan (`limit(24)`).
  - Menyelaraskan pemotongan riwayat pesan teks aktif pada `buildMessages` (`src/skills.ts`) menjadi `slice(-24)` (mencakup 12 putaran tanya-jawab bolak-balik).
  - Menjaga model merespons dengan cepat (< 2 detik) dengan retensi obrolan aktif yang kokoh di kisaran ~8.000 – 9.800 token.
- **Kapasitas Konteks Multimodal Stiker & Foto Cepat (`src/skills.ts`)**:
  - Menetapkan jangkauan riwayat pesan untuk model vision (`describeImage`) pada 8 pesan (`slice(-8)`), menjaga analisis stiker/gambar memahami obrolan terakhir secara akurat dengan inferensi penglihatan yang ringan.

### v0.25.31 - 2026-09-12 14:44 WIB

**Eliminasi Total Filler Slop Penutup ("santai aja terus bro"), Ekstraksi Nama Kota Spesifik Memori, & Pencegahan False-Positive DKI Jakarta**

- **Eliminasi Total Frasa Penutup Filler Sok Asik (`src/skills.ts`, `src/timezone.ts`)**:
  - **Akar Masalah**: Saat mengonfirmasi lokasi pengguna, model AI menambahkan celetukan penutup klise yang tidak diminta (_"santai aja terus bro"_). Hal ini disebabkan instruksi lama _"Lanjutkan obrolan dengan santai mengikuti konteksnya"_ yang memicu model mengisi kekosongan konteks dengan filler sok akrab (_try-hard slop_).
  - **Penetapan Aturan Anti-Filler Slop di Prinsip 2**: Melarang keras menempelkan celetukan penutup klise di akhir balasan seperti _"santai aja terus bro"_, _"santai aja bro"_, _"santai aja dulu"_, _"semangat terus ya"_, _"tetap semangat bro"_, _"santuy aja"_. Jika jawaban sudah tuntas, balasan selesai di situ tanpa embel-embel tidak perlu.
  - **Penyaring Otomatis Rule 14e (`cleanMathAndNoise`)**: Menambahkan pembersih regex otomatis yang memotong sisa-sisa celetukan penutup filler klise di akhir kalimat jika model secara tak sengaja memuntahkannya.
- **Pencegahan False-Positive DKI Jakarta pada String Memori IANA (`src/timezone.ts`)**:
  - **Akar Masalah**: Ketika profil memori memuat `"(Zona Waktu: Asia/Jakarta)"`, `detectLocation` mencocokkan substring `"jakarta"` pada identifier zona waktu IANA tersebut sebelum kata kota riil pengguna terbaca, sehingga bot keliru mengira pengguna berada di DKI Jakarta.
  - **Solusi**: Membersihkan identifier zona waktu IANA (`asia/jakarta`, dll) dari teks input sebelum pencarian kata kunci lokasi, sehingga lokasi spesifik pengguna terbaca secara akurat.
- **Preservasi Nama Kota Spesifik ke Memori Persisten (`src/timezone.ts`, `src/skills.ts`)**:
  - Menambahkan `matchedKeyword` pada antarmuka `LocationMatch` dan `detectLocation`.
  - Menyimpan nama kota spesifik (contoh: _Cianjur, Jawa Barat / WIB_) ke tabel Supabase `corrections` dan array memori aktif.
  - Menyelaraskan record database Supabase untuk akun WhatsApp developer sehingga kota Cianjur terkunci permanen dan langsung dikenali saat pengguna bertanya jam di masa mendatang.

### v0.25.30 - 2026-09-12 14:36 WIB

**Penghapusan Refleks Pembuka "Wah", Pembatasan Slang "bjir", Batasan Tawa "wkwk", dan Peningkatan Kepekaan Maksud Tersembunyi (Read Between the Lines)**

- **Eliminasi Kata Seru Pembuka "Wah" secara Refleks (`src/skills.ts`)**:
  - Melarang keras bot membuka balasan secara latah/refleks dengan kata seru "Wah" (seperti _"Wah tumben..."_, _"Wah iya..."_, _"Wah bener..."_).
  - Mengarahkan bot untuk langsung memulai kalimat secara alami dan mengalir layaknya orang mengobrol biasa di WhatsApp tanpa kata seru pembuka.
- **Pengkondisian Bahasa Santai Bersih Tanpa Slang Kasar (`!userHasSlang`, `src/skills.ts`)**:
  - **Akar Masalah**: Saat lawan bicara mengetik kalimat santai biasa/normal tanpa kata gaul (contoh: _"itu anjing lagi pose love buat kamu"_, _"kamu bisa apa aja"_, _"tes"_), sistem sebelumnya belum memiliki panduan khusus sehingga model secara otomatis mengasumsikan persona gaul dan menjejalkan kata _"bjir"_.
  - **Penetapan Aturan Mutlak**: Kata gaul seperti _"bjir"_ atau _"anjir"_ boleh ada sesekali, tetapi DILARANG KERAS muncul di setiap respon! Jika lawan bicara mengetik dengan kalimat biasa tanpa slang, bot DILARANG menyelipkan kata "bjir" atau "anjir", melainkan wajib menggunakan bahasa percakapan santai Indonesia yang bersih, hangat, dan natural.
- **Batasan Tawa ("wkwk" / "haha" Bukan Tanda Titik Wajib, `src/skills.ts`)**:
  - Melarang keras menjadikan tawa "wkwk" sebagai pengganti tanda titik di akhir semua pesan.
  - Jika mengobrol biasa, menjawab pertanyaan, atau memberikan informasi santai tanpa hal yang menggelitik lucu, bot mengakhiri kalimat dengan tanda titik (.) biasa tanpa tawa.
- **Kepekaan Membaca Maksud Tersembunyi / Pesan Tersirat (Read Between the Lines & High-EQ Companion, `src/skills.ts`)**:
  - Mengasah kepekaan AI dalam memahami emosi dan maksud tersirat di balik pesan pengguna:
    - Saat pengguna mengirimkan stiker anjing pose love dan mengetik _"itu anjing lagi pose love buat kamu"_: bot memahami bahwa pengguna sedang bersikap manis, bercanda ramah, atau menggoda akrab (_playfully teasing_). Bot menyambut dengan hangat, senang, atau candaan balik yang manis (_"Haha gemes banget, makasih ya udah dikasih love."_), serta melarang respons sarkastik, sinis, atau meratapi nasib (_"anjing aja lebih romantis bjir wkwk"_).
    - Menjaga resonansi emosional tetap hangat, tulus, dan manusiawi selayaknya sahabat karib sejati.
- **Sanitasi Contoh Negatif Panduan Stiker (`src/skills.ts`)**:
  - Mengeliminasi contoh stiker yang mengandung kata "anjir" dan penumpukan tawa agar tidak menjadi umpan tiruan (_negative priming_) bagi model AI.

### v0.25.29 - 2026-09-12 14:25 WIB

**Eliminasi Total Dongeng & Khayalan Stiker, Respons 1 Kalimat Pendek WhatsApp, dan Prioritas Vision Qwen 3.8 Max**

- **Eliminasi Total Cerita / Dongeng Khayalan Stiker (`src/skills.ts`, `src/media.ts`)**:
  - **Akar Masalah**: Saat pengguna mengirimkan stiker anjing berpose split dengan tangan membentuk cinta (love), model AI sebelumnya melantur mengarang cerita fiktif dua paragraf tentang tantangan TikTok (#DogDanceChallenge), anjing jadi dancer profesional, jalan-jalan di pantai, influencer hewan lokal, hingga memamerkan otot-otot kokoh dengan taburan emoji slop (😂🐾).
  - **Larangan Mutlak Cerita Fiktif (Zero Fanfiction / Anti-Hallucination Directives)**:
    - Melarang keras model mengarang cerita, dongeng fiktif, profesi khayalan (dancer/atlet/influencer), kompetisi/tren TikTok, tempat fiktif (pantai/panggung), atau narasi otot saat melihat stiker.
    - Menegaskan bahwa stiker chat WhatsApp/Telegram adalah gestur emosional atau banyolan ekspresif dalam obrolan, BUKAN bahan analisis gambar atau materi penulisan essay/cerita pendek.
- **Standarisasi Panjang Respons Stiker Menjadi 1 Kalimat Pendek (5-12 Kata)**:
  - Mewajibkan respons stiker hanya terdiri dari 1 kalimat santai dan proporsional layaknya teman mengobrol di WhatsApp. DILARANG membuat dua paragraf atau esai panjang.
  - Tanggapan langsung fokus pada keimutan/kelucuan/ekspresi pose stiker (contoh: _"Wkwk lucu banget posenya split love gitu"_, _"Gemes banget posenya wkwk"_, _"Buset lentur amat tuh anjing haha"_).
- **Penyelarasan Prioritas Model Vision Flagship (`src/providers.ts`)**:
  - Menggeser `qwen/qwen3.8-max:free` ke posisi **#1** pada daftar `visionModels` xKiro, menggantikan `mistralai/mistral-large-2512` yang terbukti rentan berhalusinasi mengarang cerita fiktif panjang.
  - Pengujian empiris membuktikan Qwen 3.8 Max merespons penglihatan gambar dalam latensi sub-detik (766ms), taat pada batasan satu kalimat, dan bebas dari halusinasi cerita.
- **Integrasi Riwayat Percakapan (Context Passing) ke Vision Engine (`src/media.ts`, `src/skills.ts`)**:
  - Memperbaiki `processIncomingSticker` dan `describeImage` untuk menerima dan mengalirkan `ctx?: ChatContext`.
  - Menyuntikkan 4 pesan riwayat terakhir ke dalam array pesan model vision, sehingga model memahami alur percakapan sebelumnya dan merespons stiker secara seirama dengan topik obrolan yang sedang berlangsung.
  - Mengalirkan `context` pada seluruh saluran pesan gambar dan stiker di WhatsApp Cloud API, WhatsApp Baileys, dan Telegram Bot API.
- **Pembersihan Multi-Layer Post-Sanitizer Respon Stiker (`cleanMathAndNoise`, `describeImage`)**:
  - Otomatis memangkas kalimat template klise (_"Wah, stiker seru nih!"_, _"Wah stiker lucu..."_).
  - Otomatis menghapus seluruh hashtag fiktif (`#...`) dan emoji slop (`😂`, `🐾`, `🤖`).
  - Memotong keluaran model menjadi kalimat pertama saja dan membatasi panjang maksimal 120 karakter jika model masih melantur.

### v0.25.28 - 2026-09-12 14:05 WIB

**Sinkronisasi Katalog 9 Model xKiro di Dashboard & Eliminasi Estimasi Token Palsu Menjadi Upstream Real Usage**

- **Sinkronisasi Katalog Model Monitoring Dashboard (`public/dashboard.html`, `api/stats.ts`)**:
  - Menyelaraskan 100% matriks model inferensi AI di dashboard dengan susunan runtime 9 model xKiro yang aktif dan terbukti valid di `.env` dan `src/env.ts`:
    1. `qwen/qwen3.8-max:free` (Flagship #1)
    2. `mistralai/mistral-medium-3.5`
    3. `deepseek/deepseek-v4-flash`
    4. `mistralai/mistral-large-2512`
    5. `deepseek/deepseek-chat-v3.1`
    6. `qwen/qwen3.7-max:free`
    7. `deepseek/deepseek-v4-pro`
    8. `qwen/qwen3.6-plus:free`
    9. `mistralai/mistral-small-2603`
  - Mengeliminasi model usang dari antarmuka matriks (varian MiniMax, Codestral 2508, SenseNova 6.8).
  - Menyelaraskan model cadangan bawaan di `api/stats.ts` dari SenseNova menjadi `mistralai/mistral-medium-3.5`.
- **Eliminasi Estimasi Formula Token Palsu & Penangkapan Upstream Ground Truth (`api/dataset.ts`, `src/providers.ts`)**:
  - **Akar Masalah**: Sebelumnya kolom token di tabel dataset menggunakan estimasi rumus statis buatan `const contextTokens = 650 + promptTokens`, sehingga seluruh data berkisar 600-800 token padahal konsumsi riil xKiro jauh lebih besar.
  - **Penghapusan Rumus Estimasi**: Menghapus total formula buatan 650 token pada `api/dataset.ts`. Dataset kini murni berstatus data ground truth tanpa manipulasi.
  - **Ekstraksi Token Riil dari Provider**:
    - `src/providers.ts`: Memperbarui `openAiChat` (xKiro, Groq, OpenRouter) untuk mengekstrak `data.usage: { prompt_tokens, completion_tokens, total_tokens }`, serta `geminiChat` untuk mengekstrak `data.usageMetadata: { promptTokenCount, candidatesTokenCount, totalTokenCount }`.
    - Interface `Step` dan `chat()` kini mengembalikan objek `{ text, via, tokens }`.
  - **Preservasi Metadata Token di Supabase Database**:
    - `src/db.ts`: Fungsi `saveMessage` menerima opsi `tokens` dan mengenkapsulasi metadata token ke dalam field `via` dengan penanda `#t=prompt,completion,total` secara 100% backward-compatible tanpa downtime atau perubahan skema paksa.
    - Disediakan skrip migrasi kolom mandiri `sql/migrate_v15_message_tokens.sql` untuk kolom `prompt_tokens`, `completion_tokens`, `total_tokens` di tabel `messages`.
  - **Integrasi Lintas Platform Handler (`whatsapp_cloud.ts`, `whatsapp_baileys.ts`, `telegram.ts`)**:
    - Seluruh pemrosesan teks, media, dokumen, stiker, dan video kini meneruskan objek token asli saat menyimpan balasan bot ke basis data.
- **Visualisasi Indikator Real Usage & Sanitasi Tag Model (`public/dashboard.html`)**:
  - Menambahkan badge hijau `Real Usage` pada baris tabel dataset evaluasi untuk percakapan yang mencatat token upstream asli terverifikasi.
  - Menambahkan sanitasi string `.split('#')[0]` pada parser model di `public/dashboard.html` dan `api/stats.ts` agar tag token `#t=...` tidak memecah agregasi matriks atau MRU inferensi.
  - Temuan empiris membuktikan konsumsi prompt token komprehensif sistem bot sebenarnya adalah ~5.440 token (bukan 650 token), kini selaras 100% dengan log monitoring upstream xKiro.

### v0.25.27 - 2026-09-12 13:30 WIB

**Ekspansi Pool xKiro API Key Menjadi 3 Kunci (Kapasitas Kuota 15.000.000 Token/Hari) & Sinkronisasi Model Cadangan**

- **Penambahan Kunci xKiro ke-3 (`.env`, `swarm_runner.cjs`)**:
  - Mendaftarkan API key xKiro baru (`sk-xt-061a...8a6b`, akun `raflyfirmansyah625@gmail.com`) ke dalam variabel `XKIRO_KEYS` di `.env`.
  - Mengintegrasikan kunci ke-3 ke dalam pool runner swarm lokal (`%USERPROFILE%\.claude-flow\swarm_runner.cjs`).
  - Total kapasitas kuota token harian gabungan xKiro Gateway meningkat 50% dari 10.000.000 token/hari menjadi **15.000.000 token/hari** (5.000.000 token/hari per kunci) secara 100% gratis ($0 free-tier).
  - Rotasi kunci otomatis dan endpoint sinkronisasi upstream `api/stats.ts` langsung memantau ketiga kunci secara real-time (`suffix: 6386, d077, 8a6b`).
- **Penyelarasan Urutan Model Cadangan xKiro (`.env`, `src/env.ts`)**:
  - Menyelaraskan urutan `XKIRO_MODEL_BACKUPS` di `.env` sesuai preferensi pengguna:
    1. Primary: `qwen/qwen3.8-max:free`
    2. Cadangan: `mistralai/mistral-medium-3.5`, `deepseek/deepseek-v4-flash`, `mistralai/mistral-large-2512`, `deepseek/deepseek-chat-v3.1`, `qwen/qwen3.7-max:free`, `deepseek/deepseek-v4-pro`, `qwen/qwen3.6-plus:free`, `mistralai/mistral-small-2603`.

### v0.25.26 - 2026-09-12 13:28 WIB

**Penyelarasan Gaya Bahasa Dinamis (Dynamic Style Mirroring & Chameleon), Resonansi Emosional & Eliminasi Respon Statis Kaku**

- **Arsitektur Penyelarasan Gaya Bahasa Dinamis (Dynamic Tone Chameleon, `src/skills.ts`)**:
  - Menetapkan prinsip mutlak bahwa gaya bahasa bot 100% bergantung pada gaya chat pengguna saat ini:
    - **Chat Normal, Formal, Rapi, atau Serius**: Bot merespons secara normal, sopan, bersih, tenang, dan proporsional. Dilarang keras memaksakan slang gaul (dilarang tiba-tiba bjir, santuy, mager, wkwk) jika pengguna tidak menggunakannya.
    - **Chat Santai, Kasual, atau Akrab**: Bot mengikuti alur santai secara luwes, bersahabat, hangat, dan membumi selayaknya teman akrab.
    - **Chat Banyol, Humoris, atau Memakai Slang**: Bot ikut seirama dengan gaya gaul yang pas, tetap wajar dan tidak over-react.
  - Mengintegrasikan deteksi register percakapan berbasis prompt pengguna (`userHasSlang` dan `userIsPoliteOrFormal`) yang secara otomatis menyuntikkan pedoman adaptasi tone kontekstual per giliran chat.
- **Kecerdasan Emosional & Peka Rasa (Emotional Resonance & High-EQ Companion, `src/skills.ts`)**:
  - Menginstruksikan model untuk memahami pesan pengguna menggunakan perasaan, ekspresi, dan kepekaan rasa yang dinamis (membaca suasana / read the room).
  - Merespons kondisi emosional (lelah, stres, curhat, santai, banyol) dengan empati tulus dan kehangatan manusiawi tanpa menggurui atau memberikan solusi yang tidak diminta.
- **Pembersihan Total Respon Statis Kaku & Anti-Perulangan (`src/skills.ts`)**:
  - Melarang keras seluruh bentuk formula respons hafalan atau frasa template statis yang diulang-ulang.
  - Menjamin seluruh jawaban dihasilkan secara organik dan dinamis dari pemahaman menyeluruh terhadap pesan pengguna pada saat itu.

### v0.25.25 - 2026-09-12 13:25 WIB

**Presisi Grounding Matematika, Pembenahan Konteks Respons Ketidaktahuan ("Ih gak tau") & Eliminasi Penumpukan Tawa/Slang Cringe**

- **Penanganan Ketidaktahuan Pengguna Tanpa Asumsi Lelucon (`isUserUnsure`, `src/skills.ts`)**:
  - **Akar Masalah**: Saat pengguna merespons _"Ih gak tau"_ setelah penjelasan matematika yang sebelumnya diakhiri kalimat bot _"Bener kan tebakanku?"_, regex pendeteksi tebak-tebakan lama keliru mencocokkan kata `tebak` di `tebakanku?`, sehingga sistem menganggap pengguna menyerah pada sesi tebak-tebakan humor dan mengeluarkan punchline lelucon ngawur (_"Karena mereka makannya dikit-dikit wkwk"_ atau _"Anggap aja tebak-tebakan receh buat ngilangin gabut lu wkwk. Mau coba yang lain gak nih?"_).
  - **Solusi**: Memperketat regex `isPendingRiddle` hanya pada pola lelucon/gombalan eksplisit (`coba tebak`, `tebak kenapa`, `bapak kamu tukang`) dan mengecualikan kata `tebakanku`.
  - Menambahkan handler `isUserUnsure` untuk respons _"Ih gak tau"_, _"gatau"_, _"mana saya tau"_: melarang keras menganggap pesan tersebut sebagai lelucon, melarang menawarkan permainan lain, dan menanggapi kebingungan pengguna secara wajar, tenang, dan tuntas sesuai topik yang sedang dibahas.
- **Strict Grounding Matematika & Eliminasi Spekulasi Halusinasi Typo (`src/skills.ts`)**:
  - **Akar Masalah**: Pada soal `1+1x3x0+7+9:0`, model mengarang asumsi liar yang tidak pernah diminta: _"Tapi kalau itu cuma typo dan maksudnya 9:3, jawabannya jadi 8"_.
  - **Solusi**: Menegakkan aturan urutan operasi matematika KABATAKU/PEMDAS: perkalian dan pembagian dikerjakan terlebih dahulu (`1x3x0 = 0`), dan pembagian dengan angka nol (`9:0`) menghasilkan nilai tidak terdefinisi (_undefined_). Melarang keras mengarang asumsi typo sendiri atau mengabaikan operasi matematika secara sepihak.
  - Menambahkan pembersih sanitasi regex di `cleanMathAndNoise` untuk memotong spekulasi typo matematika jika model secara tak sengaja memuntahkannya.
- **Eliminasi Penumpukan Tawa Ganda & Obral Slang Cringe (`src/skills.ts`)**:
  - **Akar Masalah**: Model menumpuk tawa (membuka dengan _"wkwk"_ dan menutup dengan _"haha"_) serta menjejalkan rentetan kata gaul sekaligus (_"Wkwk relate bjir, emang rawan banget nih jam segini buat mager dan gabut. Santuy aja dulu, rebahan sambil scroll HP juga lumayan lah ya haha"_), menimbulkan kesan norak, garing, dan cringe.
  - **Solusi**: Menetapkan aturan ketat tawa maksimal 1 kali per pesan (atau tanpa tawa sama sekali saat berbicara normal).
  - Mengintegrasikan pembersih regex pada Rule 14c di `cleanMathAndNoise` yang otomatis menghapus seluruh tawa tambahan di luar tawa pertama di seluruh badan pesan.
  - Membersihkan contoh instruksi `isGabutOrBored` agar model menghasilkan balasan yang bersih, mengalir alami, dan membumi tanpa obral slang beruntun.

### v0.25.24 - 2026-09-12 13:16 WIB

**Perombakan Persona Universal: Eliminasi Template Hafalan & Penegakan Nada Santai Wajar (Anti Over-React)**

- **Pembersihan Total Contoh Jawaban Verbatim (`src/skills.ts`)**:
  - Menghapus seluruh daftar kutipan kalimat contoh di prompt yang sebelumnya memicu model menjiplak secara statis (_"Wkwkwk komuknya tolong"_, _"Buset ekspresinya dapet banget"_, _"Ngece bener mukanya"_, _"Puas banget kan lu ngakaknya"_, _"Buset komuk batu haha"_, _"Menyala abangku"_).
  - Menggantinya dengan prinsip penalaran dinamis organik murni dari pemahaman AI terhadap konteks percakapan saat itu.
- **Penegakan Nada Wajar, Membumi, & Anti-Over-React (`src/skills.ts`)**:
  - Dilarang bersikap lebay, heboh palsu, atau sok asik (_anti-try-hard_).
  - Menghilangkan obral kata slang berlebihan ("anjir", "bjir", "gokil", "buset", "komuk") di setiap kalimat agar tidak terdengar norak atau _cringe_.
  - Menjaga reaksi tetap proporsional: hal biasa ditanggapi santai, candaan ditanggapi tawa wajar, dan stiker/foto ditanggapi mengalir layaknya gestur alami teman di chat.
- **Respons Emoji Murni & Tawa Secara Dinamis (`src/skills.ts`)**:
  - Membebaskan model merespons pesan emoji ekspresi secara spontan dan variatif (bisa emoji balik yang pas, reaksi singkat 1-2 kata, atau celetukan santai yang sesuai suasana obrolan).
  - Respons tawa (wkwk, haha, 🤣😭) ditanggapi secara tenang dan wajar tanpa berteriak heboh.

### v0.25.23 - 2026-09-12 13:12 WIB

**Penyelesaian Tuntas Masalah Interogasi Berulang & Penghapusan Pertanyaan Penutup Klise (`src/skills.ts`)**

- **Eliminasi Mandat Pancingan & Pertanyaan Lanjutan**:
  - Menghapus instruksi lama yang menyuruh bot menutup respons dengan "pancingan santai atau ajakan ngobrol" atau "1 pertanyaan lanjutan".
  - Menetapkan Aturan 5 baru: **LARANGAN MUTLAK INTEROGASI & SELALU BERTANYA DI SETIAP AKHIR CHAT (STRICT NO FORCED CLOSING QUESTIONS)**.
  - Melarang keras pertanyaan klise seperti: _"Mau coba yang lain gak nih?"_, _"Mau bahas apa nih biar gak bosen?"_, _"Lagi santai atau lagi gabut aja?"_, _"Mau digombalin lagi atau ganti topik?"_, _"Bener kan tebakanku?"_, _"Mau tebak-tebakan receh atau cerita random aja?"_.
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
  - Mengubah gaya sekretaris/birokrasi kaku menjadi gaya partner diskusi hangat: _"Udah kubaca nih dokumennya. Intinya..."_
  - Merespon video secara alami layaknya teman yang baru saja menonton video bersama.
- **Pembersihan Otomatis di Sanitizer (`src/skills.ts`)**:
  - Regex cleaner otomatis memangkas sisa-sisa pembuka robotik visual, aksi panggung dalam asteris (_menggigit jari_, _goyang-goyang_), tawaran penutup basa-basi (_kalo mau cerita lebih lanjut..._), dan normalisasi singkatan acak.

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
  - OpenRouter gratis berstatus murni teks (_text-only_). Berperan sebagai jaring pengaman terakhir (_ultimate fallback_) saat xKiro, Groq, dan Gemini limit untuk chat teks biasa.

### v0.25.20 - 2026-09-12 12:46 WIB

**Audit & Benchmark Komprehensif Gemini 3.8 Flash Lintas Seluruh Modalitas (Teks, Vision, PDF, Audio, Video)**

- **Hasil Benchmark Faktual `gemini-3.8-flash`**:
  - **Spesifikasi Model**: Input context window 1.048.576 token (1M), output window 65.536 token, mendukung `generateContent` untuk teks, gambar, audio, dokumen PDF, dan video.
  - **Teks / Chat**: Latensi 3.5–4.5s dengan arsitektur penalaran mendalam (_deep reasoning_ thoughts token).
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
  - Menghapus `openai/gpt-5.3-codex-spark` karena berstatus berbayar (_paying customers only_ / HTTP 403).
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
  - Pengetahuan disimpan pada tabel `web_knowledge` di Supabase dan disinkronkan ke dalam _Hot In-Memory Cache_ lokal untuk respon sub-milidetik (<0.06ms).
  - Sekali sebuah fakta dipelajari dari pertanyaan pengguna tertentu (baik di WhatsApp maupun Telegram), seluruh pengguna lain yang menanyakan hal serupa langsung mendapatkan jawaban seketika tanpa scraping internet.
- **Klasifikasi Umur Pengetahuan Cerdas (Tiered Dynamic TTL)**:
  - Mengeliminasi risiko data basi (_stale data_) dengan membagi masa berlaku pengetahuan secara dinamis:
    1. **Real-time (Cuaca, Kurs, Harga Emas, Skor Bola, Gempa)**: TTL 2 jam (7.200 detik). Otomatis di-refresh jika sudah kedaluwarsa.
    2. **News / Breaking Events (Politik, Hukum, Viral, Menteri, Pemilu)**: TTL 12 jam (43.200 detik).
    3. **Tech & Product Releases (Xiaomi, iPhone, Samsung, DeepSeek, Claude, Qwen, Spesifikasi Hardware)**: TTL 21 hari (1.814.400 detik).
    4. **Fakta Statis / Ilmiah / Sejarah**: TTL 90 hari (7.776.000 detik).
- **Pencocokan Entitas Normalisasi & Token Overlap (`normalizeEntityKey`, `getKnowledge`)**:
  - Menyaring stopwords dan filler kata tanya secara presisi sehingga pertanyaan seperti _"Kapan rilis Xiaomi 15 di Indonesia?"_ dan _"info rilis xiaomi 15 dong kak"_ dipetakan ke entitas kunci yang sama (`xiaomi_15`).
  - Mendukung pencocokan prefix dan token overlap sehingga pencarian pengetahuan berjalan cepat dan akurat.
- **Integrasi Seamless Tanpa Regresi (`src/web.ts`)**:
  - Diintegrasikan langsung di dalam `searchWeb(query)` sebelum live scraper dijalankan.
  - Handler WhatsApp Cloud, WhatsApp Baileys, dan Telegram otomatis menikmati fitur ini tanpa perubahan struktur kode di lapisan controller.
  - Penulisan ke `web_knowledge` berjalan asinkron non-blocking (_fire-and-forget_), menjamin tidak ada latensi tambahan pada interaksi pengguna.

### v0.25.2 - 2026-09-11 23:55 WIB

**Autonomous Latency Optimization, Fast-Path In-Memory Context Cache & Non-Blocking Asynchronous Persistence**

- **Eliminasi Latensi Web Search Agresif pada Percakapan Umum (`src/web.ts`)**:
  - Mengatasi akar masalah utama respons lambat (_slow response_ 8 hingga 12 detik): sebelumnya modul `needsSearch` mengeksekusi penelusuran web Bing, Google News RSS, Hugging Face, Wikipedia, serta deep-scraping 3 URL eksternal untuk hampir setiap pesan santai (seperti sapaan, curhat, "aku laper", "tugas akhir", rekomendasi makanan/film, dan koding dasar).
  - Mengintegrasikan _Smart Intent Classifier_: obrolan santai, tugas kuliah/jurnal umum, curhat, dan pertanyaan logika langsung diproses lewat jalur ekspres (_fast-pass_ ~0.01ms) tanpa penelusuran web eksternal, memangkas latensi hingga 7-10 detik.
  - Penelusuran web dipertahankan 100% aktif dan akurat untuk kueri berita terkini, nama model AI (DeepSeek, Claude, Qwen, Gemini, GPT), gawai (Xiaomi, iPhone, Samsung), harga/kurs/cuaca, dan tautan URL.
  - Memangkas timeout `searchWeb()` dari 6500ms menjadi 3200ms dan membatasi deep-scraping halaman hanya jika kueri memuat tautan eksplisit atau snippet minim.
- **In-Memory Fast-Path Context Cache (`src/memory.ts`)**:
  - Mengurangi beban 3 query database Supabase paralel berulang setiap ada pesan masuk pada sesi percakapan aktif dengan in-memory cache TTL 25 detik (`contextCache`).
  - Percakapan berkelanjutan memperoleh riwayat konteks secara instan (0ms) tanpa menunggu roundtrip jaringan REST Supabase (menghemat 300-800ms).
- **Asynchronous Non-Blocking Message Persistence (`src/whatsapp_cloud.ts`, `src/whatsapp_baileys.ts`, `src/telegram.ts`)**:
  - Mengubah penyimpanan pesan pengguna (`saveMessage` peran `user`) dari pola `await` blocking menjadi asinkronus non-blocking berstatus _fire-and-forget_ aman (`void saveMessage(...)`), sekaligus memperbarui cache memori aktif secara serentak. Model AI langsung mulai berpikir tanpa terhambat penulisan ke database.
  - Penyimpanan balasan asisten ke database juga dieksekusi secara non-blocking setelah pesan berhasil terkirim ke antarmuka chat pengguna.
- **Penyelarasan Prompt Context & TTFT Acceleration (`src/skills.ts`, `src/env.ts`)**:
  - Memangkas batas potongan hasil penelusuran web pada system prompt dari 8.500 karakter menjadi 3.800 karakter. Mengurangi ukuran prefill token ke model LLM hingga 55%, mempercepat pembentukan token pertama (_Time to First Token / TTFT_).
  - Menyesuaikan batas waktu tunggu header koneksi `CONNECT_TIMEOUT_MS` menjadi 4.500ms agar mekanisme auto-failover antar key/model berjalan 2x lebih responsif jika salah satu gateway mengalami kendala.
- **Integritas Urutan Rolling Model (Zero Alteration)**:
  - Urutan hierarki rolling penggunaan model (`xkiro` -> `groq` -> `gemini` -> `openrouter`) dipertahankan 100% utuh tanpa modifikasi apa pun sesuai syarat mutlak pengguna.

### v0.26.5 — 2026-09-12 19:15 WIB

**Audit Verification Resolution Putaran 5: Fail-Closed Deduplication, Lease Isolation, Zero Unsafe-Inline CSP, Keyset Range Pagination & Baileys Robustness**

- **B1 Fail-Closed Ingestion & Anti-Lockout Durability (`src/db.ts`)**:
  - `claimIncomingMessage` kini fail-closed: jika terjadi galat basis data transien non-23505, sistem mengembalikan `false` sehingga webhook platform melakukan retry secara tertib tanpa memproses pesan ganda tanpa jejak.
  - Menambahkan mekanisme anti-lockout crash recovery: jika query mengembalikan duplicate key 23505, sistem memeriksa apakah pesan tersebut belum selesai diproses (`processed_at IS NULL`) dan telah berumur lebih dari 45 detik (menandakan worker sebelumnya crash sebelum selesai). Jika ya, sistem mengizinkan klaim ulang agar pesan pengguna tidak terkunci permanen.
  - Implementasi fungsi `markMessageProcessed(platform, msgId)` untuk menandai pesan selesai diproses (`processed_at = now()`) saat balasan asisten berhasil dikirim.
- **B3 Durabilitas Skema Basis Data (`sql/schema.sql`, `sql/migrate_v16_security_hardening_and_rpc.sql`)**:
  - Menambahkan kolom `msg_id text NULL` dan `processed_at timestamptz NULL` serta indeks unik parsial `idx_messages_platform_msg_id` pada tabel `messages`.
  - Mengintegrasikan pemanggilan `markMessageProcessed` di seluruh alur pengiriman balasan asisten sukses pada Telegram Bot API (`src/telegram.ts`), WhatsApp Meta Cloud (`src/whatsapp_cloud.ts`), dan WhatsApp Baileys (`src/whatsapp_baileys.ts`).
- **B4 Isolasi Lease Reminder Tanpa Modifikasi due_at (`src/remind.ts`, `sql/schema.sql`, `sql/migrate_v16_security_hardening_and_rpc.sql`)**:
  - Memisahkan sewa waktu pemrosesan worker ke kolom `lease_until timestamptz NULL` dengan indeks `idx_reminders_lease_until`.
  - Saat klaim reminder, sistem mengunci baris dengan `status = 'processing', lease_until = now + 10 minutes` tanpa pernah mengubah nilai `due_at` asli, menjaga waktu jatuh tempo riil tetap utuh.
  - Auto-reaper kini hanya me-reset baris jika `status = 'processing' AND lease_until <= now` (atau batas aman 30 menit jika lease_until null), mengeliminasi regresi pengiriman ganda ketika proses kirim memakan waktu lama.
- **B8 Paritas Penyertaan msg_id pada Media WhatsApp Cloud & Telegram (`src/whatsapp_cloud.ts`, `src/telegram.ts`)**:
  - Menyertakan `msg_id: messageId` pada seluruh kasus penyimpanan pesan pengguna untuk Dokumen, Voice Note, Stiker, dan Video di Meta WhatsApp Cloud API.
  - Menyertakan `msg_id: msgId || undefined` pada penyimpanan pesan pengguna untuk Stiker dan Video di Telegram Bot API.
- **B9 Paginasi Keyset/Range Tanpa Pemotongan Senyap (`api/stats.ts`)**:
  - Mengganti pembatasan sepihak `.limit(2000)`, `.limit(1000)`, dan `.limit(5000)` dengan helper paginasi dinamis bertahap `fetchPagedRange` menggunakan `.range(from, to)`.
  - Mengeliminasi undercount statistik dan distribusi model/media pada rentang waktu `30d` dan `all` tanpa risiko kehabisan memori (_out-of-memory_) di container Vercel.
- **C2 Content Security Policy (CSP) Zero Unsafe-Inline (`vercel.json`, `public/dashboard.html`, `public/index.html`)**:
  - Mengekstraksi seluruh JavaScript inline di `public/dashboard.html` ke berkas terisolasi `public/js/dashboard-pre.js` (anti-flicker fast-path) dan `public/js/dashboard.js` (logika analitik dan evaluasi).
  - Mengekstraksi skrip pembersih sesi di `public/index.html` ke berkas `public/js/home.js`.
  - Menghapus `'unsafe-inline'` dari direktif `script-src` pada CSP di `vercel.json` (`script-src 'self' https://cdn.jsdelivr.net`).
- **C4 Hidrasi Kuota Berbasis Await (`src/quota.ts`, `src/providers.ts`)**:
  - Mengekspor fungsi `isKeyAllowed(kind, key, cap)` yang secara deterministik meng-await `ensureKeyQuotaHydrated` sebelum memeriksa sisa kuota, mengeliminasi potensi balapan fire-and-forget cold-start.
- **C5 Perlindungan Try/Catch Penelusuran Web Voice Note Baileys (`src/whatsapp_baileys.ts`)**:
  - Membungkus pemanggilan `searchWeb` di dalam alur transkripsi audio Baileys dengan `try/catch`, sehingga kegagalan sementara pencarian web tidak lagi melempar eksekusi ke penanganan error audio yang menampilkan pesan audio tidak jelas ke pengguna.
- **B10 / C8 / C9 Penyelarasan Ground Truth Dokumen Arsitektur (`AGENTS.md`)**:
  - Menjelaskan secara akurat perbedaan antara Conversation Context Cache (in-memory rolling TTL 25s, 24 pesan di `src/memory.ts`) dan Knowledge Web Cache (300 entri, FIFO-50 di `src/knowledge.ts`).
  - Mengoreksi jumlah pemetaan wilayah/kota pada pengenalan zona waktu dinamis menjadi ~100 entri terkurasi di `src/timezone.ts` sesuai fakta kode terkini.

### v0.26.1 — 2026-09-12 17:15 WIB

**Audit Verification Hotfix & Full Regression Resolution (AUDIT_VERIFICATION_v0.26.0)**

- **Hotfix Kritis Reminders & CHECK Constraint (`sql/migrate_v16_security_hardening_and_rpc.sql`, `src/remind.ts`)**:
  - Memperbarui CHECK constraint tabel `reminders` menjadi `CHECK (status IN ('pending', 'processing', 'sent', 'failed'))` untuk mengakomodasi atomic claim status `'processing'`.
  - Menambahkan mekanisme fallback CAS tangguh di `src/remind.ts` sehingga proses pengiriman pengingat tidak pernah macet meskipun constraint basis data belum diperbarui.
- **Eliminasi Penimpaan Cache-Control pada Endpoint Statistik (`api/stats.ts`)**:
  - Menghapus baris `res.setHeader('Cache-Control', 'public, s-maxage=10, ...')` yang menimpa `no-store`, menjamin data analitik admin tidak pernah tersimpan di cache publik/CDN.
- **Penyelarasan Tanda Tangan Parameter RPC `increment_knowledge_hit` (`sql/migrate_v16_security_hardening_and_rpc.sql`, `src/knowledge.ts`)**:
  - Mendefinisikan parameter ganda `(p_entity_key text DEFAULT NULL, p_key text DEFAULT NULL)` pada fungsi RPC PostgreSQL dan mengirimkan kedua kunci dari `src/knowledge.ts` untuk kompatibilitas penuh.
- **Isolasi Code-Fence Anti-Korupsi & Penutupan Fence Unclosed (`src/skills.ts`)**:
  - Menambahkan deteksi dan penutupan otomatis pada blok code fence yang belum tertutup (`out += '\n```'`) sebelum ekstraksi blok kode. Menghilangkan bug di mana baris komentar `#` di dalam kode terkonversi menjadi format heading/bold WhatsApp.
  - Memperbaiki batas emoji menjadi mutlak maksimal 1 emoji (`maxAllowed = 1`) di seluruh panjang teks keluaran.
  - Menghapus residu Chain-of-Thought (CoT) `<think>` di posisi mana pun di dalam pesan, bukan hanya di awal baris.
  - Menetralisir instruksi prompt web data agar dibingkai sebagai referensi eksternal yang tidak dipercaya untuk mencegah stored prompt injection.
- **Resolusi Zona Waktu GPS IANA & Pencegahan Unhandled Rejection Provider (`src/timezone.ts`, `src/providers.ts`)**:
  - Fallback koordinat GPS pada `resolveTimezoneFromCoords` kini mengembalikan zona waktu IANA standar yang valid (`Etc/GMT-8` untuk UTC+8, `Etc/GMT+5` untuk UTC-5, atau `UTC` untuk offset 0).
  - Menghapus token lokasi 2-huruf ambigu (`hk`) untuk mencegah tabrakan pencocokan lokasi.
  - Memasang handler `.catch(() => {})` pada `bodyPromise` di `fetchJsonWithLifecycle` untuk mencegah unhandled promise rejection saat timeout membatalkan pembacaan stream di Node.js 22.
- **Keamanan Master PIN Klien-Server & Lockout Akun (`src/admin_auth.ts`, `public/dashboard.html`, `sql/migrate_v12_admin_auth.sql`)**:
  - Menghapus salt publik client-side `PIN_SALT = "rafly_telemetry_salt"` dan fungsi hashing client-side pada dashboard. Klien mengirim PIN langsung melalui koneksi terenkripsi HTTPS POST ke `/api/admin-otp?action=verify_pin` dan server melakukan hashing menggunakan secret salt internal.
  - Memperbaiki pesan penguncian akun menjadi "15 menit" sesuai durasi lockout aktual.
  - Menambahkan verifikasi status penguncian dan pencatatan gagal atomik pada fungsi `updatePin`.
  - Menghapus nilai hash seed default `080402` dari migrasi v12 dan membatasi `GRANT EXECUTE` RPC admin hanya ke `service_role`.
- **Penegakan Fail-Closed di Seluruh Lingkungan Runtime (`api/webhook.ts`, `src/whatsapp_cloud.ts`, `api/cron/reminders.ts`, `src/env.ts`)**:
  - Seluruh endpoint webhook Telegram, webhook WhatsApp Meta, dan endpoint cron pengingat kini menolak permintaan secara fail-closed di SEMUA mode (bukan hanya serverless) jika secret belum dikonfigurasi.
  - Memperketat validasi `assertRuntime` untuk kelengkapan secret dan kredensial Meta WhatsApp Cloud.
- **Hidrasi Kuota Basis Data saat Cold Start (`src/quota.ts`)**:
  - Menambahkan fungsi `hydrateKeyQuota` yang membaca data riil penggunaan kuota harian dari Supabase `provider_quota` saat instance cold start, menjamin batas harian ditegakkan secara akurat lintas restart container.
- **Pengetatan Perintah Reset Sesi & Keamanan Media (`src/memory.ts`, `src/media.ts`, `src/telegram.ts`)**:
  - Membatasi fungsi `isResetCommand` secara strictly prefix-only (`/reset`, `/clear`, `/reset_session`, `/resetsesi`, `/clearchat`) untuk mencegah reset sesi tidak sengaja dari obrolan kasual.
  - Menambahkan `AbortSignal.timeout(35000)` pada analisis video Gemini dan fungsi `sniffMimeType` untuk memvalidasi magic bytes berkas dokumen/gambar.
  - Mengubah respons `/start` Telegram menjadi respons statis instan tanpa memanggil model LLM untuk menghemat kuota dan memangkas latensi.
- **Penjaminan Mutu & Cakupan Typecheck 100% (`package.json`, `tsconfig.typecheck.json`, `Dockerfile`, `public/index.html`)**:
  - Membuat konfigurasi `tsconfig.typecheck.json` dan memperbarui script `npm run typecheck` sehingga mencakup 100% kode sumber di `src/` dan seluruh 6 serverless API functions di `api/`.
  - Memperbarui `Dockerfile` menggunakan `npm ci` untuk build kontainer yang deterministik.
  - Menyelaraskan teks versi pada footer `public/index.html` menjadi `v0.26.0`.
  - Meng-untrack seluruh 7 file CSV evaluasi lokal dari cache Git tanpa menghapus berkas fisik pengguna.

### v0.26.0 — 2026-09-12 16:45 WIB

**Hardening Masif Menyeluruh & Eksekusi Penuh Hasil Audit Komprehensif (Zero Unfixed Findings)**

- **P0 Keamanan Inti & Database Hardening (`sql/migrate_v16_security_hardening_and_rpc.sql`)**:
  - `REVOKE EXECUTE ON FUNCTION rpc_admin_* FROM anon, public` dan pembatasan hak eksekusi hanya ke `service_role` untuk menutup celah oracle brute-force PIN dan bypass OTP.
  - Implementasi fungsi RPC atomik `atomic_increment_provider_quota` untuk mengeliminasi Read-Modify-Write (RMW) race condition pada kuota provider.
  - Pembuatan fungsi RPC `increment_knowledge_hit` yang hilang untuk memulihkan pelacakan hit knowledge.
  - Pengaktifan Row Level Security (RLS) dan pembuatan pg_trgm indeks pada `web_knowledge`.
  - Penambahan kolom `platform` pada tabel `reminders` untuk paritas multi-kanal.
- **P0 Otentikasi Admin & Proteksi Lingkungan (`src/env.ts`, `src/admin_auth.ts`)**:
  - Penghapusan seluruh fallback PIN hardcoded (`080402`), salt publik statis (`rafly_telemetry_salt`), dan email default.
  - Penegakan derivasi salt dinamis runtime, penguncian akun 15 menit (dari 1 menit) saat 5 kali percobaan gagal berturut-turut, dan validasi fail-closed.
  - Pemblokiran URI DSN `postgres://` pada `supabaseUrl` untuk mencegah salah konfigurasi koneksi langsung.
  - Penutupan celah Path Traversal pada `src/whatsapp_session.ts` via sanitasi nama file `path.basename` dan verifikasi direktori.
- **P0/P1 Keandalan Provider LLM & Socket Management (`src/providers.ts`, `src/quota.ts`)**:
  - Integrasi `fetchJsonWithLifecycle` dengan `AbortController` terpadu dan pembersihan timer `Promise.race` pada blok `finally` (menghilangkan socket leak dan potensi timeout container Lambda).
  - Eliminasi tabrakan ID kuota via hashing SHA-256 (12-char) dan penegakan pencatatan atomik ke basis data.
  - Type safety `systemInstruction` pada payload Gemini untuk mencegah transmisi `"[object Object]"`.
  - Migrasi pembersihan cache dari full-wipe menjadi LRU eviction (pembuangan 50 entri tertua) untuk mencegah thundering herd.
- **P1 Manajemen Memori, Checkpoint & Siklus Hidup Sesi (`src/memory.ts`)**:
  - Penegakan cutoff checkpoint pada `noteExchange` sehingga peringkasan memori hanya memproses riwayat pasca-reset marker (`[SESSION_RESET]`), mencegah penularan ulang memori lama.
  - Pengetatan deteksi perintah reset sesi (`isResetCommand`) hanya untuk perintah berbasis prefix/eksplisit guna mencegah reset tidak sengaja.
- **P1 Pengingat Terjadwal & Paritas Saluran (`src/remind.ts`, `api/cron/reminders.ts`, `src/whatsapp_cloud.ts`, `src/whatsapp_baileys.ts`)**:
  - Penyimpanan eksplisit kolom `platform` saat reservasi pengingat dan routing akurat saat pengiriman cron.
  - Mekanisme atomic claim (CAS update `status = 'processing'`) untuk mencegah pengiriman dobel saat cron overlap.
  - Porting handler perintah `/salah` dan `/remind` ke Meta WhatsApp Cloud dan WhatsApp Baileys untuk mencapai paritas fitur 100% dengan Telegram.
- **P1 Keamanan Media & Mitigasi Decompression Bomb (`src/media.ts`)**:
  - Penambahan `AbortSignal.timeout` (20 detik) pada seluruh pipeline fetch unduhan media.
  - Pembatasan ukuran berkas dokumen maksimal 15MB, batas output dekompresi zlib PDF maksimal 5MB, serta pembatasan teks maksimal 300k karakter untuk mitigasi decompression bomb.
  - Pemblokiran berkas konfigurasi sensitif (`.env`, `.log`, `.key`, `.pem`).
- **P1 Optimasi Waktu & Geolocation (`src/timezone.ts`)**:
  - Pra-kompilasi ~400 regex ke `COMPILED_LOCATION_MAP` saat modul dimuat untuk memangkas latency turn.
  - Penghapusan keyword pendek berisiko tinggi (`la`, `sf`) untuk mencegah false positive partikel percakapan bahasa Indonesia.
  - Pengetatan `isAskingTime` dengan mewajibkan qualifier kata tanya waktu.
- **P2 Pembersihan Kebisingan, Isolasi Kode & Anti-Echo (`src/skills.ts`)**:
  - Isolasi blok kode fenced (`...`) dan inline code (`) sebelum pembersihan matematika/markdown agar sintaks pemrograman tidak terkorupsi.
  - Pembersihan menyeluruh spec-sheet echo internal (`### 1. IDENTITAS...`, tag `[PERINTAH SISTEM]`, dan residu CoT).
  - Implementasi fungsi bersama `splitMessageSmart` yang sadar blok kode markdown (menutup dan membuka ulang blok kode jika terpotong pada batas 4000 karakter).
- **P2 Stored Prompt Injection & Search Hardening (`src/knowledge.ts`, `src/web.ts`)**:
  - Netralisasi teks instruksi imperatif web (`sanitizeKnowledgeText`) dan chunking pada batas kalimat rapi.
  - Eliminasi false positive `needsSearch` pada kata umum/brand homograf dan anchor tahun 2026.
- **P3 Keamanan Webhook & Header Keamanan Edge (`api/*.ts`, `src/db.ts`)**:
  - Pemasangan security headers lengkap (`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, HSTS) di seluruh endpoint.
  - Verifikasi timing-safe (`crypto.timingSafeEqual`) dan penegakan fail-closed di lingkungan serverless.
  - Pencegahan kebocoran edge cache pada `api/dataset.ts` via `Cache-Control: no-store, no-cache`.
  - Penulisan metrik token lengkap (`prompt_tokens`, `completion_tokens`, `total_tokens`) dan peningkatan batas `content` hingga 32.000 karakter pada `saveMessage`.

### v0.25.1 - 2026-09-11 23:15 WIB

**Perbaikan Kritis: Cryptographic Stateless HMAC Session Tokens, Cross-Lambda Sync & Anti-Clock-Skew Guard**

- **Akar Masalah Sesi Tertendang Seketika (_Immediate Session Kick-Out_)**:
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
  - Menambahkan batas toleransi toleransi waktu (_clock drift grace window_) 30 detik pada pemeriksaan token dan hitung mundur `startSessionExpiryCountdown`.
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
    1. **Kueri Non-Waktu (`!isAskingTime && !userDeclaringLoc`)**: Waktu server disajikan pasif sebagai background temporal grounding, disertai larangan mutlak (_absolute directive_) bagi bot untuk mengawali jawaban dengan jam atau menanyakan kota/lokasi pengguna. Bot fokus 100% pada topik obrolan (misal membahas jurnal).
    2. **Konfirmasi Lokasi (`userDeclaringLoc`)**: Bot mengonfirmasi kota pengguna dengan ramah, menyebutkan waktu di kotanya secara presisi, dan mencatatnya ke memori.
    3. **Pertanyaan Waktu (`isAskingTime`)**: Jika lokasi tersimpan di profil, bot langsung menjawab jam lokasi tersebut tanpa menanyakan lokasi lagi. Jika lokasi belum diketahui, barulah bot menyebutkan rentang waktu 3 zona Indonesia dan menanyakan kotanya secara santai.

### v0.24.8 - 2026-09-11 21:10 WIB

**Native Location Pin Processing, Anti-WIB Default Rule & Persistent Geolocation Profile**

- **Penanganan Pesan Lokasi Asli WhatsApp & Telegram (`src/whatsapp_baileys.ts`, `src/whatsapp_cloud.ts`, `src/telegram.ts`)**:
  - Mengaktifkan penanganan pesan lokasi (`locationMessage` di WhatsApp Baileys, `type === 'location'` di WhatsApp Cloud API, dan `msg.location` di Telegram Bot API).
  - Ketika pengguna membagikan pin lokasi (_Share Location / Live Location_), bot membaca koordinat GPS (`latitude` & `longitude`), menentukan zona waktu via `resolveTimezoneFromCoords()`, dan menyimpannya secara persisten ke tabel Supabase `corrections`.
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

- **Mekanisme Pergeseran Kartu Berbasis Riwayat Inferensi Terkini (_Most Recently Used / MRU_) (`public/dashboard.html`)**:
  - Mengatasi kendala pengurutan kartu: sebelumnya saat ada model baru yang aktif menjadi #1, model yang sebelumnya menempati #1 langsung terlempar kembali ke posisi statis tetap di bawah (misal ke slot #10), sementara model yang belum pernah dipakai (0x eksekusi) berada di posisi atasnya (#2, #3).
  - Mengimplementasikan stack MRU dinamis: ketika model baru aktif melayani inferensi, ia langsung menempati posisi **#1** (`AKTIF TERBARU`), sedangkan model yang sebelumnya menempati #1 bergeser secara alami menjadi **#2**, model #2 sebelumnya bergeser menjadi **#3**, dan seterusnya.
  - Model yang belum pernah dieksekusi (0x calls) tetap tersusun rapi di bagian bawah daftar sesuai urutan prioritas bawaan katalog.
- **Backend Chronological Model Sequence Tracking (`api/stats.ts`)**:
  - Menyaring urutan unik model yang melayani percakapan asisten dari `messages` terurut menurun (`order('id', { ascending: false })`).
  - Mengirimkan array `recentModels` pada respons API serverless sehingga frontend selalu memiliki urutan kronologis inferensi nyata dari basis data Supabase lintas sesi dan refresh.

### v0.24.3 — 2026-09-11 17:45 WIB

**Strict Vision Grounding, Anti-Overreact Engine & Peripheral Distraction Elimination**

- **Eliminasi Respons Over-React & Basa-Basi Klise (`src/skills.ts`)**:
  - Mengatasi kendala model multimodal yang merespons foto secara berlebihan (_over-reacting_), seperti pujian hiperbolis ("Wah, ini kokpitnya ya? Rapi banget..."), tebakan periferal fisik di luar layar (mengomentari merek laptop ASUS, lampu RGB menyala-nyala, keyboard), serta pertanyaan retoris tak bermutu di akhir ("Gimana, performanya nge-lag gak di situ?").
  - Menegakkan prinsip _Anti-Distraksi Hardware/Periferal_: model AI diwajibkan memfokuskan analisis HANYA pada subjek utama/isi konten layar yang diperlihatkan pengguna, serta dilarang keras mengomentari perangkat keras fisik di luar layar kecuali ditanyakan secara spesifik.
- **Strict Grounding & Presisi OCR Metrik Dashboard (`src/skills.ts`)**:
  - Mengatasi halusinasi pertukaran angka antar kartu/provider (sebelumnya model menukar metrik 93 calls milik Groq dengan Gemini 7 calls).
  - Menyuntikkan direktif OCR ketat pada `describeImage` dan `systemPrompt` (Bagian 5): model diwajibkan membaca teks dan kartu metrik secara teliti per kolom dari kiri ke kanan, memetakan setiap angka tepat ke judul provider masing-masing, serta dilarang menebak atau menukar nilai.
  - Membatasi panjang respon visual menjadi proporsional, santai, tenang, dan to-the-point (1-2 kalimat padat atau butir poin terstruktur).

### v0.24.2 — 2026-09-11 17:35 WIB

**Fine-Tuned 4-Tier Vision Failover Sequence, MistralAI Restoration & Standard CSS background-clip Compliance**

- **Penataan Ulang 4-Tier Rantai Prioritas Vision (`src/providers.ts`)**:
  - Menyusun urutan prioritas eksekusi model penglihatan (_vision_) sesuai permintaan pengguna:
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
  - Mengubah urutan prioritas pemrosesan foto/gambar (_vision modality_): menempatkan xKiro (model `qwen/qwen3.8-max:free`, `qwen/qwen3.6-plus:free`, `qwen/qwen3-vl-plus:free`) sebagai prioritas nomor 1 (`priority: 1`).
  - Menempatkan OpenRouter Vision sebagai cadangan (`priority: 2`) dan Google Gemini sebagai fallback terakhir (`priority: 3`), sehingga Gemini hanya digunakan jika xKiro dan OpenRouter tidak merespons.
- **Monitoring Kuota Sesi Bulanan WhatsApp Meta Cloud API (`api/stats.ts`, `public/dashboard.html`)**:
  - Menghitung jumlah sesi percakapan WhatsApp bulan ini berbasis jendela waktu 24 jam per nomor pengguna (_Service Conversations_).
  - Edukasi Kuota Meta 1.000 Sesi/Bulan: Jendela 24 jam dihitung sejak pesan pertama pengguna; interaksi chat bolak-balik tanpa batas selama 24 jam tersebut hanya dihitung 1 sesi tunggal ($0 free-tier).
  - Menyematkan kartu metrik _Sesi WhatsApp (Meta Cloud)_ pada ribbon monitoring dashboard (`used / 1.000 limit`, sisa kuota sesi gratis bulan ini, dan status Free Tier).
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
  - Menghapus kolom _Model Utama & Tier_ serta kolom _Batas Upstream Resmi_ yang redundan/tidak diperlukan sesuai permintaan pengguna.
  - Memfokuskan tabel ke dalam 5 kolom esensial:
    1. _Provider & Kunci API_ (Masked Key).
    2. _Akun Terdaftar_ (Nama & Email Akun).
    3. _Penggunaan Hari Ini_ (Token terpakai global, persentase, dan bar progress visual).
    4. _Sisa Kuota Hari Ini_ (Sisa token riil berwarna hijau emerald tebal).
    5. _Status Validasi_ (Badge sinkronisasi & health check).
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
  - Dilengkapi _Mini KPI Summary Ribbon_ di bagian atas: Total Limit Kuota Upstream (10M Token), Token Terpakai Hari Ini, Sisa Kuota Bersih xKiro (99.7% Tersedia), dan Status Kunci OpenRouter.
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
    - _Security & RLS Architect_ (Backend & Frontend Security Coder + OWASP + Timing-safe checks).
    - _Database Optimizer & Concurrency Specialist_ (Lost updates + Serverless lifecycle + Indexes).
    - _Senior Code Reviewer_ (Ponytail YAGNI + Karpathy Guidelines + Dead code hunting).
- **Pengamanan Proteksi Data Sesi WhatsApp (`src/whatsapp_session.ts`)**:
  - **Akar Masalah**: Fungsi `clearSessionInSupabase()` sebelumnya menjalankan `delete().neq('filename', '')` yang berisiko menghapus berkas `__admin_auth_config.json` saat sesi Baileys dibersihkan/direset pada mode dual-store.
  - **Solusi**: Menambahkan klausa proteksi eksplisit `.neq('filename', '__admin_auth_config.json')` guna menjamin kredensial Master PIN admin tidak pernah terhapus saat pembersihan sesi WhatsApp.
- **Penyempurnaan Penghitungan Kuota Provider (`src/providers.ts`)**:
  - **Akar Masalah**: Blok catch `chat()` sebelumnya memanggil `keyUsed(step.kind, key)` untuk semua jenis error, memotong kuota harian kunci secara keliru saat terjadi kegagalan jaringan sementara (`ECONNRESET`, timeout) atau HTTP 500 dari upstream provider.
  - **Solusi**: Menjaga integritas kuota dengan hanya memanggil `keyUsed` di blok catch jika error adalah `RATE_LIMITED` (429), mencegah penalti kuota pada kunci yang sebenarnya masih valid.
- **Hardening Keamanan XSS Dashboard Evaluasi (`public/dashboard.html`)**:
  - **Akar Masalah**: Tombol _Copy_ pada tabel evaluasi menggunakan event handler inline `onclick="copyPrompt('${escapeJs(p.userPrompt)}')"` yang berisiko jika prompt memuat string khusus atau karakter penutup tag.
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
  - Kartu KPI _Panggilan API_ di bagian atas dashboard kini menampilkan metrik ganda: jumlah panggilan dan estimasi total token (`~X Token • N Keys Terpantau`).
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
  - Membalik array di memori (_in-memory reverse_) untuk pairing, memangkas durasi pembacaan basis data dari ~3 detik menjadi ~40 milidetik.
- **Client-Side SWR Memory Cache (`public/dashboard.html`)**:
  - Mengintegrasikan `statsCache` dan `datasetCache` berbasis `Map` di peramban. Pergantian filter rentang waktu (`today`, `7d`, `14d`, `30d`, `all`) kini dirender secara instan (**0 milidetik**) dari memori jika pernah dimuat, sementara background fetch memperbarui data di latar belakang.
  - Tombol manual _Segarkan_ disetel untuk membypass cache (`force = true`).
- **Skrip Akselerator Indeks Supabase (`sql/migrate_v13_performance_indexes.sql`)**:
  - Menyediakan berkas migrasi SQL yang menambahkan 4 indeks B-tree krusial: `idx_messages_created_at_desc`, `idx_messages_role_created_at`, `idx_messages_platform_created_at`, dan `idx_provider_quota_day_desc` untuk menghapuskan _full table scan_ di Supabase.

### v0.22.4 — 2026-09-11 13:50 WIB

**Optimasi Dashboard & Efisiensi Database: Eliminasi Tabel Live Log Redundan & Sistem Pagination 5 Baris**

- **Pelebaran Responsif Kolom Jawaban Chatbot (`public/dashboard.html`)**:
  - Mengeliminasi pembatasan kaku `max-width: 520px` pada sel `.dataset-reply`, menggantinya dengan `max-width: 100%` serta mengalokasikan sisa ruang horizontal tabel secara maksimal untuk kolom _Jawaban Chatbot (Completion)_.
  - Teks jawaban bot kini membentang luas ke kanan memanfaatkan ruang layar yang lega, sehingga baris tabel tidak lagi memanjang ke bawah dan jauh lebih nyaman dipindai.
- **Sistem Penomoran Halaman (Pagination 5 Baris) Dataset Evaluasi (`public/dashboard.html`)**:
  - Membatasi tampilan tabel dataset evaluasi secara presisi menjadi 5 pasangan percakapan per halaman sehingga layout panel tetap rapi dan tidak memanjang ke bawah.
  - Mengintegrasikan kontrol navigasi pagination interaktif (tombol `Prev`, nomor halaman `1`, `2`, `3`, ..., dan `Next`) serta teks indikator jumlah percakapan yang ditampilkan.
  - Menambahkan pembatasan ketinggian maksimum (_max-height: 220px_) dengan scrollbar ramping pada prompt pengguna dan balasan bot agar isi teks yang sangat panjang tetap proporsional tanpa merusak estetika antarmuka.
- **Anti-Flicker / Anti-FOUC Authentication Guard (`public/dashboard.html`)**:
  - Mengatasi kendala modal masukkan PIN yang berkedip (_blink/flicker_) saat halaman dashboard di-refresh oleh pengguna yang telah login.
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
  - Proteksi anti-brute force bertingkat: 5 kali percobaan PIN salah langsung mengaktifkan penguncian (_lockout_) sistem selama 1 menit.
- **Pemulihan Lupa PIN via Resend Email OTP**:
  - Fitur "Lupa PIN?" terintegrasi dengan Resend REST API (`RESEND_API_KEY`) yang mengirimkan kode OTP 6-digit acak (_CSPRNG_) ke email admin (`raflyfirmansyah02@gmail.com`).
  - Dilengkapi pembatasan frekuensi pengiriman OTP (_rate limiting_: jeda minimum 60 detik, maksimal 3 pengiriman per 10 menit per IP) dan validasi batas kedaluwarsa OTP 10 menit.
  - Reset PIN otomatis menganulir (_invalidate_) seluruh token sesi aktif demi menjaga keamanan lintas perangkat secara real-time.
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
  - Melacak status kesehatan 12 API Key secara individual (Groq, Gemini, OpenRouter, Ollama) berdasarkan akhiran 4 karakter (_masked suffix_), kuota terpakai, batas harian, dan persentase penggunaan dengan penanda visual (Healthy, Warning >80%, Capped).
  - Menghitung statistik pesan hari ini vs semua waktu, proporsi traffic WhatsApp vs Telegram, distribusi pemanggilan model AI, dan kuantitas pemrosesan media (Voice Note Whisper, Dokumen PDF/Word, Foto, Stiker, dan Teks).
  - Menampilkan log aktivitas 25 percakapan terbaru dengan penyamaran nomor telepon (_privacy masking_) demi keamanan privasi data pengguna.

### v0.20.1 — 2026-09-11 11:20 WIB

**Perbaikan: Eliminasi Halusinasi Penolakan VN & Voice Note Self-Awareness**

- **Penetapan Kesadaran Multimodal di `systemPrompt` (`src/skills.ts`)**:
  - Menambahkan Bagian 5 pada instruksi sistem: menegaskan bahwa bot terhubung penuh ke sistem pendengaran dan penglihatan mutakhir.
  - Melarang keras respons disclaimer bawaan model ("aku cuma bisa baca teks", "aku tidak bisa mendengar suara/VN").
- **Pembingkaian Konteks Audio (_Voice Note Prompt Framing_)**:
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
  - Merespons video kiriman pengguna secara kontekstual berbasis teks catatan (_caption_) yang disertakan.
- **Integrasi Universal Lintas Platform**:
  - Diaktifkan serentak dan identik pada Meta WhatsApp Cloud API (`src/whatsapp_cloud.ts`), Telegram Bot API (`src/telegram.ts`), dan WhatsApp Baileys Multi-Device (`src/whatsapp_baileys.ts`).

### v0.19.0 — 2026-09-11 10:35 WIB

**Kecerdasan Relasional & Siklus Belajar Adaptif: Flow-Conscious, Professional Excellence & Continuous Memory**

- Penegakan prinsip _Conversational Flow & Emotional Resonance_: bot sepenuhnya mengikuti alur percakapan yang dibawa pengguna tanpa mendahului atau membelokkan topik secara sepihak.
- Larangan keras terhadap saran/nasihat yang tidak diminta (_No Unsolicited Advice_): bot dilarang mengobral tips, evaluasi, atau solusi jika pengguna sekadar bercerita atau curhat.
- Penegakan standar profesionalisme tinggi pada tugas (_Professional Excellence_): saat mengerjakan koding, matematika, sains, analisis bisnis, riset data, atau dokumen resmi, bot beralih menjadi rekan profesional berstandar industri tinggi (disiplin, presisi, type-safe, aman, tanpa bercanda berlebihan).
- Implementasi inisiatif bertahap (_Clarifying Inquiry First_): jika mendeteksi kebingungan atau masalah, bot menanyakan detail konteks spesifik terlebih dahulu secara bersahabat sebelum memberikan opini atau masukan.
- Peningkatan frekuensi dan kedalaman siklus belajar (_Continuous Learning Loop_): interval distilasi memori dipercepat dari 20 pesan menjadi setiap 8 pesan, secara otomatis mengekstrak profil lawan bicara (gaya komunikasi, topik kesukaan, cerita berjalan, dan preferensi personal) ke tabel `summaries` Supabase agar bot semakin hari semakin mengenal dan memahami penggunanya.

### v0.18.0 — 2026-09-11 00:52 WIB

**Persona & Intelegensi Universal: True Companion Polymath & Clean Dynamic Pipeline**

- Transformasi menyeluruh persona bot menjadi Sahabat Karib Sejati & Partner Diskusi Cerdas Serbabisa (_Universal Polymath Companion_) di WhatsApp: interaksi setara, hangat, manusiawi, berakal sehat, dan berwawasan luas tanpa batas.
- Integrasi _Universal Situational Intelligence (Read the Room)_: bot membaca mood, tempo, dan maksud lawan bicara secara dinamis tanpa terjebak dalam sekat-sekat kategori kaku.
- Pembersihan arsitektur payload pesan (_Zero Prompt Pollution_): membuang tag pembungkus XML `<user_message>` dan mengintegrasikan memori percakapan, preferensi koreksi, serta fakta internet real-time langsung ke dalam instruksi sistem latar belakang.
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
- Pembagian giliran bicara (_conversational turn-taking_) agar interaksi chat WhatsApp terasa hidup, alami, dan menyenangkan.

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

- Pembersihan menyeluruh kode lama toko/e-commerce menjadi asisten kecerdasan buatan umum (_general personal assistant_).

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
