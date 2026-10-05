-- ============================================================================
-- MIGRASI V27: PENGINGAT BERULANG
--
-- FITUR BARU (permintaan pemilik produk 05 Okt 2026): pengingat yang terulang
-- otomatis — "tiap hari jam 7", "tiap Senin jam 9", "tiap tanggal 1".
--
-- DESAIN: alih-alih membuat baris baru tiap kali (bisa ribuan), satu baris
-- menyimpan ATURAN berulang, lalu worker `checkDueReminders()` menghitung
-- kemunculan berikutnya setelah mengirim.
--
-- Kolom:
--   repeat_kind  : none | daily | weekly | monthly | yearly | weekday
--   repeat_value : untuk weekly -> 0-6 (Minggu=0), monthly -> 1-31, yearly -> MM-DD
--   repeat_until : batas akhir pengulangan (opsional, NULL = selamanya)
--   repeat_count : sudah berapa kali terkirim (untuk laporan & batas aman)
-- ============================================================================

ALTER TABLE public.reminders
    ADD COLUMN IF NOT EXISTS repeat_kind  text        NOT NULL DEFAULT 'none',
    ADD COLUMN IF NOT EXISTS repeat_value text,
    ADD COLUMN IF NOT EXISTS repeat_until timestamptz,
    ADD COLUMN IF NOT EXISTS repeat_count integer     NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_reminders_repeat
    ON public.reminders (repeat_kind)
    WHERE repeat_kind <> 'none';
