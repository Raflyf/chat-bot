-- ============================================================================
-- MIGRATION V16: Security Hardening, RPC Permissions Revocation, & Core Schema Fixes
-- Workspace: FreeAIBot / AgentKit
-- Target Database: Supabase PostgreSQL
-- ============================================================================

-- 1. Cabut Izin Terbuka (anon) pada RPC Admin secara Order-Independent (Temuan C2 & C8)
-- Mencegah penyerang luar mengeksekusi brute-force PIN atau membajak PIN master via API publik
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'rpc_admin_verify_pin') THEN
        EXECUTE 'REVOKE ALL ON FUNCTION public.rpc_admin_verify_pin(text) FROM anon, authenticated, public';
        EXECUTE 'GRANT EXECUTE ON FUNCTION public.rpc_admin_verify_pin(text) TO service_role';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'rpc_admin_save_otp') THEN
        EXECUTE 'REVOKE ALL ON FUNCTION public.rpc_admin_save_otp(text, timestamptz) FROM anon, authenticated, public';
        EXECUTE 'GRANT EXECUTE ON FUNCTION public.rpc_admin_save_otp(text, timestamptz) TO service_role';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'rpc_admin_verify_otp_and_reset_pin') THEN
        EXECUTE 'REVOKE ALL ON FUNCTION public.rpc_admin_verify_otp_and_reset_pin(text, text) FROM anon, authenticated, public';
        EXECUTE 'GRANT EXECUTE ON FUNCTION public.rpc_admin_verify_otp_and_reset_pin(text, text) TO service_role';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'rpc_admin_change_pin') THEN
        EXECUTE 'REVOKE ALL ON FUNCTION public.rpc_admin_change_pin(text, text) FROM anon, authenticated, public';
        EXECUTE 'GRANT EXECUTE ON FUNCTION public.rpc_admin_change_pin(text, text) TO service_role';
    END IF;
END $$;

-- 2. Definisikan RPC increment_knowledge_hit (Dukung p_entity_key dan p_key) (Temuan Critical C-Missing / P1-5)
CREATE OR REPLACE FUNCTION public.increment_knowledge_hit(p_entity_key text DEFAULT NULL, p_key text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_target text := COALESCE(p_entity_key, p_key);
BEGIN
    IF v_target IS NOT NULL THEN
        UPDATE public.web_knowledge
        SET hit_count = hit_count + 1,
            updated_at = now()
        WHERE entity_key = v_target;
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.increment_knowledge_hit(text, text) FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.increment_knowledge_hit(text, text) TO service_role;

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

-- 4. Tambahkan Kolom Platform, CHECK Constraint & Atomic Claim pada Reminders (Temuan High Fase 4 / P1-6 & Regresi #1)
ALTER TABLE public.reminders ADD COLUMN IF NOT EXISTS platform text DEFAULT 'telegram';
ALTER TABLE public.reminders DROP CONSTRAINT IF EXISTS reminders_status_check;
ALTER TABLE public.reminders ADD CONSTRAINT reminders_status_check CHECK (status IN ('pending', 'processing', 'sent', 'failed'));
CREATE INDEX IF NOT EXISTS idx_reminders_status_due_platform ON public.reminders(status, due_at, platform);

-- 5. CHECK Constraint Platform pada Messages & Kolom msg_id untuk Deduplikasi Persisten (Regresi #8 & P1-8)
ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_platform_check;
ALTER TABLE public.messages ADD CONSTRAINT messages_platform_check CHECK (platform IN ('telegram', 'whatsapp', 'web', 'api'));
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS msg_id text NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_platform_msg_id ON public.messages(platform, msg_id) WHERE msg_id IS NOT NULL;

-- 6. Perkuat RLS pada web_knowledge (Temuan High Fase 4.3)
ALTER TABLE public.web_knowledge ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access web_knowledge" ON public.web_knowledge;
CREATE POLICY "Service role full access web_knowledge"
ON public.web_knowledge
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- 7. Dukungan Trigram untuk Pencarian Prefiks/Pola entitas web_knowledge
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_web_knowledge_entity_key_trgm ON public.web_knowledge USING gin (entity_key gin_trgm_ops);

-- 8. Bersihkan Default Hash PIN 080402 dari Database (Temuan C1 & Catatan Keselamatan E7)
-- JANGAN DELETE baris master_auth agar fungsi pemulihan/reset OTP dan provisioning tetap berfungsi!
INSERT INTO public.admin_auth_config (id, pin_hash, lockout_attempts, locked_until, updated_at)
VALUES ('master_auth', NULL, 0, NULL, now())
ON CONFLICT (id) DO UPDATE
SET pin_hash = CASE 
        WHEN public.admin_auth_config.pin_hash IN (
            '5d41402abc4b2a76b9719d911017c592',
            'bf4817a3a93c72957b44d3fa54e58849b294e094ed1be63a41b55979adcf705d',
            'db533e5fe9b399627eb386c19c967aa171dbc121a43fda2fa583c0a731aba78c'
        ) THEN NULL 
        ELSE public.admin_auth_config.pin_hash 
    END,
    lockout_attempts = 0,
    locked_until = NULL,
    updated_at = now();
