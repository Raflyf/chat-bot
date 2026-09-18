-- ============================================================================
-- MIGRATION V19: Audit Fixes — Unique Index ON CONFLICT Compat, Purge Index
-- Workspace: FreeAIBot / AgentKit
-- Target Database: Supabase PostgreSQL
-- ============================================================================

-- 1. Ganti partial unique index messages(platform,msg_id) menjadi unique index penuh.
-- Alasan: PostgREST `upsert(..., { onConflict: 'platform,msg_id' })` membutuhkan
-- unique index/constraint NON-partial agar inferensi ON CONFLICT berhasil. Partial
-- index (WHERE msg_id IS NOT NULL) membuat upsert gagal senyap ("no unique or
-- exclusion constraint matching the ON CONFLICT specification") sehingga pesan
-- asisten dengan msg_id tidak pernah tersimpan.
-- Catatan: unique index penuh tetap aman untuk banyak NULL karena NULL tidak
-- pernah dianggap sama (distinct) di PostgreSQL.
DROP INDEX IF EXISTS public.idx_messages_platform_msg_id;
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_platform_msg_id
  ON public.messages(platform, msg_id);

-- 2. Index standalone expires_at untuk purge retensi web_knowledge.
-- Query retensi: `DELETE FROM web_knowledge WHERE expires_at < now()` — index
-- komposit (entity_key, expires_at) tidak bisa dipakai (leading column salah)
-- sehingga terjadi sequential scan setiap kali purge berjalan.
CREATE INDEX IF NOT EXISTS idx_web_knowledge_expires_at
  ON public.web_knowledge(expires_at);

-- 3. Index chat_id untuk reminders (lookup per-chat di worker & API).
CREATE INDEX IF NOT EXISTS idx_reminders_chat_id
  ON public.reminders(chat_id);
