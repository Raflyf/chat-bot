/**
 * DAFTAR PERINTAH BOT — SATU SUMBER KEBENARAN.
 *
 * KENAPA MODUL INI ADA (permintaan pemilik produk 16 Okt 2026):
 *   "saya ingin ketika / gini itu muncul semua list fitur yg ada secara lengkap"
 *
 * MASALAH SEBELUMNYA:
 *   1. Perintah bot TIDAK PERNAH didaftarkan ke Telegram (`setMyCommands`), jadi
 *      menu `/` di kolom ketik KOSONG — user tidak tahu bot bisa apa saja.
 *   2. Perintah `/help`, `/bantuan`, `/menu`, `/fitur`, `/panduan`, `/tutorial`
 *      hanya masuk daftar `knownCommands` (supaya dianggap "ditujukan ke bot" di
 *      grup) TANPA ada penanganannya — akhirnya ditelan `if (text.startsWith('/'))`
 *      dan bot diam saja.
 *
 * MODUL INI MENYATUKAN keduanya: daftar perintah dipakai untuk (a) mendaftarkan
 * menu `/` ke Telegram, dan (b) memberi AI daftar AKURAT saat user minta bantuan
 * — supaya bot tidak mengarang fitur yang tidak ada.
 *
 * ATURAN TELEGRAM (jangan dilanggar saat menambah perintah):
 *   - `command`: 1-32 karakter, HANYA huruf kecil a-z, angka 0-9, dan garis bawah.
 *     TANDA HUBUNG TIDAK BOLEH -> perintah seperti `/tugas-saya` tetap berfungsi
 *     sebagai teks biasa, tetapi TIDAK BISA didaftarkan ke menu.
 *   - `description`: 3-256 karakter.
 *   - Maksimal 100 perintah.
 */

export interface PerintahBot {
  /** Nama perintah TANPA garis miring (mis. "catat"). */
  command: string;
  /** Penjelasan singkat yang tampil di menu `/` Telegram. */
  description: string;
}

/**
 * Daftar perintah yang BENAR-BENAR ditangani kode.
 *
 * Setiap entri sudah diverifikasi ada penanganannya (lihat catatan sumber di
 * komentar tiap baris). JANGAN menambah perintah di sini sebelum penanganannya
 * benar-benar ada — menu yang menyesatkan lebih buruk daripada menu kosong.
 */
export const PERINTAH_BOT: PerintahBot[] = [
  // ── Sapaan & bantuan ──
  { command: 'start', description: 'Mulai & sapa bot' }, // telegram.ts: if (text === '/start')
  // ── HANYA SATU perintah bantuan (koreksi pemilik produk 16 Okt 2026) ──
  // "knapa help, menu, bantuan, fitur, tutorial, panduan, itu isi nya sama,
  //  kalo gitu cukup satukan saja jadi help saja... kan sudah saya bilang jangan
  //  ada / yg isi nya sama"
  //
  // Sebelumnya ada 6 perintah bantuan dengan isi identik — itu DUPLIKAT dan
  // dilarang. Semuanya dihapus, hanya `/help` yang tersisa.
  { command: 'help', description: 'Daftar lengkap fitur & perintah' },

  // ── Sesi ──
  // `clear` DIHAPUS: isinya sama persis dengan `reset` (aturan anti-duplikat).
  { command: 'reset', description: 'Mulai sesi baru — hapus riwayat percakapan' },

  // ── Obrolan & tanya AI ──
  // `ai` DIHAPUS: isinya sama persis dengan `tanya`.
  { command: 'tanya', description: 'Tanya apa saja ke AI' },

  // ── Catatan ──
  // `note` DIHAPUS (sama dengan `catat`), `notes` DIHAPUS (sama dengan `catatan`).
  { command: 'catat', description: 'Simpan catatan — /catat <isi>' },
  { command: 'catatan', description: 'Lihat catatan terakhir' },
  { command: 'cari', description: 'Cari catatan — /cari <kata>' },

  // ── Tugas ──
  // `todo` & `task` DIHAPUS (sama dengan `tugas`);
  // `daftar`, `todos`, `tugasku` DIHAPUS (sama dengan `list`).
  { command: 'tugas', description: 'Tambah tugas — /tugas <isi>' },
  { command: 'list', description: 'Lihat daftar tugas' },

  // ── Keuangan ──
  // `keluar` & `out` DIHAPUS (sama dengan `uang`);
  // `in` & `gaji` DIHAPUS (sama dengan `masuk`).
  { command: 'uang', description: 'Catat pengeluaran — /uang <nominal> <keterangan>' },
  { command: 'masuk', description: 'Catat pemasukan — /masuk <nominal> <keterangan>' },
  { command: 'rekap', description: 'Rekap keuangan — /rekap [jumlah hari]' },
  { command: 'hapusuang', description: 'Hapus catatan keuangan — /hapusuang <nomor>' },

  // ── Barang & belanja ──
  // `belanja` DIHAPUS: isinya sama persis dengan `barang`.
  { command: 'barang', description: 'Catat/lihat daftar barang & belanja' },

  // ── Ringkasan menyeluruh ──
  // FITUR TERSEMBUNYI (temuan 16 Okt 2026): `/ringkasan` sudah lama berfungsi
  // (notes.ts: mintaRingkasan -> susunRingkasan) tetapi TIDAK PERNAH didaftarkan,
  // sehingga tidak muncul di menu `/` padahal balasan lain menyuruh memakainya.
  { command: 'ringkasan', description: 'Ringkasan semua: keuangan, tugas, pengingat, catatan' },

  // ── Pengingat & preferensi ──
  { command: 'remind', description: 'Pengingat — /remind <menit> <pesan>' },
  { command: 'salah', description: 'Koreksi preferensi personal — /salah <koreksi>' },
];

/**
 * Perintah yang MENERIMA teks setelahnya (bukan sekadar perintah telanjang).
 * Dipakai untuk menyusun panduan pemakaian di teks bantuan.
 */
export const PERINTAH_BERARGUMEN: Record<string, string> = {
  catat: '/catat <isi catatan>',
  tugas: '/tugas <isi tugas>',
  uang: '/uang <nominal> <keterangan>',
  masuk: '/masuk <nominal> <keterangan>',
  rekap: '/rekap [jumlah hari]',
  cari: '/cari <kata kunci>',
  remind: '/remind <menit> <pesan>',
  salah: '/salah <koreksi>',
  hapusuang: '/hapusuang <nomor>',
};

/**
 * Perintah bantuan — HANYA SATU (koreksi pemilik produk 16 Okt 2026).
 *
 * Sebelumnya 6 perintah (`help`, `bantuan`, `menu`, `fitur`, `panduan`,
 * `tutorial`) menghasilkan isi yang SAMA. Itu duplikat dan dilarang:
 *   "kan sudah saya bilang jangan ada / yg isi nya sama"
 * Sekarang tinggal `/help`.
 */
export const PERINTAH_BANTUAN = new Set(['help']);

/**
 * Perintah LAMA yang sudah DIGABUNG ke perintah utama (tidak lagi dipakai).
 *
 * Dipakai untuk memberi arahan singkat bila user masih mengetiknya, bukan untuk
 * menjalankannya — supaya tidak ada dua perintah dengan isi yang sama.
 */
export const PERINTAH_DIGABUNG: Record<string, string> = {
  bantuan: 'help',
  menu: 'help',
  fitur: 'help',
  panduan: 'help',
  tutorial: 'help',
  clear: 'reset',
  ai: 'tanya',
  note: 'catat',
  notes: 'catatan',
  search: 'cari',
  todo: 'tugas',
  task: 'tugas',
  daftar: 'list',
  todos: 'list',
  tugasku: 'list',
  keluar: 'uang',
  out: 'uang',
  in: 'masuk',
  gaji: 'masuk',
  belanja: 'barang',
};

/**
 * Daftar perintah siap-pakai untuk `setMyCommands` Telegram.
 * Sudah disaring agar HANYA memuat nama yang sah menurut aturan Telegram
 * (huruf kecil, angka, garis bawah) — nama bertanda hubung akan ditolak API.
 */
export function daftarPerintahTelegram(): PerintahBot[] {
  const sah = /^[a-z0-9_]{1,32}$/;
  return PERINTAH_BOT.filter((p) => sah.test(p.command)).slice(0, 100);
}

/** Daftar perintah sebagai teks ringkas (untuk konteks AI / dokumentasi). */
export function teksDaftarPerintah(): string {
  return PERINTAH_BOT.map((p) => `/${p.command} — ${p.description}`).join('\n');
}

/**
 * Panduan ringkas yang DETERMINISTIK (satu teks untuk semua alias bantuan).
 *
 * KENAPA TIDAK DIGENERASI AI (koreksi pemilik produk 16 Okt 2026):
 *   "ada yg balasannya sama dan ga sampai tuntas karna terlalu panjang" +
 *   "panduannya juga terlalu panjang dan pusing untuk di baca dan sulit di pahami"
 *
 * Sebelumnya `/help`, `/bantuan`, `/menu`, `/fitur`, `/panduan`, `/tutorial`
 * masing-masing DIGENERASI AI, sehingga:
 *   - isinya BERBEDA-BEDA untuk perintah yang seharusnya sama;
 *   - panjangnya melewati batas pesan Telegram -> terpotong di tengah kalimat;
 *   - bertele-tele dan sulit dibaca.
 *
 * Daftar perintah adalah DATA REFERENSI, bukan percakapan — jadi wajar disusun
 * pasti. Balasan obrolan tetap 100% digenerate AI seperti biasa; yang ini hanya
 * menu bantuan. Hasilnya: konsisten, ringkas, dan tidak pernah terpotong.
 */
export function teksBantuan(): string {
  return [
    '*FreeAIBot — daftar perintah*',
    '',
    '*Ngobrol*',
    'Ketik langsung apa saja. Atau `/tanya <pertanyaan>`.',
    '`/reset` — mulai sesi baru',
    '',
    '*Catatan*',
    '`/catat <isi>` — simpan catatan',
    '`/catatan` — lihat catatan terakhir',
    '`/cari <kata>` — cari catatan',
    '',
    '*Tugas*',
    '`/tugas <isi>` — tambah tugas',
    '`/list` — lihat daftar tugas',
    '',
    '*Keuangan*',
    '`/uang <nominal> <ket>` — catat pengeluaran',
    '`/masuk <nominal> <ket>` — catat pemasukan',
    '`/rekap [hari]` — rekap keuangan',
    '`/hapusuang <nomor>` — hapus catatan keuangan',
    '',
    '*Belanja*',
    '`/barang` — lihat / tambah daftar belanja',
    '',
    '*Ringkasan*',
    '`/ringkasan` — semua sekaligus (keuangan, tugas, pengingat, catatan)',
    '',
    '*Pengingat*',
    '`/remind <menit> <pesan>`',
    '',
    '*Lainnya*',
    '`/salah <koreksi>` — perbaiki data tentangmu',
    '`/help` — tampilkan panduan ini',
  ].join('\n');
}

/** Petunjuk singkat saat perintah berargumen diketik TANPA argumen. */
export function petunjukPemakaian(command: string): string {
  const contoh = PERINTAH_BERARGUMEN[command];
  return contoh
    ? `Contoh: \`${contoh}\``
    : `Ketik \`/${command}\` dengan benar ya.`;
}

/**
 * Perintah bantuan sebagai teks untuk diberikan ke AI.
 *
 * PENTING: teks ini adalah BAHAN KONTEKS, bukan balasan siap kirim. AI tetap
 * menyusun balasannya sendiri (tidak ada template statis) — daftar ini hanya
 * mencegah bot mengarang fitur yang tidak ada.
 */
export function konteksBantuanUntukAi(): string {
  const berargumen = Object.entries(PERINTAH_BERARGUMEN)
    .map(([, contoh]) => `   • ${contoh}`)
    .join('\n');
  return [
    'DAFTAR PERINTAH YANG BENAR-BENAR ADA (jangan menyebut perintah di luar daftar ini):',
    teksDaftarPerintah(),
    '',
    'Contoh pemakaian perintah yang butuh isi:',
    berargumen,
  ].join('\n');
}
