-- ============================================================================
-- MIGRASI V33: SECURITY HARDENING (hasil audit menyeluruh 14 Okt 2026)
-- ============================================================================
--
-- MASALAH YANG DIPERBAIKI
-- ----------------------
-- 1. RPC v21-v28 dibuat SECURITY DEFINER TANPA `REVOKE ... FROM PUBLIC`.
--    Supabase memberi hak EXECUTE ke PUBLIC secara default, sehingga 14 fungsi
--    internal (baca data user, tulis state game, set cooldown, ARSIPKAN pesan)
--    dapat dipanggil siapa pun yang memegang SUPABASE_ANON_KEY (kunci publik,
--    ikut ter-bundle di klien). Bandingkan v12/v16/v17/v18/v20 yang SEMUA
--    sudah meng-REVOKE.
-- 2. `increment_knowledge_hit` (v16) & `increment_riddle_use` (v21) adalah
--    SECURITY DEFINER tanpa `SET search_path` -> rentan search_path hijacking
--    (privilege escalation bila penyerang bisa membuat objek di skema lebih
--    awal pada search_path).
-- 3. `arsipkan_pesan_lama(p_hari)` tanpa validasi: p_hari <= 0 membuat batas
--    `now() - interval negatif` = MASA DEPAN -> SEMUA pesan terarsip/terhapus.
-- 4. `rpc_purge_user_data` (RTBF, v17) belum menghapus 10+ tabel ber-chat_id.
-- 5. v30 memakai `REVOKE`/`GRANT` TANPA guard `IF EXISTS` di dalam satu
--    transaksi, padahal `ALTER TABLE IF EXISTS`-nya dijaga. Bila v29 sudah
--    menghapus `pending_confirmations` (saat tabel kosong), SELURUH v30
--    rollback -> RLS 8 tabel tidak pernah terpasang.
--
-- SIFAT: idempoten (aman dijalankan berulang). Setiap bagian dibungkus guard
--        sendiri supaya kegagalan satu bagian tidak menggagalkan bagian lain.
-- URUTAN: jalankan SETELAH v32. Tidak menghapus data apa pun.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. KUNCI SEMUA RPC v21-v28 (REVOKE dari PUBLIC/anon/authenticated)
-- ----------------------------------------------------------------------------
-- Dipakai DO + EXECUTE supaya tetap aman bila fungsi belum ada (migrasi
-- parsial). Tanda tangan argumen HARUS persis sama dengan definisi aslinya.
DO $$
DECLARE
    fn text;
    daftar text[] := ARRAY[
        -- Tanda tangan di bawah diverifikasi PERSIS dari definisi aslinya
        -- (audit 14 Okt 2026). Salah satu karakter saja -> REVOKE dilewati diam-diam.
        'public.increment_riddle_use(text)',
        'public.sum_expenses(text, timestamptz, timestamptz)',
        'public.set_pending_confirmation(text, text, text, jsonb)',
        'public.take_pending_confirmation(text)',
        'public.clear_pending_confirmation(text)',
        'public.set_game_state(text, text, text, jsonb, text)',
        'public.get_game_state(text)',
        'public.end_game(text)',
        'public.set_user_timezone(text, text, text, text, text, text, boolean)',
        'public.get_user_timezone(text)',
        'public.set_provider_cooldown(text, text, text, timestamptz, text)',
        'public.get_provider_cooldowns()',
        'public.bersihkan_cooldown_kadaluarsa()',
        'public.arsipkan_pesan_lama(integer)'
    ];
BEGIN
    FOREACH fn IN ARRAY daftar LOOP
        BEGIN
            EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
            RAISE NOTICE 'REVOKE ok: %', fn;
        EXCEPTION
            WHEN undefined_function THEN
                RAISE NOTICE 'lewati (fungsi belum ada): %', fn;
            WHEN undefined_object THEN
                RAISE NOTICE 'lewati (role belum ada): %', fn;
        END;
    END LOOP;
END $$;

-- Cadangan: kunci SEMUA fungsi SECURITY DEFINER di skema public yang masih
-- terbuka untuk PUBLIC. Ini menangkap RPC yang tanda tangannya berbeda dari
-- daftar di atas (mis. versi lama dengan argumen lain).
DO $$
DECLARE
    r record;
BEGIN
    FOR r IN
        SELECT p.oid::regprocedure AS sig
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.prosecdef = true                    -- SECURITY DEFINER
          AND has_function_privilege('public', p.oid, 'EXECUTE')
    LOOP
        BEGIN
            EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
            RAISE NOTICE 'REVOKE (sweep) ok: %', r.sig;
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'REVOKE (sweep) gagal: % -> %', r.sig, SQLERRM;
        END;
    END LOOP;
END $$;

-- Pastikan service_role TETAP bisa memanggil (bot memakai service key).
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        EXECUTE 'GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role';
        RAISE NOTICE 'GRANT EXECUTE ALL FUNCTIONS -> service_role: ok';
    END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 2. TAMBAH `SET search_path = public` PADA RPC SECURITY DEFINER YANG BELUM
-- ----------------------------------------------------------------------------
-- Definisi ditulis ulang PERSIS sama + SET search_path, dan nama tabel
-- dikualifikasi penuh (public.*) sebagai pertahanan berlapis.
CREATE OR REPLACE FUNCTION public.increment_knowledge_hit(
    p_entity_key text DEFAULT NULL,
    p_key text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

CREATE OR REPLACE FUNCTION public.increment_riddle_use(p_answer_norm TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE public.riddle_memory
    SET times_used = times_used + 1,
        last_used_at = NOW(),
        updated_at = NOW()
    WHERE answer_norm = p_answer_norm;
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. VALIDASI INPUT `arsipkan_pesan_lama`
-- ----------------------------------------------------------------------------
-- Sebelumnya p_hari <= 0 -> batas = now() - interval negatif = MASA DEPAN ->
-- SELURUH tabel `messages` terarsip. Sekarang ditolak dengan pesan jelas.
CREATE OR REPLACE FUNCTION public.arsipkan_pesan_lama(p_hari integer DEFAULT 90)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    batas timestamptz;
    n integer := 0;
    v_hari integer := COALESCE(p_hari, 90);
BEGIN
    -- GUARD (audit 14 Okt 2026): tolak nilai tidak masuk akal.
    -- Batas bawah 1 hari: mencegah `interval negatif` / arsip massal tak sengaja.
    -- Batas atas 3650 hari (10 tahun): mencegah salah ketik yang menghapus
    -- seluruh riwayat sekaligus.
    IF v_hari < 1 THEN
        RAISE EXCEPTION 'arsipkan_pesan_lama: p_hari harus >= 1 (diterima %)', v_hari;
    END IF;
    IF v_hari > 3650 THEN
        RAISE EXCEPTION 'arsipkan_pesan_lama: p_hari terlalu besar, maksimum 3650 (diterima %)', v_hari;
    END IF;

    batas := now() - make_interval(days => v_hari);

    WITH dipindah AS (
        DELETE FROM public.messages
        WHERE created_at < batas
        RETURNING *
    )
    INSERT INTO public.messages_archive
    SELECT * FROM dipindah;

    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN n;
END;
$$;

-- Kunci ulang fungsi yang baru ditulis (CREATE OR REPLACE mengembalikan hak
-- default PUBLIC bila signature berubah).
DO $$
DECLARE
    fn text;
BEGIN
    FOREACH fn IN ARRAY ARRAY[
        'public.increment_knowledge_hit(text, text)',
        'public.increment_knowledge_hit(text)',
        'public.increment_riddle_use(text)',
        'public.arsipkan_pesan_lama(integer)'
    ] LOOP
        BEGIN
            EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
        EXCEPTION WHEN undefined_function THEN NULL;
        END;
    END LOOP;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        EXECUTE 'GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role';
    END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 4. LENGKAPI `rpc_purge_user_data` (RTBF) — hapus SEMUA tabel ber-chat_id
-- ----------------------------------------------------------------------------
-- Definisi lama (v17) hanya menyentuh sebagian tabel. Daftar di bawah adalah
-- hasil pemindaian seluruh `sql/` untuk kolom `chat_id`.
-- Dibungkus guard: tabel yang belum ada dilewati (migrasi parsial tetap jalan).
CREATE OR REPLACE FUNCTION public.rpc_purge_user_data(p_chat_id text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_id text := COALESCE(p_chat_id, '');
    v_id_wa text := CASE WHEN v_id <> '' AND v_id NOT LIKE 'wa\_%' THEN 'wa_' || v_id ELSE v_id END;
    v_id_telanjang text := regexp_replace(v_id, '^(wa_|tg_)', '');
    v_total integer := 0;
    v_n integer;
    t text;
    daftar text[] := ARRAY[
        'messages', 'summaries', 'corrections', 'reminders', 'provider_quota',
        'notes', 'todos', 'expenses', 'habits', 'habit_logs',
        'pending_confirmations', 'game_sessions', 'user_profiles',
        'provider_cooldown', 'documents', 'laporan', 'web_knowledge',
        'whatsapp_sessions', 'messages_archive'
    ];
BEGIN
    IF v_id = '' THEN
        RAISE EXCEPTION 'rpc_purge_user_data: p_chat_id kosong';
    END IF;

    FOREACH t IN ARRAY daftar LOOP
        BEGIN
            EXECUTE format(
                'DELETE FROM public.%I WHERE chat_id = ANY($1)',
                t
            ) USING ARRAY[v_id, v_id_wa, v_id_telanjang];
            GET DIAGNOSTICS v_n = ROW_COUNT;
            v_total := v_total + COALESCE(v_n, 0);
        EXCEPTION
            WHEN undefined_column THEN NULL;  -- tabel tanpa kolom chat_id
            WHEN undefined_table  THEN NULL;  -- tabel belum ada
        END;
    END LOOP;

    RETURN v_total;
END;
$$;

DO $$
BEGIN
    BEGIN
        EXECUTE 'REVOKE ALL ON FUNCTION public.rpc_purge_user_data(text) FROM PUBLIC, anon, authenticated';
    EXCEPTION WHEN undefined_function THEN NULL;
    END;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        EXECUTE 'GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role';
    END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 5. PERBAIKI v30 YANG TIDAK IDEMPOTEN (guard IF EXISTS)
-- ----------------------------------------------------------------------------
-- Bila v29 sudah menghapus `pending_confirmations` (dijalankan saat tabel
-- kosong), `REVOKE`/`GRANT` tanpa guard membuat SELURUH v30 rollback -> RLS 8
-- tabel tidak terpasang. Blok ini mengulang pekerjaan v30 dengan guard.
DO $$
DECLARE
    t text;
    daftar text[] := ARRAY[
        'notes', 'todos', 'expenses', 'habits', 'habit_logs',
        'pending_confirmations', 'game_sessions', 'user_profiles'
    ];
BEGIN
    FOREACH t IN ARRAY daftar LOOP
        IF to_regclass('public.' || t) IS NULL THEN
            RAISE NOTICE 'lewati (tabel belum ada): %', t;
            CONTINUE;
        END IF;
        BEGIN
            EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
            EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
            EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated, PUBLIC', t);
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
                EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', t);
            END IF;
            RAISE NOTICE 'RLS+REVOKE ok: %', t;
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'RLS+REVOKE gagal %: %', t, SQLERRM;
        END;
    END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 6. CATAT MIGRASI
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    IF to_regclass('public.schema_migrations') IS NOT NULL THEN
        INSERT INTO public.schema_migrations (versi)
        VALUES ('v33_security_hardening_audit')
        ON CONFLICT DO NOTHING;
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'lewati pencatatan schema_migrations: %', SQLERRM;
END $$;

-- ============================================================================
-- VERIFIKASI (jalankan manual untuk memastikan):
--
--   -- 1. Tidak ada lagi fungsi SECURITY DEFINER yang terbuka untuk PUBLIC:
--   SELECT p.oid::regprocedure AS fungsi
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public' AND p.prosecdef = true
--     AND has_function_privilege('public', p.oid, 'EXECUTE');
--   -- Harus KOSONG.
--
--   -- 2. Semua RPC punya search_path:
--   SELECT p.oid::regprocedure AS fungsi, p.proconfig
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public' AND p.prosecdef = true
--     AND (p.proconfig IS NULL OR NOT EXISTS (
--       SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%'));
--   -- Harus KOSONG.
--
--   -- 3. RLS 8 tabel:
--   SELECT relname, relrowsecurity, relforcerowsecurity
--   FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--   WHERE n.nspname = 'public' AND relkind = 'r'
--     AND relname IN ('notes','todos','expenses','habits','habit_logs',
--                     'pending_confirmations','game_sessions','user_profiles');
--   -- relrowsecurity & relforcerowsecurity harus TRUE.
-- ============================================================================
