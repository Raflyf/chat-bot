-- ============================================================================
-- MIGRASI V25: PROFIL WAKTU PENGGUNA (zona waktu per-user, permanen)
--
-- MASALAH (temuan pemilik produk 05 Okt 2026):
-- "jangan salah membaca waktu user sedang berada, karna itu akan membingungkan
--  user juga jika waktunya beda wilayah, misal sistem default nya WIB, jika user
--  di belahan waktu lain maka akan jadi tidak sama waktunya. Jadi untuk mencegah
--  itu jika ada user baru atau id baru masuk ke database maka jika user
--  menanyakan waktu, menyuruh mengingatkan atau apapun itu yang berhubungan
--  dengan waktu jangan sok tau dan asal jawab defaultnya, langsung tanya
--  pastikan user di belahan bumi mana, atau di mana dia tinggal, lalu simpan di
--  database agar tidak pernah lupa, dan jika user id yang sudah diketahui dan
--  ada di database lokasi dan zona waktunya maka tidak usah ditanya lagi."
--
-- SOLUSI: tabel `user_profiles` — satu baris per chat_id, menyimpan zona waktu,
-- label lokasi, cara deteksi (manual/telepon/GPS), dan waktu verifikasi.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.user_profiles (
    chat_id        text        PRIMARY KEY,
    platform       text        NOT NULL DEFAULT 'whatsapp',
    -- Zona waktu IANA, mis. 'Asia/Jakarta', 'Asia/Makassar', 'Europe/London'
    timezone       text        NOT NULL,
    -- Label ramah, mis. 'Cianjur, Jawa Barat (WIB)'
    label          text        NOT NULL DEFAULT '',
    -- Kota/provinsi yang disebut user (untuk ditampilkan kembali)
    kota           text,
    -- Cara zona ini diketahui: 'manual' (user bilang), 'telepon' (kode negara),
    -- 'gps' (kirim lokasi), 'default'
    sumber         text        NOT NULL DEFAULT 'manual',
    -- Apakah sudah DIKONFIRMASI user (bukan tebakan dari nomor telepon)?
    terverifikasi  boolean     NOT NULL DEFAULT false,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_profiles_tz ON public.user_profiles (timezone);

-- ============================================================================
-- RPC: simpan/perbarui profil waktu secara atomik
-- ============================================================================
CREATE OR REPLACE FUNCTION public.set_user_timezone(
    p_chat_id  text,
    p_platform text,
    p_timezone text,
    p_label    text DEFAULT '',
    p_kota     text DEFAULT NULL,
    p_sumber   text DEFAULT 'manual',
    p_terverifikasi boolean DEFAULT true
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.user_profiles
        (chat_id, platform, timezone, label, kota, sumber, terverifikasi, updated_at)
    VALUES
        (p_chat_id, p_platform, p_timezone, p_label, p_kota, p_sumber, p_terverifikasi, now())
    ON CONFLICT (chat_id)
    DO UPDATE SET
        platform      = EXCLUDED.platform,
        timezone      = EXCLUDED.timezone,
        label         = EXCLUDED.label,
        kota          = EXCLUDED.kota,
        sumber        = EXCLUDED.sumber,
        terverifikasi = EXCLUDED.terverifikasi,
        updated_at    = now();
END;
$$;

-- ============================================================================
-- RPC: ambil profil waktu
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_user_timezone(p_chat_id text)
RETURNS TABLE (timezone text, label text, kota text, sumber text, terverifikasi boolean)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT u.timezone, u.label, u.kota, u.sumber, u.terverifikasi
    FROM public.user_profiles u
    WHERE u.chat_id = p_chat_id
    LIMIT 1;
$$;
