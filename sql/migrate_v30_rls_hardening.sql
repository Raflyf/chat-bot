-- ============================================================================
-- MIGRASI V30: RLS + REVOKE PADA TABEL YANG BELUM TERLINDUNGI
-- ============================================================================
--
-- LATAR BELAKANG (hasil verifikasi audit keamanan 06 Okt 2026):
--
-- Tabel inti (messages, summaries, corrections, provider_quota, reminders,
-- web_knowledge, whatsapp_sessions, admin_auth_config, riddle_memory,
-- provider_cooldown, messages_archive) SUDAH mengaktifkan RLS + REVOKE.
--
-- Tetapi tabel yang dibuat pada migrasi v22-v25 BELUM:
--   notes, todos, expenses, habits, habit_logs   (v22)
--   pending_confirmations                        (v23)
--   game_sessions                                (v24)
--   user_profiles                                (v25)
--
-- RISIKO: Supabase secara default memberi hak akses ke role `anon` dan
-- `authenticated` untuk tabel baru di skema `public`. Bila SUPABASE_ANON_KEY
-- (kunci publik yang memang dirancang untuk frontend) diketahui pihak lain,
-- mereka berpotensi MEMBACA data personal pengguna (catatan, tugas, keuangan,
-- kebiasaan, profil waktu) langsung lewat REST API Supabase.
--
-- CATATAN: kunci anon TIDAK ditemukan terekspos di frontend proyek ini
-- (sudah diperiksa public/ dan bundle). Jadi risikonya lebih rendah dari
-- yang terlihat — tetapi mengaktifkan RLS + REVOKE adalah praktik
-- pertahanan berlapis (defense-in-depth) yang WAJIB dilakukan.
--
-- CARA KERJA: aplikasi mengakses database HANYA lewat `service_role`
-- (SUPABASE_SERVICE_KEY di server). Role `service_role` MELEWATI RLS,
-- sehingga aplikasi tetap berfungsi normal setelah migrasi ini.
--
-- AMAN DIJALANKAN BERULANG (idempoten).
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. AKTIFKAN ROW LEVEL SECURITY
-- ----------------------------------------------------------------------------
-- Tanpa policy apa pun + RLS aktif = TIDAK ADA role non-service yang bisa
-- membaca/menulis. Ini yang kita inginkan (hanya service_role yang boleh).

ALTER TABLE IF EXISTS public.notes                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.todos                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.expenses              ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.habits                ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.habit_logs            ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.pending_confirmations ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.game_sessions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.user_profiles         ENABLE ROW LEVEL SECURITY;

-- Paksa RLS berlaku juga untuk PEMILIK tabel (mencegah bypass tak sengaja
-- bila suatu saat tabel dimiliki role lain).
ALTER TABLE IF EXISTS public.notes                 FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.todos                 FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.expenses              FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.habits                FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.habit_logs            FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.pending_confirmations FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.game_sessions         FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.user_profiles         FORCE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- 2. CABUT HAK AKSES dari role publik
-- ----------------------------------------------------------------------------
-- `anon`        = akses tanpa login (kunci publik)
-- `authenticated` = pengguna Supabase Auth (proyek ini tidak memakainya)
-- `PUBLIC`      = semua role

REVOKE ALL ON TABLE public.notes                 FROM anon, authenticated, PUBLIC;
REVOKE ALL ON TABLE public.todos                 FROM anon, authenticated, PUBLIC;
REVOKE ALL ON TABLE public.expenses              FROM anon, authenticated, PUBLIC;
REVOKE ALL ON TABLE public.habits                FROM anon, authenticated, PUBLIC;
REVOKE ALL ON TABLE public.habit_logs            FROM anon, authenticated, PUBLIC;
REVOKE ALL ON TABLE public.pending_confirmations FROM anon, authenticated, PUBLIC;
REVOKE ALL ON TABLE public.game_sessions         FROM anon, authenticated, PUBLIC;
REVOKE ALL ON TABLE public.user_profiles         FROM anon, authenticated, PUBLIC;

-- Cabut juga hak pada SEQUENCE (mencegah tebak ID via nextval).
DO $$
DECLARE
    seq_name text;
BEGIN
    FOR seq_name IN
        SELECT sequence_name FROM information_schema.sequences
        WHERE sequence_schema = 'public'
          AND sequence_name IN (
              'notes_id_seq', 'todos_id_seq', 'expenses_id_seq',
              'habits_id_seq', 'habit_logs_id_seq', 'pending_confirmations_id_seq',
              'game_sessions_id_seq', 'user_profiles_id_seq'
          )
    LOOP
        EXECUTE format('REVOKE ALL ON SEQUENCE public.%I FROM anon, authenticated, PUBLIC', seq_name);
    END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 3. PASTIKAN service_role TETAP PUNYA AKSES
-- ----------------------------------------------------------------------------
-- Aplikasi memakai SUPABASE_SERVICE_KEY (role service_role). Role ini
-- melewati RLS, tetapi hak GRANT tetap perlu dipastikan ada.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        GRANT ALL ON TABLE public.notes                 TO service_role;
        GRANT ALL ON TABLE public.todos                 TO service_role;
        GRANT ALL ON TABLE public.expenses              TO service_role;
        GRANT ALL ON TABLE public.habits                TO service_role;
        GRANT ALL ON TABLE public.habit_logs            TO service_role;
        GRANT ALL ON TABLE public.pending_confirmations TO service_role;
        GRANT ALL ON TABLE public.game_sessions         TO service_role;
        GRANT ALL ON TABLE public.user_profiles         TO service_role;
    END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 4. VERIFIKASI (tampilkan status akhir)
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    r record;
    jumlah_aman integer := 0;
BEGIN
    FOR r IN
        SELECT c.relname AS nama, c.relrowsecurity AS rls, c.relforcerowsecurity AS paksa
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind = 'r'
          AND c.relname IN (
              'notes','todos','expenses','habits','habit_logs',
              'pending_confirmations','game_sessions','user_profiles'
          )
        ORDER BY c.relname
    LOOP
        IF r.rls THEN jumlah_aman := jumlah_aman + 1; END IF;
        RAISE NOTICE 'Tabel %: RLS=% FORCE=%', r.nama, r.rls, r.paksa;
    END LOOP;
    RAISE NOTICE '--- % dari 8 tabel kini terlindungi RLS ---', jumlah_aman;
END $$;

COMMIT;

-- ============================================================================
-- SELESAI. Setelah ini:
--   - Dashboard/bot TETAP berfungsi normal (memakai service_role).
--   - Kunci publik (anon) TIDAK BISA lagi membaca tabel personal.
-- ============================================================================
