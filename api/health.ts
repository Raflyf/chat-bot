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
import { statistikKirimWa, statusAutoMaintenanceWa, periksaHealthStatusMeta } from '../src/wa_monitor.js';

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

  // 3. Status WhatsApp (mode pemeliharaan manual/otomatis atau operasional).
  //    PENTING: maintenance TIDAK membuat `sehat=false` — bot tetap melayani
  //    Telegram dengan normal. Ini hanya penanda status agar landing page dan
  //    monitoring tidak mengklaim "Online 24/7" untuk WhatsApp saat terblokir.
  const manualMaint = config.whatsappMaintenanceMode;
  if (!manualMaint) {
    await periksaHealthStatusMeta();
  }
  const autoMaint = manualMaint
    ? { aktif: false, alasan: '', sampai: null }
    : await statusAutoMaintenanceWa();
  const waMaintenance = manualMaint || autoMaint.aktif;
  const waMaintSumber: 'manual' | 'otomatis' | null = manualMaint
    ? 'manual'
    : autoMaint.aktif
      ? 'otomatis'
      : null;
  cek.whatsapp = {
    ok: !waMaintenance,
    detail: manualMaint
      ? 'pemeliharaan (manual)'
      : autoMaint.aktif
        ? `pemeliharaan otomatis (${autoMaint.alasan || 'Meta gangguan'})`
        : 'operasional',
  };

  // 4. Statistik pengiriman WhatsApp (monitor kegagalan beruntun).
  //    Angka ini per-instance serverless (reset saat instance dingin), jadi
  //    dipakai sebagai indikator cepat — bukan penghitung kumulatif abadi.
  //    Pemberitahuan ke pemilik tetap dikirim oleh src/wa_monitor.ts.
  let waKirim: { gagal_beruntun: number; gagal_total: number; sukses_total: number } | undefined;
  try {
    const s = statistikKirimWa();
    waKirim = {
      gagal_beruntun: s.gagal_beruntun,
      gagal_total: s.gagal_total,
      sukses_total: s.sukses_total,
    };
  } catch {
    waKirim = undefined;
  }

  const waBackupDigits = String(config.whatsappBackupNumber || '').replace(/\D/g, '');
  const waBackupUrl = waBackupDigits.length >= 8 ? `https://wa.me/${waBackupDigits}` : undefined;

  res.status(sehat ? 200 : 503).json({
    status: sehat ? 'sehat' : 'bermasalah',
    waktu: new Date().toISOString(),
    uptime_detik: Math.round((Date.now() - MULAI) / 1000),
    versi: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || 'lokal',
    whatsapp_maintenance: waMaintenance,
    whatsapp_maintenance_sumber: waMaintSumber,
    ...(autoMaint.aktif ? { whatsapp_maintenance_alasan: autoMaint.alasan } : {}),
    ...(waMaintenance && waBackupUrl ? { whatsapp_backup_url: waBackupUrl } : {}),
    whatsapp_kirim: waKirim,
    cek,
  });
}
