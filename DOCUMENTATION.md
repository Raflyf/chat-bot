# DOCUMENTATION — AgentKit v0.10.0 (Hardened AI Assistant, Persistent Memory & Vercel 24/7)

## 1. Arsitektur Dual-Mode

Sistem mendukung dua mode eksekusi tanpa mengubah logika bisnis:
1. **Mode Lokal / Terminal (`src/index.ts`)**: Menggunakan Telegram polling + in-process reminder worker tiap 30 detik untuk pengujian cepat.
2. **Mode Serverless 24/7 Vercel (`api/webhook.ts` + `api/cron/reminders.ts`)**:
   - Webhook endpoint (`POST /api/webhook`) dengan verifikasi `X-Telegram-Bot-Api-Secret-Token` via `crypto.timingSafeEqual`.
   - Vercel Cron (`GET /api/cron/reminders`) terjadwal tiap 1 menit untuk mengirim pengingat persisten dari Supabase.
   - Tanpa ketergantungan terminal lokal; bot aktif 24 jam nonstop.

### Alur Eksekusi
Update Telegram (Polling/Webhook) → Sanitasi & Preprocessing → Ekstraksi Konteks Memori (`src/memory.ts`: 10 riwayat pesan + ringkasan 20 pesan + koreksi tersimpan) → Lookup Internet cerdas (`src/web.ts`: Wikipedia ID & EN fallback + DuckDuckGo dengan SSRF guard) → Skills & Guardrails (`src/skills.ts`: prompt adaptif komprehensif, delimitasi `<user_message>`, output redaction) → Router Dua-Tingkat Timeout (`src/providers.ts`: connect/header timeout 8 dtk untuk deteksi cepat 429/mati + thinking timeout 90 dtk + token output 2500) → Rantai Failover (OpenRouter > Groq > Gemini > Ollama Cloud) → Balasan dikirim + Arsip Supabase.

---

## 2. Keamanan & Kebijakan Database (RLS)

- Seluruh tabel (`messages`, `summaries`, `corrections`, `provider_quota`, `reminders`) wajib mengaktifkan **Row Level Security (RLS)** via `sql/migrate_v09_hardened.sql`.
- Akses dibatasi secara eksklusif ke `service_role`. Akses dari publik (`anon` dan `authenticated`) dicabut total untuk mencegah kebocoran data chat.
- Proteksi Injeksi Prompt: Input pengguna dibungkus dengan tag `<user_message>` dan instruksi sistem memiliki hierarki veto tertinggi.
- Sensor Otomatis Kredensial: Respons AI disaring dengan filter `redactOutput()` untuk memblokir kebocoran API key (`sk-`, `sbp_`, token bot).

---

## 3. Riwayat Perubahan

- v0.10.0 (2026-09-10): **Hardened & Vercel 24/7 Deployment Ready**
  - Implementasi Webhook Vercel (`api/webhook.ts`) dengan proteksi secret token.
  - Pengingat persisten Supabase (`reminders`) + Vercel Cron (`api/cron/reminders.ts`).
  - Arsitektur timeout dua tingkat: koneksi cepat 8 dtk (failover instan jika 429) & durasi berpikir leluasa 90 dtk.
  - Kapasitas token output ditingkatkan ke 2500 dan persona AI lebih cerdas & adaptif untuk koding/analisis mendalam.
  - Pengaktifan Row Level Security (RLS) penuh di Supabase (`sql/migrate_v09_hardened.sql`).
  - SSRF guard & Wikipedia English fallback pada pencarian web.
- v0.9.1 (2026-09-10): Jawaban bersih — hasil web disaring AI, tidak ditempel mentah.
- v0.9 (2026-09-10): Zero-template — semua sapaan/konfirmasi dinamis via AI; pencarian kata kunci Wikipedia.
- v0.8 (2026-09-10): Smart — kontinuitas chat, memori ringkasan + koreksi, lookup internet, system rules anti-halu.
- v0.7 (2026-09-10): Purge total logika toko. Bot murni AI general assistant.
- v0.6 (2026-09-10): Timeout split — berpikir 90 dtk, failover instan, unduh media 30 dtk.
- v0.5 (2026-09-10): Full-dinamis — vision gambar via model vision-capable, retry berdelay, nol template hardcoded.
- v0.4 (2026-09-10): P1 — order-parser + rekap harian + reminder in-memory + migrasi.
- v0.3 (2026-09-10): Migrasi ke asisten umum (system prompt general, sapaan netral).
- v0.2 (2026-09-10): P0 Telegram + chain 4 provider + quota/cache + skema DB + docs.
