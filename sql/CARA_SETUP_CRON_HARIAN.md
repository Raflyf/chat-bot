# Cara Setup Cron Harian (Backup & Arsip)

Dua endpoint ini sebaiknya dipanggil **sekali sehari** agar data aman dan tabel
tetap ringan. Keduanya butuh header `Authorization: Bearer <CRON_SECRET>`.

## 1. Backup Harian

```
POST https://free-chatbot-ai.vercel.app/api/cron/backup
Header: Authorization: Bearer <CRON_SECRET>
```

Mengekspor 7 tabel (messages, reminders, notes, todos, expenses, corrections,
user_profiles) ke Supabase Storage bucket **`backups`** dalam folder tanggal.

**Bucket `backups` sudah dibuat** ✅ (kalau belum: Supabase → Storage → New bucket
→ nama `backups` → jangan centang public).

Hasil uji nyata:
```
7 file, 530 KB
  2026-10-05/messages.json        514 KB
  2026-10-05/corrections.json      12 KB
  2026-10-05/reminders.json         3 KB
  ... (notes, todos, expenses, user_profiles)
```

## 2. Arsip Pesan Lama

```
POST https://free-chatbot-ai.vercel.app/api/cron/arsip
Header: Authorization: Bearer <CRON_SECRET>
```

Memindahkan pesan lebih tua dari 90 hari ke `messages_archive`.

## Cara Pasang di cron-job.org (gratis)

1. Buka https://cron-job.org → Sign up (gratis)
2. **Create cronjob**:
   - **Title**: Backup chatbot
   - **URL**: `https://free-chatbot-ai.vercel.app/api/cron/backup`
   - **Schedule**: setiap hari, jam 03:00
   - **Request method**: POST
   - **Headers**: `Authorization: Bearer <CRON_SECRET>`
3. Ulangi untuk `/api/cron/arsip` (jam 03:30)

## Cara Pasang di GitHub Actions

Buat `.github/workflows/backup.yml`:

```yaml
name: Backup Harian
on:
  schedule:
    - cron: '0 20 * * *'   # 03:00 WIB
  workflow_dispatch:
jobs:
  backup:
    runs-on: ubuntu-latest
    steps:
      - name: Backup
        run: |
          curl -X POST "https://free-chatbot-ai.vercel.app/api/cron/backup" \
            -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}"
      - name: Arsip
        run: |
          curl -X POST "https://free-chatbot-ai.vercel.app/api/cron/arsip" \
            -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}"
```

Jangan lupa set `CRON_SECRET` di **GitHub → Settings → Secrets → Actions**.

## Pemantauan (opsional)

Daftarkan `/api/health` ke UptimeRobot (gratis, cek tiap 5 menit):

```
GET https://free-chatbot-ai.vercel.app/api/health
```

- HTTP **200** = sehat
- HTTP **503** = bermasalah (database/provider down)

Anda akan dapat email kalau sistem mati.
