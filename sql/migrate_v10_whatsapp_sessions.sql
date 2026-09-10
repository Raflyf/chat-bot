-- AgentKit WhatsApp Multi-Device Session Persistence
-- Tabel whatsapp_sessions untuk menyimpan file sesi Baileys agar tidak hilang saat container restart di platform hosting 24/7 (Render/Koyeb/VPS)

CREATE TABLE IF NOT EXISTS whatsapp_sessions (
  filename TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Pengaktifan Row Level Security (RLS) - Fail Closed
ALTER TABLE whatsapp_sessions ENABLE ROW LEVEL SECURITY;

-- Cabut akses dari anon dan authenticated publik
REVOKE ALL ON whatsapp_sessions FROM anon, authenticated;

-- Berikan akses penuh HANYA kepada service_role
GRANT ALL ON whatsapp_sessions TO service_role;

-- Kebijakan RLS service_role
DROP POLICY IF EXISTS "service_role_all_whatsapp_sessions" ON whatsapp_sessions;
CREATE POLICY "service_role_all_whatsapp_sessions"
  ON whatsapp_sessions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
