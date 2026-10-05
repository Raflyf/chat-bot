-- ============================================================================
-- MIGRASI V29: BERSIH-BERSIH
--
-- Menghapus tabel yang TIDAK LAGI DIPAKAI setelah konfirmasi iya/tidak
-- dihapus untuk pengingat dan diganti penyimpanan di `pending_confirmations`
-- (v23) yang kini hanya dipakai untuk catatan/tugas/keuangan.
--
-- CATATAN: migrasi ini OPSIONAL. Jalankan hanya bila Anda yakin tabel
-- `pending_confirmations` sudah tidak diperlukan. Sebelum menjalankan,
-- periksa dulu: SELECT count(*) FROM pending_confirmations;
-- ============================================================================

-- Hapus HANYA bila kosong (aman). Bila berisi data, biarkan (tidak dihapus).
DO $$
DECLARE
    n integer;
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema = 'public' AND table_name = 'pending_confirmations') THEN
        SELECT count(*) INTO n FROM public.pending_confirmations;
        IF n = 0 THEN
            DROP TABLE public.pending_confirmations;
            RAISE NOTICE 'Tabel pending_confirmations (kosong) dihapus.';
        ELSE
            RAISE NOTICE 'Tabel pending_confirmations berisi % baris — TIDAK dihapus (masih ada data).', n;
        END IF;
    END IF;
END $$;
