-- ============================================================================
-- MIGRATION V12: Admin Authentication & Master PIN Recovery Engine
-- Workspace: FreeAIBot Monitoring Console
-- Target Database: Supabase PostgreSQL
-- ============================================================================

-- 1. Tabel Konfigurasi Autentikasi Admin
CREATE TABLE IF NOT EXISTS public.admin_auth_config (
    id text PRIMARY KEY DEFAULT 'master_auth',
    pin_hash text NULL,
    lockout_attempts int DEFAULT 0,
    locked_until timestamptz NULL,
    otp_code_hash text NULL,
    otp_expires_at timestamptz NULL,
    session_token text NULL,
    session_expires_at timestamptz NULL,
    updated_at timestamptz DEFAULT now()
);

-- Pastikan kolom pin_hash mengizinkan NULL jika tabel dibuat oleh migrasi sebelumnya
ALTER TABLE public.admin_auth_config ALTER COLUMN pin_hash DROP NOT NULL;

-- 2. Master PIN Default Configuration
-- CATATAN KEAMANAN: Jangan menanam hardcoded hash PIN di migrasi publik.
-- PIN harus dikonfigurasi melalui environment variable ADMIN_PIN atau diatur via first-run provisioning.

-- 3. Row Level Security (RLS)
ALTER TABLE public.admin_auth_config ENABLE ROW LEVEL SECURITY;

-- Cabut akses baca langsung dari anon/public untuk mencegah kebocoran hash PIN & OTP
DROP POLICY IF EXISTS "Service role full access admin_auth_config" ON public.admin_auth_config;
CREATE POLICY "Service role full access admin_auth_config"
ON public.admin_auth_config
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- 4. RPC SECURITY DEFINER: Verifikasi Master PIN
CREATE OR REPLACE FUNCTION public.rpc_admin_verify_pin(p_pin_hash text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_row record;
    v_new_attempts int;
    v_locked_until timestamptz;
BEGIN
    SELECT * INTO v_row FROM public.admin_auth_config WHERE id = 'master_auth' FOR UPDATE;

    IF v_row IS NULL THEN
        RETURN json_build_object(
            'success', false,
            'verified', false,
            'is_locked', false,
            'message', 'Konfigurasi autentikasi belum tersedia.'
        );
    END IF;

    -- JIKA PIN COCOK: Izinkan masuk, reset status gagal
    IF v_row.pin_hash = p_pin_hash THEN
        UPDATE public.admin_auth_config
        SET lockout_attempts = 0, locked_until = NULL, updated_at = now()
        WHERE id = 'master_auth';

        RETURN json_build_object(
            'success', true,
            'verified', true,
            'message', 'Verifikasi Master PIN berhasil.'
        );
    END IF;

    -- JIKA PIN SALAH DAN SEDANG TERKUNCI
    IF v_row.locked_until IS NOT NULL AND v_row.locked_until > now() THEN
        RETURN json_build_object(
            'success', false,
            'verified', false,
            'is_locked', true,
            'locked_until', v_row.locked_until,
            'message', 'Akses terkunci sementara karena melebihi batas percobaan PIN. Gunakan pemulihan OTP.'
        );
    END IF;

    -- JIKA PIN SALAH DAN BELUM TERKUNCI: Hitung percobaan
    v_new_attempts := COALESCE(v_row.lockout_attempts, 0) + 1;
    IF v_new_attempts >= 5 THEN
        v_locked_until := now() + interval '15 minutes';
    ELSE
        v_locked_until := NULL;
    END IF;

    UPDATE public.admin_auth_config
    SET lockout_attempts = v_new_attempts, locked_until = v_locked_until, updated_at = now()
    WHERE id = 'master_auth';

    RETURN json_build_object(
        'success', false,
        'verified', false,
        'is_locked', (v_locked_until IS NOT NULL),
        'lockout_attempts', v_new_attempts,
        'remaining_attempts', GREATEST(0, 5 - v_new_attempts),
        'locked_until', v_locked_until,
        'message', CASE 
            WHEN v_locked_until IS NOT NULL THEN 'Batas 5 kali percobaan PIN terlampaui. Sistem dikunci 15 menit. Silakan tunggu atau gunakan pemulihan OTP.'
            ELSE 'Master PIN salah. Sisa percobaan: ' || (5 - v_new_attempts) || ' kali.'
        END
    );
END;
$$;

-- 5. RPC SECURITY DEFINER: Simpan Hash OTP
CREATE OR REPLACE FUNCTION public.rpc_admin_save_otp(p_otp_hash text, p_expires_at timestamptz)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE public.admin_auth_config
    SET otp_code_hash = p_otp_hash,
        otp_expires_at = p_expires_at,
        updated_at = now()
    WHERE id = 'master_auth';

    IF FOUND THEN
        RETURN json_build_object('success', true, 'message', 'Kode OTP berhasil disimpan.');
    ELSE
        RETURN json_build_object('success', false, 'message', 'Record admin_auth_config tidak ditemukan.');
    END IF;
END;
$$;

-- 6. RPC SECURITY DEFINER: Verifikasi OTP & Reset PIN
CREATE OR REPLACE FUNCTION public.rpc_admin_verify_otp_and_reset_pin(p_otp_hash text, p_new_pin_hash text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_row record;
BEGIN
    SELECT * INTO v_row FROM public.admin_auth_config WHERE id = 'master_auth' FOR UPDATE;

    IF v_row IS NULL THEN
        RETURN json_build_object('success', false, 'message', 'Record admin_auth_config tidak ditemukan.');
    END IF;

    -- Validasi apakah ada OTP aktif dan belum expired
    IF v_row.otp_code_hash IS NULL OR v_row.otp_expires_at IS NULL THEN
        RETURN json_build_object('success', false, 'message', 'Tidak ada permintaan OTP aktif. Silakan minta kode OTP baru.');
    END IF;

    IF v_row.otp_expires_at < now() THEN
        RETURN json_build_object('success', false, 'message', 'Kode OTP telah kadaluwarsa. Silakan minta kode OTP baru.');
    END IF;

    -- Validasi kecocokan hash OTP
    IF v_row.otp_code_hash != p_otp_hash THEN
        RETURN json_build_object('success', false, 'message', 'Kode OTP tidak cocok.');
    END IF;

    -- Reset PIN baru & bersihkan lockout
    UPDATE public.admin_auth_config
    SET pin_hash = p_new_pin_hash,
        lockout_attempts = 0,
        locked_until = NULL,
        otp_code_hash = NULL,
        otp_expires_at = NULL,
        session_token = NULL,
        session_expires_at = NULL,
        updated_at = now()
    WHERE id = 'master_auth';

    RETURN json_build_object(
        'success', true,
        'message', 'Master PIN keamanan berhasil diperbarui dan status penguncian dinolkan.'
    );
END;
$$;

-- 7. RPC SECURITY DEFINER: Ubah Master PIN secara Atomik (C6 & F4)
CREATE OR REPLACE FUNCTION public.rpc_admin_change_pin(p_old_pin_hash text, p_new_pin_hash text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_row record;
    v_new_attempts int;
    v_locked_until timestamptz;
BEGIN
    SELECT * INTO v_row FROM public.admin_auth_config WHERE id = 'master_auth' FOR UPDATE;

    IF v_row IS NULL THEN
        RETURN json_build_object('success', false, 'message', 'Konfigurasi autentikasi belum tersedia.');
    END IF;

    -- Cek lockout aktif
    IF v_row.locked_until IS NOT NULL AND v_row.locked_until > now() THEN
        RETURN json_build_object('success', false, 'message', 'Akses terkunci sementara karena melebihi batas percobaan PIN. Gunakan pemulihan OTP.');
    END IF;

    -- Cek apakah PIN lama cocok
    IF v_row.pin_hash IS NOT NULL AND v_row.pin_hash != p_old_pin_hash THEN
        v_new_attempts := COALESCE(v_row.lockout_attempts, 0) + 1;
        IF v_new_attempts >= 5 THEN
            v_locked_until := now() + interval '15 minutes';
        ELSE
            v_locked_until := NULL;
        END IF;

        UPDATE public.admin_auth_config
        SET lockout_attempts = v_new_attempts, locked_until = v_locked_until, updated_at = now()
        WHERE id = 'master_auth';

        RETURN json_build_object(
            'success', false,
            'message', CASE 
                WHEN v_locked_until IS NOT NULL THEN 'Batas 5 kali percobaan PIN terlampaui. Sistem dikunci 15 menit. Silakan gunakan pemulihan OTP.'
                ELSE 'Master PIN saat ini tidak cocok. Sisa percobaan: ' || (5 - v_new_attempts) || ' kali.'
            END
        );
    END IF;

    -- PIN lama cocok: update pin baru & reset lockout + invalidasi token sesi
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

-- Hak akses eksekusi RPC: Cabut dari PUBLIC/anon/authenticated, HANYA untuk backend service_role (C2, C8 & P0-2)
REVOKE ALL ON FUNCTION public.rpc_admin_verify_pin(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rpc_admin_save_otp(text, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rpc_admin_verify_otp_and_reset_pin(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rpc_admin_change_pin(text, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.rpc_admin_verify_pin(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.rpc_admin_save_otp(text, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.rpc_admin_verify_otp_and_reset_pin(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.rpc_admin_change_pin(text, text) TO service_role;
