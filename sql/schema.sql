-- AgentKit P0 schema (Supabase / Postgres). Jalankan di SQL editor.
-- messages dipakai best-effort oleh bot; provider_quota opsional (tracker utama in-memory).

create table if not exists messages (
  id bigint generated always as identity primary key,
  platform text not null default 'telegram',
  chat_id text not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  via text null,
  created_at timestamptz not null default now()
);
create index if not exists messages_chat_idx on messages (chat_id, created_at desc);

create table if not exists provider_quota (
  id bigint generated always as identity primary key,
  kind text not null,
  key_suffix text not null,
  day date not null,
  used integer not null default 0,
  unique (kind, key_suffix, day)
);

alter table messages enable row level security;
alter table provider_quota enable row level security;
revoke all on table messages, provider_quota from anon, authenticated;
create policy "Service Role Only messages" on messages for all to service_role using (true) with check (true);
create policy "Service Role Only provider_quota" on provider_quota for all to service_role using (true) with check (true);

