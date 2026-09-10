-- AgentKit v08 migration. Jalankan di Supabase SQL editor (Dashboard > SQL).
-- summaries: memori ringkas per chat. corrections: koreksi user yang diingat bot.

create table if not exists summaries (
  chat_id text primary key,
  summary text not null,
  updated_at timestamptz not null default now()
);

create table if not exists corrections (
  id bigint generated always as identity primary key,
  chat_id text not null,
  correction text not null,
  created_at timestamptz not null default now()
);
create index if not exists corrections_chat_idx on corrections (chat_id, created_at desc);
