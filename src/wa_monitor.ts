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
import { db } from './db.js';
import { setCooldown, hapusCooldown } from './cooldown.js';

/** Berapa kegagalan beruntun sebelum pemilik diberi tahu. */
const AMBANG_GAGAL_BERUNTUN = 3;
/** Jeda minimum antar notifikasi kegagalan (6 jam). */
const JEDA_NOTIF_MS = 6 * 60 * 60 * 1000;
/** Durasi auto-maintenance untuk gangguan sementara / tidak merespon (15 menit). */
const TTL_SEMENTARA_MS = 15 * 60 * 1000;
/** Durasi auto-maintenance untuk blokir akun / token / pembayaran Meta (60 menit). */
const TTL_BLOKIR_AKUN_MS = 60 * 60 * 1000;
/** TTL cache pembacaan status auto-maintenance dari DB agar tidak query setiap pesan. */
const CACHE_SYNC_MS = 15_000;
/** TTL probe Graph API `?fields=health_status` (5 menit). */
const PROBE_HEALTH_TTL_MS = 5 * 60 * 1000;

const COOLDOWN_KIND_WA = 'whatsapp_cloud';
const COOLDOWN_KEY_META = 'meta';
const ENTITAS_KRITIS_HEALTH = new Set(['WABA', 'PHONE_NUMBER', 'APP']);

export interface MetaErrorInfo {
  httpStatus?: number;
  metaCode?: number;
  networkError?: boolean;
  message?: string;
}

export type KategoriErrorMeta = 'abaikan' | 'sementara' | 'blokir_akun';

/** Error per-penerima / input — BUKAN gangguan Meta, tidak boleh menyalakan maintenance. */
const KODE_ABAIKAN = new Set([131047, 131026, 131051, 131052, 131056, 131009, 100]);
/** Error blokir akun / pembayaran / auth Meta — langsung nyalakan auto-maintenance. */
const KODE_BLOKIR_AKUN = new Set([141006, 131042, 131031, 190, 368, 131048]);
/** Error layanan / rate limit Meta sementara — nyalakan setelah ambang beruntun. */
const KODE_SEMENTARA = new Set([131016, 130429, 131000]);

let gagalBeruntun = 0;
let suksesTotal = 0;
let gagalTotal = 0;
let terakhirNotifMs = 0;
let notifSedangDikirim = false;

let gagalMetaBeruntun = 0;
let autoMaintUntilMs = 0;
let autoMaintAlasan = '';
let autoMaintSyncedAtMs = 0;
let terakhirAutoNotifMs = 0;
let terakhirProbeHealthMs = 0;

/**
 * Klasifikasikan error dari Meta Graph API / webhook status delivery saja.
 * Error per-penerima (mis. 131047 lewat jendela 24 jam) dikembalikan sebagai 'abaikan'.
 */
export function klasifikasiErrorMeta(err?: MetaErrorInfo): KategoriErrorMeta {
  if (!err) return 'sementara';
  if (typeof err.metaCode === 'number') {
    if (KODE_BLOKIR_AKUN.has(err.metaCode)) return 'blokir_akun';
    if (KODE_ABAIKAN.has(err.metaCode)) return 'abaikan';
    if (KODE_SEMENTARA.has(err.metaCode)) return 'sementara';
  }
  if (err.httpStatus === 401 || err.httpStatus === 403) return 'blokir_akun';
  if (err.networkError) return 'sementara';
  if (typeof err.httpStatus === 'number') {
    if (err.httpStatus === 429 || err.httpStatus >= 500) return 'sementara';
    if (err.httpStatus >= 400) return 'sementara';
  }
  return 'sementara';
}

function formatAlasanMeta(err?: MetaErrorInfo): string {
  if (!err) return 'Meta Cloud API gagal';
  const bagian: string[] = [];
  if (typeof err.metaCode === 'number') bagian.push(`kode Meta ${err.metaCode}`);
  if (typeof err.httpStatus === 'number') bagian.push(`HTTP ${err.httpStatus}`);
  if (err.networkError) bagian.push('Meta tidak merespon / timeout');
  if (err.message && bagian.length === 0) bagian.push(err.message.slice(0, 120));
  return bagian.join(', ') || 'Meta Cloud API gagal';
}

/** Reset state in-memory untuk keperluan unit test. */
export function resetMonitorWaUntukTest(): void {
  gagalBeruntun = 0;
  suksesTotal = 0;
  gagalTotal = 0;
  terakhirNotifMs = 0;
  notifSedangDikirim = false;
  gagalMetaBeruntun = 0;
  autoMaintUntilMs = 0;
  autoMaintAlasan = '';
  autoMaintSyncedAtMs = 0;
  terakhirAutoNotifMs = 0;
  terakhirProbeHealthMs = 0;
}

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

async function simpanAutoMaintenance(untilMs: number, alasan: string): Promise<void> {
  autoMaintUntilMs = untilMs;
  autoMaintAlasan = alasan;
  autoMaintSyncedAtMs = Date.now();
  setCooldown(COOLDOWN_KIND_WA, COOLDOWN_KEY_META, untilMs, '', alasan);
  const c = db();
  if (!c) return;
  try {
    await c.rpc('set_provider_cooldown', {
      p_kind: COOLDOWN_KIND_WA,
      p_key_hash: COOLDOWN_KEY_META,
      p_model: '',
      p_until: new Date(untilMs).toISOString(),
      p_alasan: alasan.slice(0, 160),
    });
  } catch {
    // best-effort: fallback in-memory tetap berjalan
  }
}

async function bersihkanAutoMaintenance(sumberPulih: string): Promise<void> {
  const cekSaatIni = await statusAutoMaintenanceWa();
  const duluAktif = cekSaatIni.aktif || autoMaintUntilMs > Date.now();
  autoMaintUntilMs = 0;
  autoMaintAlasan = '';
  autoMaintSyncedAtMs = Date.now();
  hapusCooldown(COOLDOWN_KIND_WA, COOLDOWN_KEY_META, '');
  if (!duluAktif) return;

  const c = db();
  if (c) {
    try {
      await c
        .from('provider_cooldown')
        .delete()
        .eq('kind', COOLDOWN_KIND_WA)
        .eq('key_hash', COOLDOWN_KEY_META)
        .eq('model', '');
    } catch {
      // best-effort
    }
  }
  console.log(`[wa-monitor] Auto-maintenance WhatsApp PULIH (${sumberPulih}).`);
  void kirimNotifPemilik(
    `✅ *Auto-maintenance WhatsApp dimatikan*\nKoneksi Meta kembali normal (${sumberPulih}).`,
  );
}

/**
 * Periksa apakah auto-maintenance Cloud API sedang aktif (lintas instance via Supabase `provider_cooldown`).
 */
export async function statusAutoMaintenanceWa(): Promise<{
  aktif: boolean;
  alasan: string;
  sampai: string | null;
}> {
  const sekarang = Date.now();
  if (autoMaintUntilMs > sekarang) {
    return {
      aktif: true,
      alasan: autoMaintAlasan,
      sampai: new Date(autoMaintUntilMs).toISOString(),
    };
  }
  if (sekarang - autoMaintSyncedAtMs < CACHE_SYNC_MS) {
    return { aktif: false, alasan: '', sampai: null };
  }

  autoMaintSyncedAtMs = sekarang;
  const c = db();
  if (!c) return { aktif: false, alasan: '', sampai: null };

  try {
    const { data, error } = await c
      .from('provider_cooldown')
      .select('until_at, alasan')
      .eq('kind', COOLDOWN_KIND_WA)
      .eq('key_hash', COOLDOWN_KEY_META)
      .eq('model', '')
      .gt('until_at', new Date(sekarang).toISOString())
      .maybeSingle();

    if (!error && data?.until_at) {
      const until = new Date(String(data.until_at)).getTime();
      if (until > sekarang) {
        autoMaintUntilMs = until;
        autoMaintAlasan = String(data.alasan || 'Meta gangguan');
        return {
          aktif: true,
          alasan: autoMaintAlasan,
          sampai: new Date(until).toISOString(),
        };
      }
    }
    autoMaintUntilMs = 0;
    autoMaintAlasan = '';
  } catch {
    // best-effort: kembalikan status memori
  }
  return { aktif: false, alasan: '', sampai: null };
}

async function aktifkanBlokirAutoMaintenance(alasanBlokir: string): Promise<void> {
  const alasan = alasanBlokir.startsWith('blokir:') ? alasanBlokir : `blokir:${alasanBlokir}`;
  const untilMs = Date.now() + TTL_BLOKIR_AKUN_MS;
  await simpanAutoMaintenance(untilMs, alasan);
  const sekarang = Date.now();
  if (sekarang - terakhirAutoNotifMs >= JEDA_NOTIF_MS) {
    terakhirAutoNotifMs = sekarang;
    void kirimNotifPemilik(
      `🛡️ *Auto-maintenance WhatsApp AKTIF (60 menit)*\n` +
        `Meta menolak pengiriman: ${alasan.replace(/^blokir:/, '')}.\n` +
        `Bot WA utama dijeda otomatis agar hemat kuota AI (bot cadangan & Telegram tetap aktif).`,
    );
  }
}

async function prosesKegagalanMeta(metaErr?: MetaErrorInfo): Promise<void> {
  const kategori = klasifikasiErrorMeta(metaErr);
  if (kategori === 'abaikan') return;

  const detail = formatAlasanMeta(metaErr);
  if (kategori === 'blokir_akun') {
    gagalMetaBeruntun += 1;
    await aktifkanBlokirAutoMaintenance(detail);
    return;
  }

  gagalMetaBeruntun += 1;
  if (gagalMetaBeruntun < AMBANG_GAGAL_BERUNTUN) return;

  const alasan = `sementara:${detail}`;
  const untilMs = Date.now() + TTL_SEMENTARA_MS;
  await simpanAutoMaintenance(untilMs, alasan);
  const sekarang = Date.now();
  if (sekarang - terakhirAutoNotifMs >= JEDA_NOTIF_MS) {
    terakhirAutoNotifMs = sekarang;
    void kirimNotifPemilik(
      `🛡️ *Auto-maintenance WhatsApp AKTIF (15 menit)*\n` +
        `Meta gagal/tidak merespon ${gagalMetaBeruntun}× beruntun (${detail}).\n` +
        `Bot WA utama dijeda sementara dan akan pulih otomatis saat Meta merespon lagi.`,
    );
  }
}

/**
 * Evaluasi respons `?fields=health_status` dari Meta Graph API.
 * Mengabaikan `can_receive_call_sip: BLOCKED` dan `can_send_message: LIMITED`;
 * hanya menganggap terblokir bila `can_send_message === 'BLOCKED'` pada entitas pengiriman.
 */
export function evaluasiHealthStatusMeta(payload: unknown): { blocked: boolean; reason?: string } {
  if (!payload || typeof payload !== 'object') return { blocked: false };
  const root = payload as {
    health_status?: {
      can_send_message?: unknown;
      entities?: Array<{
        entity_type?: unknown;
        can_send_message?: unknown;
        errors?: Array<{ error_code?: unknown; error_description?: unknown }>;
      }>;
    };
    can_send_message?: unknown;
    entities?: Array<{
      entity_type?: unknown;
      can_send_message?: unknown;
      errors?: Array<{ error_code?: unknown; error_description?: unknown }>;
    }>;
  };
  const hs = root.health_status ?? root;
  if (!hs || typeof hs !== 'object') return { blocked: false };

  const entities = Array.isArray(hs.entities) ? hs.entities : [];
  for (const ent of entities) {
    const tipe = String(ent?.entity_type ?? '').toUpperCase();
    if (!ENTITAS_KRITIS_HEALTH.has(tipe)) continue;
    if (String(ent?.can_send_message ?? '').toUpperCase() === 'BLOCKED') {
      const err0 = Array.isArray(ent.errors) ? ent.errors[0] : undefined;
      const kode = err0?.error_code;
      const suffix = kode !== undefined && kode !== null ? ` (kode ${kode})` : ` (${tipe})`;
      return { blocked: true, reason: `blokir:health_status BLOCKED${suffix}` };
    }
  }

  if (String(hs.can_send_message ?? '').toUpperCase() === 'BLOCKED') {
    return { blocked: true, reason: 'blokir:health_status BLOCKED' };
  }

  return { blocked: false };
}

/**
 * Probe periodik (cache 5 menit) ke Meta Graph API `?fields=health_status`
 * untuk mendeteksi blokir akun (mis. 141006) meski `POST /messages` membalas HTTP 200.
 */
export async function periksaHealthStatusMeta(force = false): Promise<void> {
  if (!force && process.env.NODE_ENV === 'test') return;
  if (!config.whatsappToken || !config.whatsappPhoneNumberId) return;
  const sekarang = Date.now();
  if (!force && sekarang - terakhirProbeHealthMs < PROBE_HEALTH_TTL_MS) return;

  terakhirProbeHealthMs = sekarang;
  try {
    const res = await fetch(
      `https://graph.facebook.com/v21.0/${config.whatsappPhoneNumberId}?fields=health_status`,
      {
        headers: { Authorization: `Bearer ${config.whatsappToken}` },
        signal: AbortSignal.timeout(3500),
      },
    );
    if (res.status === 401 || res.status === 403) {
      await aktifkanBlokirAutoMaintenance(`blokir:HTTP ${res.status} (health_status)`);
      return;
    }
    if (!res.ok) return;

    const json = await res.json().catch(() => null);
    const hasil = evaluasiHealthStatusMeta(json);
    if (hasil.blocked) {
      await aktifkanBlokirAutoMaintenance(hasil.reason || 'blokir:health_status BLOCKED');
      return;
    }
    const saatIni = await statusAutoMaintenanceWa();
    if (saatIni.aktif && saatIni.alasan.startsWith('blokir:')) {
      await bersihkanAutoMaintenance('health_status Meta kembali aktif');
    }
  } catch (err) {
    console.warn(
      '[wa-monitor] probe health_status Meta gagal:',
      String((err as Error)?.message ?? err).slice(0, 120),
    );
  }
}

/**
 * Catat hasil panggilan sinkron ke Meta Graph API (`graph.facebook.com/.../messages`).
 * HANYA untuk error Meta — jangan dipanggil dari error model AI/LLM.
 * HTTP 200 tidak membersihkan status `blokir:` (karena Meta tetap balas 200 saat 141006).
 */
export async function catatHasilKirimMeta(berhasil: boolean, metaErr?: MetaErrorInfo): Promise<void> {
  try {
    if (berhasil) {
      gagalMetaBeruntun = 0;
      const saatIni = await statusAutoMaintenanceWa();
      if (saatIni.aktif && !saatIni.alasan.startsWith('blokir:')) {
        await bersihkanAutoMaintenance('pengiriman Graph API berhasil');
      }
      return;
    }
    await prosesKegagalanMeta(metaErr);
  } catch (err) {
    console.warn('[wa-monitor] catatHasilKirimMeta error:', String((err as Error)?.message ?? err).slice(0, 160));
  }
}

/**
 * Catat status delivery asinkron dari webhook Meta (`value.statuses`).
 * Error per-penerima seperti 131047 (lewat 24 jam) diabaikan otomatis.
 */
export async function catatStatusDeliveryMeta(
  status: string,
  errors?: Array<{ code?: number; title?: string; message?: string }>,
): Promise<void> {
  try {
    if (status === 'delivered' || status === 'read') {
      gagalMetaBeruntun = 0;
      await bersihkanAutoMaintenance(`status delivery ${status}`);
      return;
    }
    if (status !== 'failed') return;
    const first = Array.isArray(errors) ? errors[0] : undefined;
    await prosesKegagalanMeta({
      metaCode: typeof first?.code === 'number' ? first.code : undefined,
      message: first?.message || first?.title,
    });
  } catch (err) {
    console.warn('[wa-monitor] catatStatusDeliveryMeta error:', String((err as Error)?.message ?? err).slice(0, 160));
  }
}
