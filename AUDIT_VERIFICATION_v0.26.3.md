# VERIFIKASI ULANG AUDIT — Fix Commit v0.26.3 (putaran 4)

Workspace: `d:/code/project/projek_no_name` | Tanggal: 2026-09-12 (WIB)

Commit: `8413fa1` (v0.26.3) + `453f96b` (SQL pin_hash), di atas `ee034bb` (laporan putaran 3)

Skala: 15 file, +344 / -76 (ditambah `453f96b`: 2 file SQL, +26 / -13). Working tree bersih.

Metode: verifikasi read-only berbasis bukti (skill verification-before-completion). Setiap klaim diverifikasi dengan perintah nyata + baris kode terkini.

---

## Daftar Isi

- [KESIMPULAN PUTARAN 4](#kesimpulan-putaran-4)
- [A. 4 ITEM PARTIAL PUTARAN 3](#a-4-item-partial-putaran-3)
- [B. 9 REGRESI PUTARAN 3](#b-9-regresi-putaran-3)
- [C. BUG / REGRESI BARU PUTARAN INI](#c-bug--regresi-baru-putaran-ini)
- [D. P2 KECERDASIAN + P3 HIGIENE — STATUS](#d-p2-kecerdasan--p3-higiene--status)
- [E. AGENTS.md — MISMATCH DOKUMEN vs KODE](#e-agentsmd--mismatch-dokumen-vs-kode)
- [F. STATUS KOMPILASI (bukti segar)](#f-status-kompilasi-bukti-segar)
- [G. PRIORITAS PERBAIKAN LANJUTAN](#g-prioritas-perbaikan-lanjutan)

---

## KESIMPULAN PUTARAN 4

Perbaikan besar pada concurrency, dedup, dan keamanan auth. Dari 4 item PARTIAL putaran 3: B4, C2 (inti) FIXED; B2 dan C4 FIXED-sebagian. Dari 9 regresi putaran 3: 6 FIXED, 2 PARTIAL, 1 weak. Namun muncul 10 bug/regresi baru, terutama pada jalur claim dedup (fail-open, drop pesan) dan durability. [`AGENTS.md`](AGENTS.md) ditambahkan tetapi memuat 8 klaim yang tidak sesuai kode.

Typecheck segar: exit 0 (src + api).

---

## A. 4 ITEM PARTIAL PUTARAN 3

| #   | Item                       | Status                    | Bukti                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --- | -------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B2  | PIN/salt/default/first-run | FIXED (kecuali first-run) | [`.env.example:77`](.env.example:77), [`.env.example:79`](.env.example:79) PIN_SALT & ADMIN_PIN dikosongkan; [`src/admin_auth.ts:322-323`](src/admin_auth.ts:322), [`src/admin_auth.ts:704-705`](src/admin_auth.ts:704) selalu hash server-side; first-run: [`src/admin_auth.ts:19`](src/admin_auth.ts:19), [`src/admin_auth.ts:101`](src/admin_auth.ts:101), [`src/admin_auth.ts:394`](src/admin_auth.ts:394) hanya manual via ADMIN_PIN (tidak ada generate acak)                                                                                                                         |
| B4  | Lockout atomik + pin_hash  | FIXED                     | [`sql/migrate_v12_admin_auth.sql:51`](sql/migrate_v12_admin_auth.sql:51), [`sql/migrate_v12_admin_auth.sql:145`](sql/migrate_v12_admin_auth.sql:145), [`sql/migrate_v12_admin_auth.sql:196`](sql/migrate_v12_admin_auth.sql:196) FOR UPDATE; [`src/admin_auth.ts:707`](src/admin_auth.ts:707) RPC `rpc_admin_change_pin`; [`src/admin_auth.ts:10`](src/admin_auth.ts:10), [`src/admin_auth.ts:21`](src/admin_auth.ts:21) pin_hash DROP NOT NULL (v16 [`sql/migrate_v16_security_hardening_and_rpc.sql:108-110`](sql/migrate_v16_security_hardening_and_rpc.sql:108) dijaga existence check) |
| C2  | Dedup atomik               | FIXED (inti)              | [`src/db.ts:77-115`](src/db.ts:77) `claimIncomingMessage` insert-first + catch 23505; wiring [`src/telegram.ts:88`](src/telegram.ts:88), [`src/whatsapp_cloud.ts:211`](src/whatsapp_cloud.ts:211), [`src/whatsapp_baileys.ts:174`](src/whatsapp_baileys.ts:174); index [`sql/migrate_v16_security_hardening_and_rpc.sql:88`](sql/migrate_v16_security_hardening_and_rpc.sql:88)                                                                                                                                                                                                             |
| C4  | CSP/HSTS                   | PARTIAL (lemah)           | [`vercel.json:51-56`](vercel.json:51) HSTS + CSP ada; TAPI `script-src 'unsafe-inline'` (wajib untuk inline handler dashboard) -> CSP tidak mencegah XSS; HSTS drift (63072000 vs 31536000)                                                                                                                                                                                                                                                                                                                                                                                                 |

---

## B. 9 REGRESI PUTARAN 3

| #    | Item                        | Status        | Bukti                                                                                                                                                                                             |
| ---- | --------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C3-1 | Reminder sent SEBELUM kirim | FIXED         | [`src/remind.ts:83-89`](src/remind.ts:83) lease `due_at=now+5min`; `sent` hanya di [`src/remind.ts:105`](src/remind.ts:105) setelah `sendFn` [`src/remind.ts:103`](src/remind.ts:103)             |
| C3-2 | Reaper `processing` macet   | FIXED         | [`src/remind.ts:50-56`](src/remind.ts:50) reset `processing`+`due_at <= now-5min` -> `pending`, sebelum claim [`src/remind.ts:59`](src/remind.ts:59)                                              |
| C3-3 | Dedup TOCTOU                | PARTIAL       | claim-only sekarang; TAPI [`src/whatsapp_cloud.ts:225-231`](src/whatsapp_cloud.ts:225) gambar menulis `msg_id: messageId` yang sudah diklaim -> 23505 ditelan ([`src/db.ts:44-47`](src/db.ts:44)) |
| C3-4 | Quota fire-and-forget       | PARTIAL       | [`src/quota.ts:104-106`](src/quota.ts:104) masih fire-and-forget; caller tunggal [`src/providers.ts:310`](src/providers.ts:310) pre-await                                                         |
| C3-5 | RPC FOR UPDATE              | FIXED         | [`sql/migrate_v12_admin_auth.sql:51`](sql/migrate_v12_admin_auth.sql:51)                                                                                                                          |
| C3-6 | updatePin clobber           | FIXED         | [`src/admin_auth.ts:711`](src/admin_auth.ts:711) RPC CAS                                                                                                                                          |
| C3-7 | .env.example default lemah  | FIXED         | [`.env.example:77`](.env.example:77), [`.env.example:79`](.env.example:79)                                                                                                                        |
| C3-8 | Urutan migrasi v12->v16     | FIXED         | [`sql/migrate_v16_security_hardening_and_rpc.sql:106-129`](sql/migrate_v16_security_hardening_and_rpc.sql:106) REVOKE/GRANT dibungkus existence guard pg_proc                                     |
| C3-9 | CSP belum ada               | FIXED (lemah) | [`vercel.json:55-56`](vercel.json:55)                                                                                                                                                             |

---

## C. BUG / REGRESI BARU PUTARAN INI

1. `claimIncomingMessage` fail-open saat error — [`src/db.ts:108`](src/db.ts:108) (non-23505 -> `return true`) dan [`src/db.ts:113`](src/db.ts:113) (`catch { return true }`) -> error transien/DB down = dedup gagal terbuka, memproses ganda.
2. `claimIncomingMessage` bisa MENJATUHKAN pesan valid — [`src/db.ts:111`](src/db.ts:111) insert sukses tapi `select('id')` kosong -> `false` -> handler return diam-diam, pesan hilang permanen.
3. Durability gap: row diklaim (`role='user'`) SEBELUM diproses tanpa reaper/GC `messages` — [`src/db.ts:88`](src/db.ts:88) + [`src/telegram.ts:88`](src/telegram.ts:88) + [`src/whatsapp_cloud.ts:211`](src/whatsapp_cloud.ts:211): crash setelah klaim -> retry kena 23505 -> `false` -> pesan tidak pernah diproses ulang dan user tak dapat balasan.
4. Race reaper vs kirim in-flight -> dobel kirim — [`src/remind.ts:52-56`](src/remind.ts:52) bisa mengembalikan row `processing` ke `pending` saat [`src/remind.ts:103-105`](src/remind.ts:103) belum menulis `sent` (jika send >5 menit).
5. OTP-reset RPC tidak dipakai -> non-atomik — [`src/admin_auth.ts:615-690`](src/admin_auth.ts:615) mengabaikan RPC `rpc_admin_verify_otp_and_reset_pin` ([`sql/migrate_v12_admin_auth.sql:136`](sql/migrate_v12_admin_auth.sql:136)), padahal `updatePin` memakai RPC-nya.
6. False-positive zona dari singkatan TZ pendek — [`src/timezone.ts:242`](src/timezone.ts:242) `'brt'`, [`src/timezone.ts:243`](src/timezone.ts:243) `'art'`, [`src/timezone.ts:250`](src/timezone.ts:250) `'sast'`, [`src/timezone.ts:252`](src/timezone.ts:252) `'eat'` memicu deteksi lokasi dari kata biasa ("seni art modern", "eat dulu") -> menyuntik zona salah.
7. needsSearch false-positive — [`src/web.ts:279`](src/web.ts:279), [`src/web.ts:282`](src/web.ts:282), [`src/web.ts:319`](src/web.ts:319) keyword recency telanjang + default branch >=25 char memicu pencarian tak perlu.
8. Baris user media duplikat / tanpa dedup — [`src/telegram.ts:149`](src/telegram.ts:149) dll + [`src/whatsapp_baileys.ts:224`](src/whatsapp_baileys.ts:224) menulis user row TANPA `msg_id`; hanya [`src/whatsapp_cloud.ts:230`](src/whatsapp_cloud.ts:230) yang menyertakan.
9. [`api/stats.ts`](api/stats.ts) truncation senyap — `.limit(400/300/2000)` ([`api/stats.ts:194`](api/stats.ts:194), [`api/stats.ts:208`](api/stats.ts:208), [`api/stats.ts:224`](api/stats.ts:224)) tanpa cursor -> undercount untuk range=all.
10. Drift dokumen vs kode ([`AGENTS.md`](AGENTS.md)) — 8 mismatch (lihat bagian E).

---

## D. P2 KECERDASAN + P3 HIGIENE — STATUS

| Item                                     | Status    | Bukti                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1 Persona priority-stack (<1500 token)  | NOT DONE  | [`src/skills.ts:411-583`](src/skills.ts:411) ~169 literal, join ~19.629 char (~4.907 token), tanpa few-shot                                                                                                                                                                                                                                                                                               |
| D2 Sanitasi knowledge live+cache         | PARTIAL   | live [`src/skills.ts:770`](src/skills.ts:770), cache [`src/knowledge.ts:126`](src/knowledge.ts:126), [`src/knowledge.ts:133`](src/knowledge.ts:133), [`src/knowledge.ts:162`](src/knowledge.ts:162), [`src/knowledge.ts:199`](src/knowledge.ts:199); envelope ada ([`src/skills.ts:781`](src/skills.ts:781)); framing otoritatif masih ada ([`src/skills.ts:780`](src/skills.ts:780) "WAJIB menyebutkan") |
| D3 RAG-lite                              | ABSENT    | tidak ada pgvector/embedding/top-k                                                                                                                                                                                                                                                                                                                                                                        |
| D4 Single intent pass                    | ABSENT    | tidak ada IntentResult                                                                                                                                                                                                                                                                                                                                                                                    |
| D5 Instrumentasi dataset                 | ABSENT    | [`api/dataset.ts:12-28`](api/dataset.ts:12), [`api/dataset.ts:254`](api/dataset.ts:254)                                                                                                                                                                                                                                                                                                                   |
| D6 CI/ledger/retention/logger/crons      | ABSENT    | tidak ada .github, schema_migrations, RTBF, [`src/logger.ts`](src/logger.ts); [`vercel.json`](vercel.json) tanpa `crons`                                                                                                                                                                                                                                                                                  |
| D7 Paritas command + versi               | PRESENT   | `/salah`+`/remind` ketiga channel; [`public/index.html:639`](public/index.html:639) v0.26.3 = package.json                                                                                                                                                                                                                                                                                                |
| D8 CoT/needsSearch/TZ-token/isAskingTime | MIXED     | CoT OK; needsSearch FP ada; TZ token pendek ada; isAskingTime benar                                                                                                                                                                                                                                                                                                                                       |
| D9 stats cursor + Cache-Control          | UNCHANGED | limit keras tanpa cursor; no-store benar                                                                                                                                                                                                                                                                                                                                                                  |

---

## E. AGENTS.md — MISMATCH DOKUMEN vs KODE

| #   | Klaim AGENTS.md                                                                                                           | Realita kode                                                                                                                                                                                                                                                                                                                                                                                         | Verdict            |
| --- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| 1   | [`AGENTS.md:53`](AGENTS.md:53) hashing PBKDF2                                                                             | [`src/admin_auth.ts:42`](src/admin_auth.ts:42) SHA-256 saja; grep pbkdf2 = 0                                                                                                                                                                                                                                                                                                                         | MISMATCH           |
| 2   | [`AGENTS.md:66`](AGENTS.md:66) Dynamic CORS allowlist                                                                     | grep cors/ALLOWED_ORIGIN = 0                                                                                                                                                                                                                                                                                                                                                                         | MISMATCH           |
| 3   | [`AGENTS.md:63`](AGENTS.md:63) CSP ketat tanpa unsafe-eval                                                                | [`vercel.json:56`](vercel.json:56) ada `script-src 'unsafe-inline'`                                                                                                                                                                                                                                                                                                                                  | PARTIAL            |
| 4   | [`AGENTS.md:64`](AGENTS.md:64) HSTS 63072000                                                                              | [`vercel.json:52`](vercel.json:52) cocok; tapi [`api/stats.ts:21`](api/stats.ts:21) 31536000                                                                                                                                                                                                                                                                                                         | PARTIAL            |
| 5   | [`AGENTS.md:65`](AGENTS.md:65) Referrer-Policy strict-origin                                                              | [`vercel.json:48`](vercel.json:48) cocok; [`api/stats.ts:20`](api/stats.ts:20), [`api/cron/reminders.ts:19`](api/cron/reminders.ts:19) no-referrer                                                                                                                                                                                                                                                   | PARTIAL            |
| 6   | [`AGENTS.md:87`](AGENTS.md:87) LRU 300 entri                                                                              | [`src/knowledge.ts:32-41`](src/knowledge.ts:32) FIFO-50; [`src/memory.ts:24`](src/memory.ts:24) tanpa cap                                                                                                                                                                                                                                                                                            | MISMATCH           |
| 7   | [`AGENTS.md:90`](AGENTS.md:90) TZ tanpa hardcode statis                                                                   | [`src/timezone.ts:62-254`](src/timezone.ts:62) ~400 keyword hardcoded                                                                                                                                                                                                                                                                                                                                | MISMATCH (wording) |
| 8   | [`AGENTS.md:53-54`](AGENTS.md:53), [`AGENTS.md:77-79`](AGENTS.md:77) FOR UPDATE/lease/reaper/sent-after-send/atomic dedup | [`sql/migrate_v12_admin_auth.sql:51`](sql/migrate_v12_admin_auth.sql:51), [`sql/migrate_v12_admin_auth.sql:145`](sql/migrate_v12_admin_auth.sql:145), [`sql/migrate_v12_admin_auth.sql:196`](sql/migrate_v12_admin_auth.sql:196); [`src/remind.ts:83`](src/remind.ts:83), [`src/remind.ts:52-56`](src/remind.ts:52), [`src/remind.ts:103-105`](src/remind.ts:103); [`src/db.ts:88-97`](src/db.ts:88) | AKURAT             |

---

## F. STATUS KOMPILASI (bukti segar)

- `npx tsc --noEmit --project tsconfig.typecheck.json` => exit 0, output kosong.
- `npm run typecheck` => exit 0 (`agentkit@0.26.3`).
- Cakupan: `src/**/*` + `api/**/*` ([`tsconfig.typecheck.json:7`](tsconfig.typecheck.json:7)).
- `git log --oneline -4` => 453f96b, 8413fa1, ee034bb, c27c409. `git status --short` => bersih.

---

## G. PRIORITAS PERBAIKAN LANJUTAN

1. Perbaiki `claimIncomingMessage`: bedakan error non-duplikat dengan benar (jangan `return true`), dan jangan jadikan `select('id')` kosong sebagai `false` (drop). Tambah reaper/kompensasi untuk `messages` yang diklaim tapi tak diproses (mis. kolom `processed_at`/status, atau klaim setelah sukses).
2. Tambahkan `msg_id` pada baris user media di [`src/telegram.ts`](src/telegram.ts) dan [`src/whatsapp_baileys.ts`](src/whatsapp_baileys.ts); perbaiki double-insert gambar di [`src/whatsapp_cloud.ts:225-231`](src/whatsapp_cloud.ts:225).
3. Arahkan `verifyOtpAndResetPin` ke RPC `rpc_admin_verify_otp_and_reset_pin` (atomik).
4. Buang singkatan TZ pendek ambigu (`brt`,`art`,`sast`,`eat`) dari LOCATION_MAP atau beri syarat konteks.
5. Perkuat/benahi CSP (nonce/hash, buang unsafe-inline bila memungkinkan; tambah `object-src 'none'`, `base-uri`, `frame-ancestors`) dan satukan nilai HSTS/Referrer-Policy.
6. Selaraskan [`AGENTS.md`](AGENTS.md) dengan implementasi aktual (atau implementasikan yang diklaim: PBKDF2, CORS allowlist, LRU).
7. P2/P3: refactor persona (priority-stack + few-shot), RAG-lite, single intent pass, instrumentasi dataset, migration ledger, retention/RTBF, CI, observability.
