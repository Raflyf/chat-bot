/**
 * Benih awal memori tebak-tebakan.
 *
 * PENTING — INI BUKAN SUMBER UTAMA:
 * Sebelumnya berkas ini adalah bank tebak-tebakan yang dibaca langsung oleh
 * prompt. Itu salah pendekatan: isinya tetap, tidak tumbuh, dan setiap
 * penambahan butuh deploy ulang. Pemilik produk meminta bot mencari sendiri
 * dari internet lalu menyimpannya ke memori:
 *
 *   "cari dari internet secara langsung oleh AI nya lalu simpan di memori...
 *    jadi nanti jika ada yg minta tebak tebakan maka ambil nya dari memori
 *    bot nya, bukan dari promt hardcode, jadi lebih dinamis dan beragam"
 *
 * Jadi peran berkas ini sekarang hanya BOOTSTRAP: sekali dijalankan, isinya
 * disalin ke memori bot (tabel web_knowledge, awalan `mem_riddle_`). Setelah itu
 * seluruh pembacaan lewat memori, dan memori tumbuh sendiri dari pencarian
 * internet — lihat src/bot_growth.ts.
 *
 * Kenapa benih perlu: kalau memori kosong DAN internet sedang tidak bisa
 * diakses, bot harus tetap bisa melempar tebak-tebakan. Tanpa benih, pengguna
 * akan mendapat balasan kosong di kondisi itu.
 *
 * Menambah isi di sini TIDAK menambah variasi jangka panjang — variasi datang
 * dari pertumbuhan memori. Jadi jangan tergoda menambah ratusan entri di sini.
 */

export interface SeedRiddle {
  q: string;
  a: string;
  why: string;
  cat: string;
}

/**
 * Benih secukupnya untuk kondisi darurat (memori kosong + internet mati).
 * Jangan dijadikan tempat menyimpan koleksi besar; itu tugas memori.
 */
export const RIDDLE_SEED: SeedRiddle[] = [
  { q: 'Ikan apa yang suka berhenti?', a: 'Ikan pause', why: 'plesetan dari "pause" yang artinya berhenti', cat: 'hewan' },
  { q: 'Hewan apa yang jago nyanyi?', a: 'Singa', why: 'dari kata "sing" yang artinya menyanyi', cat: 'hewan' },
  { q: 'Ular apa yang selalu sehat?', a: 'Ularaga', why: 'plesetan dari kata "olahraga"', cat: 'hewan' },
  { q: 'Ayam apa yang paling besar?', a: 'Ayam semesta', why: 'plesetan dari "alam semesta"', cat: 'hewan' },
  { q: 'Gajah apa yang belalainya pendek?', a: 'Gajah pesek', why: 'plesetan dari hidung pesek', cat: 'hewan' },
  { q: 'Kucing apa yang kuno?', a: 'Kucinggalan zaman', why: 'plesetan dari "ketinggalan zaman"', cat: 'hewan' },
  { q: 'Sayur apa yang pintar nyanyi?', a: 'Kolplay', why: 'plesetan dari nama band Coldplay', cat: 'makanan' },
  { q: 'Daun apa yang tak pernah gugur?', a: 'Daun telinga', why: 'daun telinga memang tidak pernah gugur', cat: 'benda' },
  { q: 'Apa yang dibuka jadi tenda, ditutup jadi tongkat?', a: 'Payung', why: 'payung dibuka seperti tenda, ditutup seperti tongkat', cat: 'benda' },
  { q: 'Olahraga apa yang paling berat di dunia?', a: 'Catur', why: 'di catur, kuda dan benteng diangkat-angkat', cat: 'logika' },
  { q: 'Kalau ada 5 burung di pohon lalu ditembak satu, berapa yang tersisa?', a: 'Nggak ada', why: 'semuanya terbang karena kaget', cat: 'logika' },
  { q: 'Orang apa yang kalau renang tidak basah rambutnya?', a: 'Orang botak', why: 'botak tidak punya rambut', cat: 'logika' },
  { q: 'Panda apa yang bikin kamu senang?', a: 'Pandangan kamu setiap hari', why: 'plesetan dari "panda" jadi "pandangan"', cat: 'kata' },
  { q: 'Penyanyi luar negeri yang hobi bersepeda?', a: 'Selena Gowes', why: 'plesetan dari Selena Gomez jadi gowes', cat: 'kata' },
  { q: 'Burung apa yang suka ke WC?', a: 'Burung pipit', why: 'plesetan dari "pipit" jadi "pipis"', cat: 'kata' },
];

/** Benih gombalan, dipakai dengan cara yang sama seperti benih tebak-tebakan. */
export const GOMBAL_SEED: SeedRiddle[] = [
  { q: 'Kamu tahu nggak bedanya kamu sama matahari?', a: 'Matahari bikin panas, kamu bikin nyaman', why: 'perbandingan manis, bukan teka-teki', cat: 'umum' },
  { q: 'Kamu tahu nggak bedanya kamu sama kopi?', a: 'Kopi bikin melek, kamu bikin nggak bisa tidur', why: 'perbandingan manis', cat: 'umum' },
  { q: 'Kamu tahu nggak bedanya kamu sama wifi?', a: 'Wifi kencang bikin senang, kamu bikin lupa waktu', why: 'perbandingan manis', cat: 'umum' },
  { q: 'Kamu tahu nggak bedanya kamu sama hujan?', a: 'Hujan bikin basah, kamu bikin baper', why: 'perbandingan manis', cat: 'umum' },
  { q: 'Kamu tahu nggak bedanya kamu sama kunci?', a: 'Kunci buat pintu, kamu buat hatiku', why: 'perbandingan manis', cat: 'umum' },
];
