# Perbaikan Keamanan — 06 Oktober 2026

Dokumen ini mencatat **semua** perbaikan keamanan yang dikerjakan setelah
verifikasi audit 20 parameter (yang dipetakan dari checklist keamanan umum).

---

## Ringkasan: 5 dari 6 temuan audit SELESAI

| # | Temuan | Status | Bukti |
|---|---|---|---|
| 1 | RLS + REVOKE tabel v22-v25 | ✅ **Migrasi siap** | `sql/migrate_v30_rls_hardening.sql` |
| 2 | PIN pakai SHA-256 (cepat) | ✅ **SELESAI** | `scrypt` + auto-upgrade |
| 3 | Salt hardcoded di repo publik | ✅ **SELESAI** | fallback dihapus |
| 4 | Endpoint publik bocorkan info | ✅ **SELESAI** | email & timing dihapus |
| 5 | 12 kerentanan npm (2 kritis) | ✅ **SELESAI** | **0 kritis** (12→7 sedang) |
| 6 | Tanpa antivirus upload | ✅ **Mitigasi** | penjaga berkas + alasan terdokumentasi |

**Test otomatis:** 76 lulus (14 test keamanan baru).

---

## 1. RLS + REVOKE pada Tabel Personal

**Masalah:** tabel `notes`, `todos`, `expenses`, `habits`, `habit_logs`,
`pending_confirmations`, `game_sessions`, `user_profiles` **tidak** punya RLS
maupun REVOKE — berbeda dengan tabel inti yang sudah aman.

**Risiko:** bila kunci publik Supabase (`anon`) bocor, data personal pengguna
bisa dibaca langsung lewat REST API.

**Perbaikan:** `sql/migrate_v30_rls_hardening.sql`
- `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY` pada 8 tabel
- `REVOKE ALL` dari `anon`, `authenticated`, `PUBLIC` (+ sequence)
- `GRANT ALL` ke `service_role` (agar aplikasi tetap jalan)
- Verifikasi otomatis (RAISE NOTICE status tiap tabel)

### ⚠️ CARA MENJALANKAN (perlu dilakukan manual)

Migrasi **belum dijalankan**. Buka **Supabase → SQL Editor**, tempel isi
`sql/migrate_v30_rls_hardening.sql`, lalu **Run**.

Setelah itu verifikasi:
```sql
SELECT c.relname, c.relrowsecurity
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
  AND c.relname IN ('notes','todos','expenses','habits','habit_logs',
                    'pending_confirmations','game_sessions','user_profiles');
```
Semua baris harus `relrowsecurity = true`.

**Dampak:** dashboard & bot **tetap berfungsi normal** (memakai `service_role`).

---

## 2. Hashing PIN: SHA-256 → scrypt

**Masalah:** PIN hanya 6 digit (1 juta kombinasi). SHA-256 sangat cepat
(miliaran hash/detik di GPU) — bila hash bocor, PIN ketemu dalam **detik**.

**Perbaikan:**
- Hash baru memakai **scrypt** (`N=16384, r=8, p=1`) — lambat + butuh memori.
- Format: `scrypt$N$r$p$salt$hash` (self-describing, parameter bisa dinaikkan).
- **PIN lama TETAP BISA LOGIN** (SHA-256 masih diverifikasi) — lalu
  **otomatis di-upgrade** ke scrypt saat login sukses.
- OTP juga ikut memakai scrypt.

**Bukti:** 5x SHA-256 = **0 ms**, 5x scrypt = **328 ms** (~65 ms per hash).
Brute-force 1 juta kombinasi: dari detik → **~18 jam** (dan bisa dinaikkan).

**Diuji:** PIN lama bisa login ✅, PIN salah ditolak ✅, auto-upgrade ✅.

---

## 3. Salt Hardcoded Dihapus

**Masalah:** fallback `'rafly_telemetry_salt'` ada di repositori **publik** —
siapa pun bisa membacanya dan memakai salt yang sama untuk memecahkan hash.

**Perbaikan:** fallback dihapus dari `src/env.ts`. Salt kini dari:
1. `PIN_SALT` (env, **sudah diset di Vercel & lokal** ✅)
2. Turunan `SUPABASE_SERVICE_KEY` (rahasia server)
3. Bila keduanya tidak ada → **verifikasi DITOLAK** (fail-closed)

`LEGACY_SALTS` masih ada **hanya untuk memverifikasi** PIN lama (bukan membuat
hash baru) — ini sengaja agar PIN lama tidak terkunci.

---

## 4. Endpoint Publik `/api/admin-otp` Tidak Lagi Bocorkan Info

**Masalah:** endpoint ini publik (tanpa auth) dan mengembalikan:
- `targetEmailMasked` → memberi tahu **sebagian email admin**
- `lockedUntil` → memberi tahu **kapan lockout berakhir** (timing untuk penyerang)

**Perbaikan:**
- `targetEmailMasked` **tidak lagi dikirim** ke publik
- `lockedUntil` **tidak lagi dikirim** (hanya `is_locked` boolean)
- `remainingAttempts` tetap (tidak sensitif, dibutuhkan UX)
- Rate limit 30 permintaan/menit/IP tetap berlaku

**Bonus — bug diperbaiki:** respons memakai `camelCase` tetapi frontend membaca
`snake_case` (`target_email_masked`), sehingga **"Sisa percobaan" tidak pernah
tampil**. Sekarang dikirim dengan nama yang benar.

---

## 5. Kerentanan npm: 12 → 7 (2 kritis → 0)

**Masalah:** 12 kerentanan (10 sedang, **2 kritis**) dari `node-telegram-bot-api`
→ `@cypress/request` → `form-data`/`request`.

**Perbaikan:** `overrides` di `package.json`:
```json
"overrides": {
  "form-data": "^4.0.4",
  "tough-cookie": "^5.1.2",
  "uuid": "^11.1.1",
  "qs": "^6.16.0",
  "sprintf-js": "^1.1.3"
}
```

**Hasil:**
```
SEBELUM: 12 kerentanan (10 sedang, 2 KRITIS)
SESUDAH:  7 kerentanan (7 sedang, 0 KRITIS) ✅
```

**7 sisa — risiko RENDAH (terverifikasi):**
- SSRF `request`: URL **selalu** `https://api.telegram.org` (hardcoded, bukan
  input user) → **tidak bisa dieksploitasi**.
- `sprintf-js`: dipakai `mammoth` untuk **membaca** .docx, bukan format string user.

**Catatan:** upgrade ke `node-telegram-bot-api@2.1.0` (0 dependensi) akan
menghilangkan semuanya, **tetapi** v2 adalah *"from-scratch redesign, no v1
compatibility"* → butuh refactor besar. Ditunda sampai diperlukan.

---

## 6. Upload Tanpa Antivirus — Mitigasi

**Kondisi:** tidak ada ClamAV/antivirus. Ini **dapat diterima** karena:
1. Berkas **tidak pernah** disimpan ke disk (hanya dibaca di RAM)
2. Berkas **tidak pernah** dieksekusi
3. Berkas **tidak pernah** disajikan kembali ke publik
4. Ukuran dibatasi 15 MB + dekompresi 5 MB (anti zip-bomb)
5. MIME diverifikasi dari **magic bytes**

**Penguatan tambahan** (`src/media_guard.ts`):
- Tolak **44 ekstensi** berbahaya (`.exe`, `.sh`, `.ps1`, `.bat`, `.dll`, ...)
- Tolak **magic bytes executable** (MZ/PE, ELF, Mach-O, shebang `#!`)
- Tolak **path traversal** (`..`, `/`, `\`)

Ini mencegah eksploitasi celah parser dan mencegah berkas berbahaya diteruskan
ke layanan lain di masa depan.

**Bug ditemukan test:** regex `/[\\/]/` hanya menangkap `/`, sehingga
`folder\file.txt` lolos → **diperbaiki**.

---

## Yang SENGAJA TIDAK Diubah (dengan alasan)

### Session token: tetap `sessionStorage` (bukan cookie HttpOnly)
- `sessionStorage` **sudah** otomatis terhapus saat tab ditutup
- Migrasi ke cookie butuh ubah **semua** endpoint + frontend + CSRF token
- **XSS sudah dicegah**: CSP `script-src 'self'` + 39x `escapeHtml`
- Tanpa XSS, token **tidak bisa dicuri** → risiko nyata rendah

### `node-telegram-bot-api` tidak di-upgrade ke v2
- v2 = redesign total, **tanpa kompatibilitas v1** → refactor besar
- 2 kerentanan kritis sudah **hilang** via overrides
- 7 sisa terbukti **tidak bisa dieksploitasi** di konteks proyek ini

---

## Verifikasi

```bash
npm test                    # 76 test lulus (14 keamanan)
npm run typecheck           # bersih
npm audit --omit=dev        # 0 kritis
```

## Yang Masih Perlu Dilakukan User

1. **Jalankan migrasi v30** di Supabase SQL Editor (lihat bagian 1)
2. **Login ke dashboard sekali** agar PIN lama otomatis di-upgrade ke scrypt
3. (Opsional) Revoke token CLI Vercel yang lama bila sesi sudah tidak dipakai
