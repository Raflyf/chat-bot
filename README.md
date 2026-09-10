# AgentKit v0.9 — Personal AI General Assistant (Telegram)

Self-hosted asisten AI umum ala Meta AI/ChatGPT/Gemini via Telegram: jawab pertanyaan apa pun (teks + gambar), pengingat, stack $0: OpenRouter > Groq > Gemini > Ollama Cloud dengan failover + rotasi key + quota guard.

## Jalan cepat

1. `npm install`
2. Salin `.env.example` ke `.env`, isi `TELEGRAM_BOT_TOKEN`, `OWNER_CHAT_ID`, dan pool key.
3. (Opsional) Jalankan `sql/schema.sql` di Supabase SQL editor untuk arsip chat.
4. `npm run dev` (atau `npm run build` lalu `npm start`).

## Perilaku

- `/start` disapa, pesan teks apa pun dijawab LLM dinamis 24/7 tanpa template dan tanpa jam off. Eskalasi ke owner hanya jika semua provider mati total.
- Memori: 10 pesan terakhir + ringkasan tiap 20 pesan + koreksi via `/salah <koreksi>` (butuh `sql/migrate_v08.sql`).
- Butuh info terkini (terbaru/hari ini/berita): lookup Wikipedia + DuckDuckGo otomatis dengan sumber disebut.
- Aturan jujur bawaan: tanpa halu, tanpa overclaim, bedakan fakta vs opini.

## Risiko yang dinyatakan jujur

- Free-tier provider berubah sewaktu-waktu (limit, katalog `:free`). ID model via env, bukan hardcode.
- Baileys (P2) unofficial: risiko ban nomor. Telegram Bot API resmi jadi jalur utama.
- Chat keluar ke cloud provider (bukan zero-cloud).
- Jangan commit `.env` berisi key asli. Key yang pernah terekspos di chat harus diputar ulang.
