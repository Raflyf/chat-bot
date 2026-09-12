# VERIFIKASI ULANG AUDIT — Fix Commit v0.26.5 (putaran 6)

Workspace: d:/code/project/projek_no_name | Tanggal: 2026-09-12 (WIB)
Commit: ae39b18 (v0.26.5), di atas a6e507c (laporan putaran 5)
Skala: 19 file, +1893 / -1705 (termasuk ekstraksi JS dashboard ke public/js/\*.js). Working tree bersih.
Metode: verifikasi read-only berbasis bukti (skill verification-before-completion). Setiap klaim diverifikasi dengan perintah nyata + baris kode terkini.

## Daftar Isi

- [KESIMPULAN PUTARAN 6](#kesimpulan-putaran-6)
- [A. CRITICAL + REGRESI PUTARAN 5](#a-critical--regresi-putaran-5)
- [B. REGRESI CRITICAL PUTARAN INI — DASHBOARD RUSAK DI BAWAH CSP](#b-regresi-critical-putaran-ini--dashboard-rusak-di-bawah-csp)
- [C. PARTIAL TERSISA](#c-partial-tersisa)
- [D. DAFTAR KONSOLIDASI SISA/REGRESI (dengan severity)](#d-daftar-konsolidasi-sisaregresi-dengan-severity)
- [E. STATUS KOMPILASI (bukti segar)](#e-status-kompilasi-bukti-segar)
- [F. PRIORITAS PERBAIKAN LANJUTAN](#f-prioritas-perbaikan-lanjutan)

## KESIMPULAN PUTARAN 6

Perbaikan besar dan benar pada backend: B1 (claim fail-closed), B3 (durability/re-claim), B4 (lease terpisah), C5 (voice-note), B8/B9/C4 tuntas. NAMUN muncul 1 REGRESI CRITICAL: CSP menghapus `unsafe-inline` dari `script-src` tetapi 18 inline event handler masih tersisa di dashboard dan tidak diikat lewat JS -> dashboard dan login RUSAK TOTAL di produksi.
Typecheck segar: exit 0 (src + api). Catatan: typecheck TIDAK memeriksa `public/*.html`/`public/js/*.js`, sehingga kerusakan dashboard lolos dari build.

## A. CRITICAL + REGRESI PUTARAN 5

| #   | Item                  | Status                 | Bukti                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --- | --------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| B1  | claim fail-closed     | FIXED                  | [`src/db.ts`](src/db.ts:109) DB null -> false; [`src/db.ts`](src/db.ts:164) error non-duplikat -> false; [`src/db.ts`](src/db.ts:167) exception -> false. Tidak ada lagi `return true` pada jalur error                                                                                                                                                                                                                              |
| B3  | durability / re-claim | FIXED                  | [`sql/migrate_v16`](sql/migrate_v16_security_hardening_and_rpc.sql:90) kolom `processed_at`; [`src/db.ts`](src/db.ts:88) markMessageProcessed; [`src/db.ts`](src/db.ts:149) re-claim bila `processed_at IS NULL` && age > 45s; semua channel memanggil mark processed pada sukses                                                                                                                                                    |
| B4  | lease terpisah        | FIXED (1 residual LOW) | [`sql/migrate_v16`](sql/migrate_v16_security_hardening_and_rpc.sql:80) kolom `lease_until`; [`src/remind.ts`](src/remind.ts:88) set `lease_until=now+10min` tanpa ubah `due_at`; reaper [`src/remind.ts`](src/remind.ts:57) `lte('lease_until', now)`. Residual: fallback reaper [`src/remind.ts`](src/remind.ts:59) reset baris `processing` dengan `lease_until IS NULL` dan `due_at <= now-10min` (tidak reachable pasca-migrasi) |
| C5  | Baileys voice-note    | FIXED                  | [`src/whatsapp_baileys.ts`](src/whatsapp_baileys.ts:344) try/catch di sekitar searchWeb dipulihkan; `autoReply` [`src/whatsapp_baileys.ts`](src/whatsapp_baileys.ts:354) tetap jalan bila search gagal                                                                                                                                                                                                                               |

## B. REGRESI CRITICAL PUTARAN INI — DASHBOARD RUSAK DI BAWAH CSP

CSP baru: [`vercel.json`](vercel.json:56) `script-src 'self' https://cdn.jsdelivr.net` (tanpa `'unsafe-inline'`). Namun:

- 18 inline event handler masih ada di [`public/dashboard.html`](public/dashboard.html:1839) (setiap satunya pelanggaran CSP dan TIDAK akan dieksekusi): `onclick`/`onchange`/`oninput`/`onsubmit` di `dashboard.html:1839,1854,1876,1900,1903,1923,1928,1942,1958,1961,1965,1976-1980,1987-1989,2033-2037,2039,2180-2183,2262,2263,2270,2275,2283,2287`.
- [`public/js/dashboard.js`](public/js/dashboard.js:1532) hanya punya SATU `addEventListener` (`dashboard.js:1532`, scroll) dan NOL pengikatan untuk 18 kontrol tersebut.
- Akibat runtime: login PIN gagal (onsubmit diblokir -> native GET, tanpa token), semua filter mati, refresh manual/auto mati, logout mati, pencarian/unduh dataset mati, modal reset inert.
- Skrip sudah benar dimuat via `<script src>` ([`public/index.html`](public/index.html:14) home.js; [`public/dashboard.html`](public/dashboard.html:14) dashboard-pre.js; [`public/dashboard.html`](public/dashboard.html:2331) dashboard.js) dengan urutan benar; tidak ada inline `<script>` tanpa src; tidak ada `eval`/`new Function`. Kegagalan murni pada inline handler yang belum dipindah.
- Catatan: `cdn.jsdelivr.net` ada di allowlist CSP tetapi TIDAK direferensikan di `public/` (allowlist mati).

## C. PARTIAL TERSISA

| Item                   | Status    | Bukti                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| C_a cloud media msg_id | FIXED     | image [`src/whatsapp_cloud.ts`](src/whatsapp_cloud.ts:230), doc [`src/whatsapp_cloud.ts`](src/whatsapp_cloud.ts:263), audio [`src/whatsapp_cloud.ts`](src/whatsapp_cloud.ts:304), sticker [`src/whatsapp_cloud.ts`](src/whatsapp_cloud.ts:351), video [`src/whatsapp_cloud.ts`](src/whatsapp_cloud.ts:386)                                                                                                                           |
| C_b stats pagination   | FIXED     | [`api/stats.ts`](api/stats.ts:190) `fetchPagedRange` (.range()); 0 `.limit(` tersisa; cap 10000/10000/15000; tanpa off-by-one                                                                                                                                                                                                                                                                                                        |
| C_d quota              | FIXED     | [`src/quota.ts`](src/quota.ts:102) `isKeyAllowed` await `ensureKeyQuotaHydrated`; dipakai [`src/providers.ts`](src/providers.ts:310). Legacy `keyAllowed` [`src/quota.ts`](src/quota.ts:108) tersisa tetapi tak terpakai                                                                                                                                                                                                             |
| C_e AGENTS.md          | NOT FIXED | versi [`AGENTS.md`](AGENTS.md:3) v0.26.4 vs [`package.json`](package.json:3) 0.26.5 (drift); klaim "seluruh skrip ... diekstraksi" [`AGENTS.md`](AGENTS.md:63) SALAH (18 handler masih inline). Klaim cache/wilayah kini COCOK ([`src/memory.ts`](src/memory.ts:25), [`src/memory.ts`](src/memory.ts:31), [`src/memory.ts`](src/memory.ts:91); [`src/knowledge.ts`](src/knowledge.ts:15), [`src/knowledge.ts`](src/knowledge.ts:38)) |
| C_f public/js sanity   | PARTIAL   | 11 handler didefinisikan di [`public/js/dashboard.js`](public/js/dashboard.js:1); 0 undefined ref; 0 eval/new Function; TAPI tanpa event wiring; indentasi berlebih/kosmetik                                                                                                                                                                                                                                                         |

## D. DAFTAR KONSOLIDASI SISA/REGRESI (dengan severity)

1. CRITICAL — Dashboard/auth rusak di bawah CSP: 18 inline handler tak dikonversi + nol addEventListener. [`public/dashboard.html`](public/dashboard.html:1839), [`public/js/dashboard.js`](public/js/dashboard.js:1532). Perbaikan: ikat 18 handler via addEventListener (DOMContentLoaded) ATAU kembalikan CSP (mengorbankan hardening).
2. HIGH — Klaim palsu AGENTS.md "seluruh skrip diekstraksi". [`AGENTS.md`](AGENTS.md:63) vs [`public/dashboard.html`](public/dashboard.html:1839).
3. LOW — Drift versi AGENTS.md (dok v0.26.4 vs pkg 0.26.5). [`AGENTS.md`](AGENTS.md:3), [`package.json`](package.json:3).
4. LOW — Fallback reaper reminder dapat re-claim baris lease NULL setelah 10 menit -> potensi dobel kirim. [`src/remind.ts`](src/remind.ts:59).
5. LOW — `cdn.jsdelivr.net` di allowlist CSP namun tak dipakai. [`vercel.json`](vercel.json:56).
6. INFO — `keyAllowed` legacy masih diekspor (tak dipakai hot path). [`src/quota.ts`](src/quota.ts:108).
7. INFO — Kosmetik [`dashboard.js`](public/js/dashboard.js:1) (indentasi berlebih).

## E. STATUS KOMPILASI (bukti segar)

- `npx tsc --noEmit --project tsconfig.typecheck.json` => exit 0, output kosong; cakupan `src/**/*` + `api/**/*`.
- `npm run typecheck` => exit 0 (`agentkit@0.26.5`).
- PENTING: typecheck tidak mencakup `public/*.html`/`public/js/*.js` -> regresi CSP dashboard tidak terdeteksi oleh gate ini. Perlu uji browser (webapp-testing/Playwright) atau smoke test HTML.
- `git log --oneline -3` => ae39b18, a6e507c, 6b46241. `git status --short` => bersih.

## F. PRIORITAS PERBAIKAN LANJUTAN

1. CRITICAL: ikat 18 inline handler dashboard via `addEventListener` di [`public/js/dashboard.js`](public/js/dashboard.js:1) (DOMContentLoaded), lalu verifikasi dengan browser test bahwa login/filter/refresh/logout/dataset berfungsi di bawah CSP tanpa unsafe-inline. Alternatif sementara: kembalikan `'unsafe-inline'` ke script-src sampai refactor selesai.
2. Selaraskan [`AGENTS.md`](AGENTS.md:3): perbarui versi ke 0.26.5 dan koreksi klaim ekstraksi skrip (atau selesaikan ekstraksi).
3. Perbaiki fallback reaper reminder ([`src/remind.ts`](src/remind.ts:59)) agar tidak memakai `due_at` untuk lease.
4. Buang `cdn.jsdelivr.net` dari CSP bila tidak dipakai; hapus `keyAllowed` legacy.
5. Tambah gate uji frontend (Playwright/smoke) + uji HTML statis ke pipeline agar regresi UI tertangkap.
6. P2/P3 yang belum tersentuh: persona priority-stack, RAG-lite, single intent pass, instrumentasi dataset, migration ledger, retention/RTBF, [`src/logger.ts`](src/logger.ts:1), CI.
