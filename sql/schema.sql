-- AgentKit P0 schema (Supabase / Postgres). Jalankan di SQL editor.
-- messages dipakai best-effort oleh bot; provider_quota opsional (tracker utama in-memory).

create table if not exists messages (
  id bigint generated always as identity primary key,
  platform text not null default 'telegram' check (platform in ('telegram', 'whatsapp', 'web', 'api')),
  chat_id text not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  via text null,
  msg_id text null,
  processed_at timestamptz null,
  created_at timestamptz not null default now()
);
create index if not exists messages_chat_idx on messages (chat_id, created_at desc);
create unique index if not exists idx_messages_platform_msg_id on messages(platform, msg_id) where msg_id is not null;

create table if not exists reminders (
  id bigint generated always as identity primary key,
  chat_id text not null,
  message text not null,
  due_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'processing', 'sent', 'failed')),
  platform text not null default 'telegram',
  lease_until timestamptz null,
  created_at timestamptz not null default now()
);
create index if not exists idx_reminders_status_due_platform on reminders(status, due_at, platform);
create index if not exists idx_reminders_lease_until on reminders(status, lease_until);

create table if not exists provider_quota (
  id bigint generated always as identity primary key,
  kind text not null,
  key_suffix text not null,
  day date not null,
  used integer not null default 0,
  unique (kind, key_suffix, day)
);

alter table messages enable row level security;
alter table reminders enable row level security;
alter table provider_quota enable row level security;
revoke all on table messages, reminders, provider_quota from anon, authenticated;
create policy "Service Role Only messages" on messages for all to service_role using (true) with check (true);
create policy "Service Role Only reminders" on reminders for all to service_role using (true) with check (true);
create policy "Service Role Only provider_quota" on provider_quota for all to service_role using (true) with check (true);


