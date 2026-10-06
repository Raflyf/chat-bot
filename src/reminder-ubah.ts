/**
 * UBAH / UNDUR / BATALKAN PENGINGAT.
 *
 * MASALAH (temuan pemilik produk 05 Okt 2026):
 * "jika user bilang 'waktu rapat di undur 1 jam jadi jam 10 sampai jam 11',
 *  atau hanya bilang 'di undur satu jam', maka apa yg terjadi? apakah bot akan
 *  menghapus yg sebelumnya jam 9 atau akan jadi 2? yg jam 9 tidak terhapus?"
 *
 * SEBELUMNYA: permintaan "undur/geser/batal" LOLOS ke AI -> pengingat lama TETAP
 * ADA, dan AI hanya mengobrol (bisa mengarang "sudah diundur" padahal tidak).
 *
 * SEKARANG: permintaan itu dikenali dan pengingat lama DIUBAH / DIHAPUS —
 * dengan KONFIRMASI lebih dulu agar tidak salah hapus.
 */
import { db } from './db.js';
import { parseWaktuAlami } from './notes.js';
import { kemiripanPesan } from './reminder-dedup.js';

export interface PengingatRingkas {
  id: number;
  message: string;
  due_at: string;
  status: string;
}

export type AksiUbah = 'undur' | 'majukan' | 'geser' | 'batal';

export interface PermintaanUbah {
  aksi: AksiUbah;
  /** Pengingat yang dituju (bila terdeteksi dari isi pesan). */
  target: PengingatRingkas | null;
  /** Waktu baru (bila bisa dihitung). */
  waktuBaru: Date | null;
  /** Selisih menit (untuk "undur 1 jam"). */
  selisihMenit: number | null;
  /** Kata kunci target dari pesan user (mis. "rapat"). */
  kataKunci: string | null;
}

/** Ambil pengingat pending milik chat. */
export async function daftarPengingatPending(chatId: string): Promise<PengingatRingkas[]> {
  const c = db();
  if (!c) return [];
  try {
    const { data } = await c.from('reminders')
      .select('id, message, due_at, status')
      .eq('chat_id', chatId)
      .eq('status', 'pending')
      .order('due_at', { ascending: true })
      .limit(20);
    return (data ?? []) as PengingatRingkas[];
  } catch {
    return [];
  }
}

/** Ubah waktu (dan pesan) pengingat. */
export async function ubahPengingat(id: number, waktuBaru: Date, pesanBaru?: string): Promise<boolean> {
  const c = db();
  if (!c) return false;
  try {
    const patch: Record<string, unknown> = { due_at: waktuBaru.toISOString() };
    if (pesanBaru) patch.message = pesanBaru;
    const { error } = await c.from('reminders').update(patch).eq('id', id).eq('status', 'pending');
    return !error;
  } catch {
    return false;
  }
}

/**
 * Batalkan pengingat dengan MENGHAPUS barisnya.
 *
 * CATATAN (05 Okt 2026): awalnya memakai status 'cancelled', tetapi kolom
 * `status` punya CHECK CONSTRAINT yang hanya mengizinkan
 * pending/processing/sent/failed — update ditolak (kode 23514). Karena
 * pembatalan berarti pengingat TIDAK BOLEH terkirim, menghapus baris adalah
 * cara paling bersih dan tidak butuh migrasi skema.
 */
export async function batalkanPengingat(id: number): Promise<boolean> {
  const c = db();
  if (!c) return false;
  try {
    const { error } = await c.from('reminders').delete().eq('id', id).eq('status', 'pending');
    return !error;
  } catch {
    return false;
  }
}

/**
 * Deteksi permintaan UBAH/UNDUR/BATAL dari teks user.
 * Mengembalikan null bila bukan permintaan ubah.
 */
export function deteksiPermintaanUbah(teks: string): PermintaanUbah | null {
  const asli = teks.trim();
  const s = asli.toLowerCase();

  // Kata pemicu perubahan jadwal.
  const adaUndur = /\b(?:undur|mundur|diundur|dimundur|tunda|ditunda|tolak\s*waktu|perpanjang|molor|telat)\b/.test(s);
  const adaMajukan = /\b(?:majukan|majuin|dimajukan|percepat|dipercepat|lebih\s*awal|lebih\s*cepat|geser\s*ke\s*lebih\s*awal)\b/.test(s);
  const adaGeser = /\b(?:geser|digeser|pindah|dipindah|ubah|diubah|ganti\s*jam|jadwal\s*baru|reschedule|rubah)\b/.test(s);
  // ── DIPERBAIKI (06 Okt 2026) ──
  // BUG: pola lama butuh kata "pengingat"/"reminder" PERSIS setelah "hapus".
  // Akibatnya "hapus jadwal rutin" / "hapus jadwal" TIDAK terdeteksi, sehingga
  // pengingat berulang tetap ada walau user minta menghapusnya (temuan riwayat
  // nyata: bot menjawab "Belum ada jadwal rutin yang tersimpan").
  //
  // SEKARANG: "hapus/buang/hilangkan/cancel" + salah satu objek jadwal
  // (pengingat|reminder|jadwal|rutin|alarm|timer|jadwalnya).
  const adaBatal =
    /\b(?:batal(?:kan|in)?|dibatalkan|cancel)\b/.test(s) ||
    /\b(?:hapus|buang|hilangkan|delete|remove)\s*(?:semua\s+)?(?:pengingat|reminder|jadwal|rutin|alarm|timer|jadwalnya|pengingatnya)\b/.test(s) ||
    // "hapus jadwal rutin" / "hapus pengingat untuk bangun" (objek di TENGAH).
    /\b(?:hapus|buang|hilangkan|delete)\b[\w\s]{0,20}\b(?:pengingat|reminder|jadwal|rutin|alarm|timer)\b/.test(s);

  if (!adaUndur && !adaMajukan && !adaGeser && !adaBatal) return null;

  // Ambil kata kunci target (kata bermakna terpanjang, biasanya nama acara).
  const kataKunci = ambilKataKunciTarget(asli);

  // Hitung selisih: "satu jam", "30 menit", "dua jam", "setengah jam"
  const selisihMenit = hitungSelisihMenit(s);

  // Waktu baru eksplisit: HANYA bila user menyebut jam absolut ("jadi jam 10").
  //
  // BUG YANG DIPERBAIKI (05 Okt 2026): sebelumnya `parseWaktuAlami()` dipanggil
  // tanpa syarat, sehingga "di undur SATU JAM" ikut menghasilkan waktu absolut
  // dari SEKARANG (mis. 00.10) — bukan due_at target + 1 jam. Akibatnya
  // pengingat jam 9 berubah jadi jam 00.10.
  // Sekarang: parse waktu absolut HANYA bila ada penanda "jadi"/"ke" diikuti jam,
  // dan TIDAK ada pola selisih ("satu jam", "30 menit").
  const adaJamAbsolut = /(?:jadi|ke|menjadi|pukul|jam)\s*\d{1,2}(?:[:.]\d{2})?/.test(s) && !/\b(?:undur|mundur|tunda|geser|majukan|majuin|percepat)\s+(?:\d+|satu|dua|tiga|empat|lima|enam|tujuh|delapan|sembilan|sepuluh|sebelas|setengah)?\s*(?:jam|menit)\b/.test(s);
  const waktuBaru = adaJamAbsolut ? parseWaktuAlami(s) : null;

  const aksi: AksiUbah = adaBatal ? 'batal' : adaMajukan ? 'majukan' : adaUndur ? 'undur' : 'geser';

  return { aksi, target: null, waktuBaru, selisihMenit, kataKunci };
}

/** Ambil kata kunci target dari pesan (kata bermakna, bukan kata perintah). */
function ambilKataKunciTarget(teks: string): string | null {
  const ABAI = new Set([
    'undur', 'mundur', 'diundur', 'dimundur', 'tunda', 'ditunda', 'geser', 'digeser',
    'pindah', 'dipindah', 'ubah', 'diubah', 'ganti', 'batal', 'batalkan', 'batalin',
    'dibatalkan', 'cancel', 'majukan', 'majuin', 'dimajukan', 'percepat', 'dipercepat',
    'rapat', 'jadwal', 'waktu', 'pengingat', 'reminder', 'jam', 'menit', 'satu', 'dua',
    'tiga', 'setengah', 'jadi', 'sampai', 'dari', 'yang', 'nya', 'di', 'ke', 'dan',
    'aku', 'saya', 'tolong', 'mohon', 'ya', 'dong', 'itu', 'ini', 'sama', 'buat',
  ]);
  const kata = teks.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !ABAI.has(w) && !/^\d+$/.test(w));
  // Kembalikan kata terpanjang (paling spesifik)
  kata.sort((a, b) => b.length - a.length);
  return kata[0] ?? null;
}

/** Hitung selisih menit dari frasa ("satu jam" -> 60, "30 menit" -> 30). */
function hitungSelisihMenit(teks: string): number | null {
  const ANGKA: Record<string, number> = {
    satu: 1, se: 1, dua: 2, tiga: 3, empat: 4, lima: 5, enam: 6, tujuh: 7,
    delapan: 8, sembilan: 9, sepuluh: 10, sebelas: 11, setengah: 0.5,
  };
  // "satu jam" / "2 jam" / "setengah jam"
  const mJam = teks.match(/\b(\d+(?:[.,]\d+)?|satu|se|dua|tiga|empat|lima|enam|tujuh|delapan|sembilan|sepuluh|sebelas|setengah)\s*jam\b/);
  if (mJam) {
    const n = /^\d/.test(mJam[1]) ? Number(mJam[1].replace(',', '.')) : (ANGKA[mJam[1]] ?? 1);
    return Math.round(n * 60);
  }
  // "30 menit" / "lima belas menit"
  const mMenit = teks.match(/\b(\d+|satu|dua|tiga|empat|lima|enam|tujuh|delapan|sembilan|sepuluh|sebelas|setengah)\s*menit\b/);
  if (mMenit) {
    const n = /^\d/.test(mMenit[1]) ? Number(mMenit[1]) : (ANGKA[mMenit[1]] ?? 1);
    return Math.round(n);
  }
  return null;
}

/** Pilih pengingat yang paling mungkin dituju (berdasarkan kata kunci). */
export function pilihTarget(
  permintaan: PermintaanUbah,
  daftar: PengingatRingkas[],
): PengingatRingkas | null {
  if (daftar.length === 0) return null;
  if (daftar.length === 1) return daftar[0];

  // 1. Cocokkan kata kunci dengan isi pesan (kemiripan + substring)
  if (permintaan.kataKunci) {
    let terbaik: PengingatRingkas | null = null;
    let skor = 0;
    for (const r of daftar) {
      const kmr = kemiripanPesan(permintaan.kataKunci, r.message);
      const sub = r.message.toLowerCase().includes(permintaan.kataKunci) ? 0.5 : 0;
      const total = kmr + sub;
      if (total > skor) { skor = total; terbaik = r; }
    }
    if (terbaik && skor > 0.3) return terbaik;
  }

  // 2. Tidak yakin -> pilih yang paling dekat waktunya (paling awal).
  return daftar[0];
}
