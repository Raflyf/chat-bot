# DOKUMENTASI SISTEM — FreeAIBot / AgentKit
**Versi:** v0.13.0  
**Status Lingkungan:** Produksi Aktif 24/7 (Vercel Serverless untuk Telegram + Baileys Multi-Device 24/7 untuk WhatsApp + Supabase PostgreSQL)  
**Terakhir Diperbarui:** 2026-09-10 22:10 WIB  

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
