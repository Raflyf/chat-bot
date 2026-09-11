-- Migration v14: Persistent Web Knowledge Base with Dynamic TTL
-- Menyimpan intisari fakta dan informasi hasil penelusuran web secara persisten
-- untuk mempercepat respon (0ms - 30ms) dan menghemat kuota scraping internet
-- tanpa risiko data basi (stale data) berkat validasi expires_at per kategori.

CREATE TABLE IF NOT EXISTS web_knowledge (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity_key TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL CHECK (category IN ('realtime', 'news', 'tech_release', 'static_fact')),
  query_sample TEXT NOT NULL,
  knowledge TEXT NOT NULL,
  source_urls TEXT[] NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  hit_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indeks unik untuk penulisan upsert cepat berbasis entity_key
CREATE UNIQUE INDEX IF NOT EXISTS idx_web_knowledge_entity_key ON web_knowledge (entity_key);

-- Indeks komposit untuk pencarian instan validitas data yang belum expired
CREATE INDEX IF NOT EXISTS idx_web_knowledge_lookup ON web_knowledge (entity_key, expires_at);

-- ==============================================================================
-- PENGAKTIFAN ROW LEVEL SECURITY (RLS) - ZERO DATA EXPOSURE
-- ==============================================================================
ALTER TABLE web_knowledge ENABLE ROW LEVEL SECURITY;

-- Cabut akses dari anon dan authenticated publik
REVOKE ALL ON web_knowledge FROM anon, authenticated;

-- Berikan akses penuh hanya untuk service_role (backend serverless / worker)
GRANT ALL ON web_knowledge TO service_role;
