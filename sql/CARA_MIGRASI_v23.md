# Cara Menerapkan Migrasi v23 (Konfirmasi Tertunda Durable)

## Kenapa perlu

Keluhan: user minta "ingatkan 1 menit lg login" → bot bilang "pengingat tersimpan"
→ **tapi tidak ada pengingat masuk**.

Akar: konfirmasi ("balas iya untuk simpan") disimpan di MEMORI PROSES. Vercel
serverless menjalankan banyak instance paralel — pesan "ingatkan..." dan "ya"
bisa dilayani instance BERBEDA, sehingga instance kedua tidak tahu ada
konfirmasi menunggu → pesan "ya" jatuh ke AI → AI MENGARANG "tersimpan".

## Langkah

1. Buka https://supabase.com/dashboard/project/fxpgmpospgmdhkssltus/sql/new
2. Salin SELURUH isi `sql/migrate_v23_pending_confirmations.sql`
3. Klik **Run** → pastikan "Success. No rows returned"

## Verifikasi

```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'pending_confirmations';
```
Harus muncul 1 baris.

## Yang dibuat

| Objek | Fungsi |
|---|---|
| `pending_confirmations` | Menyimpan niat yang menunggu jawaban "iya"/"tidak" |
| `set_pending_confirmation()` | Simpan/ganti konfirmasi (atomik, upsert per chat) |
| `take_pending_confirmation()` | Ambil + hapus sekaligus (atomik, anti-dobel) |
| `clear_pending_confirmation()` | Buang konfirmasi (user bilang "tidak") |

## Tanpa migrasi ini

Bot tetap berjalan. Konfirmasi memakai fallback MEMORI PROSES — bekerja bila
pesan berurutan dilayani instance yang sama, tapi bisa gagal (seperti keluhan
di atas) bila instance berbeda. **Disarankan segera menjalankan migrasi.**
