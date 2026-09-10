# DOCUMENTATION — AgentKit v0.2 (P0)

## 1. Arsitektur P0

Telegram polling (`src/telegram.ts`) → preprocessor (dedup bot, filter command, potong 1000 char) → skill auto-reply (`src/skills.ts`: system prompt toko + sentinel `BUTUH_ADMIN`) → provider router (`src/providers.ts`: OpenRouter > Groq > Gemini > Ollama, timeout 15 dtk, cache 1 jam, quota harian per key via `src/quota.ts`) → kirim balasan + arsip best-effort (`src/db.ts`) → eskalasi ke owner bila perlu.

## 2. Keputusan penting (PRD v0.2 terkunci)

- Zen keluar: free terkunci aplikasi OpenCode (`MissingSessionID`), paid tanpa saldo (`CreditsError`).
- AgentRouter keluar: tolak klien generik (`unauthorized_client_error`).
- xAI keluar: kredit habis. Cerebras keluar: 402 minta bayar. Gemini key2 keluar: project denied.
- Vision hanya `nex-n2.5-pro:free` dan `gemini-3.8-flash`; model lain text-only + store-and-forward.

## 3. Riwayat perubahan

- v0.2 (2026-09-10): P0 Telegram + chain 4 provider + quota/cache + skema DB + docs. Verifikasi: `tsc --noEmit` bersih.
