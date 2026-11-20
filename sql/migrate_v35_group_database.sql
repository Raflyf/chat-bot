-- ============================================================================
-- MIGRATION V35: Database Khusus Grup (Isolasi Fisik Grup vs Chat Privat)
-- Workspace: FreeAIBot / AgentKit
-- Target Database: Supabase PostgreSQL
--
-- LATAR BELAKANG (temuan pemilik produk 20 Nov 2026):
--   Memisahkan 100% seluruh data grup (pesan, pengingat, catatan, tugas,
--   keuangan, koreksi/fakta, ringkasan sesi, dokumen, dan mode grup) ke
--   tabel tersendiri agar data pribadi di DM tidak pernah terbawa ke grup
--   dan sebaliknya.
--
-- KEAMANAN:
--   - Idempoten (CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS).
--   - RLS aktif + FORCE RLS + REVOKE ALL dari anon/authenticated/PUBLIC.
--   - Akses eksklusif server-side `service_role`.
--   - Tanpa perintah DELETE atau DROP TABLE.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. GROUP_MESSAGES — riwayat percakapan grup (WA Baileys & Telegram)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.group_messages (
    id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    platform          text        NOT NULL DEFAULT 'whatsapp' CHECK (platform IN ('telegram', 'whatsapp', 'web', 'api')),
    chat_id           text        NOT NULL,
    role              text        NOT NULL CHECK (role IN ('user', 'assistant')),
    content           text        NOT NULL,
    via               text,
    msg_id            text,
    processed_at      timestamptz,
    prompt_tokens     integer,
    completion_tokens integer,
    total_tokens      integer,
    latency_ms        integer,
    needs_search      boolean,
    split_count       integer,
    prompt_version    text,
    feedback          text,
    created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_group_messages_chat_created
    ON public.group_messages (chat_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_group_messages_platform_msg_id
    ON public.group_messages (platform, msg_id);
CREATE INDEX IF NOT EXISTS idx_group_messages_tokens_created
    ON public.group_messages (created_at DESC, total_tokens);

-- ============================================================================
-- 2. GROUP_REMINDERS — pengingat khusus di dalam grup
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.group_reminders (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    chat_id      text        NOT NULL,
    actor        text,
    message      text        NOT NULL,
    due_at       timestamptz NOT NULL,
    status       text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'sent', 'failed')),
    platform     text        NOT NULL DEFAULT 'whatsapp',
    lease_until  timestamptz,
    repeat_kind  text        NOT NULL DEFAULT 'none',
    repeat_value text,
    repeat_until timestamptz,
    repeat_count integer     NOT NULL DEFAULT 0,
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_group_reminders_status_due_platform
    ON public.group_reminders (status, due_at, platform);
CREATE INDEX IF NOT EXISTS idx_group_reminders_lease_until
    ON public.group_reminders (status, lease_until);
CREATE INDEX IF NOT EXISTS idx_group_reminders_chat_id
    ON public.group_reminders (chat_id);
CREATE INDEX IF NOT EXISTS idx_group_reminders_repeat
    ON public.group_reminders (repeat_kind)
    WHERE repeat_kind <> 'none';

-- ============================================================================
-- 3. GROUP_NOTES — catatan khusus grup
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.group_notes (
    id         bigserial PRIMARY KEY,
    chat_id    text        NOT NULL,
    actor      text,
    platform   text        NOT NULL DEFAULT 'whatsapp',
    title      text,
    content    text        NOT NULL,
    tags       text[]      DEFAULT '{}',
    pinned     boolean     NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_group_notes_chat_created
    ON public.group_notes (chat_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_group_notes_tags
    ON public.group_notes USING gin (tags);

-- ============================================================================
-- 4. GROUP_TODOS — daftar tugas khusus grup
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.group_todos (
    id         bigserial PRIMARY KEY,
    chat_id    text        NOT NULL,
    actor      text,
    platform   text        NOT NULL DEFAULT 'whatsapp',
    task       text        NOT NULL,
    priority   smallint    NOT NULL DEFAULT 2,
    status     text        NOT NULL DEFAULT 'open',
    due_at     timestamptz,
    done_at    timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_group_todos_chat_status
    ON public.group_todos (chat_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_group_todos_due
    ON public.group_todos (due_at) WHERE status = 'open' AND due_at IS NOT NULL;

-- ============================================================================
-- 5. GROUP_EXPENSES — keuangan bersama / kas grup
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.group_expenses (
    id          bigserial PRIMARY KEY,
    chat_id     text          NOT NULL,
    actor       text,
    platform    text          NOT NULL DEFAULT 'whatsapp',
    kind        text          NOT NULL DEFAULT 'out',
    amount      numeric(14,2) NOT NULL CHECK (amount >= 0),
    category    text          NOT NULL DEFAULT 'lainnya',
    note        text,
    occurred_at timestamptz   NOT NULL DEFAULT now(),
    created_at  timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_group_expenses_chat_occurred
    ON public.group_expenses (chat_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_group_expenses_category
    ON public.group_expenses (chat_id, category, occurred_at DESC);

-- ============================================================================
-- 6. GROUP_CORRECTIONS — fakta & preferensi konteks grup (/salah & zona waktu)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.group_corrections (
    id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    chat_id    text        NOT NULL,
    correction text        NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_group_corrections_chat_idx
    ON public.group_corrections (chat_id, created_at DESC);

-- ============================================================================
-- 7. GROUP_SUMMARIES — ringkasan percakapan jangka panjang grup
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.group_summaries (
    chat_id    text PRIMARY KEY,
    summary    text        NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
-- 8. GROUP_DOCUMENTS — arsip dokumen yang dikirim di grup
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.group_documents (
    id           bigserial PRIMARY KEY,
    chat_id      text        NOT NULL,
    platform     text        NOT NULL DEFAULT 'whatsapp',
    filename     text        NOT NULL,
    mime         text,
    teks         text,
    teks_panjang integer,
    ringkasan    text,
    via          text,
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_group_documents_chat
    ON public.group_documents (chat_id, created_at DESC);

-- ============================================================================
-- 9. GROUP_SETTINGS — status mode per-grup (mention / nimbrung / diam)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.group_settings (
    group_key              text PRIMARY KEY,
    platform               text        NOT NULL DEFAULT 'whatsapp',
    mode                   text        NOT NULL DEFAULT 'mention' CHECK (mode IN ('mention', 'nimbrung', 'diam')),
    locked_by_admin        boolean     NOT NULL DEFAULT false,
    updated_by             text,
    last_group_activity_at timestamptz NOT NULL DEFAULT now(),
    last_bot_reply_at      timestamptz,
    updated_at             timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
-- 10. HARDENING RLS + REVOKE + POLICY KHUSUS SERVICE_ROLE (SEMUA 9 TABEL)
-- ============================================================================
ALTER TABLE IF EXISTS public.group_messages    ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.group_reminders   ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.group_notes       ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.group_todos       ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.group_expenses    ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.group_corrections ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.group_summaries   ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.group_documents   ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.group_settings    ENABLE ROW LEVEL SECURITY;

ALTER TABLE IF EXISTS public.group_messages    FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.group_reminders   FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.group_notes       FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.group_todos       FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.group_expenses    FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.group_corrections FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.group_summaries   FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.group_documents   FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.group_settings    FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
    public.group_messages,
    public.group_reminders,
    public.group_notes,
    public.group_todos,
    public.group_expenses,
    public.group_corrections,
    public.group_summaries,
    public.group_documents,
    public.group_settings
    FROM anon, authenticated, PUBLIC;

DO $$
DECLARE
    seq_name text;
    tbl_name text;
    pol_name text;
BEGIN
    FOR seq_name IN
        SELECT sequence_name FROM information_schema.sequences
        WHERE sequence_schema = 'public'
          AND sequence_name IN (
              'group_messages_id_seq',
              'group_reminders_id_seq',
              'group_notes_id_seq',
              'group_todos_id_seq',
              'group_expenses_id_seq',
              'group_corrections_id_seq',
              'group_documents_id_seq'
          )
    LOOP
        EXECUTE format('REVOKE ALL ON SEQUENCE public.%I FROM anon, authenticated, PUBLIC', seq_name);
    END LOOP;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        GRANT ALL ON TABLE
            public.group_messages,
            public.group_reminders,
            public.group_notes,
            public.group_todos,
            public.group_expenses,
            public.group_corrections,
            public.group_summaries,
            public.group_documents,
            public.group_settings
            TO service_role;
    END IF;

    FOREACH tbl_name IN ARRAY ARRAY[
        'group_messages',
        'group_reminders',
        'group_notes',
        'group_todos',
        'group_expenses',
        'group_corrections',
        'group_summaries',
        'group_documents',
        'group_settings'
    ]
    LOOP
        pol_name := 'Service Role Only ' || tbl_name;
        IF NOT EXISTS (
            SELECT 1 FROM pg_policies
            WHERE schemaname = 'public' AND tablename = tbl_name AND policyname = pol_name
        ) THEN
            EXECUTE format(
                'CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
                pol_name,
                tbl_name
            );
        END IF;
    END LOOP;
END $$;

COMMIT;
