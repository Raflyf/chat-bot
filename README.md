# AgentKit v0.10 — Personal AI General Assistant (Telegram)

Self-hosted asisten AI umum ala Meta AI/ChatGPT/Gemini via Telegram: jawab pertanyaan apa pun (teks + gambar), koding/tutorial detail, pengingat persisten, stack $0: OpenRouter > Groq > Gemini > Ollama Cloud dengan failover cerdas + rotasi key + kuota guard + siap deploy 24 jam di Vercel.

---

## 1. Menjalankan di Lokal (Terminal)

1. `npm install`
2. Salin `.env.example` ke `.env`, isi `TELEGRAM_BOT_TOKEN`, `OWNER_CHAT_ID`, dan pool key.
3. Jalankan migrasi basis data di Supabase SQL Editor:
   - Jalankan file `sql/migrate_v09_hardened.sql` untuk membuat tabel dan mengaktifkan proteksi Row Level Security (RLS).
4. Jalankan bot:
   - `npm run dev` (pengembangan dengan tsx)
   - atau `npm run build` lalu `npm start` (versi produksi lokal).

---

## 2. Deploy ke Vercel (Aktif 24 Jam Tanpa Terminal)

Dengan arsitektur Webhook Serverless, bot dapat aktif 24/7 di Vercel secara gratis tanpa perlu menyalakan terminal atau komputer Anda:

### Langkah 1: Push Repositori ke GitHub
Pastikan semua file sudah di-commit dan di-push ke repositori GitHub privat Anda:
```bash
git add .
git commit -m "feat: upgrade to v0.10 with Vercel webhook and RLS"
git push origin main
```

### Langkah 2: Import Proyek di Vercel Dashboard
1. Buka [vercel.com](https://vercel.com) lalu klik **Add New Project**.
2. Pilih repositori GitHub proyek ini.
3. Framework Preset: biarkan **Other** (Vercel akan otomatis mengenali folder `api/` dan file `vercel.json`).

### Langkah 3: Masukkan Environment Variables di Vercel
Di menu **Settings > Environment Variables**, salin variabel dari `.env` Anda:
- `TELEGRAM_BOT_TOKEN`: Token bot Anda dari @BotFather.
- `OWNER_CHAT_ID`: ID chat Telegram Anda.
- `TELEGRAM_WEBHOOK_SECRET`: String rahasia acak (misal: gabungan 20-30 karakter acak).
- `CRON_SECRET`: String rahasia acak untuk mengamankan endpoint cron reminder.
- `SUPABASE_URL`: URL project Supabase Anda.
- `SUPABASE_SERVICE_KEY`: Service role secret key dari Supabase (WAJIB agar bot dapat membaca/menulis tabel ber-RLS).
- Pool Keys: `OPENROUTER_KEYS`, `GROQ_KEYS`, `GEMINI_KEYS`, dll.
- Klik **Deploy**. Tunggu hingga deployment selesai dan Anda mendapatkan domain (misal: `https://agentkit-nama.vercel.app`).

### Langkah 4: Daftarkan Webhook ke Telegram
Buka browser atau jalankan perintah curl sekali saja untuk mengalihkan bot ke domain Vercel Anda:
```
https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook?url=https://<DOMAIN_VERCEL_ANDA>/api/webhook&secret_token=<TELEGRAM_WEBHOOK_SECRET>
```

Contoh respon sukses dari Telegram:
```json
{"ok": true, "result": true, "description": "Webhook was set"}
```
Selesai. Bot Telegram Anda kini aktif 24 jam nonstop di cloud Vercel.

---

## 3. Fitur & Perilaku Pintar

- **Pintar & Adaptif**: Mampu menjawab singkat saat ngobrol santai, atau memberikan penjelasan komprehensif, terstruktur, dan koding lengkap tanpa terpotong (kapasitas 2500 output token).
- **Arsitektur Dua-Tingkat Timeout**: Cepat mendeteksi API key limit/mati (8 detik) untuk failover instan, dan memberikan waktu leluasa (90 detik) bagi model untuk berpikir mendalam.
- **Memori & Konteks**: Mengingat riwayat percakapan, ringkasan otomatis, dan koreksi user via `/salah <koreksi>`.
- **Pengingat Persisten**: Fitur `/remind <menit> <pesan>` tersimpan di database Supabase dan dieksekusi berkala via Vercel Cron (`* * * * *`).
- **Pencarian Web Otomatis**: Dilengkapi SSRF guard, Wikipedia Indonesia, fallback Wikipedia English untuk istilah teknis, dan DuckDuckGo.
- **Keamanan RLS**: Akses publik database ditutup total dari anonim, hanya dapat diakses melalui service key backend.
