# Cara Menangani Pemeliharaan WhatsApp (Payment Method Meta)

Panduan ini dipakai ketika **pesan WhatsApp tidak sampai ke pengguna** padahal
bot sudah membalas (jawabannya tercatat di dataset/dashboard).

---

## 1. Kenali gejalanya

| Gejala | Artinya |
| :--- | :--- |
| Jawaban bot **muncul di dataset/dashboard** | Bot berjalan normal dan AI membalas. |
| Pesan **tidak masuk** ke WhatsApp pengguna | Pengiriman **diblokir Meta**, bukan bug bot. |
| Log berisi `HTTP 200` dari Meta | Meta **menerima** request, tetapi menahan pengirimannya. |

**Penting:** `HTTP 200` dari Graph API hanya berarti "diterima untuk diproses",
**bukan** "sudah sampai ke perangkat penerima".

### Cek status akun langsung (penyebab paling pasti)

```bash
# Ganti <PHONE_NUMBER_ID> dan <ACCESS_TOKEN>
curl -s "https://graph.facebook.com/v21.0/<PHONE_NUMBER_ID>?fields=health_status,status,code_verification_status,messaging_limit_tier,platform_type&access_token=<ACCESS_TOKEN>"
```

Contoh keluaran yang menandakan masalah pembayaran:

```json
"health_status": {
  "can_send_message": "BLOCKED",
  "entities": [
    {
      "entity_type": "WABA",
      "can_send_message": "BLOCKED",
      "errors": [
        {
          "error_code": 141006,
          "error_description": "There is an error with the payment method. This will block business initiated conversations.",
          "possible_solution": "There was an error with your payment method. Please add a new payment method to the account."
        }
      ]
    }
  ]
}
```

Bila `can_send_message` bernilai **`BLOCKED`** pada entitas **WABA**, pengiriman
sedang ditahan Meta.

---

## 2. Perbaiki payment method (langkah utama)

1. Buka **Meta Business Suite** → ikon **gear** (Pengaturan) di kiri bawah.
2. Masuk ke **Billing & payments** / **Penagihan dan pembayaran**.
3. Pilih akun bisnis yang menaungi WhatsApp (`FreeAIBot`).
4. **Tambahkan atau perbaiki metode pembayaran**:
   - Kartu kredit/debit yang valid, **atau**
   - Metode pembayaran lain yang tersedia untuk negara akun.
   - Pastikan tidak ada tagihan gagal/tertunda pada metode lama.
5. Simpan, lalu **tunggu 5–15 menit**.
6. Verifikasi ulang dengan perintah `curl` pada bagian 1 — `can_send_message`
   harus berubah dari `BLOCKED` menjadi `AVAILABLE`/`LIMITED` yang wajar.

> Catatan: WhatsApp Cloud API **memerlukan metode pembayaran** untuk percakapan
> yang dimulai bisnis. Untuk balasan dalam jendela layanan 24 jam biasanya tetap
> bisa dikirim, tetapi akun dengan payment method bermasalah **dapat diblokir
> total** seperti pada kasus ini.

### Sambil menunggu (opsional)

- **Business verification** — bila `entity_type: BUSINESS` berstatus `LIMITED`
  dengan `error_code 141010`, selesaikan **Business verification** di
  **Business settings → Security Center**.
- **Display name** — bila belum disetujui, limit pengiriman tidak akan naik.

---

## 3. Aktifkan mode pemeliharaan selama perbaikan

Supaya bot **tidak membuang kuota AI** untuk pesan yang pasti tidak sampai, dan
pengguna tetap diarahkan ke Telegram:

```bash
# Di Vercel → Project → Settings → Environment Variables (Production)
WHATSAPP_MAINTENANCE_MODE=true
```

Lalu **redeploy** (atau tunggu deploy berikutnya) agar variabel terbaca.

Perilaku saat aktif:

- Pesan WhatsApp **tidak** dipanggil ke AI (hemat kuota provider).
- Pengguna menerima pemberitahuan pemeliharaan + tautan Telegram.
- Bila pemberitahuan itu sendiri gagal terkirim, kegagalan **dicatat di log** dan
  pesan **tidak** ditandai selesai serta **tidak** disimpan sebagai balasan.
- `GET /api/health` → `whatsapp_maintenance: true`.
- Landing page menampilkan **"Telegram Online · WhatsApp Maintenance"**.

---

## 4. Matikan mode pemeliharaan (setelah pembayaran beres)

```bash
WHATSAPP_MAINTENANCE_MODE=false
```

atau **hapus** variabel tersebut (default = nonaktif / operasional normal).

Kemudian verifikasi:

1. `GET /api/health` → `whatsapp_maintenance: false`.
2. Kirim satu pesan WhatsApp ke bot dari nomor lain.
3. Pastikan balasan **sampai** ke WhatsApp, bukan hanya muncul di dataset.

---

## 5. Notifikasi otomatis

Bila pengiriman gagal **3× berturut-turut**, sistem mengirim peringatan ke
**Telegram pemilik** (maksimal sekali per 6 jam) berisi dugaan penyebab dan
langkah pengecekan. Notifikasi "pulih" juga dikirim saat pengiriman kembali
normal. Jadi kegagalan pengiriman tidak akan lewat tanpa ada yang sadar.

---

## 6. Jangan lakukan ini

- **Jangan** menganggap masalahnya bug bot hanya karena jawaban ada di dataset —
  cek dulu `can_send_message` di Graph API.
- **Jangan** menandai pesan selesai secara diam-diam saat pengiriman gagal;
  itu menyembunyikan masalah.
- **Jangan** menempelkan token/secret di issue, chat, atau log.
