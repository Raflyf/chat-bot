-- ============================================================================
-- MIGRASI V34: INTEGRITAS DATA & ATOMISITAS (hasil audit menyeluruh 14 Okt 2026)
-- ============================================================================
--
-- MASALAH YANG DIPERBAIKI
-- ----------------------
-- 1. Dedup keuangan (`simpanUang`) memakai pola CHECK-THEN-ACT: SELECT lalu
--    INSERT, tanpa UNIQUE INDEX. Dua request paralel (retry webhook / double-tap)
--    bisa sama-sama lolos SELECT lalu sama-sama INSERT -> baris GANDA permanen.
-- 2. `messages_archive` dibuat dengan `LIKE public.messages INCLUDING DEFAULTS`
--    yang TIDAK menyalin PK / NOT NULL / IDENTITY -> arsip tanpa integritas
--    (bisa menerima id duplikat, kolom wajib jadi nullable).
-- 3. Dua index pada kolom yang sama: `messages(created_at DESC)` (v13) dan
--    `messages(created_at)` (v17). Redundan -> menambah biaya tulis tanpa manfaat
--    (PostgreSQL bisa memakai index ASC untuk ORDER BY DESC).
-- 4. Lockout PIN TIDAK atomik: `newAttempts = current.lockoutAttempts + 1`
--    dihitung dari CACHE 25 detik, sehingga permintaan paralel saling menimpa
--    (lost update) dan counter global tidak pernah mencapai batas 5 -> brute
--    force PIN 6 digit tidak pernah terkunci. Perlu RPC atomik.
-- 5. Kolom enum-like tanpa CHECK (status/kind/priority/platform) -> nilai tak
--    valid bisa masuk dan membuat filter gagal senyap.
--
-- SIFAT: idempoten. Setiap bagian dibungkus guard sendiri. TIDAK menghapus data.
-- URUTAN: jalankan SETELAH v33.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. UNIQUE INDEX ANTI-DUPLIKAT KEUANGAN
-- ----------------------------------------------------------------------------
-- Kunci dedup yang dipakai aplikasi (src/notes.ts `simpanUang`):
--   (chat_id, kind, amount, note, created_at dalam 10 menit)
-- Karena jendela waktunya relatif (10 menit), tidak bisa dijadikan UNIQUE
-- langsung. Yang bisa dijamin di DB: kombinasi (chat_id, kind, amount, note)
-- yang SAMA PERSIS tidak boleh dobel dalam satu HARI. Aplikasi tetap melakukan
-- dedup 10 menit; index ini adalah jaring pengaman terakhir terhadap race.
--
-- Dibuat dengan guard: bila sudah ada duplikat lama, index TIDAK dibuat
-- (migrasi tidak boleh gagal karena data historis).
DO $$
DECLARE
    n_dup integer;
BEGIN
    IF to_regclass('public.expenses') IS NULL THEN
        RAISE NOTICE 'lewati: tabel expenses belum ada';
        RETURN;
    END IF;

    SELECT count(*) INTO n_dup FROM (
        SELECT chat_id, kind, amount, note, date_trunc('day', created_at) AS hari
        FROM public.expenses
        GROUP BY 1, 2, 3, 4, 5
        HAVING count(*) > 1
    ) d;

    IF n_dup > 0 THEN
        RAISE NOTICE 'lewati unique index expenses: ada % grup duplikat lama (bersihkan dulu bila ingin index)', n_dup;
    ELSE
        BEGIN
            CREATE UNIQUE INDEX IF NOT EXISTS uq_expenses_anti_dobel
                ON public.expenses (chat_id, kind, amount, note, date_trunc('day', created_at));
            RAISE NOTICE 'ok: uq_expenses_anti_dobel dibuat';
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'gagal buat uq_expenses_anti_dobel: %', SQLERRM;
        END;
    END IF;
END $$;

-- Index bantu untuk dedup 10 menit (pola query aplikasi).
CREATE INDEX IF NOT EXISTS idx_expenses_chat_kind_amount_created
    ON public.expenses (chat_id, kind, amount, created_at DESC);

-- ----------------------------------------------------------------------------
-- 2. PERBAIKI `messages_archive` (PK / NOT NULL / IDENTITY)
-- ----------------------------------------------------------------------------
-- `LIKE ... INCLUDING DEFAULTS` tidak menyalin constraint. Perbaikan dilakukan
-- dengan menambahkan PK + memastikan kolom penting NOT NULL, TANPA menghapus
-- baris yang sudah ada (bila ada duplikat id, PK dilewati + diberi peringatan).
DO $$
DECLARE
    n_dup integer;
BEGIN
    IF to_regclass('public.messages_archive') IS NULL THEN
        RAISE NOTICE 'lewati: messages_archive belum ada';
        RETURN;
    END IF;

    -- PK hanya bila kolom id ada dan tidak ada duplikat.
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'messages_archive' AND column_name = 'id'
    ) THEN
        SELECT count(*) INTO n_dup FROM (
            SELECT id FROM public.messages_archive WHERE id IS NOT NULL
            GROUP BY id HAVING count(*) > 1
        ) d;
        IF n_dup > 0 THEN
            RAISE NOTICE 'lewati PK messages_archive: ada % id duplikat', n_dup;
        ELSIF NOT EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'messages_archive' AND c.contype = 'p'
        ) THEN
            BEGIN
                ALTER TABLE public.messages_archive ADD PRIMARY KEY (id);
                RAISE NOTICE 'ok: PK messages_archive dibuat';
            EXCEPTION WHEN OTHERS THEN
                RAISE NOTICE 'gagal PK messages_archive: %', SQLERRM;
            END;
        ELSE
            RAISE NOTICE 'ok: messages_archive sudah punya PK';
        END IF;
    END IF;

    -- Kolom wajib: pastikan NOT NULL bila tidak ada nilai NULL (aman untuk data lama).
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM public.messages_archive WHERE created_at IS NULL) THEN
            ALTER TABLE public.messages_archive ALTER COLUMN created_at SET NOT NULL;
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'lewati NOT NULL created_at arsip: %', SQLERRM;
    END;

    -- Index waktu untuk query arsip.
    BEGIN
        CREATE INDEX IF NOT EXISTS idx_messages_archive_created_at
            ON public.messages_archive (created_at DESC);
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
END $$;

-- ----------------------------------------------------------------------------
-- 3. HAPUS INDEX DUPLIKAT
-- ----------------------------------------------------------------------------
-- `messages(created_at DESC)` (v13) dan `messages(created_at)` (v17) sama-sama
-- ada. PostgreSQL dapat memakai index ASC untuk ORDER BY DESC, jadi yang DESC
-- redundan. Hapus HANYA bila index ASC-nya memang ada (jangan sampai kehilangan
-- satu-satunya index waktu).
DO $$
BEGIN
    IF to_regclass('public.messages') IS NULL THEN
        RAISE NOTICE 'lewati: tabel messages belum ada';
        RETURN;
    END IF;
    IF to_regclass('public.idx_messages_created_at') IS NOT NULL
       AND to_regclass('public.idx_messages_created_at_desc') IS NOT NULL THEN
        DROP INDEX IF EXISTS public.idx_messages_created_at_desc;
        RAISE NOTICE 'ok: index duplikat idx_messages_created_at_desc dihapus';
    ELSE
        RAISE NOTICE 'lewati: tidak ada pasangan index duplikat messages(created_at)';
    END IF;
END $$;

-- Index komposit untuk hot-path dedup pesan masuk (src/db.ts `claimIncomingMessage`):
-- filter platform + chat_id + role + created_at.
CREATE INDEX IF NOT EXISTS idx_messages_dedup_hotpath
    ON public.messages (platform, chat_id, role, created_at DESC);

-- ----------------------------------------------------------------------------
-- 4. RPC LOCKOUT PIN ATOMIK
-- ----------------------------------------------------------------------------
-- Menggantikan pola read-modify-write di `src/admin_auth.ts` yang dihitung dari
-- cache 25 detik (lost update saat request paralel).
--
-- Pemakaian dari aplikasi:
--   SELECT public.rpc_catat_gagal_pin(5, interval '15 minutes');
--   -- -> mengembalikan lockout_attempts SETELAH ditambah, dan mengunci bila >= batas
CREATE OR REPLACE FUNCTION public.rpc_catat_gagal_pin(
    p_batas integer DEFAULT 5,
    p_durasi interval DEFAULT interval '15 minutes'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_attempts integer;
    v_locked timestamptz;
BEGIN
    IF to_regclass('public.admin_auth_config') IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'alasan', 'tabel admin_auth_config tidak ada');
    END IF;

    -- UPDATE ... RETURNING bersifat ATOMik: dua request paralel tidak saling menimpa.
    UPDATE public.admin_auth_config
    SET lockout_attempts = COALESCE(lockout_attempts, 0) + 1,
        locked_until = CASE
            WHEN COALESCE(lockout_attempts, 0) + 1 >= p_batas THEN now() + p_durasi
            ELSE locked_until
        END,
        updated_at = now()
    WHERE id = 1
    RETURNING lockout_attempts, locked_until INTO v_attempts, v_locked;

    IF v_attempts IS NULL THEN
        -- Baris belum ada -> buat.
        INSERT INTO public.admin_auth_config (id, lockout_attempts, locked_until, updated_at)
        VALUES (1, 1, NULL, now())
        ON CONFLICT (id) DO UPDATE
            SET lockout_attempts = COALESCE(public.admin_auth_config.lockout_attempts, 0) + 1,
                updated_at = now()
        RETURNING lockout_attempts, locked_until INTO v_attempts, v_locked;
    END IF;

    RETURN jsonb_build_object(
        'ok', true,
        'attempts', COALESCE(v_attempts, 0),
        'locked', (v_locked IS NOT NULL AND v_locked > now()),
        'locked_until', v_locked
    );
END;
$$;

-- RPC reset counter setelah PIN BENAR (atomik).
CREATE OR REPLACE FUNCTION public.rpc_reset_gagal_pin()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF to_regclass('public.admin_auth_config') IS NULL THEN
        RETURN jsonb_build_object('ok', false);
    END IF;
    UPDATE public.admin_auth_config
    SET lockout_attempts = 0,
        locked_until = NULL,
        updated_at = now()
    WHERE id = 1;
    RETURN jsonb_build_object('ok', true);
END;
$$;

-- Kunci kedua RPC dari publik.
DO $$
DECLARE fn text;
BEGIN
    FOREACH fn IN ARRAY ARRAY[
        'public.rpc_catat_gagal_pin(integer, interval)',
        'public.rpc_catat_gagal_pin(integer)',
        'public.rpc_catat_gagal_pin()',
        'public.rpc_reset_gagal_pin()'
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
-- 5. CHECK CONSTRAINT PADA KOLOM ENUM-LIKE
-- ----------------------------------------------------------------------------
-- Ditambahkan HANYA bila belum ada dan tidak ada nilai yang melanggar.
-- Dibungkus guard supaya data lama yang menyimpang tidak menggagalkan migrasi.
DO $$
DECLARE
    r record;
BEGIN
    FOR r IN
        SELECT * FROM (VALUES
            ('expenses', 'kind',            'expenses_kind_check',            'kind IN (''in'',''out'')'),
            ('todos',    'status',          'todos_status_check',             'status IN (''open'',''done'',''cancelled'')'),
            ('game_sessions', 'status',     'game_sessions_status_check',     'status IN (''active'',''done'')'),
            ('pending_confirmations', 'niat', 'pending_confirmations_niat_check', NULL),
            ('messages', 'platform',        'messages_platform_check2',       'platform IN (''whatsapp'',''telegram'')'),
            ('reminders', 'platform',       'reminders_platform_check2',      'platform IN (''whatsapp'',''telegram'')')
        ) AS t(tabel, kolom, nama, syarat)
    LOOP
        IF r.syarat IS NULL THEN CONTINUE; END IF;
        IF to_regclass('public.' || r.tabel) IS NULL THEN CONTINUE; END IF;
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema='public' AND table_name=r.tabel AND column_name=r.kolom
        ) THEN CONTINUE; END IF;
        IF EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid=c.conrelid
            JOIN pg_namespace n ON n.oid=t.relnamespace
            WHERE n.nspname='public' AND t.relname=r.tabel AND c.conname=r.nama
        ) THEN CONTINUE; END IF;

        BEGIN
            EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (%s) NOT VALID',
                           r.tabel, r.nama, r.syarat);
            RAISE NOTICE 'ok: CHECK % pada %.% (NOT VALID - data lama tidak diperiksa)',
                         r.nama, r.tabel, r.kolom;
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'lewati CHECK % pada %.%: %', r.nama, r.tabel, r.kolom, SQLERRM;
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
        VALUES ('v34_integritas_data')
        ON CONFLICT DO NOTHING;
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'lewati pencatatan schema_migrations: %', SQLERRM;
END $$;

-- ============================================================================
-- VERIFIKASI (jalankan manual):
--
--   -- 1. Unique index anti-dobel:
--   SELECT indexname FROM pg_indexes
--   WHERE schemaname='public' AND tablename='expenses' AND indexname='uq_expenses_anti_dobel';
--
--   -- 2. PK messages_archive:
--   SELECT c.conname, pg_get_constraintdef(c.oid) FROM pg_constraint c
--   JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
--   WHERE n.nspname='public' AND t.relname='messages_archive' AND c.contype='p';
--
--   -- 3. Index duplikat sudah hilang:
--   SELECT indexname FROM pg_indexes
--   WHERE schemaname='public' AND tablename='messages' AND indexname LIKE '%created_at%';
--
--   -- 4. RPC lockout atomik ada:
--   SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--   WHERE n.nspname='public' AND p.proname IN ('rpc_catat_gagal_pin','rpc_reset_gagal_pin');
-- ============================================================================
