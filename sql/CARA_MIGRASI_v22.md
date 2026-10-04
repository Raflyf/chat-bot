# Cara Menerapkan Migrasi v22 (Fitur Pencatatan)

Fitur catatan/tugas/keuangan/kebiasaan butuh 5 tabel baru di Supabase.
Migrasi TIDAK bisa dijalankan otomatis dari kode (Supabase membatasi eksekusi SQL
lewat API), jadi harus dijalankan manual SEKALI.

## Langkah

1. Buka https://supabase.com/dashboard/project/fxpgmpospgmdhkssltus/sql/new
2. Buka berkas `sql/migrate_v22_personal_notes.sql`
3. Salin SELURUH isinya, tempel ke SQL Editor
4. Klik **Run**
5. Pastikan muncul "Success. No rows returned"

## Verifikasi

Jalankan di SQL Editor:

```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('notes','todos','expenses','habits','habit_logs');
```

Harus muncul 5 baris.

## Yang dibuat

| Tabel | Fungsi |
|---|---|
| `notes` | Catatan bebas & jurnal |
| `todos` | Daftar tugas (prioritas + tenggat) |
| `expenses` | Pengeluaran/pemasukan + kategori |
| `habits` | Kebiasaan berulang + streak |
| `habit_logs` | Riwayat centang kebiasaan |

Plus 1 RPC: `sum_expenses(chat_id, from, to)` untuk rekap cepat.

## Tanpa migrasi ini

Bot tetap berjalan normal — fitur pencatatan akan membalas
"⚠️ Gagal menyimpan..." karena tabel belum ada. Fitur lain tidak terpengaruh.
