-- AgentKit v0.9 Hardened Migration (Supabase / Postgres)
-- 1. Tabel reminders untuk pengingat persisten (Vercel Cron & Local Worker)
-- 2. Pengaktifan Row Level Security (RLS) pada SEMUA tabel untuk menutup celah kebocoran data anon

-- Tabel reminders
CREATE TABLE IF NOT EXISTS reminders (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  chat_id TEXT NOT NULL,
  message TEXT NOT NULL,
  due_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS reminders_due_idx ON reminders (status, due_at);

-- Pastikan tabel messages, summaries, corrections, provider_quota ada
CREATE TABLE IF NOT EXISTS messages (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  platform TEXT NOT NULL DEFAULT 'telegram',
  chat_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  via TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS messages_chat_idx ON messages (chat_id, created_at DESC);

CREATE TABLE IF NOT EXISTS summaries (
  chat_id TEXT PRIMARY KEY,
  summary TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS corrections (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  chat_id TEXT NOT NULL,
  correction TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS corrections_chat_idx ON corrections (chat_id, created_at DESC);

CREATE TABLE IF NOT EXISTS provider_quota (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind TEXT NOT NULL,
  key_suffix TEXT NOT NULL,
  day DATE NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  UNIQUE (kind, key_suffix, day)
);

-- ==============================================================================
-- PENGAKTIFAN ROW LEVEL SECURITY (RLS) - ZERO DATA EXPOSURE
-- ==============================================================================
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE corrections ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_quota ENABLE ROW LEVEL SECURITY;
ALTER TABLE reminders ENABLE ROW LEVEL SECURITY;

-- Cabut akses dari anon dan authenticated publik
REVOKE ALL ON TABLE messages, summaries, corrections, provider_quota, reminders FROM anon;
REVOKE ALL ON TABLE messages, summaries, corrections, provider_quota, reminders FROM authenticated;

-- Izinkan akses hanya untuk role internal service_role
DROP POLICY IF EXISTS "Service Role Only messages" ON messages;
CREATE POLICY "Service Role Only messages" ON messages FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service Role Only summaries" ON summaries;
CREATE POLICY "Service Role Only summaries" ON summaries FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service Role Only corrections" ON corrections;
CREATE POLICY "Service Role Only corrections" ON corrections FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service Role Only provider_quota" ON provider_quota;
CREATE POLICY "Service Role Only provider_quota" ON provider_quota FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service Role Only reminders" ON reminders;
CREATE POLICY "Service Role Only reminders" ON reminders FOR ALL TO service_role USING (true) WITH CHECK (true);
