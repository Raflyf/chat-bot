import type TelegramBot from 'node-telegram-bot-api';
import { autoReply } from './skills.js';
import { db } from './db.js';
import { config } from './env.js';
import { kemiripanPesan, AMBANG_MIRIP, TOLERANSI_WAKTU_MENIT } from './reminder-dedup.js';
import { berikutnya, type AturanUlang } from './reminder-repeat.js';
import { normChatId, nomorWhatsApp, baileysChatKey, isGroupChatKey, sharedChatKeyDari } from './chat_id.js';
import { resolveTableName, hasDedicatedGroupTables } from './group_db.js';
import { statusAutoMaintenanceWa } from './wa_monitor.js';

// Re-export agar pemakai lama (cron, baileys) tetap bekerja tanpa perubahan.
export { normChatId, nomorWhatsApp };
import { ambilProfilWaktu } from './user-profile.js';

export interface ReminderItem {
  id: number;
  chat_id: string;
  message: string;
  due_at: string;
  status: 'pending' | 'processing' | 'sent' | 'failed';
  platform?: 'telegram' | 'whatsapp';
  lease_until?: string | null;
  /** Kapan pengingat dibuat (dipakai agar AI tidak mengarang "kemarin"). */
  created_at?: string | null;
}

/** Simpan reminder ke Supabase untuk persistensi Vercel Serverless & Cron. */
/**
 * Waktu jatuh tempo dipakai APA ADANYA (tanpa pembulatan).
 *
 * CATATAN PERUBAHAN (04 Okt 2026):
 * Versi sebelumnya membulatkan due_at ke awal menit. Setelah disimulasikan
 * (20.000 sampel), cara itu KALAH dibanding strategi "due_at tepat + endpoint
 * menunggu sebentar":
 *   bulat + tunggu 20s : rata-rata 21,9s | median 21,7s
 *   tepat + tunggu 20s : rata-rata 15,0s | median  9,9s  <- LEBIH BAIK
 * Karena itu pembulatan dibatalkan; ketepatan ditangani oleh mekanisme
 * "tunggu sebentar" di checkDueReminders().
 */
function waktuJatuhTempo(dueAt: Date): Date {
  return dueAt;
}
export interface HasilSimpanReminder {
  /** Berhasil disimpan / diperbarui. */
  ok: boolean;
  /** 'baru' = ditambahkan, 'digabung' = pengingat lama diperbarui (anti-dobel). */
  aksi: 'baru' | 'digabung' | 'gagal';
  /** Pesan pengingat final yang tersimpan. */
  pesan: string;
  /** Untuk pesan balasan ke user (jujur soal apa yang terjadi). */
  keterangan: string;
}

export async function saveReminderToDb(
  chatId: string,
  message: string,
  dueAt: Date,
  platform: 'telegram' | 'whatsapp' = 'telegram',
): Promise<boolean> {
  // NORMALISASI agar chat_id konsisten dengan `messages` (lihat normChatId).
  const hasil = await simpanReminderCerdas(normChatId(chatId, platform), message, dueAt, platform);
  return hasil.ok;
}

/**
 * Simpan pengingat dengan DETEKSI DUPLIKAT.
 *
 * MASALAH (temuan pemilik produk 05 Okt 2026):
 *   "misal ingatkan besok jam 9 ada rapat, lalu beberapa jam kemudian user
 *    mengingatkan lagi 'jangan lupa besok jam 9 ada rapat', itu gimana?
 *    apakah akan double atau di replace?"
 * -> SEBELUMNYA: DOUBLE. User minta hal sama 3x -> dapat 3 pengingat.
 *
 * SEKARANG: bila waktu sama (selisih <= 5 menit) DAN isi mirip, pengingat lama
 * DIPERBARUI (tidak dobel). Bila isi berbeda (mis. "antar anak"), tetap dibuat
 * pengingat TERPISAH karena memang dua hal berbeda.
 *
 * Laporan jujur ke user: "sudah ada, saya perbarui" vs "ditambahkan".
 */
export async function simpanReminderCerdas(
  chatId: string,
  message: string,
  dueAt: Date,
  platform: 'telegram' | 'whatsapp' = 'telegram',
  ulang?: { repeat_kind: string; repeat_value: string | null },
): Promise<HasilSimpanReminder> {
  // NORMALISASI: pastikan chat_id konsisten dengan `messages` (lihat normChatId).
  chatId = normChatId(chatId, platform === 'telegram' ? 'telegram' : 'whatsapp');
  if (platform === 'whatsapp' && isGroupChatKey(chatId)) {
    message = tandaiPengingatBaileysEksklusif(message);
  }
  const c = db();
  if (!c) return { ok: false, aksi: 'gagal', pesan: message, keterangan: 'Database tidak tersedia.' };
  const dueIso = waktuJatuhTempo(dueAt).toISOString();
  const remTbl = await resolveTableName('reminders', chatId);

  try {
    // 1. Cari pengingat PENDING yang waktunya dekat (<= TOLERANSI menit).
    const batas = new Date(new Date(dueIso).getTime() + TOLERANSI_WAKTU_MENIT * 60_000).toISOString();
    const batasBawah = new Date(new Date(dueIso).getTime() - TOLERANSI_WAKTU_MENIT * 60_000).toISOString();
    const { data: dekat } = await c.from(remTbl)
      .select('id, message, due_at')
      .eq('chat_id', chatId)
      .eq('status', 'pending')
      .gte('due_at', batasBawah)
      .lte('due_at', batas)
      .limit(10);

    // 2. Cari yang isinya paling mirip.
    let palingMirip: { id: number; message: string } | null = null;
    let skorTerbaik = 0;
    const cleanNew = bersihkanTeksPengingat(message);
    for (const r of (dekat ?? []) as Array<{ id: number; message: string }>) {
      const cleanOld = bersihkanTeksPengingat(r.message);
      const skor = kemiripanPesan(cleanNew, cleanOld);
      if (skor > skorTerbaik) { skorTerbaik = skor; palingMirip = r; }
    }

    // 2b. Khusus pengingat interval (mis. "setiap 25 menit ON"): due_at baru bisa terpaut > 5 menit
    //     dari pengingat interval pending yang sudah ada. Cari ulang semua interval_minutes pending
    //     agar pengingat interval bernama sama memperbarui yang lama, bukan menjadi ganda.
    if (skorTerbaik < AMBANG_MIRIP && ulang?.repeat_kind === 'interval_minutes') {
      const { data: intervalRows } = await c.from(remTbl)
        .select('id, message, due_at')
        .eq('chat_id', chatId)
        .eq('status', 'pending')
        .eq('repeat_kind', 'interval_minutes')
        .limit(20);
      for (const r of (intervalRows ?? []) as Array<{ id: number; message: string }>) {
        const cleanOld = bersihkanTeksPengingat(r.message);
        const skor = kemiripanPesan(cleanNew, cleanOld);
        if (skor > skorTerbaik) { skorTerbaik = skor; palingMirip = r; }
      }
    }

    // 3. Sangat mirip / mirip -> PERBARUI (anti-dobel).
    if (palingMirip && skorTerbaik >= AMBANG_MIRIP) {
      // Pilih pesan yang lebih INFORMATIF (lebih panjang) agar tidak kehilangan detail.
      const cleanOld = bersihkanTeksPengingat(palingMirip.message);
      const cleanFinal = cleanNew.length >= cleanOld.length ? cleanNew : cleanOld;
      const isStrict =
        adalahPengingatBaileysEksklusif(message) ||
        adalahPengingatBaileysEksklusif(palingMirip.message);
      const pesanFinal = isStrict
        ? tandaiPengingatBaileysEksklusif(cleanFinal)
        : adalahPengingatBaileys(message)
          ? tandaiPengingatBaileys(cleanFinal)
          : cleanFinal;
      // ── PERBAIKAN AUDIT 14 Okt 2026: IKUT PERBARUI ATURAN BERULANG ──
      // BUG LAMA: merge hanya menulis `message` & `due_at`, TIDAK menyentuh
      // `repeat_kind`/`repeat_value`. Akibatnya:
      //   (a) user menyimpan ulang "tiap hari minum obat" -> aturan berulang BARU
      //       DIABAIKAN (pengingat tetap sekali-jalan);
      //   (b) bila baris lama sudah berulang lalu user menambah pengingat
      //       sekali-jalan yang mirip -> pengingat itu IKUT BERULANG.
      // Balasan tetap berkata "sudah saya perbarui, tidak dobel" -> menyesatkan.
      const patch: Record<string, unknown> = { message: pesanFinal, due_at: dueIso };
      if (ulang) {
        // Permintaan BARU punya aturan berulang -> terapkan.
        patch.repeat_kind = ulang.repeat_kind;
        patch.repeat_value = ulang.repeat_value;
      } else {
        // Permintaan BARU tidak berulang -> matikan aturan berulang yang lama
        // agar pengingat sekali-jalan tidak ikut berulang (kolom NOT NULL DEFAULT 'none').
        patch.repeat_kind = 'none';
        patch.repeat_value = null;
      }
      const { error } = await c.from(remTbl).update(patch).eq('id', palingMirip.id);
      if (!error) {
        return {
          ok: true,
          aksi: 'digabung',
          pesan: cleanFinal,
          keterangan: `Pengingat ini sudah ada (${cleanOld}), sudah saya perbarui, tidak dobel.`,
        };
      }
      // Gagal update -> jatuh ke insert biasa di bawah
    }

    // 3b. Cek BENTROK dengan pengingat lain pada waktu yang sama/berdekatan.
    //     Bukan duplikat (isinya beda), tapi waktunya bertabrakan -> beri tahu user
    //     supaya dia sadar ada dua agenda berdekatan. Tetap DISIMPAN (bukan ditolak),
    //     karena user mungkin memang ingin dua pengingat.
    let peringatanBentrok = '';
    const daftarDekat = (dekat ?? []) as Array<{ id: number; message: string; due_at?: string }>;
    if (daftarDekat.length > 0) {
      const namaDekat = daftarDekat.map((r) => {
        const jam = r.due_at
          ? new Date(r.due_at).toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' })
          : '?';
        return `"${bersihkanTeksPengingat(r.message)}" (${jam})`;
      });
      peringatanBentrok = `\n\n⚠️ _Catatan: waktunya berdekatan dengan pengingat lain, ${namaDekat.join(', ')}. Pastikan tidak bentrok ya._`;
    }

    // 4. Baru / berbeda -> simpan sebagai pengingat baru.
    //    Kolom berulang (v27) disertakan HANYA bila ada, supaya tetap bekerja
    //    walau migrasi v27 belum dijalankan (fallback: insert tanpa kolom itu).
    const barisDasar: Record<string, unknown> = {
      chat_id: chatId, message, due_at: dueIso, status: 'pending', platform,
    };
    const barisUlang = ulang && ulang.repeat_kind && ulang.repeat_kind !== 'none'
      ? { ...barisDasar, repeat_kind: ulang.repeat_kind, repeat_value: ulang.repeat_value }
      : barisDasar;

    let { error } = await c.from(remTbl).insert(barisUlang);
    // Fallback: kolom v27 belum ada (kode PGRST204 / 42703) -> insert tanpa kolom itu.
    const kolomTidakAda = (e: unknown): boolean => {
      const kode = (e as { code?: string })?.code || '';
      const pesan = String((e as { message?: string })?.message || '');
      return kode === 'PGRST204' || kode === '42703' || /repeat_kind|column/i.test(pesan);
    };
    if (error && barisUlang !== barisDasar && kolomTidakAda(error)) {
      const retry = await c.from(remTbl).insert(barisDasar);
      error = retry.error;
    }
    if (error) return { ok: false, aksi: 'gagal', pesan: cleanNew, keterangan: 'Gagal menyimpan pengingat.' };
    return {
      ok: true,
      aksi: 'baru',
      pesan: cleanNew,
      keterangan: palingMirip
        ? `Pengingat ditambahkan (beda dengan "${bersihkanTeksPengingat(palingMirip.message)}" yang sudah ada).${peringatanBentrok}`
        : peringatanBentrok.trim(),
    };
  } catch {
    // Fallback: insert langsung (perilaku lama) agar tetap tersimpan.
    try {
      const cleanMsg = bersihkanTeksPengingat(message);
      const { error } = await c.from(remTbl).insert({
        chat_id: chatId, message, due_at: dueIso, status: 'pending', platform,
      });
      return error
        ? { ok: false, aksi: 'gagal', pesan: cleanMsg, keterangan: 'Gagal menyimpan pengingat.' }
        : { ok: true, aksi: 'baru', pesan: cleanMsg, keterangan: '' };
    } catch {
      return { ok: false, aksi: 'gagal', pesan: bersihkanTeksPengingat(message), keterangan: 'Gagal menyimpan pengingat.' };
    }
  }
}

/**
 * Teks pengingat CADANGAN (tanpa AI), dipakai HANYA bila AI gagal/timeout.
 *
 * MASALAH YANG DIPERBAIKI (04 Okt 2026, protes pemilik produk):
 * Versi sebelumnya mengirim `item.message` APA ADANYA saat AI gagal, sehingga
 * user menerima pesan aneh seperti cuma "login" atau "buat masak nasi" -
 * tanpa penanda bahwa itu pengingat. User: "jangan gitu dong, jadi aneh kalo
 * gitu responnya".
 *
 * Sekarang cadangan ini menyusun kalimat yang tetap WAJAR dibaca, dengan
 * penyesuaian sederhana pada isi pesan (bukan template kaku satu bentuk):
 *   "login"           -> "⏰ Pengingat: Login"
 *   "buat masak nasi" -> "⏰ Pengingat: Buat masak nasi"
 *   "waktunya login"  -> "⏰ Waktunya login"        (tidak diulang "waktunya")
 *   "jangan lupa obat"-> "⏰ Jangan lupa obat"       (tidak diulang "jangan lupa")
 */
/** Penanda asal kanal pengingat Baileys (zero-width space anti-gangguan). */
export const BAILEYS_REMINDER_MARKER = '\u200B';
/** Penanda pengingat eksklusif Baileys — tidak boleh diambil alih Cloud API saat terlambat. */
export const BAILEYS_STRICT_MARKER = '\u200C';

export function tandaiPengingatBaileys(pesan: string): string {
  const p = String(pesan || '');
  return p.includes(BAILEYS_REMINDER_MARKER) ? p : `${p}${BAILEYS_REMINDER_MARKER}`;
}

export function tandaiPengingatBaileysEksklusif(pesan: string): string {
  const p = tandaiPengingatBaileys(pesan);
  return p.includes(BAILEYS_STRICT_MARKER) ? p : `${p}${BAILEYS_STRICT_MARKER}`;
}

export function adalahPengingatBaileys(pesan: string): boolean {
  const s = String(pesan ?? '');
  return s.includes(BAILEYS_REMINDER_MARKER) || s.includes(BAILEYS_STRICT_MARKER);
}

export function adalahPengingatBaileysEksklusif(pesan: string): boolean {
  return String(pesan ?? '').includes(BAILEYS_STRICT_MARKER);
}

export function bersihkanTeksPengingat(pesan: string): string {
  return String(pesan ?? '').replace(/[\u200B\u200C]/g, '');
}

/** Batas keterlambatan pengingat Baileys sebelum diambil alih Cloud API (failover bila VPS mati). */
export const BAILEYS_FALLBACK_KE_CLOUD_MS = 60_000;
/** Batas keterlambatan pengingat Cloud API sebelum diambil alih Baileys (failover gangguan senyap). */
export const CLOUD_FALLBACK_KE_BAILEYS_MS = 180_000;
/** Batas toleransi keterlambatan pengingat GRUP sebelum dilewati/dilompat ke jadwal berikutnya. */
export const GROUP_REMINDER_MAX_LATE_MS = 30 * 60 * 1000;
/**
 * Margin aman jendela layanan 24 jam Meta WhatsApp Cloud API (23 jam 30 menit).
 * Di luar jendela ini Meta menolak teks biasa secara asinkron (error 131047) walau
 * `POST /messages` sempat membalas HTTP 200 — sehingga jalur Cloud harus menyerahkan
 * pengingat ke WhatsApp Baileys yang tidak dibatasi 24 jam.
 */
export const META_CLOUD_24H_WINDOW_MS = (23 * 60 + 30) * 60 * 1000;

/**
 * True bila pengingat milik GRUP dan sudah terlewat lebih dari `maxLateMs` (default 30 menit),
 * sehingga tidak perlu dikirim terlambat saat VPS baru menyala kembali.
 */
export function adalahPengingatGrupKadaluarsa(
  item: { chat_id?: string; due_at?: string },
  nowMs = Date.now(),
  maxLateMs = GROUP_REMINDER_MAX_LATE_MS,
): boolean {
  if (!isGroupChatKey(item.chat_id)) return false;
  const dueMs = new Date(String(item.due_at ?? '')).getTime();
  if (!Number.isFinite(dueMs)) return false;
  return nowMs - dueMs > maxLateMs;
}

export interface OpsiFilterKanalPengingat {
  channelFilter?: 'baileys_only' | 'cloud_only' | 'all';
  nowMs?: number;
  cloudMaintenance?: boolean;
  /** True bila tidak ada pesan masuk user di WA Cloud dalam 23,5 jam terakhir (risiko 131047). */
  cloudWindowExpired?: boolean;
}

/**
 * Menentukan apakah satu baris pengingat boleh diproses oleh worker/cron tertentu.
 * Memisahkan rute Baileys vs Cloud API sambil menyediakan failover dua arah,
 * termasuk handover otomatis ke Baileys bila jendela 24 jam Meta Cloud API sudah habis.
 */
export function bolehProsesKanalPengingat(
  item: { chat_id?: string; message?: string; due_at?: string; platform?: string },
  opsi: OpsiFilterKanalPengingat = {},
): boolean {
  if (!opsi.channelFilter || opsi.channelFilter === 'all') return true;
  const isTelegram = String(item.platform ?? '').toLowerCase() === 'telegram';
  // Pengingat grup WhatsApp tidak didukung Cloud API Meta — selalu wajib diproses Baileys.
  if (!isTelegram && isGroupChatKey(item.chat_id)) {
    return opsi.channelFilter === 'baileys_only';
  }
  const isBaileys = adalahPengingatBaileys(String(item.message ?? ''));
  const nowMs = opsi.nowMs ?? Date.now();
  const dueMs = new Date(String(item.due_at ?? 0)).getTime();
  const telatMs = Number.isFinite(dueMs) ? nowMs - dueMs : 0;

  if (opsi.channelFilter === 'baileys_only') {
    if (isTelegram) return false;
    if (isBaileys || opsi.cloudMaintenance || opsi.cloudWindowExpired) return true;
    return telatMs > CLOUD_FALLBACK_KE_BAILEYS_MS;
  }

  // opsi.channelFilter === 'cloud_only'
  if (isTelegram) return true;
  if (opsi.cloudMaintenance || opsi.cloudWindowExpired) return false;
  if (!isBaileys) return true;
  if (adalahPengingatBaileysEksklusif(String(item.message ?? ''))) return false;
  return telatMs > BAILEYS_FALLBACK_KE_CLOUD_MS;
}

const cloud24hHandoffLoggedAt = new Map<number, number>();

/**
 * Periksa apakah tiap `chat_id` WA privat memiliki pesan masuk (`role='user'`) di jalur
 * WA Cloud (`wa_<nomor>`) dalam `META_CLOUD_24H_WINDOW_MS` terakhir (23,5 jam).
 * - Map value `true`  = jendela 24 jam Meta SUDAH HABIS (harus diserahkan ke Baileys).
 * - Map value `false` = jendela 24 jam Meta MASIH TERBUKA (atau error DB -> fail-open).
 */
async function cekJendelaCloud24JamKadaluarsa(
  client: NonNullable<ReturnType<typeof db>>,
  rows: Array<Record<string, unknown>>,
  nowMs: number,
): Promise<Map<string, boolean>> {
  const hasil = new Map<string, boolean>();
  const keys = new Set<string>();
  for (const r of rows) {
    const p = String((r as { platform?: string }).platform ?? '').toLowerCase();
    if (p === 'telegram') continue;
    const rawChat = String((r as { chat_id?: string }).chat_id ?? '');
    if (!rawChat || isGroupChatKey(rawChat)) continue;
    const cloudKey = sharedChatKeyDari(rawChat);
    if (cloudKey && !isGroupChatKey(cloudKey)) keys.add(cloudKey);
  }
  if (keys.size === 0) return hasil;

  const cutoffIso = new Date(nowMs - META_CLOUD_24H_WINDOW_MS).toISOString();
  await Promise.all(
    Array.from(keys).map(async (cloudKey) => {
      try {
        const { data, error } = await client
          .from('messages')
          .select('id')
          .eq('chat_id', cloudKey)
          .eq('role', 'user')
          .gte('created_at', cutoffIso)
          .limit(1);
        if (error) return; // fail-open bila DB bermasalah
        hasil.set(cloudKey, !data || data.length === 0);
      } catch {
        // fail-open
      }
    }),
  );
  return hasil;
}

function teksPengingatCadangan(pesan: string): string {
  const p = bersihkanTeksPengingat(pesan).trim().replace(/\s+/g, ' ');
  if (!p) return '⏰ Pengingat!';
  // Bila isi pesan sudah mengandung kata pengingat/waktu, jangan diulang.
  if (/^(pengingat|waktu|ingat|jangan lupa|jgn lupa)\b/i.test(p)) {
    return `⏰ ${p}`;
  }
  return `⏰ Pengingat: ${p}`;
}

/**
 * Susun teks pengingat ringkas dan lugas (audit 20 Nov 2026).
 * Sesuai arahan pemilik: tanpa basa-basi AI ("ini pengingatmu yang tadi", dll),
 * cukup format konsisten: "⏰ Pengingat: <isi>" atau "⏰ <isi>" bila sudah berawalan pengingat/waktu.
 */
async function susunTeksPengingat(
  item: { message: string; due_at: string; created_at?: string | null },
): Promise<string> {
  return teksPengingatCadangan(item.message);
}

/**
 * Cek dan kirim semua reminder yang jatuh tempo dengan atomic claim (CAS).
 * Mencegah duplikasi pesan saat cron dan worker berjalan beriringan.
 */

/** Zona waktu untuk sebuah chat (dari profil user, fallback WIB). */
async function zonaWaktuChat(chatId: string): Promise<string> {
  try {
    const p = await ambilProfilWaktu(chatId);
    return p?.timezone || 'Asia/Jakarta';
  } catch {
    return 'Asia/Jakarta';
  }
}

/** Hitung jadwal jatuh tempo berikutnya (lewat dari `sekarangMs`) untuk pengingat berulang. */
function hitungJadwalUlangBerikutnya(
  item: {
    due_at: string;
    repeat_kind?: string;
    repeat_value?: string | null;
    repeat_until?: string | null;
    repeat_count?: number;
  },
  sekarangMs: number,
  zona: string,
): Date | null {
  const kindUlang = item.repeat_kind && item.repeat_kind !== 'none' ? item.repeat_kind : 'none';
  if (kindUlang === 'none') return null;

  const aturan: AturanUlang = {
    repeat_kind: kindUlang as AturanUlang['repeat_kind'],
    repeat_value: item.repeat_value ?? null,
    repeat_until: item.repeat_until ?? null,
    repeat_count: item.repeat_count ?? 0,
  };
  let next = berikutnya(new Date(item.due_at), aturan, zona);
  let iterasi = 0;
  if (kindUlang === 'interval_minutes' && next && next.getTime() <= sekarangMs) {
    const stepMs = Math.max(1, Math.round(Number(item.repeat_value) || 0)) * 60_000;
    const lompat = Math.floor((sekarangMs - next.getTime()) / stepMs) + 1;
    next = new Date(next.getTime() + lompat * stepMs);
    if (aturan.repeat_until && next.getTime() > new Date(aturan.repeat_until).getTime()) {
      next = null;
    }
  } else {
    while (next && next.getTime() <= sekarangMs && iterasi < 30) {
      next = berikutnya(next, aturan, zona);
      iterasi++;
    }
  }
  return next;
}

export async function checkDueReminders(
  sendFn: (chatId: string, text: string, platform?: 'telegram' | 'whatsapp') => Promise<unknown>,
  platformFilter?: 'whatsapp' | 'telegram',
  options?: {
    channelFilter?: 'baileys_only' | 'cloud_only' | 'all';
    allowWait?: boolean;
  },
): Promise<number> {
  const c = db();
  if (!c) return 0;
  try {
    const filterKanalAktif =
      options?.channelFilter === 'baileys_only' || options?.channelFilter === 'cloud_only';
    let cloudMaintenance: boolean | undefined;
    if (filterKanalAktif) {
      const autoMaint = await statusAutoMaintenanceWa().catch(() => ({ aktif: false, alasan: '', sampai: null }));
      cloudMaintenance = config.whatsappMaintenanceMode === true || autoMaint.aktif;
    }

    const useGroupTable = await hasDedicatedGroupTables();

    // ── TUNGGU SEBENTAR BILA ADA PENGINGAT YANG HAMPIR JATUH TEMPO ──
    const TUNGGU_MAKS_MS = options?.allowWait === false ? 0 : 20_000;
    if (TUNGGU_MAKS_MS > 0) {
    try {
      const cekBolehUntukKanal = (
        row: Record<string, unknown>,
        nowMs: number,
        expiredMap?: Map<string, boolean>,
      ): boolean => {
        const p = String((row as { platform?: string }).platform ?? '').toLowerCase();
        if (platformFilter && p !== platformFilter && p !== '') return false;
        if (!filterKanalAktif || !options?.channelFilter) return true;
        const rawChat = String((row as { chat_id?: string }).chat_id ?? '');
        const cloudKey = rawChat && !isGroupChatKey(rawChat) ? sharedChatKeyDari(rawChat) : '';
        const cloudWindowExpired = cloudKey ? expiredMap?.get(cloudKey) === true : false;
        return bolehProsesKanalPengingat(
          row as { chat_id?: string; message?: string; due_at?: string; platform?: string },
          { channelFilter: options.channelFilter, nowMs, cloudMaintenance, cloudWindowExpired },
        );
      };

      const nowIso = new Date().toISOString();
      const queriesTelat = [
        c.from('reminders').select('id, chat_id, message, due_at, platform').eq('status', 'pending').lte('due_at', nowIso).limit(filterKanalAktif || platformFilter ? 20 : 1),
        ...(useGroupTable ? [c.from('group_reminders').select('id, chat_id, message, due_at, platform').eq('status', 'pending').lte('due_at', nowIso).limit(filterKanalAktif || platformFilter ? 20 : 1)] : []),
      ];
      const resTelat = await Promise.all(queriesTelat);
      const sudahTelatRows = resTelat.flatMap((r) => (r.data ?? []) as Array<Record<string, unknown>>);
      const nowCekMs = Date.now();
      const expiredTelat =
        filterKanalAktif && !cloudMaintenance
          ? await cekJendelaCloud24JamKadaluarsa(c, sudahTelatRows, nowCekMs)
          : undefined;
      const adaYangTelat = sudahTelatRows.some((r) => cekBolehUntukKanal(r, nowCekMs, expiredTelat));

      if (!adaYangTelat) {
        const batasCek = new Date(Date.now() + TUNGGU_MAKS_MS + 2000).toISOString();
        const queriesHampir = [
          c.from('reminders').select('chat_id, due_at, message, platform').eq('status', 'pending').gt('due_at', nowIso).lte('due_at', batasCek).order('due_at', { ascending: true }).limit(filterKanalAktif || platformFilter ? 20 : 1),
          ...(useGroupTable ? [c.from('group_reminders').select('chat_id, due_at, message, platform').eq('status', 'pending').gt('due_at', nowIso).lte('due_at', batasCek).order('due_at', { ascending: true }).limit(filterKanalAktif || platformFilter ? 20 : 1)] : []),
        ];
        const resHampir = await Promise.all(queriesHampir);
        const hampirRows = resHampir.flatMap((r) => (r.data ?? []) as Array<Record<string, unknown>>);
        const expiredHampir =
          filterKanalAktif && !cloudMaintenance && hampirRows.length > 0
            ? await cekJendelaCloud24JamKadaluarsa(c, hampirRows, Date.now())
            : undefined;
        const hampirList = hampirRows
          .filter((r) => {
            if (!filterKanalAktif && !platformFilter) return true;
            const p = String((r as { platform?: string }).platform ?? '').toLowerCase();
            if (platformFilter && p !== platformFilter && p !== '') return false;
            if (!filterKanalAktif) return true;
            const chatIdRow = String((r as { chat_id?: string }).chat_id ?? '');
            const msgRow = String((r as { message?: string }).message ?? '');
            if (options?.channelFilter === 'cloud_only' && ((p !== 'telegram' && isGroupChatKey(chatIdRow)) || adalahPengingatBaileysEksklusif(msgRow))) {
              return false;
            }
            if (options?.channelFilter === 'cloud_only' && p !== 'telegram' && cloudMaintenance) {
              return false;
            }
            if (options?.channelFilter === 'baileys_only' && p === 'telegram') {
              return false;
            }
            const dueMs = new Date(String((r as { due_at?: string }).due_at ?? '')).getTime();
            return Number.isFinite(dueMs)
              ? cekBolehUntukKanal(r, dueMs + 1_000, expiredHampir)
              : true;
          })
          .sort((a, b) => new Date(String(a.due_at ?? 0)).getTime() - new Date(String(b.due_at ?? 0)).getTime());
        const terdekat = hampirList[0] as { due_at?: string } | undefined;
        if (terdekat?.due_at) {
          const selisih = new Date(terdekat.due_at).getTime() - Date.now();
          if (selisih > 0 && selisih <= TUNGGU_MAKS_MS) {
            console.log(`[remind] Menunggu ${Math.round(selisih / 1000)}s agar pengingat terkirim tepat waktu.`);
            await new Promise((r) => setTimeout(r, selisih + 200)); // +200ms margin
          }
        }
      }
    } catch {
      // best-effort: bila gagal, lanjut tanpa menunggu
    }
    }

    const prosesTabelPengingat = async (remTable: 'reminders' | 'group_reminders'): Promise<number> => {
      const client = c;
      const now = new Date().toISOString();

      // 1. Reaper lease_until
      const { error: reapErr1 } = await client
        .from(remTable)
        .update({ status: 'pending', lease_until: null })
        .eq('status', 'processing')
        .lte('lease_until', now);
      if (reapErr1) {
        console.error(`[remind] reaper ${remTable} lease_until GAGAL:`, reapErr1.message);
      }

      const staleThreshold = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      const { error: reapErr2 } = await client
        .from(remTable)
        .update({ status: 'pending', lease_until: null })
        .eq('status', 'processing')
        .is('lease_until', null)
        .lte('due_at', staleThreshold);
      if (reapErr2) {
        console.error(`[remind] reaper ${remTable} fallback GAGAL:`, reapErr2.message);
      }

      // 2. Ambil pengingat yang jatuh tempo
      const KOLOM_DASAR = 'id, chat_id, message, due_at, status, platform, lease_until, created_at';
      const KOLOM_LENGKAP = `${KOLOM_DASAR}, repeat_kind, repeat_value, repeat_until, repeat_count`;
      let data: Array<Record<string, unknown>> | null = null;
      let error: unknown = null;
      {
        const h1 = await client
          .from(remTable)
          .select(KOLOM_LENGKAP)
          .eq('status', 'pending')
          .lte('due_at', now)
          .order('due_at', { ascending: true })
          .limit(50);
        if (!h1.error) {
          data = (h1.data ?? []) as Array<Record<string, unknown>>;
        } else {
          const h2 = await client
            .from(remTable)
            .select(KOLOM_DASAR)
            .eq('status', 'pending')
            .lte('due_at', now)
            .order('due_at', { ascending: true })
            .limit(50);
          data = (h2.data ?? []) as Array<Record<string, unknown>>;
          error = h2.error;
        }
      }

      if (error || !data || data.length === 0) return 0;

      if (platformFilter) {
        data = data.filter((r) => {
          const p = String((r as { platform?: string }).platform ?? '').toLowerCase();
          return p === platformFilter || p === '';
        });
        if (data.length === 0) return 0;
      }

      if (filterKanalAktif && options?.channelFilter) {
        const nowMs = Date.now();
        const filter = options.channelFilter;
        const expiredMap =
          remTable === 'reminders' && !cloudMaintenance
            ? await cekJendelaCloud24JamKadaluarsa(client, data, nowMs)
            : undefined;
        data = data.filter((r) => {
          const row = r as { id?: number; chat_id?: string; message?: string; due_at?: string; platform?: string };
          const rawChat = String(row.chat_id ?? '');
          const cloudKey = rawChat && !isGroupChatKey(rawChat) ? sharedChatKeyDari(rawChat) : '';
          const cloudWindowExpired = cloudKey ? expiredMap?.get(cloudKey) === true : false;
          const allowed = bolehProsesKanalPengingat(row, {
            channelFilter: filter,
            nowMs,
            cloudMaintenance,
            cloudWindowExpired,
          });
          if (!allowed && filter === 'cloud_only' && cloudWindowExpired && typeof row.id === 'number') {
            const lastLog = cloud24hHandoffLoggedAt.get(row.id) || 0;
            if (nowMs - lastLog > 15 * 60_000) {
              cloud24hHandoffLoggedAt.set(row.id, nowMs);
              console.log(
                `[remind] Lewati WA Cloud #${row.id} (${cloudKey}): di luar jendela 24 jam Meta — diserahkan ke jalur Baileys.`,
              );
            }
          }
          return allowed;
        });
        if (data.length === 0) return 0;
      }

      let processed = 0;
      for (const itemRaw of data) {
        const item = itemRaw as unknown as ReminderItem & { repeat_kind?: string; repeat_value?: string | null; repeat_until?: string | null; repeat_count?: number };
        const leaseExpiry = new Date(Date.now() + 10 * 60 * 1000).toISOString();
        let claimSuccess = false;

        const { data: claimed, error: claimErr } = await client
          .from(remTable)
          .update({ status: 'processing', lease_until: leaseExpiry })
          .eq('id', item.id)
          .eq('status', 'pending')
          .select('id');

        if (!claimErr && claimed && claimed.length > 0) {
          claimSuccess = true;
        } else if (claimErr) {
          const { data: directClaim, error: directErr } = await client
            .from(remTable)
            .update({ status: 'processing' })
            .eq('id', item.id)
            .eq('status', 'pending')
            .select('id');

          if (!directErr && directClaim && directClaim.length > 0) {
            claimSuccess = true;
          }
        }

        if (!claimSuccess) {
          continue;
        }

        const kindUlang = item.repeat_kind && item.repeat_kind !== 'none' ? item.repeat_kind : 'none';
        if ((remTable === 'group_reminders' || isGroupChatKey(item.chat_id)) && adalahPengingatGrupKadaluarsa(item)) {
          try {
            if (kindUlang !== 'none') {
              const zona = await zonaWaktuChat(item.chat_id);
              const next = hitungJadwalUlangBerikutnya(item, Date.now(), zona);
              if (next) {
                await client.from(remTable).update({
                  due_at: next.toISOString(),
                  status: 'pending',
                  lease_until: null,
                }).eq('id', item.id);
                console.log(`[remind] pengingat grup berulang #${item.id} terlewat >30 menit — dilewati & dimajukan ke ${next.toISOString()}.`);
              } else {
                await client.from(remTable).update({ status: 'failed', lease_until: null }).eq('id', item.id);
                console.log(`[remind] pengingat grup #${item.id} terlewat >30 menit — dilewati tanpa kirim telat.`);
              }
            } else {
              await client.from(remTable).update({ status: 'failed', lease_until: null }).eq('id', item.id);
              console.log(`[remind] pengingat grup #${item.id} terlewat >30 menit — dilewati tanpa kirim telat.`);
            }
          } catch (skipErr) {
            console.warn(`[remind] gagal melompati pengingat grup #${item.id}:`, skipErr);
            await client.from(remTable).update({ status: 'pending', lease_until: null }).eq('id', item.id);
          }
          continue;
        }

        try {
          const deliveryText = await susunTeksPengingat({
            message: item.message,
            due_at: item.due_at,
            created_at: item.created_at,
          });

          const hasilKirim = await sendFn(item.chat_id, deliveryText, item.platform);
          if (hasilKirim === false) {
            throw new Error('PENGIRIMAN_GAGAL');
          }

          try {
            const { saveMessage } = await import('./db.js');
            const targetHistoryChatId =
              options?.channelFilter === 'baileys_only' && item.platform !== 'telegram'
                ? baileysChatKey(item.chat_id)
                : item.chat_id;
            await saveMessage({
              platform: item.platform === 'telegram' ? 'telegram' : 'whatsapp',
              chat_id: targetHistoryChatId,
              role: 'assistant',
              content: deliveryText,
              via: 'reminder',
            });
            const { updateContextCache } = await import('./memory.js');
            updateContextCache(targetHistoryChatId, 'assistant', deliveryText);
          } catch (simpanErr) {
            console.warn('[remind] gagal simpan pesan pengingat ke riwayat:', simpanErr);
          }

          if (kindUlang !== 'none') {
            const zona = await zonaWaktuChat(item.chat_id);
            const next = hitungJadwalUlangBerikutnya(item, Date.now(), zona);
            if (next) {
              await client.from(remTable).update({
                due_at: next.toISOString(),
                status: 'pending',
                lease_until: null,
                repeat_count: (item.repeat_count ?? 0) + 1,
              }).eq('id', item.id);
            } else {
              await client.from(remTable).update({ status: 'sent', lease_until: null }).eq('id', item.id);
            }
          } else {
            await client.from(remTable).update({ status: 'sent', lease_until: null }).eq('id', item.id);
          }
          processed++;
        } catch (err) {
          console.error(`[remind] gagal kirim reminder id ${item.id} (${remTable}):`, err);
          const iniBerulang = item.repeat_kind && item.repeat_kind !== 'none';
          if (iniBerulang) {
            await client.from(remTable).update({ status: 'pending', lease_until: null }).eq('id', item.id);
            console.warn(`[remind] pengingat berulang #${item.id} akan dicoba lagi (status dikembalikan ke pending).`);
          } else {
            const dueMs = new Date(String((item as { due_at?: string }).due_at ?? '')).getTime();
            const masihDalamJendela = Number.isFinite(dueMs) && Date.now() - dueMs < 30 * 60_000;
            if (masihDalamJendela) {
              await client.from(remTable).update({ status: 'pending', lease_until: null }).eq('id', item.id);
              console.warn(`[remind] pengingat #${item.id} gagal terkirim — akan dicoba lagi (jendela 30 menit).`);
            } else {
              await client.from(remTable).update({ status: 'failed', lease_until: null }).eq('id', item.id);
              console.error(`[remind] pengingat #${item.id} GAGAL PERMANEN (lewat jendela percobaan ulang).`);
            }
          }
        }
      }
      return processed;
    };

    const totalPrivate = await prosesTabelPengingat('reminders');
    const totalGroup = useGroupTable ? await prosesTabelPengingat('group_reminders') : 0;
    return totalPrivate + totalGroup;
  } catch (err) {
    console.error('[remind] error checkDueReminders:', err);
    return 0;
  }
}

/**
 * Reminder handler:
 * 1. Simpan ke database Supabase (tabel reminders) agar persisten di Vercel.
 * 2. Pasang in-memory timer HANYA jika database tidak tersedia saat running local.
 * 3. Balasan konfirmasi dinamis via AI.
 */
export async function handleRemind(
  bot: TelegramBot,
  chatId: number,
  args: string,
  platform: 'telegram' | 'whatsapp' = 'telegram',
  senderName?: string,
): Promise<void> {
  const m = args.trim().match(/^(\d+)\s+([\s\S]+)/);
  if (!m) {
    const { reply } = await autoReply(
      'User salah format perintah pengingat (tidak ada angka menit dan pesan). Jelaskan format yang benar: /remind <menit> <pesan>, dengan satu contoh singkat dan ramah.',
    );
    if (reply.trim()) await bot.sendMessage(chatId, reply);
    return;
  }

  const minutes = Number(m[1]);
  const rawMessage = m[2].trim().slice(0, 500);
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 43200 || !rawMessage) {
    const { reply } = await autoReply(
      `User salah format perintah pengingat (menit="${m[1]}"). Jelaskan syaratnya (angka 1-43200 + pesan) dengan satu contoh singkat dan ramah.`,
    );
    if (reply.trim()) await bot.sendMessage(chatId, reply);
    return;
  }

  const message = senderName ? `[Pengingat untuk ${senderName}]: ${rawMessage}` : rawMessage;
  // PRESISI (06 Okt 2026): bulatkan ke awal menit lalu -5 detik, agar cron
          // per menit mengirim TEPAT WAKTU (bukan ngaret 1 menit karena detik).
          const dueAt = (() => {
            const d = new Date(Date.now() + minutes * 60_000);
            // Bulatkan ke BAWAH ke awal menit (TANPA -5 detik) agar MENIT yang
            // ditampilkan == MENIT pengiriman. Cron per menit dieksekusi sedikit
            // setelah detik 0, sehingga `due_at <= now` tetap terpenuhi tepat waktu.
            d.setSeconds(0, 0);
            return d;
          })();
  const dbSaved = await saveReminderToDb(String(chatId), message, dueAt, platform);

  // In-memory fallback HANYA jika DB tidak tersedia untuk mencegah pesan dobel
  if (!config.isServerless && !dbSaved) {
    setTimeout(() => {
      void (async () => {
        try {
          const gen = await autoReply(
            `Sampaikan pengingat ini ke user dengan gayamu sendiri, singkat dan hangat, tanpa pertanyaan tambahan: "${rawMessage}"`,
          );
          await bot.sendMessage(chatId, gen.reply.trim() || rawMessage);
        } catch {
          await bot.sendMessage(chatId, rawMessage).catch(() => undefined);
        }
      })();
    }, minutes * 60_000);
  }

  const promptConfirm = senderName
    ? `Konfirmasi singkat dan hangat: pengingat "${rawMessage}" untuk ${senderName} telah dicatat dan akan dikirim ${minutes} menit lagi di grup.`
    : `Konfirmasi singkat dan hangat: pengingat "${rawMessage}" telah dicatat dan akan dikirim ${minutes} menit lagi.`;

  const { reply } = await autoReply(promptConfirm);
  if (reply.trim()) await bot.sendMessage(chatId, reply);
}

let workerInterval: NodeJS.Timeout | null = null;

/**
 * Worker lokal untuk memproses reminder tiap 30 detik saat bot dijalankan di terminal.
 * WAJIB menghormati `platform`, chat_id WhatsApp (mis. '62812...') tidak boleh dikirim
 * ke Telegram (Number('62812...') menargetkan chat id Telegram yang salah, misdelivery).
 * sendWhatsApp opsional agar pemanggil WhatsApp-only tidak perlu impor Telegram.
 */
export function startReminderWorker(
  bot: TelegramBot,
  sendWhatsApp?: (chatId: string, text: string) => Promise<unknown>,
): void {
  if (config.isServerless || workerInterval) return;
  workerInterval = setInterval(() => {
    void checkDueReminders(async (chatId, text, platform) => {
      // WAJIB mengembalikan status: checkDueReminders menganggap kirim GAGAL
      // hanya bila nilai balik === false (audit 14 Okt 2026).
      if (platform === 'whatsapp') {
        if (isGroupChatKey(chatId) || !sendWhatsApp) {
          console.warn(`[remind] Reminder WhatsApp dilewati (${isGroupChatKey(chatId) ? 'grup hanya Baileys' : 'tanpa sender WA'}): ${chatId}`);
          return false; // JANGAN tandai terkirim — biar worker Baileys/cron yang mengirim
        }
        // chat_id dari DB bisa berprefix "wa_" -> kirim nomor TELANJANG ke Meta.
        return await sendWhatsApp(nomorWhatsApp(chatId), text);
      }
      // Telegram (atau platform belum tercatat): kirim via bot Telegram.
      // Bersihkan prefix "wa_"/"tg_" dulu — kalau tidak, Number() menjadi NaN
      // dan pengiriman GAGAL (temuan audit universal 09 Okt 2026).
      try {
        await bot.sendMessage(Number(String(chatId).replace(/^(?:wa_|tg_)/, '')), text);
        return true;
      } catch (e) {
        console.error('[remind] gagal kirim telegram:', e);
        return false;
      }
    });
  }, 30_000);
}
