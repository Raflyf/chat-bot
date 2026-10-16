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
  { command: 'help', description: 'Daftar lengkap fitur & perintah' }, // telegram.ts: blok bantuan
  { command: 'bantuan', description: 'Daftar lengkap fitur & perintah' },
  { command: 'menu', description: 'Daftar lengkap fitur & perintah' },
  { command: 'fitur', description: 'Daftar lengkap fitur & perintah' },
  { command: 'panduan', description: 'Daftar lengkap fitur & perintah' },
  { command: 'tutorial', description: 'Daftar lengkap fitur & perintah' },

  // ── Sesi ──
  { command: 'reset', description: 'Mulai sesi baru — hapus riwayat percakapan' }, // memory.ts: isResetCommand
  { command: 'clear', description: 'Mulai sesi baru (sama seperti /reset)' },

  // ── Obrolan & tanya AI ──
  { command: 'tanya', description: 'Tanya apa saja ke AI' }, // telegram.ts: prefix dibuang
  { command: 'ai', description: 'Tanya apa saja ke AI (alias /tanya)' },

  // ── Catatan ──
  { command: 'catat', description: 'Simpan catatan — /catat <isi>' }, // notes.ts: ^/(?:catat|note|notes)
  { command: 'note', description: 'Simpan catatan (alias /catat)' },
  { command: 'catatan', description: 'Lihat catatan terakhir' }, // notes.ts: ^/(?:catatan|notes)$
  { command: 'notes', description: 'Lihat catatan terakhir (alias)' },
  { command: 'cari', description: 'Cari catatan — /cari <kata>' }, // notes.ts: blok /cari

  // ── Tugas ──
  { command: 'tugas', description: 'Tambah tugas — /tugas <isi>' }, // notes.ts: ^/(?:todo|tugas|task)
  { command: 'todo', description: 'Tambah tugas (alias /tugas)' },
  { command: 'task', description: 'Tambah tugas (alias /tugas)' },
  { command: 'list', description: 'Lihat daftar tugas' }, // notes.ts: ^/(?:list|daftar|...)$
  { command: 'daftar', description: 'Lihat daftar tugas (alias /list)' },
  { command: 'todos', description: 'Lihat daftar tugas (alias /list)' },
  { command: 'tugasku', description: 'Lihat daftar tugas (alias /list)' },

  // ── Keuangan ──
  { command: 'uang', description: 'Catat pengeluaran — /uang <nominal> <keterangan>' }, // notes.ts: ^/(?:uang|keluar|out)
  { command: 'keluar', description: 'Catat pengeluaran (alias /uang)' },
  { command: 'out', description: 'Catat pengeluaran (alias /uang)' },
  { command: 'masuk', description: 'Catat pemasukan — /masuk <nominal> <keterangan>' }, // notes.ts: ^/(?:masuk|in|gaji)
  { command: 'in', description: 'Catat pemasukan (alias /masuk)' },
  { command: 'gaji', description: 'Catat pemasukan gaji (alias /masuk)' },
  { command: 'rekap', description: 'Rekap keuangan — /rekap [jumlah hari]' }, // notes.ts: ^/rekap
  { command: 'hapusuang', description: 'Hapus catatan keuangan — /hapusuang <nomor>' }, // notes.ts: ^/(?:hapus-uang|hapusuang|...)

  // ── Barang & belanja ──
  { command: 'barang', description: 'Catat/lihat daftar barang & belanja' }, // notes.ts: blok /barang
  { command: 'belanja', description: 'Catat/lihat daftar belanja (alias /barang)' },

  // ── Pengingat & preferensi ──
  { command: 'remind', description: 'Pengingat — /remind <menit> <pesan>' }, // telegram.ts: text.startsWith('/remind')
  { command: 'salah', description: 'Koreksi preferensi personal — /salah <koreksi>' }, // telegram.ts: text.startsWith('/salah')
];

/**
 * Perintah yang MENERIMA teks setelahnya (bukan sekadar perintah telanjang).
 * Dipakai untuk menyusun panduan pemakaian di teks bantuan.
 */
export const PERINTAH_BERARGUMEN: Record<string, string> = {
  catat: '/catat <isi catatan>',
  note: '/note <isi catatan>',
  tugas: '/tugas <isi tugas>',
  todo: '/todo <isi tugas>',
  task: '/task <isi tugas>',
  uang: '/uang <nominal> <keterangan>',
  keluar: '/keluar <nominal> <keterangan>',
  out: '/out <nominal> <keterangan>',
  masuk: '/masuk <nominal> <keterangan>',
  in: '/in <nominal> <keterangan>',
  gaji: '/gaji <nominal> <keterangan>',
  rekap: '/rekap [jumlah hari]',
  cari: '/cari <kata kunci>',
  search: '/search <kata kunci>',
  remind: '/remind <menit> <pesan>',
  salah: '/salah <koreksi>',
  hapusuang: '/hapusuang <nomor>',
};

/** Perintah bantuan — semuanya memicu daftar fitur yang sama. */
export const PERINTAH_BANTUAN = new Set([
  'help',
  'bantuan',
  'menu',
  'fitur',
  'panduan',
  'tutorial',
]);

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
