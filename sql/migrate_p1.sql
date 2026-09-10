-- AgentKit P1 migration. Jalankan di Supabase SQL editor (Dashboard > SQL).
-- orders: hasil parse pesanan. reminders: persistensi fase P2 (scheduler P1 in-memory).

create table if not exists orders (
  id bigint generated always as identity primary key,
  chat_id text not null,
  customer text null,
  items jsonb not null default '[]'::jsonb,
  total numeric null,
  status text not null default 'baru',
  created_at timestamptz not null default now()
);
create index if not exists orders_day_idx on orders (created_at desc);

create table if not exists reminders (
  id bigint generated always as identity primary key,
  chat_id text not null,
  message text not null,
  scheduled_at timestamptz not null,
  sent boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists reminders_due_idx on reminders (scheduled_at) where (sent = false);
