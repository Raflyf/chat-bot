# VERIFIKASI ULANG AUDIT — Fix Commit v0.26.1 (putaran 2)

Workspace: `d:/code/project/projek_no_name` | Tanggal: 2026-09-12 (WIB)

Commit fix: `b3ffcfd` "fix: resolve all 10 audit regressions, harden security, and enforce full typecheck coverage (v0.26.1)"

Skala: 33 file berubah, +438 / -3675 (termasuk penghapusan 7 CSV). Working tree bersih.

Metode: verifikasi read-only 6 fase terhadap [`AUDIT_VERIFICATION_v0.26.0.md`](AUDIT_VERIFICATION_v0.26.0.md).

## Daftar Isi

- [KESIMPULAN PUTARAN 2](#kesimpulan-putaran-2)
- [A. 10 REGRESI PUTARAN LALU](#a-10-regresi-putaran-lalu)
- [B. 4 CRITICAL SISA](#b-4-critical-sisa)
- [C. P0/P1 SISA](#c-p0p1-sisa)
- [D. P2 KECERDASAN + P3 HIGIENE](#d-p2-kecerdasan--p3-higiene)
- [E. REGRESI / ISU BARU YANG DIKONFIRMASI](#e-regresi--isu-baru-yang-dikonfirmasi)
- [F. YANG SUDAH BENAR (jangan diubah)](#f-yang-sudah-benar-jangan-diubah)
- [G. PRIORITAS PERBAIKAN LANJUTAN](#g-prioritas-perbaikan-lanjutan)
- [STATUS KOMPILASI](#status-kompilasi)

## KESIMPULAN PUTARAN 2

Dari 10 regresi putaran lalu: 8 FIXED (R2-R9), 2 PARTIAL (R1, R10). Dari 4 Critical sisa: semua masih PARTIAL. P0/P1 sisa: sebagian FIXED. P2/P3: hampir tidak tersentuh.

Perbaikan nyata terjadi pada: keamanan migrasi (revoke RPC, hapus hash), fail-closed webhook (3 dari 4), media (cap+timeout video), GPS IANA, /start statis, dashboard sessionStorage, dan cakupan typecheck (kini src+api).

Typecheck `npx tsc --noEmit --project tsconfig.typecheck.json` => BERSIH, 0 error, src+api tercakup.

## A. 10 REGRESI PUTARAN LALU

| #   | Item                                | Status                              | Bukti                                                                                                                                                                                                                             |
| --- | ----------------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Reminder 'processing' vs CHECK      | PARTIAL                             | [`src/remind.ts`](src/remind.ts:62); [`sql/migrate_v16`](sql/migrate_v16_security_hardening_and_rpc.sql:68) — CHECK kini izinkan 'processing' & nama DROP cocok, TAPI klaim TIDAK cek affected-row -> lost race tetap kirim ganda |
| R2  | stats Cache-Control public override | FIXED                               | [`api/stats.ts`](api/stats.ts:17) (hanya no-store)                                                                                                                                                                                |
| R3  | RPC arg p_entity_key vs p_key       | FIXED                               | [`src/knowledge.ts`](src/knowledge.ts:176); SQL `p_entity_key`+`p_key` COALESCE ([`sql/migrate_v16`](sql/migrate_v16_security_hardening_and_rpc.sql:18))                                                                          |
| R4  | Korupsi '#' dalam code fence        | FIXED                               | [`src/skills.ts`](src/skills.ts:84) (placeholder seluruh blok fence)                                                                                                                                                              |
| R5  | Cap emoji mati untuk >200 char      | FIXED                               | [`src/skills.ts`](src/skills.ts:208) (maxAllowed=1 tanpa guard panjang)                                                                                                                                                           |
| R6  | GPS zone UTC/'UTC+8' collision      | FIXED (sebagian) — lihat regresi A5 | [`src/timezone.ts`](src/timezone.ts:336) kembali IANA benar                                                                                                                                                                       |
| R7  | Dockerfile npm install              | FIXED                               | [`Dockerfile`](Dockerfile:9) kini `npm ci`                                                                                                                                                                                        |
| R8  | messages.platform tanpa CHECK       | FIXED                               | [`sql/migrate_v16`](sql/migrate_v16_security_hardening_and_rpc.sql:73) CHECK IN ('telegram','whatsapp','web','api') + kolom msg_id                                                                                                |
| R9  | Unhandled rejection body-read stall | FIXED                               | [`src/providers.ts`](src/providers.ts:88) `bodyPromise.catch(()=>{})`                                                                                                                                                             |
| R10 | Pesan lockout 1 menit vs durasi     | PARTIAL                             | TS [`src/admin_auth.ts`](src/admin_auth.ts:399) bilang 15 menit (benar), tapi SQL [`sql/migrate_v12_admin_auth.sql`](sql/migrate_v12_admin_auth.sql:86) masih '1 minute'                                                          |

## B. 4 CRITICAL SISA

| #   | Item                              | Status  | Bukti                                                                                                                                                                                                                                                                                                                                                                                         |
| --- | --------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | PIN default/salt/hash             | PARTIAL | Hash 080402 dihapus dari v12 ([`sql/migrate_v12`](sql/migrate_v12_admin_auth.sql:20)), PIN_SALT hilang dari dashboard. TAPI [`src/admin_auth.ts`](src/admin_auth.ts:347) masih percaya nilai 64-char dari client apa adanya; [`.env.example`](.env.example:76) masih `PIN_SALT=rafly_telemetry_salt`; tak ada jalur provisioning first-run -> `verifyPin` bisa "belum dikonfigurasi" permanen |
| C2  | RPC anon + hazard urutan v12->v16 | PARTIAL | v16 revoke dari anon/authenticated/public ([`sql/migrate_v16`](sql/migrate_v16_security_hardening_and_rpc.sql:9)); TIDAK ada lagi GRANT anon. TAPI v12 ([`sql/migrate_v12_admin_auth.sql`](sql/migrate_v12_admin_auth.sql:182)) tetap tak revoke PUBLIC -> deploy yang jalankan v12 tanpa v16 masih terekspos                                                                                 |
| C3  | Lockout non-atomik + updatePin    | PARTIAL | updatePin kini hitung gagal ([`src/admin_auth.ts`](src/admin_auth.ts:646)); TAPI verifyPin masih JS read-modify-write ([`src/admin_auth.ts`](src/admin_auth.ts:317)), `rpc_admin_verify_pin` tetap tak dipanggil, tak ada rate-limit                                                                                                                                                          |
| C5  | Quota tak ditegakkan              | PARTIAL | `hydrateKeyQuota` ada ([`src/quota.ts`](src/quota.ts:44)), RPC atomik terpasang; TAPI `keyAllowed` fire-and-forget hydrate lalu sinkron cek Map -> cold start over-quota; `hydratedKeys.add` sebelum read -> error transien sticky semalai hari                                                                                                                                               |

## C. P0/P1 SISA

| Item                         | Status                  | Bukti                                                                                                                                                   |
| ---------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fail-closed webhook Telegram | FIXED                   | [`api/webhook.ts`](api/webhook.ts:7) (unconditional)                                                                                                    |
| Fail-closed Meta signature   | FIXED                   | [`src/whatsapp_cloud.ts`](src/whatsapp_cloud.ts:47)                                                                                                     |
| Fail-closed cron             | FIXED                   | [`api/cron/reminders.ts`](api/cron/reminders.ts:22)                                                                                                     |
| assertRuntime ketat          | PARTIAL                 | [`src/env.ts`](src/env.ts:117) — WhatsApp throw, tapi cron/webhook secret hanya warn; ADMIN_PIN/PIN_SALT tak diasersi                                   |
| HMAC raw bytes (Meta)        | NOT FIXED               | [`api/whatsapp.ts`](api/whatsapp.ts:40) — tak ada `bodyParser:false` -> fallback `JSON.stringify(req.body)`                                             |
| Dedup persisten 3 channel    | NOT FIXED               | [`src/whatsapp_cloud.ts`](src/whatsapp_cloud.ts:12); [`src/telegram.ts`](src/telegram.ts:415); [`src/whatsapp_baileys.ts`](src/whatsapp_baileys.ts:136) |
| msg_id dipakai app           | NOT FIXED (dead schema) | [`sql/migrate_v16`](sql/migrate_v16_security_hardening_and_rpc.sql:75); 0 referensi di src/                                                             |
| Media magic-byte sniff       | PARTIAL (dead code)     | [`src/media.ts`](src/media.ts:247) `effectiveMime` dihitung tapi tak dipakai                                                                            |
| Media video timeout + cap    | FIXED                   | [`src/media.ts`](src/media.ts:421) (35000ms); [`src/media.ts`](src/media.ts:170) (cap)                                                                  |
| CSP/header public            | NOT FIXED               | [`vercel.json`](vercel.json:25) hanya /api                                                                                                              |
| Session path traversal guard | FIXED                   | [`src/whatsapp_session.ts`](src/whatsapp_session.ts:40)                                                                                                 |

## D. P2 KECERDASAN + P3 HIGIENE

| Item                                      | Status                                  | Bukti                                                                                                                                                                                          |
| ----------------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P2-1 persona priority-stack (<1500 token) | NOT FIXED (malah tumbuh)                | [`src/skills.ts`](src/skills.ts:405) ~35.674 char; tetap flat join                                                                                                                             |
| P2-2 netralisasi knowledge injection      | PARTIAL                                 | [`src/skills.ts`](src/skills.ts:772) label jadi "REFERENSI FAKTUAL EKSTERNAL" + directive anti-injeksi; [`src/knowledge.ts`](src/knowledge.ts:18) +4 regex; masih heuristik regex, TTL 90 hari |
| P2-3 RAG-lite                             | NOT FIXED                               | tak ada vector/embedding                                                                                                                                                                       |
| P2-4 single intent pass                   | NOT FIXED                               | tak ada IntentResult                                                                                                                                                                           |
| P2-5 instrumentasi dataset                | NOT FIXED                               | [`api/dataset.ts`](api/dataset.ts:12)                                                                                                                                                          |
| P2-6 /start statis + strip spec-sheet     | FIXED                                   | [`src/telegram.ts`](src/telegram.ts:88) statis                                                                                                                                                 |
| P2-7 splitter fence-aware                 | FIXED                                   | [`src/skills.ts`](src/skills.ts:357)                                                                                                                                                           |
| P3-1 AGENTS.md                            | NOT FIXED                               | tidak ada                                                                                                                                                                                      |
| P3-2 migration ledger                     | NOT FIXED                               | tidak ada schema_migrations                                                                                                                                                                    |
| P3-3 retention/RTBF                       | NOT FIXED                               | tidak ada                                                                                                                                                                                      |
| P3-4 test de-fork + CI                    | NOT FIXED                               | .github tidak ada; scratch 47 file                                                                                                                                                             |
| P3-5 observability                        | NOT FIXED                               | tidak ada src/logger.ts                                                                                                                                                                        |
| P3-6 paritas command + privacy/versi      | PARTIAL                                 | /salah+/remind WhatsApp ada; versi index.html masih v0.25.6                                                                                                                                    |
| P3-7 npm ci + trigram + CHECK platform    | FIXED (npm ci, trigram, CHECK platform) | [`Dockerfile`](Dockerfile:9); [`sql/migrate_v16`](sql/migrate_v16_security_hardening_and_rpc.sql:73)                                                                                           |

## E. REGRESI / ISU BARU YANG DIKONFIRMASI

1. R1 kirim reminder ganda: klaim [`src/remind.ts`](src/remind.ts:62) tak menyertakan `.select()`/cek jumlah baris; update 0-baris mengembalikan error=null -> tetap lanjut `sendFn` ([`src/remind.ts`](src/remind.ts:75)). Cron+worker tumpang-tindih -> dobel.
2. C1 jalur kredensial jadi teks polos: dashboard kirim `{pin}` polos ([`public/dashboard.html`](public/dashboard.html:2494)); server terima `pin` || `pin_hash` ([`api/admin-otp.ts`](api/admin-otp.ts:52)); server masih terima 64-char apa adanya ([`src/admin_auth.ts`](src/admin_auth.ts:347)). Lapisan salt client hilang.
3. D2 fix no-op: [`api/whatsapp.ts`](api/whatsapp.ts:40) baca `(req as any).rawBody` tapi tak ada `bodyParser:false` di mana pun -> selalu fallback `JSON.stringify(req.body)`; verifikasi signature Meta tetap rusak saat secret diset.
4. D4 dead code: [`src/media.ts`](src/media.ts:249) `effectiveMime` tak dipakai di percabangan ([`src/media.ts`](src/media.ts:273)) -> pertahanan spoof MIME inert.
5. GPS label collision masih ada: fallback `label: 'UTC+8'` ([`src/timezone.ts`](src/timezone.ts:375)) + keyword `'utc+8'`/`'gmt+8'` -> `Asia/Makassar` ([`src/timezone.ts`](src/timezone.ts:155)); karena `+` tak di-escape, regex `utc+8` justru cocok ke `utc8`. Label tersimpan bisa salah-resolve ke WITA.
6. E9 dataset limit bypass: [`api/dataset.ts`](api/dataset.ts:245) `isExport` -> 3000 baris walau `?limit=10`.
7. C1 risiko lockout permanen: v16 [`sql/migrate_v16`](sql/migrate_v16_security_hardening_and_rpc.sql:93) hapus baris master_auth untuk hash legacy; tanpa ADMIN_PIN & tanpa re-seed -> auth admin tak bisa dipulihkan (OTP reset butuh baris itu).
8. C5 hydration race: [`src/quota.ts`](src/quota.ts:78) fire-and-forget; [`src/quota.ts`](src/quota.ts:50) tandai hydrated sebelum read -> kegagalan read membuat kuota tak pernah dipakai (sticky seharian).

## F. YANG SUDAH BENAR (jangan diubah)

Typecheck bersih (src+api). CHECK reminders nama cocok (`reminders_status_check`) & nilai diperluas — idempoten (DROP IF EXISTS lalu ADD), v09 `CREATE TABLE IF NOT EXISTS` tak akan mengetatkan ulang. Fail-closed webhook/Meta/cron. Media cap+timeout. GPS kembali IANA. /start statis. Dashboard token hanya di sessionStorage (15 menit, logout bersih). CSV tak lagi ter-track. Dockerfile `npm ci`.

## G. PRIORITAS PERBAIKAN LANJUTAN

1. R1: tambahkan `.select()` pada klaim dan `continue` bila 0 baris (atau RETURNING) untuk mencegah kirim ganda.
2. C1: buang penerimaan 64-char client apa adanya; wajibkan PIN polos + hash server; hapus `PIN_SALT` dari [`.env.example`](.env.example:76); sediakan jalur provisioning first-run + seed ulang.
3. C2: tambahkan REVOKE di v12 juga (buat tidak bergantung pada v16), atau jejak migrasi berurutan.
4. D2: set `bodyParser:false` (atau baca raw body) agar HMAC benar-benar atas byte mentah.
5. C3: panggil `rpc_admin_verify_pin` (atomik) & samakan durasi lockout SQL (kini '1 minute') dengan TS (15 menit).
6. C5: `await hydrateKeyQuota` sebelum menilai cap; pindahkan `hydratedKeys.add` setelah read sukses.
7. D3: pakai kolom `msg_id` yang sudah ada untuk dedup persisten semua channel; tambah dedup Telegram update_id.
8. D4: pakai `effectiveMime` di percabangan; buang dead code.
9. D5/E9: header CSP di public/\*; hormati param `limit` pada ekspor.
10. P2/P3: persona priority-stack, RAG-lite, single intent pass, instrumentasi dataset, AGENTS.md, ledger, retention/RTBF, CI, observability.

## STATUS KOMPILASI

- `npx tsc --noEmit --project tsconfig.typecheck.json` => exit 0, 0 error; `src/**/*` + `api/**/*` tercakup ([`tsconfig.typecheck.json`](tsconfig.typecheck.json:4)).
- `npm run typecheck` => exit 0. Skrip [`package.json`](package.json:13) kini menunjuk tsconfig.typecheck.json.
