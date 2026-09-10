# DOKUMENTASI SISTEM — FreeAIBot / AgentKit
**Versi:** v0.11.0  
**Status Lingkungan:** Produksi Aktif 24/7 (Vercel Serverless + Supabase PostgreSQL)  
**Terakhir Diperbarui:** 2026-09-10 20:58 WIB  

---

## 1. Arsitektur Dual-Mode

Sistem dirancang dengan fleksibilitas tinggi menggunakan prinsip *Single Codebase, Dual Execution*:
1. **Mode Lokal / Terminal (`src/index.ts`)**:
   - Berjalan dengan mekanisme Telegram long-polling.
   - Pekerja pengingat internal (*in-process worker*) berjalan setiap 30 detik untuk memeriksa tabel `reminders`.
   - Ideal untuk pengujian cepat, inspeksi langsung, dan debugging interaktif.
2. **Mode Serverless 24/7 Vercel (`api/webhook.ts` + `api/cron/reminders.ts`)**:
   - Webhook endpoint (`POST /api/webhook`) dilindungi verifikasi `X-Telegram-Bot-Api-Secret-Token` menggunakan algoritma *constant-time* `crypto.timingSafeEqual`.
   - Vercel Cron (`GET /api/cron/reminders`) terintegrasi untuk mengeksekusi pengingat terjadwal langsung dari database.
   - Beroperasi 24 jam nonstop tanpa memerlukan terminal lokal yang menyala.

---

## 2. Alur Eksekusi Sistem (Pipeline End-to-End)

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
[Mesin Penelusuran Web Real-Time (`src/web.ts`)]
  ├── Deteksi URL & Deep Webpage Scraper (Jina Reader / Fit-Markdown)
  ├── Formulator Kueri Cerdas Dwibahasa (ID & EN)
  └── Matriks Pencarian Multi-Sumber:
        ├── Google News Global RSS
        ├── Google Berita Indonesia RSS
        ├── Bing News RSS
        ├── Hacker News Algolia API
        ├── Wikipedia Full-Text Search (ID & EN)
        └── arXiv Preprints API
       │
       ▼
[Skills, Prompt System & Guardrails (`src/skills.ts`)]
  ├── Pembungkusan Input Aman: <user_message>
  ├── Mandat Grounding Fakta Terkini (Anti-Halusinasi Cut-off 2024)
  └── Redaksi Kredensial Sensitif: redactOutput()
       │
       ▼
[Router Dua-Tingkat Timeout (`src/providers.ts`)]
  ├── Tingkat 1 (Connect Timeout 8 dtk): Deteksi Cepat 429/Kunci Mati
  └── Tingkat 2 (Thinking Timeout 90 dtk): Inferensi Mendalam & Token 2500
       │
       ▼
[Rantai Failover Model Provider]
  OpenRouter (Nex-AGI / Gemma) ──(fail)──> Groq ──(fail)──> Gemini ──(fail)──> Ollama Cloud
       │
       ▼
[Pengiriman Respons ke Telegram + Penyimpanan Supabase RLS]
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
