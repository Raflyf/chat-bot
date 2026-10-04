# Panduan Setup cron-job.org untuk Pengingat Tepat Waktu

## Kenapa perlu

Vercel Hobby **tidak bisa** cron per-menit (malah gagal deploy), dan GitHub
Actions minimum **5 menit** (batas GitHub, sering ngaret saat beban tinggi).
cron-job.org **gratis** dan bisa memanggil endpoint **tiap 1 menit** → pengingat
jauh lebih tepat waktu.

---

## Data yang WAJIB diisi

Saat membuat cronjob baru di cron-job.org, isi:

| Field | Nilai |
|---|---|
| **Title** | `FreeAIBot - Kirim Pengingat` |
| **URL** | `https://free-chatbot-ai.vercel.app/api/cron/reminders` |
| **Schedule** | Every **1 minute** (pilih "Every minute" atau isi `* * * * *`) |
| **Request method** | `GET` |
| **Enable job** | ✅ ON |

### Header (WAJIB — tanpa ini endpoint menolak 401)

Di bagian **Advanced** → **Headers**, tambahkan SATU baris:

| Key | Value |
|---|---|
| `Authorization` | `Bearer <CRON_SECRET>` |

**Nilai `<CRON_SECRET>`**: buka file `.env` di folder proyek, cari baris
`CRON_SECRET=...`, lalu salin nilainya (40 karakter) ke kolom Value.

> Ganti `<CRON_SECRET>` dengan nilai asli. Format lengkapnya:
> `Bearer ` + nilai secret (ada spasi setelah kata Bearer).

---

## Cara verifikasi berhasil

Setelah dibuat, klik **"Run now"** (atau tunggu 1 menit), lalu cek:

- **Status code harus `200`**
- **Response body**: `{"ok":true,"processed":N,...}`
  (`processed` = jumlah pengingat yang dikirim saat itu; `0` berarti tidak ada
  pengingat yang jatuh tempo — itu normal)

Kalau dapat **401** → header `Authorization` salah/kurang (cek format `Bearer `).
Kalau dapat **403** → `CRON_SECRET` di Vercel kosong.

---

## Pengaturan tambahan (opsional, disarankan)

| Setting | Saran | Alasan |
|---|---|---|
| **Failure notification** | ON (email) | Tahu bila endpoint mulai gagal |
| **Timeout** | 30 detik | Endpoint biasanya selesai < 5 detik |
| **Treat redirects as success** | OFF | Endpoint tidak redirect |
| **Save responses in job history** | ON | Berguna untuk debug |
| **Max. execution time** | 30 detik | Cukup |

---

## Setelah cron-job.org aktif

Pengingat akan dikirim **tepat waktu (±1 menit)**. Tiga lapisan tetap berjalan
bersama sebagai cadangan:

1. **cron-job.org** tiap 1 menit → paling akurat (UTAMA)
2. **GitHub Actions** 3 jadwal bergeser → cadangan
3. **Lazy-check** saat ada pesan masuk → cadangan

Tidak ada yang perlu dimatikan — ketiganya aman berjalan bersamaan karena
endpoint memakai klaim atomik (`lease_until`) sehingga pengingat **tidak terkirim
dobel**.

---

## Troubleshooting

| Gejala | Penyebab | Solusi |
|---|---|---|
| HTTP 401 | Header Authorization salah | Pastikan format: `Bearer <nilai>` (ada spasi) |
| HTTP 403 | CRON_SECRET belum diset di Vercel | Set env `CRON_SECRET` di Vercel |
| HTTP 500 | Error internal | Cek log Vercel (Functions → Logs) |
| `processed: 0` terus | Tidak ada pengingat jatuh tempo | Normal — coba buat pengingat 1 menit lalu |
| Pengingat tetap telat | cron-job.org tidak aktif | Cek "Enable job" ON & riwayat eksekusi |
