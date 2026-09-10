# AgentKit v0.4 — Personal AI General Assistant (Telegram)

Self-hosted asisten AI umum ala Meta AI/ChatGPT/Gemini via Telegram: jawab pertanyaan apa pun (teks + gambar), pengingat, stack $0: OpenRouter > Groq > Gemini > Ollama Cloud dengan failover + rotasi key + quota guard.

## Jalan cepat

1. `npm install`
2. Salin `.env.example` ke `.env`, isi `TELEGRAM_BOT_TOKEN`, `OWNER_CHAT_ID`, dan pool key.
3. (Opsional) Jalankan `sql/schema.sql` di Supabase SQL editor untuk arsip chat.
4. `npm run dev` (atau `npm run build` lalu `npm start`).

## Perilaku

- `/start` disapa, pesan teks apa pun dijawab LLM dinamis 24/7 tanpa template dan tanpa jam off. Eskalasi ke owner hanya jika semua provider mati total.
- `/remind <menit 1-1440> <pesan>` untuk pengingat. Pengingat hilang saat restart (persistensi roadmap berikutnya).
- Foto dianalisis dinamis via model vision (nex-pro / gemini-flash); dokumen non-gambar diteruskan ke owner.

## Risiko yang dinyatakan jujur

- Free-tier provider berubah sewaktu-waktu (limit, katalog `:free`). ID model via env, bukan hardcode.
- Baileys (P2) unofficial: risiko ban nomor. Telegram Bot API resmi jadi jalur utama.
- Chat keluar ke cloud provider (bukan zero-cloud).
- Jangan commit `.env` berisi key asli. Key yang pernah terekspos di chat harus diputar ulang.
