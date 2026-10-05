/**
 * DETEKSI DUPLIKAT PENGINGAT.
 *
 * MASALAH (temuan pemilik produk 05 Okt 2026):
 * "misal ingatkan besok jam 9 ada rapat, lalu beberapa jam kemudian user
 *  mengingatkan lagi, jangan lupa besok jam 9 ada rapat, nah itu gimana?"
 * -> Sebelumnya: DOBEL. User minta hal sama 3x, dapat 3 pengingat.
 *
 * STRATEGI (bukan sekadar "kalau sama persis, tolak"):
 * 1. Bandingkan pada WAKTU YANG SAMA (selisih <= 5 menit dianggap waktu sama).
 * 2. Bila waktu sama, bandingkan ISI pesan dengan kemiripan teks (Dice coefficient
 *    pada kata bermakna, setelah kata perintah/filler dibuang):
 *      - Sangat mirip (>= 0.75) -> GABUNG (perbarui pesan bila lebih jelas).
 *      - Mirip sedang (0.45-0.75) -> tanya user? (untuk sekarang: perbarui pesan,
 *        karena hampir pasti pengingat yang sama dengan kalimat berbeda).
 *      - Tidak mirip (< 0.45) -> BEDA pengingat, simpan terpisah
 *        (mis. "jam 9 rapat" dan "jam 9 antar anak" -> dua pengingat berbeda).
 * 3. Hasil akhir dilaporkan jujur ke user: "sudah ada, saya perbarui" / "ditambahkan".
 */

/** Kata yang tidak bermakna untuk perbandingan (dibuang sebelum menghitung kemiripan). */
const KATA_ABAIKAN = new Set([
  'jangan', 'lupa', 'ingat', 'ingatkan', 'ingetin', 'tolong', 'mohon', 'ya', 'yah', 'dong',
  'nih', 'sih', 'deh', 'aku', 'saya', 'kamu', 'gue', 'gw', 'kita', 'ada', 'adalah', 'itu',
  'ini', 'yang', 'untuk', 'buat', 'di', 'ke', 'dari', 'pada', 'dan', 'atau', 'sama', 'juga',
  'besok', 'lusa', 'nanti', 'hari', 'jam', 'pukul', 'pagi', 'siang', 'sore', 'malam',
  'subuh', 'menit', 'detik', 'lagi', 'kemudian', 'kedepan', 'nya', 'kan', 'lah', 'pun',
]);

/** Normalisasi teks: huruf kecil, buang tanda baca, buang angka & kata abaikan. */
export function normalisasiUntukBanding(teks: string): string[] {
  return teks
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !KATA_ABAIKAN.has(w) && !/^\d+$/.test(w));
}

/**
 * Kemiripan dua pesan (0..1) memakai Dice coefficient pada kata bermakna.
 * Tahan terhadap urutan kata dan kata tambahan ("jangan lupa ... ada rapat").
 */
export function kemiripanPesan(a: string, b: string): number {
  const wa = normalisasiUntukBanding(a);
  const wb = normalisasiUntukBanding(b);
  if (wa.length === 0 && wb.length === 0) return 1;
  if (wa.length === 0 || wb.length === 0) return 0;

  const setA = new Set(wa);
  const setB = new Set(wb);
  let sama = 0;
  for (const w of setA) if (setB.has(w)) sama++;
  return (2 * sama) / (setA.size + setB.size);
}

/** Selisih waktu dianggap "waktu yang sama" (menit). */
export const TOLERANSI_WAKTU_MENIT = 5;

/** Ambang kemiripan untuk dianggap pengingat yang SAMA. */
export const AMBANG_GABUNG = 0.75;
export const AMBANG_MIRIP = 0.45;
