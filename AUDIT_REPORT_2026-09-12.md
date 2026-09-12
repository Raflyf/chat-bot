# Laporan Audit Menyeluruh — FreeAiBot / AgentKit v0.25.x

## Metadata

| Field             | Nilai                                                                                                                                           |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Proyek            | FreeAiBot / AgentKit                                                                                                                            |
| Versi terdeteksi  | v0.25.1 (`package.json`) — drift terhadap dokumen                                                                                               |
| Workspace         | `d:/code/project/projek_no_name`                                                                                                                |
| Tanggal audit     | 2026-09-12 (WIB)                                                                                                                                |
| Metode            | Audit baca-saja (read-only) 8 fase, baris per baris, didelegasikan ke sub-agent khusus (Ask/Debug/Architect)                                    |
| Modifikasi berkas | Tidak ada. Nol berkas diubah                                                                                                                    |
| Stack             | Node >=22, ESM TypeScript strict, Vercel serverless (`api/`) + container Baileys long-running (`Dockerfile`, Render/Koyeb), Supabase PostgreSQL |
| Provider LLM      | xKiro gateway -> Groq -> Gemini -> OpenRouter                                                                                                   |
| Kanal             | Telegram (`node-telegram-bot-api`), WhatsApp Cloud (Meta Graph v21), WhatsApp Baileys MD                                                        |
| Verdict           | BELUM sweetspot. 6 Critical, 40 High, ~55 Medium, ~35 Low                                                                                       |

---

## Daftar Isi

1. [Ringkasan Eksekutif](#1-ringkasan-eksekutif)
2. [Scorecard](#2-scorecard)
3. [Catatan AGENTS.md](#3-catatan-agentsmd)
4. [Fase 0 — Recon](#4-fase-0--recon)
5. [Fase 1+2 — Core Runtime & Memory](#5-fase-12--core-runtime--memory)
6. [Fase 3 — Persona / Knowledge / Sanitization](#6-fase-3--persona--knowledge--sanitization)
7. [Fase 4 — Database](#7-fase-4--database)
8. [Fase 5 — Security](#8-fase-5--security)
9. [Fase 6+7 — Messaging & Web](#9-fase-67--messaging--web)
10. [Tabel Konsolidasi Severity](#10-tabel-konsolidasi-severity)
11. [Attack Chains](#11-attack-chains)
12. [Rencana Perbaikan (P0-P3)](#12-rencana-perbaikan-p0-p3)
13. [Approval Checklist](#13-approval-checklist)

---

## 1. Ringkasan Eksekutif

Audit baca-saja dilakukan dalam 8 fase terhadap seluruh berkas milik proyek (di luar `node_modules`). Fondasi engineering tergolong kuat (struktur modular, TypeScript strict, pemisahan kanal), namun tiga kategori cacat struktural menahan kualitas dan keamanan sistem:

1. **Keamanan otentikasi rapuh** — PIN default/publik, RPC admin terbuka untuk `anon`, dan race pada lockout memungkinkan pengambilalihan dashboard tanpa interaksi.
2. **Reliabilitas pesan bocor** — webhook fail-open, akuntansi kuota tidak ditegakkan, kebocoran timer/provider, dan reset sesi yang bisa dibatalkan kembali.
3. **Kecerdasan bot turun kualitas** — persona berbasis positional-join yang saling bertentangan, injeksi knowledge diperlakukan sebagai instruksi, dan deteksi kebutuhan pencarian yang meleset.

**Kesimpulan:** Belum berada di sweetspot. Diperlukan 3 langkah struktural (priority-stack persona + few-shot, RAG-lite, satu intent pass) sebagai prasyarat naik kelas.

### Distribusi Temuan

| Severity | Jumlah |
| -------- | ------ |
| Critical | 6      |
| High     | 40     |
| Medium   | ~55    |
| Low      | ~35    |

---

## 2. Scorecard

| Kategori              | Skor   | Status    |
| --------------------- | ------ | --------- |
| Keamanan & Auth       | 3.5/10 | HIGH RISK |
| Database              | 4/10   | Berisiko  |
| Reliabilitas pesan    | 4/10   | Berisiko  |
| Kecerdasan bot        | 5/10   | Cukup     |
| Arsitektur / struktur | 6/10   | Cukup     |

**Verdict:** BELUM sweetspot. Fondasi engineering kuat, tapi 3 kategori cacat struktural menahan kualitas & keamanan.

---

## 3. Catatan AGENTS.md

**Temuan:** Tidak ada `AGENTS.md`, `.roorules`, `.clinerules`, `.roo/`, `.github/`, `.vscode/`, `CLAUDE.md`, atau `CONTRIBUTING.md` di dalam proyek (diverifikasi rekursif via `list_files`/`read_file`/regex). Kecocokan hanya ditemukan di dalam `node_modules` (bukan milik proyek).

**Implikasi:** Tidak ada aturan mutlak tingkat proyek. Audit dijalankan terhadap aturan standar + konteks kode.

**Rekomendasi P3-1:** Buat `AGENTS.md` agar aturan pengguna tertuang otomatis dan dapat ditegakkan.

---

## 4. Fase 0 — Recon

### 4.1 Inventaris Berkas

| Area        | Berkas                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Catatan |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| Root config | [`.dockerignore`](.dockerignore:1), [`.env.example`](.env.example:1) (77 baris), [`.gitignore`](.gitignore:1), [`Dockerfile`](Dockerfile:1) (22), [`DOCUMENTATION.md`](DOCUMENTATION.md:1) (1245), [`LICENSE`](LICENSE:1), [`README.md`](README.md:1) (89), [`package.json`](package.json:1) (35), [`tsconfig.json`](tsconfig.json:1) (18), [`vercel.json`](vercel.json:1) (36)                                                                                                                                                                                                                                                                                                                                             | —       |
| `api/`      | [`admin-otp.ts`](api/admin-otp.ts:1) (179), [`dataset.ts`](api/dataset.ts:1) (456), [`stats.ts`](api/stats.ts:1) (577), [`webhook.ts`](api/webhook.ts:1) (45), [`whatsapp.ts`](api/whatsapp.ts:1) (56), [`cron/reminders.ts`](api/cron/reminders.ts:1) (34)                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | —       |
| `src/`      | [`admin_auth.ts`](src/admin_auth.ts:1) (665), [`db.ts`](src/db.ts:1) (40), [`env.ts`](src/env.ts:1) (118), [`index.ts`](src/index.ts:1) (17), [`knowledge.ts`](src/knowledge.ts:1) (212), [`media.ts`](src/media.ts:1) (416), [`memory.ts`](src/memory.ts:1) (181), [`providers.ts`](src/providers.ts:1) (307), [`quota.ts`](src/quota.ts:1) (62), [`remind.ts`](src/remind.ts:1) (121), [`skills.ts`](src/skills.ts:1) (977), [`telegram.ts`](src/telegram.ts:1) (462), [`timezone.ts`](src/timezone.ts:1) (459), [`web.ts`](src/web.ts:1) (909), [`whatsapp_baileys.ts`](src/whatsapp_baileys.ts:1) (636), [`whatsapp_cloud.ts`](src/whatsapp_cloud.ts:1) (498), [`whatsapp_session.ts`](src/whatsapp_session.ts:1) (104) | —       |
| `sql/`      | [`schema.sql`](sql/schema.sql:1) (29), `migrate_v08`, [`migrate_v09_hardened.sql`](sql/migrate_v09_hardened.sql:1) (78), `migrate_v10_whatsapp_sessions`, [`migrate_v12_admin_auth.sql`](sql/migrate_v12_admin_auth.sql:1) (187), `migrate_v13_performance_indexes`, `migrate_v14_web_knowledge`, `migrate_v15_message_tokens`                                                                                                                                                                                                                                                                                                                                                                                              | —       |
| `public/`   | [`dashboard.html`](public/dashboard.html:1) (3923), [`index.html`](public/index.html:1) (645), `privacy.html`, `privacy/index.html`, [`favicon.svg`](public/favicon.svg:1)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | —       |
| `dataset/`  | 6 CSV ter-commit                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | —       |
| `scratch/`  | ~45 skrip uji ter-commit                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | —       |

### 4.2 package.json

- name `agentkit`, version `0.25.1`, `type: module`, `engines node>=22`.
- Scripts: `dev` (`tsx src/index.ts`), `whatsapp` (`tsx src/whatsapp_baileys.ts`), `whatsapp:prod`, `build` (`tsc`), `start`, `typecheck`.
- Deps: `@supabase/supabase-js`, `@whiskeysockets/baileys` rc14, `dotenv`, `mammoth`, `node-telegram-bot-api`, `pino`, `qrcode-terminal`.

### 4.3 tsconfig

- `rootDir src`, `include ["src/**/*"]` — **`api/` TIDAK type-checked (HIGH)**.

### 4.4 vercel.json

- `maxDuration`: webhook 60s, whatsapp 60s, cron 30s, stats 15s, dataset 20s, admin-otp 15s.
- **TIDAK ada blok `crons` yang dideklarasikan.**

### 4.5 Red Flags Awal

- Hardcoded PIN.
- Committed CSV data.
- Webhook fail-open.
- RPC RLS `anon`.
- `scratch/` ter-commit.
- `npm install` bukan `ci`.
- Version drift: pkg `0.25.1` vs DOCUMENTATION `v0.25.33` vs `index.html` `v0.25.6`.
- `api/` tidak diuji `tsc`.

---

## 5. Fase 1+2 — Core Runtime & Memory

### 5.1 [`src/index.ts`](src/index.ts:1) (17 baris)

| Severity | Temuan                                                      |
| -------- | ----------------------------------------------------------- |
| MEDIUM   | `startTelegram()` promise diabaikan -> unhandled rejection. |
| LOW      | `process.exit(0)` melewati teardown Baileys.                |

Verdict: minor.

### 5.2 [`src/env.ts`](src/env.ts:1) (118 baris) — needs rework

| Severity | Temuan                                                                                                                                                             |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| HIGH     | `supabaseUrl` menerima `POSTGRES_URL` (DSN `postgres://`) -> `createClient` gagal senyap -> memory lenyap (fail-open).                                             |
| HIGH     | `assertRuntime` hanya memeriksa token Telegram + satu provider key; tidak pernah memvalidasi pasangan `supabaseUrl`/`key`, kredensial WhatsApp, atau `cronSecret`. |
| HIGH     | Fallback hardcoded: `pinSalt = 'rafly_telemetry_salt'`, `adminEmail` default, `resendFrom` `onboarding@resend.dev`.                                                |
| MEDIUM   | `csv()` tidak men-strip bracket/quote.                                                                                                                             |
| MEDIUM   | `num()` tidak bisa mengekspresikan `0`.                                                                                                                            |
| MEDIUM   | `BOT_PROFILE` menerima string kosong.                                                                                                                              |
| LOW      | `isServerless` tidak mencakup non-VERCEL.                                                                                                                          |

### 5.3 [`src/providers.ts`](src/providers.ts:1) (307 baris) — needs rework

| Severity | Temuan                                                                                                                                                                                               |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CRITICAL | `connectTimeout` tidak membatasi durasi request; `Promise.race` timeout tidak membatalkan fetch maupun membersihkan timer yang kalah -> socket leak, timeout Lambda.                                 |
| HIGH     | Kuota tidak pernah ditegakkan (`keyAllowed` hanya membaca Map in-process; `provider_quota` ditulis tapi tidak pernah dibaca; cold start mereset).                                                    |
| HIGH     | Kegagalan non-429 tidak pernah dihitung -> tidak ada circuit breaking, tidak ada backoff.                                                                                                            |
| HIGH     | Cache: clear penuh saat >500 (thundering herd); `cacheKey = JSON.stringify` seluruh percakapan -> hit rate nyaris nol + unbounded + menyajikan balasan cache tanpa token -> merusak akuntansi token. |
| HIGH     | Type confusion `systemInstruction` dapat mengirim `"[object Object]"` ke Gemini.                                                                                                                     |
| HIGH     | Traversal sequential O(models x keys) tanpa probe paralel -> worst case latency 9N x timeout.                                                                                                        |
| MEDIUM   | Klasifikasi error kurang (400 vs 500/429).                                                                                                                                                           |
| MEDIUM   | Kebocoran timeout yang sama pada Gemini.                                                                                                                                                             |
| LOW      | Truncation leading-model.                                                                                                                                                                            |

### 5.4 [`src/quota.ts`](src/quota.ts:1) (62 baris) — needs rework

| Severity | Temuan                                                                                  |
| -------- | --------------------------------------------------------------------------------------- |
| HIGH     | Tabrakan counter-key (`id = kind:key.slice(-4):key.length`).                            |
| HIGH     | Persistence lossy (RMW race) + tidak pernah dibaca balik -> cap tidak dapat ditegakkan. |
| MEDIUM   | Map unbounded.                                                                          |
| MEDIUM   | `today()` berbasis UTC.                                                                 |

### 5.5 [`src/timezone.ts`](src/timezone.ts:1) (459 baris) — needs rework

| Severity | Temuan                                                                                                                                                                 |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HIGH     | `isAskingTime` over-trigger (qualifier opsional -> setiap kemunculan `jam`/`waktu`/`hari`/`tanggal`).                                                                  |
| HIGH     | Fallback GPS mengembalikan zone `'UTC'` dengan label `"UTC+8"` yang bertabrakan dengan keyword `LOCATION_MAP` `'utc+8'` -> user keliru ter-resolve ke WITA; DST salah. |
| HIGH     | `detectLocation` mengompilasi ~400 regex per pesan.                                                                                                                    |
| HIGH     | Keyword pendek berbahaya `la/sf/hk/bali/metro` -> lokasi salah -> dipersist permanen.                                                                                  |
| HIGH     | Jawaban pendek <=3 kata mempersist lokasi secara agresif.                                                                                                              |
| MEDIUM   | Tabel kode negara kasar (`+1` -> New York).                                                                                                                            |
| MEDIUM   | Scrub `detectLocation` tidak lengkap.                                                                                                                                  |
| MEDIUM   | Case 1 melabeli WIB sebagai waktu server.                                                                                                                              |
| LOW      | Kapitalisasi.                                                                                                                                                          |
| SAFE     | Tidak ada prompt injection via lokasi (keyword dari map tetap).                                                                                                        |

### 5.6 [`src/remind.ts`](src/remind.ts:1) (121 baris) — needs rework

| Severity | Temuan                                                                                                                                  |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| HIGH     | Misrouting lintas platform (cron menyimpulkan platform dari bentuk `chat_id`; ID Telegram >=10 yang diawali 1/62 -> dianggap WhatsApp). |
| HIGH     | Reminder duplikat (in-memory `setTimeout` + DB + worker 30s).                                                                           |
| HIGH     | Tidak ada idempotency/atomic claim pada `checkDueReminders` -> cron overlap duplikat; crash mengirim ulang.                             |
| HIGH     | `'failed'` terminal + tidak konsisten dengan delivery.                                                                                  |
| MEDIUM   | Tanpa `order` + limit 50.                                                                                                               |
| MEDIUM   | Dua panggilan LLM untuk menjelaskan format error.                                                                                       |
| LOW      | Interval worker tidak pernah dibersihkan.                                                                                               |

### 5.7 [`src/media.ts`](src/media.ts:1) (416 baris) — needs rework

| Severity | Temuan                                                                                                         |
| -------- | -------------------------------------------------------------------------------------------------------------- |
| HIGH     | Tidak ada validasi ukuran/tipe; base64 blowup -> Lambda OOM/413.                                               |
| HIGH     | Nol timeout pada semua fetch media.                                                                            |
| HIGH     | Prompt injection via teks dokumen yang diekstrak.                                                              |
| HIGH     | Decompression bomb pada `extractPdfTextSimple` (`zlib.inflateSync` tanpa batas).                               |
| HIGH     | `mammoth` pada docx tidak tepercaya tanpa size guard.                                                          |
| HIGH     | Ekstensi `.env/.log/.json` masuk daftar readable -> exfil secret ke LLM.                                       |
| MEDIUM   | `continue` saat `!res.ok` tidak pernah men-drain body, memperlakukan semua status sama, tanpa akuntansi kuota. |
| MEDIUM   | MIME sepenuhnya dipercaya.                                                                                     |
| MEDIUM   | Video/doc base64 tidak ter-truncate.                                                                           |
| LOW      | Tanpa temp file (lebih aman).                                                                                  |

### 5.8 [`src/memory.ts`](src/memory.ts:1) (181 baris) — needs rework

| Severity | Temuan                                                                                                                                                                                                                    |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CRITICAL | `resetSession` menghapus summary + menyisipkan marker, tapi `noteExchange` membaca ulang 25 pesan terakhir tanpa cutoff reset -> men-summarize ulang konten pra-reset -> riwayat yang "dilupakan" kembali dalam ~8 pesan. |
| HIGH     | `updateContextCache` no-op senyap untuk chat dingin + DB write fire-and-forget -> race read-after-write/turn duplikat.                                                                                                    |
| HIGH     | `resetSession` dapat dibatalkan oleh balasan in-flight (tanpa epoch guard).                                                                                                                                               |
| HIGH     | Window 24 pesan tanpa token budget + off-by-one (24 vs 25 vs "20").                                                                                                                                                       |
| HIGH     | Map `contextCache`/counter unbounded.                                                                                                                                                                                     |
| HIGH     | Trigger summarization per-instance (n%8) tidak andal di serverless.                                                                                                                                                       |
| MEDIUM   | Summary + raw double count.                                                                                                                                                                                               |
| MEDIUM   | Panggilan LLM fire-and-forget pada `noteExchange` bersaing dengan trafik live.                                                                                                                                            |
| MEDIUM   | Truncation input summary membuang yang terbaru.                                                                                                                                                                           |
| MEDIUM   | Marker checkpoint memakan slot window + over-filtered.                                                                                                                                                                    |
| MEDIUM   | `getContext` mengembalikan kosong pada error DB -> bot "lupa".                                                                                                                                                            |
| MEDIUM   | Tanpa retention.                                                                                                                                                                                                          |
| LOW      | Guard `warnOnce` inert.                                                                                                                                                                                                   |
| —        | Scratch test `test_reset_history_cutoff` mengimplementasikan ulang logika secara inline (tautologi, tanpa import dari `src`).                                                                                             |

---

## 6. Fase 3 — Persona / Knowledge / Sanitization

### 6.1 Persona

| ID  | Severity | Temuan                                                                                                                                                                                    |
| --- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | CRITICAL | `systemPrompt` flat string join, prioritas hanya posisional, core persona di index 4-5, memory/web menyusul.                                                                              |
| A2  | HIGH     | Beberapa regex classifier bersaing per turn.                                                                                                                                              |
| A3  | LOW      | Penomoran section duplikat.                                                                                                                                                               |
| A4  | HIGH     | Kontradiksi (`wkwk` dilarang vs diizinkan; no-closing-question vs punchline teka-teki + tawa; sticker 1-line lalu double truncation; identitas no-list vs `/start` yang menyebut 6 item). |
| A5  | MEDIUM   | `BOT_NAME` hanya substitusi string; dev story hard-coded.                                                                                                                                 |
| A6  | HIGH     | Injeksi tanggal/waktu/lokasi kontradiktif (background melarang menanyakan lokasi; ask-time menginstruksikan) + konten kanal dapat di-spoof.                                               |
| A7  | —        | Prompt statis ~4.000-4.500 token (core persona ~14.950 char); `Context_Tokens` teramati 6.069-6.994 pada riwayat 24 turn.                                                                 |

### 6.2 Knowledge

| ID  | Severity | Temuan                                                                                                                                                                                            |
| --- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | MEDIUM   | Dedup knowledge hanya exact-key (5 token pertama digabung, slice 80).                                                                                                                             |
| B2  | LOW      | Kategori hardcoded `tech_release` saat cache hit.                                                                                                                                                 |
| B3  | MEDIUM   | Penyimpanan whole-blob tanpa chunking/embedding; `saveKnowledge` `slice(0,5000)` memotong di tengah fakta; injeksi `web.slice(0,3800)` truncation kedua.                                          |
| B4  | HIGH     | Konten tersimpan dipercaya sebagai instruksi (diinjeksi sebagai "SUMBER KEBENARAN UTAMA"); `cleanStr` tidak menetralkan teks imperatif -> stored prompt injection lintas sesi dengan TTL 90 hari. |
| B5  | MEDIUM   | TTL 3-regex cascade; default `static_fact` 90 hari.                                                                                                                                               |
| B6  | MEDIUM   | Cache hit melewati validasi.                                                                                                                                                                      |
| B7  | HIGH     | Peluang RAG terlewat (tanpa embedding/rerank).                                                                                                                                                    |

### 6.3 Search decision

| ID  | Severity | Temuan                                                                                        |
| --- | -------- | --------------------------------------------------------------------------------------------- |
| C1  | HIGH     | `needsSearch` false positive (`apple/intel/amd/google` kata Indonesia).                       |
| C2  | HIGH     | False positive `jadwal/presiden/update/kabar`.                                                |
| C3  | MEDIUM   | Bug urutan: anchor tahun 2026 diperiksa sebelum default akhir -> setiap "2026" memicu search. |
| C4  | HIGH     | False negative (kueri recency informal).                                                      |
| C5  | MEDIUM   | Biaya: abort 3.2s + 6 fetch.                                                                  |

### 6.4 Sanitization

| ID  | Severity | Temuan                                                                                                                                                                     |
| --- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | HIGH     | `cleanMathAndNoise` ~60 replace berurutan, 900 baris, drift penomoran, emoji hard-cap menurunkan kualitas, superscript/frac diterapkan di dalam code fence (korupsi kode). |
| D2  | LOW      | Pass emoji membaca `out.length` di tengah replace.                                                                                                                         |
| D3  | HIGH     | Kebocoran CoT dapat terjadi saat balasan tidak diawali `think`.                                                                                                            |
| D4  | CRITICAL | Echo system-prompt/kapabilitas (bot memancarkan spec-sheet sendiri "### 1. ..."); tidak ada yang men-strip.                                                                |
| D5  | MEDIUM   | Over-stripping (`#` hashtag di mana-mana termasuk kode; dash dalam URL; blacklist stage-direction).                                                                        |
| D6  | HIGH     | `test_unclosed_cot.mjs` adalah fork, bukan test.                                                                                                                           |

### 6.5 Splitting & Persistence

| ID  | Severity | Temuan                                                                                                |
| --- | -------- | ----------------------------------------------------------------------------------------------------- |
| E1  | HIGH     | Batas split buta terhadap code fence (3 splitter terduplikasi).                                       |
| E2  | MEDIUM   | 3 salinan `maxLen 4000`.                                                                              |
| E3  | MEDIUM   | `saveMessage` `slice(0,4000)` sementara yang dikirim penuh -> riwayat berbeda dari yang dilihat user. |
| E4  | LOW      | Sticker double truncation.                                                                            |
| E5  | MEDIUM   | Dialek markdown tidak lengkap (tabel, `~~`, `_italic_`).                                              |
| F1  | HIGH     | `/salah` & `/remind` hilang di WhatsApp (hanya Telegram).                                             |
| F2  | HIGH     | `isResetCommand` kata polos `reset/clear` bertabrakan dengan chat normal -> penghapusan sesi.         |
| F3  | CRITICAL | Checkpoint tidak dihormati oleh summarizer (terkonfirmasi `memory.ts:138`).                           |
| F4  | HIGH     | Persistensi lokasi tanpa sintaks perintah, tanpa undo.                                                |
| F5  | MEDIUM   | Koreksi dibatasi 5 tanpa TTL.                                                                         |
| F6  | MEDIUM   | Turn hasil-perintah melewati persistensi.                                                             |

### 6.6 Dataset (G)

- **G1 CSV schema:** `ID, Waktu, Platform, User_Chat, Jawaban_Bot, Model_Via, Context_Tokens, Output_Tokens, Total_Tokens` (+`Tanggal/Jam/Waktu_Lokal/Waktu_UTC`).
- **G2 HIGH:** PII tidak diredaksi pada CSV ter-commit.
- **G3:** Benchmark lemah (tanpa ground truth, tanpa `user_id`, tanpa latency, tanpa feedback).
- **G4:** Strategi evaluasi yang direkomendasikan.

### 6.7 Test Gaps (H)

| Berkas                        | Masalah                                      |
| ----------------------------- | -------------------------------------------- |
| `test_reset_session`          | 13 pemeriksaan kesetaraan, tanpa logika bus. |
| `test_reset_history_cutoff`   | Tautologi, tanpa import.                     |
| `test_unclosed_cot`           | Fork.                                        |
| `test_needs_search`           | Fork lama.                                   |
| `test_smart_needs_search`     | Salinan ketiga yang mengodekan bug.          |
| `test_knowledge_e2e`          | Mengassert cache panas, bukan DB.            |
| `test_universal_intelligence` | Tanpa exit code.                             |

### 6.8 Sweetspot Phase 3

Belum di sweetspot. 3 langkah struktural:

1. Priority-stack persona + few-shot.
2. RAG-lite.
3. Satu intent pass.

**Top 10 perbaikan Phase 3:** refactor persona; netralkan injeksi knowledge; perbaiki `/reset`; de-fork test; chunker sadar code-fence; perbaiki `needsSearch`; strip echo spec-sheet; tambah instrumentasi dataset; RAG-lite; persona config-driven + parity.

---

## 7. Fase 4 — Database

### 7.1 Skema Tabel

| Tabel               | Kolom                                                                                                                                                                                          | Catatan                          |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `messages`          | `id, platform` (tanpa CHECK), `chat_id, role` CHECK `user\|assistant`, `content, via, created_at, prompt/completion/total_tokens`                                                              | kolom token tidak pernah ditulis |
| `summaries`         | `chat_id` PK, `summary, updated_at`                                                                                                                                                            | tanpa trigger                    |
| `corrections`       | `id, chat_id, correction, created_at`                                                                                                                                                          | tanpa dedup                      |
| `provider_quota`    | `kind, key_suffix, day` UNIQUE, `used`                                                                                                                                                         | tanpa CHECK `>=0`                |
| `reminders`         | `id, chat_id, message, due_at, status` CHECK `pending\|sent\|failed`, `created_at`                                                                                                             | tanpa `sent_at`/`attempts`       |
| `whatsapp_sessions` | `filename` PK, `content, updated_at`                                                                                                                                                           | —                                |
| `admin_auth_config` | `id` PK `'master_auth', pin_hash, lockout_attempts` tanpa NOT NULL, `locked_until, otp_code_hash, otp_expires_at, session_token` JSON-in-text, `session_expires_at, updated_at` tanpa NOT NULL | —                                |
| `web_knowledge`     | `entity_key` UNIQUE, `category` CHECK, `query_sample, knowledge, source_urls text[], expires_at, hit_count, created_at, updated_at`                                                            | —                                |

### 7.2 Critical

| Severity | Temuan                                                                                                                             |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| CRITICAL | Race RMW `provider_quota` -> lost updates.                                                                                         |
| CRITICAL | `GRANT EXECUTE rpc_admin_* TO anon` -> oracle brute force PIN + `save_otp`/`verify_otp_and_reset_pin` = pengambilalihan PIN penuh. |
| CRITICAL | RPC `increment_knowledge_hit` dipanggil tapi tidak pernah didefinisikan -> spam 404, `hit_count` mati.                             |

### 7.3 High

- Tidak ada migration version ledger; `schema.sql` vs `v08`/`v09` duplikat; niat `v09_hardened` diregresi oleh `v12`.
- `web_knowledge` RLS tanpa policy apa pun.
- Race status `reminders` tanpa claim -> kirim duplikat.
- Singleton `admin_auth_config` lost-update melewati lockout.
- Index `ilike entity_key%` tidak dapat memakai btree (tanpa `text_pattern_ops`/trgm).
- `messages` tumbuh tanpa batas, tanpa retention.
- `v12` tanpa `REVOKE anon`.

### 7.4 Medium

- `whatsapp_sessions` menyimpan secret plaintext + config admin di dalam tabel session; path traversal `restore`; loop reminder N+1; `stats` full scan; tanpa tuning autovacuum.

### 7.5 Perlindungan Data

`messages`/`corrections`/`summaries`/`whatsapp_sessions`/`admin_auth_config` menyimpan PII/kredensial; tanpa retention/RTBF; `chat_id` tidak di-hash (diizinkan?); dataset menutupi sebagian tapi prompt/balasan mentah verbatim.

### 7.6 Migration Gaps

1-12 terdaftar. Ledger: `schema.sql`, `v08`, `v09`, `v10`, `v11` **HILANG**, `v12`, `v13`, `v14`, `v15`.

### 7.7 Top 10 DB Remediations

1. Revoke RPC `anon`.
2. Atomic quota increment.
3. Definisikan `increment_knowledge_hit`.
4. Migration ledger + konsolidasi.
5. `reminders` claim `SKIP LOCKED` + `sent_at`/`attempts`.
6. Serialize `admin_auth_config`.
7. Retention/partisi.
8. Perbaiki index `web_knowledge`.
9. Constrain `platform` + hentikan `[SESSION_RESET]` sebagai `role=user`.
10. RLS policy/grants + sanitasi `filename`.

---

## 8. Fase 5 — Security

### 8.1 Scorecard Keamanan

| Aspek            | Skor | Severity | Ringkas                                                                                                                                                                                 |
| ---------------- | ---- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A Authentication | 2/10 | Critical | SHA-256 mentah + salt statis publik + default hash ter-commit; PIN 4-8 digit (keyspace 10^4-10^8) dapat di-crack dalam detik-menit.                                                     |
| B Brute-force    | 2/10 | Critical | Race lockout non-atomik, `x-vercel-forwarded-for` dapat di-spoof, window 1 menit, oracle counter terekspos tanpa auth.                                                                  |
| C Endpoint       | 4/10 | High     | Tanpa penegakan CSRF/Origin, `send_otp`/`reset` tanpa auth, stack trace, CSP/HSTS/Referrer-Policy hilang, token-in-query.                                                               |
| D Webhook        | 3/10 | High     | Dua jalur fail-open, HMAC Meta atas body re-serialisasi, cron fail-open + non-constant-time.                                                                                            |
| E Secrets        | 2/10 | Critical | PIN/salt/email hardcoded di `src`+`.env.example`+docs+dashboard+build; default hash ter-commit; anon key di fallback chain server; `assertRuntime` menghilangkan semua secret keamanan. |
| F Injection      | 7/10 | Medium   | Tanpa SQLi; XSS dataset ter-escape; path traversal session restore; CSV formula injection + PII ter-commit.                                                                             |
| G Authorization  | 4/10 | High     | Endpoint di-gate dengan benar TAPI RPC SECURITY DEFINER yang di-grant ke anon = bypass laten; PIN single-tier.                                                                          |
| H Session/Data   | 4/10 | Medium   | Token di `sessionStorage` + URL, HMAC stateless berkey material publik, tanpa revocation server, config auth menyatu dengan tabel session.                                              |

**Overall: 3.5/10 HIGH RISK.**

### 8.2 Findings P5-001 .. P5-032

PIN KDF; OTP keyspace; session HMAC key; throttle in-memory; clock trust; race lockout; IP header spoofing; lockout 1 menit; oracle; CSRF pada POST state-changing; GET `get_auth_state` + token di query; stack trace; header hilang; content-type; Telegram fail-open; HMAC Meta re-serialisasi; verify-token non-constant-time; cron fail-open; default hardcoded; anon key fallback; assertion hilang; `claude-mem` cleartext; XSS ter-mitigasi; path traversal; tanpa SQLi; LLM/CSV injection; SSRF rendah; anon RPC takeover; endpoint di-gate; single-tier; `sessionStorage`; config auth di dalam tabel session.

### 8.3 Top 10 Security Remediations

(Lihat [CHAIN1-3](#11-attack-chains) dan [P0](#121-p0--hotfix-keamanan) untuk konteks.)

---

## 9. Fase 6+7 — Messaging & Web

### 9.1 Verdict Komponen

| Komponen                                           | Verdict                        | Catatan         |
| -------------------------------------------------- | ------------------------------ | --------------- |
| [`whatsapp_cloud.ts`](src/whatsapp_cloud.ts:1)     | Conditional / FAIL-OPEN        | —               |
| [`whatsapp_baileys.ts`](src/whatsapp_baileys.ts:1) | FAIL                           | lifecycle       |
| [`whatsapp_session.ts`](src/whatsapp_session.ts:1) | FAIL                           | integritas      |
| [`telegram.ts`](src/telegram.ts:1)                 | Conditional / divergence-heavy | —               |
| [`api/webhook.ts`](api/webhook.ts:1)               | PASS                           | dengan coupling |
| [`api/whatsapp.ts`](api/whatsapp.ts:1)             | FAIL-OPEN                      | —               |
| [`api/stats.ts`](api/stats.ts:1)                   | Conditional                    | —               |
| [`api/dataset.ts`](api/dataset.ts:1)               | Conditional                    | —               |
| [`api/cron/reminders.ts`](api/cron/reminders.ts:1) | FAIL                           | misrouting      |
| [`dashboard.html`](public/dashboard.html:1)        | Conditional                    | —               |
| [`index.html`](public/index.html:1)                | PASS                           | minor           |
| privacy pages                                      | PASS                           | gap konten      |

### 9.2 Tabel Message-Flow

| Aspek        | Status                                                      |
| ------------ | ----------------------------------------------------------- |
| Dedup        | Cloud in-memory saja, Baileys tidak ada, Telegram tidak ada |
| Ordering     | OK                                                          |
| Reset        | OK di semua                                                 |
| Commands     | Asimetris (`remind`/`salah` hanya Telegram)                 |
| Media        | Timeout hanya Telegram                                      |
| Chunking     | Buta code-fence                                             |
| Ack          | Selalu 200                                                  |
| Self-loop    | Terjaga                                                     |
| Group policy | Flag                                                        |
| Save-vs-send | Divergen                                                    |
| Location     | via omitted                                                 |

### 9.3 Critical

| ID  | Temuan                            |
| --- | --------------------------------- |
| C1  | WA signature fail-open.           |
| C2  | Raw-body HMAC.                    |
| C3  | Baileys nol dedup.                |
| C4  | Path traversal.                   |
| C5  | Shutdown kehilangan session baru. |

### 9.4 High

| ID  | Temuan                                   |
| --- | ---------------------------------------- |
| H1  | Reconnect storm double-instance.         |
| H2  | Cron fail-open.                          |
| H3  | Reminder misrouting.                     |
| H4  | Duplicate reminder.                      |
| H5  | `/start` LLM-generated.                  |
| H6  | Media tanpa timeout.                     |
| H7  | Telegram tanpa dedup + `edited_message`. |

### 9.5 Medium (M1-M12) & Low (L1-L10)

Tercatat dalam tabel konsolidasi di bawah.

### 9.6 Top 12 Improvements

Tercermin dalam [Rencana Perbaikan](#12-rencana-perbaikan-p0-p3).

---

## 10. Tabel Konsolidasi Severity

### 10.1 CRITICAL (6)

| ID  | Lokasi                                                                        | Temuan                                                      | Dampak                                    |
| --- | ----------------------------------------------------------------------------- | ----------------------------------------------------------- | ----------------------------------------- |
| C1  | [`src/admin_auth.ts`](src/admin_auth.ts:1) / `sql/migrate_v12_admin_auth.sql` | PIN default + salt statis publik + default hash ter-commit  | Pengambilalihan dashboard tanpa interaksi |
| C2  | SQL RPC                                                                       | RPC admin di-grant ke `anon`                                | Oracle brute-force PIN + reset PIN penuh  |
| C3  | [`src/admin_auth.ts`](src/admin_auth.ts:1)                                    | Race lockout non-atomik + IP spoofable                      | Brute force tak terbatas                  |
| C4  | [`src/memory.ts`](src/memory.ts:1)                                            | `/reset` dikalahkan summarizer (checkpoint tidak dihormati) | Riwayat "terlupakan" kembali              |
| C5  | [`src/quota.ts`](src/quota.ts:1) / [`src/providers.ts`](src/providers.ts:1)   | Kuota tidak ditegakkan                                      | Cost overrun tak terkendali               |
| C6  | [`src/providers.ts`](src/providers.ts:1)                                      | Kebocoran timeout provider                                  | Socket leak + timeout Lambda              |

### 10.2 HIGH (40) — Dikelompokkan

**Keamanan**

- PIN KDF lemah (SHA-256 + salt statis).
- OTP keyspace kecil.
- Session HMAC berkey material publik.
- Throttle in-memory saja.
- Clock trust tanpa verifikasi.
- Lockout 1 menit.
- Oracle counter tanpa auth.
- CSRF pada POST state-changing.
- GET `get_auth_state` + token di query.
- Stack trace terekspos.
- Security headers hilang.
- Telegram fail-open.
- HMAC Meta atas body re-serialisasi.
- verify-token non-constant-time.
- Cron fail-open.
- Default hardcoded (PIN/salt/email).
- Anon key fallback di server.
- Assertion keamanan hilang (`assertRuntime`).
- Anon RPC takeover.

**Database**

- Tanpa migration ledger.
- `web_knowledge` RLS tanpa policy.
- Race status `reminders`.
- Lost-update `admin_auth_config`.
- Index `ilike` tidak memakai btree.
- `messages` tanpa retention.
- `v12` tanpa `REVOKE anon`.

**Reliabilitas Pesan**

- WA signature fail-open.
- Raw-body HMAC mismatch.
- Baileys nol dedup.
- Path traversal session.
- Shutdown kehilangan session baru.
- Reconnect storm double-instance.
- Cron fail-open (reminder).
- Reminder misrouting platform.
- Duplicate reminder.
- Media tanpa timeout/validasi.
- Telegram tanpa dedup + `edited_message`.

**Kecerdasan**

- Persona kontradiktif (A4, A6).
- Stored prompt injection knowledge (B4).
- RAG terlewat (B7).
- `needsSearch` false positive/negatif (C1/C2/C4).
- Sanitizer merusak kode (D1).
- CoT leak (D3).
- `/reset` bare-word collision (F2).
- Checkpoint tidak dihormati summarizer (F3).

### 10.3 MEDIUM (~55)

Tercatat inline pada setiap sub-bagian Fase 1-7 di atas (mis. `env.ts`, `providers.ts`, `quota.ts`, `timezone.ts`, `remind.ts`, `media.ts`, `memory.ts`, persona A3/A5, knowledge B1/B3/B5/B6, search C3/C5, sanitizer D2/D5, splitting E2/E3/E5, persistence F5/F6, DB Medium, security F/G/H, messaging M1-M12).

### 10.4 LOW (~35)

Tercatat inline (mis. `index.ts` exit, `env.ts` isServerless, `providers.ts` leading-model, `timezone.ts` kapitalisasi, `remind.ts` interval, `media.ts` temp file, `memory.ts` `warnOnce`, persona A3, knowledge B2, sanitizer D2, splitting E4, messaging L1-L10).

---

## 11. Attack Chains

### CHAIN1 — Zero-interaction dashboard takeover (PIN default)

PIN default yang ter-commit + salt statis publik memungkinkan penyerang menghitung `pin_hash` yang sama tanpa interaksi, mengautentikasi ke dashboard, dan mengakses seluruh permukaan admin.

### CHAIN2 — PIN brute force via lockout race + IP spoofing

Lockout non-atomik digabung dengan header `x-vercel-forwarded-for` yang dapat di-spoof dan window 1 menit memungkinkan penyerang menggilir IP untuk menembus PIN 4-8 digit tanpa pernah terkunci. Oracle counter yang terekspos mempercepat enumerasi.

### CHAIN3 — Unauthenticated webhook injection -> credential theft -> host RCE

Webhook fail-open memungkinkan penyerang menyuntik pesan tanpa tanda tangan sah. Melalui path traversal pada restore session dan eksfiltrasi `.env`/secret via ekstraksi media, penyerang memindahkan kredensial, lalu mengeksekusi kode pada host.

---

## 12. Rencana Perbaikan (P0-P3)

### 12.1 P0 — Hotfix Keamanan

| ID   | Tindakan                                            |
| ---- | --------------------------------------------------- |
| P0-1 | Hapus default PIN/salt/hash + rotasi.               |
| P0-2 | Revoke RPC `anon`.                                  |
| P0-3 | Fail-closed secrets + lengkapi `assertRuntime`.     |
| P0-4 | Sanitasi `filename` session.                        |
| P0-5 | Hapus stack trace + tambah security headers.        |
| P0-6 | `.gitignore` untuk `dataset/*.csv` & `.claude-mem`. |

### 12.2 P1 — Correctness

| ID    | Tindakan                                                 |
| ----- | -------------------------------------------------------- |
| P1-1  | `/reset` benar-benar reset + hanya prefixed-only.        |
| P1-2  | Lockout atomik + rate-limit per-akun.                    |
| P1-3  | Lifecycle timeout provider + `fetchWithTimeout` bersama. |
| P1-4  | Kuota atomik + baca-balik + hash penuh.                  |
| P1-5  | Buat RPC `increment_knowledge_hit`.                      |
| P1-6  | Kolom `platform` reminders + claim CAS.                  |
| P1-7  | HMAC atas raw bytes.                                     |
| P1-8  | Dedup persisten 3 kanal.                                 |
| P1-9  | GPS IANA valid + fix `isAskingTime` & `needsSearch`.     |
| P1-10 | Batas media + magic-bytes + buang `.env`.                |

### 12.3 P2 — Kecerdasan

| ID   | Tindakan                                      |
| ---- | --------------------------------------------- |
| P2-1 | Refactor persona (priority-stack + few-shot). |
| P2-2 | Netralisasi injeksi knowledge.                |
| P2-3 | RAG-lite.                                     |
| P2-4 | Satu intent pass.                             |
| P2-5 | Instrumentasi dataset.                        |
| P2-6 | Hapus echo spec-sheet + `/start` statis.      |
| P2-7 | Splitter sadar code-fence.                    |

### 12.4 P3 — Higiene

| ID   | Tindakan                                     |
| ---- | -------------------------------------------- |
| P3-1 | Buat `AGENTS.md`.                            |
| P3-2 | Migration ledger.                            |
| P3-3 | Retention/partisi + RTBF.                    |
| P3-4 | De-fork test + CI.                           |
| P3-5 | Observability.                               |
| P3-6 | Parity command + privacy/versi/link.         |
| P3-7 | `npm ci` + trigram index + CHECK `platform`. |

### 12.5 Urutan Eksekusi

`P0` dulu -> `P1-1` & `P1-5` -> `P3-4` -> `P2-1` & `P2-2` -> sisanya.

---

## 13. Approval Checklist

### P0 — Hotfix Keamanan

- [ ] P0-1 Hapus default PIN/salt/hash + rotasi.
- [ ] P0-2 Revoke RPC `anon`.
- [ ] P0-3 Fail-closed secrets + lengkapi `assertRuntime`.
- [ ] P0-4 Sanitasi `filename` session.
- [ ] P0-5 Hapus stack trace + tambah security headers.
- [ ] P0-6 `.gitignore` untuk `dataset/*.csv` & `.claude-mem`.

### P1 — Correctness

- [ ] P1-1 `/reset` benar-benar reset + hanya prefixed-only.
- [ ] P1-2 Lockout atomik + rate-limit per-akun.
- [ ] P1-3 Lifecycle timeout provider + `fetchWithTimeout` bersama.
- [ ] P1-4 Kuota atomik + baca-balik + hash penuh.
- [ ] P1-5 Buat RPC `increment_knowledge_hit`.
- [ ] P1-6 Kolom `platform` reminders + claim CAS.
- [ ] P1-7 HMAC atas raw bytes.
- [ ] P1-8 Dedup persisten 3 kanal.
- [ ] P1-9 GPS IANA valid + fix `isAskingTime` & `needsSearch`.
- [ ] P1-10 Batas media + magic-bytes + buang `.env`.

### P2 — Kecerdasan

- [ ] P2-1 Refactor persona (priority-stack + few-shot).
- [ ] P2-2 Netralisasi injeksi knowledge.
- [ ] P2-3 RAG-lite.
- [ ] P2-4 Satu intent pass.
- [ ] P2-5 Instrumentasi dataset.
- [ ] P2-6 Hapus echo spec-sheet + `/start` statis.
- [ ] P2-7 Splitter sadar code-fence.

### P3 — Higiene

- [ ] P3-1 Buat `AGENTS.md`.
- [ ] P3-2 Migration ledger.
- [ ] P3-3 Retention/partisi + RTBF.
- [ ] P3-4 De-fork test + CI.
- [ ] P3-5 Observability.
- [ ] P3-6 Parity command + privacy/versi/link.
- [ ] P3-7 `npm ci` + trigram index + CHECK `platform`.

---

_Akhir laporan. Audit baca-saja; tidak ada berkas proyek yang diubah._
