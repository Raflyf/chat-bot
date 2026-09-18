-- ============================================================================
-- MIGRATION V20: Audit Fixes Batch 2 — Admin PIN/OTP Hardening
-- Workspace: FreeAIBot / AgentKit
-- Target Database: Supabase PostgreSQL
-- ============================================================================

-- 1. Fail-closed pada rpc_admin_change_pin saat pin_hash IS NULL (audit F3).
-- Sebelumnya: IF v_row.pin_hash IS NOT NULL AND v_row.pin_hash != p_old_pin_hash THEN ...
-- artinya saat pin_hash NULL (state yang mungkin terjadi), blok gagal dilewati dan
-- penyerang bisa menetapkan PIN baru TANPA tahu PIN lama.
CREATE OR REPLACE FUNCTION public.rpc_admin_change_pin(
    p_old_pin_hash text,
    p_new_pin_hash text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_row public.admin_auth_config%ROWTYPE;
BEGIN
    SELECT * INTO v_row FROM public.admin_auth_config WHERE id = 'master_auth' FOR UPDATE;

    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Konfigurasi admin belum ada. Gunakan pemulihan OTP.');
    END IF;

    -- FAIL-CLOSED: sistem belum dikonfigurasi (pin_hash NULL) -> wajib lewat OTP.
    IF v_row.pin_hash IS NULL THEN
        RETURN json_build_object('success', false, 'message', 'PIN belum dikonfigurasi. Gunakan pemulihan OTP untuk mengatur PIN baru.');
    END IF;

    IF v_row.pin_hash != p_old_pin_hash THEN
        RETURN json_build_object('success', false, 'message', 'PIN saat ini tidak cocok.');
    END IF;

    UPDATE public.admin_auth_config
    SET pin_hash = p_new_pin_hash,
        lockout_attempts = 0,
        locked_until = NULL,
        session_token = NULL,
        session_expires_at = NULL,
        updated_at = now()
    WHERE id = 'master_auth';

    RETURN json_build_object('success', true, 'message', 'Master PIN berhasil diubah di seluruh sesi.');
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_admin_change_pin(text, text) FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.rpc_admin_change_pin(text, text) TO service_role;

-- 2. Counter percobaan OTP yang durable (audit F4/F15) — kolom baru.
ALTER TABLE public.admin_auth_config ADD COLUMN IF NOT EXISTS otp_attempts int NOT NULL DEFAULT 0;
ALTER TABLE public.admin_auth_config ADD COLUMN IF NOT EXISTS otp_locked_until timestamptz NULL;

-- 3. rpc_admin_verify_otp_and_reset_pin: tambah counter percobaan + lockout.
CREATE OR REPLACE FUNCTION public.rpc_admin_verify_otp_and_reset_pin(
    p_otp_hash text,
    p_new_pin_hash text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_row public.admin_auth_config%ROWTYPE;
    v_max_attempts constant int := 5;
BEGIN
    SELECT * INTO v_row FROM public.admin_auth_config WHERE id = 'master_auth' FOR UPDATE;

    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Konfigurasi admin belum ada.');
    END IF;

    -- Lockout percobaan OTP (durable, lintas instance serverless)
    IF v_row.otp_locked_until IS NOT NULL AND v_row.otp_locked_until > now() THEN
        RETURN json_build_object('success', false, 'message', 'Terlalu banyak percobaan OTP gagal. Minta kode baru atau tunggu 10 menit.');
    END IF;

    IF v_row.otp_code_hash IS NULL OR v_row.otp_expires_at IS NULL OR v_row.otp_expires_at < now() THEN
        RETURN json_build_object('success', false, 'message', 'Kode OTP tidak cocok atau telah kadaluwarsa.');
    END IF;

    IF v_row.otp_code_hash != p_otp_hash THEN
        -- Gagal: naikkan counter; setelah 5 gagal, kunci 10 menit dan hapus OTP.
        UPDATE public.admin_auth_config
        SET otp_attempts = v_row.otp_attempts + 1,
            otp_locked_until = CASE WHEN v_row.otp_attempts + 1 >= v_max_attempts THEN now() + interval '10 minutes' ELSE otp_locked_until END,
            otp_code_hash = CASE WHEN v_row.otp_attempts + 1 >= v_max_attempts THEN NULL ELSE otp_code_hash END,
            otp_expires_at = CASE WHEN v_row.otp_attempts + 1 >= v_max_attempts THEN NULL ELSE otp_expires_at END,
            updated_at = now()
        WHERE id = 'master_auth';
        RETURN json_build_object('success', false, 'message', 'Kode OTP tidak cocok atau telah kadaluwarsa.');
    END IF;

    -- Sukses: reset PIN + bersihkan OTP & counter & semua sesi.
    UPDATE public.admin_auth_config
    SET pin_hash = p_new_pin_hash,
        lockout_attempts = 0,
        locked_until = NULL,
        otp_code_hash = NULL,
        otp_expires_at = NULL,
        otp_attempts = 0,
        otp_locked_until = NULL,
        session_token = NULL,
        session_expires_at = NULL,
        updated_at = now()
    WHERE id = 'master_auth';

    RETURN json_build_object('success', true, 'message', 'Master PIN berhasil diperbarui dan status penguncian dinolkan.');
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_admin_verify_otp_and_reset_pin(text, text) FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.rpc_admin_verify_otp_and_reset_pin(text, text) TO service_role;

-- 4. Cabut grant default anon/authenticated pada admin_auth_config (audit F2).
REVOKE ALL ON TABLE public.admin_auth_config FROM anon, authenticated, public;
GRANT ALL ON TABLE public.admin_auth_config TO service_role;

-- 5. Catat migrasi (selaras ledger v17/v18). Guard: tabel ledger mungkin belum ada
-- bila migrasi ini dijalankan standalone di project baru.
CREATE TABLE IF NOT EXISTS public.schema_migrations (
    version text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.schema_migrations (version, applied_at)
VALUES ('v20_audit_fixes_batch2', now())
ON CONFLICT (version) DO NOTHING;
