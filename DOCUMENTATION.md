# DOCUMENTATION — AgentKit v0.5 (general assistant + P1 + vision)

## 1. Arsitektur

Telegram polling (`src/telegram.ts`) → preprocessor (dedup bot, filter command, potong 2000 char) → detektor order heuristik (`looksLikeOrder`: angka + kata kunci) → order-parser LLM ke JSON (`src/orders.ts`, simpan best-effort ke tabel `orders`) atau skill asisten umum (`src/skills.ts`) → provider router → kirim balasan + arsip. Commands: `/order` paksa parse, `/rekap` rekap hari ini, `/remind` timer in-memory. Scheduler rekap harian (`RECAP_TIME`, anti-duplikat per hari) jalan di proses bot.

## 2. Keputusan penting (PRD v0.2 terkunci)

- Zen keluar: free terkunci aplikasi OpenCode (`MissingSessionID`), paid tanpa saldo (`CreditsError`).
- AgentRouter keluar: tolak klien generik (`unauthorized_client_error`).
- xAI keluar: kredit habis. Cerebras keluar: 402 minta bayar. Gemini key2 keluar: project denied.
- Vision hanya `nex-n2.5-pro:free` dan `gemini-3.8-flash`; model lain text-only + store-and-forward.

## 3. Riwayat perubahan

- v0.5 (2026-09-10): Full-dinamis — vision gambar via model vision-capable, retry berdelay, nol template hardcoded (satu-satunya pesan status saat semua provider mati).
- v0.4 (2026-09-10): P1 — order-parser + rekap harian + reminder in-memory + migrasi `sql/migrate_p1.sql`.
- v0.3 (2026-09-10): Migrasi ke asisten umum (system prompt general, sapaan netral, BOT_NAME/BOT_PROFILE, fallback SHOP_* kompatibel).
- v0.2 (2026-09-10): P0 Telegram + chain 4 provider + quota/cache + skema DB + docs. Verifikasi: `tsc --noEmit` bersih.
