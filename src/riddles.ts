/**
 * Bank tebak-tebakan asli Indonesia.
 *
 * KENAPA BERKAS INI ADA:
 * Sebelumnya prompt menyuruh model "mengarang setup tebakan orisinal". Hasilnya
 * tebak-tebakan palsu yang tidak nyambung antara pertanyaan dan jawaban, dan bot
 * sampai mengakui sendiri teka-tekinya "agak maksa". Bukti produksi 21 Sep 20:00:
 *
 *   Bot : "Hewan apa yang kalau diinjak malah jadi lebih tinggi?"
 *   User: "kaki seribu?"  -> "Meleset jauh"
 *   User: "nyerahh"       -> "Jawabannya gajah... tapi ini teka-teki yang agak
 *                            maksa sih"
 *
 * Jawaban "gajah" untuk "kalau diinjak jadi lebih tinggi" tidak masuk akal, dan
 * modelnya sendiri tahu itu. Model bahasa memang lemah membuat teka-teki baru:
 * humornya bergantung pada plesetan kata yang spesifik, dan model cenderung
 * menghasilkan kalimat yang terdengar seperti teka-teki tapi tidak punya punchline.
 *
 * Solusinya: tebak-tebakan diambil dari bank ini, bukan dikarang. Semuanya
 * tebak-tebakan yang sudah beredar luas di Indonesia, dengan jawaban yang
 * benar-benar nyambung (biasanya plesetan kata).
 *
 * Sumber kumpulan (diakses 21 Sep 2026):
 * - gramedia.com/best-seller/tebak-tebakan-receh
 * - orami.co.id/magazine/tebak-tebakan-hewan
 * - wolipop.detik.com/entertainment-news/d-8063943
 * - inilah.com/kumpulan-tebak-tebakan-lucu-dan-receh
 *
 * ATURAN MENAMBAH ENTRI:
 * 1. Harus tebak-tebakan yang benar-benar beredar, bukan karangan.
 * 2. Jawaban harus NYAMBUNG dengan pertanyaannya (biasanya plesetan kata).
 * 3. Jangan tambahkan yang jawabannya butuh pengetahuan sangat khusus.
 * 4. Pastikan belum ada duplikat (dicek otomatis oleh verify_v73).
 */

export interface Riddle {
  /** Pertanyaan yang dilempar ke pengguna. */
  q: string;
  /** Jawaban benar. Dipakai untuk menilai tebakan dan dibocorkan saat menyerah. */
  a: string;
  /** Penjelasan singkat kenapa jawabannya begitu. Dipakai saat pengguna menyerah. */
  why: string;
  /** Kategori, dipakai untuk memilih riddle yang cocok dengan topik obrolan. */
  cat: 'hewan' | 'makanan' | 'benda' | 'logika' | 'kata';
}

export const RIDDLE_BANK: Riddle[] = [
  // ---- Hewan ----
  { q: 'Ikan apa yang suka berhenti?', a: 'Ikan pause', why: 'plesetan dari "pause" yang artinya berhenti', cat: 'hewan' },
  { q: 'Hewan apa yang bisa kaya?', a: 'Hewan to be millionaire', why: 'plesetan dari lagu "to be a millionaire"', cat: 'hewan' },
  { q: 'Kutu apa yang menakutkan?', a: 'Kutukan', why: 'plesetan dari kata "kutukan"', cat: 'hewan' },
  { q: 'Hewan apa yang jago nyanyi?', a: 'Singa', why: 'dari kata "sing" yang artinya menyanyi', cat: 'hewan' },
  { q: 'Ikan apa yang bisa terbang?', a: 'Ikan lelelawar', why: 'gabungan "lele" dan "kelelawar"', cat: 'hewan' },
  { q: 'Hewan apa yang suka kebersihan?', a: 'Gajah', why: 'dari kalimat "gajahlah kebersihan" alias jagalah kebersihan', cat: 'hewan' },
  { q: 'Burung apa yang ditakuti pengendara motor?', a: 'Kutilang', why: 'plesetan dari "kutilang kau Rp50 ribu"', cat: 'hewan' },
  { q: 'Ular apa yang selalu sehat?', a: 'Ularaga', why: 'plesetan dari kata "olahraga"', cat: 'hewan' },
  { q: 'Ayam apa yang paling besar?', a: 'Ayam semesta', why: 'plesetan dari "alam semesta"', cat: 'hewan' },
  { q: 'Binatang apa yang paling malas?', a: 'Lembu', why: 'disuruh apa pun jawabnya cuma "mooo"', cat: 'hewan' },
  { q: 'Gajah apa yang belalainya pendek?', a: 'Gajah pesek', why: 'plesetan dari "gajah pesek" alias hidung pesek', cat: 'hewan' },
  { q: 'Kucing apa yang kuno?', a: 'Kucinggalan zaman', why: 'plesetan dari "ketinggalan zaman"', cat: 'hewan' },
  { q: 'Ikan apa yang lucu?', a: 'Ikan piranhahaha', why: 'plesetan dari "piranha" ditambah tawa', cat: 'hewan' },
  { q: 'Burung apa yang bisa nolak?', a: 'Burung gak-gak', why: 'dari kata "gak" yang artinya menolak', cat: 'hewan' },
  { q: 'Hewan apa yang selalu santai?', a: 'Ayam', why: 'dari "adem ayam" alias adem', cat: 'hewan' },
  { q: 'Hewan apa yang sangat patuh lalu lintas?', a: 'Unta', why: 'dari "untamakan keselamatan" alias utamakan keselamatan', cat: 'hewan' },
  { q: 'Hewan apa yang penting buat urat nadi?', a: 'Ulat', why: 'dari "ulat nadi" alias urat nadi', cat: 'hewan' },
  { q: 'Hewan apa yang mencari bapaknya terus?', a: 'Kambing', why: 'dari suara "mbeee" yang terdengar seperti memanggil', cat: 'hewan' },
  { q: 'Kuda apa yang bikin capek?', a: 'Kudaki gunung', why: 'plesetan dari "mendaki gunung"', cat: 'hewan' },
  { q: 'Lele apa yang ada di tepi jalan?', a: 'Lelepon umum', why: 'plesetan dari "telepon umum"', cat: 'hewan' },

  // ---- Makanan ----
  { q: 'Sayur apa yang pintar nyanyi?', a: 'Kolplay', why: 'plesetan dari nama band "Coldplay"', cat: 'makanan' },
  { q: 'Sayur apa yang punya pangkat?', a: 'Sayur mayor', why: 'plesetan dari "saya mayor"', cat: 'makanan' },
  { q: 'Makanan apa yang kelebihan berat badan?', a: 'Tahu gembrot', why: 'plesetan dari "tahu gembrot" alias tahu yang gemuk', cat: 'makanan' },
  { q: 'Makanan apa yang sok tahu?', a: 'Soto', why: 'dari kalimat "Ah, soto lu!" alias sok tahu lu', cat: 'makanan' },
  { q: 'Sabun apa yang paling bau?', a: 'Sabuntar-sabuntar kamu kentut', why: 'plesetan dari "sabun" dan "sebentar"', cat: 'makanan' },
  { q: 'Ban apa yang paling enak disantap?', a: 'Bandeng', why: 'plesetan dari kata "ban" jadi "bandeng"', cat: 'makanan' },
  { q: 'Ayam apa yang bikin kangen?', a: 'Ayam miss you so much', why: 'plesetan dari kalimat "I miss you so much"', cat: 'makanan' },

  // ---- Benda ----
  { q: 'Daun apa yang tak pernah gugur?', a: 'Daun telinga', why: 'daun telinga memang tidak pernah gugur', cat: 'benda' },
  { q: 'Apa yang dibuka jadi tenda, ditutup jadi tongkat?', a: 'Payung', why: 'payung dibuka lebar seperti tenda, ditutup memanjang seperti tongkat', cat: 'benda' },
  { q: 'Aku hanya berjalan kalau badanku penuh, kalau kosong tak bisa dipakai. Siapakah aku?', a: 'Congklak', why: 'congklak baru bisa dimainkan kalau lubangnya sudah diisi biji', cat: 'benda' },
  { q: 'Kalau sendiri kakinya empat, kalau berdua kakinya delapan. Siapakah aku?', a: 'Kursi', why: 'satu kursi empat kaki, dua kursi delapan kaki', cat: 'benda' },
  { q: 'Lemari apa yang bisa masuk kantong?', a: 'Lema-ribuan', why: 'plesetan dari "lemari" jadi "lema-ribuan"', cat: 'benda' },
  { q: 'Apa yang ada di ujung langit?', a: 'Huruf T', why: 'kata "langit" diakhiri huruf T', cat: 'benda' },

  // ---- Logika ----
  { q: 'Olahraga apa yang paling berat di dunia?', a: 'Catur', why: 'di catur, kuda dan benteng diangkat-angkat', cat: 'logika' },
  { q: 'Kalau ada 5 burung di pohon lalu ditembak satu, berapa yang tersisa?', a: 'Nggak ada', why: 'semuanya terbang karena kaget', cat: 'logika' },
  { q: 'Orang apa yang kalau renang tidak basah rambutnya?', a: 'Orang botak', why: 'botak tidak punya rambut', cat: 'logika' },
  { q: 'Siapa orang terkuat di dunia?', a: 'Pemain catur', why: 'dia bisa mengangkat benteng dan kuda sekaligus', cat: 'logika' },
  { q: 'Apa persamaan air panas dengan orang mengantuk?', a: 'Sama-sama menguap', why: 'air panas menguap, orang mengantuk menguap', cat: 'logika' },
  { q: 'Kenapa telur ayam takut sama telur puyuh?', a: 'Karena telur puyuh banyak tatonya', why: 'plesetan dari tato di kulit', cat: 'logika' },
  { q: 'Kenapa air laut asin?', a: 'Karena ikannya pada berkeringat', why: 'candaan bahwa ikan berolahraga di laut', cat: 'logika' },

  // ---- Kata / plesetan ----
  { q: 'Panda apa yang bikin kamu senang?', a: 'Pandangan kamu setiap hari', why: 'plesetan dari "panda" jadi "pandangan"', cat: 'kata' },
  { q: 'Penyanyi luar negeri yang hobi bersepeda?', a: 'Selena Gowes', why: 'plesetan dari "Selena Gomez" jadi "gowes"', cat: 'kata' },
  { q: 'Apa bedanya kacang panjang dengan celana panjang?', a: 'Kacang panjang dipotong tetap kacang panjang, celana panjang dipotong jadi celana pendek', why: 'celana berubah nama saat dipotong, kacang tidak', cat: 'kata' },
  { q: 'Hewan apa yang punya banyak keahlian?', a: 'Kukang', why: 'dari "kukang" yang terdengar seperti "aku kang" untuk banyak profesi', cat: 'kata' },
  { q: 'Bunga apa yang tumbuh bukan di tanah dan banyak di bawah meja?', a: 'Bunga hidung', why: 'plesetan dari "bunga" jadi upil', cat: 'kata' },
  { q: 'Ikan apa yang nggak sabaran?', a: 'Ikan cakalang', why: 'dari kalimat "pokoknya cakalang" alias langsung saja', cat: 'kata' },
  { q: 'Burung apa yang suka ke WC?', a: 'Burung pipit', why: 'plesetan dari "pipit" jadi "pipis"', cat: 'kata' },
];

/**
 * Pilih tebak-tebakan acak, hindari yang sudah pernah dipakai di percakapan.
 * Pemilihan acak di kode (bukan diserahkan ke model) supaya tidak berulang dan
 * tidak bergantung pada kreativitas model.
 */
export function pickRiddle(opts: {
  /** Jawaban benar yang sudah dipakai sebelumnya di percakapan ini. */
  usedAnswers?: string[];
  /** Kata kunci topik dari pesan pengguna, dipakai untuk memilih kategori. */
  topicHint?: string;
  /** Sumber acak yang bisa diganti saat pengujian. */
  random?: () => number;
}): Riddle {
  const rnd = opts.random ?? Math.random;
  const used = new Set((opts.usedAnswers ?? []).map((a) => a.toLowerCase().trim()));

  // Utamakan yang belum pernah dipakai; kalau semua sudah, pakai seluruh bank.
  let pool = RIDDLE_BANK.filter((r) => !used.has(r.a.toLowerCase()));
  if (pool.length === 0) pool = RIDDLE_BANK.slice();

  // Kalau topik obrolan menyebut kategori tertentu, utamakan kategori itu.
  const hint = (opts.topicHint ?? '').toLowerCase();
  if (hint) {
    const byCat = pool.filter((r) => hint.includes(r.cat));
    if (byCat.length > 0) pool = byCat;
  }

  return pool[Math.floor(rnd() * pool.length)];
}

/** Cari riddle di bank berdasarkan jawabannya (untuk mencocokkan kunci jawaban). */
export function findRiddleByAnswer(answer: string): Riddle | null {
  const needle = answer.toLowerCase().trim();
  return RIDDLE_BANK.find((r) => r.a.toLowerCase().trim() === needle) ?? null;
}

/** Semua jawaban di bank, dipakai untuk mencegah duplikat saat menambah entri. */
export function allRiddleAnswers(): string[] {
  return RIDDLE_BANK.map((r) => r.a);
}

/**
 * Pertanyaan + jawaban, dipakai guard untuk memeriksa apakah setup tebakan yang
 * ditulis model cocok dengan bank atau hasil karangan sendiri.
 */
export const RIDDLE_BANK_QUESTIONS: Array<{ q: string; a: string }> = RIDDLE_BANK.map((r) => ({
  q: r.q,
  a: r.a,
}));

