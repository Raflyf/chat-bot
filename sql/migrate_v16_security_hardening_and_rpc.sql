-- ============================================================================
-- MIGRATION V16: Security Hardening, RPC Permissions Revocation, & Core Schema Fixes
-- Workspace: FreeAIBot / AgentKit
-- Target Database: Supabase PostgreSQL
-- ============================================================================

-- 1. Cabut Izin Terbuka (anon) pada RPC Admin (Temuan Critical C2 / P0-2)
-- Mencegah penyerang luar mengeksekusi brute-force PIN atau membajak PIN master via API publik
REVOKE ALL ON FUNCTION public.rpc_admin_verify_pin(text) FROM anon, authenticated, public;
REVOKE ALL ON FUNCTION public.rpc_admin_save_otp(text, timestamptz) FROM anon, authenticated, public;
REVOKE ALL ON FUNCTION public.rpc_admin_verify_otp_and_reset_pin(text, text) FROM anon, authenticated, public;

GRANT EXECUTE ON FUNCTION public.rpc_admin_verify_pin(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.rpc_admin_save_otp(text, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.rpc_admin_verify_otp_and_reset_pin(text, text) TO service_role;

-- 2. Definisikan RPC increment_knowledge_hit yang Hilang (Temuan Critical C-Missing / P1-5)
CREATE OR REPLACE FUNCTION public.increment_knowledge_hit(p_key text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE public.web_knowledge
    SET hit_count = hit_count + 1,
        updated_at = now()
    WHERE entity_key = p_key;
END;
$$;

REVOKE ALL ON FUNCTION public.increment_knowledge_hit(text) FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.increment_knowledge_hit(text) TO service_role;

-- 3. Atomic Provider Quota Increment (Temuan Critical C5 / P1-4)
-- Mencegah lost updates saat beberapa instance serverless berjalan paralel
CREATE OR REPLACE FUNCTION public.atomic_increment_provider_quota(
    p_kind text,
    p_key_suffix text,
    p_day date,
    p_amount int DEFAULT 1
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_new_used int;
BEGIN
    INSERT INTO public.provider_quota (kind, key_suffix, day, used)
    VALUES (p_kind, p_key_suffix, p_day, GREATEST(1, p_amount))
    ON CONFLICT (kind, key_suffix, day)
    DO UPDATE SET used = public.provider_quota.used + GREATEST(1, p_amount)
    RETURNING used INTO v_new_used;
    
    RETURN v_new_used;
END;
$$;

REVOKE ALL ON FUNCTION public.atomic_increment_provider_quota(text, text, date, int) FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.atomic_increment_provider_quota(text, text, date, int) TO service_role;

-- 4. Tambahkan Kolom Platform & Atomic Claim pada Reminders (Temuan High Fase 4 / P1-6)
ALTER TABLE public.reminders ADD COLUMN IF NOT EXISTS platform text DEFAULT 'telegram';
CREATE INDEX IF NOT EXISTS idx_reminders_status_due_platform ON public.reminders(status, due_at, platform);

-- 5. Perkuat RLS pada web_knowledge (Temuan High Fase 4.3)
ALTER TABLE public.web_knowledge ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access web_knowledge" ON public.web_knowledge;
CREATE POLICY "Service role full access web_knowledge"
ON public.web_knowledge
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- 6. Dukungan Trigram untuk Pencarian Prefiks/Pola entitas web_knowledge
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_web_knowledge_entity_key_trgm ON public.web_knowledge USING gin (entity_key gin_trgm_ops);
