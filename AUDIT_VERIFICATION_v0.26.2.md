# VERIFIKASI ULANG AUDIT — Fix Commit v0.26.2 (putaran 3)

Workspace: d:/code/project/projek_no_name | Tanggal: 2026-09-12 (WIB)
Commit fix: c27c409 "fix: resolve all remaining audit findings, atomic reminder claim, persistent dedup, and auth hardening (v0.26.2)"
Skala: 20 file, +447 / -74. Working tree bersih.
Metode: verifikasi read-only 5 fase berbasis bukti (evidence-first), memakai skill verification-before-completion. Setiap klaim diverifikasi dengan perintah nyata + baris kode terkini.

## Daftar Isi

- [KESIMPULAN PUTARAN 3](#kesimpulan-putaran-3)
- [A. ITEM TERBUKA PUTARAN 2 — STATUS](#a-item-terbuka-putaran-2--status)
- [B. ITEM TEKNIS — STATUS](#b-item-teknis--status)
- [C. REGRESI / BUG BARU PUTARAN INI](#c-regresi--bug-baru-putaran-ini)
- [D. P2 KECERDASAN + P3 HIGIENE — STATUS](#d-p2-kecerdasan--p3-higiene--status)
- [E. STATUS KOMPILASI (bukti segar)](#e-status-kompilasi-bukti-segar)
- [F. PRIORITAS PERBAIKAN LANJUTAN](#f-prioritas-perbaikan-lanjutan)

## KESIMPULAN PUTARAN 3

Banyak perbaikan nyata pada item teknis dan keamanan. Dari 14 item yang diverifikasi pada gelombang B/C: 10 FIXED, 4 PARTIAL (B2, B4, C2, C4). Tiga regresi baru ditemukan pada jalur reminder dan dedup. P2/P3 (kecerdasan & higiene) hampir tidak tersentuh kecuali paritas command dan versi.

Typecheck segar: `npx tsc --noEmit --project tsconfig.typecheck.json` => exit 0 (src + api tercakup).

## A. ITEM TERBUKA PUTARAN 2 — STATUS

| #   | Item                                          | Status              | Bukti                                                                                                                                                                                                                                                                                                                |
| --- | --------------------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ----------------------------- |
| B1  | Reminder duplicate-send (claim cek row-count) | FIXED               | [`src/remind.ts`](src/remind.ts:62) baris 62-88 — `.select('id')` + `if (!claimed                                                                                                                                                                                                                                    |     | claimed.length===0) continue` |
| B2  | PIN/salt/first-run/plaintext                  | PARTIAL             | [`src/admin_auth.ts`](src/admin_auth.ts:323) (client hash tak lagi dipercaya); TAPI [`.env.example`](.env.example:77) masih `PIN_SALT=ganti_dengan_salt_acak...` dan [`.env.example`](.env.example:79) `ADMIN_PIN=080402`; [`public/dashboard.html`](public/dashboard.html:2494) masih kirim PIN plaintext           |
| B3  | v12 revoke + order-independent                | FIXED (caveat)      | [`sql/migrate_v12_admin_auth.sql`](sql/migrate_v12_admin_auth.sql:182) baris 182-188 REVOKE lalu GRANT service_role; caveat: v16 revoke fungsi buatan v12 -> v16 harus jalan setelah v12                                                                                                                             |
| B4  | Lockout atomicity                             | PARTIAL             | [`src/admin_auth.ts`](src/admin_auth.ts:330) pakai `rpc_admin_verify_pin`; TAPI SQL [`sql/migrate_v12_admin_auth.sql`](sql/migrate_v12_admin_auth.sql:48) baris 48, 91 `SELECT * INTO` tanpa `FOR UPDATE` -> masih racy; `updatePin` [`src/admin_auth.ts`](src/admin_auth.ts:710) baris 710-720 JS read-modify-write |
| B5  | Quota await hydration                         | FIXED (in practice) | [`src/providers.ts`](src/providers.ts:310) baris 310-311 `await ensureKeyQuotaHydrated` sebelum `keyAllowed`; `hydratedKeys.add` dipindah setelah read ([`src/quota.ts`](src/quota.ts:74) baris 74-75)                                                                                                               |
| B6  | Lockout duration SQL vs TS                    | FIXED               | SQL `interval '15 minutes'` ([`sql/migrate_v12_admin_auth.sql`](sql/migrate_v12_admin_auth.sql:86) baris 86, 103) sejalan TS [`src/admin_auth.ts`](src/admin_auth.ts:452)                                                                                                                                            |

## B. ITEM TEKNIS — STATUS

| #   | Item                              | Status           | Bukti                                                                                                                                                                                                                                                                                                       |
| --- | --------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | Meta HMAC raw body                | FIXED            | [`api/whatsapp.ts`](api/whatsapp.ts:8) baris 8-12 `bodyParser:false`; baris 58-60 `readRawBody()` -> verifikasi atas Buffer mentah                                                                                                                                                                          |
| C2  | Dedup persisten + msg_id          | PARTIAL          | [`src/db.ts`](src/db.ts:54) baris 54-71 `isMessageProcessed` + tulis `msg_id` ([`src/telegram.ts`](src/telegram.ts:380), [`src/whatsapp_cloud.ts`](src/whatsapp_cloud.ts:488), [`src/whatsapp_baileys.ts`](src/whatsapp_baileys.ts:587)); TAPI check-then-act non-atomik + insert fire-and-forget -> TOCTOU |
| C3  | effectiveMime dipakai             | FIXED            | [`src/media.ts`](src/media.ts:249) baris 249, 272-309, 337, 341                                                                                                                                                                                                                                             |
| C4  | Security headers / CSP / HSTS     | PARTIAL          | [`vercel.json`](vercel.json:36) baris 36-51 set X-Content-Type-Options/X-Frame-Options/Referrer-Policy; TAPI CSP tidak ada & HSTS tidak di blok global                                                                                                                                                      |
| C5  | Dataset limit dihormati           | FIXED            | [`api/dataset.ts`](api/dataset.ts:238) baris 238-241, 248-250, 377 `explicitLimit` (1-5000) memandu `dbLimit` & `finalPairs.slice`                                                                                                                                                                          |
| C6  | GPS label collision + escapeRegex | FIXED            | [`src/timezone.ts`](src/timezone.ts:384) fallback `Etc/GMT±n`; LOCATION_MAP hanya `utc+7`/`gmt+7` ([`src/timezone.ts`](src/timezone.ts:182)); `escapeRegex` ([`src/timezone.ts`](src/timezone.ts:257)) meng-escape `+`                                                                                      |
| C7  | Perubahan src/db.ts               | FIXED (additive) | [`src/db.ts`](src/db.ts:20) baris 20, 37, 54-71 `msg_id`, `isMessageProcessed`, kolom token ditulis                                                                                                                                                                                                         |
| C8  | Perubahan baileys/cloud           | FIXED            | dedup guard + `msg_id` saat simpan pesan user                                                                                                                                                                                                                                                               |

## C. REGRESI / BUG BARU PUTARAN INI

1. Reminder fallback menandai `sent` SEBELUM kirim — [`src/remind.ts`](src/remind.ts:73) baris 73-78 CAS `status='sent'` berjalan sebelum `sendFn` ([`src/remind.ts`](src/remind.ts:92)). Crash di antaranya -> reminder hilang permanen.
2. Tidak ada reaper untuk baris `processing` macet — [`src/remind.ts`](src/remind.ts:49) baris 49-55, 62 query hanya `status='pending'`; worker yang mati setelah claim meninggalkan baris `processing` selamanya.
3. Dedup TOCTOU + insert fire-and-forget + unique-violation ditelan — [`src/db.ts`](src/db.ts:54) baris 54, 45 + [`src/whatsapp_cloud.ts`](src/whatsapp_cloud.ts:206) baris 206, 483: dua retry konkuren bisa sama-sama lolos dan membalas ganda; pelanggaran `idx_messages_platform_msg_id` ([`sql/migrate_v16_security_hardening_and_rpc.sql`](sql/migrate_v16_security_hardening_and_rpc.sql:76), `migrate_v16`) disembunyikan `catch {}`.
4. Quota bergantung caller — [`src/quota.ts`](src/quota.ts:99) baris 99-107 `keyAllowed` masih fire-and-forget hydrate; hanya aman karena caller tunggal pre-await ([`src/providers.ts`](src/providers.ts:310)).
5. `rpc_admin_verify_pin` belum benar-benar atomik — [`sql/migrate_v12_admin_auth.sql`](sql/migrate_v12_admin_auth.sql:48) baris 48, 91 tanpa `FOR UPDATE`.
6. `updatePin` melewati RPC atomik — [`src/admin_auth.ts`](src/admin_auth.ts:710) baris 710-720 JS RMW; bisa meng-clobber counter lockout.
7. Default lemah ter-ship — [`.env.example`](.env.example:77) baris 77, 79 (`PIN_SALT` contoh + `ADMIN_PIN=080402`) dengan auto-provisioning baru -> deploy yang menyalin mentah bootstrap PIN publik.
8. Ketergantungan urutan migrasi — v16 REVOKE/GRANT fungsi buatan v12 -> error bila v16 jalan sebelum v12.
9. CSP tidak pernah ditambahkan; HSTS hanya di handler API, tak di blok header global [`vercel.json`](vercel.json).

## D. P2 KECERDASAN + P3 HIGIENE — STATUS

| Item                                              | Status      | Bukti                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1 Persona priority-stack (<1500 token)           | NOT FIXED   | [`src/skills.ts`](src/skills.ts:410) baris 410-582 blok instruksi ~20.919 char (~5.200 token); tetap monolitik                                                                                                                                                                                  |
| D2 Netralisasi knowledge injection                | PARTIAL     | [`src/knowledge.ts`](src/knowledge.ts:18) baris 18-29 sanitize + [`src/skills.ts`](src/skills.ts:772) baris 772, 779 envelope "BUKAN instruksi sistem"; TAPI [`src/skills.ts`](src/skills.ts:778) masih "WAJIB menyebutkan", dan sanitasi hanya di jalur cache, bukan string `searchWeb()` live |
| D3 RAG-lite                                       | NOT PRESENT | tidak ada pgvector/embedding/topK                                                                                                                                                                                                                                                               |
| D4 Single intent pass                             | NOT PRESENT | tidak ada IntentResult                                                                                                                                                                                                                                                                          |
| D5 Instrumentasi dataset                          | NOT PRESENT | hanya `msg_id` ([`sql/migrate_v16_security_hardening_and_rpc.sql`](sql/migrate_v16_security_hardening_and_rpc.sql:75))                                                                                                                                                                          |
| D6 AGENTS.md / CI / ledger / retention / logger   | ABSENT      | semua tidak ada                                                                                                                                                                                                                                                                                 |
| D7 Paritas command + versi                        | FIXED       | `/salah`+`/remind` di kedua channel WhatsApp; [`public/index.html`](public/index.html:639) = v0.26.2 (sinkron)                                                                                                                                                                                  |
| D8 CoT / needsSearch / short-token / isAskingTime | PARTIAL     | CoT & isAskingTime OK; token pendek TZ 2-3 char masih ada ([`src/timezone.ts`](src/timezone.ts:211) baris 211, 213, 223, 228, 233, 252)                                                                                                                                                         |
| D9 stats cursor + Cache-Control                   | UNCHANGED   | [`api/stats.ts`](api/stats.ts:194) baris 194, 208, 224 tanpa cursor; `Cache-Control` no-store sudah benar                                                                                                                                                                                       |

## E. STATUS KOMPILASI (bukti segar)

- `npx tsc --noEmit --project tsconfig.typecheck.json` => exit 0, 0 diagnostik; mencakup `src/**/*` + `api/**/*` ([`tsconfig.typecheck.json`](tsconfig.typecheck.json:7)).
- `npm run typecheck` => exit 0.
- `git log --oneline -3` => `c27c409` (v0.26.2), `b3ffcfd` (v0.26.1), `691a3b5` (v0.26.0). `git status --short` => bersih.

## F. PRIORITAS PERBAIKAN LANJUTAN

1. Reminder: pindahkan penandaan `sent` ke SETELAH `sendFn` pada jalur fallback; tambah reaper `processing` -> `pending` berbasis timeout.
2. Dedup: pakai klaim atomik `INSERT ... ON CONFLICT DO NOTHING RETURNING id` (bukan SELECT lalu insert fire-and-forget).
3. B2: hapus `ADMIN_PIN=080402` + nilai contoh salt dari `.env.example`; wajibkan provisioning first-run tanpa default publik.
4. B4: tambah `FOR UPDATE` pada `rpc_admin_verify_pin`; arahkan `updatePin` ke jalur atomik yang sama.
5. C4: tambah `Content-Security-Policy` + pindahkan `Strict-Transport-Security` ke blok header global `vercel.json`.
6. C2: selesaikan dedup atomik lintas-channel (`msg_id` sudah ada, tinggal klaim).
7. D1/D2: refactor persona ke priority-stack + few-shot; perkuat sanitasi knowledge pada jalur live.
8. Higiene: AGENTS.md, migration ledger, retention/RTBF, CI, observability.
