-- ============================================================================
-- MIGRATION V22: Fitur Pencatatan Pribadi (Catatan, Tugas, Pengeluaran, Jurnal)
-- Workspace: FreeAIBot / AgentKit
-- Target Database: Supabase PostgreSQL
--
-- Alasan: pemilik produk meminta bot bisa dipakai mencatat & mengingat sesuatu
--   seperti to-do list, catatan pengeluaran uang, dan lainnya. Sebelumnya bot
--   hanya punya /remind (pengingat berbasis menit) dan /salah (preferensi).
--
--   Kini ditambah 4 tabel:
--     1. notes     - catatan bebas / jurnal (resep, ide, info penting)
--     2. todos     - daftar tugas harian dengan status & prioritas
--     3. expenses  - catatan keuangan (pengeluaran & pemasukan) + kategori
--     4. habits    - kebiasaan berulang (minum air, olahraga, baca) + streak
--
--   Semua tabel:
--     - memakai chat_id sebagai pemilik (WA: wa_<jid>, TG: id numerik)
--     - mendukung pemisahan per-orang di grup lewat kolom actor
--     - punya indeks agar pencarian & rekap cepat
--     - RLS dimatikan karena akses hanya lewat service key bot (server-side)
-- ============================================================================

-- ============================================================================
-- 1. NOTES — catatan bebas & jurnal
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.notes (
    id           bigserial PRIMARY KEY,
    chat_id      text        NOT NULL,
    actor        text,                          -- nama pengirim di grup (NULL = privat)
    platform     text        NOT NULL DEFAULT 'whatsapp',
    title        text,                          -- judul singkat (opsional)
    content      text        NOT NULL,          -- isi catatan
    tags         text[]      DEFAULT '{}',      -- label bebas: {resep,makanan}
    pinned       boolean     NOT NULL DEFAULT false,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notes_chat_created
    ON public.notes (chat_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notes_tags
    ON public.notes USING gin (tags);

-- ============================================================================
-- 2. TODOS — daftar tugas
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.todos (
    id           bigserial PRIMARY KEY,
    chat_id      text        NOT NULL,
    actor        text,
    platform     text        NOT NULL DEFAULT 'whatsapp',
    task         text        NOT NULL,          -- isi tugas
    priority     smallint    NOT NULL DEFAULT 2, -- 1=tinggi, 2=sedang, 3=rendah
    status       text        NOT NULL DEFAULT 'open', -- open | done | cancelled
    due_at       timestamptz,                   -- tenggat (opsional)
    done_at      timestamptz,
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_todos_chat_status
    ON public.todos (chat_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_todos_due
    ON public.todos (due_at) WHERE status = 'open' AND due_at IS NOT NULL;

-- ============================================================================
-- 3. EXPENSES — catatan keuangan (pengeluaran & pemasukan)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.expenses (
    id           bigserial PRIMARY KEY,
    chat_id      text        NOT NULL,
    actor        text,
    platform     text        NOT NULL DEFAULT 'whatsapp',
    kind         text        NOT NULL DEFAULT 'out',  -- 'out' = pengeluaran, 'in' = pemasukan
    amount       numeric(14,2) NOT NULL CHECK (amount >= 0),
    category     text        NOT NULL DEFAULT 'lainnya', -- makan, transport, belanja, gaji, dll
    note         text,                          -- keterangan bebas
    occurred_at  timestamptz NOT NULL DEFAULT now(), -- kapan transaksi terjadi
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_expenses_chat_occurred
    ON public.expenses (chat_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_category
    ON public.expenses (chat_id, category, occurred_at DESC);

-- ============================================================================
-- 4. HABITS — kebiasaan berulang + streak
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.habits (
    id            bigserial PRIMARY KEY,
    chat_id       text        NOT NULL,
    actor         text,
    platform      text        NOT NULL DEFAULT 'whatsapp',
    name          text        NOT NULL,          -- mis. "minum air 2L"
    target_per_day smallint   NOT NULL DEFAULT 1,
    streak        integer     NOT NULL DEFAULT 0, -- hari berturut-turut
    last_done_at  timestamptz,
    best_streak   integer     NOT NULL DEFAULT 0,
    active        boolean     NOT NULL DEFAULT true,
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_habits_chat_active
    ON public.habits (chat_id, active, created_at DESC);

-- Riwayat centang kebiasaan (agar streak & rekap harian akurat)
CREATE TABLE IF NOT EXISTS public.habit_logs (
    id         bigserial PRIMARY KEY,
    habit_id   bigint      NOT NULL REFERENCES public.habits(id) ON DELETE CASCADE,
    done_on    date        NOT NULL DEFAULT CURRENT_DATE,
    count      smallint    NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (habit_id, done_on)
);

CREATE INDEX IF NOT EXISTS idx_habit_logs_habit_date
    ON public.habit_logs (habit_id, done_on DESC);

-- ============================================================================
-- 5. RPC REKAP KEUANGAN (atomik & cepat, dipakai dashboard/chat)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.sum_expenses(
    p_chat_id text,
    p_from    timestamptz,
    p_to      timestamptz
)
RETURNS TABLE (kind text, category text, total numeric, jumlah bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT e.kind, e.category, SUM(e.amount)::numeric AS total, COUNT(*)::bigint AS jumlah
    FROM public.expenses e
    WHERE e.chat_id = p_chat_id
      AND e.occurred_at >= p_from
      AND e.occurred_at <  p_to
    GROUP BY e.kind, e.category
    ORDER BY total DESC;
$$;

-- ============================================================================
-- CATATAN PEMAKAIAN
-- ============================================================================
-- - Semua tabel memakai chat_id (bukan user id global) agar konsisten dengan
--   tabel `reminders` & `corrections` yang sudah ada.
-- - Kolom `actor` diisi hanya saat pesan datang dari GRUP, agar catatan tiap
--   orang tidak tercampur. Di chat privat nilainya NULL.
-- - Tidak ada RLS: akses hanya melalui service key bot di sisi server.
--   (Pola sama dengan tabel `reminders` yang sudah berjalan.)
-- ============================================================================
