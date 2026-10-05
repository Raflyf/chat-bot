-- ============================================================================
-- MIGRASI V28: ARSIP PESAN LAMA (retensi data)
--
-- MASALAH (audit 05 Okt 2026): tabel `messages` tumbuh tanpa batas
-- (~76 pesan/hari -> ~27.800/tahun). Query konteks percakapan jadi makin lambat
-- dan biaya storage naik terus.
--
-- SOLUSI: pindahkan pesan lebih tua dari N hari ke `messages_archive`, lalu
-- hapus dari tabel utama. Riwayat tetap tersimpan (untuk dataset/audit), tapi
-- tabel panas tetap ringan.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.messages_archive (
    LIKE public.messages INCLUDING DEFAULTS
);

CREATE INDEX IF NOT EXISTS idx_archive_chat    ON public.messages_archive (chat_id);
CREATE INDEX IF NOT EXISTS idx_archive_created ON public.messages_archive (created_at);

ALTER TABLE public.messages_archive ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.messages_archive FROM anon, authenticated;

-- ============================================================================
-- RPC: arsipkan pesan lebih tua dari N hari. Mengembalikan jumlah diarsipkan.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.arsipkan_pesan_lama(p_hari integer DEFAULT 90)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    batas timestamptz;
    n integer := 0;
BEGIN
    batas := now() - (p_hari || ' days')::interval;

    -- Pindahkan ke arsip
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
