-- ============================================================================
-- MIGRATION V18: Daily Token Usage Tracking per API Key (TPD Guard)
-- Workspace: FreeAIBot / AgentKit
-- Target Database: Supabase PostgreSQL
-- Alasan: Limit Groq Free Tier memiliki TPD (Tokens Per Day) 200K untuk
--         qwen3.8-27b & qwen3.6-27b — lebih cepat tercapai daripada RPD 1.000.
--         Tanpa pelacakan TPD, pool menabrak 429 tanpa peringatan dini.
-- ============================================================================

-- 1. Kolom token harian pada provider_quota
ALTER TABLE public.provider_quota ADD COLUMN IF NOT EXISTS tokens_used bigint NOT NULL DEFAULT 0;

-- 2. RPC atomik untuk increment token harian (aman multi-instance serverless)
CREATE OR REPLACE FUNCTION public.atomic_increment_provider_tokens(
    p_kind text,
    p_key_suffix text,
    p_day date,
    p_amount bigint
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_new_tokens bigint;
BEGIN
    INSERT INTO public.provider_quota (kind, key_suffix, day, used, tokens_used)
    VALUES (p_kind, p_key_suffix, p_day, 0, GREATEST(0, p_amount))
    ON CONFLICT (kind, key_suffix, day)
    DO UPDATE SET tokens_used = public.provider_quota.tokens_used + GREATEST(0, p_amount)
    RETURNING tokens_used INTO v_new_tokens;

    RETURN v_new_tokens;
END;
$$;

REVOKE ALL ON FUNCTION public.atomic_increment_provider_tokens(text, text, date, bigint) FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.atomic_increment_provider_tokens(text, text, date, bigint) TO service_role;

-- 3. Hardening RPC lama: kunci search_path (temuan audit keamanan)
CREATE OR REPLACE FUNCTION public.atomic_increment_provider_quota(
    p_kind text,
    p_key_suffix text,
    p_day date,
    p_amount int DEFAULT 1
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

-- 4. Catat migrasi
INSERT INTO public.schema_migrations (version, applied_at)
VALUES ('v18_daily_token_tracking', now())
ON CONFLICT (version) DO NOTHING;
