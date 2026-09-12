-- ============================================================================
-- MIGRATION V17: Operational & Observability Hardening
-- Workspace: FreeAIBot / AgentKit
-- Target Database: Supabase PostgreSQL
-- Idempotent: aman dijalankan berulang kali (create if not exists / on conflict).
-- ============================================================================

-- 1. Ledger Migrasi: mencatat versi migrasi yang sudah diterapkan
create table if not exists public.schema_migrations (
    version text primary key,
    applied_at timestamptz not null default now()
);

-- 2. Row Level Security & Izin Ledger (pola sama dengan migrate_v16)
alter table public.schema_migrations enable row level security;

drop policy if exists "Service role full access schema_migrations" on public.schema_migrations;
create policy "Service role full access schema_migrations"
on public.schema_migrations
for all
to service_role
using (true)
with check (true);

revoke all on table public.schema_migrations from anon, authenticated, public;
grant all on table public.schema_migrations to service_role;

-- 3. Catat migrasi yang sudah diterapkan sebelumnya secara idempotent (termasuk v17)
insert into public.schema_migrations (version) values
    ('v08'),
    ('v09'),
    ('v10'),
    ('v12'),
    ('v13'),
    ('v14'),
    ('v15'),
    ('v16'),
    ('v17')
on conflict (version) do nothing;

-- 4. Indeks Retensi & Deduplikasi untuk Pemindaian Pesan Lama
create index if not exists idx_messages_created_at on public.messages (created_at);

-- 5. Kolom Instrumentasi Dataset pada Messages (nullable, non-breaking)
alter table public.messages add column if not exists latency_ms integer null;
alter table public.messages add column if not exists needs_search boolean null;
alter table public.messages add column if not exists split_count integer null;
alter table public.messages add column if not exists prompt_version text null;
alter table public.messages add column if not exists feedback text null;

-- 6. RTBF (Right To Be Forgotten): Hapus seluruh data pengguna berdasarkan chat_id
create or replace function public.rpc_purge_user_data(p_chat_id text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    v_deleted integer := 0;
begin
    delete from public.messages where chat_id = p_chat_id;
    get diagnostics v_deleted = row_count;

    delete from public.summaries where chat_id = p_chat_id;
    delete from public.corrections where chat_id = p_chat_id;
    delete from public.reminders where chat_id = p_chat_id;

    return v_deleted;
end;
$$;

revoke all on function public.rpc_purge_user_data(text) from anon, authenticated, public;
grant execute on function public.rpc_purge_user_data(text) to service_role;

-- 7. Retensi: Hapus entri web_knowledge yang sudah kadaluwarsa
create or replace function public.rpc_purge_expired_web_knowledge()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    v_deleted integer := 0;
begin
    delete from public.web_knowledge where expires_at < now();
    get diagnostics v_deleted = row_count;

    return v_deleted;
end;
$$;

revoke all on function public.rpc_purge_expired_web_knowledge() from anon, authenticated, public;
grant execute on function public.rpc_purge_expired_web_knowledge() to service_role;
