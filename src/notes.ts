/**
 * PENCATATAN PRIBADI — catatan, tugas, keuangan, kebiasaan.
 *
 * KENAPA MODUL INI ADA (permintaan pemilik produk, 04 Okt 2026):
 *   "apakah bot nya bisa digunakan untuk mencatat dan mengingat sesuatu seperti
 *    to do list, mencatat pengeluaran uang, ataupun lainnya?"
 *   "kalo ada saran lain seperti fitur todo list dan lainnya apapun itu coba
 *    masukan dan tambahkan saja"
 *
 * Sebelumnya bot hanya punya /remind (pengingat berbasis menit) dan /salah
 * (preferensi personal). Modul ini menambah 4 kemampuan pencatatan:
 *   1. notes    — catatan bebas & jurnal (resep, ide, info penting)
 *   2. todos    — daftar tugas dengan prioritas & tenggat
 *   3. expenses — catatan pengeluaran/pemasukan + rekap
 *   4. habits   — kebiasaan berulang + streak
 *
 * DUA CARA PAKAI (permintaan user: "bisa tanpa format /?"):
 *   A. Bahasa alami — "catat pengeluaran 50rb buat makan"
 *      -> dideteksi `deteksiNiat()`, lalu DIKONFIRMASI dulu sebelum disimpan
 *         (permintaan user: "konfirmasi dulu (aman — hindari salah catat)").
 *   B. Perintah / — "/catat", "/todo", "/uang", "/rekap" (cepat & pasti)
 *
 * PRINSIP: modul ini TIDAK memanggil AI sendiri untuk hal yang bisa dipastikan
 * dengan pola. AI hanya dipakai di lapisan atas (skills.ts) bila perlu; di sini
 * semuanya deterministik agar cepat, murah, dan tidak berhalusinasi.
 */
import { db } from './db.js';
import { formatInZone } from './timezone.js';
import { tanganiGame } from './games/index.js';
import { deteksiPermintaanUbah, daftarPengingatPending, pilihTarget, ubahPengingat, batalkanPengingat } from './reminder-ubah.js';
import { tentukanProfilWaktu, berkaitanDenganWaktu, waktuDiZona } from './user-profile.js';
import { detectUserLocationDeclaration } from './timezone.js';
import { deteksiPengulangan, labelUlang } from './reminder-repeat.js';
import { susunRingkasan, mintaRingkasan } from './ringkasan.js';

/**
 * Format tanggal+jam dalam ZONA WAKTU USER (default WIB / Asia/Jakarta).
 *
 * BUG YANG DIPERBAIKI (04 Okt 2026, keluhan pemilik produk):
 *   User minta "ingatkan 2 menit lagi" pada pukul 22:14 WIB.
 *   Bot menjawab: "Pengingat ... pada 4 Okt 2026, 15.16"  <- SALAH 7 jam!
 *   Sebabnya: `toLocaleString('id-ID')` TANPA opsi `timeZone` memakai zona
 *   SERVER (Vercel = UTC), bukan zona user (WIB = UTC+7).
 *   Pengingatnya sendiri tersimpan BENAR (due_at UTC), hanya TAMPILANNYA salah.
 *
 * Perbaikan: selalu sebutkan `timeZone` eksplisit. Zona diambil dari parameter
 * (bila pemanggil punya info lokasi) atau default Asia/Jakarta (WIB), karena
 * mayoritas pengguna bot ini di Indonesia.
 */
function formatWaktuUser(d: Date, zone = zonaWaktuAktif()): string {
  try {
    return d.toLocaleString('id-ID', {
      timeZone: zone,
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    // Zona tidak valid -> fallback ke WIB (zona paling umum).
    return d.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'medium', timeStyle: 'short' });
  }
}

// ============================================================================
// TIPE & KONSTANTA
// ============================================================================

export type NoteKind = 'note' | 'todo' | 'expense' | 'habit';
export type ExpenseKind = 'in' | 'out';

export interface NiatTerdeteksi {
  kind: NoteKind;
  /** Kepercayaan 0..1. <0.6 → minta konfirmasi. */
  yakin: number;
  /** Data mentah hasil ekstraksi (belum divalidasi). */
  data: Record<string, unknown>;
  /** Ringkasan untuk pesan konfirmasi. */
  ringkas: string;
}

export interface CatatanRingkas {
  id: number;
  content: string;
  title?: string | null;
  created_at: string;
}

export interface TugasRingkas {
  id: number;
  task: string;
  priority: number;
  status: string;
  due_at?: string | null;
}

export interface UangRingkas {
  id: number;
  kind: ExpenseKind;
  amount: number;
  category: string;
  note?: string | null;
  occurred_at: string;
}

export interface RekapUang {
  masuk: number;
  keluar: number;
  selisih: number;
  perKategori: Array<{ kind: string; category: string; total: number; jumlah: number }>;
}

// ============================================================================
// UTILITAS ANGKA & TANGGAL (deterministik, tanpa AI)
// ============================================================================

/**
 * Ubah nominal Indonesia menjadi angka.
 * Mendukung: 50000, 50.000, 50rb, 50 ribu, 1jt, 1,5jt, 2 juta, 10k.
 */
export function parseNominal(teks: string): number | null {
  // BUG YANG DIPERBAIKI (05 Okt 2026): sebelumnya hanya menerima DIGIT, sehingga
  // "dua puluh ribu" / "lima ratus ribu" (cara bicara lewat Voice Note) GAGAL
  // diparsing. Sekarang angka KATA dikonversi lebih dulu (satu..sembilan,
  // belasan, puluhan, ratusan), termasuk gabungan ("dua puluh lima ribu").
  const s = angkaKataKeDigit(teks.toLowerCase()).replace(/\s+/g, ' ').trim();

  // "N ratus" / "N puluh" -> gabungkan (mis. "20 lima ribu" -> "25 ribu")
  let s2 = s
    .replace(/\b(\d+)\s*ratus\s*(\d+)?\b/g, (_m, a, b) => String(Number(a) * 100 + (b ? Number(b) : 0)))
    .replace(/\b(\d+)\s*puluh\s*(\d+)?\b/g, (_m, a, b) => String(Number(a) * 10 + (b ? Number(b) : 0)));

  // Pola dengan satuan: "50rb", "50 ribu", "1jt", "1,5 juta", "10k"
  const m = s2.match(/(\d+(?:[.,]\d+)?)\s*(rb|ribu|k|jt|juta|m|miliar|milyar)\b/);
  if (m) {
    const angka = Number(m[1].replace(',', '.'));
    if (!Number.isFinite(angka)) return null;
    const satuan = m[2];
    const faktor =
      satuan === 'rb' || satuan === 'ribu' || satuan === 'k' ? 1_000
      : satuan === 'jt' || satuan === 'juta' ? 1_000_000
      : 1_000_000_000; // m, miliar, milyar
    return Math.round(angka * faktor);
  }

  // Pola angka biasa: "50.000" atau "50000" atau "1.234.567"
  const m2 = s2.match(/(\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{1,2})?/);
  if (m2) {
    const bersih = m2[1].replace(/\./g, '');
    const n = Number(bersih);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

/** Kategori keuangan dari kata kunci (deterministik). */
export function tebakKategori(teks: string): string {
  const s = teks.toLowerCase();
  const peta: Array<[RegExp, string]> = [
    // Kesehatan & tagihan diperiksa LEBIH DULU dari "belanja", karena frasa
    // seperti "beli obat" / "bayar listrik" memuat kata "beli/bayar" yang jika
    // diperiksa belakangan akan salah masuk kategori "belanja"/"lainnya".
    [/obat|dokter|klinik|rumah sakit|\brs\b|vitamin|periksa|medis|bpjs|apotek|apotik/, 'kesehatan'],
    [/listrik|air|pdam|pln|internet|wifi|indihome|pulsa|kuota|token|gas|sewa|kontrak|kos|tagihan/, 'tagihan'],
    [/makan|minum|kopi|nasi|ayam|bakso|sate|resto|warung|kafe|cafe|jajan|snack|sarapan|lunch|dinner|gofood|grabfood/, 'makan'],
    [/bensin|pertalite|pertamax|solar|transport|ojek|grab|gojek|taksi|taxi|bus|kereta|tiket|parkir|tol|angkot/, 'transport'],
    [/belanja|beli|shopping|supermarket|indomaret|alfamart|tokopedia|shopee|lazada/, 'belanja'],
    [/sekolah|kuliah|buku|kursus|les|seminar|training|pendidikan|ukt|spp/, 'pendidikan'],
    [/gaji|bonus|thr|upah|honor|fee|pendapatan|penghasilan|proyek|jual/, 'gaji'],
    [/hiburan|nonton|bioskop|game|langganan|netflix|spotify|liburan|wisata|jalan-jalan/, 'hiburan'],
  ];
  for (const [re, kat] of peta) if (re.test(s)) return kat;
  return 'lainnya';
}

/**
 * Ubah waktu alami Indonesia menjadi Date.
 * Mendukung: "besok jam 8", "nanti jam 15:30", "hari ini jam 7 pagi",
 *           "3 hari lagi", "senin depan", "30 menit lagi".
 */
/**
 * Ubah angka yang ditulis dengan KATA menjadi digit.
 *
 * BUG YANG DIPERBAIKI (05 Okt 2026, temuan dari CSV evaluasi):
 * Voice Note "ingatkan saya SATU menit lagi untuk login" TIDAK dikenali, karena
 * parseWaktuAlami() hanya menerima digit (`\d+`). Transkripsi suara sering
 * menghasilkan angka KATA ("satu", "dua", "lima"), jadi permintaan lewat VN
 * gagal dibuatkan pengingat — dan AI lalu mengarang "pengingat disimpan".
 *
 * Mendukung: satu..dua belas, belasan (sebelas..sembilan belas), puluhan
 * (dua puluh..sembilan puluh), setengah, se- (sejam, semenit), dan campuran
 * ("satu setengah jam").
 */
export function angkaKataKeDigit(teks: string): string {
  const satuan: Record<string, number> = {
    nol: 0, kosong: 0, satu: 1, se: 1, dua: 2, tiga: 3, empat: 4, lima: 5,
    enam: 6, tujuh: 7, delapan: 8, sembilan: 9, sepuluh: 10, sebelas: 11,
  };
  const belasan: Record<string, number> = {
    sebelas: 11, duabelas: 12, 'dua belas': 12, tigabelas: 13, 'tiga belas': 13,
    empatbelas: 14, 'empat belas': 14, limabelas: 15, 'lima belas': 15,
    enambelas: 16, 'enam belas': 16, tujuhbelas: 17, 'tujuh belas': 17,
    delapanbelas: 18, 'delapan belas': 18, sembilanbelas: 19, 'sembilan belas': 19,
  };
  const puluhan: Record<string, number> = {
    sepuluh: 10, duapuluh: 20, 'dua puluh': 20, tigapuluh: 30, 'tiga puluh': 30,
    empatpuluh: 40, 'empat puluh': 40, limapuluh: 50, 'lima puluh': 50,
    enampuluh: 60, 'enam puluh': 60, tujuhpuluh: 70, 'tujuh puluh': 70,
    delapanpuluh: 80, 'delapan puluh': 80, sembilanpuluh: 90, 'sembilan puluh': 90,
  };

  let t = teks;

  // 1) "setengah jam" / "setengah menit" -> 0.5 satuan
  t = t.replace(/\bsetengah\s*(menit|jam|hari|minggu|bulan)\b/g, '0.5 $1');
  // 2) "sejam"/"semenit"/"sehari"/"seminggu" -> 1 satuan
  t = t.replace(/\bse(menit|jam|hari|minggu|bulan|detik)\b/g, '1 $1');
  // 2b) "seratus"/"seribu"/"sejuta"/"semiliar" -> 100 / 1000 / 1000000 / 1000000000
  //     BUG YANG DIPERBAIKI (temuan test otomatis 05 Okt 2026): sebelumnya
  //     "seratus ribu" GAGAL (null) karena hanya "se" + satuan waktu didukung.
  t = t.replace(/\bseratus\b/g, '100')
       .replace(/\bseribu\b/g, '1000')
       .replace(/\bsejuta\b/g, '1000000')
       .replace(/\bsemiliar\b/g, '1000000000')
       .replace(/\bsemilyar\b/g, '1000000000');

  // 3) belasan & puluhan (frasa dua kata lebih dulu)
  const frasa = [...Object.keys(belasan), ...Object.keys(puluhan)]
    .filter((k) => k.includes(' '))
    .sort((a, b) => b.length - a.length);
  for (const f of frasa) {
    t = t.replace(new RegExp(`\\b${f}\\b`, 'g'), String((belasan[f] ?? puluhan[f])));
  }
  // 4) kata tunggal
  for (const [k, v] of Object.entries({ ...satuan, ...belasan, ...puluhan })) {
    if (k.includes(' ')) continue;
    t = t.replace(new RegExp(`\\b${k}\\b`, 'g'), String(v));
  }
  // 5) "dua puluh lima" -> setelah langkah 3 jadi "20 lima"; gabung "20 5" -> 25
  t = t.replace(/\b(\d0)\s+(\d)\b/g, (_m, a, b) => String(Number(a) + Number(b)));

  return t;
}

export function parseWaktuAlami(teks: string, sekarang: Date = new Date()): Date | null {
  const s = angkaKataKeDigit(teks.toLowerCase().trim());
  const hasil = new Date(sekarang.getTime());

  // "N menit lagi" / "N jam lagi" / "N hari lagi" — N boleh angka atau kata.
  const mJeda = s.match(/(\d+(?:[.,]\d+)?)\s*(menit|jam|hari|minggu|bulan)\s*(lagi|kemudian|kedepan)?/);
  if (mJeda) {
    const n = Number(String(mJeda[1]).replace(',', '.'));
    const satuan = mJeda[2];
    const ms =
      satuan === 'menit' ? n * 60_000
      : satuan === 'jam' ? n * 3_600_000
      : satuan === 'hari' ? n * 86_400_000
      : satuan === 'minggu' ? n * 7 * 86_400_000
      : n * 30 * 86_400_000;
    // Bila ada jam eksplisit ("2 jam lagi jam 8"), abaikan — jeda lebih pasti.
    return new Date(sekarang.getTime() + ms);
  }

  // Hari: hari ini / besok / lusa / senin..minggu
  const namaHari = ['minggu', 'senin', 'selasa', 'rabu', 'kamis', 'jumat', 'sabtu'];
  let geserHari: number | null = null;
  if (/\bbesok\b/.test(s)) geserHari = 1;
  else if (/\blusa\b/.test(s)) geserHari = 2;
  else if (/\bhari ini\b/.test(s)) geserHari = 0;
  else {
    for (let i = 0; i < namaHari.length; i++) {
      if (new RegExp(`\\b${namaHari[i]}\\b`).test(s)) {
        const skrg = sekarang.getDay();
        let delta = (i - skrg + 7) % 7;
        if (delta === 0) delta = 7; // "senin" saat hari Senin → Senin depan
        geserHari = delta;
        break;
      }
    }
  }

  // RENTANG WAKTU: "jam 9 sampai jam 10" / "jam 9-10" / "jam 9 s/d 10" /
  // "dari jam 9 sampai 10" / "jam 9 hingga 11".
  // Dukungan ditambahkan 05 Okt 2026 (temuan pemilik produk). Sebelumnya jam
  // SELESAI dibuang begitu saja, sehingga pesan jadi "saya akan rapat dari sampai".
  // Jam selesai disimpan di properti non-enumerable agar tidak mengubah tipe Date.
  const mRentang = s.match(
    /(?:dari\s+)?(?:jam|pukul)\s*(\d{1,2})(?:[:.](\d{2}))?\s*(?:sampai|sampai\s+dengan|s\/d|sd|hingga|sampai\s+jam|-|–|sampai\s+pukul)\s*(?:jam|pukul)?\s*(\d{1,2})(?:[:.](\d{2}))?/,
  );
  if (mRentang) {
    const j1 = Number(mRentang[1]);
    const men1 = mRentang[2] ? Number(mRentang[2]) : 0;
    const j2 = Number(mRentang[3]);
    const men2 = mRentang[4] ? Number(mRentang[4]) : 0;
    const d = new Date(sekarang.getTime());
    d.setHours(j1, men1, 0, 0);
    if (d.getTime() <= sekarang.getTime()) d.setDate(d.getDate() + 1);
    const selesai = new Date(d.getTime());
    selesai.setHours(j2, men2, 0, 0);
    // Bila jam selesai < jam mulai, berarti lewat tengah malam.
    if (selesai.getTime() <= d.getTime()) selesai.setDate(selesai.getDate() + 1);
    Object.defineProperty(d, 'selesai', { value: selesai, enumerable: false });
    return d;
  }

  // TANGGAL BULANAN: "tanggal 1", "tgl 15" -> tanggal itu, jam 08:00 (default).
  // Temuan uji 05 Okt 2026: "ingatkan tiap tanggal 1 bayar listrik" gagal karena
  // "tanggal 1" tidak dikenali (tidak ada jam) sehingga jatuh ke deteksi keuangan.
  const mTanggal = s.match(/\b(?:tanggal|tgl)\s+(\d{1,2})\b/);
  if (mTanggal) {
    const tgl = Math.min(31, Math.max(1, Number(mTanggal[1])));
    const d = new Date(sekarang.getTime());
    d.setHours(8, 0, 0, 0);
    d.setDate(tgl);
    if (d.getTime() <= sekarang.getTime()) d.setMonth(d.getMonth() + 1, tgl);
    return d;
  }

  // BAGIAN HARI tanpa jam eksplisit: "nanti malam", "malam ini", "pagi ini",
  // "besok pagi", "sore nanti". Jam default: subuh 4, pagi 7, siang 12,
  // sore 16, malam 19. DIPERLUAS 05 Okt 2026 — sebelumnya "jangan lupa nanti
  // malam bayar utang" tidak dikenali karena hanya ada kata bagian hari.
  const mBagianHari = s.match(/\b(subuh|pagi|siang|sore|petang|malam)\b/);
  if (mBagianHari && !/(?:jam|pukul)\s*\d/.test(s)) {
    const jamDefault: Record<string, number> = { subuh: 4, pagi: 7, siang: 12, sore: 16, petang: 16, malam: 19 };
    const j = jamDefault[mBagianHari[1]];
    const d = new Date(sekarang.getTime());
    d.setHours(j, 0, 0, 0);
    // Bila jam itu sudah lewat hari ini -> besok.
    if (d.getTime() <= sekarang.getTime()) d.setDate(d.getDate() + 1);
    return d;
  }

  // Jam: "jam 8", "jam 08:30", "pukul 15.00", "8 pagi", "7 malam"
  const mJam = s.match(/(?:jam|pukul)\s*(\d{1,2})(?:[:.](\d{2}))?/);
  let jam: number | null = null;
  let menit = 0;
  if (mJam) {
    jam = Number(mJam[1]);
    menit = mJam[2] ? Number(mJam[2]) : 0;
    // "jam 7 malam" → 19, "jam 8 pagi" → 8
    if (/\b(malam|sore|petang)\b/.test(s) && jam < 12) jam += 12;
    if (/\b(pagi|subuh)\b/.test(s) && jam === 12) jam = 0;
  }

  if (geserHari === null && jam === null) return null;

  if (geserHari !== null) hasil.setDate(hasil.getDate() + geserHari);
  if (jam !== null) {
    hasil.setHours(jam, menit, 0, 0);
  } else if (geserHari !== null) {
    // Tanpa jam eksplisit → default 08:00 pagi
    hasil.setHours(8, 0, 0, 0);
  }
  // Bila hasil sudah lewat (mis. "jam 8" tapi sekarang 9 malam) → besok
  if (hasil.getTime() <= sekarang.getTime() && geserHari === null) {
    hasil.setDate(hasil.getDate() + 1);
  }
  return hasil;
}

// ============================================================================
// DETEKSI NIAT (deterministik — tanpa AI, cepat, tanpa biaya token)
// ============================================================================

/**
 * Deteksi niat pencatatan dari bahasa alami.
 * Mengembalikan null bila pesan bukan niat mencatat (obrolan biasa).
 *
 * Sengaja KONSERVATIF: lebih baik melewatkan catatan (user bisa pakai /)
 * daripada salah mencatat obrolan biasa.
 */
/**
 * KATA PERINTAH UNIVERSAL — pesan WAJIB dimulai dengan salah satu kata ini
 * (setelah kata pengantar opsional). Prinsipnya: HANYA kalimat PERINTAH yang
 * boleh dicatat, bukan pertanyaan, bukan cerita, bukan obrolan.
 */
const KATA_PERINTAH = 'catat|catet|note|notes|simpan|tulis|tambah|tambahin|nambah|masukkan|input|ingatkan|ingetin|ingat|remind|reminder|todo|to-do|tugas|task|uang|keluar|masuk|pengeluaran|pemasukan|jurnal|diary|belanja|belanjaan|barang|stok|inventaris|daftar-belanja|shopping|hapus|buang|hilangkan|selesai|selesaikan|done|beres|tandai|set|bikin|buat|jadwalkan|siapkan|beli|bayar|jajan|ongkos|biaya|habis|abis|dapat|dapet|gaji|transferan|harus|perlu|kudu|mesti';

/** Kata pengantar yang BOLEH mendahului perintah (bukan penanda obrolan). */
const PENGANTAR_BOLEH = /^\s*(tolong|coba|bisa|boleh|please|pls|mau|aku\s+mau|saya\s+mau|aku\s+pengen|saya\s+pengen|aku\s+ingin|saya\s+ingin|aku\s+pingin|saya\s+pingin|gw\s+mau|gue\s+mau|aku\s+mo|saya\s+mo)\s+/i;

/**
 * PENANDA OBROLAN — bila ada salah satu, pesan DITOLAK (tidak dicatat).
 * Ini yang mencegah obrolan biasa tercampur ke fitur pencatatan.
 */
const PENANDA_OBROLAN: RegExp[] = [
  /\?/,                                                     // pertanyaan
  /\b(apa|apakah|apaan|berapa|brp|kenapa|mengapa|gimana|bagaimana|kok|ya\s*kan|bukan\s*ya|emang|memang)\b/,
  /\b(tadi|kemarin|barusan|baru\s+aja|td|tadi\s+kan)\b/,     // cerita masa lalu
  /\b(katanya|kata\s+dia|kata\s+orang)\b/,                  // kabar dari orang
  /\b(banget|bgt|sih|deh|dong|nih|loh|lah|kan|yah|yaudah|yaudahlah|wkwk|haha|hehe|xixi)\b/,
  /\b(aku\s+sudah|saya\s+sudah|udah\s+aku|sudah\s+aku)\b/,   // menyatakan sudah terjadi
  /\b(mungkin|kayaknya|sepertinya|sepertinya|rasanya|kayak\s+nya)\b/, // dugaan
];

/** Kata pengantar yang HARUS dibuang sebelum mengambil isi. */
function bersihkanIsi(teks: string, tambahan: RegExp[] = []): string {
  let isi = teks.trim();
  const pola = [
    new RegExp(`^\\s*\\/?(${KATA_PERINTAH})\\b\\s*[:\\-]?\\s*`, 'i'),
    /^\s*(penting|urgent|segera|buruan|prioritas|santai|nanti|kapan-kapan|gak\s+urgent|dong|nih|ya|tolong|saya|aku|gue|gw)\b\s*/i,
    ...tambahan,
  ];
  let berubah = true, putaran = 0;
  while (berubah && putaran < 6) {
    berubah = false;
    for (const p of pola) {
      const sebelum = isi;
      isi = isi.replace(p, '');
      if (isi !== sebelum) berubah = true;
    }
    putaran++;
  }
  return isi.trim();
}

/**
 * DETEKSI NIAT PENCATATAN — KETAT & UNIVERSAL (diperketat 04 Okt 2026).
 *
 * FILOSOFI: LEBIH BAIK MELEWATKAN daripada salah mencatat obrolan.
 * Karena itu ada 4 lapis penyaring yang harus LOLOS semua:
 *
 *   L1. Pesan WAJIB dimulai kata perintah (setelah kata pengantar opsional).
 *       "aku tadi makan enak" -> tidak diawali perintah -> TOLAK.
 *   L2. Pesan TIDAK BOLEH memuat penanda obrolan (tanya, cerita, partikel gaul).
 *       "catat dong tadi aku makan" -> ada "dong"+"tadi" -> TOLAK.
 *   L3. Pesan TIDAK BOLEH berupa pertanyaan.
 *       "berapa pengeluaranku" -> TOLAK (ditangani deteksiPertanyaan).
 *   L4. Isi WAJIB cukup jelas (nominal untuk uang, teks cukup untuk tugas/catatan).
 *
 * Bila salah satu lapis gagal -> null (pesan diteruskan ke AI sebagai obrolan).
 */
export function deteksiNiat(teks: string): NiatTerdeteksi | null {
  const asli = teks.trim();
  const s = asli.toLowerCase();
  if (s.length < 8 || s.length > 400) return null;

  // ── L2. TOLAK bila ada penanda obrolan ──
  for (const pola of PENANDA_OBROLAN) {
    if (pola.test(s)) return null;
  }

  // ── L1. WAJIB ada kata perintah (boleh di AWAL atau di AKHIR kalimat) ──
  //
  // BUG YANG DIPERBAIKI (04 Okt 2026, temuan pemilik produk):
  //   "1 menit lagi saya mau login, ingatkan"  -> TIDAK dikenali
  //   "login 1 menit lagi, tolong ingatkan"    -> TIDAK dikenali
  // Padahal itu cara bicara alami orang Indonesia: perintah diletakkan di
  // BELAKANG kalimat. Versi lama hanya menerima kata perintah di AWAL, sehingga
  // permintaan seperti itu jatuh ke AI dan pengingat tidak dibuat.
  //
  // Perbaikan: terima kata perintah di awal ATAU di akhir kalimat.
  //
  // BUG SEBELUMNYA (juga diperbaiki di sini): regex dibangun dari template
  // literal sehingga `\\s` bisa rusak menjadi huruf `s` setelah file ditulis
  // ulang — membuat regex SELALU GAGAL. Kini dibangun dari string biasa.
  const tanpaPengantar = asli.replace(PENGANTAR_BOLEH, '').trim();
  const KATA_PERINTAH_AKHIR = '(?:tolong\\s+)?(' + KATA_PERINTAH + ')';
  const polaAwal = new RegExp('^\\s*\\/?' + '(' + KATA_PERINTAH + ')\\b', 'i');
  // Kata perintah di akhir kalimat (boleh didahului koma / spasi / kata "tolong").
  const polaAkhir = new RegExp('[,\\s]+' + KATA_PERINTAH_AKHIR + '\\s*[.!]*\\s*$', 'i');
  const adaKataPerintah = polaAwal.test(tanpaPengantar) || polaAkhir.test(tanpaPengantar);
  if (!adaKataPerintah) return null;

  // ── L4. Ambil isi & klasifikasikan ──
  const nominal = parseNominal(s);

  // 4a3. PENGINGAT BERULANG didahulukan.
  // Temuan uji 05 Okt 2026: "ingatkan tiap tanggal 1 bayar listrik" salah
  // ditangkap sebagai KEUANGAN (Rp1) karena ada kata "bayar" + angka 1, padahal
  // itu pengingat berulang. Bila ada kata perintah INGAT + penanda pengulangan,
  // blok pengingat di bawah yang menangani.
  const adaPerintahIngat = /\b(?:ingatkan|ingetin|ingat|remind|reminder|pengingat)\b/i.test(asli);
  const adaPengulangan = /\b(?:tiap|setiap|saban)\s+(?:hari|minggu|bulan|tahun|senin|selasa|rabu|kamis|jumat|jum'at|sabtu|tanggal|hari\s+kerja)\b|\b(?:harian|mingguan|bulanan|tahunan)\b/i.test(asli);
  if (adaPerintahIngat && adaPengulangan) {
    const kapanUlang = parseWaktuAlami(asli);
    if (kapanUlang) {
      const ulang0 = deteksiPengulangan(asli);
      let pesan0 = asli
        .replace(/^\s*\/?(ingatkan|ingetin|remind)\b\s*/i, '')
        .replace(/\b(?:tiap|setiap|saban)\s+(?:hari\s+kerja|hari|minggu|bulan|tahun)\b/gi, '')
        .replace(/\b(?:tiap|setiap|saban)\s+(?:minggu|senin|selasa|rabu|kamis|jumat|jum'at|sabtu)\b/gi, '')
        .replace(/\b(?:tiap|setiap|saban)\s+tanggal\s+\d{1,2}\b/gi, '')
        .replace(/\b(?:harian|mingguan|bulanan|tahunan|weekday)\b/gi, '')
        .replace(/\b(jam|pukul)\s*\d{1,2}([:.]\d{2})?/gi, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
      if (pesan0.length < 3) pesan0 = asli;
      return {
        kind: 'note',
        yakin: 0.92,
        data: {
          pengingat: true,
          due_at: kapanUlang.toISOString(),
          due_selesai: null,
          message: pesan0,
          repeat_kind: ulang0?.kind ?? 'daily',
          repeat_value: ulang0?.value ?? null,
        },
        ringkas: `Pengingat "${pesan0}" pada ${formatWaktuUser(kapanUlang)}${ulang0 ? ` (${ulang0.label})` : ''}`,
      };
    }
  }

  // 4a. KEUANGAN — wajib ada nominal
  const adaKataUang = /\b(uang|duit|pengeluaran|pemasukan|belanja|bayar|beli|habis|keluar|masuk|gaji|bonus|dapat|terima|honor|fee|pendapatan|jajan|ongkos|biaya|tarif)\b/.test(s);
  const perintahUang = /^\s*\/?(uang|keluar|masuk|pengeluaran|pemasukan)\b/i.test(tanpaPengantar);
  if (nominal && (perintahUang || adaKataUang)) {
    const kind: ExpenseKind = /\b(masuk|gaji|bonus|dapat|terima|pemasukan|honor|fee|pendapatan)\b/.test(s) ? 'in' : 'out';
    return {
      kind: 'expense',
      yakin: 0.92,
      data: { amount: nominal, kind, category: tebakKategori(s), note: asli },
      ringkas: `${kind === 'in' ? 'Pemasukan' : 'Pengeluaran'} Rp${nominal.toLocaleString('id-ID')} (${tebakKategori(s)})`,
    };
  }

  // 4a2. BARANG / BELANJA — dipetakan ke CATATAN dengan tag 'belanja'.
  // Temuan uji 05 Okt 2026: "tambah barang beras lima kilo" TIDAK dikenali karena
  // kata "barang" ikut dibuang sebagai kata perintah sehingga isi jadi kosong.
  // Sekarang: kenali kata barang/belanja/stok/inventaris, lalu simpan isinya
  // sebagai catatan ber-tag 'belanja' (tidak perlu tabel baru).
  const perintahBarang = /\b(?:barang|belanja|belanjaan|stok|inventaris|shopping)\b/i.test(tanpaPengantar);
  if (perintahBarang) {
    // Buang kata perintah + kata "barang/belanja", sisanya jadi isi.
    let isiBarang = asli
      .replace(/^\s*\/?(?:catat|catet|note|notes|simpan|tulis|tambah|tambahin|nambah|masukkan|input|barang|belanja|belanjaan|stok|inventaris|shopping)\b\s*/i, '')
      .replace(/\b(?:barang|belanja|belanjaan|stok|inventaris|shopping)\b\s*/gi, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
    // Bila hanya "tambah barang" tanpa isi -> minta isinya.
    if (isiBarang.length < 2) {
      return null; // biarkan AI menanyakan barang apa
    }
    return {
      kind: 'note',
      yakin: 0.9,
      data: { content: isiBarang, tags: ['belanja'] },
      ringkas: `Barang: "${isiBarang.slice(0, 80)}"`,
    };
  }

  // 4b. PENGINGAT — kata ingatkan/ingetin/remind boleh di AWAL atau AKHIR
  // (mis. "1 menit lagi saya mau login, ingatkan" — cara bicara alami).
  const perintahIngat =
    /^\s*\/?(ingatkan|ingetin|remind)\b/i.test(tanpaPengantar) ||
    /[,\s]+(?:tolong\s+)?(ingatkan|ingetin|remind)\s*[.!]*\s*$/i.test(tanpaPengantar);
  if (perintahIngat) {
    const kapan = parseWaktuAlami(s);
    if (kapan) {
      // Bersihkan HANYA kata perintah + kata waktu, JANGAN sampai pesan kosong.
      //
      // BUG YANG DIPERBAIKI (04 Okt 2026): "ingatkan besok jam 8" menghasilkan
      // pesan KOSONG karena semua kata ("ingatkan"+"besok"+"jam 8") dibuang,
      // lalu `pesan.length >= 3` gagal -> return null -> pengingat tidak dibuat.
      // Sekarang: buang kata perintah & kata waktu, lalu bila hasilnya kosong,
      // PAKAI TEKS ASLI sebagai isi pengingat (lebih baik daripada menolak).
      //
      // BUG YANG DIPERBAIKI (05 Okt 2026, temuan uji): pembersih hanya membuang
      // angka DIGIT, sehingga "satu menit lagi" tetap tertinggal di pesan:
      //   "ingatkan saya SATU MENIT LAGI untuk login" -> pesan "saya satu menit lagi untuk login"
      // (padahal "1 menit lagi" -> "saya untuk login"). Sekarang angka KATA
      // ikut dibuang agar hasilnya konsisten.
      const ANGKA_KATA = '(?:satu|dua|tiga|empat|lima|enam|tujuh|delapan|sembilan|sepuluh|sebelas|dua\\s*belas|tiga\\s*belas|empat\\s*belas|lima\\s*belas|enam\\s*belas|tujuh\\s*belas|delapan\\s*belas|sembilan\\s*belas|dua\\s*puluh|tiga\\s*puluh|empat\\s*puluh|lima\\s*puluh|enam\\s*puluh|tujuh\\s*puluh|delapan\\s*puluh|sembilan\\s*puluh|setengah|se)';
      let pesan = asli
        .replace(/^\s*\/?(ingatkan|ingetin|remind)\b\s*/i, '')
        // Kata PENGULANGAN dibuang dari pesan (aturan berulang sudah disimpan
        // di kolom terpisah). Temuan uji: "tiap hari minum obat" -> "minum obat".
        .replace(/\b(?:tiap|setiap|saban)\s+(?:hari\s+kerja|hari|minggu|bulan|tahun)\b/gi, '')
        .replace(/\b(?:tiap|setiap|saban)\s+(?:minggu|senin|selasa|rabu|kamis|jumat|jum'at|sabtu)\b/gi, '')
        .replace(/\b(?:tiap|setiap|saban)\s+tanggal\s+\d{1,2}\b/gi, '')
        .replace(/\b(?:harian|mingguan|bulanan|tahunan|weekday)\b/gi, '')
        .replace(/[,\s]+(?:tolong\s+)?(ingatkan|ingetin|remind)\s*[.!]*\s*$/i, '')
        .replace(/\b(besok|lusa|hari ini|nanti|pagi|siang|sore|malam|subuh)\b/gi, '')
        // Rentang waktu ("dari jam 9 sampai jam 10") dibuang UTUH lebih dulu.
        .replace(/(?:dari\s+)?(?:jam|pukul)\s*\d{1,2}(?:[:.]\d{2})?\s*(?:sampai(?:\s+dengan)?|s\/d|sd|hingga|-|–|sampai\s+pukul|sampai\s+jam)\s*(?:jam|pukul)?\s*\d{1,2}(?:[:.]\d{2})?/gi, '')
        .replace(/\b(jam|pukul)\s*\d{1,2}([:.]\d{2})?/gi, '')
        .replace(/\b(senin|selasa|rabu|kamis|jumat|sabtu|minggu)\b/gi, '')
        // "N menit lagi" — N boleh digit ATAU angka kata
        .replace(new RegExp(`\\b(?:\\d+|${ANGKA_KATA})\\s*(menit|jam|hari|minggu|bulan)\\s*(lagi|kemudian|kedepan)?\\b`, 'gi'), '')
        // sisa "lagi" yang menggantung (mis. "buat login lagi")
        .replace(/\blagi\b/gi, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
      // Bila pesan kosong (mis. "ingatkan besok jam 8" tanpa keterangan lain),
      // pakai teks asli yang sudah dibersihkan kata perintahnya.
      if (pesan.length < 3) {
        pesan = asli.replace(/^\s*\/?(ingatkan|ingetin|remind)\b\s*/i, '').trim() || asli;
      }
      // PENGINGAT BERULANG (fitur baru 05 Okt 2026): "tiap hari jam 7", "tiap Senin jam 9".
      const ulang = deteksiPengulangan(s);
      // Rentang waktu: sertakan jam selesai bila user menyebutkannya.
      const selesai = (kapan as Date & { selesai?: Date }).selesai;
      const jamTeks = selesai
        ? `${formatWaktuUser(kapan)}–${new Date(selesai).toLocaleTimeString('id-ID', { timeZone: zonaWaktuAktif(), hour: '2-digit', minute: '2-digit' })}`
        : `${formatWaktuUser(kapan)}`;
      return {
        kind: 'note',
        yakin: 0.9,
        data: {
          pengingat: true,
          due_at: kapan.toISOString(),
          due_selesai: selesai ? selesai.toISOString() : null,
          message: pesan,
          repeat_kind: ulang?.kind ?? 'none',
          repeat_value: ulang?.value ?? null,
        },
        ringkas: `Pengingat "${pesan}" pada ${jamTeks}${ulang ? ` (${ulang.label})` : ''}`,
      };
    }
    return null; // perintah ingatkan tapi waktu tak jelas -> serahkan ke AI
  }

  // 4c. TUGAS — wajib ada kata tugas/todo/task
  const perintahTodo = /^\s*\/?(todo|to-do|tugas|task)\b/i.test(tanpaPengantar);
  const sebutTodo = /\b(tugas|todo|to-do|task|kerjaan|pekerjaan|pr|daftar\s+kerjaan)\b/.test(s);
  if (perintahTodo || sebutTodo) {
    const isi = bersihkanIsi(asli);
    if (isi.length >= 3) {
      const prioritas = /\b(penting|urgent|segera|buruan|prioritas)\b/.test(s) ? 1 : /\b(santai|nanti|kapan-kapan|gak urgent)\b/.test(s) ? 3 : 2;
      const due = parseWaktuAlami(s);
      return {
        kind: 'todo',
        yakin: 0.9,
        data: { task: isi, priority: prioritas, due_at: due ? due.toISOString() : null },
        ringkas: `Tugas: "${isi}"${due ? ` (tenggat ${formatWaktuUser(due)})` : ''}`,
      };
    }
  }

  // 4d. CATATAN — wajib kata catat/simpan/note/tulis/jurnal + isi cukup
  const perintahCatat = /^\s*\/?(catat|catet|simpan|note|notes|tulis|jurnal|diary)\b/i.test(tanpaPengantar);
  if (perintahCatat) {
    const isi = bersihkanIsi(asli);
    if (isi.length >= 5) {
      return {
        kind: 'note',
        yakin: 0.85,
        data: { content: isi },
        ringkas: `Catatan: "${isi.slice(0, 80)}${isi.length > 80 ? '…' : ''}"`,
      };
    }
  }

  return null;
}

// ============================================================================
// SIMPAN & AMBIL — CATATAN
// ============================================================================

export async function simpanCatatan(
  chatId: string, content: string, opts?: { title?: string; tags?: string[]; actor?: string; platform?: string },
): Promise<number | null> {
  const c = db();
  if (!c) return null;
  try {
    const { data, error } = await c.from('notes').insert({
      chat_id: chatId,
      content: content.slice(0, 4000),
      title: opts?.title?.slice(0, 120) ?? null,
      tags: opts?.tags ?? [],
      actor: opts?.actor ?? null,
      platform: opts?.platform ?? 'whatsapp',
    }).select('id').single();
    if (error) return null;
    return (data as { id: number }).id;
  } catch {
    return null;
  }
}

export async function daftarCatatan(chatId: string, limit = 10): Promise<CatatanRingkas[]> {
  const c = db();
  if (!c) return [];
  try {
    const { data, error } = await c.from('notes')
      .select('id, title, content, tags, created_at')
      .eq('chat_id', chatId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return data as CatatanRingkas[];
  } catch {
    return [];
  }
}

export async function cariCatatan(chatId: string, kata: string, limit = 10): Promise<CatatanRingkas[]> {
  const c = db();
  if (!c) return [];
  try {
    const { data, error } = await c.from('notes')
      .select('id, title, content, tags, created_at')
      .eq('chat_id', chatId)
      .ilike('content', `%${kata}%`)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return data as CatatanRingkas[];
  } catch {
    return [];
  }
}

export async function hapusCatatan(chatId: string, id: number): Promise<boolean> {
  const c = db();
  if (!c) return false;
  try {
    const { error } = await c.from('notes').delete().eq('chat_id', chatId).eq('id', id);
    return !error;
  } catch {
    return false;
  }
}

// ============================================================================
// SIMPAN & AMBIL — TUGAS
// ============================================================================

export async function simpanTugas(
  chatId: string, task: string, opts?: { priority?: number; due_at?: string | null; actor?: string; platform?: string },
): Promise<number | null> {
  const c = db();
  if (!c) return null;
  try {
    const { data, error } = await c.from('todos').insert({
      chat_id: chatId,
      task: task.slice(0, 500),
      priority: opts?.priority ?? 2,
      due_at: opts?.due_at ?? null,
      actor: opts?.actor ?? null,
      platform: opts?.platform ?? 'whatsapp',
    }).select('id').single();
    if (error) return null;
    return (data as { id: number }).id;
  } catch {
    return null;
  }
}

export async function daftarTugas(chatId: string, hanyaBelumSelesai = true): Promise<TugasRingkas[]> {
  const c = db();
  if (!c) return [];
  try {
    let q = c.from('todos').select('id, task, priority, status, due_at').eq('chat_id', chatId);
    if (hanyaBelumSelesai) q = q.eq('status', 'open');
    const { data, error } = await q.order('priority', { ascending: true }).order('created_at', { ascending: true }).limit(50);
    if (error || !data) return [];
    return data as TugasRingkas[];
  } catch {
    return [];
  }
}

export async function selesaikanTugas(chatId: string, id: number): Promise<boolean> {
  const c = db();
  if (!c) return false;
  try {
    const { error } = await c.from('todos')
      .update({ status: 'done', done_at: new Date().toISOString() })
      .eq('chat_id', chatId).eq('id', id);
    return !error;
  } catch {
    return false;
  }
}

export async function hapusTugas(chatId: string, id: number): Promise<boolean> {
  const c = db();
  if (!c) return false;
  try {
    const { error } = await c.from('todos').delete().eq('chat_id', chatId).eq('id', id);
    return !error;
  } catch {
    return false;
  }
}

// ============================================================================
// SIMPAN & AMBIL — KEUANGAN
// ============================================================================

export async function simpanUang(
  chatId: string,
  amount: number,
  kind: ExpenseKind,
  category: string,
  note?: string,
  opts?: { actor?: string; platform?: string; occurred_at?: string },
): Promise<number | null> {
  const c = db();
  if (!c) return null;
  try {
    const { data, error } = await c.from('expenses').insert({
      chat_id: chatId,
      amount,
      kind,
      category: category.slice(0, 40),
      note: note?.slice(0, 300) ?? null,
      occurred_at: opts?.occurred_at ?? new Date().toISOString(),
      actor: opts?.actor ?? null,
      platform: opts?.platform ?? 'whatsapp',
    }).select('id').single();
    if (error) return null;
    return (data as { id: number }).id;
  } catch {
    return null;
  }
}

export async function rekapUang(chatId: string, dariHari: number = 30): Promise<RekapUang> {
  const kosong: RekapUang = { masuk: 0, keluar: 0, selisih: 0, perKategori: [] };
  const c = db();
  if (!c) return kosong;
  try {
    const sejak = new Date(Date.now() - dariHari * 86_400_000).toISOString();
    const { data, error } = await c.from('expenses')
      .select('kind, amount, category')
      .eq('chat_id', chatId)
      .gte('occurred_at', sejak);
    if (error || !data) return kosong;

    let masuk = 0, keluar = 0;
    const kat = new Map<string, { total: number; jumlah: number }>();
    for (const r of data as Array<{ kind: string; amount: number; category: string }>) {
      const amt = Number(r.amount) || 0;
      if (r.kind === 'in') masuk += amt; else keluar += amt;
      const key = `${r.kind}|${r.category}`;
      const cur = kat.get(key) ?? { total: 0, jumlah: 0 };
      cur.total += amt; cur.jumlah += 1;
      kat.set(key, cur);
    }
    const perKategori = [...kat.entries()]
      .map(([k, v]) => {
        const [kind, category] = k.split('|');
        return { kind, category, total: v.total, jumlah: v.jumlah };
      })
      .sort((a, b) => b.total - a.total);

    return { masuk, keluar, selisih: masuk - keluar, perKategori };
  } catch {
    return kosong;
  }
}

export async function hapusUang(chatId: string, id: number): Promise<boolean> {
  const c = db();
  if (!c) return false;
  try {
    const { error } = await c.from('expenses').delete().eq('chat_id', chatId).eq('id', id);
    return !error;
  } catch {
    return false;
  }
}

// ============================================================================
// SIMPAN & AMBIL — KEBIASAAN
// ============================================================================

export async function simpanKebiasaan(chatId: string, name: string, targetPerDay = 1, opts?: { actor?: string; platform?: string }): Promise<number | null> {
  const c = db();
  if (!c) return null;
  try {
    const { data, error } = await c.from('habits').insert({
      chat_id: chatId,
      name: name.slice(0, 120),
      target_per_day: targetPerDay,
      actor: opts?.actor ?? null,
      platform: opts?.platform ?? 'whatsapp',
    }).select('id').single();
    if (error) return null;
    return (data as { id: number }).id;
  } catch {
    return null;
  }
}

/** Centang kebiasaan hari ini; kembalikan streak terbaru (null bila gagal). */
export async function centangKebiasaan(chatId: string, id: number): Promise<{ streak: number; best: number } | null> {
  const c = db();
  if (!c) return null;
  try {
    const { data: h, error: e1 } = await c.from('habits')
      .select('id, streak, best_streak, last_done_at')
      .eq('chat_id', chatId).eq('id', id).single();
    if (e1 || !h) return null;
    const row = h as { streak: number; best_streak: number; last_done_at: string | null };

    const hariIni = new Date().toISOString().slice(0, 10);
    const terakhir = row.last_done_at ? row.last_done_at.slice(0, 10) : null;
    const kemarin = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

    let streak = row.streak;
    if (terakhir === hariIni) {
      // sudah dicentang hari ini → tidak menambah streak
    } else if (terakhir === kemarin) {
      streak += 1;
    } else {
      streak = 1; // putus → mulai dari 1
    }
    const best = Math.max(row.best_streak, streak);

    await c.from('habit_logs').upsert(
      { habit_id: id, done_on: hariIni, count: 1 },
      { onConflict: 'habit_id,done_on' },
    );
    const { error: e2 } = await c.from('habits')
      .update({ streak, best_streak: best, last_done_at: new Date().toISOString() })
      .eq('id', id);
    if (e2) return null;
    return { streak, best };
  } catch {
    return null;
  }
}

export async function daftarKebiasaan(chatId: string): Promise<Array<{ id: number; name: string; streak: number; best_streak: number; last_done_at: string | null }>> {
  const c = db();
  if (!c) return [];
  try {
    const { data, error } = await c.from('habits')
      .select('id, name, streak, best_streak, last_done_at')
      .eq('chat_id', chatId).eq('active', true)
      .order('created_at', { ascending: true }).limit(30);
    if (error || !data) return [];
    return data as Array<{ id: number; name: string; streak: number; best_streak: number; last_done_at: string | null }>;
  } catch {
    return [];
  }
}

// ============================================================================
// FORMATTER (untuk balasan bot — teks rapi, tanpa AI)
// ============================================================================

export function formatDaftarCatatan(rows: CatatanRingkas[]): string {
  if (!rows.length) return 'Belum ada catatan.';
  return rows.map((r, i) => {
    const judul = r.title ? `*${r.title}* — ` : '';
    const isi = r.content.length > 120 ? `${r.content.slice(0, 120)}…` : r.content;
    return `${i + 1}. ${judul}${isi}`;
  }).join('\n');
}

export function formatDaftarTugas(rows: TugasRingkas[]): string {
  if (!rows.length) return 'Belum ada tugas. 🎉';
  const label = (p: number) => (p === 1 ? '🔴' : p === 3 ? '🟢' : '🟡');
  return rows.map((r) => {
    const due = r.due_at
      ? ` — tenggat ${formatWaktuUser(new Date(r.due_at))}`
      : '';
    return `${label(r.priority)} #${r.id} ${r.task}${due}`;
  }).join('\n');
}

export function formatRekapUang(r: RekapUang, hari: number): string {
  // Format Rupiah TANPA spasi: "Rp20.000" (bukan "Rp20. 000").
  // `toLocaleString('id-ID')` bisa menyisipkan spasi tipis (U+00A0/U+202F) yang
  // tampil seperti spasi di WhatsApp. Karena itu hasilnya dibersihkan eksplisit.
  const rp = (n: number) =>
    `Rp${Math.round(n).toLocaleString('id-ID').replace(/[\u00A0\u202F\s]/g, '')}`;
  const baris = [`*Rekap ${hari} hari terakhir*`, `Masuk   : ${rp(r.masuk)}`, `Keluar  : ${rp(r.keluar)}`, `Selisih : ${rp(r.selisih)}`];
  const keluarKat = r.perKategori.filter((x) => x.kind === 'out').slice(0, 8);
  if (keluarKat.length) {
    baris.push('', '*Pengeluaran per kategori:*');
    for (const k of keluarKat) baris.push(`• ${k.category}: ${rp(k.total)} (${k.jumlah}x)`);
  }
  return baris.join('\n');
}

export function formatDaftarKebiasaan(rows: Array<{ id: number; name: string; streak: number; best_streak: number; last_done_at: string | null }>): string {
  if (!rows.length) return 'Belum ada kebiasaan yang dilacak.';
  const hariIni = new Date().toISOString().slice(0, 10);
  return rows.map((r) => {
    const sudah = r.last_done_at?.slice(0, 10) === hariIni ? '✅' : '⬜';
    return `${sudah} #${r.id} ${r.name} — streak ${r.streak} hari (terbaik ${r.best_streak})`;
  }).join('\n');
}

// ============================================================================
// ORKESTRATOR — dipakai lapisan pesan (WhatsApp/Telegram)
// ============================================================================

/**
 * Konfirmasi tertunda per chat: setelah bot menanyakan "simpan?", pesan
 * berikutnya ("iya"/"tidak") diproses di sini tanpa memanggil AI.
 * Disimpan di memori proses (cukup — konfirmasi hanya bertahan beberapa detik).
 */
// ── KONFIRMASI TERTUNDA (dikembalikan 04 Okt 2026, versi lebih baik) ──
//
// RIWAYAT KEPUTUSAN:
// 1. Awalnya konfirmasi "iya/tidak" dipakai untuk SEMUA pencatatan.
// 2. Sempat DIHAPUS TOTAL (permintaan awal pemilik produk).
// 3. DIPERJELAS lagi: konfirmasi dihilangkan HANYA untuk PENGINGAT, karena
//    "remind itu kan berpacu waktu, jika hanya 1 menit maka waktu akan habis
//    oleh balasan ya/tidak". Untuk catatan/tugas/keuangan, konfirmasi TETAP ADA
//    (aman, hindari salah catat, tidak terikat waktu).
//
// Penyimpanan: DATABASE (tabel pending_confirmations, migrasi v23) agar bertahan
// lintas instance Vercel serverless, dengan fallback ke tabel `messages`
// (via='system/pending-confirmation') bila tabel v23 belum dibuat, lalu ke
// memori proses sebagai lapisan terakhir.

interface KonfirmasiTertunda {
  niat: NiatTerdeteksi;
  actor?: string;
  platform: string;
  at: number;
}
const konfirmasiTertunda = new Map<string, KonfirmasiTertunda>();

// ── ZONA WAKTU AKTIF ──
// Diisi oleh tanganiPencatatan() untuk setiap permintaan, berdasarkan profil
// user yang tersimpan di database. Default WIB HANYA sebagai jaring terakhir
// (bila pemanggil lupa mengisi) — bukan lagi asumsi utama.
let zonaAktif = 'Asia/Jakarta';
// Catatan konfirmasi zona (diisi saat zona masih tebakan dari nomor telepon).
let catatanKonfirmasiZona = '';
function zonaWaktuAktif(): string { return zonaAktif; }
function setZonaAktif(z: string | undefined | null): void {
  zonaAktif = z && z.trim() ? z : 'Asia/Jakarta';
}
const KONFIRMASI_TTL_MS = 10 * 60_000; // 10 menit

/** Simpan konfirmasi tertunda (DB dulu; memori sebagai fallback). */
async function simpanKonfirmasi(
  chatId: string, niat: NiatTerdeteksi, opts: { actor?: string; platform: string },
): Promise<void> {
  konfirmasiTertunda.set(chatId, { niat, actor: opts.actor, platform: opts.platform, at: Date.now() });
  const c = db();
  if (!c) return;
  try {
    await c.rpc('set_pending_confirmation', {
      p_chat_id: chatId,
      p_platform: opts.platform,
      p_actor: opts.actor ?? null,
      p_niat: niat as unknown as Record<string, unknown>,
    });
    return;
  } catch {
    // Tabel v23 belum ada -> cadangan di tabel `messages`
    try {
      await c.from('messages').delete()
        .eq('chat_id', chatId).eq('via', 'system/pending-confirmation');
      await c.from('messages').insert({
        platform: opts.platform,
        chat_id: chatId,
        role: 'user',
        content: JSON.stringify(niat),
        via: 'system/pending-confirmation',
      });
    } catch {
      // best-effort: memori tetap dipakai
    }
  }
}

/** Ambil konfirmasi tertunda (DB dulu; memori sebagai cadangan). */
async function ambilKonfirmasi(
  chatId: string,
): Promise<{ niat: NiatTerdeteksi; actor?: string; platform: string } | null> {
  const c = db();
  if (c) {
    try {
      const { data } = await c.rpc('take_pending_confirmation', { p_chat_id: chatId });
      const row = Array.isArray(data) ? data[0] : data;
      if (row && row.niat) {
        konfirmasiTertunda.delete(chatId);
        return {
          niat: row.niat as NiatTerdeteksi,
          actor: (row.actor as string | null) ?? undefined,
          platform: (row.platform as string) ?? 'whatsapp',
        };
      }
    } catch {
      // Tabel v23 belum ada -> cadangan `messages`
      try {
        const { data: rows } = await c.from('messages')
          .select('content,platform')
          .eq('chat_id', chatId)
          .eq('via', 'system/pending-confirmation')
          .order('created_at', { ascending: false })
          .limit(1);
        const r0 = (rows ?? [])[0] as { content?: string; platform?: string } | undefined;
        if (r0?.content) {
          await c.from('messages').delete()
            .eq('chat_id', chatId).eq('via', 'system/pending-confirmation');
          konfirmasiTertunda.delete(chatId);
          return {
            niat: JSON.parse(r0.content) as NiatTerdeteksi,
            actor: undefined,
            platform: r0.platform ?? 'whatsapp',
          };
        }
      } catch {
        // lanjut ke memori
      }
    }
  }
  const mem = konfirmasiTertunda.get(chatId);
  if (mem) {
    konfirmasiTertunda.delete(chatId);
    if (Date.now() - mem.at > KONFIRMASI_TTL_MS) return null;
    return { niat: mem.niat, actor: mem.actor, platform: mem.platform };
  }
  return null;
}

/** Buang konfirmasi tertunda (user bilang "tidak"). */
async function buangKonfirmasi(chatId: string): Promise<void> {
  konfirmasiTertunda.delete(chatId);
  const c = db();
  if (!c) return;
  try {
    await c.rpc('clear_pending_confirmation', { p_chat_id: chatId });
  } catch {
    try {
      await c.from('messages').delete()
        .eq('chat_id', chatId).eq('via', 'system/pending-confirmation');
    } catch {
      // best-effort
    }
  }
}

/** Deteksi jawaban konfirmasi singkat ("iya"/"tidak"). */
function jawabanKonfirmasi(teks: string): 'ya' | 'tidak' | null {
  const t = teks.trim().toLowerCase().replace(/[.!?]+$/, '');
  if (/^(ya|iya|y|yes|ok|oke|okey|boleh|simpan|gas|sip|lanjut|betul|benar|setuju|yoi|yup)$/.test(t)) return 'ya';
  if (/^(tidak|tdk|gak|ga|gk|nggak|ngga|no|batal|cancel|jangan|salah|gausah|gak usah|ga usah|skip)$/.test(t)) return 'tidak';
  return null;
}

/** Bentuk entri dari niat yang sudah dikonfirmasi. */
async function simpanDariNiat(
  chatId: string, niat: NiatTerdeteksi, opts: { actor?: string; platform: string },
): Promise<{ ok: boolean; pesan: string }> {
  const d = niat.data;
  if (niat.kind === 'expense') {
    const id = await simpanUang(
      chatId,
      Number(d.amount) || 0,
      (d.kind as ExpenseKind) || 'out',
      String(d.category || 'lainnya'),
      String(d.note || ''),
      { actor: opts.actor, platform: opts.platform },
    );
    return id
      ? { ok: true, pesan: `✅ Tercatat (#${id}) — ${niat.ringkas}` }
      : { ok: false, pesan: '⚠️ Gagal menyimpan ke database. Coba lagi nanti ya.' };
  }
  if (niat.kind === 'todo') {
    const id = await simpanTugas(chatId, String(d.task || ''), {
      priority: Number(d.priority) || 2,
      due_at: (d.due_at as string) ?? null,
      actor: opts.actor,
      platform: opts.platform,
    });
    return id
      ? { ok: true, pesan: `✅ Tugas dicatat (#${id}) — ${niat.ringkas}` }
      : { ok: false, pesan: '⚠️ Gagal menyimpan tugas. Coba lagi nanti ya.' };
  }
  // note (termasuk pengingat bahasa alami)
  if (d.pengingat && d.due_at) {
    const { simpanReminderCerdas } = await import('./remind.js');
    const hasil = await simpanReminderCerdas(
      chatId, String(d.message || 'Pengingat'), new Date(String(d.due_at)),
      opts.platform === 'telegram' ? 'telegram' : 'whatsapp',
      d.repeat_kind && d.repeat_kind !== 'none'
        ? { repeat_kind: String(d.repeat_kind), repeat_value: d.repeat_value ? String(d.repeat_value) : null }
        : undefined,
    );
    if (!hasil.ok) {
      return { ok: false, pesan: '⚠️ Gagal menyimpan pengingat. Coba lagi nanti ya.' };
    }
    // Laporan JUJUR: bedakan "baru" vs "diperbarui" (anti-dobel).
    const tambahan = hasil.keterangan ? `\n${hasil.keterangan.startsWith('\n') ? hasil.keterangan : '_' + hasil.keterangan + '_'}` : '';
    // Bila user menyebut RENTANG waktu ("jam 9 sampai jam 10"), tampilkan keduanya.
    const mulai = new Date(String(d.due_at));
    const selesaiIso = d.due_selesai ? String(d.due_selesai) : '';
    const jamTeks = selesaiIso
      ? `${formatWaktuUser(mulai)}–${new Date(selesaiIso).toLocaleTimeString('id-ID', { timeZone: zonaWaktuAktif(), hour: '2-digit', minute: '2-digit' })}`
      : `${formatWaktuUser(mulai)}`;
    return {
      ok: true,
      pesan: `✅ Pengingat disimpan — Pengingat "${hasil.pesan}" pada ${jamTeks}${tambahan}${catatanKonfirmasiZona}`,
    };
  }
  const id = await simpanCatatan(chatId, String(d.content || ''), {
    actor: opts.actor, platform: opts.platform,
    tags: Array.isArray(d.tags) ? (d.tags as string[]) : undefined,
  });
  return id
    ? { ok: true, pesan: `✅ Catatan disimpan (#${id}) — ${niat.ringkas}` }
    : { ok: false, pesan: '⚠️ Gagal menyimpan catatan. Coba lagi nanti ya.' };
}

/**
 * Tangani pesan yang mungkin berkaitan dengan pencatatan.
 * Mengembalikan { ditangani: true, reply } bila pesan sudah diurus di sini
 * (pemanggil TIDAK boleh meneruskannya ke AI), atau { ditangani: false }.
 */
export async function tanganiPencatatan(
  teks: string,
  chatId: string,
  ctx: unknown,
  opts: { actor?: string; platform: string },
): Promise<{ ditangani: boolean; reply: string; jalur: string }> {
  const s = teks.trim();
  const asli = teks.trim();
  const low = s.toLowerCase();
  catatanKonfirmasiZona = '';

  // ── 0. Jawaban konfirmasi tertunda ──
  // Dipakai untuk CATATAN / TUGAS / KEUANGAN saja (pengingat langsung disimpan,
  // lihat penjelasan di bagian B). Dibaca dari DATABASE agar bertahan lintas
  // instance Vercel serverless.
  const jawabAwal = jawabanKonfirmasi(low);
  if (jawabAwal) {
    const tertunda = await ambilKonfirmasi(chatId);
    if (tertunda) {
      if (jawabAwal === 'ya') {
        const r = await simpanDariNiat(chatId, tertunda.niat, {
          actor: tertunda.actor ?? opts.actor,
          platform: tertunda.platform ?? opts.platform,
        });
        return { ditangani: true, reply: r.pesan, jalur: 'konfirmasi-ya' };
      }
      // 'tidak'
      return { ditangani: true, reply: 'Oke, tidak dicatat. 👍', jalur: 'konfirmasi-tidak' };
    }
    // Tidak ada konfirmasi tertunda: pesan "ya"/"tidak" ini obrolan biasa,
    // biarkan diteruskan ke AI.
  }

  // ── A. PERINTAH EKSPLISIT (/) ──

  // /catat <isi>  atau  /note <isi>
  let m = low.match(/^\/(?:catat|note|notes)\s+([\s\S]+)/);
  if (m) {
    const isi = s.replace(/^\/(?:catat|note|notes)\s+/i, '').trim();
    await simpanKonfirmasi(chatId,
      { kind: 'note', yakin: 1, data: { content: isi }, ringkas: `Catatan: "${isi.slice(0, 80)}"` },
      { actor: opts.actor, platform: opts.platform });
    return { ditangani: true, reply: `Simpan catatan ini?\n"${isi.slice(0, 200)}"\n\nBalas *iya* untuk simpan, *tidak* untuk batal.`, jalur: 'perintah-catat' };
  }

  // /todo <isi>  atau  /tugas <isi>
  m = low.match(/^\/(?:todo|tugas|task)\s+([\s\S]+)/);
  if (m) {
    const isi = s.replace(/^\/(?:todo|tugas|task)\s+/i, '').trim();
    const prio = /penting|urgent|segera/.test(low) ? 1 : 2;
    const due = parseWaktuAlami(low);
    await simpanKonfirmasi(chatId,
      { kind: 'todo', yakin: 1, data: { task: isi, priority: prio, due_at: due?.toISOString() ?? null }, ringkas: `Tugas: "${isi}"` },
      { actor: opts.actor, platform: opts.platform });
    return { ditangani: true, reply: `Tambah tugas ini?\n"${isi.slice(0, 200)}"\n\nBalas *iya* untuk simpan, *tidak* untuk batal.`, jalur: 'perintah-todo' };
  }

  // /uang <nominal> [keterangan]   |   /masuk <nominal> [ket]
  m = low.match(/^\/(?:uang|keluar|out)\s+([\s\S]+)/);
  const mIn = low.match(/^\/(?:masuk|in|gaji)\s+([\s\S]+)/);
  if (m || mIn) {
    const isi = (m || mIn)![1];
    const nominal = parseNominal(isi);
    if (!nominal) {
      return { ditangani: true, reply: 'Nominalnya belum kebaca. Contoh: /uang 50000 makan siang', jalur: 'perintah-uang-gagal' };
    }
    const kind: ExpenseKind = mIn ? 'in' : 'out';
    const kategori = tebakKategori(isi);
    await simpanKonfirmasi(chatId, {
        kind: 'expense', yakin: 1,
        data: { amount: nominal, kind, category: kategori, note: isi },
        ringkas: `${kind === 'in' ? 'Pemasukan' : 'Pengeluaran'} Rp${nominal.toLocaleString('id-ID')} (${kategori})`,
      }, { actor: opts.actor, platform: opts.platform });
    return { ditangani: true, reply: `Catat ini?\n${kind === 'in' ? '💰 Pemasukan' : '💸 Pengeluaran'} *Rp${nominal.toLocaleString('id-ID')}* (${kategori})\n\nBalas *iya* untuk simpan, *tidak* untuk batal.`, jalur: 'perintah-uang' };
  }

  // /rekap [hari]
  m = low.match(/^\/rekap(?:\s+(\d+))?/);
  if (m) {
    const hari = m[1] ? Math.min(365, Math.max(1, Number(m[1]))) : 30;
    const r = await rekapUang(chatId, hari);
    return { ditangani: true, reply: formatRekapUang(r, hari), jalur: 'perintah-rekap' };
  }

  // /list  atau  /tugas-saya
  if (/^\/(?:list|daftar|tugas-saya|todos?)$/.test(low)) {
    const t = await daftarTugas(chatId, true);
    return { ditangani: true, reply: `*Tugas kamu:*\n${formatDaftarTugas(t)}`, jalur: 'perintah-list' };
  }

  // /catatan  (daftar catatan)
  if (/^\/(?:catatan|notes)$/.test(low)) {
    const c = await daftarCatatan(chatId, 10);
    return { ditangani: true, reply: `*Catatan terakhir:*\n${formatDaftarCatatan(c)}`, jalur: 'perintah-catatan' };
  }

  // /barang <isi>  atau  /belanja <isi>  — daftar barang/belanja (pakai tabel notes
  // dengan tag khusus 'belanja', agar tidak perlu tabel baru).
  m = low.match(/^\/(?:barang|belanja|stok|shopping)\s+([\s\S]+)/);
  if (m) {
    const isi = s.replace(/^\/(?:barang|belanja|stok|shopping)\s+/i, '').trim();
    const r = await simpanDariNiat(chatId,
      { kind: 'note', yakin: 1, data: { content: isi, tags: ['belanja'] }, ringkas: `Barang: "${isi.slice(0, 80)}"` },
      { actor: opts.actor, platform: opts.platform });
    return { ditangani: true, reply: r.pesan, jalur: 'perintah-barang' };
  }

  // /barang  atau  /belanja  (tanpa isi) — tampilkan daftar
  if (/^\/(?:barang|belanja|stok|shopping)$/.test(low)) {
    const list = await daftarCatatan(chatId, 20);
    const barang = list.filter((x) => Array.isArray((x as { tags?: string[] }).tags) && (x as { tags?: string[] }).tags!.includes('belanja'));
    const dipakai = barang.length ? barang : list;
    return {
      ditangani: true,
      reply: `*Daftar barang/belanja:*\n${formatDaftarCatatan(dipakai)}`,
      jalur: 'perintah-barang-list',
    };
  }

  // /selesai <id>  |  /hapus <id>
  m = low.match(/^\/selesai\s+(\d+)/);
  if (m) {
    const ok = await selesaikanTugas(chatId, Number(m[1]));
    return { ditangani: true, reply: ok ? `✅ Tugas #${m[1]} selesai!` : `Tugas #${m[1]} tidak ditemukan.`, jalur: 'perintah-selesai' };
  }
  m = low.match(/^\/hapus\s+(\d+)/);
  if (m) {
    const id = Number(m[1]);
    const a = await hapusTugas(chatId, id);
    const b = a ? false : await hapusCatatan(chatId, id);
    const c = a || b ? false : await hapusUang(chatId, id);
    return { ditangani: true, reply: a || b || c ? `🗑️ #${id} dihapus.` : `#${id} tidak ditemukan.`, jalur: 'perintah-hapus' };
  }

  // ── A0a. PROFIL WAKTU USER (zona waktu per-user, permanen) ──
  //
  // MASALAH (temuan pemilik produk 05 Okt 2026): "jangan salah membaca waktu user
  // sedang berada... misal sistem defaultnya WIB, jika user di belahan waktu lain
  // maka jadi tidak sama waktunya. Jadi jika ada user baru masuk, saat menanyakan
  // waktu / menyuruh mengingatkan / apapun yang berhubungan dengan waktu, jangan
  // sok tau dan asal jawab defaultnya — tanya dulu user di zona mana, lalu simpan
  // di database agar tidak pernah lupa. Jika sudah diketahui, tidak usah ditanya."
  //
  // ALUR:
  // 1. Bila pesan menyebut lokasi ("aku di Makassar") -> simpan profil (paling akurat).
  // 2. Bila pesan berkaitan WAKTU (tanya jam / minta pengingat / jadwal):
  //    a. Profil sudah ada & terverifikasi -> pakai, TIDAK tanya lagi.
  //    b. Profil belum ada -> TANYA dulu, JANGAN asal pakai WIB.
  // 3. Zona profil dipakai untuk semua tampilan waktu (formatWaktuUser).
  {
    // Simpan pesan user APA ADANYA untuk deteksi (bukan yang sudah dinormalisasi).
    const keputusan = await tentukanProfilWaktu(chatId, opts.platform, asli);
    setZonaAktif(keputusan.profil?.timezone);

    // Bila user BARU menyebut lokasinya (dan bukan permintaan lain), balas
    // pengakuan singkat — sebelumnya balasan kosong sehingga terasa bot diam.
    const adaDeklarasiBaru = detectUserLocationDeclaration(asli) !== null;
    if (adaDeklarasiBaru && !berkaitanDenganWaktu(asli)) {
      const p = keputusan.profil;
      const waktuSekarang = p ? waktuDiZona(p.timezone) : '';
      return {
        ditangani: true,
        reply:
          `Oke, aku catat kamu di *${p?.label ?? 'lokasi itu'}* ya${waktuSekarang ? ` — di sana sekarang ${waktuSekarang}` : ''}. ` +
          `Mulai sekarang semua pengingat & jam aku sesuaikan ke zona itu, nggak perlu kasih tahu lagi. 👍`,
        jalur: 'deklarasi-lokasi',
      };
    }

    // Bila berkaitan waktu DAN zona belum diketahui -> tanya dulu (jangan sok tahu).
    if (keputusan.perluTanya && berkaitanDenganWaktu(asli)) {
      return { ditangani: true, reply: keputusan.pertanyaan, jalur: 'tanya-zona-waktu' };
    }

    // Bila zona masih TEBAKAN dari nomor telepon, sisipkan catatan konfirmasi
    // di akhir balasan (tidak menghalangi, hanya mengingatkan).
    if (keputusan.perluKonfirmasi && keputusan.profil && berkaitanDenganWaktu(asli)) {
      catatanKonfirmasiZona =
        `\n\n_Catatan: aku pakai zona *${keputusan.profil.label}*. Kalau bukan, bilang saja "aku di <kota>" ya._`;
    }
  }

  // ── A1. UBAH / UNDUR / BATALKAN PENGINGAT ──
  //
  // MASALAH (temuan pemilik produk 05 Okt 2026): "jika user bilang waktu rapat
  // di undur 1 jam jadi jam 10 sampai jam 11, atau hanya bilang di undur satu
  // jam, maka apa yg terjadi? apakah bot akan menghapus yg sebelumnya jam 9 atau
  // akan jadi 2?"
  //
  // SEBELUMNYA: permintaan ini LOLOS ke AI -> pengingat lama TETAP ADA (jadi 2),
  // dan AI bisa mengarang "sudah diundur" padahal tidak. Sekarang ditangani
  // dengan benar: pengingat lama DIUBAH (bukan ditambah).
  {
    const permintaan = deteksiPermintaanUbah(s);
    if (permintaan) {
      const daftar = await daftarPengingatPending(chatId);
      if (daftar.length === 0) {
        return {
          ditangani: true,
          reply: 'Belum ada pengingat aktif yang bisa diubah/dibatalkan. Ketik misalnya *ingatkan besok jam 9 ada rapat* dulu ya.',
          jalur: 'ubah-tanpa-target',
        };
      }

      const target = pilihTarget(permintaan, daftar);

      // BATAL -> batalkan pengingat yang dituju.
      if (permintaan.aksi === 'batal') {
        if (target) {
          const okBatal = await batalkanPengingat(target.id);
          return {
            ditangani: true,
            reply: okBatal
              ? `🗑️ Pengingat "${target.message}" (${formatWaktuUser(new Date(target.due_at))}) sudah dibatalkan.`
              : '⚠️ Gagal membatalkan pengingat. Coba lagi ya.',
            jalur: 'ubah-batal',
          };
        }
        const daftarB = daftar.map((r, i) => `${i + 1}. "${r.message}" — ${formatWaktuUser(new Date(r.due_at))}`).join('\n');
        return {
          ditangani: true,
          reply: `Pengingat aktif kamu:\n${daftarB}\n\nSebutkan yang mana, mis. *batalin rapat*.`,
          jalur: 'ubah-batal-tanya',
        };
      }

      // UNDUR / MAJUKAN / GESER -> hitung waktu baru.
      let waktuBaru: Date | null = permintaan.waktuBaru ?? null;
      if (!waktuBaru && target) {
        const selisih = permintaan.selisihMenit;
        if (selisih !== null) {
          const arah = permintaan.aksi === 'majukan' ? -1 : 1;
          waktuBaru = new Date(new Date(target.due_at).getTime() + arah * selisih * 60_000);
        }
      }

      if (target && waktuBaru) {
        const okUbah = await ubahPengingat(target.id, waktuBaru);
        if (okUbah) {
          const label = permintaan.aksi === 'majukan' ? 'dimajukan' : 'diundur';
          return {
            ditangani: true,
            reply: [
              `✅ Pengingat ${label} (TIDAK dobel — yang lama diperbarui).`,
              ``,
              `*Sebelumnya:* "${target.message}" — ${formatWaktuUser(new Date(target.due_at))}`,
              `*Sekarang :* "${target.message}" — ${formatWaktuUser(waktuBaru)}`,
              catatanKonfirmasiZona,
            ].join('\n'),
            jalur: 'ubah-undur',
          };
        }
        return { ditangani: true, reply: '⚠️ Gagal mengubah pengingat. Coba lagi ya.', jalur: 'ubah-gagal' };
      }

      // Tidak bisa hitung waktu baru -> tanya user (jangan mengarang).
      const daftarTeks = daftar.map((r, i) => `${i + 1}. "${r.message}" — ${formatWaktuUser(new Date(r.due_at))}`).join('\n');
      return {
        ditangani: true,
        reply: `Pengingat aktif kamu:\n${daftarTeks}\n\nSebutkan waktu barunya, mis. *undur rapat jadi jam 10* atau *undur satu jam*.`,
        jalur: 'ubah-tanya',
      };
    }
  }

  // ── A0. PERMAINAN (mesin game nyata, state tersimpan di DB) ──
  // Diletakkan PALING AWAL agar saat permainan aktif, semua pesan berikutnya
  // (mis. "merah 5", "e2 e4", "3 5") diperlakukan sebagai LANGKAH permainan —
  // bukan sebagai perintah catat/pengingat.
  {
    const hasilGame = await tanganiGame(s, chatId, opts.platform);
    if (hasilGame.ditangani) {
      return { ditangani: true, reply: hasilGame.reply, jalur: hasilGame.jalur };
    }
  }

  // ── A1b. RINGKASAN PERIODIK (/ringkasan) ──
  //
  // FITUR BARU (audit 05 Okt 2026): satu perintah menyajikan gambaran lengkap —
  // keuangan, tugas, pengingat, catatan. Semua angka dari DATABASE (tidak dikarang).
  {
    const rk = mintaRingkasan(low);
    if (rk) {
      const teks = await susunRingkasan(chatId, { hari: rk.hari });
      return { ditangani: true, reply: teks, jalur: 'ringkasan' };
    }
  }

  // ── A2. HAPUS / SELESAI LEWAT BAHASA ALAMI (agar bisa lewat Voice Note) ──
  // Orang yang berbicara tidak mengetik "/hapus 5" — mereka bilang
  // "hapus tugas nomor lima" atau "tandai selesai nomor tiga".
  // BUG YANG DIPERBAIKI (05 Okt 2026): sebelumnya hanya format "/hapus <id>"
  // yang dikenali, sehingga lewat VN tidak bisa menghapus.
  {
    // Angka boleh DIGIT ("nomor 5") atau KATA ("nomor satu") — orang yang
    // berbicara lewat Voice Note tidak mengetik angka.
    const lowAngka = angkaKataKeDigit(low);
    const mHapus = lowAngka.match(/\b(?:hapus|buang|hilangkan|delete)\s+(?:tugas|catatan|barang|belanja|nomor|no|yang)?\s*(?:nomor|no|#)?\s*(\d+)\b/);
    const mSelesai = lowAngka.match(/\b(?:selesai|selesaikan|sudah|udah|done|beres)\s+(?:tugas|nomor|no|#)?\s*(\d+)\b/);
    if (mSelesai) {
      const id = Number(mSelesai[1]);
      const okk = await selesaikanTugas(chatId, id);
      return { ditangani: true, reply: okk ? `✅ Tugas #${id} selesai!` : `Tugas #${id} tidak ditemukan.`, jalur: 'niat-selesai' };
    }
    if (mHapus) {
      const id = Number(mHapus[1]);
      const a = await hapusTugas(chatId, id);
      const b = a ? false : await hapusCatatan(chatId, id);
      const cc = a || b ? false : await hapusUang(chatId, id);
      return { ditangani: true, reply: a || b || cc ? `🗑️ #${id} dihapus.` : `#${id} tidak ditemukan.`, jalur: 'niat-hapus' };
    }
  }

  // ── B0. PERTANYAAN (jawab dari DATABASE, JANGAN dikirim ke AI) ──
  // Temuan 04 Okt: "berapa sisa uang saya" pernah dijawab AI dengan ANGKA
  // KARANGAN (Rp20.000) padahal tabel kosong. Pertanyaan seperti ini HARUS
  // dijawab di sini dari data nyata, bukan diserahkan ke model.
  const jenisTanya = deteksiPertanyaan(s);
  if (jenisTanya) {
    const jawab = await jawabPertanyaan(jenisTanya, chatId);
    return { ditangani: true, reply: jawab, jalur: `tanya-${jenisTanya}` };
  }

  // ── B. DETEKSI NIAT BAHASA ALAMI ──
  //
  // ATURAN KONFIRMASI (diperjelas 04 Okt 2026):
  // - PENGINGAT  -> LANGSUNG SIMPAN, tanpa konfirmasi.
  //   Alasan (permintaan pemilik produk): "remind itu kan berpacu waktu, jika
  //   hanya 1 menit maka waktu akan habis oleh balasan ya/tidak". Kalau user
  //   minta "ingatkan 1 menit lagi" lalu bot balas "balas iya untuk simpan",
  //   waktu 1 menit itu terpakai untuk tanya-jawab sehingga pengingat jadi telat
  //   atau tidak berguna. Jadi pengingat harus langsung tersimpan.
  // - CATATAN / TUGAS / KEUANGAN -> tetap KONFIRMASI dulu (aman, hindari salah
  //   catat; tidak terikat waktu).
  const niat = deteksiNiat(s);
  if (niat) {
    const iniPengingat = niat.kind === 'note' && Boolean(niat.data.pengingat);

    if (iniPengingat) {
      // Pengingat: langsung simpan (tidak boleh ada balasan tanya-jawab).
      const r = await simpanDariNiat(chatId, niat, { actor: opts.actor, platform: opts.platform });
      return { ditangani: true, reply: r.pesan, jalur: `niat-${niat.kind}` };
    }

    // Catatan / tugas / keuangan: konfirmasi dulu.
    await simpanKonfirmasi(chatId, niat, { actor: opts.actor, platform: opts.platform });
    return {
      ditangani: true,
      reply: `Sepertinya kamu mau mencatat:\n*${niat.ringkas}*\n\nBalas *iya* untuk simpan, *tidak* untuk batal.`,
      jalur: `niat-${niat.kind}`,
    };
  }

  // ── C. NIAT IMPLISIT (tanpa kata kunci eksplisit) ──
  //
  // MASALAH (temuan pemilik produk 05 Okt 2026):
  // "kalo perintah user tidak ada kata eksplisit dari sistem yg kamu buat ini
  //  gimna? misalnya simpan data ini atau yg lainnya"
  //
  // Deteksi deterministik di atas HANYA mengenali kata kunci baku (catat, simpan,
  // tambah, ingatkan, ...). Bila user memakai kalimat lain — mis.
  //   "tolong dicatat ya aku habis 50rb"     (kata "dicatat" tidak baku)
  //   "jangan lupa besok aku ada rapat"      (tidak ada kata perintah)
  //   "set reminder buat besok pagi"         ("set reminder" bahasa campur)
  // — permintaan itu LOLOS ke AI, dan AI hanya menjawab obrolan tanpa menyimpan.
  //
  // SOLUSI: bila tidak ada niat eksplisit DAN teksnya mengandung sinyal
  // "permintaan aksi" (kata minta/permintaan + objek data), jalankan detektor
  // CADANGAN yang lebih longgar — tapi TETAP meminta konfirmasi user sebelum
  // menyimpan, supaya salah tangkap tidak langsung mengotori database.
  const niatImplisit = deteksiNiatImplisit(s);
  if (niatImplisit) {
    // Pengingat langsung simpan (berpacu waktu); lainnya konfirmasi.
    const iniPengingat = niatImplisit.kind === 'note' && Boolean(niatImplisit.data.pengingat);
    if (iniPengingat) {
      const r = await simpanDariNiat(chatId, niatImplisit, { actor: opts.actor, platform: opts.platform });
      return { ditangani: true, reply: r.pesan, jalur: `implisit-${niatImplisit.kind}` };
    }
    await simpanKonfirmasi(chatId, niatImplisit, { actor: opts.actor, platform: opts.platform });
    return {
      ditangani: true,
      reply: `Sepertinya kamu mau mencatat:\n*${niatImplisit.ringkas}*\n\nBalas *iya* untuk simpan, *tidak* untuk batal.`,
      jalur: `implisit-${niatImplisit.kind}`,
    };
  }

  return { ditangani: false, reply: '', jalur: '' };
}

/**
 * Deteksi niat CADANGAN — lebih longgar dari `deteksiNiat`, untuk kalimat yang
 * tidak memakai kata kunci baku.
 *
 * BEDA dengan deteksiNiat: fungsi ini TIDAK mewajibkan kata perintah di awal.
 * Sebagai gantinya ia mencari POLA kalimat yang jelas-jelas permintaan aksi
 * terhadap data, mis.:
 *   "tolong dicatat aku habis 50rb buat makan"   -> pengeluaran
 *   "jangan lupa besok aku ada rapat jam 9"      -> pengingat
 *   "set reminder 10 menit lagi"                 -> pengingat
 *   "aku perlu beli susu"                        -> tugas
 *
 * Tetap KONSERVATIF: tanpa sinyal permintaan yang jelas, mengembalikan null
 * (biar diteruskan ke AI sebagai obrolan biasa).
 */
export function deteksiNiatImplisit(teks: string): NiatTerdeteksi | null {
  const asli = teks.trim();
  const s = asli.toLowerCase();
  if (s.length < 5 || s.length > 400) return null;

  // Harus ada sinyal "permintaan aksi" — kalau tidak, ini obrolan biasa.
  const sinyalMinta =
    /\b(?:tolong|please|pls|mohon|bantu|bantuin|bisa|bisakah|boleh|coba|cek|masukin|input|daftarkan|list|set|pasang|buatkan|bikinin|jadwalkan|siapkan|tandai|mark)\b/i.test(s) ||
    /\b(?:jangan\s*lupa|jgn\s*lupa|jngn\s*lupa|ingat\s*ya|catat\s*ya|dicatat|tercatat|notes?\s*:)/i.test(s) ||
    // "aku perlu ...", "aku harus ..." — permintaan implisit untuk dicatat sebagai tugas
    /\b(?:aku|saya|gue|gw|kita)\s+(?:perlu|harus|kudu|mesti|pengen|pengin|mau|ingin)\s+\w+/i.test(s) ||
    // DIPERLUAS (05 Okt 2026): kalimat pencatatan sehari-hari tanpa kata "catat".
    //   "beli kopi 25rb", "bayar listrik 350000", "jajan gorengan 10k",
    //   "dapat gaji lima juta", "harus beli galon"
    /\b(?:beli|bayar|jajan|ongkos|habis|abis|dapat|dapet|gaji|belanja|transferan|bonus|thr|parkir|bensin|tagihan|sewa|cicilan|utang|hutang|pengeluaran|pemasukan|pengeluaranku|pemasukanku)\b/i.test(s) ||
    /^\s*(?:harus|perlu|kudu|mesti)\s+\w+/i.test(s);
  if (!sinyalMinta) return null;

  // Tolak kalau jelas obrolan/pertanyaan (agar tidak salah tangkap).
  if (/\?$/.test(s)) return null;
  if (/\b(?:apa|apakah|apaan|berapa|brp|kenapa|mengapa|gimana|bagaimana|kok|emang|memang)\b/i.test(s)) return null;
  // "tadi" menandakan masa lalu -> biasanya obrolan, TAPI tetap boleh bila user
  // JELAS meminta dicatat ("tolong dicatat ... tadi"). Jadi hanya tolak bila
  // tidak ada kata minta catat eksplisit.
  const mintaCatatEksplisit = /\b(?:tolong\s+)?(?:catat|dicatat|tercatat|simpan|masukin|input|bantu\s+catat)\b/i.test(s);
  // Transaksi masa lalu yang JELAS ("tadi beli bensin lima puluh ribu") tetap dicatat
  // bila ada nominal + kata transaksi. Tanpa nominal, "tadi" = obrolan biasa.
  const transaksiJelas = /\b(?:beli|bayar|jajan|ongkos|habis|abis|dapat|dapet|gaji|belanja|transferan|parkir|bensin|tagihan|cicilan|utang)\b/i.test(s) && parseNominal(s) !== null;
  if (!mintaCatatEksplisit && !transaksiJelas && /\b(?:tadi|kemarin|barusan|baru\s*aja|td)\b/i.test(s)) return null;

  // a) PENGINGAT: ada kata ingat/lupa/reminder + waktu jelas
  if (/\b(?:ingat|ingatkan|ingetin|lupa|remind|reminder|pengingat)\b/i.test(s)) {
    const kapan = parseWaktuAlami(s);
    if (kapan) {
      let pesan = asli
        .replace(/^\s*\/?(?:tolong|please|pls|mohon|bantu|bantuin|coba|set|pasang|buatkan|bikinin|jadwalkan|siapkan)\s+/i, '')
        .replace(/\b(?:jangan\s*lupa|jgn\s*lupa|jngn\s*lupa|ingat\s*ya|ingatkan|ingetin|ingat|remind(?:er)?|pengingat)\b/gi, '')
        .replace(/\b(besok|lusa|hari ini|nanti|pagi|siang|sore|malam|subuh)\b/gi, '')
        .replace(/\b(jam|pukul)\s*\d{1,2}([:.]\d{2})?/gi, '')
        .replace(/\b\d+\s*(menit|jam|hari|minggu|bulan)\s*(lagi|kemudian)?\b/gi, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
      if (pesan.length < 3) pesan = asli;
      return {
        kind: 'note', yakin: 0.7,
        data: { pengingat: true, due_at: kapan.toISOString(), message: pesan },
        ringkas: `Pengingat "${pesan}" pada ${formatWaktuUser(kapan)}`,
      };
    }
  }

  // b) KEUANGAN: ada nominal + konteks uang.
  //
  // DIPERLUAS (05 Okt 2026): sebelumnya butuh kata "catat" ATAU kata uang baku.
  // Sekarang cukup nominal + kata kerja transaksi umum (beli/bayar/jajan/ongkos/
  // habis/dapat/gaji/dll) — cara orang mencatat pengeluaran sehari-hari.
  // Tetap AMAN karena wajib ada NOMINAL (angka/uang), jadi obrolan seperti
  // "aku tadi makan enak" tidak ikut tertangkap.
  const nominal = parseNominal(s);
  const konteksUang = /\b(?:keluar|masuk|beli|bayar|habis|abis|dapat|dapet|gaji|belanja|jajan|ongkos|biaya|pendapatan|pemasukan|pengeluaran|income|expense|uang|duit|rupiah|rp|transferan|kiriman|bonus|thr|parkir|bensin|tarif|sewa|tagihan|listrik|air|internet|pulsa|kuota|obat|dokter|sekolah|spp|kontrakan|kos|utang|hutang|cicilan|cicil)\b/i.test(s);
  // Sinyal "minta catat" + ada nominal -> anggap keuangan (tanpa wajib kata uang).
  const mintaCatat = /\b(?:catat|dicatat|tercatat|simpan|masukin|input|tulis)\b/i.test(s);
  // Sinyal uang KUAT (kata satuan uang) -> cukup dengan nominal saja.
  // CATATAN: pola lama `\b(?:rb|ribu|k)\b` GAGAL untuk "100rb" karena tidak ada
  // batas kata antara "100" dan "rb". Sekarang memakai pola angka+satuan langsung.
  const satuanUangKuat = /\d+\s*(?:rb|ribu|k|jt|juta|miliar|milyar)\b|\b(?:rupiah|rp)\s*\d/i.test(s);
  // Kata "pengeluaran/pemasukan/pengeluaranku/pemasukanku" + nominal -> pasti keuangan.
  const kataPengeluaran = /\b(?:pengeluaran|pemasukan|pengeluaranku|pemasukanku|belanjaku|jajananku|uang\s*keluar|uang\s*masuk|total\s*keluar|total\s*masuk)\b/i.test(s);
  if (nominal && (konteksUang || mintaCatat || satuanUangKuat || kataPengeluaran)) {
    const kind: ExpenseKind = /\b(?:masuk|dapat|dapet|gaji|pendapatan|pemasukan|income)\b/i.test(s) ? 'in' : 'out';
    const kategori = tebakKategori(s);
    return {
      kind: 'expense', yakin: 0.7,
      data: { amount: nominal, kind, category: kategori, note: asli },
      ringkas: `${kind === 'in' ? 'Pemasukan' : 'Pengeluaran'} Rp${nominal.toLocaleString('id-ID')} (${kategori})`,
    };
  }

  // c) TUGAS: ada kata perlu/harus/mesti + KATA KERJA apa pun (lebih longgar),
  //    atau ada kata "tugas/todo" + isi.
  // KATA KEINGINAN ("pengen/pengin/mau/ingin") BUKAN tugas — itu obrolan/angan-angan.
  // Temuan uji 05 Okt 2026: "aku pengen beli mobil" salah diklasifikasi jadi tugas.
  // Hanya KEWAJIBAN ("perlu/harus/kudu/mesti") yang dianggap tugas.
  const mTugas = asli.match(/\b(?:aku|saya|gue|gw|kita)?\s*(?:perlu|harus|kudu|mesti)\s+([a-z]{3,20}\s+[\s\S]{2,80})/i);
  // Varian tanpa subjek: "harus beli galon", "perlu bayar pajak"
  const mTugasPolos = asli.match(/^\s*(?:perlu|harus|kudu|mesti)\s+([a-z]{3,20}\s+[\s\S]{2,80})/i);
  if (mTugasPolos && !mTugas) {
    const isi = mTugasPolos[0].trim();
    return {
      kind: 'todo', yakin: 0.65,
      data: { task: isi, priority: 2, due_at: null },
      ringkas: `Tugas: "${isi}"`,
    };
  }
  if (mTugas && !/\b(?:tidur|makan|minum|istirahat|jalan|pulang|pergi|main|nonton|dengar|lihat|tahu|tau|coba)\b/i.test(mTugas[1].split(' ')[0])) {
    const isi = mTugas[0].trim();
    return {
      kind: 'todo', yakin: 0.65,
      data: { task: isi, priority: 2, due_at: null },
      ringkas: `Tugas: "${isi}"`,
    };
  }

  // d) CATATAN: "simpan/tulis/dicatat" + isi jelas
  const mCatat = asli.match(/\b(?:simpan|dicatat|tercatat|tulis(?:kan)?|masukin|input(?:kan)?)\b\s*(?:ini|nih|dong)?[:\s]+([\s\S]{4,200})/i);
  if (mCatat) {
    const isi = mCatat[1].trim();
    if (isi.length >= 4) {
      return {
        kind: 'note', yakin: 0.65,
        data: { content: isi },
        ringkas: `Catatan: "${isi.slice(0, 80)}"`,
      };
    }
  }

  return null;
}

// ============================================================================
// DETEKSI PERTANYAAN — jawab dari DATABASE, bukan dari "pengetahuan" model
// ============================================================================

/**
 * KENAPA INI PENTING (temuan nyata 04 Okt 2026):
 * User bertanya "berapa sisa uang saya" padahal tabel `expenses` KOSONG (0 baris).
 * Bot menjawab "Sisa uang kamu tinggal Rp20.000 dari pemasukan 100 ribu dikurangi
 * pengeluaran 80 ribu" — ANGKA KARANGAN. Halusinasi data keuangan itu berbahaya:
 * user bisa mengambil keputusan salah berdasarkan angka palsu.
 *
 * Sebabnya: pertanyaan seperti itu TIDAK melewati modul ini sama sekali — langsung
 * dikirim ke model AI, dan model "menjawab" dengan mengarang.
 *
 * Solusi: deteksi pertanyaan keuangan/tugas/catatan di sini, jawab dari DATABASE.
 * Bila data kosong, katakan JUJUR bahwa belum ada catatan — jangan mengarang.
 */
export function deteksiPertanyaan(teks: string): 'keuangan' | 'tugas' | 'catatan' | null {
  const s = teks.toLowerCase().trim();
  if (s.length < 5 || s.length > 200) return null;

  // Pertanyaan keuangan: "berapa sisa uang", "total pengeluaran", "rekap", "saldo"
  if (
    /\b(berapa|brp|total|rekap|sisa|saldo|jumlah)\b/.test(s) &&
    /\b(uang|duit|pengeluaran|pemasukan|belanja|budget|keuangan|tabungan|cash|dompet)\b/.test(s)
  ) return 'keuangan';
  // "pengeluaranku berapa", "uangku sisa berapa", "duitku berapa"
  if (/\b(uang|duit|pengeluaran|pemasukan|belanja|keuangan|saldo|tabungan|budget)(ku|saya|gue|aku)?\b/.test(s) &&
      /\b(berapa|brp|total|rekap|sisa|saldo|jumlah)\b/.test(s)) return 'keuangan';
  if (/^\/?(rekap|saldo|keuangan|dompet|kas)\b/.test(s)) return 'keuangan';

  // Pertanyaan tugas: "tugas saya apa", "apa yang harus dikerjakan", "list tugas"
  if (
    /\b(apa|apa aja|apa saja|list|daftar|lihat|tampilkan|cek)\b/.test(s) &&
    /\b(tugas|todo|to-do|task|kerjaan|pekerjaan|pr)\b/.test(s)
  ) return 'tugas';
  if (/\b(tugas|todo)(ku|saya|gue|aku)\b/.test(s)) return 'tugas';

  // Pertanyaan catatan: "catatanku apa", "lihat catatan"
  if (
    /\b(apa|apa aja|apa saja|list|daftar|lihat|tampilkan|cek)\b/.test(s) &&
    /\b(catatan|note|notes|jurnal)\b/.test(s)
  ) return 'catatan';
  if (/\b(catatan|jurnal)(ku|saya|gue|aku)\b/.test(s)) return 'catatan';

  return null;
}

/** Jawab pertanyaan dari DATABASE (tanpa AI, tanpa halusinasi). */
export async function jawabPertanyaan(
  jenis: 'keuangan' | 'tugas' | 'catatan',
  chatId: string,
  hari: number = 30,
): Promise<string> {
  if (jenis === 'keuangan') {
    const r = await rekapUang(chatId, hari);
    if (r.masuk === 0 && r.keluar === 0 && r.perKategori.length === 0) {
      return `Belum ada catatan keuangan sama sekali.\n\nKalau mau mencatat, kirim misalnya:\n• /uang 50000 makan siang\n• /masuk 5000000 gaji\natau ketik biasa: "catat pengeluaran 25rb buat bensin".`;
    }
    return formatRekapUang(r, hari);
  }
  if (jenis === 'tugas') {
    const t = await daftarTugas(chatId, true);
    if (!t.length) {
      return 'Belum ada tugas yang tercatat. 🎉\n\nKalau mau menambah, kirim misalnya: /todo beli susu';
    }
    return `*Tugas kamu (${t.length}):*\n${formatDaftarTugas(t)}`;
  }
  const c = await daftarCatatan(chatId, 10);
  if (!c.length) {
    return 'Belum ada catatan tersimpan.\n\nKalau mau mencatat, kirim misalnya: /catat resep nasi goreng';
  }
  return `*Catatan terakhir (${c.length}):*\n${formatDaftarCatatan(c)}`;
}
