# VERIFIKASI ULANG AUDIT — Fix Commit v0.26.0

Workspace: d:/code/project/projek_no_name | Tanggal: 2026-09-12 (WIB)
Commit fix: 691a3b5 "fix: resolve all security, reliability, memory, parity and sanitization audit findings (v0.26.0)"
Skala: 27 file, +1441 / -282, 1 migrasi baru ([`sql/migrate_v16_security_hardening_and_rpc.sql`](sql/migrate_v16_security_hardening_and_rpc.sql:1)). Working tree bersih (semua ter-commit).
Metode: verifikasi read-only 6 fase terhadap [`AUDIT_REPORT_2026-09-12.md`](AUDIT_REPORT_2026-09-12.md:1).

## Daftar Isi

1. [Kesimpulan Utama](#kesimpulan-utama)
2. [CRITICAL — Status](#critical--status)
3. [P0 Keamanan — Status](#p0-keamanan--status)
4. [P1 Correctness — Status](#p1-correctness--status)
5. [P2 Kecerdasan — Status](#p2-kecerdasan--status)
6. [P2 Kualitas — Status](#p2-kualitas--status)
7. [P3 Higiene — Status](#p3-higiene--status)
8. [Regresi Baru (harus segera diperbaiki)](#regresi-baru-harus-segera-diperbaiki)
9. [Catatan Keselamatan (dari Fase B/C)](#catatan-keselamatan-dari-fase-bc)
10. [Urutan Rekomendasi Perbaikan Lanjutan](#urutan-rekomendasi-perbaikan-lanjutan)
11. [Status Kompilasi](#status-kompilasi)

## KESIMPULAN UTAMA

Klaim commit "resolve all findings" TIDAK terbukti. Hasil verifikasi:

- FIXED penuh: 12 item
- PARTIAL: 13 item
- NOT FIXED: 11 item
- REGRESSED / regresi baru: 8 item (termasuk 1 CRITICAL yang mematikan fitur reminder)
- Typecheck `npx tsc --noEmit`: BERSIH (0 error) — tetapi `api/` TIDAK ikut ter-typecheck (tsconfig include hanya `src/**/*`).

## CRITICAL — STATUS

| #   | Temuan                                      | Status    | Bukti                                                                                                                                                                                                                                                                                                                                              |
| --- | ------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | Default PIN 080402 / salt / hash ter-commit | PARTIAL   | [`src/admin_auth.ts:15-19`](src/admin_auth.ts:15); [`sql/migrate_v12_admin_auth.sql:21`](sql/migrate_v12_admin_auth.sql:21),[`:24`](sql/migrate_v12_admin_auth.sql:24); [`public/dashboard.html:2359`](public/dashboard.html:2359),[`:2500`](public/dashboard.html:2500); [`.env.example:76`](.env.example:76); [`src/env.ts:112`](src/env.ts:112) |
| C2  | GRANT EXECUTE rpc*admin*\* ke anon          | PARTIAL   | [`sql/migrate_v16_security_hardening_and_rpc.sql:9-15`](sql/migrate_v16_security_hardening_and_rpc.sql:9) (revoke) tapi [`sql/migrate_v12_admin_auth.sql:185-187`](sql/migrate_v12_admin_auth.sql:185) masih asli (bahaya urutan)                                                                                                                  |
| C3  | Lockout non-atomik (race)                   | NOT FIXED | [`src/admin_auth.ts:317`](src/admin_auth.ts:317),[`:381-389`](src/admin_auth.ts:381); `updatePin` [`src/admin_auth.ts:636-638`](src/admin_auth.ts:636) tanpa hitungan gagal                                                                                                                                                                        |
| C4  | /reset dibatalkan summarizer                | FIXED     | [`src/memory.ts:141-160`](src/memory.ts:141), [`:104-107`](src/memory.ts:104), [`:52-67`](src/memory.ts:52)                                                                                                                                                                                                                                        |
| C5  | Quota tidak ditegakkan                      | PARTIAL   | [`src/quota.ts:20-22`](src/quota.ts:20),[`:59-64`](src/quota.ts:59); tapi `keyAllowed` [`src/quota.ts:42-44`](src/quota.ts:42) masih in-memory tanpa hydrate DB                                                                                                                                                                                    |
| C6  | Timeout provider bocor                      | FIXED     | [`src/providers.ts:48-103`](src/providers.ts:48),[`:105`](src/providers.ts:105),[`:195`](src/providers.ts:195) (fetchJsonWithLifecycle)                                                                                                                                                                                                            |

## P0 KEAMANAN — STATUS

| #    | Item                           | Status  | Bukti                                                                                                                                                                                                                                |
| ---- | ------------------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P0-2 | Fail-closed webhook/cron       | PARTIAL | [`api/webhook.ts:7-13`](api/webhook.ts:7); [`src/whatsapp_cloud.ts:46-50`](src/whatsapp_cloud.ts:46); [`api/cron/reminders.ts:22-32`](api/cron/reminders.ts:22) — hanya fail-closed saat `isServerless`; self-host/Docker masih OPEN |
| P0-3 | assertRuntime coverage         | PARTIAL | [`src/env.ts:117-135`](src/env.ts:117) — WhatsApp hanya warning, cronSecret/webhook secret tidak diwajibkan                                                                                                                          |
| P0-4 | Path traversal session restore | FIXED   | [`src/whatsapp_session.ts:36-47`](src/whatsapp_session.ts:36)                                                                                                                                                                        |
| P0-5 | Stack trace + header           | PARTIAL | [`api/admin-otp.ts:176-180`](api/admin-otp.ts:176) (stack dihapus); tapi `public/*` masih tanpa CSP/HSTS/Referrer-Policy                                                                                                             |
| P0-6 | .gitignore CSV                 | PARTIAL | [`.gitignore:12-14`](.gitignore:12) ditambah, tapi 7 CSV MASIH ter-track (git ls-files)                                                                                                                                              |
| —    | Komparasi timing-safe          | FIXED   | [`src/whatsapp_cloud.ts:34-36`](src/whatsapp_cloud.ts:34),[`:60-63`](src/whatsapp_cloud.ts:60); [`api/cron/reminders.ts:8-13`](api/cron/reminders.ts:8); [`api/webhook.ts:15-18`](api/webhook.ts:15)                                 |

## P1 CORRECTNESS — STATUS

| #     | Item                                  | Status             | Bukti                                                                                                                                                                                                                                                    |
| ----- | ------------------------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1-1  | /reset prefixed-only + checkpoint     | PARTIAL            | [`src/memory.ts:37-49`](src/memory.ts:37) (bare reset/clear dihapus, tapi frasa "reset sesi"/"clear chat"/"hapus riwayat" masih cocok tanpa slash)                                                                                                       |
| P1-2  | Lockout atomik + rate-limit per-akun  | NOT FIXED          | [`src/admin_auth.ts:317`](src/admin_auth.ts:317),[`:636-638`](src/admin_auth.ts:636)                                                                                                                                                                     |
| P1-3  | fetchWithTimeout media                | PARTIAL            | [`src/media.ts:30`](src/media.ts:30),[`:55`](src/media.ts:55),[`:163`](src/media.ts:163) (Groq/Gemini audio/PDF); video [`src/media.ts:378-391`](src/media.ts:378) TANPA timeout                                                                         |
| P1-4  | Quota atomik + read-back              | PARTIAL            | [`src/quota.ts:20-21`](src/quota.ts:20),[`:42-44`](src/quota.ts:42),[`:59-64`](src/quota.ts:59)                                                                                                                                                          |
| P1-5  | increment_knowledge_hit RPC           | NOT FIXED (broken) | [`src/knowledge.ts:172`](src/knowledge.ts:172) kirim `p_entity_key` vs SQL `p_key` ([`sql/migrate_v16_security_hardening_and_rpc.sql:18`](sql/migrate_v16_security_hardening_and_rpc.sql:18),[`:20`](sql/migrate_v16_security_hardening_and_rpc.sql:20)) |
| P1-6  | Platform column + CAS claim           | PARTIAL + REGRESI  | [`sql/migrate_v16_security_hardening_and_rpc.sql:63`](sql/migrate_v16_security_hardening_and_rpc.sql:63); [`src/remind.ts:64`](src/remind.ts:64) `status='processing'`; [`api/cron/reminders.ts:37-54`](api/cron/reminders.ts:37)                        |
| P1-7  | Meta HMAC raw bytes                   | NOT FIXED          | [`api/whatsapp.ts:40`](api/whatsapp.ts:40) masih `JSON.stringify(req.body)`                                                                                                                                                                              |
| P1-8  | Dedup persisten 3 channel             | NOT FIXED          | [`src/whatsapp_cloud.ts:12-23`](src/whatsapp_cloud.ts:12); [`src/telegram.ts:410-416`](src/telegram.ts:410); [`src/whatsapp_baileys.ts:136-146`](src/whatsapp_baileys.ts:136)                                                                            |
| P1-9  | GPS IANA + isAskingTime + needsSearch | PARTIAL            | [`src/timezone.ts:367-368`](src/timezone.ts:367) (zone UTC masih invalid); [`:281-287`](src/timezone.ts:281); [`src/web.ts:277-320`](src/web.ts:277)                                                                                                     |
| P1-10 | Media cap + sniff + .env              | PARTIAL            | [`src/media.ts:212`](src/media.ts:212) (cap 15MB FIXED), [`:221-224`](src/media.ts:221) (.env FIXED), magic-byte sniffing BELUM                                                                                                                          |

## P2 KECERDASAN — STATUS

| #    | Item                              | Status    | Bukti                                                                                                                                            |
| ---- | --------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| P2-1 | Persona priority-stack + few-shot | NOT FIXED | [`src/skills.ts:350-782`](src/skills.ts:350) masih flat join, ~38.865 chars (~9.700 token) — membesar                                            |
| P2-2 | Netralisasi knowledge injection   | PARTIAL   | [`src/skills.ts:764-778`](src/skills.ts:764) masih "SUMBER KEBENARAN UTAMA"; [`src/knowledge.ts:17-26`](src/knowledge.ts:17) hanya 3 regex lemah |
| P2-3 | RAG-lite                          | NOT FIXED | tidak ada vector/embedding di sql/migrate_v16                                                                                                    |
| P2-4 | Single intent pass                | NOT FIXED | tidak ada IntentResult; classifier masih divergen                                                                                                |
| P2-5 | Instrumentasi dataset             | NOT FIXED | [`api/dataset.ts:24-27`](api/dataset.ts:24) hanya tambah isRealUsage                                                                             |
| P2-6 | Spec-sheet echo + /start statis   | PARTIAL   | strip [`src/skills.ts:81-84`](src/skills.ts:81); `/start` [`src/telegram.ts:89-97`](src/telegram.ts:89) masih LLM                                |
| P2-7 | Splitter fence-aware              | FIXED     | [`src/skills.ts:357-398`](src/skills.ts:357) (splitMessageSmart), dipakai 3 channel                                                              |

## P2 KUALITAS — STATUS

- needsSearch false positive (apple/intel/jadwal/kabar): PARTIAL — [`src/web.ts:277-320`](src/web.ts:277)
- year anchor 2026: FIXED — [`src/web.ts:311-317`](src/web.ts:311)
- isAskingTime over-trigger: FIXED — [`src/timezone.ts:281-287`](src/timezone.ts:281)
- GPS invalid zone: NOT FIXED — [`src/timezone.ts:367-368`](src/timezone.ts:367)
- detectLocation regex recompiled: FIXED — [`src/timezone.ts:256-266`](src/timezone.ts:256)
- short-token la/sf/hk/bali/metro: PARTIAL — [`src/timezone.ts:189`](src/timezone.ts:189),[`:236`](src/timezone.ts:236)
- CoT leak non-awalan: NOT FIXED — [`src/skills.ts:33-78`](src/skills.ts:33) masih anchored `^`
- Korupsi code-fence: IMPROVED + REGRESI BARU — [`src/skills.ts:85-99`](src/skills.ts:85),[`:341-343`](src/skills.ts:341),[`:215`](src/skills.ts:215)
- Emoji cap: PARTIAL/regresi — [`src/skills.ts:204-211`](src/skills.ts:204)
- Hashtag strip: PARTIAL — [`src/skills.ts:333`](src/skills.ts:333)

## P3 HIGIENE — STATUS

| #    | Item                                    | Status          | Bukti                                                                                                                                                                                                       |
| ---- | --------------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P3-1 | AGENTS.md                               | NOT FIXED       | tidak ada (dihapus commit 948e975)                                                                                                                                                                          |
| P3-2 | Migration ledger                        | NOT FIXED       | tidak ada schema_migrations                                                                                                                                                                                 |
| P3-3 | Retention/partisi + RTBF                | NOT FIXED       | tidak ada                                                                                                                                                                                                   |
| P3-4 | Test de-fork + CI                       | NOT FIXED       | `.github` tidak ada; scratch/ 47 file fork                                                                                                                                                                  |
| P3-5 | Observability                           | NOT FIXED       | tidak ada src/logger.ts                                                                                                                                                                                     |
| P3-6 | Paritas command + privacy/versi/link    | PARTIAL         | `/salah`+`/remind` di WhatsApp FIXED; versi index.html masih v0.25.6                                                                                                                                        |
| P3-7 | npm ci + trigram index + CHECK platform | PARTIAL/REGRESI | trigram [`sql/migrate_v16_security_hardening_and_rpc.sql:78`](sql/migrate_v16_security_hardening_and_rpc.sql:78) FIXED; [`Dockerfile:9`](Dockerfile:9) masih `npm install`; `messages.platform` tanpa CHECK |

## REGRESI BARU (harus segera diperbaiki)

1. CRITICAL — Reminder tidak pernah terkirim. [`src/remind.ts:64`](src/remind.ts:64) menulis `status='processing'` sedangkan CHECK [`sql/migrate_v09_hardened.sql:11`](sql/migrate_v09_hardened.sql:11) hanya izinkan `('pending','sent','failed')`. Tidak ada migrasi yang melonggarkan. Update gagal error 23514 → [`src/remind.ts:68`](src/remind.ts:68) `continue` → reminder tidak pernah dikirim. Verdict definitif dari Fase F.
2. [`api/stats.ts:534`](api/stats.ts:534) menimpa `Cache-Control: no-store` (baris 17) dengan `public, s-maxage=10` → stats ter-proteksi jadi public-cacheable.
3. [`src/knowledge.ts:172`](src/knowledge.ts:172) arg `p_entity_key` vs SQL `p_key` ([`sql/migrate_v16_security_hardening_and_rpc.sql:18`](sql/migrate_v16_security_hardening_and_rpc.sql:18)) → hit_count mati, error ditelan `.catch(()=>{})`.
4. [`src/skills.ts:215`](src/skills.ts:215) konversi heading `#{1,6}` → bold menimpa komentar `#` di dalam fenced code.
5. [`src/skills.ts:209`](src/skills.ts:209) cap emoji dinonaktifkan tidak sengaja untuk output >200 chars.
6. [`src/timezone.ts:367-368`](src/timezone.ts:367) collision UTC/WITA tetap.
7. [`Dockerfile:9`](Dockerfile:9) masih `npm install` (bukan `npm ci`).
8. `messages.platform` tanpa CHECK constraint.
9. [`src/providers.ts:87-96`](src/providers.ts:87) potensi unhandled rejection saat stall body read (Node 22 bisa crash proses).
10. [`src/admin_auth.ts:399`](src/admin_auth.ts:399) pesan "dikunci 1 menit" vs durasi aktual 15 menit ([`:384`](src/admin_auth.ts:384)).

## CATATAN KESELAMATAN (dari Fase B/C)

- [`public/dashboard.html:2359`](public/dashboard.html:2359) masih mengirim `PIN_SALT = "rafly_telemetry_salt"` dan hash client-side; server ([`src/admin_auth.ts:347-349`](src/admin_auth.ts:347)) mempercayai nilai pre-hashed → perbaikan salt jadi kosmetik, dan login PIN via dashboard berisiko putus setelah reset OTP.
- Hash default 080402 masih ada di [`sql/migrate_v12_admin_auth.sql:24`](sql/migrate_v12_admin_auth.sql:24) dan tidak dihapus v16.
- `.env` berisi kredensial live (WHATSAPP_TOKEN, RESEND_API_KEY) — gitignored, tapi pastikan tidak pernah masuk history.

## URUTAN REKOMENDASI PERBAIKAN LANJUTAN

1. HOTFIX CRITICAL: longgarkan CHECK reminders (`processing`) ATAU ubah CAS [`src/remind.ts:64`](src/remind.ts:64) — kalau tidak, fitur reminder mati total.
2. Perbaiki [`src/knowledge.ts:172`](src/knowledge.ts:172) → `p_key` (atau rename SQL) dan [`api/stats.ts:534`](api/stats.ts:534) (hapus overwrite cache).
3. Tuntaskan fail-closed di SEMUA mode (bukan hanya serverless): webhook, Meta signature, cron.
4. Jadikan `assertRuntime` wajib untuk semua secret per-channel; wajibkan `ADMIN_PIN`/`ADMIN_EMAIL` + jalur provisioning first-run.
5. Hapus hash 080402 dari v12; ubah v12 agar tidak re-grant anon (hilangkan hazard urutan v12→v16).
6. Perbaiki arg RPC + `keyAllowed` hydrate DB (quota benar-benar ditegakkan).
7. Tuntaskan: HMAC raw bytes, dedup persisten, updatePin lockout, GPS IANA, media magic-byte + timeout video.
8. Higiene: AGENTS.md, migration ledger, retention/RTBF, de-fork test + CI, observability, `npm ci`, CHECK platform.

## STATUS KOMPILASI

- `npx tsc --noEmit` → bersih, 0 error.
- `api/` TIDAK termasuk cakupan typecheck/build ([`tsconfig.json:16`](tsconfig.json:16) include `src/**/*`). Saat dicek manual, 6 fungsi api/ juga bersih — tapi celah cakupan tetap ada. `tsconfig.typecheck.json` yang terbuka di IDE tidak ada di disk.
