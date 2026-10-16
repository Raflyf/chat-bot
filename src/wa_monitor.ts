/**
 * MONITOR PENGIRIMAN WHATSAPP
 *
 * KENAPA ADA:
 *   Saat akun WhatsApp Cloud API terblokir Meta (mis. payment method belum
 *   tertaut -> error 141006), API tetap membalas HTTP 200 untuk sebagian
 *   permintaan sehingga bot TIDAK sadar pesannya tidak pernah sampai. Akibatnya
 *   jawaban hanya menumpuk di dataset sementara pengguna tidak menerima apa pun,
 *   dan tidak ada yang memberi tahu pemilik.
 *
 * YANG DILAKUKAN:
 *   - Menghitung kegagalan pengiriman BERTURUT-TURUT.
 *   - Setelah mencapai ambang, mengirim notifikasi ke Telegram PEMILIK
 *     (jalur andal, tanpa batas 24 jam) — meniru pola `probeKunciCloudflare`
 *     yang sudah dipakai untuk memantau kredensial.
 *   - Mengirim satu notifikasi "pulih" ketika pengiriman kembali normal.
 *   - Membatasi frekuensi notifikasi agar tidak spam (jeda minimum 6 jam).
 *
 * PENTING: modul ini TIDAK PERNAH melempar error ke pemanggil. Kegagalan
 * notifikasi tidak boleh mengganggu alur balasan chat.
 */
import { config } from './env.js';

/** Berapa kegagalan beruntun sebelum pemilik diberi tahu. */
const AMBANG_GAGAL_BERUNTUN = 3;
/** Jeda minimum antar notifikasi kegagalan (6 jam). */
const JEDA_NOTIF_MS = 6 * 60 * 60 * 1000;

let gagalBeruntun = 0;
let suksesTotal = 0;
let gagalTotal = 0;
let terakhirNotifMs = 0;
let notifSedangDikirim = false;

/** Statistik ringkas untuk health/monitoring (tanpa data sensitif). */
export function statistikKirimWa(): {
  gagal_beruntun: number;
  gagal_total: number;
  sukses_total: number;
  terakhir_notif_ms: number;
} {
  return {
    gagal_beruntun: gagalBeruntun,
    gagal_total: gagalTotal,
    sukses_total: suksesTotal,
    terakhir_notif_ms: terakhirNotifMs,
  };
}

/** Kirim pesan ke Telegram pemilik (jalur andal). */
async function kirimNotifPemilik(teks: string): Promise<boolean> {
  if (!config.telegramToken || !config.ownerChatId) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${config.telegramToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: config.ownerChatId, text: teks, parse_mode: 'Markdown' }),
      signal: AbortSignal.timeout(8000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Catat hasil satu percobaan pengiriman WhatsApp.
 * Aman dipanggil dengan `void` (fire-and-forget) — tidak pernah melempar.
 */
export async function catatHasilKirimWa(berhasil: boolean, detail?: string): Promise<void> {
  try {
    if (berhasil) {
      suksesTotal += 1;
      if (gagalBeruntun >= AMBANG_GAGAL_BERUNTUN) {
        console.log(`[wa-monitor] Pengiriman WhatsApp PULIH setelah ${gagalBeruntun} kegagalan beruntun.`);
        void kirimNotifPemilik(
          `✅ *WhatsApp pulih*\nPengiriman kembali normal setelah ${gagalBeruntun} kegagalan beruntun.`,
        );
      }
      gagalBeruntun = 0;
      return;
    }

    gagalBeruntun += 1;
    gagalTotal += 1;

    if (gagalBeruntun < AMBANG_GAGAL_BERUNTUN) return;
    const sekarang = Date.now();
    if (sekarang - terakhirNotifMs < JEDA_NOTIF_MS) return;
    if (notifSedangDikirim) return;

    terakhirNotifMs = sekarang;
    notifSedangDikirim = true;
    try {
      const terkirim = await kirimNotifPemilik(
        `⚠️ *WhatsApp gagal kirim ${gagalBeruntun}× berturut-turut*\n` +
          `Kemungkinan penyebab: payment method Meta belum tertaut (error 141006) atau limit akun.\n` +
          `Cek: WhatsApp Manager → Billing & payments.\n` +
          (detail ? `Detail: ${String(detail).slice(0, 200)}\n` : '') +
          `Aktifkan \`WHATSAPP_MAINTENANCE_MODE=true\` bila ingin mode pemeliharaan.`,
      );
      if (!terkirim) {
        console.warn('[wa-monitor] Notifikasi pemilik gagal dikirim (Telegram tidak dikonfigurasi / error).');
      }
    } finally {
      notifSedangDikirim = false;
    }
  } catch (err) {
    // Monitor TIDAK boleh mengganggu alur chat.
    console.warn('[wa-monitor] error tak terduga:', String((err as Error)?.message ?? err).slice(0, 160));
  }
}
