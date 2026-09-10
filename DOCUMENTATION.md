# DOCUMENTATION — AgentKit v0.3 (general assistant)

## 1. Arsitektur

Telegram polling (`src/telegram.ts`) → preprocessor (dedup bot, filter command, potong 2000 char) → skill asisten umum (`src/skills.ts`: system prompt general + jujur-tidak-tahu, eskalasi hanya saat provider gagal) → provider router (`src/providers.ts`: OpenRouter > Groq > Gemini > Ollama, timeout 15 dtk, cache 1 jam, quota harian per key via `src/quota.ts`) → kirim balasan + arsip best-effort (`src/db.ts`).

## 2. Keputusan penting (PRD v0.2 terkunci)

- Zen keluar: free terkunci aplikasi OpenCode (`MissingSessionID`), paid tanpa saldo (`CreditsError`).
- AgentRouter keluar: tolak klien generik (`unauthorized_client_error`).
- xAI keluar: kredit habis. Cerebras keluar: 402 minta bayar. Gemini key2 keluar: project denied.
- Vision hanya `nex-n2.5-pro:free` dan `gemini-3.8-flash`; model lain text-only + store-and-forward.

## 3. Riwayat perubahan

- v0.3 (2026-09-10): Migrasi ke asisten umum (system prompt general, sapaan netral, BOT_NAME/BOT_PROFILE, fallback SHOP_* kompatibel).
- v0.2 (2026-09-10): P0 Telegram + chain 4 provider + quota/cache + skema DB + docs. Verifikasi: `tsc --noEmit` bersih.
