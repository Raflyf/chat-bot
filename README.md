# AgentKit v0.3 — Personal AI General Assistant (Telegram)

Self-hosted asisten AI umum ala Meta AI/ChatGPT/Gemini via Telegram: jawab pertanyaan apa pun, stack $0: OpenRouter > Groq > Gemini > Ollama Cloud dengan failover + rotasi key + quota guard. Seluruh primer rantai ini terverifikasi live merespon.

## Jalan cepat

1. `npm install`
2. Salin `.env.example` ke `.env`, isi `TELEGRAM_BOT_TOKEN`, `OWNER_CHAT_ID`, dan pool key.
3. (Opsional) Jalankan `sql/schema.sql` di Supabase untuk arsip chat.
4. `npm run dev` (atau `npm run build` lalu `npm start`).

## Perilaku

- `/start` disapa, pesan teks apa pun dijawab LLM. Eskalasi ke owner hanya jika semua provider gagal.
- Foto/dokumen: balasan template (analisis gambar fase 2), media diteruskan ke owner bila diisi.
- Semua provider gagal: balasan template fail-closed, tidak mengarang jawaban.

## Risiko yang dinyatakan jujur

- Free-tier provider berubah sewaktu-waktu (limit, katalog `:free`). ID model via env, bukan hardcode.
- Baileys (P2) unofficial: risiko ban nomor. Telegram Bot API resmi jadi jalur utama.
- Chat pelanggan keluar ke cloud provider (bukan zero-cloud). Sampaikan ke owner toko.
- Jangan commit `.env` berisi key asli. Key yang pernah terekspos di chat harus diputar ulang.
