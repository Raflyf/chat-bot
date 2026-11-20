# Cara Menjalankan Migrasi v35 — Database Khusus Grup

Migrasi ini membuat 9 tabel khusus grup (`group_messages`, `group_reminders`, `group_notes`, `group_todos`, `group_expenses`, `group_corrections`, `group_summaries`, `group_documents`, `group_settings`) agar seluruh data grup terpisah secara fisik dari data privat pengguna di Supabase.

## Langkah Jalankan
1. Buka **Supabase Dashboard** proyek Anda -> menu **SQL Editor**.
2. Salin seluruh isi [migrate_v35_group_database.sql](file:///d:/code/project/projek_no_name/sql/migrate_v35_group_database.sql).
3. Tempel ke SQL Editor lalu klik **Run**.
4. Tidak perlu restart VPS maupun redeploy Vercel — `src/group_db.ts` mendeteksi ketersediaan tabel baru secara otomatis paling lambat dalam 60 detik dan langsung mengalihkan baca/tulis grup ke tabel `group_*`.

## Catatan Keamanan
- Seluruh 9 tabel otomatis mengaktifkan `ROW LEVEL SECURITY` (`FORCE ROW LEVEL SECURITY`) dan mencabut akses `anon` / `authenticated` / `PUBLIC`. Hanya `service_role` di backend yang dapat mengaksesnya.
- Sebelum migrasi ini dijalankan, kode sudah lebih dulu memisahkan `chat_id` grup secara logis sehingga data privat Anda tetap aman dan tidak akan bocor ke grup.
