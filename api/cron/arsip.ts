/**
 * ARSIP PESAN LAMA — /api/cron/arsip
 *
 * KENAPA (audit 05 Okt 2026): tabel `messages` tumbuh tanpa batas. Endpoint ini
 * memindahkan pesan lebih tua dari N hari ke `messages_archive` agar tabel panas
 * tetap ringan, tanpa kehilangan riwayat.
 *
 * CARA PAKAI: panggil sekali sehari dari cron dengan header Authorization.
 * Aman tanpa migrasi v28: RPC tidak ada -> respons jujur "belum siap".
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db } from '../../src/db.js';
import { config } from '../../src/env.js';

function otorisasi(req: VercelRequest): boolean {
  const auth = String(req.headers.authorization || '');
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const rahasia = config.cronSecret || process.env.CRON_SECRET || '';
  return Boolean(rahasia) && token === rahasia;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  if (!otorisasi(req)) {
    res.status(401).json({ ok: false, pesan: 'Tidak diizinkan.' });
    return;
  }

  const c = db();
  if (!c) {
    res.status(503).json({ ok: false, pesan: 'Database tidak tersedia.' });
    return;
  }

  const hari = Math.max(30, Number(req.query.hari) || 90);

  try {
    const { data, error } = await c.rpc('arsipkan_pesan_lama', { p_hari: hari });
    if (error) {
      res.status(200).json({
        ok: false,
        pesan: 'Fungsi arsip belum tersedia. Jalankan migrasi v28 di Supabase.',
        detail: String(error.message || '').slice(0, 120),
      });
      return;
    }
    res.status(200).json({
      ok: true,
      hari,
      jumlah_diarsipkan: typeof data === 'number' ? data : 0,
      pesan: 'Arsip selesai.',
    });
  } catch (e) {
    res.status(500).json({ ok: false, pesan: 'Gagal mengarsipkan.', detail: String(e).slice(0, 120) });
  }
}
