/**
 * ENDPOINT HEALTH CHECK — /api/health
 *
 * KENAPA: sebelumnya tidak ada cara cepat memeriksa apakah sistem hidup dan
 * komponennya sehat. Dengan endpoint ini, uptime monitor gratis (UptimeRobot,
 * BetterStack, dsb) bisa memantau dan memberi tahu bila ada yang mati.
 *
 * KEAMANAN: TIDAK membocorkan data sensitif. Hanya status boolean/ringkas.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db } from '../src/db.js';
import { config } from '../src/env.js';

const MULAI = Date.now();

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  const cek: Record<string, { ok: boolean; detail?: string }> = {};
  let sehat = true;

  // 1. Database (komponen paling penting)
  try {
    const c = db();
    if (!c) {
      cek.database = { ok: false, detail: 'tidak terkonfigurasi' };
      sehat = false;
    } else {
      const t0 = Date.now();
      const { error } = await c.from('messages').select('id', { count: 'exact', head: true }).limit(1);
      const ms = Date.now() - t0;
      if (error) {
        cek.database = { ok: false, detail: 'query gagal' };
        sehat = false;
      } else {
        cek.database = { ok: true, detail: `${ms}ms` };
      }
    }
  } catch {
    cek.database = { ok: false, detail: 'exception' };
    sehat = false;
  }

  // 2. Provider terkonfigurasi (tanpa membocorkan key)
  try {
    const pools = config.pools as unknown as Record<string, string[]>;
    const jumlah = Object.entries(pools)
      .filter(([, v]) => Array.isArray(v) && v.length > 0);
    cek.provider = { ok: jumlah.length > 0, detail: `${jumlah.length} aktif` };
    if (jumlah.length === 0) sehat = false;
  } catch {
    cek.provider = { ok: false, detail: 'tidak terbaca' };
    sehat = false;
  }

  res.status(sehat ? 200 : 503).json({
    status: sehat ? 'sehat' : 'bermasalah',
    waktu: new Date().toISOString(),
    uptime_detik: Math.round((Date.now() - MULAI) / 1000),
    versi: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || 'lokal',
    cek,
  });
}
