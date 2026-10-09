/**
 * PENGINGAT MULTI-HARI (H-N) — "ingatkan 3, 2, 1 hari sebelum"
 *
 * PERMINTAAN PEMILIK PRODUK (09 Okt 2026):
 *   "reminder setiap 3, 2, 1 hari senelummnya"
 *   "Reminder multi-hari — 'ingatkan 3, 2, 1 hari sebelum' → belum ada fiturnya"
 *
 * MASALAH SEBELUMNYA: bot menjawab "Maaf, fitur pengingat otomatis belum tersedia
 * di sini. Kamu bisa set alarm manual di HP" — padahal bot SUDAH punya sistem
 * pengingat. Yang belum ada hanya varian "beberapa hari SEBELUM acara".
 *
 * CARA KERJA:
 *   1. Deteksi pola "ingatkan N hari sebelum <acara> <tanggal>" (N bisa beberapa:
 *      "3, 2, 1 hari sebelum", "H-3 dan H-1", "2 hari sebelumnya", dll).
 *   2. Tentukan tanggal acara utama (pakai parseWaktuAlami yang sudah diperkuat).
 *   3. Simpan SATU pengingat utama (pada tanggal acara) + beberapa pengingat
 *      persiapan H-N (mis. 3 hari sebelum, 2 hari sebelum, 1 hari sebelum).
 *   4. Setiap pengingat diberi penanda H-N di pesannya agar jelas saat dikirim.
 *
 * PENTING: modul ini TIDAK menyentuh prompt/persona. Ia hanya menambah data
 * pengingat di database, memakai fungsi simpan yang sudah ada.
 */

/** Hasil deteksi permintaan multi-hari. */
export interface PermintaanMultiHari {
  /** Jarak hari sebelum acara, urut menurun (mis. [3, 2, 1]). */
  hariSebelum: number[];
  /** Tanggal acara utama. */
  tanggalAcara: Date;
  /** Nama acara (mis. "latihan badminton"). */
  namaAcara: string;
  /** Apakah user juga ingin diingatkan pada hari-H (biasanya ya). */
  ingatHariH: boolean;
}

const BULAN_ID: Record<string, number> = {
  januari: 1, jan: 1, februari: 2, feb: 2, maret: 3, mar: 3, april: 4, apr: 4,
  mei: 5, may: 5, juni: 6, jun: 6, juli: 7, jul: 7, agustus: 8, agu: 8, ags: 8, aug: 8,
  september: 9, sep: 9, sept: 9, oktober: 10, okt: 10, oct: 10, november: 11, nov: 11,
  desember: 12, des: 12, dec: 12,
};

/** Angka dari kata ("tiga" -> 3) untuk jarak hari. */
const KATA_ANGKA: Record<string, number> = {
  satu: 1, dua: 2, tiga: 3, empat: 4, lima: 5, enam: 6, tujuh: 7,
  delapan: 8, sembilan: 9, sepuluh: 10, sepekan: 7, seminggu: 7,
};

function keAngka(teks: string): number | null {
  const t = teks.trim().toLowerCase();
  if (/^\d+$/.test(t)) return Number(t);
  return KATA_ANGKA[t] ?? null;
}

/**
 * Deteksi permintaan "ingatkan N hari sebelum ...".
 * Mengembalikan null bila bukan permintaan multi-hari.
 */
export function deteksiMultiHari(
  teks: string,
  sekarang: Date = new Date(),
  parseWaktu: (t: string, s?: Date) => Date | null,
): PermintaanMultiHari | null {
  if (!teks || typeof teks !== 'string') return null;
  const asli = teks.trim();
  if (asli.length < 8 || asli.length > 400) return null;
  const s = asli.toLowerCase();

  // Harus ada kata "sebelum/sebelumnya/awal/early" ATAU notasi H-N.
  const adaKataSebelum = /\b(?:sebelum(?:nya)?|sebelum\s+acara|awal|jauh\s+hari|h\s*-\s*\d+)\b/i.test(s);
  if (!adaKataSebelum) return null;

  // ── Kumpulkan jarak hari ──
  // Format yang didukung:
  //   "3, 2, 1 hari sebelum"    -> [3,2,1]
  //   "3 2 1 hari sebelumnya"   -> [3,2,1]
  //   "H-3 dan H-1"             -> [3,1]
  //   "2 hari sebelum"          -> [2]
  //   "tiga hari sebelum"       -> [3]
  //   "seminggu sebelum"        -> [7]
  const hari = new Set<number>();

  // (a) notasi H-N
  for (const m of s.matchAll(/\bh\s*-\s*(\d{1,2})\b/gi)) {
    const n = Number(m[1]);
    if (n >= 1 && n <= 60) hari.add(n);
  }

  // (b) deret angka di depan kata "hari sebelum"
  const mDeret = s.match(/([\d,\s]+(?:dan\s+)?[\d\s]*)\s*hari\s*(?:sebelum(?:nya)?|sebelum\s+acara)/i);
  if (mDeret) {
    for (const angka of mDeret[1].match(/\d{1,2}/g) ?? []) {
      const n = Number(angka);
      if (n >= 1 && n <= 60) hari.add(n);
    }
  }

  // (c) angka tunggal / kata angka + "hari sebelum"
  const mTunggal = s.match(/\b(\d{1,2}|satu|dua|tiga|empat|lima|enam|tujuh|delapan|sembilan|sepuluh|sepekan|seminggu)\s*hari\s*(?:sebelum(?:nya)?|sebelum\s+acara)/i);
  if (mTunggal) {
    const n = keAngka(mTunggal[1]);
    if (n && n >= 1 && n <= 60) hari.add(n);
  }

  // (d) "seminggu sebelum" (tanpa kata "hari")
  const mPekan = s.match(/\b(seminggu|sepekan)\s*(?:sebelum(?:nya)?|sebelum\s+acara)/i);
  if (mPekan) hari.add(7);

  if (hari.size === 0) return null;

  // ── Tentukan tanggal acara ──
  // Buang bagian "N hari sebelum" dari teks agar parser tanggal tidak bingung,
  // lalu parse sisa teksnya.
  const teksAcara = asli
    .replace(/\bh\s*-\s*\d{1,2}\b/gi, ' ')
    .replace(/\b\d{1,2}\s*(?:,\s*\d{1,2}\s*)*(?:dan\s+\d{1,2}\s*)?hari\s*(?:sebelum(?:nya)?|sebelum\s+acara)/gi, ' ')
    .replace(/\b(?:satu|dua|tiga|empat|lima|enam|tujuh|delapan|sembilan|sepuluh|sepekan|seminggu)\s*hari\s*(?:sebelum(?:nya)?|sebelum\s+acara)/gi, ' ')
    .replace(/\b(?:seminggu|sepekan)\s*(?:sebelum(?:nya)?|sebelum\s+acara)/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  const tanggalAcara = parseWaktu(teksAcara, sekarang) ?? parseWaktu(asli, sekarang);
  if (!tanggalAcara) return null;

  // ── Tentukan nama acara ──
  // Ambil frasa setelah kata "ingatkan/ingetin/reminder", buang tanggal & jam.
  let namaAcara = teksAcara
    .replace(/^\s*\/?(?:tolong\s+|coba\s+|bisa\s+|boleh\s+)?(?:ingatkan|ingetin|ingat|remind(?:er)?|pengingat)\s*(?:aku|saya|gue|gw|kita)?\s*/i, '')
    .replace(/\b(?:pada|tanggal|tgl|hari|jam|pukul)\s*[:.]?\s*\d{1,2}(?:[:.]\d{2})?\s*(?:pagi|siang|sore|malam|subuh)?/gi, ' ')
    .replace(new RegExp(`\\b\\d{1,2}\\s+(?:${Object.keys(BULAN_ID).join('|')})\\s*\\d{4}\\b`, 'gi'), ' ')
    .replace(new RegExp(`\\b\\d{1,2}\\s+(?:${Object.keys(BULAN_ID).join('|')})\\b`, 'gi'), ' ')
    .replace(/\b(?:senin|selasa|rabu|kamis|jumat|sabtu|minggu)\b/gi, ' ')
    .replace(/\b(?:besok|lusa|hari ini|nanti)\b/gi, ' ')
    // Buang sisa kata sambung/penanda yang menggantung setelah pembersihan
    // (mis. "ingetin aku H-3 dan H-1 sebelum ujian" -> "dan sebelum ujian").
    .replace(/\b(?:dan|atau|serta|juga|sebelum(?:nya)?|sebelum\s+acara|hari|pada|di|ke|untuk|buat)\b/gi, ' ')
    .replace(/^[\s,.:-]+|[\s,.:-]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (namaAcara.length < 3) namaAcara = 'acara';

  // Apakah user juga ingin diingatkan pada hari-H? Default: ya (pengingat utama).
  const ingatHariH = !/\b(?:tanpa|jangan\s+ingatkan)\s+(?:saat|pada|hari)\s*h\b/i.test(s);

  return {
    hariSebelum: [...hari].sort((a, b) => b - a),
    tanggalAcara,
    namaAcara,
    ingatHariH,
  };
}

/**
 * Susun daftar pengingat (tanggal + pesan) dari permintaan multi-hari.
 * Jam pengingat persiapan mengikuti jam acara (agar konsisten), atau 08:00
 * bila acara tanpa jam spesifik.
 */
export function susunDaftarPengingat(
  p: PermintaanMultiHari,
): Array<{ due: Date; pesan: string }> {
  const daftar: Array<{ due: Date; pesan: string }> = [];
  const dasar = p.tanggalAcara;
  const jam = dasar.getHours();
  const menit = dasar.getMinutes();
  const punyaJam = jam !== 0 || menit !== 0;
  const jamPakai = punyaJam ? jam : 8;
  const menitPakai = punyaJam ? menit : 0;

  for (const n of p.hariSebelum) {
    const d = new Date(dasar.getTime());
    d.setDate(d.getDate() - n);
    if (punyaJam) d.setHours(jamPakai, menitPakai, 0, 0);
    else d.setHours(jamPakai, menitPakai, 0, 0);
    const label = n === 1 ? 'besok' : `${n} hari lagi`;
    daftar.push({
      due: d,
      pesan: `Persiapan ${p.namaAcara} — ${label} (acara ${formatTanggalRingkas(dasar)})`,
    });
  }

  if (p.ingatHariH) {
    daftar.push({
      due: new Date(dasar.getTime()),
      pesan: `${p.namaAcara}`,
    });
  }
  return daftar;
}

/** Tanggal ringkas untuk pesan pengingat (mis. "Sel, 13 Okt 16.00"). */
function formatTanggalRingkas(d: Date, zona = 'Asia/Jakarta'): string {
  try {
    return d.toLocaleString('id-ID', {
      timeZone: zona, weekday: 'short', day: 'numeric', month: 'short',
      hour: '2-digit', minute: '2-digit',
    }).replace('.', ':');
  } catch {
    return d.toISOString();
  }
}
