/**
 * BACKUP HARIAN — /api/cron/backup
 *
 * KENAPA (audit 05 Okt 2026): tidak ada mekanisme backup sama sekali. Bila data
 * terhapus/rusak, tidak ada pemulihan. Endpoint ini mengekspor tabel penting
 * ke Supabase Storage (bucket `backups`) sebagai JSON terkompresi.
 *
 * CARA PAKAI: panggil dari cron-job.org / GitHub Actions sekali sehari dengan
 * header Authorization: Bearer <CRON_SECRET>.
 *
 * KEAMANAN: butuh CRON_SECRET. Tidak mengembalikan isi data ke pemanggil —
 * hanya ringkasan (jumlah baris, nama file).
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db } from '../../src/db.js';
import { config } from '../../src/env.js';

const TABEL = ['messages', 'reminders', 'notes', 'todos', 'expenses', 'corrections', 'user_profiles'];
const BUCKET = 'backups';

function otorisasi(req: VercelRequest): boolean {
  const auth = String(req.headers.authorization || '');
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const rahasia = config.cronSecret || process.env.CRON_SECRET || '';
  return Boolean(rahasia) && token === rahasia;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (!otorisasi(req)) {
    res.status(401).json({ ok: false, pesan: 'Tidak diizinkan.' });
    return;
  }

  const c = db();
  if (!c) {
    res.status(503).json({ ok: false, pesan: 'Database tidak tersedia.' });
    return;
  }

  const tanggal = new Date().toISOString().slice(0, 10);
  const ringkasan: Record<string, number> = {};
  const gagal: string[] = [];

  for (const tabel of TABEL) {
    try {
      // Ambil maksimum 5000 baris per tabel agar tidak melewati batas memori.
      const { data, error } = await c.from(tabel).select('*').limit(5000);
      if (error || !data) { gagal.push(tabel); continue; }
      ringkasan[tabel] = data.length;

      const isi = JSON.stringify({ tabel, tanggal, jumlah: data.length, data });
      const namaFile = `${tanggal}/${tabel}.json`;

      // Unggah ke Supabase Storage (bucket `backups`).
      const { error: errUp } = await c.storage.from(BUCKET).upload(namaFile, isi, {
        contentType: 'application/json',
        upsert: true,
      });
      if (errUp) gagal.push(`${tabel}(storage)`);
    } catch {
      gagal.push(tabel);
    }
  }

  // Catat ke log server
  console.log(`[backup] ${tanggal} selesai. ringkasan=${JSON.stringify(ringkasan)} gagal=${gagal.join(',') || '-'}`);

  res.status(gagal.length === 0 ? 200 : 207).json({
    ok: gagal.length === 0,
    tanggal,
    tabel_dibackup: ringkasan,
    gagal,
    catatan: gagal.length > 0
      ? 'Sebagian gagal (biasanya karena bucket `backups` belum dibuat di Supabase Storage). Buat bucket bernama `backups` agar backup penuh.'
      : 'Semua tabel berhasil dibackup.',
  });
}
