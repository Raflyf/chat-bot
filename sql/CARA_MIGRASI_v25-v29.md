# Cara Menjalankan Migrasi v25–v29

Semua migrasi ini **OPSIONAL** — sistem tetap bekerja tanpanya (ada fallback),
tetapi fitur barunya belum aktif penuh.

Jalankan di **Supabase → SQL Editor**, satu per satu, urut dari v25.

| Migrasi | Isi | Bila belum dijalankan |
|---|---|---|
| `migrate_v25_user_profiles.sql` | Tabel profil zona waktu per-user | Fallback ke tabel `corrections` (tetap jalan) |
| `migrate_v26_provider_cooldown.sql` | Cooldown provider persisten | Cooldown hanya di memori (hilang saat restart) |
| `migrate_v27_reminder_recurring.sql` | Kolom pengingat berulang | Pengingat berulang tersimpan sebagai sekali-jalan |
| `migrate_v28_message_archive.sql` | Arsip pesan lama | Tabel `messages` tumbuh tanpa batas |
| `migrate_v29_cleanup.sql` | Hapus tabel mati | Tabel `pending_confirmations` tetap ada (tak dipakai) |

## Urutan yang disarankan

1. **v25** — profil waktu (paling penting untuk akurasi zona waktu)
2. **v27** — pengingat berulang (fitur baru untuk user)
3. **v26** — cooldown persisten (menghemat kuota)
4. **v28** — arsip pesan (performa jangka panjang)
5. **v29** — bersih-bersih (opsional)

## Setelah migrasi v25 & v27

Cron harian disarankan (cron-job.org / GitHub Actions):

```
POST https://free-chatbot-ai.vercel.app/api/cron/backup
Header: Authorization: Bearer <CRON_SECRET>
```
(satu kali sehari — backup otomatis)

```
POST https://free-chatbot-ai.vercel.app/api/cron/arsip
Header: Authorization: Bearer <CRON_SECRET>
```
(sekali sehari — arsipkan pesan >90 hari)

## Health check

```
GET https://free-chatbot-ai.vercel.app/api/health
```
HTTP 200 = sehat, 503 = bermasalah. Cocok untuk UptimeRobot (gratis).
