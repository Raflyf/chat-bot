# DOCUMENTATION — AgentKit v0.9 (AI general assistant + memori + web)

## 1. Arsitektur

Telegram polling (`src/telegram.ts`) → preprocessor (dedup bot, filter command, potong 2000 char) → konteks memori (`src/memory.ts`: 10 pesan terakhir + ringkasan/20 pesan + koreksi, butuh `sql/migrate_v08.sql`, graceful tanpa tabel) → lookup internet bila dipicu kata terkini (`src/web.ts`: Wikipedia + DuckDuckGo, sebut sumber) → skill asisten umum (`src/skills.ts`: system rules anti-halu + tanggal hari ini) → provider router (timeout berpikir 90 dtk, failover instan, cache 1 jam, quota harian) → kirim balasan + arsip. Commands: `/remind` (in-memory), `/salah <koreksi>` (diingat permanen per chat).

## 2. Keputusan penting (PRD v0.2 terkunci)

- Zen keluar: free terkunci aplikasi OpenCode (`MissingSessionID`), paid tanpa saldo (`CreditsError`).
- AgentRouter keluar: tolak klien generik (`unauthorized_client_error`).
- xAI keluar: kredit habis. Cerebras keluar: 402 minta bayar. Gemini key2 keluar: project denied.
- Vision hanya `nex-n2.5-pro:free` dan `gemini-3.8-flash`; model lain text-only + store-and-forward.

## 3. Riwayat perubahan

- v0.9.1 (2026-09-10): Jawaban bersih — hasil web disaring AI, tidak ditempel mentah.
- v0.9 (2026-09-10): Zero-template — semua sapaan/konfirmasi dinamis via AI; pencarian kata kunci Wikipedia.
- v0.8 (2026-09-10): Smart — kontinuitas chat, memori ringkasan + koreksi, lookup internet, system rules anti-halu.
- v0.7 (2026-09-10): Purge total logika toko (order-parser, rekap, scheduler, SHOP_*). Bot murni AI general assistant.
- v0.6 (2026-09-10): Timeout split — berpikir 90 dtk, failover instan (error kembali cepat), unduh media 30 dtk.
- v0.5 (2026-09-10): Full-dinamis — vision gambar via model vision-capable, retry berdelay, nol template hardcoded (satu-satunya pesan status saat semua provider mati).
- v0.4 (2026-09-10): P1 — order-parser + rekap harian + reminder in-memory + migrasi `sql/migrate_p1.sql`.
- v0.3 (2026-09-10): Migrasi ke asisten umum (system prompt general, sapaan netral, BOT_NAME/BOT_PROFILE, fallback SHOP_* kompatibel).
- v0.2 (2026-09-10): P0 Telegram + chain 4 provider + quota/cache + skema DB + docs. Verifikasi: `tsc --noEmit` bersih.
