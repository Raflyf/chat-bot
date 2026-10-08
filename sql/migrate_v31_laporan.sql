-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRASI v31 — TABEL LAPORAN/KELUHAN + STORAGE BUCKET LAMPIRAN
--
-- KENAPA (permintaan pemilik produk, 08 Okt 2026):
--   "tambahkan untuk keluhan dengan fungsi menambahkan file ss an percakapan
--    dengan bot yg ngaco, atau paste percakapan dengan bot dan lainnya seperti
--    itu, simpan di paling bawah halaman saja".
--
-- Jalankan di Supabase SQL Editor. Aman dijalankan berulang (idempotent).
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Tabel laporan
create table if not exists public.laporan (
  id            bigserial primary key,
  pesan         text        not null,
  kontak        text,
  platform      text,
  halaman       text,
  lampiran_path text,
  ip_hash       text,
  status        text        not null default 'baru',
  created_at    timestamptz not null default now()
);

comment on table public.laporan is
  'Laporan/keluhan pengguna dari landing page (teks + lampiran tangkapan layar).';

create index if not exists idx_laporan_created on public.laporan (created_at desc);
create index if not exists idx_laporan_status  on public.laporan (status);

-- 2. Row Level Security: hanya service_role yang boleh mengakses.
alter table public.laporan enable row level security;

-- Cabut akses publik (anon & authenticated), sisakan service_role.
revoke all on public.laporan from anon, authenticated;
grant all on public.laporan to service_role;

-- Sequence juga perlu akses untuk insert via service_role.
do $$
begin
  if exists (select 1 from pg_class where relname = 'laporan_id_seq') then
    revoke all on sequence public.laporan_id_seq from anon, authenticated;
    grant all on sequence public.laporan_id_seq to service_role;
  end if;
end $$;

-- 3. Storage bucket untuk lampiran (privat).
insert into storage.buckets (id, name, public)
values ('laporan', 'laporan', false)
on conflict (id) do nothing;

-- 4. Kebijakan storage: hanya service_role (akses lewat API server, bukan klien).
--    Bucket privat: berkas TIDAK bisa diakses publik tanpa signed URL.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'laporan_service_only'
  ) then
    create policy "laporan_service_only" on storage.objects
      for all
      to service_role
      using (bucket_id = 'laporan')
      with check (bucket_id = 'laporan');
  end if;
end $$;

-- Selesai. Verifikasi:
--   select count(*) from public.laporan;
--   select id, public from storage.buckets where id = 'laporan';
