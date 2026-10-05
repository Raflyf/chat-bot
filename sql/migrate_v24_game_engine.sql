-- ============================================================================
-- MIGRASI V24: MESIN GAME (state permainan tersimpan)
--
-- KENAPA: sebelumnya bot MENGARANG saat diajak main (UNO/kartu) karena tidak
-- ada state permainan tersimpan — tiap balasan kartunya berubah-ubah sehingga
-- terlihat ngaco. Sekarang setiap permainan punya state NYATA di database:
-- kartu di tangan, papan, giliran, skor — semua divalidasi aturan.
--
-- Satu baris per percakapan (chat_id unik). Permainan selesai -> status 'done'
-- (boleh ditimpa saat main lagi). Ada kolom `moves` untuk riwayat langkah
-- (dipakai catur/halma untuk undo & validasi).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.game_sessions (
    id          bigserial PRIMARY KEY,
    chat_id     text        NOT NULL,
    platform    text        NOT NULL DEFAULT 'whatsapp',
    -- Jenis permainan: uno | capsa | remi | cangkulan | gaple | catur | halma |
    --                   tictactoe | batu | tebakangka | dadu | hangman | monopoli
    kind        text        NOT NULL,
    -- Seluruh state permainan (kartu, papan, giliran, skor, dll) sebagai JSON.
    state       jsonb       NOT NULL,
    status      text        NOT NULL DEFAULT 'active',  -- active | done
    -- Jumlah langkah yang sudah dimainkan (untuk statistik & batas aman).
    move_count  integer     NOT NULL DEFAULT 0,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Satu percakapan = satu permainan aktif (yang terbaru menang).
CREATE UNIQUE INDEX IF NOT EXISTS idx_game_chat
    ON public.game_sessions (chat_id);

CREATE INDEX IF NOT EXISTS idx_game_kind
    ON public.game_sessions (kind);

-- ============================================================================
-- RPC: simpan/ganti state permainan secara atomik
-- ============================================================================
CREATE OR REPLACE FUNCTION public.set_game_state(
    p_chat_id    text,
    p_platform   text,
    p_kind       text,
    p_state      jsonb,
    p_status     text DEFAULT 'active'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.game_sessions (chat_id, platform, kind, state, status, move_count, updated_at)
    VALUES (p_chat_id, p_platform, p_kind, p_state, p_status, 1, now())
    ON CONFLICT (chat_id)
    DO UPDATE SET
        platform   = EXCLUDED.platform,
        kind       = EXCLUDED.kind,
        state      = EXCLUDED.state,
        status     = EXCLUDED.status,
        move_count = public.game_sessions.move_count + 1,
        updated_at = now();
END;
$$;

-- ============================================================================
-- RPC: ambil state permainan aktif (tanpa menghapus)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_game_state(p_chat_id text)
RETURNS TABLE (kind text, state jsonb, status text, move_count integer)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT g.kind, g.state, g.status, g.move_count
    FROM public.game_sessions g
    WHERE g.chat_id = p_chat_id
      AND g.status = 'active'
    LIMIT 1;
$$;

-- ============================================================================
-- RPC: akhiri permainan (saat selesai / menyerah / minta main lain)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.end_game(p_chat_id text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    UPDATE public.game_sessions
       SET status = 'done', updated_at = now()
     WHERE chat_id = p_chat_id AND status = 'active';
$$;
