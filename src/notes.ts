/**
 * PENCATATAN PRIBADI, catatan, tugas, keuangan, kebiasaan.
 *
 * KENAPA MODUL INI ADA (permintaan pemilik produk, 04 Okt 2026):
 *   "apakah bot nya bisa digunakan untuk mencatat dan mengingat sesuatu seperti
 *    to do list, mencatat pengeluaran uang, ataupun lainnya?"
 *   "kalo ada saran lain seperti fitur todo list dan lainnya apapun itu coba
 *    masukan dan tambahkan saja"
 *
 * Sebelumnya bot hanya punya /remind (pengingat berbasis menit) dan /salah
 * (preferensi personal). Modul ini menambah 4 kemampuan pencatatan:
 *   1. notes   , catatan bebas & jurnal (resep, ide, info penting)
 *   2. todos   , daftar tugas dengan prioritas & tenggat
 *   3. expenses, catatan pengeluaran/pemasukan + rekap
 *   4. habits  , kebiasaan berulang + streak
 *
 * DUA CARA PAKAI (permintaan user: "bisa tanpa format /?"):
 *   A. Bahasa alami, "catat pengeluaran 50rb buat makan"
 *      -> dideteksi `deteksiNiat()`, lalu DIKONFIRMASI dulu sebelum disimpan
 *         (permintaan user: "konfirmasi dulu (aman, hindari salah catat)").
 *   B. Perintah /, "/catat", "/todo", "/uang", "/rekap" (cepat & pasti)
 *
 * PRINSIP: modul ini TIDAK memanggil AI sendiri untuk hal yang bisa dipastikan
 * dengan pola. AI hanya dipakai di lapisan atas (skills.ts) bila perlu; di sini
 * semuanya deterministik agar cepat, murah, dan tidak berhalusinasi.
 */
import { db } from './db.js';
import { formatInZone } from './timezone.js';
import { tanganiGame } from './games/index.js';
import { deteksiPermintaanUbah, daftarPengingatPending, pilihTarget, ubahPengingat, batalkanPengingat } from './reminder-ubah.js';
import { ambilProfilWaktu, getCacheProfil, butuhLokasiAtauWaktu, tentukanProfilWaktu, berkaitanDenganWaktu, waktuDiZona } from './user-profile.js';
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
  /**
   * Nomor urut PER-USER (1, 2, 3, ...) berdasarkan urutan dibuat.
   *
   * KENAPA (perbaikan 06 Okt 2026): laporan pemilik produk —
   * "kenapa baru menambahkan tugas satu tapi sudah #13?"
   *
   * SEBAB: kolom `id` adalah SERIAL global (auto-increment). Setiap tugas yang
   * PERNAH dibuat menaikkan counter, termasuk tugas yang sudah dihapus. Jadi
   * tugas pertama milik user bisa ber-ID #13.
   *
   * SEKARANG: yang DITAMPILKAN adalah `nomor` (urutan per-user), bukan `id`.
   * `id` tetap dipakai di belakang layar untuk operasi database.
   */
  nomor?: number;
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
 * gagal dibuatkan pengingat, dan AI lalu mengarang "pengingat disimpan".
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

// ── HELPER ZONA WAKTU (perbaikan 06 Okt 2026) ──
//
// BUG BESAR YANG DIPERBAIKI: "buatkan jadwal rutin tiap jam 6 pagi" tersimpan
// sebagai 06:00 UTC (= 13:00 WIB), bukan 06:00 WIB.
//
// SEBAB: `Date.setHours(6)` memakai zona waktu SERVER. Di Vercel (UTC), itu
// berarti 06:00 UTC. Di lokal (WIB) kebetulan benar, sehingga bug tidak terlihat
// saat diuji lokal. Di produksi, SEMUA pengingat jam menjadi meleset.
//
// PERBAIKAN: semua perhitungan jam dilakukan di ZONA WAKTU USER, bukan server.

/** Offset zona (ms) pada waktu tertentu: waktuLokal - waktuUTC. */
function offsetZona(ms: number, zona: string): number {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: zona, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    const map: Record<string, string> = {};
    for (const p of dtf.formatToParts(new Date(ms))) map[p.type] = p.value;
    const asUTC = Date.UTC(
      Number(map.year), Number(map.month) - 1, Number(map.day),
      Number(map.hour) % 24, Number(map.minute), Number(map.second),
    );
    return asUTC - ms;
  } catch {
    return 0;
  }
}

/** Ambil komponen tanggal & waktu di ZONA tertentu dari sebuah Date. */
function komponenDiZona(d: Date, zona: string): { y: number; mo: number; d: number; h: number; mi: number } {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: zona, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
  const map: Record<string, string> = {};
  for (const p of dtf.formatToParts(d)) map[p.type] = p.value;
  return {
    y: Number(map.year), mo: Number(map.month), d: Number(map.day),
    h: Number(map.hour) % 24, mi: Number(map.minute),
  };
}

/**
 * Buat Date dari komponen waktu di ZONA tertentu.
 * Menggeser hari secara aman (mis. tanggal 31 + 1 hari -> bulan berikutnya).
 */
function dariKomponenZona(
  y: number, mo: number, d: number, h: number, mi: number, zona: string,
): Date {
  // Normalisasi lewat Date.UTC (menangani overflow tanggal/bulan otomatis).
  let ms = Date.UTC(y, mo - 1, d, h, mi, 0, 0);
  // Koreksi SATU KALI: kurangi offset zona. Diverifikasi:
  //   Date.UTC(2026,9,6,6,0) = 06:00Z -> -7j = 23:00Z (tgl 5) = 06:00 WIB ✅
  // CATATAN: JANGAN dikoreksi dua kali. Percobaan sebelumnya memakai dua
  // koreksi dan menghasilkan 16:00Z = 23:00 WIB (SALAH, selisih 10 jam).
  // Koreksi berulang hanya diperlukan untuk zona dengan DST dan menghitung
  // offset dari waktu yang SUDAH dikoreksi — di sini satu kali sudah tepat
  // untuk WIB/WITA/WIT (tanpa DST).
  ms -= offsetZona(ms, zona);
  return new Date(ms);
}

/** Geser sebuah Date sebanyak N hari DI ZONA tertentu (aman saat ganti bulan). */
function geserHariDiZona(d: Date, hari: number, zona: string): Date {
  const k = komponenDiZona(d, zona);
  return dariKomponenZona(k.y, k.mo, k.d + hari, k.h, k.mi, zona);
}

/** Set jam:menit pada sebuah Date DI ZONA tertentu. */
function setJamDiZona(d: Date, h: number, mi: number, zona: string): Date {
  const k = komponenDiZona(d, zona);
  return dariKomponenZona(k.y, k.mo, k.d, h, mi, zona);
}

export function parseWaktuAlami(
  teks: string,
  sekarang: Date = new Date(),
  zonaZona?: string,
): Date | null {
  const s = angkaKataKeDigit(teks.toLowerCase().trim());
  // Zona waktu untuk perhitungan jam. Prioritas: argumen > zona user aktif > WIB.
  const zona = zonaZona || (typeof zonaAktif === 'string' && zonaAktif ? zonaAktif : 'Asia/Jakarta');
  const hasil = new Date(sekarang.getTime());

  // "N menit lagi" / "N jam lagi" / "N hari lagi", N boleh angka atau kata.
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
    // Bila ada jam eksplisit ("2 jam lagi jam 8"), abaikan, jeda lebih pasti.
    //
    // PRESISI (perbaikan 06 Okt 2026): bulatkan ke AWAL MENIT lalu kurangi 5
    // detik. Temuan pemilik produk: "set pengingat 12.48 tapi bot mengingatkan
    // 12.49, ngaret 1 menit."
    //
    // SEBAB: due_at = 12:48:57 (ada detik). Cron berjalan tiap menit pada detik
    // :00, jadi 12:48:00 BELUM melewati due_at (masih 57 detik) -> baru terkirim
    // di 12:49:00 = terasa ngaret 1 menit.
    //
    // SEKARANG: dibulatkan ke BAWAH (floor) ke awal menit, TANPA pengurangan.
    // Contoh: 13:21:30 + 5 menit = 13:26:30 -> floor 13:26:00.
    //
    // MENGAPA TANPA -5 DETIK (perbaikan 06 Okt 2026):
    //   Laporan: "bot mencatat 13.25, padahal dikirim 13.26" (beda 1 menit).
    //   SEBAB: dulu ada -5 detik -> due 13:25:55 -> TAMPILAN "13.25" sedangkan
    //   cron mengirim pada 13:26:00. Tampilan & pengiriman jadi TIDAK SINKRON.
    //
    //   -5 detik sebenarnya TIDAK diperlukan: cron berjalan tiap menit dan
    //   dieksekusi sedikit SETELAH detik 0 (mis. 13:26:00.3), sehingga
    //   `due_at (13:26:00) <= now (13:26:00.3)` bernilai BENAR -> terkirim
    //   pada 13:26 = SESUAI TAMPILAN.
    //
    // HASIL: menit yang DITAMPILKAN == menit PENGIRIMAN (konsisten).
    const target = new Date(sekarang.getTime() + ms);
    target.setSeconds(0, 0);
    return target;
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
    let d = setJamDiZona(sekarang, j1, men1, zona);
    if (d.getTime() <= sekarang.getTime()) d = geserHariDiZona(d, 1, zona);
    let selesai = setJamDiZona(d, j2, men2, zona);
    // Bila jam selesai < jam mulai, berarti lewat tengah malam.
    if (selesai.getTime() <= d.getTime()) selesai = geserHariDiZona(selesai, 1, zona);
    Object.defineProperty(d, 'selesai', { value: selesai, enumerable: false });
    return d;
  }

  // TANGGAL BULANAN: "tanggal 1", "tgl 15" -> tanggal itu, jam 08:00 (default).
  // Temuan uji 05 Okt 2026: "ingatkan tiap tanggal 1 bayar listrik" gagal karena
  // "tanggal 1" tidak dikenali (tidak ada jam) sehingga jatuh ke deteksi keuangan.
  const mTanggal = s.match(/\b(?:tanggal|tgl)\s+(\d{1,2})\b/);
  if (mTanggal) {
    const tgl = Math.min(31, Math.max(1, Number(mTanggal[1])));
    const k = komponenDiZona(sekarang, zona);
    let d = dariKomponenZona(k.y, k.mo, tgl, 8, 0, zona);
    if (d.getTime() <= sekarang.getTime()) {
      d = dariKomponenZona(k.y, k.mo + 1, tgl, 8, 0, zona);
    }
    return d;
  }

  // BAGIAN HARI tanpa jam eksplisit: "nanti malam", "malam ini", "pagi ini",
  // "besok pagi", "sore nanti". Jam default: subuh 4, pagi 7, siang 12,
  // sore 16, malam 19. DIPERLUAS 05 Okt 2026, sebelumnya "jangan lupa nanti
  // malam bayar utang" tidak dikenali karena hanya ada kata bagian hari.
  const mBagianHari = s.match(/\b(subuh|pagi|siang|sore|petang|malam)\b/);
  if (mBagianHari && !/(?:jam|pukul)\s*\d/.test(s)) {
    const jamDefault: Record<string, number> = { subuh: 4, pagi: 7, siang: 12, sore: 16, petang: 16, malam: 19 };
    const j = jamDefault[mBagianHari[1]];
    let d = setJamDiZona(sekarang, j, 0, zona);
    // Bila jam itu sudah lewat hari ini -> besok.
    if (d.getTime() <= sekarang.getTime()) d = geserHariDiZona(d, 1, zona);
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

  let hasilZ = hasil;
  if (geserHari !== null) hasilZ = geserHariDiZona(hasilZ, geserHari, zona);
  if (jam !== null) {
    hasilZ = setJamDiZona(hasilZ, jam, menit, zona);
  } else if (geserHari !== null) {
    // Tanpa jam eksplisit → default 08:00 pagi
    hasilZ = setJamDiZona(hasilZ, 8, 0, zona);
  }
  // Bila hasil sudah lewat (mis. "jam 8" tapi sekarang 9 malam) → besok
  if (hasilZ.getTime() <= sekarang.getTime() && geserHari === null) {
    hasilZ = geserHariDiZona(hasilZ, 1, zona);
  }
  return hasilZ;
}

// ============================================================================
// DETEKSI NIAT (deterministik, tanpa AI, cepat, tanpa biaya token)
// ============================================================================

/**
 * Deteksi niat pencatatan dari bahasa alami.
 * Mengembalikan null bila pesan bukan niat mencatat (obrolan biasa).
 *
 * Sengaja KONSERVATIF: lebih baik melewatkan catatan (user bisa pakai /)
 * daripada salah mencatat obrolan biasa.
 */
/**
 * KATA PERINTAH UNIVERSAL, pesan WAJIB dimulai dengan salah satu kata ini
 * (setelah kata pengantar opsional). Prinsipnya: HANYA kalimat PERINTAH yang
 * boleh dicatat, bukan pertanyaan, bukan cerita, bukan obrolan.
 */
// ── DIPERLUAS (temuan 07 Okt 2026) ──
// BUG: "gajian 5 juta" DITOLAK karena "gajian" tidak ada (hanya "gaji").
// Daftar ini HARUS sinkron dengan KATA_PERINTAH_UTAMA di deteksiNiat().
const KATA_PERINTAH =
  'catat|catet|note|notes|simpan|tulis|tambah|tambahin|nambah|masukkan|input|' +
  'ingatkan|ingetin|ingat|remind|reminder|pengingat|todo|to-do|tugas|task|' +
  'uang|duit|keluar|masuk|masukan|pengeluaran|pemasukan|jurnal|diary|' +
  'belanja|belanjaan|barang|stok|inventaris|daftar-belanja|shopping|' +
  'hapus|buang|hilangkan|delete|remove|selesai|selesaikan|done|beres|tuntas|tandai|' +
  'set|setel|bikin|buat|buatkan|bikinin|jadwal|jadwalkan|jadwalin|rutin|rutinin|' +
  'atur|aturin|pasang|pasangkan|siapkan|' +
  'beli|bayar|bayarin|jajan|ongkos|biaya|tarif|habis|abis|' +
  'dapat|dapet|terima|gaji|gajian|gajinya|gajiannya|bonus|bonusan|thr|honor|fee|' +
  'pendapatan|transferan|topup|top-up|' +
  'harus|perlu|kudu|mesti|wajib|bangunkan|bangunin';

/** Kata pengantar yang BOLEH mendahului perintah (bukan penanda obrolan). */
const PENGANTAR_BOLEH = /^\s*(tolong|coba|bisa|boleh|please|pls|mau|aku\s+mau|saya\s+mau|aku\s+pengen|saya\s+pengen|aku\s+ingin|saya\s+ingin|aku\s+pingin|saya\s+pingin|gw\s+mau|gue\s+mau|aku\s+mo|saya\s+mo)\s+/i;

/**
 * PENANDA OBROLAN, bila ada salah satu, pesan DITOLAK (tidak dicatat).
 * Ini yang mencegah obrolan biasa tercampur ke fitur pencatatan.
 */
const PENANDA_OBROLAN: RegExp[] = [
  /\?/,                                                     // pertanyaan
  /\b(apa|apakah|apaan|berapa|brp|kenapa|mengapa|gimana|bagaimana|kok|ya\s*kan|bukan\s*ya|emang|memang)\b/,
  /\b(tadi|kemarin|barusan|baru\s+aja|td|tadi\s+kan)\b/,     // cerita masa lalu
  /\b(katanya|kata\s+dia|kata\s+orang)\b/,                  // kabar dari orang
  // ── DIPERBAIKI (temuan nyata 07 Okt 2026) ──
  // LAPORAN: "oke deh ingetin aku bayar listrik jam 9" -> TIDAK tersimpan.
  //
  // AKAR: partikel "deh"/"dong"/"sih"/"nih" dll ada di daftar penanda obrolan,
  // padahal partikel itu SERING dipakai dalam permintaan yang SAH
  // ("ingetin aku dong", "catat deh", "tambahin sih").
  //
  // SEKARANG: penanda obrolan hanya untuk kata yang BENAR-BENAR menandakan
  // obrolan (bukan perintah): tawa, "yaudah", seruan. Partikel permintaan
  // (deh/dong/sih/nih/lah/tuh) DIBUANG dari daftar ini.
  /\b(banget|bgt|loh|yah|yaudah|yaudahlah|wkwk|haha|hehe|xixi|hihi|kwkwk)\b/,
  /\b(aku\s+sudah|saya\s+sudah|udah\s+aku|sudah\s+aku)\b/,   // menyatakan sudah terjadi
  /\b(mungkin|kayaknya|sepertinya|sepertinya|rasanya|kayak\s+nya)\b/, // dugaan
  // ── DITAMBAHKAN (temuan 07 Okt 2026) ──
  // LAPORAN PEMILIK PRODUK: "awas ketika dalam percakapan biasa dan user sedang
  // curhat bahwa dia sudah gajian dan mendapat gaji 5 juta malah dicatat ke
  // pemasukan".
  //
  // Kata PERASAAN/KONDISI menandakan CURHAT, bukan permintaan catat.
  // Contoh: "duit aku tinggal 100rb nih sedih" -> JANGAN dicatat.
  /\b(?:sedih|seneng|senang|bahagia|alhamdulillah|syukur|bersyukur|akhirnya|nasib|kasian|prihatin|bete|kesel|kesal|stress|stres|bingung|galau|bangkrut|bokek|kere|miskin|menyesal|nyesel)\b/i,
  // Kata "duit/uang/saldo/tinggal/sisa" + nominal = laporan SALDO (curhat),
  // bukan transaksi baru.
  /\b(?:duit|uang|saldo|sisa|tinggal|tersisa)\b[^.!?\n]{0,15}\d/i,
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
 * DETEKSI NIAT PENCATATAN, KETAT & UNIVERSAL (diperketat 04 Okt 2026).
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
/**
 * Pecah pesan keuangan menjadi BEBERAPA item (perbaikan 06 Okt 2026).
 *
 * KENAPA: user sering menulis beberapa pengeluaran sekaligus dalam satu pesan:
 *   "Pengeluaran:
 *    Bayar Nopal 60rb
 *    Bayar Faisa 50rb
 *    Beli rokok + susu + kue + esteh 75rb"
 * Sebelumnya hanya item PERTAMA (Rp60.000) yang dicatat, sisanya hilang.
 *
 * CARA: pecah per baris baru, lalu per pemisah ";" / " lalu " / " terus ".
 * Hanya segmen yang memuat NOMINAL yang dianggap item.
 */
export function pecahItemKeuangan(teks: string): Array<{ teks: string; nominal: number }> {
  // Buang baris pembuka yang hanya berisi kata jenis ("Pengeluaran:", "Pemasukan:")
  const segmenAwal = teks
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean)
    // Pisahkan juga bila ada beberapa item dalam satu baris ("a 5rb; b 3rb").
    .flatMap((baris) => baris.split(/\s*(?:;|\blalu\b|\bterus\b|\bdan\b(?=\s*[A-Za-z]))\s*/i))
    .map((x) => x.trim())
    .filter(Boolean);

  const hasil: Array<{ teks: string; nominal: number }> = [];
  for (const seg of segmenAwal) {
    // Baris pembuka tanpa nominal (mis. "Pengeluaran:") -> dilewati.
    const n = parseNominal(seg);
    if (n && n > 0) {
      hasil.push({ teks: seg, nominal: n });
    }
  }
  return hasil;
}

/**
 * Bila user HANYA menyebut JENIS pencatatan tanpa isi nyata, kembalikan teks
 * PETUNJUK cara mencatat (bukan menyimpan catatan bernama jenis itu).
 *
 * KENAPA (perbaikan 06 Okt 2026, temuan evaluasi chat nyata):
 *   User mengetik "Catat keuangan" -> bot menyimpan catatan bernama "keuangan"
 *   (tidak berguna). Seharusnya bot MEMBERI PETUNJUK cara mencatat yang benar.
 *
 * Contoh yang MEMICU petunjuk:  "catat keuangan", "catat uang", "tambah tugas",
 *   "catat pengeluaran", "simpan catatan", "catat barang".
 * Contoh yang TIDAK memicu (isi nyata): "catat pengeluaran 50rb buat makan",
 *   "tambah tugas upload jurnal", "catat aku suka kopi".
 */
export function panduanJenisSaja(teks: string): string | null {
  const t = teks.toLowerCase().trim();

  // Harus berupa perintah pencatatan.
  if (!/^\s*\/?(?:catat|catet|simpan|note|notes|tulis|jurnal|diary|tambah|tambahin|masukkan|input|ingatkan|ingetin|remind|todo|tugas|task|uang|keluar|masuk|pengeluaran|pemasukan|belanja|barang|stok|buat|buatkan|bikin|set|setel|pasang|atur)\b/i.test(t)) {
    return null;
  }

  // Bila ada ANGKA/NOMINAL -> itu isi nyata, jangan beri petunjuk.
  if (/\d/.test(t)) return null;
  if (/\b(?:satu|dua|tiga|empat|lima|enam|tujuh|delapan|sembilan|sepuluh|sebelas|seratus|seribu|juta|ribu|rb|jt)\b/.test(t)) return null;

  // Buang kata perintah & kata jenis; sisanya harus KOSONG (atau sangat pendek).
  const sisa = t
    .replace(/^\s*\/?(?:catat|catet|simpan|note|notes|tulis|jurnal|diary)\b\s*/i, '')
    .replace(/\b(?:tambah|tambahin|masukkan|input|buat|buatkan|bikin|set|setel|pasang|atur)\s+(?:tugas|todo|task|pengingat|reminder|jadwal|catatan)?\s*/gi, '')
    .replace(/\b(?:ingatkan|ingetin|remind|pengingat)\b\s*/gi, '')
    .replace(/\b(?:keuangan|uang|duit|finansial|finance)\b\s*/gi, '')
    .replace(/\b(?:catatan|note|notes)\b\s*/gi, '')
    .replace(/\b(?:tugas|todo|task|to-do)\b\s*/gi, '')
    .replace(/\b(?:pengeluaran|pemasukan|keluar|masuk|belanja|belanjaan|barang|stok|inventaris)\b\s*/gi, '')
    .replace(/\b(?:pengingat|reminder|jadwal|rutin)\b\s*/gi, '')
    .replace(/\b(?:dong|ya|nih|tolong|saya|aku|mau|pengen|ingin)\b\s*/gi, '')
    .replace(/[\s.,!?]+/g, ' ')
    .trim();

  // Masih ada isi bermakna -> bukan sekadar jenis.
  if (sisa.length >= 3) return null;

  // Tentukan panduan sesuai jenis yang disebut.
  const bagian: string[] = [];
  if (/\b(?:keuangan|uang|duit|finansial|finance|pengeluaran|pemasukan|keluar|masuk|belanja|bayar|beli)\b/.test(t)) {
    bagian.push(
      '*Catat keuangan*\n' +
      '• /uang 50000 makan siang  (pengeluaran)\n' +
      '• /masuk 500000 gaji  (pemasukan)\n' +
      '• atau ketik langsung: "bayar makan 25rb"',
    );
  }
  if (/\b(?:tugas|todo|task|to-do)\b/.test(t)) {
    bagian.push(
      '*Catat tugas*\n' +
      '• /tugas upload jurnal\n' +
      '• atau ketik langsung: "tambah tugas beli susu"',
    );
  }
  if (/\b(?:pengingat|reminder|ingatkan|ingetin|remind|jadwal|rutin)\b/.test(t)) {
    bagian.push(
      '*Buat pengingat*\n' +
      '• "ingatkan besok jam 9 rapat"\n' +
      '• "ingatkan tiap hari jam 6 pagi bangun"  (berulang)',
    );
  }
  if (/\b(?:catatan|note|notes|jurnal|diary)\b/.test(t) || bagian.length === 0) {
    bagian.push(
      '*Catat catatan*\n' +
      '• /catat ide konten minggu depan\n' +
      '• atau ketik langsung: "catat nomor polisi mobilku B 1234 XYZ"',
    );
  }

  return (
    'Hmm, aku belum tahu mau dicatat apa. Coba tulis isinya ya, contohnya:\n\n' +
    bagian.join('\n\n') +
    '\n\nBisa juga pakai */ringkasan* untuk lihat semua yang sudah tercatat.'
  );
}

/**
 * PANDUAN LENGKAP semua fitur bot (perbaikan 06 Okt 2026).
 *
 * KENAPA (permintaan pemilik produk): "jika ada user minta tutorial fitur atau
 * cara pemakaian, atau bertanya bisa apa saja, berikan full apa yang bisa
 * dilakukan bot, apa saja fitur yang bisa digunakan beserta cara pemakaiannya".
 *
 * Dipanggil saat user bertanya: "bisa apa saja", "tutorial", "cara pakai",
 * "fitur apa", "help", "panduan", dsb.
 */
export function deteksiMintaPanduan(teks: string): boolean {
  const t = teks.toLowerCase().trim();
  return (
    /\b(?:bisa|dapat|mampu)\s+(?:apa|ngapain|ngapain\s+aja|apa\s+aja|apa\s+saja)\b/.test(t) ||
    /\b(?:fitur|kemampuan|kelebihan|fungsi)\s*(?:apa|apa\s+aja|apa\s+saja|nya)?\s*(?:aja|saja|apa)?\s*\??$/.test(t) ||
    /\b(?:tutorial|cara\s+(?:pakai|pemakaian|gunakan|menggunakan|pake)|panduan|guide|help|bantuan|menu|perintah|command)\b/.test(t) ||
    /\b(?:apa\s+(?:aja|saja)\s+yang\s+bisa|bisa\s+ngelakuin\s+apa|kamu\s+bisa\s+apa|bot\s+ini\s+bisa)\b/.test(t) ||
    /^\s*\/(?:help|bantuan|panduan|menu|fitur|tutorial)\s*$/.test(t)
  );
}

/** Teks panduan lengkap semua fitur. */
export function teksPanduanLengkap(): string {
  return (
    '*Panduan FreeAIBot*\n' +
    '_Semua fitur bisa dipakai dengan BAHASA ALAMI (ngobrol biasa) atau perintah / ._\n' +
    '\n' +
    '⏰ *PENGINGAT*\n' +
    '• "ingatkan besok jam 9 rapat"\n' +
    '• "ingatkan 15 menit lagi minum obat"\n' +
    '• Berulang: "ingatkan tiap hari jam 6 pagi bangun"\n' +
    '  (juga: tiap Senin, tiap tanggal 1, tiap hari kerja)\n' +
    '• Ubah: "undur rapat jadi jam 10"\n' +
    '• Batal: "hapus pengingat rapat"\n' +
    '• Perintah: /remind 30 minum obat\n' +
    '\n' +
    '💰 *KEUANGAN*\n' +
    '• "bayar makan 25rb" / "gajian 5 juta"\n' +
    '• Beberapa sekaligus (tiap baris dipisah Enter):\n' +
    '  "Pengeluaran:\n  Bayar Nopal 60rb\n  Beli rokok 75rb"\n' +
    '• Lihat daftar: /uang\n' +
    '• Hapus: /hapus-uang 2\n' +
    '• Rekap: "berapa pengeluaran saya" atau /rekap 7\n' +
    '• Perintah: /uang 25000 makan, /masuk 500000 gaji\n' +
    '\n' +
    '📝 *TUGAS*\n' +
    '• "tambah tugas upload jurnal"\n' +
    '• Selesai: "upload jurnal selesai"\n' +
    '• Lihat: /tugas atau "tugas saya apa saja"\n' +
    '• Hapus: /hapus 1\n' +
    '• Perintah: /tugas beli susu\n' +
    '\n' +
    '📒 *CATATAN*\n' +
    '• "catat nomor polisi B 1234 XYZ"\n' +
    '• Lihat: /catatan\n' +
    '• Perintah: /catat resep nasi goreng\n' +
    '\n' +
    '📊 *RINGKASAN*\n' +
    '• "ringkasan" atau /ringkasan — lihat semua sekaligus\n' +
    '\n' +
    '🎮 *GAME DI CHAT*\n' +
    '• "main uno", "main catur", "tebak kata", "tebak angka"\n' +
    '• Tersedia: UNO, Capsa, Remi, Cangkulan, Gaple, Qiu-Qiu, Catur, Halma,\n' +
    '  Tic-Tac-Toe, Tebak Kata, Tebak Angka, Dadu, Batu-Gunting-Kertas,\n' +
    '  Suit Jawa, Monopoli (dadu), Kuis Pengetahuan\n' +
    '• Berhenti: "berhenti"\n' +
    '\n' +
    '🔍 *RISET & MEDIA*\n' +
    '• Tanya apa saja — bot cari data real-time dari internet\n' +
    '• Kirim FOTO, VOICE NOTE, atau DOKUMEN (PDF/Word/Excel) untuk dibaca\n' +
    '• Kirim gambar berisi tabel/struk — bot bisa ekstrak datanya\n' +
    '\n' +
    '⚙️ *LAIN-LAIN*\n' +
    '• Zona waktu otomatis menyesuaikan lokasi kamu\n' +
    '• /reset — hapus riwayat & preferensi obrolan\n' +
    '• /salah <koreksi> — perbaiki preferensi personal\n' +
    '\n' +
    '_Tinggal ngobrol biasa aja, nggak harus hafal perintah._'
  );
}

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
  // ulang, membuat regex SELALU GAGAL. Kini dibangun dari string biasa.
  const tanpaPengantar = asli.replace(PENGANTAR_BOLEH, '').trim();
  const KATA_PERINTAH_AKHIR = '(?:tolong\\s+)?(' + KATA_PERINTAH + ')';
  const polaAwal = new RegExp('^\\s*\\/?' + '(' + KATA_PERINTAH + ')\\b', 'i');
  // Kata perintah di akhir kalimat (boleh didahului koma / spasi / kata "tolong").
  const polaAkhir = new RegExp('[,\\s]+' + KATA_PERINTAH_AKHIR + '\\s*[.!]*\\s*$', 'i');
  // ── DIPERBAIKI (temuan nyata 06 Okt 2026) ──
  // LAPORAN: "Iyah Ingetin aku minum air putih coba di jam 21.25" TIDAK terdeteksi
  // karena gerbang ini WAJIB kata perintah di AWAL kalimat. Kata pengantar
  // ("Iyah"/"Oke"/"Halo") membuatnya gagal -> jatuh ke jalur implisit yang
  // pembersihannya lemah -> pengingat tersimpan ngaco ("Iyah aku minum air putih
  // coba di").
  //
  // SEKARANG: kata perintah boleh didahului kata pengantar singkat.
  // ── DIPERBAIKI (07 Okt 2026): pengantar boleh DUA kata (oh iya, eh iya, oke deh).
  // Temuan: "oh iya ingetin aku setiap hari buat minum vitamin ya" ditolak di sini.
  // ── DIPERLUAS (temuan 07 Okt 2026) ──
// BUG: "gajian 5 juta" DITOLAK karena "gajian" tidak ada di daftar (hanya "gaji").
// Ditambahkan: gajian, bonus, thr, pemasukan, dan kata transaksi lain.
const KATA_PERINTAH_UTAMA =
  'catat|catet|note|notes|simpan|tulis|tambah|tambahin|nambah|masukkan|input|' +
  'ingatkan|ingetin|ingat|remind|reminder|pengingat|todo|to-do|tugas|task|' +
  'uang|duit|keluar|masuk|masukan|pengeluaran|pemasukan|jurnal|diary|' +
  'belanja|belanjaan|barang|stok|inventaris|daftar-belanja|shopping|' +
  'hapus|buang|hilangkan|delete|remove|selesai|selesaikan|done|beres|tuntas|tandai|' +
  'set|setel|bikin|buat|buatkan|bikinin|jadwal|jadwalkan|jadwalin|rutin|rutinin|' +
  'atur|aturin|pasang|pasangkan|siapkan|' +
  'beli|bayar|bayarin|jajan|ongkos|biaya|tarif|habis|abis|' +
  'dapat|dapet|terima|gaji|gajian|gajinya|gajiannya|bonus|bonusan|thr|honor|fee|' +
  'pendapatan|transferan|topup|top-up|' +
  'harus|perlu|kudu|mesti|wajib|bangunkan|bangunin';
  // Pengantar boleh termasuk penanda PENGULANGAN ("tiap hari", "setiap hari").
  const PENGANTAR_UMUM =
    'oh|eh|oke|ok|iya(?:h)?|ya|halo|hai|hei|wah|yuk|sip|siap|baik|baiklah|' +
    'deh|dong|nih|tuh|jadi|nah|terus|trus|soalnya|' +
    '(?:tiap|setiap|saban)\\s+(?:hari|minggu|bulan|tahun|senin|selasa|rabu|kamis|jumat|jum\\\'at|sabtu)';
  const polaAwalDenganPengantar = new RegExp(
    `^\\s*\\/?(?:(?:${PENGANTAR_UMUM})\\s+){1,2}\\/?(?:${KATA_PERINTAH_UTAMA})\\b`,
    'i',
  );
  const adaKataPerintah =
    polaAwal.test(tanpaPengantar) ||
    polaAkhir.test(tanpaPengantar) ||
    polaAwalDenganPengantar.test(tanpaPengantar);
  if (!adaKataPerintah) return null;

  // ── L4. Ambil isi & klasifikasikan ──
  const nominal = parseNominal(s);

  // 4a3. PENGINGAT BERULANG didahulukan.
  // Temuan uji 05 Okt 2026: "ingatkan tiap tanggal 1 bayar listrik" salah
  // ditangkap sebagai KEUANGAN (Rp1) karena ada kata "bayar" + angka 1, padahal
  // itu pengingat berulang. Bila ada kata perintah INGAT + penanda pengulangan,
  // blok pengingat di bawah yang menangani.
  // DIPERLUAS (06 Okt 2026): permintaan pemilik produk —
  // "buatkan jadwal rutin tiap jam 6 pagi harus bangun" tidak dikenali.
  // Kata "jadwal/rutin/bangunkan/atur/pasang" juga menandakan permintaan pengingat.
  const adaPerintahIngat = /\b(?:ingatkan|ingetin|ingat|remind|reminder|pengingat|jadwal|jadwalkan|jadwalin|rutin|rutinin|bangunkan|bangunin|atur|aturin|pasang|pasangkan|setel)\b/i.test(asli);
  // DIPERLUAS: "tiap jam 6" (tanpa kata hari) juga pengulangan HARIAN.
  const adaPengulangan = /\b(?:tiap|setiap|saban)\s+(?:hari|minggu|bulan|tahun|senin|selasa|rabu|kamis|jumat|jum'at|sabtu|tanggal|hari\s+kerja|jam|pukul)\b|\b(?:harian|mingguan|bulanan|tahunan|rutin)\b/i.test(asli);
  if (adaPerintahIngat && adaPengulangan) {
    const kapanUlang = parseWaktuAlami(asli);
    if (kapanUlang) {
      const ulang0 = deteksiPengulangan(asli);
      // BUG YANG DIPERBAIKI (06 Okt 2026): blok ini punya pembersih SENDIRI yang
      // TIDAK membuang kata waktu seperti "pagi/siang/sore/malam", sehingga:
      //   "ingatkan tiap hari jam 6 pagi bangun" -> pesan "pagi bangun" ❌
      // (padahal blok 4b menghasilkan "bangun" yang benar).
      // Sekarang pembersihnya DISAMAKAN dengan blok 4b: buang kata ganti,
      // kata waktu (pagi/siang/sore/malam/subuh), dan hari.
      // ── LOOP PEMBERSIH (temuan 07 Okt 2026) ──
      // "oh iya ingetin aku setiap hari ..." -> pembersih lama hanya jalan sekali
      // sehingga "ingetin aku" tersisa di isi pengingat.
      // Sekarang: buang pengantar & kata perintah BERGANTIAN sampai bersih.
      const buangPengantarPerintah = (x: string): string => {
        let prev = '';
        let out = x;
        let putaran = 0;
        while (out !== prev && putaran < 6) {
          prev = out;
          out = out
            .replace(/^\s*(?:\/?(?:oh|eh|oke|ok|iya(?:h)?|ya|halo|hai|hei|wah|yuk|sip|siap|baik|baiklah|deh|dong|nih|tuh|jadi|nah|terus|trus|tolong|please|pls|mohon|bantu|bantuin|coba)\b[\s,]*)+/i, '')
            .replace(/^\s*(?:\/?(?:ingatkan|ingetin|ingat|remind|reminder|pengingat|buatkan|buat|bikin|bikinin|jadwalkan|jadwalin|jadwal|rutinin|rutin|atur|aturin|pasang|pasangkan|setel|set)\b\s*)+/i, '')
            .replace(/^\s*(?:saya|aku|gue|gw|kami|kita)\s+/i, '');
          putaran++;
        }
        return out;
      };
      let pesan0 = buangPengantarPerintah(asli)
        // Frasa gaul pengisi ("coba", "dong", "nih") yang menggantung di TENGAH.
        // DIPERBAIKI (06 Okt 2026): "coba di" HARUS dibuang SETELAH kata waktu,
        // karena "coba di jam 21.25" -> waktu dibuang dulu -> sisa "coba di".
        .replace(/\s*\b(?:coba|dong|nih|deh|sih|lah|tuh)\b\s*/gi, ' ')
        // URUTAN PENTING (temuan uji 06 Okt 2026): buang "jam 6" DULU, baru "tiap".
        // Bila terbalik, "tiap jam" terhapus lebih dulu -> angka "6" tertinggal
        // (hasil kotor: "6 bangun").
        .replace(/\b(jam|pukul)\s*\d{1,2}([:.]\d{2})?/gi, '')
        // ── JAM KEDUA + KATA SAMBUNG MENGGANTUNG (temuan 07 Okt 2026) ──
        // "ingetin aku setiap hari minum vitamin jam 7.30 pagi dan 12.30 siang"
        // -> pesan jadi "minum vitamin dan 12.30" (kotor) TANPA pembersih ini.
        .replace(/\s*\b(?:dan|atau|serta|,)\s*\d{1,2}([:.]\d{2})?\s*(?:pagi|siang|sore|malam|subuh)?/gi, ' ')
        .replace(/\s*\b\d{1,2}([:.]\d{2})\s*(?:pagi|siang|sore|malam|subuh)?\b/gi, ' ')
        .replace(/\s*\b(?:dan|atau|serta|juga)\s*[.!?]*\s*$/gi, ' ')
        .replace(/\b(?:tiap|setiap|saban)\s+(?:hari\s+kerja|hari|minggu|bulan|tahun|jam|pukul)\b/gi, '')
        .replace(/\b(?:tiap|setiap|saban)\s+(?:minggu|senin|selasa|rabu|kamis|jumat|jum'at|sabtu)\b/gi, '')
        .replace(/\b(?:tiap|setiap|saban)\s+tanggal\s+\d{1,2}\b/gi, '')
        .replace(/\b(?:harian|mingguan|bulanan|tahunan|weekday|rutin|rutinin)\b/gi, '')
        // Kata waktu yang menggantung (temuan: "jam 6 PAGI bangun").
        .replace(/\b(besok|lusa|hari ini|nanti|pagi|siang|sore|malam|subuh)\b/gi, '')
        .replace(/\b(senin|selasa|rabu|kamis|jumat|sabtu|minggu)\b/gi, '')
        // "tiap/setiap/saban" yang menggantung.
        .replace(/\b(?:tiap|setiap|saban)\b/gi, '')
        // Kata perintah/sisa yang menggantung di TENGAH (mis. "pengingat rapat").
        .replace(/\b(?:pengingat|reminder|jadwal|rutin|set|pasang|atur|buatkan|bikin)\b/gi, '')
        // Kata sambung yang menggantung (temuan 06 Okt 2026: "untuk bangun").
        .replace(/\b(?:untuk|buat|agar|supaya|biar|demi|sambil|sembari)\b/gi, '')
        // Sisa angka tunggal yang menggantung (mis. dari "tiap jam 6").
        .replace(/^\s*\d{1,2}\s+/, '')
        .replace(/\s{2,}/g, ' ')
        // Kata perintah/sifat yang menggantung di TENGAH.
        .replace(/\b(?:jadwal|jadwalkan|rutin|harus|wajib|perlu|mesti|kudu|bangunkan|bangunin)\b/gi, ' ')
        // Kata sambung yang menggantung (temuan 06 Okt 2026: "untuk bangun").
        .replace(/\b(?:untuk|buat|agar|supaya|biar|demi|sambil|sembari)\b/gi, ' ')
        // ── FRASA PENGISI DARI JAWABAN LANJUTAN (temuan 07 Okt 2026) ──
        // User menjawab pertanyaan jam: "setelah sarapan ya jam 7.30 atau jam 12.30
        // oke sih" -> isi pengingat jadi "ingetin aku minum vitamin ya setelah
        // sarapan ya atau oke" (kotor). Buang frasa waktu-makan & pengisi.
        .replace(/\b(?:setelah|sesudah|sebelum|habis|abis|usai)\s+(?:sarapan|makan|bangun|tidur|mandi|sholat|salat)\b/gi, ' ')
        .replace(/\b(?:oke|ok|sih|ya|deh|dong|nih|gitu|begitu|aja|saja|boleh|bisa)\b/gi, ' ')
        .replace(/\b(?:atau|dan|serta)\b/gi, ' ')
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
        // Sebutkan pengulangan SECARA JELAS (temuan 06 Okt 2026): sebelumnya label
        // ulang hanya disimpan di DB, tapi balasan tidak menyebutnya sehingga user
        // tidak tahu pengingatnya berulang.
        ringkas: ulang0
          ? `Pengingat "${pesan0}" ${ulang0.label} mulai ${formatWaktuUser(kapanUlang)}`
          : `Pengingat "${pesan0}" pada ${formatWaktuUser(kapanUlang)}`,
      };
    }
  }

  // ── GERBANG: KATA PERINTAH PENGINGAT MENANG ATAS KEUANGAN (perbaikan 06 Okt 2026) ──
  // LAPORAN NYATA: "oke ingatkan aku bayar listrik jam 9" -> dicatat sebagai
  // PENGELUARAN Rp9 (karena "bayar" memicu blok keuangan lebih dulu, dan "9"
  // dibaca sebagai nominal).
  //
  // AKAR: blok 4a KEUANGAN berjalan SEBELUM 4b PENGINGAT. Kata "bayar"/"beli"
  // di dalam kalimat pengingat membuatnya salah masuk keuangan.
  //
  // SEKARANG: bila ada kata perintah PENGINGAT yang jelas (ingatkan/ingetin/remind
  // + kata ganti/memori), LEWATI blok keuangan & barang -> langsung ke pengingat.
  const adaPerintahIngatKuat =
    /\b(?:ingatkan|ingetin|ingat|remind|reminder|pengingat)\b/i.test(tanpaPengantar) &&
    !/\b(?:uang|duit|saldo|pengeluaran|pemasukan|catat\s+uang|nominal)\b/i.test(tanpaPengantar);

  // 4a. KEUANGAN, wajib ada nominal
  // ── DIPERLUAS (temuan 07 Okt 2026) ──
  // BUG: "gajian 5 juta" & "thr 1 juta" DITOLAK karena "gajian"/"thr" tidak ada
  // di daftar kata uang. Padahal parseNominal sudah benar membaca nominalnya.
  const adaKataUang =
    /\b(?:uang|duit|pengeluaran|pemasukan|masukan|belanja|bayar|bayarin|beli|habis|abis|keluar|masuk|gaji|gajian|gajinya|gajiannya|bonus|bonusan|thr|dapat|dapet|terima|menerima|honor|fee|pendapatan|jajan|ongkos|biaya|tarif|topup|top-up|transferan|komisi|cashback|refund|warisan|hadiah|untung|laba|profit|cair)\b/.test(s);
  const perintahUang = /^\s*\/?(uang|keluar|masuk|pengeluaran|pemasukan)\b/i.test(tanpaPengantar);
  if (!adaPerintahIngatKuat && nominal && (perintahUang || adaKataUang)) {
    // ── BUG YANG DIPERBAIKI (06 Okt 2026) ──
    // LAPORAN PEMILIK PRODUK: "catat uang saya ada 150 ribu" dianggap PENGELUARAN.
    //
    // SEBAB: deteksi default ke 'out' bila tidak ada kata masuk/gaji/dapat. Padahal
    // "uang SAYA ADA 150 ribu" itu MENYATAKAN SALDO/PEMASUKAN, bukan pengeluaran.
    //
    // PERBAIKAN: kenali kata yang menandakan PEMASUKAN/SALDO:
    //   - ada, punya, punya uang, saldo, sisa, simpanan, tabungan, pegang,
    //     bawa, tersedia, tersisa, dapat, terima, gaji, bonus, honor, fee,
    //     pendapatan, masukan, masuk
    // Kata yang menandakan PENGELUARAN tetap: beli, bayar, jajan, ongkos,
    // biaya, habis (untuk belanja), keluar, pengeluaran.
    //
    // Bila pesan memuat kata PEMASUKAN -> 'in'. Bila memuat kata PENGELUARAN
    // yang kuat -> 'out'. Bila ambigu (hanya "catat uang 150 ribu") -> tanya
    // dulu daripada menebak salah.
    // DIPERLUAS (06 Okt 2026): "gajian", "gajiannya", "bonusan", "thr", "warisan",
    // "cair", "komisi", "cashback", "refund" juga menandakan PEMASUKAN.
    // Temuan: "gajian 5 juta" tidak dikenali (hanya "gaji" yang ada).
    const kataMasuk = /\b(?:masuk|masukan|gaji|gajian|gajinya|gajiannya|bonus|bonusan|thr|dapat|dapet|terima|menerima|pemasukan|honor|fee|pendapatan|ada|punya|mempunyai|saldo|sisa|tersisa|tersedia|simpanan|tabungan|pegang|bawa|cair|komisi|cashback|refund|warisan|hadiah|untung|laba|profit)\b/.test(s);
    const kataKeluar = /\b(?:beli|bayar|bayarin|jajan|ongkos|biaya|habis|abis|keluar|pengeluaran|belanja|topup|top-up|isi\s+pulsa|kirim|transfer\s+ke)\b/.test(s);
    let kind: ExpenseKind;
    if (kataMasuk && !kataKeluar) kind = 'in';
    else if (kataKeluar && !kataMasuk) kind = 'out';
    else if (kataMasuk && kataKeluar) kind = 'out'; // keduanya -> anggap pengeluaran (lebih umum)
    else kind = 'out'; // ambigu tanpa penanda: default pengeluaran (perilaku lama)

    // ── MULTI-ITEM (perbaikan 06 Okt 2026) ──
    // LAPORAN PEMILIK PRODUK: "Pengeluaran: Bayar Nopal 60rb / Bayar Faisa 50rb /
    // Beli rokok + susu + kue + esteh 75rb" -> hanya Rp60.000 yang dicatat,
    // dua item lain HILANG. Padahal user menulis BEBERAPA baris sekaligus.
    //
    // SEKARANG: pesan dipecah per BARIS (atau per pemisah ";" / " lalu "), dan
    // setiap baris yang punya nominal disimpan sebagai catatan keuangan TERPISAH.
    const barisItems = pecahItemKeuangan(asli);
    if (barisItems.length > 1) {
      const total = barisItems.reduce((a, b) => a + b.nominal, 0);
      return {
        kind: 'expense',
        yakin: 0.93,
        data: {
          amount: barisItems[0].nominal,
          kind,
          category: tebakKategori(barisItems[0].teks),
          note: barisItems[0].teks,
          // Daftar lengkap untuk disimpan sebagai beberapa baris.
          items: barisItems.map((it) => ({
            amount: it.nominal,
            kind,
            category: tebakKategori(it.teks),
            note: it.teks,
          })),
        },
        ringkas:
          `${kind === 'in' ? 'Pemasukan' : 'Pengeluaran'} ${barisItems.length} item ` +
          `(total Rp${total.toLocaleString('id-ID')}): ` +
          barisItems.map((it) => `Rp${it.nominal.toLocaleString('id-ID')}`).join(' + '),
      };
    }

    return {
      kind: 'expense',
      yakin: 0.92,
      data: { amount: nominal, kind, category: tebakKategori(s), note: asli },
      ringkas: `${kind === 'in' ? 'Pemasukan' : 'Pengeluaran'} Rp${nominal.toLocaleString('id-ID')} (${tebakKategori(s)})`,
    };
  }

  // 4a2. BARANG / BELANJA, dipetakan ke CATATAN dengan tag 'belanja'.
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

  // 4b. PENGINGAT, kata ingatkan/ingetin/remind boleh di AWAL atau AKHIR
  // (mis. "1 menit lagi saya mau login, ingatkan", cara bicara alami).
  // ── DIPERBAIKI (temuan nyata 06 Okt 2026) ──
  // LAPORAN: "Iyah Ingetin aku minum air putih coba di jam 21.25"
  //   -> pengingat tersimpan sebagai "Iyah aku minum air putih coba di" (NGACO!)
  //
  // AKAR: pola lama WAJIB "ingatkan" di AWAL kalimat. Kata pembuka seperti
  // "Iyah"/"Iya"/"Oke"/"Halo" membuat pola tidak cocok -> jatuh ke jalur implisit
  // yang pembersihannya lemah (kata sisa ikut masuk).
  //
  // SEKARANG: kata perintah boleh didahului kata pengantar singkat
  // (iya/iyah/oke/ok/halo/hai/wah/eh/ya) dan boleh diikuti kata ganti.
  // ── DIPERBAIKI (temuan nyata 07 Okt 2026) ──
  // LAPORAN: "oh iya ingetin aku setiap hari buat minum vitamin ya" -> TIDAK
  // ditangani (pengingat TIDAK tersimpan, padahal user jelas minta).
  //
  // AKAR: pengantar "oh iya" (DUA kata) tidak cocok dengan pola satu kata.
  //
  // SEKARANG: pengantar boleh DUA kata berturut-turut (oh iya, eh iya, oke deh, dst).
  const PENGANTAR_INGAT = '(?:oh|eh|oke|ok|iya(?:h)?|ya|halo|hai|hei|wah|yuk|sip|siap|baik|baiklah|deh|dong|nih|tuh|jadi|nah|terus|trus|soalnya)';
  const perintahIngat =
    new RegExp(`^\\s*\\/?(?:${PENGANTAR_INGAT}\\s+){0,2}\\/?(ingatkan|ingetin|ingat|remind|ingatkanlah)\\b`, 'i').test(tanpaPengantar) ||
    /^\s*\/?(ingatkan|ingetin|ingat|remind)\b/i.test(tanpaPengantar) ||
    /[,\s]+(?:tolong\s+)?(ingatkan|ingetin|ingat|remind)\s*[.!]*\s*$/i.test(tanpaPengantar);
  if (perintahIngat) {
    // ── PENGINGAT BERULANG TANPA JAM (temuan 07 Okt 2026) ──
    // "ingetin aku setiap hari buat minum vitamin" (tanpa jam) harus tetap
    // tersimpan — pakai jam default 08:00, lalu konfirmasi menyebut pengulangan.
    const ulangAwal = deteksiPengulangan(s);
    const kapanMentah = parseWaktuAlami(s);
    // ── PENGINGAT TANPA JAM (temuan 07 Okt 2026) ──
    // "ingetin aku setiap hari buat minum vitamin" (tanpa jam) -> JANGAN pakai
    // jam default diam-diam. Simpan state "menunggu jam", lalu TANYA jamnya.
    // Bila user menjawab dengan jam, pengingat dibuat dari teks asli (lihat 0a).
    const kapan = kapanMentah ?? (ulangAwal ? (() => { const d = new Date(); d.setHours(8, 0, 0, 0); if (d <= new Date()) d.setDate(d.getDate() + 1); return d; })() : null);
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
        // ── URUTAN DIPERBAIKI (temuan 06 Okt 2026) ──
        // BUG: dulu membuang kata perintah LEBIH DULU, padahal bisa didahului
        // pengantar ("Iyah Ingetin aku ...") -> "Ingetin" tidak terbuang karena
        // tidak di awal kalimat, lalu tersisa di isi pengingat.
        // SEKARANG: buang pengantar dulu, baru kata perintah.
        // Pengantar (boleh 2 kata: "oh iya", "eh iya", "oke deh") + kata perintah.
        // DIPERBAIKI (07 Okt 2026): dulu hanya buang SATU pengantar, sehingga
        // "oh iya ingetin ..." menyisakan "oh iya ingetin aku" di isi pengingat.
        .replace(/^(?:\s*\/?(?:oh|eh|oke|ok|iya(?:h)?|ya|halo|hai|hei|wah|yuk|sip|siap|baik|baiklah|deh|dong|nih|tuh|jadi|nah|terus|trus|tolong|please|pls)\b[\s,]*)+/i, '')
        .replace(/^(?:\s*\/?(?:ingatkan|ingetin|ingat|remind|ingatkanlah)\b\s*)+/i, '')
        // BUG YANG DIPERBAIKI (06 Okt 2026, temuan uji): kata ganti yang
        // menggantung TIDAK dibuang, sehingga:
        //   "ingatkan saya 3 menit lagi makan" -> pesan "saya makan"
        //   "ingatkan saya 5 menit lagi minum obat" -> "saya minum obat"
        // Sekarang "saya/aku/tolong/dong/nih/ya" di AWAL pesan dibuang agar
        // isi pengingat bersih: "makan", "minum obat".
        .replace(/^\s*(?:tolong|please|pls|saya|aku|gue|gw|kami|kita|dong|nih|ya|deh|sih)\s+/i, '')
        // Kata PENGULANGAN dibuang dari pesan (aturan berulang sudah disimpan
        // di kolom terpisah). Temuan uji: "tiap hari minum obat" -> "minum obat".
        .replace(/\b(?:tiap|setiap|saban)\s+(?:hari\s+kerja|hari|minggu|bulan|tahun)\b/gi, '')
        .replace(/\b(?:tiap|setiap|saban)\s+(?:minggu|senin|selasa|rabu|kamis|jumat|jum'at|sabtu)\b/gi, '')
        .replace(/\b(?:tiap|setiap|saban)\s+tanggal\s+\d{1,2}\b/gi, '')
        .replace(/\b(?:harian|mingguan|bulanan|tahunan|weekday)\b/gi, '')
        .replace(/[,\s]+(?:tolong\s+)?(ingatkan|ingetin|remind)\s*[.!]*\s*$/i, '')
        .replace(/\b(besok|lusa|hari ini|nanti|pagi|siang|sore|malam|subuh)\b/gi, '')
        // Kata ganti & pengantar yang menggantung DI TENGAH setelah pembersihan
        // (temuan 06 Okt 2026: "jam 6 pagi bangun" -> "pagi bangun" karena
        // "pagi" tidak dibuang; sekarang dibuang di atas).
        // Rentang waktu ("dari jam 9 sampai jam 10") dibuang UTUH lebih dulu.
        .replace(/(?:dari\s+)?(?:jam|pukul)\s*\d{1,2}(?:[:.]\d{2})?\s*(?:sampai(?:\s+dengan)?|s\/d|sd|hingga|-|–|sampai\s+pukul|sampai\s+jam)\s*(?:jam|pukul)?\s*\d{1,2}(?:[:.]\d{2})?/gi, '')
        .replace(/\b(jam|pukul)\s*\d{1,2}([:.]\d{2})?/gi, '')
        // ── JAM KEDUA + KATA SAMBUNG MENGGANTUNG (temuan 07 Okt 2026) ──
        // "minum vitamin jam 7.30 dan 12.30" -> "minum vitamin dan 12.30" (kotor).
        // "minum vitamin jam 7.30 atau jam 12.30" -> "minum vitamin atau" (kotor).
        // URUTAN PENTING: buang "jam N" yang masih ada, lalu angka telanjang,
        // baru kata sambungnya. (Kalau "dan" dibuang dulu, angkanya tertinggal.)
        .replace(/\b(?:jam|pukul)\s*\d{1,2}([:.]\d{2})?/gi, ' ')
        .replace(/\s*\b(?:dan|atau|serta|,)\s*\d{1,2}([:.]\d{2})?\s*(?:pagi|siang|sore|malam|subuh)?/gi, ' ')
        .replace(/\s*\b\d{1,2}([:.]\d{2})\s*(?:pagi|siang|sore|malam|subuh)?\b/gi, ' ')
        .replace(/\s*\b(?:dan|atau|serta|juga)\s*[.!?]*\s*$/gi, ' ')
        .replace(/\s*\b(?:dan|atau|serta|juga)\s+(?=[.!?]|$)/gi, ' ')
        .replace(/\b(senin|selasa|rabu|kamis|jumat|sabtu|minggu)\b/gi, '')
        // "N menit lagi", N boleh digit ATAU angka kata
        .replace(new RegExp(`\\b(?:\\d+|${ANGKA_KATA})\\s*(menit|jam|hari|minggu|bulan)\\s*(lagi|kemudian|kedepan)?\\b`, 'gi'), '')
        // sisa "lagi" yang menggantung (mis. "buat login lagi")
        .replace(/\blagi\b/gi, '')
        // Sisa "coba di" / "di" menggantung SETELAH kata waktu dibuang
        // ("minum air putih coba di jam 21.25" -> waktu hilang -> "coba di").
        .replace(/\s*\b(?:coba|dong|nih|deh|sih|lah|tuh)\b\s*\bdi\b\s*$/gi, ' ')
        .replace(/\s+\bdi\b\s*$/i, ' ')
        .replace(/\s*\b(?:coba|dong|nih|deh|sih|lah|tuh)\b\s*$/gi, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();
      // Bila pesan kosong (mis. "ingatkan jam 8 malam" tanpa keterangan lain),
      // JANGAN pakai teks asli mentah (akan berisi kata waktu: "jam 8 malam").
      // Buang kata perintah + kata waktu; bila tetap kosong, pakai kata generik
      // yang jujur ("pengingat") daripada menampilkan frasa waktu yang aneh.
      if (pesan.length < 3) {
        const sisaBersih = asli
          .replace(/^\s*\/?(ingatkan|ingetin|ingat|remind|reminder|pengingat)\b\s*/i, '')
          .replace(/\b(besok|lusa|hari ini|nanti|pagi|siang|sore|malam|subuh)\b/gi, '')
          .replace(/\b(jam|pukul)\s*\d{1,2}([:.]\d{2})?/gi, '')
          .replace(/\b(senin|selasa|rabu|kamis|jumat|sabtu|minggu)\b/gi, '')
          .replace(/\b\d{1,2}\s*(menit|jam|hari|minggu|bulan)\b/gi, '')
          .replace(/\s{2,}/g, ' ')
          .trim();
        pesan = sisaBersih.length >= 3 ? sisaBersih : 'pengingat';
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
          // Tanda: user minta pengingat berulang TANPA menyebut jam -> bot perlu
          // menanyakan jam & menyimpan state (lihat tanganiPencatatan).
          perlu_jam: !kapanMentah && Boolean(ulang),
        },
        ringkas: `Pengingat "${pesan}" pada ${jamTeks}${ulang ? ` (${ulang.label})` : ''}`,
      };
    }
    return null; // perintah ingatkan tapi waktu tak jelas -> serahkan ke AI
  }

  // 4c. TUGAS, wajib ada kata tugas/todo/task
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

  // 4d. CATATAN, wajib kata catat/simpan/note/tulis/jurnal + isi cukup
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
// SIMPAN & AMBIL, CATATAN
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
// SIMPAN & AMBIL, TUGAS
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

/** Daftar catatan keuangan terakhir (untuk menampilkan ID yang bisa dihapus). */
export async function daftarUang(chatId: string, limit = 10): Promise<Array<{
  id: number; amount: number; kind: string; category: string; note: string; created_at: string;
}>> {
  const c = db();
  if (!c) return [];
  try {
    const { data, error } = await c.from('expenses')
      .select('id, amount, kind, category, note, created_at')
      .eq('chat_id', chatId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return data as Array<{ id: number; amount: number; kind: string; category: string; note: string; created_at: string }>;
  } catch {
    return [];
  }
}

/**
 * Format daftar keuangan + NOMOR URUT (agar bisa dihapus).
 * Nomor urut per-user, dihitung dari urutan dibuat (stabil).
 */
export function formatDaftarUang(rows: Array<{
  id: number; amount: number; kind: string; category: string; note: string; created_at: string;
}>): string {
  if (!rows.length) return 'Belum ada catatan keuangan.';
  const baris = rows.map((r, i) => {
    const tgl = new Date(r.created_at).toLocaleDateString('id-ID', { timeZone: zonaWaktuAktif(), day: '2-digit', month: 'short' });
    const tanda = r.kind === 'in' ? '💰 Masuk' : '💸 Keluar';
    const ket = r.note ? ` - ${r.note.slice(0, 30)}` : '';
    return `${i + 1}. ${tanda} Rp${Math.round(r.amount).toLocaleString('id-ID')} (${r.category}) ${tgl}${ket}`;
  });
  return `${baris.join('\n')}\n\nHapus dengan: */hapus <nomor>*`;
}

export async function daftarTugas(chatId: string, hanyaBelumSelesai = true): Promise<TugasRingkas[]> {
  const c = db();
  if (!c) return [];
  try {
    // Ambil SEMUA tugas user (semua status) agar nomor urut STABIL: tugas
    // pertama tetap #1 meski ada tugas lain yang sudah selesai/dihapus.
    // Tanpa ini, nomor berubah setiap ada tugas yang selesai (membingungkan).
    const { data: semua, error } = await c
      .from('todos')
      .select('id, task, priority, status, due_at, created_at')
      .eq('chat_id', chatId)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(200);
    if (error || !semua) return [];

    // Beri nomor urut per-user (1, 2, 3, ...).
    const bernomor = (semua as Array<TugasRingkas & { created_at?: string }>).map((t, i) => ({
      ...t,
      nomor: i + 1,
    }));

    const hasil = hanyaBelumSelesai ? bernomor.filter((t) => t.status === 'open') : bernomor;
    // Urutkan tampilan: prioritas lalu waktu dibuat.
    hasil.sort((a, b) => (a.priority - b.priority) || ((a.nomor ?? 0) - (b.nomor ?? 0)));
    return hasil.slice(0, 50);
  } catch {
    return [];
  }
}

/**
 * Cari ID asli dari NOMOR URUT per-user (dipakai /selesai & /hapus).
 * Nomor dihitung dari urutan `created_at` semua tugas user (stabil).
 */
/**
 * Cari NOMOR URUT per-user dari sebuah ID tugas (kebalikan idDariNomorTugas).
 * Dipakai untuk menampilkan "Tugas dicatat (#N)" dengan nomor yang konsisten.
 */
export async function nomorUrutTugas(chatId: string, id: number): Promise<number | null> {
  const c = db();
  if (!c) return null;
  try {
    const { data, error } = await c
      .from('todos')
      .select('id')
      .eq('chat_id', chatId)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(200);
    if (error || !data) return null;
    const idx = (data as Array<{ id: number }>).findIndex((t) => t.id === id);
    return idx >= 0 ? idx + 1 : null;
  } catch {
    return null;
  }
}

export async function idDariNomorTugas(chatId: string, nomor: number): Promise<number | null> {
  const c = db();
  if (!c) return null;
  try {
    const { data, error } = await c
      .from('todos')
      .select('id')
      .eq('chat_id', chatId)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(200);
    if (error || !data) return null;
    if (nomor < 1 || nomor > data.length) return null;
    return (data[nomor - 1] as { id: number }).id;
  } catch {
    return null;
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
// SIMPAN & AMBIL, KEUANGAN
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
// SIMPAN & AMBIL, KEBIASAAN
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
// FORMATTER (untuk balasan bot, teks rapi, tanpa AI)
// ============================================================================

export function formatDaftarCatatan(rows: CatatanRingkas[]): string {
  if (!rows.length) return 'Belum ada catatan.';
  return rows.map((r, i) => {
    const judul = r.title ? `*${r.title}*, ` : '';
    const isi = r.content.length > 120 ? `${r.content.slice(0, 120)}…` : r.content;
    return `${i + 1}. ${judul}${isi}`;
  }).join('\n');
}

export function formatDaftarTugas(rows: TugasRingkas[]): string {
  if (!rows.length) return 'Belum ada tugas. 🎉';
  const label = (p: number) => (p === 1 ? '🔴' : p === 3 ? '🟢' : '🟡');
  return rows.map((r) => {
    const due = r.due_at
      ? `, tenggat ${formatWaktuUser(new Date(r.due_at))}`
      : '';
    // Tampilkan NOMOR URUT per-user (bukan ID global yang bisa #13).
    return `${label(r.priority)} #${r.nomor ?? r.id} ${r.task}${due}`;
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
    return `${sudah} #${r.id} ${r.name}, streak ${r.streak} hari (terbaik ${r.best_streak})`;
  }).join('\n');
}

// ============================================================================
// ORKESTRATOR, dipakai lapisan pesan (WhatsApp/Telegram)
// ============================================================================

/**
 * Konfirmasi tertunda per chat: setelah bot menanyakan "simpan?", pesan
 * berikutnya ("iya"/"tidak") diproses di sini tanpa memanggil AI.
 * Disimpan di memori proses (cukup, konfirmasi hanya bertahan beberapa detik).
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
// (bila pemanggil lupa mengisi), bukan lagi asumsi utama.
let zonaAktif = 'Asia/Jakarta';
// Catatan konfirmasi zona (diisi saat zona masih tebakan dari nomor telepon).
let catatanKonfirmasiZona = '';
function zonaWaktuAktif(): string { return zonaAktif; }
function setZonaAktif(z: string | undefined | null): void {
  zonaAktif = z && z.trim() ? z : 'Asia/Jakarta';
}
const KONFIRMASI_TTL_MS = 10 * 60_000; // 10 menit

// ── PERMINTAAN TERTUNDA KARENA ZONA WAKTU (perbaikan 06 Okt 2026) ──
//
// BUG YANG DIPERBAIKI: "kenapa setelah nanya jam, remind nya tidak dicatat lagi?
// seharusnya kan langsung sekalian."
//
// SEBAB: saat user baru meminta pengingat tetapi zonanya belum diketahui, bot
// menanyakan zona lalu `return` LANGSUNG, permintaan pengingat user HILANG.
// Setelah user menjawab "cianjur", bot hanya menyimpan zona, pengingat TIDAK
// pernah dibuat. User harus mengulang perintahnya (menyebalkan).
//
// SEKARANG: permintaan disimpan sementara; begitu zona diketahui, permintaan
// itu DILANJUTKAN otomatis tanpa user mengulang.
interface PermintaanTertunda {
  teks: string;
  platform: string;
  actor?: string;
  at: number;
  /**
   * Jenis penantian:
   *   'zona' -> menunggu lokasi/zona waktu (perilaku lama)
   *   'jam'  -> menunggu JAM untuk sebuah pengingat (temuan 07 Okt 2026)
   *
   * LAPORAN: bot bertanya "kapan waktu yang pas?", user menjawab
   * "setelah sarapan ya jam 7.30 atau jam 12.30 oke sih" -> TIDAK diproses,
   * pengingat tidak pernah tersimpan.
   */
  jenis?: 'zona' | 'jam';
}
const permintaanTertunda = new Map<string, PermintaanTertunda>();
const PERMINTAAN_TERTUNDA_TTL_MS = 10 * 60_000; // 10 menit

/**
 * Simpan permintaan yang menunggu zona waktu.
 *
 * ── PENTING (perbaikan 06 Okt 2026) ──
 * DISIMPAN KE DATABASE, bukan hanya memori. Di Vercel (serverless) setiap
 * request bisa berjalan di INSTANCE BERBEDA, sehingga Map di memori HILANG
 * antar-request. Itu sebabnya pengingat user tidak dilanjutkan setelah dia
 * menjawab lokasi (temuan nyata di produksi).
 *
 * Memakai tabel `pending_confirmations` yang sudah ada, dengan penanda
 * `kind: '_tunggu_zona'` agar tidak bentrok dengan konfirmasi niat biasa.
 */
async function simpanPermintaanTertunda(
  chatId: string, teks: string, platform: string, actor?: string, jenis: 'zona' | 'jam' = 'zona',
): Promise<void> {
  const v: PermintaanTertunda = { teks, platform, actor, at: Date.now(), jenis };
  // Lapisan 1: memori (cepat, untuk instance yang sama).
  permintaanTertunda.set(chatId, v);
  // Lapisan 2: database (bertahan lintas instance serverless).
  try {
    const c = db();
    if (c) {
      await c.from('pending_confirmations').upsert({
        chat_id: chatId,
        platform,
        actor: actor ?? null,
        niat: { kind: '_tunggu_zona', teks, platform, actor: actor ?? null },
        expires_at: new Date(Date.now() + PERMINTAAN_TERTUNDA_TTL_MS).toISOString(),
      }, { onConflict: 'chat_id' });
    }
  } catch (e) {
    console.warn('[notes] Gagal simpan permintaan tertunda ke DB:', e);
  }
}

/** Ambil permintaan tertunda (memori dulu, lalu database). */
async function ambilPermintaanTertunda(chatId: string): Promise<PermintaanTertunda | null> {
  // Lapisan 1: memori.
  const v = permintaanTertunda.get(chatId);
  if (v && Date.now() - v.at <= PERMINTAAN_TERTUNDA_TTL_MS) return v;
  if (v) permintaanTertunda.delete(chatId);

  // Lapisan 2: database (instance berbeda / setelah cold start).
  try {
    const c = db();
    if (!c) return null;
    const { data } = await c
      .from('pending_confirmations')
      .select('niat, platform, actor, created_at, expires_at')
      .eq('chat_id', chatId)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();
    if (data && (data.niat as { kind?: string })?.kind === '_tunggu_zona') {
      const n = data.niat as { teks?: string };
      if (n?.teks) {
        const hasil: PermintaanTertunda = {
          teks: n.teks,
          platform: String(data.platform || 'whatsapp'),
          actor: (data.actor as string) ?? undefined,
          at: new Date(String(data.created_at)).getTime(),
        };
        permintaanTertunda.set(chatId, hasil); // isi cache memori
        return hasil;
      }
    }
  } catch (e) {
    console.warn('[notes] Gagal ambil permintaan tertunda dari DB:', e);
  }
  return null;
}

/** Buang permintaan tertunda (sudah dilanjutkan / dibatalkan). */
async function buangPermintaanTertunda(chatId: string): Promise<void> {
  permintaanTertunda.delete(chatId);
  try {
    const c = db();
    if (c) {
      await c.from('pending_confirmations').delete()
        .eq('chat_id', chatId)
        .eq('niat->>kind', '_tunggu_zona');
    }
  } catch {
    // abaikan
  }
}

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
    // MULTI-ITEM (perbaikan 06 Okt 2026): bila pesan memuat beberapa item
    // (mis. "Bayar Nopal 60rb / Bayar Faisa 50rb / Beli rokok 75rb"),
    // simpan SEMUANYA, bukan hanya yang pertama.
    const daftarItems = Array.isArray(d.items) && d.items.length > 1
      ? (d.items as Array<{ amount: number; kind: string; category: string; note: string }>)
      : null;

    if (daftarItems) {
      const ids: number[] = [];
      for (const it of daftarItems) {
        const id = await simpanUang(
          chatId,
          Number(it.amount) || 0,
          (it.kind as ExpenseKind) || 'out',
          String(it.category || 'lainnya'),
          String(it.note || ''),
          { actor: opts.actor, platform: opts.platform },
        );
        if (id) ids.push(id);
      }
      if (ids.length === 0) {
        return { ok: false, pesan: '⚠️ Gagal menyimpan ke database. Coba lagi nanti ya.' };
      }
      // Laporkan JUJUR: sebutkan berapa item tersimpan & totalnya.
      const total = daftarItems.reduce((a, b) => a + (Number(b.amount) || 0), 0);
      return {
        ok: true,
        pesan: `✅ Tercatat ${ids.length} item (total Rp${total.toLocaleString('id-ID')}): ` +
          daftarItems.map((it) => `Rp${Number(it.amount).toLocaleString('id-ID')}`).join(' + '),
      };
    }

    const id = await simpanUang(
      chatId,
      Number(d.amount) || 0,
      (d.kind as ExpenseKind) || 'out',
      String(d.category || 'lainnya'),
      String(d.note || ''),
      { actor: opts.actor, platform: opts.platform },
    );
    return id
      ? { ok: true, pesan: `✅ Tercatat (#${id}), ${niat.ringkas}` }
      : { ok: false, pesan: '⚠️ Gagal menyimpan ke database. Coba lagi nanti ya.' };
  }
  if (niat.kind === 'todo') {
    const id = await simpanTugas(chatId, String(d.task || ''), {
      priority: Number(d.priority) || 2,
      due_at: (d.due_at as string) ?? null,
      actor: opts.actor,
      platform: opts.platform,
    });
    if (!id) return { ok: false, pesan: '⚠️ Gagal menyimpan tugas. Coba lagi nanti ya.' };
    // Tampilkan NOMOR URUT per-user (bukan ID global yang bisa #13 untuk tugas
    // pertama). Lihat catatan di interface TugasRingkas.
    const nomorTugas = await nomorUrutTugas(chatId, id);
    return { ok: true, pesan: `✅ Tugas dicatat (#${nomorTugas ?? id}), ${niat.ringkas}` };
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
    // Sebutkan PENGULANGAN secara eksplisit (temuan 06 Okt 2026): sebelumnya
    // label ulang hanya tersimpan di DB, tapi balasan tidak menyebutnya sehingga
    // user tidak tahu pengingatnya berulang ("tiap hari").
    // Pakai labelUlang() yang sudah ada agar labelnya ramah & benar
    // ("tiap hari", "tiap Senin", "tiap tanggal 1", "tiap hari kerja").
    let teksUlang = '';
    if (d.repeat_kind && d.repeat_kind !== 'none') {
      try {
        const { labelUlang } = await import('./reminder-repeat.js');
        teksUlang = labelUlang({
          repeat_kind: String(d.repeat_kind) as 'daily' | 'weekday' | 'weekly' | 'monthly' | 'yearly',
          repeat_value: d.repeat_value ? String(d.repeat_value) : null,
          repeat_until: null,
          repeat_count: 0,
        });
      } catch {
        teksUlang = 'berulang';
      }
    }
    const labelUlang = teksUlang ? ` (${teksUlang})` : '';
    return {
      ok: true,
      pesan: labelUlang
        ? `✅ Pengingat disimpan, "${hasil.pesan}"${labelUlang} mulai ${jamTeks}${tambahan}${catatanKonfirmasiZona}`
        : `✅ Pengingat disimpan, "${hasil.pesan}" pada ${jamTeks}${tambahan}${catatanKonfirmasiZona}`,
    };
  }
  const id = await simpanCatatan(chatId, String(d.content || ''), {
    actor: opts.actor, platform: opts.platform,
    tags: Array.isArray(d.tags) ? (d.tags as string[]) : undefined,
  });
  return id
    ? { ok: true, pesan: `✅ Catatan disimpan (#${id}), ${niat.ringkas}` }
    : { ok: false, pesan: '⚠️ Gagal menyimpan catatan. Coba lagi nanti ya.' };
}

/**
 * Tangani pesan yang mungkin berkaitan dengan pencatatan.
 * Mengembalikan { ditangani: true, reply } bila pesan sudah diurus di sini
 * (pemanggil TIDAK boleh meneruskannya ke AI), atau { ditangani: false }.
 */
/**
 * Ambil profil zona user: cache sinkron lebih dulu (0 ms), lalu DB bila kosong.
 * Dipakai di AWAL tanganiPencatatan agar parseWaktuAlami tahu zona user.
 */
async function ambilProfilCacheAtauDb(chatId: string): Promise<{ timezone: string } | null> {
  const dariCache = getCacheProfil(chatId);
  if (dariCache?.timezone) return dariCache;
  try {
    const dariDb = await ambilProfilWaktu(chatId);
    if (dariDb?.timezone) return dariDb;
  } catch {
    // abaikan
  }
  return null;
}

export async function tanganiPencatatan(
  teks: string,
  chatId: string,
  ctx: unknown,
  opts: { actor?: string; platform: string; lanjutkanTertunda?: boolean },
): Promise<{ ditangani: boolean; reply: string; jalur: string; teruskanKeAi?: string }> {
  const s = teks.trim();
  const asli = teks.trim();
  const low = s.toLowerCase();
  catatanKonfirmasiZona = '';

  // ── ZONA WAKTU DI-SET DI AWAL (perbaikan 06 Okt 2026) ──
  //
  // BUG BESAR: `setZonaAktif()` dulu dipanggil JAUH di bawah (blok A0a, baris
  // ~1543), sedangkan `parseWaktuAlami()` sudah dipakai LEBIH DULU (baris 581+).
  // Akibatnya perhitungan jam memakai zona default (WIB) ATAU zona server:
  //   "buatkan jadwal rutin tiap jam 6 pagi" -> tersimpan 13:00 (server UTC),
  //   bukan 06:00 WIB. Diuji lokal (WIB) kebetulan benar -> bug tak terlihat.
  //
  // SEKARANG zona diambil & dipasang di AWAL, sebelum parsing waktu apa pun.
  try {
    const profilAwal = await ambilProfilCacheAtauDb(chatId);
    if (profilAwal?.timezone) setZonaAktif(profilAwal.timezone);
  } catch {
    // fallback: zonaAktif tetap default (WIB)
  }

  // ── 0a. LANJUTAN PENGINGAT: jawaban berisi JAM saja (temuan 07 Okt 2026) ──
  // LAPORAN: bot bertanya "kapan waktu yang pas buat pengingatnya?" lalu user
  // menjawab "setelah sarapan ya jam 7.30 atau jam 12.30 oke sih" /
  // "jam 7.30 pagi dan 12.30 siang ok camkan itu".
  // Keduanya TIDAK diproses -> pengingat tidak pernah tersimpan.
  //
  // SEKARANG: bila ada permintaan pengingat yang MENUNGGU JAM, jawaban berisi
  // jam dilanjutkan sebagai pengingat dari teks asli sebelumnya.
  {
    const adaJam = /(?:jam|pukul)\s*\d{1,2}([:.]\d{2})?|\b\d{1,2}([:.]\d{2})\s*(?:pagi|siang|sore|malam)/i.test(asli);
    if (adaJam) {
      const tertundaJam = await ambilPermintaanTertunda(chatId);
      if (tertundaJam && tertundaJam.jenis === 'jam') {
        await buangPermintaanTertunda(chatId);
        // Gabungkan teks asli (permintaan) + jawaban jam -> deteksi ulang.
        // Pembersihan isi diserahkan ke blok pengingat (4a3/4b) supaya konsisten.
        const gabung = `${tertundaJam.teks} ${asli}`;
        const niatGabung = deteksiNiat(gabung);
        if (niatGabung && niatGabung.kind === 'note' && niatGabung.data.pengingat) {
          const r = await simpanDariNiat(chatId, niatGabung, { actor: opts.actor, platform: opts.platform });
          return { ditangani: true, reply: r.pesan, jalur: 'lanjut-pengingat-jam' };
        }
      }
    }
  }

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
    // LANGSUNG SIMPAN (perbaikan 06 Okt 2026 — konfirmasi ya/tidak dihilangkan).
    const rCatat = await simpanDariNiat(chatId,
      { kind: 'note', yakin: 1, data: { content: isi }, ringkas: `Catatan: "${isi.slice(0, 80)}"` },
      { actor: opts.actor, platform: opts.platform });
    return { ditangani: true, reply: rCatat.pesan, jalur: 'perintah-catat' };
  }

  // /todo <isi>  atau  /tugas <isi>
  m = low.match(/^\/(?:todo|tugas|task)\s+([\s\S]+)/);
  if (m) {
    const isi = s.replace(/^\/(?:todo|tugas|task)\s+/i, '').trim();
    const prio = /penting|urgent|segera/.test(low) ? 1 : 2;
    const due = parseWaktuAlami(low);
    // LANGSUNG SIMPAN (perbaikan 06 Okt 2026 — konfirmasi ya/tidak dihilangkan).
    const rTodo = await simpanDariNiat(chatId,
      { kind: 'todo', yakin: 1, data: { task: isi, priority: prio, due_at: due?.toISOString() ?? null }, ringkas: `Tugas: "${isi}"` },
      { actor: opts.actor, platform: opts.platform });
    return { ditangani: true, reply: rTodo.pesan, jalur: 'perintah-todo' };
  }

  // /uang  (tanpa isi) -> tampilkan daftar keuangan + nomor untuk dihapus.
  // DITAMBAHKAN (06 Okt 2026): sebelumnya tidak ada cara melihat ID keuangan,
  // sehingga user TIDAK BISA menghapus catatan keuangan yang salah.
  if (/^\/(?:uang|duit|keuangan|expenses?|keluar|masuk)\s*$/.test(low)) {
    const d = await daftarUang(chatId, 10);
    return {
      ditangani: true,
      reply: `*Catatan keuangan terakhir:*\n${formatDaftarUang(d)}`,
      jalur: 'perintah-uang-list',
    };
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
    // LANGSUNG SIMPAN (perbaikan 06 Okt 2026).
    const rUang = await simpanDariNiat(chatId, {
        kind: 'expense', yakin: 1,
        data: { amount: nominal, kind, category: kategori, note: isi },
        ringkas: `${kind === 'in' ? 'Pemasukan' : 'Pengeluaran'} Rp${nominal.toLocaleString('id-ID')} (${kategori})`,
      }, { actor: opts.actor, platform: opts.platform });
    return { ditangani: true, reply: rUang.pesan, jalur: 'perintah-uang' };
  }

  // /rekap [hari]
  m = low.match(/^\/rekap(?:\s+(\d+))?/);
  if (m) {
    const hari = m[1] ? Math.min(365, Math.max(1, Number(m[1]))) : 30;
    const r = await rekapUang(chatId, hari);
    return { ditangani: true, reply: formatRekapUang(r, hari), jalur: 'perintah-rekap' };
  }

  // /list, /daftar, /tugas, /todos, /tugas-saya
  //
  // BUG YANG DIPERBAIKI (06 Okt 2026): "tugas" TIDAK ada di daftar, padahal
  // pesan error kita sendiri menyuruh user mengetik */tugas*. Sekarang ditambah.
  if (/^\/(?:list|daftar|tugas|tugas-saya|todo|todos|tugasku)$/.test(low)) {
    const t = await daftarTugas(chatId, true);
    return { ditangani: true, reply: `*Tugas kamu:*\n${formatDaftarTugas(t)}`, jalur: 'perintah-list' };
  }

  // /catatan  (daftar catatan)
  if (/^\/(?:catatan|notes)$/.test(low)) {
    const c = await daftarCatatan(chatId, 10);
    return { ditangani: true, reply: `*Catatan terakhir:*\n${formatDaftarCatatan(c)}`, jalur: 'perintah-catatan' };
  }

  // /barang <isi>  atau  /belanja <isi> , daftar barang/belanja (pakai tabel notes
  // dengan tag khusus 'belanja', agar tidak perlu tabel baru).
  m = low.match(/^\/(?:barang|belanja|stok|shopping)\s+([\s\S]+)/);
  if (m) {
    const isi = s.replace(/^\/(?:barang|belanja|stok|shopping)\s+/i, '').trim();
    const r = await simpanDariNiat(chatId,
      { kind: 'note', yakin: 1, data: { content: isi, tags: ['belanja'] }, ringkas: `Barang: "${isi.slice(0, 80)}"` },
      { actor: opts.actor, platform: opts.platform });
    return { ditangani: true, reply: r.pesan, jalur: 'perintah-barang' };
  }

  // /barang  atau  /belanja  (tanpa isi), tampilkan daftar
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
    const nomor = Number(m[1]);
    // Nomor yang diketik user adalah NOMOR URUT per-user (lihat daftarTugas),
    // bukan ID global. Konversi dulu ke ID asli.
    const idAsli = await idDariNomorTugas(chatId, nomor);
    if (idAsli === null) {
      return { ditangani: true, reply: `Tugas #${nomor} tidak ditemukan. Ketik */tugas* untuk melihat daftar.`, jalur: 'perintah-selesai' };
    }
    const ok = await selesaikanTugas(chatId, idAsli);
    return { ditangani: true, reply: ok ? `✅ Tugas #${nomor} selesai!` : `Tugas #${nomor} tidak ditemukan.`, jalur: 'perintah-selesai' };
  }
  // /hapus-uang <nomor> -> hapus catatan KEUANGAN berdasarkan nomor urut daftar.
  m = low.match(/^\/(?:hapus-uang|hapusuang|hapus-keuangan)\s+(\d+)/);
  if (m) {
    const nomor = Number(m[1]);
    const d = await daftarUang(chatId, 50);
    const target = d[nomor - 1];
    if (!target) {
      return { ditangani: true, reply: `Catatan keuangan #${nomor} tidak ditemukan. Ketik */uang* untuk lihat daftarnya.`, jalur: 'perintah-hapus-uang-gagal' };
    }
    const ok = await hapusUang(chatId, target.id);
    return {
      ditangani: true,
      reply: ok
        ? `🗑️ Catatan keuangan #${nomor} (Rp${Math.round(target.amount).toLocaleString('id-ID')}) dihapus.`
        : `Gagal menghapus catatan keuangan #${nomor}.`,
      jalur: 'perintah-hapus-uang',
    };
  }

  m = low.match(/^\/hapus\s+(\d+)/);
  if (m) {
    const nomor = Number(m[1]);
    // Coba sebagai NOMOR URUT tugas lebih dulu (konsisten dengan tampilan daftar).
    const idTugas = await idDariNomorTugas(chatId, nomor);
    const a = idTugas !== null ? await hapusTugas(chatId, idTugas) : false;
    // CATATAN & KEUANGAN juga memakai NOMOR URUT daftar (terbaru dulu), agar
    // user bisa menghapusnya. Sebelumnya keduanya memakai ID global sehingga
    // /hapus <nomor> hampir selalu "tidak ditemukan".
    let b = false;
    if (!a) {
      const dCat = await daftarCatatan(chatId, 50);
      const targetCat = dCat[nomor - 1];
      if (targetCat) b = await hapusCatatan(chatId, targetCat.id);
    }
    let c = false;
    if (!a && !b) {
      const dUang = await daftarUang(chatId, 50);
      const targetUang = dUang[nomor - 1];
      if (targetUang) c = await hapusUang(chatId, targetUang.id);
    }
    return {
      ditangani: true,
      reply: a || b || c
        ? `🗑️ #${nomor} dihapus.`
        : `#${nomor} tidak ditemukan. Ketik */tugas*, */catatan*, atau */uang* untuk lihat daftarnya.`,
      jalur: 'perintah-hapus',
    };
  }

  // ── A0a. PROFIL WAKTU USER (zona waktu per-user, permanen) ──
  //
  // MASALAH (temuan pemilik produk 05 Okt 2026): "jangan salah membaca waktu user
  // sedang berada... misal sistem defaultnya WIB, jika user di belahan waktu lain
  // maka jadi tidak sama waktunya. Jadi jika ada user baru masuk, saat menanyakan
  // waktu / menyuruh mengingatkan / apapun yang berhubungan dengan waktu, jangan
  // sok tau dan asal jawab defaultnya, tanya dulu user di zona mana, lalu simpan
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

    // ── LANJUTKAN PERMINTAAN TERTUNDA (setelah zona baru diketahui) ──
    // Bila ada permintaan yang menunggu zona, dan zona kini SUDAH diketahui,
    // lanjutkan permintaan itu SEKARANG (tanpa user mengulang).
    if (!keputusan.perluTanya && keputusan.profil) {
      const tertunda = await ambilPermintaanTertunda(chatId);
      // Hanya lanjutkan bila pesan SEKARANG bukan permintaan baru yang berdiri
      // sendiri (mis. user malah minta hal lain). Pesan pendek berisi lokasi
      // ("cianjur") ATAU jawaban zona dianggap sebagai pemicu lanjutan.
      const pesanIniDeklarasiLokasi = detectUserLocationDeclaration(asli) !== null;
      const pesanIniSingkat = asli.trim().split(/\s+/).length <= 4;
      if (tertunda && (pesanIniDeklarasiLokasi || pesanIniSingkat)) {
        await buangPermintaanTertunda(chatId);
        // Jalankan ulang permintaan ASLI dengan zona yang sudah diketahui.
        // `lanjutkanTertunda` mencegah rekursi tak terbatas.
        const lanjut = await tanganiPencatatan(tertunda.teks, chatId, ctx, {
          platform: tertunda.platform,
          actor: tertunda.actor,
          lanjutkanTertunda: true,
        });
        const p = keputusan.profil;
        const waktuSekarang = waktuDiZona(p.timezone);
        if (lanjut.ditangani) {
          // Permintaan adalah PENCATATAN (pengingat/catatan/tugas/keuangan) yang
          // sudah diproses ulang dengan zona benar -> kirim hasilnya.
          const awalan = `Oke, aku catat kamu di *${p.label}* ya, di sana sekarang ${waktuSekarang}. Mulai sekarang jam aku sesuaikan ke zona itu. 👍\n\n`;
          return {
            ditangani: true,
            reply: awalan + lanjut.reply,
            jalur: 'lanjut-setelah-zona',
          };
        }
        // Permintaan BUKAN pencatatan (mis. "cuaca hari ini") -> teruskan ke AI
        // dengan konteks lokasi yang kini sudah tersimpan. PENTING: jangan
        // dikembalikan sebagai "tidak ditangani" tanpa pesan, karena user akan
        // merasa permintaannya hilang. Kita sisipkan awalan zona agar AI tahu
        // konteksnya, lalu minta AI menjawab permintaan ASLI user.
        return {
          ditangani: true,
          reply:
            `Oke, aku catat kamu di *${p.label}* ya, di sana sekarang ${waktuSekarang}. ` +
            `Aku lanjut jawab pertanyaanmu tadi: _${tertunda.teks.slice(0, 120)}_`,
          jalur: 'lanjut-setelah-zona-ai',
          // Penanda agar pemanggil (whatsapp_cloud/telegram) meneruskan ke AI
          // dengan teks ASLI permintaan user (bukan teks pengantar ini).
          teruskanKeAi: tertunda.teks,
        };
      }
    }

    // Bila zona masih TEBAKAN dari nomor telepon, sisipkan catatan konfirmasi
    // di akhir balasan (tidak menghalangi, hanya mengingatkan).
    if (keputusan.perluKonfirmasi && keputusan.profil && butuhLokasiAtauWaktu(asli)) {
      catatanKonfirmasiZona =
        `\n\n_Catatan: aku pakai zona *${keputusan.profil.label}*. Kalau bukan, bilang saja "aku di <kota>" ya._`;
    }

    // Bila user BARU menyebut lokasinya (dan bukan permintaan lain), balas
    // pengakuan singkat, sebelumnya balasan kosong sehingga terasa bot diam.
    const adaDeklarasiBaru = detectUserLocationDeclaration(asli) !== null;
    if (adaDeklarasiBaru && !butuhLokasiAtauWaktu(asli)) {
      const p = keputusan.profil;
      const waktuSekarang = p ? waktuDiZona(p.timezone) : '';
      return {
        ditangani: true,
        reply:
          `Oke, aku catat kamu di *${p?.label ?? 'lokasi itu'}* ya${waktuSekarang ? `, di sana sekarang ${waktuSekarang}` : ''}. ` +
          `Mulai sekarang semua pengingat & jam aku sesuaikan ke zona itu, nggak perlu kasih tahu lagi. 👍`,
        jalur: 'deklarasi-lokasi',
      };
    }

    // Bila berkaitan waktu DAN zona belum diketahui -> tanya dulu (jangan sok tahu).
    //
    // PERBAIKAN (06 Okt 2026): SIMPAN permintaan user agar bisa DILANJUTKAN
    // otomatis begitu zona diketahui. Dulu hanya `return` -> permintaan HILANG
    // dan user harus mengulang ("kenapa remind-nya tidak dicatat lagi?").
    // PERUMUMAN (06 Okt 2026): bukan hanya "waktu", tetapi SEMUA permintaan yang
    // butuh lokasi/waktu (cuaca, kiblat, matahari, dll). Permintaan user DISIMPAN
    // agar bisa dilanjutkan otomatis setelah lokasi diketahui.
    if (keputusan.perluTanya && butuhLokasiAtauWaktu(asli) && !opts.lanjutkanTertunda) {
      await simpanPermintaanTertunda(chatId, asli, opts.platform, opts.actor);
      return {
        ditangani: true,
        reply: `${keputusan.pertanyaan}\n\n_Tenang, permintaanmu aku simpan. Setelah kamu sebut kotanya, langsung aku proses ya._`,
        jalur: 'tanya-zona-waktu',
      };
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
        const daftarB = daftar.map((r, i) => `${i + 1}. "${r.message}", ${formatWaktuUser(new Date(r.due_at))}`).join('\n');
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
              `✅ Pengingat ${label} (TIDAK dobel, yang lama diperbarui).`,
              ``,
              `*Sebelumnya:* "${target.message}", ${formatWaktuUser(new Date(target.due_at))}`,
              `*Sekarang :* "${target.message}", ${formatWaktuUser(waktuBaru)}`,
              catatanKonfirmasiZona,
            ].join('\n'),
            jalur: 'ubah-undur',
          };
        }
        return { ditangani: true, reply: '⚠️ Gagal mengubah pengingat. Coba lagi ya.', jalur: 'ubah-gagal' };
      }

      // Tidak bisa hitung waktu baru -> tanya user (jangan mengarang).
      const daftarTeks = daftar.map((r, i) => `${i + 1}. "${r.message}", ${formatWaktuUser(new Date(r.due_at))}`).join('\n');
      return {
        ditangani: true,
        reply: `Pengingat aktif kamu:\n${daftarTeks}\n\nSebutkan waktu barunya, mis. *undur rapat jadi jam 10* atau *undur satu jam*.`,
        jalur: 'ubah-tanya',
      };
    }
  }

  // ── A0. PERMAINAN (mesin game nyata, state tersimpan di DB) ──
  // Diletakkan PALING AWAL agar saat permainan aktif, semua pesan berikutnya
  // (mis. "merah 5", "e2 e4", "3 5") diperlakukan sebagai LANGKAH permainan -
  // bukan sebagai perintah catat/pengingat.
  {
    const hasilGame = await tanganiGame(s, chatId, opts.platform);
    if (hasilGame.ditangani) {
      return { ditangani: true, reply: hasilGame.reply, jalur: hasilGame.jalur };
    }
  }

  // ── A1b. RINGKASAN PERIODIK (/ringkasan) ──
  //
  // FITUR BARU (audit 05 Okt 2026): satu perintah menyajikan gambaran lengkap -
  // keuangan, tugas, pengingat, catatan. Semua angka dari DATABASE (tidak dikarang).
  {
    const rk = mintaRingkasan(low);
    if (rk) {
      const teks = await susunRingkasan(chatId, { hari: rk.hari });
      return { ditangani: true, reply: teks, jalur: 'ringkasan' };
    }
  }

  // ── A2. HAPUS / SELESAI LEWAT BAHASA ALAMI (agar bisa lewat Voice Note) ──
  // Orang yang berbicara tidak mengetik "/hapus 5", mereka bilang
  // "hapus tugas nomor lima" atau "tandai selesai nomor tiga".
  // BUG YANG DIPERBAIKI (05 Okt 2026): sebelumnya hanya format "/hapus <id>"
  // yang dikenali, sehingga lewat VN tidak bisa menghapus.
  {
    // Angka boleh DIGIT ("nomor 5") atau KATA ("nomor satu"), orang yang
    // berbicara lewat Voice Note tidak mengetik angka.
    const lowAngka = angkaKataKeDigit(low);

    // ── SELESAIKAN TUGAS LEWAT BAHASA ALAMI (perbaikan 06 Okt 2026) ──
    //
    // LAPORAN PEMILIK PRODUK: "tugas upload jurnal selesai" -> bot MALAH
    // menawari mencatat tugas baru, padahal user ingin MENYELESAIKAN.
    //
    // SEBAB: deteksi selesai HANYA mengenali pola "<kata selesai> <angka>"
    // (mis. "selesai 1"). Kalimat alami tanpa angka tidak dikenali.
    //
    // SEKARANG: kenali juga pola:
    //   a. "tugas <nama> selesai"     -> selesai (nama di akhir)
    //   b. "<nama> selesai"           -> selesai
    //   c. "selesai tugas <nama>"     -> selesai (nama di akhir)
    //   d. "selesaikan <nama>"
    // Nama tugas dicocokkan dengan daftar tugas user (kemiripan teks).

    // Pola "tugas X selesai" / "X sudah selesai" / "selesai tugas X" TANPA angka.
    const mSelesaiNama = low.match(
      /^(?:tugas\s+)?(.+?)\s+(?:sudah\s+|udah\s+)?(?:selesai|kelar|beres|done|tuntas|selesaikan)\s*[.!]*$/i,
    ) || low.match(
      /^(?:selesai(?:kan)?|tandai\s+selesai|sudah\s+selesai|udah\s+selesai)\s+(?:tugas\s+)?(.+?)\s*[.!]*$/i,
    );
    // GUARD: jangan tangkap cerita masa lalu ("aku tadi selesai makan").
    // Kata waktu lampau menandakan user BERCERITA, bukan menyuruh menyelesaikan.
    const ceritaLampau = /\b(tadi|kemarin|barusan|baru\s+aja|td|tadi\s+kan|sudah\s+aku|aku\s+sudah\s+selesai\s+\w+\s+tadi)\b/.test(low);
    if (mSelesaiNama && !ceritaLampau) {
      const mentah = mSelesaiNama[1].trim()
        .replace(/^tugas\s+/i, '').replace(/\s+tugas$/i, '').trim();
      // Buat DUA kandidat: (a) apa adanya, (b) tanpa kata kerja umum di depan.
      // Penting: "upload jurnal selesai" -> jangan buang "upload" (itu bagian
      // nama tugas!). Kita coba keduanya agar cocok paling tepat.
      const tanpaKataKerja = mentah
        .replace(/^(?:beli|buat|bikin|kerjakan|mengerjakan|mengurus|urus|kirim|bayar|hubungi|telepon|telpon|baca|tulis)\s+/i, '')
        .trim();
      const kandidatNama = Array.from(new Set([mentah, tanpaKataKerja]))
        .filter((n) => n.length >= 2 && !/^\d+$/.test(n));

      if (kandidatNama.length > 0) {
        const tugasUser = await daftarTugas(chatId, true);
        // Cocokkan bertingkat: SAMA PERSIS dulu, baru mengandung.
        let kandidat: (typeof tugasUser)[number] | undefined;
        for (const nama of kandidatNama) {
          const b = nama.toLowerCase().trim();
          kandidat = tugasUser.find((t) => t.task.toLowerCase().trim() === b);
          if (kandidat) break;
        }
        if (!kandidat) {
          for (const nama of kandidatNama) {
            const b = nama.toLowerCase().trim();
            kandidat = tugasUser.find((t) => {
              const a = t.task.toLowerCase().trim();
              return a.includes(b) || b.includes(a);
            });
            if (kandidat) break;
          }
        }
        const namaTugas = mentah;
        if (kandidat) {
          const okk = await selesaikanTugas(chatId, kandidat.id);
          if (okk) {
            return {
              ditangani: true,
              reply: `✅ Tugas *#${kandidat.nomor ?? kandidat.id} ${kandidat.task}* selesai! 👍`,
              jalur: 'niat-selesai-nama',
            };
          }
        } else if (tugasUser.length > 0) {
          // Ada tugas tapi namanya tidak cocok -> beri tahu daftar agar user bisa pilih.
          return {
            ditangani: true,
            reply:
              `Tidak ada tugas bernama *"${namaTugas}"* yang belum selesai.\n\n` +
              `*Tugas kamu:*\n${formatDaftarTugas(tugasUser)}\n\n` +
              `Ketik misalnya: *selesai ${tugasUser[0].nomor ?? tugasUser[0].id}*`,
            jalur: 'niat-selesai-tidak-cocok',
          };
        }
      }
    }

    const mHapus = lowAngka.match(/\b(?:hapus|buang|hilangkan|delete)\s+(?:tugas|catatan|barang|belanja|nomor|no|yang)?\s*(?:nomor|no|#)?\s*(\d+)\b/);
    // Pola A: "<kata selesai> <angka>"  -> "selesai 1", "selesaikan nomor 2"
    // Pola B: "tugas <angka> selesai"    -> "tugas 1 selesai" (angka di TENGAH)
    //   BUG DIPERBAIKI (06 Okt 2026): "tugas 1 selesai" dulu ditawari MENCATAT
    //   tugas baru bernama "1 selesai" (lihat evaluasi CSV #2359).
    // ── DIPERBAIKI (temuan nyata 06 Okt 2026) ──
    // LAPORAN: "Nenek gua ma walao udah 1021 tahun emang masih jaya" -> bot
    // menjawab "Tugas #1021 tidak ditemukan" (NGACO).
    //
    // AKAR: pola lama menerima kata "sudah"/"udah" sebagai penanda "selesai",
    // sehingga "udah 1021 tahun" (keterangan UMUR) dianggap "tugas 1021 selesai".
    //
    // SEKARANG: "sudah/udah" HARUS diikuti kata "selesai/kelar/beres/tuntas"
    // (bukan langsung angka), ATAU pakai kata "selesai/selesaikan/tandai" langsung.
    // Pola 1: "<selesai> <nomor>"  -> "selesai 1", "selesaikan nomor 2"
    // Pola 2: "tugas <nomor> selesai" -> "tugas 1 selesai" (angka di TENGAH)
    // Pola 3: "sudah/udah selesai <nomor>" -> "udah selesai 1"
    const mSelesai =
      lowAngka.match(/\b(?:selesai|selesaikan|done|beres|kelar|tuntas)\s+(?:tugas|nomor|no|#)?\s*(\d+)\b/) ||
      lowAngka.match(/\b(?:sudah|udah)\s+(?:selesai|kelar|beres|done|tuntas)\s+(?:tugas|nomor|no|#)?\s*(\d+)\b/) ||
      lowAngka.match(/\btugas\s+(?:nomor\s+|no\s+|#)?(\d+)\s+(?:sudah\s+|udah\s+)?(?:selesai|kelar|beres|done|tuntas)\b/) ||
      lowAngka.match(/\btandai\s+(?:tugas\s+)?(?:nomor\s+|no\s+|#)?(\d+)\s+(?:selesai|kelar|beres|done|tuntas)\b/);
    // GUARD: jangan tangkap kalimat yang jelas BUKAN tentang tugas
    // (keterangan umur/jumlah: "udah 1021 tahun", "punya 3 kucing").
    const bukanTentangTugas =
      /\b(?:tahun|bulan|hari|kali|orang|kucing|anak|ekor|buah|biji|ribu|juta|miliar)\b/.test(lowAngka) &&
      !/\btugas\b/.test(lowAngka);
    if (mSelesai && !bukanTentangTugas) {
      const id = Number(mSelesai[1]);
      // Nomor yang diketik user = NOMOR URUT per-user, bukan ID global.
      const idAsli = await idDariNomorTugas(chatId, id);
      if (idAsli === null) {
        return { ditangani: true, reply: `Tugas #${id} tidak ditemukan. Ketik */tugas* untuk melihat daftar.`, jalur: 'niat-selesai' };
      }
      const okk = await selesaikanTugas(chatId, idAsli);
      return { ditangani: true, reply: okk ? `✅ Tugas #${id} selesai!` : `Tugas #${id} tidak ditemukan.`, jalur: 'niat-selesai' };
    }
    if (mHapus) {
      const nomor = Number(mHapus[1]);
      // Coba sebagai NOMOR URUT tugas dulu (konsisten dengan tampilan daftar).
      const idTugas = await idDariNomorTugas(chatId, nomor);
      const a = idTugas !== null ? await hapusTugas(chatId, idTugas) : false;
      const b = a ? false : await hapusCatatan(chatId, nomor);
      const cc = a || b ? false : await hapusUang(chatId, nomor);
      return { ditangani: true, reply: a || b || cc ? `🗑️ #${nomor} dihapus.` : `#${nomor} tidak ditemukan.`, jalur: 'niat-hapus' };
    }
  }

  // ── B0a. MINTA PANDUAN/TUTORIAL (perbaikan 06 Okt 2026) ──
  // Permintaan pemilik produk: "jika ada user minta tutorial fitur atau cara
  // pemakaian, atau bertanya bisa apa saja, berikan full apa yang bisa
  // dilakukan bot, apa saja fitur yang bisa digunakan beserta cara pakainya".
  if (deteksiMintaPanduan(s)) {
    return { ditangani: true, reply: teksPanduanLengkap(), jalur: 'panduan-lengkap' };
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
  // ── PETUNJUK BILA HANYA JENIS TANPA ISI (perbaikan 06 Okt 2026) ──
  // Temuan evaluasi: user mengetik "Catat keuangan" -> bot menyimpan catatan
  // bernama "keuangan" (tidak berguna). Sekarang bot MEMBERI PETUNJUK.
  const panduan = panduanJenisSaja(s);
  if (panduan) {
    return { ditangani: true, reply: panduan, jalur: 'panduan-jenis' };
  }

  const niat = deteksiNiat(s);
  if (niat) {
    const iniPengingat = niat.kind === 'note' && Boolean(niat.data.pengingat);

    if (iniPengingat) {
      // ── PENGINGAT TANPA JAM: TANYA JAM & SIMPAN STATE (temuan 07 Okt 2026) ──
      // "oh iya ingetin aku setiap hari buat minum vitamin ya" (tanpa jam) ->
      // dulu langsung disimpan dengan jam default (08:00) tanpa memberi tahu user.
      // Sekarang: tanya jam dulu, simpan state 'jam' agar jawaban berikutnya
      // ("jam 7.30 pagi dan 12.30 siang") langsung diproses.
      if (niat.data.perlu_jam) {
        await simpanPermintaanTertunda(chatId, asli, opts.platform, opts.actor, 'jam');
        return {
          ditangani: true,
          reply: 'Oke, aku catat. Mau diingetin jam berapa? (mis. *jam 7.30 pagi* atau *jam 12.30 siang*)',
          jalur: 'tanya-jam-pengingat',
        };
      }
      // Pengingat: langsung simpan (tidak boleh ada balasan tanya-jawab).
      const r = await simpanDariNiat(chatId, niat, { actor: opts.actor, platform: opts.platform });
      return { ditangani: true, reply: r.pesan, jalur: `niat-${niat.kind}` };
    }

    // Catatan / tugas / keuangan: konfirmasi dulu.
    // ── LANGSUNG SIMPAN (perbaikan 06 Okt 2026) ──
    // LAPORAN PEMILIK PRODUK (dari evaluasi CSV):
    //   "Bisa langsung catat aja?" -> user MERASA terganggu oleh konfirmasi
    //   ya/tidak. Sekarang catatan/tugas/keuangan LANGSUNG DISIMPAN.
    //   (Pengingat memang sudah langsung simpan sejak sebelumnya.)
    const hasilSimpan = await simpanDariNiat(chatId, niat, { actor: opts.actor, platform: opts.platform });
    if (!hasilSimpan.ok) {
      return { ditangani: true, reply: hasilSimpan.pesan, jalur: `niat-${niat.kind}-gagal` };
    }
    return {
      ditangani: true,
      reply: hasilSimpan.pesan,
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
  // tambah, ingatkan, ...). Bila user memakai kalimat lain, mis.
  //   "tolong dicatat ya aku habis 50rb"     (kata "dicatat" tidak baku)
  //   "jangan lupa besok aku ada rapat"      (tidak ada kata perintah)
  //   "set reminder buat besok pagi"         ("set reminder" bahasa campur)
  //, permintaan itu LOLOS ke AI, dan AI hanya menjawab obrolan tanpa menyimpan.
  //
  // SOLUSI: bila tidak ada niat eksplisit DAN teksnya mengandung sinyal
  // "permintaan aksi" (kata minta/permintaan + objek data), jalankan detektor
  // CADANGAN yang lebih longgar, tapi TETAP meminta konfirmasi user sebelum
  // menyimpan, supaya salah tangkap tidak langsung mengotori database.
  const niatImplisit = deteksiNiatImplisit(s);
  if (niatImplisit) {
    // ── LANGSUNG SIMPAN (perbaikan 06 Okt 2026) ──
    // LAPORAN PEMILIK PRODUK: "konfirmasi ya tidaknya itu sangat mengganggu
    // dan bikin kesal, coba hilangkan saja semua konfirmasi ya tidaknya".
    // Sekarang SEMUA pencatatan langsung disimpan, termasuk niat implisit.
    const r = await simpanDariNiat(chatId, niatImplisit, { actor: opts.actor, platform: opts.platform });
    return { ditangani: true, reply: r.pesan, jalur: `implisit-${niatImplisit.kind}` };
  }

  return { ditangani: false, reply: '', jalur: '' };
}

/**
 * Deteksi niat CADANGAN, lebih longgar dari `deteksiNiat`, untuk kalimat yang
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

  // Harus ada sinyal "permintaan aksi", kalau tidak, ini obrolan biasa.
  const sinyalMinta =
    /\b(?:tolong|please|pls|mohon|bantu|bantuin|bisa|bisakah|boleh|coba|cek|masukin|input|daftarkan|list|set|pasang|buatkan|bikinin|jadwalkan|siapkan|tandai|mark)\b/i.test(s) ||
    /\b(?:jangan\s*lupa|jgn\s*lupa|jngn\s*lupa|ingat\s*ya|catat\s*ya|dicatat|tercatat|notes?\s*:)/i.test(s) ||
    // "aku perlu ...", "aku harus ...", permintaan implisit untuk dicatat sebagai tugas
    /\b(?:aku|saya|gue|gw|kita)\s+(?:perlu|harus|kudu|mesti|pengen|pengin|mau|ingin)\s+\w+/i.test(s) ||
    // DIPERLUAS (05 Okt 2026): kalimat pencatatan sehari-hari tanpa kata "catat".
    //   "beli kopi 25rb", "bayar listrik 350000", "jajan gorengan 10k",
    //   "dapat gaji lima juta", "harus beli galon"
    /\b(?:beli|bayar|jajan|ongkos|habis|abis|dapat|dapet|gaji|gajian|belanja|transferan|bonus|thr|parkir|bensin|tagihan|sewa|cicilan|utang|hutang|pengeluaran|pemasukan|pengeluaranku|pemasukanku|komisi|cashback|refund|warisan|hadiah)\b/i.test(s) ||
    /^\s*(?:harus|perlu|kudu|mesti)\s+\w+/i.test(s);
  if (!sinyalMinta) return null;

  // ── TOLAK CURHAT / LAPORAN PRIBADI (temuan 07 Okt 2026) ──
  // LAPORAN PEMILIK PRODUK: "awas ketika dalam percakapan biasa dan user sedang
  // curhat bahwa dia sudah gajian dan mendapat gaji 5 juta malah dicatat ke
  // pemasukan".
  //
  // AKAR: sinyalMinta menerima kata transaksi apa pun ("gajian", "dapet"), sehingga
  // CURHAT ("alhamdulillah gajian 5 juta nih") ikut dicatat.
  //
  // SEKARANG: bila ada kata PERASAAN/KONDISI atau penanda cerita, TOLAK.
  const curhatRe =
    /\b(?:sedih|seneng|senang|bahagia|alhamdulillah|syukur|bersyukur|akhirnya|nasib|kasian|prihatin|bete|kesel|kesal|stress|stres|bingung|galau|bangkrut|bokek|kere|miskin|menyesal|nyesel|lumayan|senengnya|akhirnyaa)\b/i;
  const ceritaRe =
    /\b(?:tadi|kemarin|barusan|baru\s*aja|td|udah|sudah|akhirnya|katanya)\b/i;
  const laporanSaldo = /\b(?:duit|uang|saldo|sisa|tinggal|tersisa|masuk\s+rekening|ke\s+rekening)\b[^.!?\n]{0,15}\d/i;
  // "aku dapet bonus 2 juta, mau beliin ibu" -> niat/narasi, bukan permintaan catat.
  const niatNaratif = /\b(?:mau|pengen|pingin|ingin)\s+(?:beliin|belikan|beli|kasih|kasi|traktir|bagi)\b/i;
  // Penanda CERITA MASA LALU -> curhat. KECUALI bila user meminta catat eksplisit
  // ("tolong catat tadi aku beli ...") atau transaksi jelas dengan nominal.
  const mintaCatatImplisit = /\b(?:tolong|please|pls|mohon|bantu|bantuin|catat|dicatat|tercatat|simpan|masukin|input|note)\b/i.test(s);
  const ceritaMasaLalu = ceritaRe.test(s) && !mintaCatatImplisit;
  if (curhatRe.test(s) || laporanSaldo.test(s) || niatNaratif.test(s) || ceritaMasaLalu) return null;

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
        // ── JAM KEDUA + KATA SAMBUNG MENGGANTUNG (temuan 07 Okt 2026) ──
        // "minum vitamin jam 7.30 dan 12.30" -> "minum vitamin dan 12.30" (kotor).
        // URUTAN: buang "jam N" dulu, lalu angka telanjang, baru kata sambung.
        .replace(/\b(?:jam|pukul)\s*\d{1,2}([:.]\d{2})?/gi, ' ')
        .replace(/\s*\b(?:dan|atau|serta|,)\s*\d{1,2}([:.]\d{2})?\s*(?:pagi|siang|sore|malam|subuh)?/gi, ' ')
        .replace(/\s*\b\d{1,2}([:.]\d{2})\s*(?:pagi|siang|sore|malam|subuh)?\b/gi, ' ')
        .replace(/\s*\b(?:dan|atau|serta|juga)\s*[.!?]*\s*$/gi, ' ')
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
  // habis/dapat/gaji/dll), cara orang mencatat pengeluaran sehari-hari.
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
    // ── DIPERLUAS (06 Okt 2026) ──
    // Temuan: "bonus 2 juta" dicatat sebagai PENGELUARAN (salah). Daftar kata
    // pemasukan di jalur implisit ini TIDAK sinkron dengan blok 4a — "bonus",
    // "gajian", "thr", "cair", "komisi" tidak ada. Sekarang disamakan.
    const kind: ExpenseKind =
      /\b(?:masuk|masukan|dapat|dapet|terima|menerima|gaji|gajian|gajinya|gajiannya|bonus|bonusan|thr|pendapatan|pemasukan|income|honor|fee|saldo|sisa|tersisa|simpanan|tabungan|cair|komisi|cashback|refund|warisan|hadiah|untung|laba|profit)\b/i.test(s)
        ? 'in'
        : 'out';
    const kategori = tebakKategori(s);
    return {
      kind: 'expense', yakin: 0.7,
      data: { amount: nominal, kind, category: kategori, note: asli },
      ringkas: `${kind === 'in' ? 'Pemasukan' : 'Pengeluaran'} Rp${nominal.toLocaleString('id-ID')} (${kategori})`,
    };
  }

  // c) TUGAS: ada kata perlu/harus/mesti + KATA KERJA apa pun (lebih longgar),
  //    atau ada kata "tugas/todo" + isi.
  // KATA KEINGINAN ("pengen/pengin/mau/ingin") BUKAN tugas, itu obrolan/angan-angan.
  // Temuan uji 05 Okt 2026: "aku pengen beli mobil" salah diklasifikasi jadi tugas.
  // Hanya KEWAJIBAN ("perlu/harus/kudu/mesti") yang dianggap tugas.
  const mTugas = asli.match(/\b(?:aku|saya|gue|gw|kita)?\s*(?:perlu|harus|kudu|mesti)\s+([a-z]{3,20}\s+[\s\S]{2,80})/i);
  // Varian tanpa subjek: "harus beli galon", "perlu bayar pajak"
  const mTugasPolos = asli.match(/^\s*(?:perlu|harus|kudu|mesti)\s+([a-z]{3,20}\s+[\s\S]{2,80})/i);

  // ── PENJAGA: "harus" + KATA GANTI ORANG KEDUA = obrolan, BUKAN tugas ──
  // TEMUAN NYATA (06 Okt 2026): "Lu harus paksa gue baru gue mau jawab" salah
  // dicatat sebagai TUGAS ("harus paksa gue baru gue mau jawab").
  //
  // Ciri obrolan (bukan tugas):
  //   - subjek/kata gantinya ORANG KEDUA (lu/kamu/elo/anda/kau) -> itu ucapan
  //     ke BOT, bukan kewajiban user sendiri.
  //   - kata kerja bermakna perintah sosial: paksa, bilang, jawab, jawabnya,
  //     gitu, gini, diam, pergi, tinggal, ikut, coba, tebak, ledek, gombal.
  const obrolanBukanTugas =
    /\b(?:lu|lo|loe|elo|kamu|kaw|anda|kau|kmu)\s+(?:harus|perlu|kudu|mesti)\b/i.test(asli) ||
    /\b(?:harus|perlu|kudu|mesti)\s+(?:paksa|dipaksa|bilang|jawab|jawabnya|gitu|gini|diam|pergi|tinggal|ikut|coba|tebak|ledek|gombal|ngerti|ngerti|paham|tau|tahu|percaya|setuju|iya|mau|bisa|boleh)\b/i.test(asli);
  if (obrolanBukanTugas) {
    return null;
  }
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
// DETEKSI PERTANYAAN, jawab dari DATABASE, bukan dari "pengetahuan" model
// ============================================================================

/**
 * KENAPA INI PENTING (temuan nyata 04 Okt 2026):
 * User bertanya "berapa sisa uang saya" padahal tabel `expenses` KOSONG (0 baris).
 * Bot menjawab "Sisa uang kamu tinggal Rp20.000 dari pemasukan 100 ribu dikurangi
 * pengeluaran 80 ribu", ANGKA KARANGAN. Halusinasi data keuangan itu berbahaya:
 * user bisa mengambil keputusan salah berdasarkan angka palsu.
 *
 * Sebabnya: pertanyaan seperti itu TIDAK melewati modul ini sama sekali, langsung
 * dikirim ke model AI, dan model "menjawab" dengan mengarang.
 *
 * Solusi: deteksi pertanyaan keuangan/tugas/catatan di sini, jawab dari DATABASE.
 * Bila data kosong, katakan JUJUR bahwa belum ada catatan, jangan mengarang.
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
