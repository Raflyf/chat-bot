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

### 3.3. Pemrosesan Multimodal & Vision
- Menerima kiriman foto dan dokumen gambar dari Telegram.
- Mengunduh berkas secara terisolasi dengan batas waktu 30 detik.
- Mengarahkan pemrosesan ke model vision untuk mendeskripsikan atau menjawab pertanyaan seputar gambar.

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

### v0.13.0 — 2026-09-10 22:15 WIB
**Pembaruan Utama: WhatsApp Multi-Device 24/7 Unlimited Engine & Supabase Cloud Session Persistence**
- **Integrasi Penuh WhatsApp Baileys (`src/whatsapp_baileys.ts`)**:
  - Mengimplementasikan client WhatsApp Multi-Device resmi (`@whiskeysockets/baileys`) untuk nomor WhatsApp khusus/pribadi.
  - 100% Gratis Tanpa Batas ($0 Unlimited): Bebas batasan kuota 1.000 sesi bulanan dari Meta Cloud API.
  - Pairing Interaktif: Menghasilkan QR Code langsung pada terminal console via `qrcode-terminal` untuk pemindaian instan via menu *Perangkat Tertaut (Linked Devices)* WhatsApp di HP.
- **Supabase Cloud Session Persistence (`src/whatsapp_session.ts`)**:
  - Menyinkronkan file sesi otentikasi Baileys (`session_wa/`) secara otomatis ke tabel `whatsapp_sessions` di Supabase.
  - Memungkinkan bot tetap login otomatis (zero re-scan) saat container hosting gratis (seperti Render.com atau Koyeb) melakukan restart berkala.
  - Dilindungi skrip Row Level Security (RLS) pada `sql/migrate_v10_whatsapp_sessions.sql` dengan akses eksklusif untuk `service_role`.
- **Otak AI Terpadu & Fitur Komplit**:
  - Terhubung langsung ke pipeline kecerdasan universal `src/skills.ts` (penalaran multi-disiplin, pemecahan matematika, koding, dan zero-noise scrubber).
  - Penanganan pesan gambar/soal via Gemini Vision multimodal (`describeImage`).
  - Penelusuran web real-time 2026 via `src/web.ts` saat terdeteksi kueri berita, harga, atau fakta dinamis.
  - Memori percakapan persisten Supabase (`chat_id = wa_<jid>`) dan auto-summarization setiap 20 interaksi.
  - *Safe Paragraph Chunking*: Pemecahan aman di batas paragraf (`\n\n`) jika pesan melebihi 4000 karakter (`sendWhatsAppMessageSafe`).
- **Skrip Eksekusi Mandiri (`package.json`)**:
  - Menambahkan script `npm run whatsapp` untuk lokal / pengembangan dan `npm run whatsapp:prod` untuk server produksi 24 jam.

### v0.12.0 — 2026-09-10 21:30 WIB
**Pembaruan Utama: Universal Multi-Domain Intelligence, Zero-Noise CoT Scrubber & Telegram Math Formatter**
- **Kecerdasan Universal Multi-Disiplin (`systemPrompt` di `src/skills.ts`)**:
  - Mengonfigurasi persona asisten AI polymath unggul lintas bidang: Matematika lanjut, Rekayasa Perangkat Lunak, Sains Alami (Termodinamika, Fisika, Kimia), Logika Deduktif, dan Bahasa Indonesia luwes bebas klise AI (*anti-slop*).
  - Algoritma Aljabar & Rumus Kuadrat abc: Mengeliminasi halusinasi pemfaktoran bilangan bulat semu pada persamaan kuadrat dengan mewajibkan evaluasi diskriminan $D = b² - 4ac$ dan perumusan langsung identitas simetris $x³ + y³ = S(10 - P)$.
- **Telegram Math Formatter (`cleanMathAndNoise` di `src/skills.ts`)**:
  - Konversi otomatis ekspresi LaTeX mentah (`\[ \]`, `\( \)`, `$$`, `$`) ke notasi aljabar bersih dan simbol Unicode ramah Telegram (`²`, `³`, `√`, `±`, `⇒`, `×`, `÷`, `≤`, `≥`, `≠`, `π`).
  - Penanganan rekursif pecahan LaTeX bertingkat `\frac{...}{...}` dan akar `\sqrt{...}`.
- **Pembersihan Residu Berpikir & Monolog CoT Total (Zero-Noise Scrubber)**:
  - Mengeliminasi tag `<think>...</think>`, unclosed `<think>`, serta monolog draf internal model berbahasa Inggris (`Here's a thinking process:`, `1. **Analyze User Input:**`).
  - Menghapus kebisingan draf sehingga pengguna Telegram menerima 100% jawaban solutif dan bersih.
- **Optimasi Latensi & Prioritas Provider (30 Detik -> 1.5 - 2.5 Detik)**:
  - Re-ordering router provider: Groq `qwen3.8-27b` diprioritaskan pertama untuk kueri teks, matematika, koding, dan penalaran cepat kilat (~2s).
  - Gemini `gemini-2.5-flash` diprioritaskan untuk pemrosesan gambar/multimodal vision (~1.7s).
  - OpenRouter dijadikan pool cadangan berkapasitas tinggi 5 kunci API.
- **Klasifikasi Kueri Cerdas (`needsSearch` di `src/web.ts`)**:
  - Melewati penelusuran web untuk soal matematika murni, kalkulus, algoritma koding, dan translasi teks guna memangkas overhead latency 3-4 detik dan mencegah pencemaran prompt dengan berita tak relevan.
- **Proteksi Panjang Pesan Telegram (`sendTelegramMessageSafe` di `src/telegram.ts`)**:
  - Pemecahan otomatis teks panjang (> 4000 karakter) di batas paragraf (`\n\n`) untuk mencegah error Telegram API `400 Bad Request: message is too long`.

### v0.11.1 — 2026-09-10 21:12 WIB
**Penyempurnaan: Top Headlines Real-Time Feed & Explicit Bot Identity**
- Penanganan Kueri Berita Umum: Menambahkan integrasi langsung *Top Headlines RSS* Indonesia & Global untuk kueri seperti "berita terbaru hari ini" atau "kabar terkini", memastikan artikel yang ditarik adalah terbitan hari ini (10 September 2026).
- Penguatan Identitas FreeAIBot: Menghilangkan residu identitas model bawaan provider ("Chat dari OpenAI") pada instruksi sistem agar bot selalu menjawab dengan identitas resminya sebagai FreeAIBot.
- Penegasan Penelusuran Mandiri: Menginstruksikan model untuk secara proaktif menyajikan ringkasan berita terstruktur (Nasional & Internasional) tanpa meminta pengguna mengirimkan tautan secara manual.

### v0.11.0 — 2026-09-10 20:57 WIB
**Fitur Utama: Universal Real-Time Web Search & Deep Browsing Engine**
- Mengadopsi arsitektur mesin pencari teruji dari proyek Portofolio Terminal AI Rafly Firmansyah ke dalam `src/web.ts`.
- Matriks Mesin Multi-Sumber Paralel: Menghubungkan Google News Global RSS, Google Berita Indonesia RSS, Bing News RSS, Hacker News Algolia, Wikipedia EN & ID, dan arXiv Preprints.
- Deep Webpage Scraper & Jina Reader: Menambahkan kapabilitas pembacaan halaman web secara mandiri; mendeteksi URL/domain dan mengonversi konten menjadi Fit-Markdown bersih.
- Formulator Kueri Cerdas (`formulateSmartSearchQueries`): Menormalisasi typo/slang bahasa Indonesia, membersihkan *filler words*, dan memproduksi kueri dwibahasa presisi tinggi.
- Eliminasi Cut-off 2024: Memperbarui instruksi sistem pada `src/skills.ts` agar model wajib menggunakan fakta internet real-time dan dilarang mengklaim tidak memiliki akses internet.
- Deduplikasi judul berita lintas sumber, algoritma pembobotan kesegaran waktu (*recency scoring*), dan proteksi keamanan SSRF.

### v0.10.2 — 2026-09-10 20:50 WIB
**Perbaikan: Search Upgrade to Full-Text & Live Tech Feeds**
- Mengganti pencarian OpenSearch terbatas menjadi Wikipedia Full-Text Search (ID/EN) dan Hacker News Algolia real-time.
- Menjamin respons berita teknologi mutakhir tanpa ketergantungan API key berbayar.

### v0.10.1 — 2026-09-10 20:41 WIB
**Infrastruktur: Vercel Static Asset & Output Directory Compatibility**
- Menambahkan `public/index.html` dan mengonfigurasi `outputDirectory: "public"` pada `vercel.json` untuk kompatibilitas deployment Vercel.
- Menyesuaikan jadwal cron pengingat agar kompatibel penuh dengan batasan akun Vercel Hobby.
- Menambahkan dukungan otomatis untuk pembacaan variabel lingkungan integrasi Supabase Vercel (`POSTGRES_URL`, `NEXT_PUBLIC_SUPABASE_URL`, dll).

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
