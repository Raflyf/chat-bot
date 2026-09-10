# AgentKit v0.2 — Personal AI Agent (P0: Telegram)

Self-hosted AI agent untuk Telegram (WhatsApp/Baileys fase P2), stack $0: OpenRouter > Groq > Gemini > Ollama Cloud dengan failover + rotasi key + quota guard. Seluruh primer rantai ini terverifikasi live merespon.

## Jalan cepat

1. `npm install`
2. Salin `.env.example` ke `.env`, isi `TELEGRAM_BOT_TOKEN`, `OWNER_CHAT_ID`, dan pool key.
3. (Opsional) Jalankan `sql/schema.sql` di Supabase untuk arsip chat.
4. `npm run dev` (atau `npm run build` lalu `npm start`).

## Perilaku P0

- `/start` disapa, pesan teks dijawab LLM + eskalasi `BUTUH_ADMIN` ke owner.
- Foto/dokumen: store-and-forward (diteruskan ke owner + balasan template). Vision LLM fase 2.
- Semua provider gagal: balasan template fail-closed, tidak mengarang jawaban.

## Risiko yang dinyatakan jujur

- Free-tier provider berubah sewaktu-waktu (limit, katalog `:free`). ID model via env, bukan hardcode.
- Baileys (P2) unofficial: risiko ban nomor. Telegram Bot API resmi jadi jalur utama.
- Chat pelanggan keluar ke cloud provider (bukan zero-cloud). Sampaikan ke owner toko.
- Jangan commit `.env` berisi key asli. Key yang pernah terekspos di chat harus diputar ulang.
