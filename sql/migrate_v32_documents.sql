-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRASI v32 — TABEL DOKUMEN (teks hasil ekstraksi PDF/Word agar bisa diaudit)
--
-- KENAPA (permintaan pemilik produk, 09 Okt 2026):
--   "apalah bot benar menjelaskan isi pdf nya? coba kamu cek isi pdf nya dan
--    bandingkan dengan bot apakah sudah sesuai" + "itu pdf yg dikirim user emg
--    ga masuk db?"
--
-- MASALAH: saat user mengirim dokumen (PDF/Word), isinya dibaca → dikirim ke AI
-- untuk dirangkum → lalu DIBUANG. Yang tersimpan di `messages` hanya nama file:
--   "[Dokumen: ESTATEMENT-7370524992-...pdf]"
-- Akibatnya:
--   1. Ringkasan bot TIDAK BISA diverifikasi (teks aslinya hilang).
--   2. Bot tidak bisa "mengingat" isi dokumen di percakapan berikutnya.
--   3. Bila bot salah membaca, tidak ada bukti untuk menelusuri.
--
-- TABEL INI menyimpan TEKS hasil ekstraksi + ringkasan bot, sehingga:
--   - pemilik bisa membandingkan ringkasan vs isi asli,
--   - isi dokumen bisa disuntikkan kembali ke konteks bila diperlukan.
--
-- Jalankan di Supabase SQL Editor. Aman dijalankan berulang (idempotent).
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.documents (
  id           bigserial primary key,
  chat_id      text        not null,
  platform     text        not null default 'whatsapp',
  filename     text        not null,
  mime         text,
  -- Teks hasil ekstraksi (PDF/DOCX/XLSX/CSV). Dipotong agar tidak membengkakkan DB.
  teks         text,
  -- Jumlah karakter teks ASLI sebelum dipotong (untuk tahu apakah terpotong).
  teks_panjang integer,
  -- Ringkasan/balasan bot atas dokumen itu (untuk membandingkan benar/salah).
  ringkasan    text,
  -- Model yang dipakai (mis. gemini-3.6-flash) agar bisa ditelusuri.
  via          text,
  created_at   timestamptz not null default now()
);

comment on table public.documents is
  'Teks hasil ekstraksi dokumen (PDF/Word/Excel) + ringkasan bot, agar bisa diaudit.';

create index if not exists idx_documents_chat
  on public.documents (chat_id, created_at desc);

-- RLS: hanya service role (sama seperti tabel lain).
alter table public.documents enable row level security;

drop policy if exists "Service Role Only documents" on public.documents;
create policy "Service Role Only documents"
  on public.documents for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

revoke all on table public.documents from anon;
revoke all on table public.documents from authenticated;
