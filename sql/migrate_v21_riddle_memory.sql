-- Migration v21: Memori Tebak-Tebakan (Riddle Memory)
--
-- KENAPA TABEL INI ADA:
-- Sebelumnya tebak-tebakan disimpan sebagai konstanta di kode (src/riddles.ts).
-- Itu salah pendekatan: isinya tetap, tidak bisa tumbuh, dan setiap penambahan
-- butuh deploy ulang. Pemilik produk meminta sebaliknya: bot mencari tebak-tebakan
-- dari internet SENDIRI, menyimpannya ke memori, lalu mengambilnya dari memori
-- saat ada yang minta. Jadi isinya tumbuh seiring waktu dan tetap beragam.
--
-- Tabel ini menyimpan hasil pencarian itu. Berbeda dari web_knowledge:
-- - web_knowledge menyimpan artikel/pengetahuan umum dengan TTL (bisa basi).
-- - riddle_memory menyimpan tebak-tebakan yang tidak punya kedaluwarsa, tapi
--   punya penghitung pemakaian supaya bisa diprioritaskan yang jarang dipakai.
--
-- Kolom `answer_norm` (jawaban dinormalisasi) diberi indeks UNIQUE supaya
-- tebak-tebakan yang sama tidak tersimpan dua kali, walau ditemukan dari sumber
-- yang berbeda.

CREATE TABLE IF NOT EXISTS riddle_memory (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  -- Pertanyaan yang dilempar ke pengguna.
  question TEXT NOT NULL,

  -- Jawaban benar. Dipakai menilai tebakan dan dibocorkan saat pengguna menyerah.
  answer TEXT NOT NULL,

  -- Bentuk normalisasi jawaban (huruf kecil, tanpa tanda baca) untuk cek duplikat.
  answer_norm TEXT NOT NULL,

  -- Alasan singkat kenapa jawabannya begitu. Dipakai saat pengguna menyerah,
  -- supaya bot bisa menjelaskan tanpa mengarang.
  explanation TEXT NULL,

  -- Kategori: hewan, makanan, benda, logika, kata, atau lainnya.
  category TEXT NOT NULL DEFAULT 'umum',

  -- Dari mana tebak-tebakan ini ditemukan (URL sumber).
  source_url TEXT NULL,

  -- Berapa kali tebak-tebakan ini sudah dipakai. Dipakai untuk memilih yang
  -- paling jarang dipakai, supaya tidak berulang.
  times_used INTEGER NOT NULL DEFAULT 0,

  -- Kapan terakhir dipakai. Dipakai bersama times_used untuk rotasi.
  last_used_at TIMESTAMPTZ NULL,

  -- Penanda sudah diperiksa kualitasnya (pertanyaan dan jawaban nyambung).
  verified BOOLEAN NOT NULL DEFAULT FALSE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Cegah duplikat: satu jawaban hanya boleh ada sekali.
CREATE UNIQUE INDEX IF NOT EXISTS idx_riddle_memory_answer_norm
  ON riddle_memory (answer_norm);

-- Indeks untuk memilih tebak-tebakan berikutnya: yang paling jarang dipakai
-- dan paling lama tidak dipakai, dalam kategori tertentu.
CREATE INDEX IF NOT EXISTS idx_riddle_memory_pick
  ON riddle_memory (category, times_used, last_used_at);

-- ==============================================================================
-- ROW LEVEL SECURITY - ZERO DATA EXPOSURE
-- ==============================================================================
ALTER TABLE riddle_memory ENABLE ROW LEVEL SECURITY;

-- Cabut akses dari anon dan authenticated publik
REVOKE ALL ON riddle_memory FROM anon, authenticated;

-- Berikan akses penuh hanya untuk service_role (backend serverless / worker)
GRANT ALL ON riddle_memory TO service_role;

-- ==============================================================================
-- RPC: increment_riddle_use
-- Menaikkan penghitung pemakaian secara atomik tanpa perlu baca-tulis terpisah.
-- Dipanggil setelah tebak-tebakan benar-benar dilempar ke pengguna.
-- ==============================================================================
CREATE OR REPLACE FUNCTION increment_riddle_use(p_answer_norm TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE riddle_memory
  SET times_used = times_used + 1,
      last_used_at = NOW(),
      updated_at = NOW()
  WHERE answer_norm = p_answer_norm;
END;
$$;

GRANT EXECUTE ON FUNCTION increment_riddle_use(TEXT) TO service_role;
