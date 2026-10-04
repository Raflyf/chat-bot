-- ============================================================================
-- MIGRATION V23: Konfirmasi Tertunda Durable (anti-halusinasi "tersimpan")
--
-- MASALAH NYATA (04 Okt 2026, keluhan pemilik produk):
--   User: "ingatkan 1 menit lg login"
--   Bot : "Sepertinya kamu mau mencatat: Pengingat ... Balas iya untuk simpan"
--   User: "ya"
--   Bot : "Siapp, pengingat tersimpan."   <- BOHONG, tidak tersimpan!
--   (1 menit+ kemudian: tidak ada pengingat masuk)
--
-- AKAR MASALAH:
--   Konfirmasi disimpan di MEMORI PROSES (Map) di src/notes.ts.
--   Vercel serverless menjalankan BANYAK instance paralel. Pesan "ingatkan..."
--   dan pesan "ya" bisa dilayani instance BERBEDA:
--     - Instance A: simpan konfirmasi ke Map-nya, balas "balas iya untuk simpan"
--     - Instance B: terima "ya", Map-nya KOSONG -> tidak tahu ada konfirmasi
--     -> pesan "ya" jatuh ke AI -> AI MENGARANG "pengingat tersimpan"
--   Pengingat TIDAK PERNAH masuk database, jadi tidak pernah terkirim.
--
-- SOLUSI: simpan konfirmasi ke DATABASE agar bertahan lintas instance.
--   Tabel ini menyimpan niat yang menunggu jawaban user ("iya"/"tidak"),
--   dengan masa berlaku (TTL) 10 menit.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.pending_confirmations (
    id          bigserial PRIMARY KEY,
    chat_id     text        NOT NULL,
    platform    text        NOT NULL DEFAULT 'whatsapp',
    actor       text,
    -- Niat yang menunggu konfirmasi, disimpan sebagai JSON:
    -- { kind: 'note'|'todo'|'expense', yakin: number, data: {...}, ringkas: string }
    niat        jsonb       NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    expires_at  timestamptz NOT NULL DEFAULT (now() + interval '10 minutes')
);

-- Satu chat hanya boleh punya SATU konfirmasi tertunda (yang terbaru menang).
CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_conf_chat
    ON public.pending_confirmations (chat_id);

-- Index untuk pembersihan otomatis baris kadaluarsa.
CREATE INDEX IF NOT EXISTS idx_pending_conf_expires
    ON public.pending_confirmations (expires_at);

-- ============================================================================
-- RPC: simpan/ganti konfirmasi tertunda secara atomik
-- ============================================================================
CREATE OR REPLACE FUNCTION public.set_pending_confirmation(
    p_chat_id  text,
    p_platform text,
    p_actor    text,
    p_niat     jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.pending_confirmations (chat_id, platform, actor, niat, expires_at)
    VALUES (p_chat_id, p_platform, p_actor, p_niat, now() + interval '10 minutes')
    ON CONFLICT (chat_id)
    DO UPDATE SET
        platform   = EXCLUDED.platform,
        actor      = EXCLUDED.actor,
        niat       = EXCLUDED.niat,
        created_at = now(),
        expires_at = now() + interval '10 minutes';
END;
$$;

-- ============================================================================
-- RPC: ambil konfirmasi tertunda yang BELUM kadaluarsa, sekaligus hapus
-- (atomik: SELECT ... FOR UPDATE + DELETE, aman multi-instance)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.take_pending_confirmation(p_chat_id text)
RETURNS TABLE (niat jsonb, platform text, actor text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_niat     jsonb;
    v_platform text;
    v_actor    text;
BEGIN
    DELETE FROM public.pending_confirmations
    WHERE chat_id = p_chat_id
      AND expires_at > now()
    RETURNING pending_confirmations.niat, pending_confirmations.platform, pending_confirmations.actor
    INTO v_niat, v_platform, v_actor;

    IF v_niat IS NULL THEN
        -- Tidak ada, ATAU kadaluarsa: bersihkan baris kadaluarsa lalu keluar.
        DELETE FROM public.pending_confirmations
        WHERE chat_id = p_chat_id AND expires_at <= now();
        RETURN;
    END IF;

    niat := v_niat;
    platform := v_platform;
    actor := v_actor;
    RETURN NEXT;
END;
$$;

-- ============================================================================
-- RPC: buang konfirmasi tertunda (saat user bilang "tidak")
-- ============================================================================
CREATE OR REPLACE FUNCTION public.clear_pending_confirmation(p_chat_id text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    DELETE FROM public.pending_confirmations WHERE chat_id = p_chat_id;
$$;
