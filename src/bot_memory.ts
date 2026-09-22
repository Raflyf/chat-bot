/**
 * Memori bot yang tumbuh sendiri.
 *
 * KENAPA MODUL INI ADA:
 * Sebelumnya tebak-tebakan (dan gombalan) disimpan sebagai konstanta di kode.
 * Itu salah pendekatan: isinya tetap, tidak bisa tumbuh, dan setiap penambahan
 * butuh deploy ulang. Pemilik produk meminta sebaliknya:
 *
 *   "cari dari internet secara langsung oleh AI nya lalu simpan di memori jika
 *    menemukan banyak tebak tebakannya, nah jadi nanti jika ada yg minta tebak
 *    tebakan maka ambil nya dari memori bot nya, bukan dari promt hardcode"
 *
 *   "jangan hanya di tebak tebakan saja, contoh nya gombalan, pertanyaan yg tidak
 *    ada di pengetahuan bot, apapun itu yg bisa memvalidasi pengetahuan bot maka
 *    search dari internet, scrapping, lalu simpan di memori bot dan itu jadi modal
 *    pertumbuhan bot nya makin dipakai maka akan makin terus bertambah pintar,
 *    tapi jangan sampai bocor kedalam percakapan yg tidak ada kaitannya"
 *
 * Jadi: bot mencari sendiri, menyimpan hasilnya, lalu mengambil dari memori.
 * Makin sering dipakai, makin banyak isinya.
 *
 * PENYIMPANAN:
 * Memakai tabel `web_knowledge` yang sudah ada, dengan awalan entity_key `mem_`.
 * Alasannya: tabel itu sudah punya hit_count (untuk rotasi "paling jarang dipakai"),
 * expires_at (TTL), dan source_urls (jejak asal data). Tidak perlu tabel baru,
 * sehingga tidak perlu migrasi manual sebelum bot bisa bekerja.
 *
 * Kategori memakai 'static_fact' dengan TTL panjang: tebak-tebakan dan gombalan
 * tidak pernah basi.
 *
 * ANTI-BOCOR:
 * Memori hanya boleh masuk ke prompt ketika topiknya RELEVAN. Fungsi
 * `pickMemoryItem` dipanggil dari tempat yang sudah memastikan topiknya cocok
 * (permintaan tebak-tebakan, permintaan gombalan), bukan untuk setiap pesan.
 * Lihat `isMemoryRelevant` untuk penjaganya.
 */
import { db } from './db.js';
import { sanitizeKnowledgeText } from './knowledge.js';

/** Jenis memori yang dikelola. Tambah di sini bila ada jenis baru. */
export type MemoryKind = 'riddle' | 'gombal' | 'fact';

export interface MemoryItem {
  /** Pertanyaan / pembuka (untuk riddle & gombal), atau judul topik (untuk fact). */
  question: string;
  /** Jawaban / punchline (untuk riddle & gombal), atau isi fakta (untuk fact). */
  answer: string;
  /** Alasan singkat kenapa jawabannya begitu. Dipakai saat pengguna menyerah. */
  explanation?: string;
  /** Kategori bebas: hewan, makanan, benda, logika, kata, umum. */
  category?: string;
  /** URL sumber tempat item ini ditemukan. */
  sourceUrl?: string;
  /** Berapa kali item ini sudah dipakai. Dipakai untuk rotasi adil. */
  hitCount?: number;
}

/** Awalan entity_key untuk memori bot. Dipakai untuk memisahkan dari knowledge biasa. */
const MEM_PREFIX = 'mem_';

/** TTL memori: 365 hari. Tebak-tebakan dan gombalan tidak pernah basi. */
const MEMORY_TTL_SECONDS = 365 * 24 * 60 * 60;

/**
 * Ubah teks menjadi slug yang aman untuk entity_key.
 * Hanya huruf kecil, angka, dan garis bawah. Maksimum 48 karakter.
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9\s]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .join('_')
    .slice(0, 48);
}

/** Kunci unik untuk satu item memori. Diturunkan dari jawaban supaya tidak duplikat. */
export function memoryKey(kind: MemoryKind, item: MemoryItem): string {
  const base = slugify(item.answer || item.question);
  return `${MEM_PREFIX}${kind}_${base}`.slice(0, 96);
}

/**
 * Simpan satu item ke memori. Idempoten: item yang sama tidak tersimpan dua kali
 * (upsert berdasarkan entity_key).
 *
 * Mengembalikan true bila tersimpan, false bila dilewati (tidak valid / DB mati).
 */
export async function saveMemoryItem(kind: MemoryKind, item: MemoryItem): Promise<boolean> {
  const question = sanitizeKnowledgeText(item.question || '').trim();
  const answer = sanitizeKnowledgeText(item.answer || '').trim();
  if (question.length < 8 || answer.length < 2) return false;

  // Buang pasangan yang jelas bukan tanya-jawab (mis. potongan kalimat artikel).
  if (!question.includes('?') && kind !== 'fact') return false;

  const c = db();
  if (!c) return false;

  const entityKey = memoryKey(kind, { ...item, question, answer });
  const now = Date.now();

  try {
    // Cek dulu apakah sudah ada, supaya hit_count tidak ter-reset saat upsert ulang.
    const { data: existing } = await c
      .from('web_knowledge')
      .select('entity_key')
      .eq('entity_key', entityKey)
      .maybeSingle();

    if (existing) return false; // sudah ada, tidak perlu ditulis ulang

    const { error } = await c.from('web_knowledge').upsert(
      {
        entity_key: entityKey,
        category: 'static_fact',
        query_sample: `${kind}: ${question}`.slice(0, 250),
        // Isi disimpan sebagai JSON supaya question/answer/explanation tidak
        // tercampur saat dibaca kembali.
        knowledge: JSON.stringify({
          kind,
          question,
          answer,
          explanation: (item.explanation || '').slice(0, 400),
          category: (item.category || 'umum').slice(0, 40),
        }),
        source_urls: item.sourceUrl ? [item.sourceUrl.slice(0, 500)] : [],
        expires_at: new Date(now + MEMORY_TTL_SECONDS * 1000).toISOString(),
        updated_at: new Date(now).toISOString(),
      },
      { onConflict: 'entity_key' },
    );

    if (error) {
      console.warn(`[bot_memory] Gagal simpan ${kind}: ${error.message}`);
      return false;
    }
    return true;
  } catch (err) {
    console.warn(`[bot_memory] Gagal simpan ${kind}:`, (err as Error).message);
    return false;
  }
}

/** Simpan banyak item sekaligus. Mengembalikan jumlah yang benar-benar tersimpan. */
export async function saveMemoryItems(kind: MemoryKind, items: MemoryItem[]): Promise<number> {
  let saved = 0;
  for (const item of items) {
    if (await saveMemoryItem(kind, item)) saved++;
  }
  return saved;
}

/**
 * Ambil item dari memori, diprioritaskan yang paling jarang dipakai.
 *
 * Rotasi memakai hit_count (bukan urutan acak) supaya semua item terpakai
 * bergiliran, dan yang baru masuk (hit_count 0) langsung dapat kesempatan.
 * Beberapa kandidat diambil lalu dipilih acak di antara mereka, supaya urutannya
 * tidak selalu sama walau hit_count-nya seri.
 */
export async function pickMemoryItem(
  kind: MemoryKind,
  opts: {
    /** Jangan pilih item dengan jawaban yang sudah dipakai di percakapan ini. */
    excludeAnswers?: string[];
    /** Utamakan kategori tertentu bila ada. */
    category?: string;
    /** Sumber acak, bisa diganti saat pengujian. */
    random?: () => number;
  } = {},
): Promise<(MemoryItem & { key: string }) | null> {
  const c = db();
  if (!c) return null;

  const rnd = opts.random ?? Math.random;
  const exclude = new Set((opts.excludeAnswers ?? []).map((a) => a.toLowerCase().trim()));

  try {
    // Ambil kandidat terbanyak-dulu 40, urut dari yang paling jarang dipakai.
    const { data, error } = await c
      .from('web_knowledge')
      .select('entity_key, knowledge, hit_count, source_urls')
      .like('entity_key', `${MEM_PREFIX}${kind}_%`)
      .gt('expires_at', new Date().toISOString())
      .order('hit_count', { ascending: true })
      .order('updated_at', { ascending: true })
      .limit(40);

    if (error) {
      console.warn(`[bot_memory] Gagal baca ${kind}: ${error.message}`);
      return null;
    }
    if (!data || data.length === 0) return null;

    // Parse dan saring.
    const parsed: Array<MemoryItem & { key: string }> = [];
    for (const row of data) {
      try {
        const obj = JSON.parse(row.knowledge as string);
        if (!obj?.question || !obj?.answer) continue;
        if (exclude.has(String(obj.answer).toLowerCase().trim())) continue;
        parsed.push({
          key: row.entity_key as string,
          question: obj.question,
          answer: obj.answer,
          explanation: obj.explanation || '',
          category: obj.category || 'umum',
          sourceUrl: Array.isArray(row.source_urls) ? row.source_urls[0] : undefined,
          // Dipakai untuk rotasi adil: pilih yang paling jarang dipakai.
          hitCount: Number(row.hit_count) || 0,
        });
      } catch {
        // Bukan format memori (mungkin knowledge biasa) — lewati.
        continue;
      }
    }
    if (parsed.length === 0) return null;

    // Utamakan kategori yang diminta bila ada isinya.
    let pool = parsed;
    if (opts.category) {
      const byCat = parsed.filter((p) => (p.category || '').toLowerCase() === opts.category!.toLowerCase());
      if (byCat.length > 0) pool = byCat;
    }

    // Rotasi adil: ambil SEMUA item dengan pemakaian terendah, acak dari kelompok
    // itu. Sebelumnya hanya 5 teratas yang diacak, dan karena semua item baru punya
    // hit_count 0, urutannya selalu sama — akibatnya hanya 5 tebak-tebakan yang
    // pernah muncul dari 91 yang tersimpan. Sekarang seluruh kelompok pemakaian
    // terendah dapat kesempatan sebelum ada yang terpakai dua kali.
    const counts = parsed.map((p) => p.hitCount ?? 0);
    const minCount = Math.min(...counts);
    let lowest = pool.filter((p) => (p.hitCount ?? 0) === minCount);

    // Kalau kelompok terendah terlalu kecil, tambah dari tingkat berikutnya supaya
    // variasi tetap ada walau stoknya menipis.
    if (lowest.length < 5) {
      const rest = pool
        .filter((p) => (p.hitCount ?? 0) > minCount)
        .sort((a, b) => (a.hitCount ?? 0) - (b.hitCount ?? 0));
      lowest = lowest.concat(rest.slice(0, 5 - lowest.length));
    }
    if (lowest.length === 0) lowest = pool;

    return lowest[Math.floor(rnd() * lowest.length)];
  } catch (err) {
    console.warn(`[bot_memory] Gagal baca ${kind}:`, (err as Error).message);
    return null;
  }
}

/**
 * Tandai item sudah dipakai (naikkan hit_count).
 * Dipanggil setelah item benar-benar dilempar ke pengguna, bukan saat diambil,
 * supaya pengambilan yang gagal tidak ikut terhitung.
 */
export async function markMemoryUsed(key: string): Promise<void> {
  const c = db();
  if (!c) return;
  try {
    await c.rpc('increment_knowledge_hit', { p_entity_key: key, p_key: key });
  } catch {
    // Hitungan bukan hal kritis; jangan ganggu alur utama.
  }
}

/** Berapa banyak item tersimpan per jenis. Dipakai untuk laporan dan pengujian. */
export async function countMemory(kind?: MemoryKind): Promise<Record<string, number>> {
  const c = db();
  if (!c) return {};
  try {
    const pattern = kind ? `${MEM_PREFIX}${kind}_%` : `${MEM_PREFIX}%`;
    const { data, error } = await c
      .from('web_knowledge')
      .select('entity_key')
      .like('entity_key', pattern)
      .limit(5000);
    if (error || !data) return {};

    const counts: Record<string, number> = {};
    for (const row of data) {
      const k = String(row.entity_key);
      const m = k.match(/^mem_([a-z]+)_/);
      const name = m ? m[1] : 'lainnya';
      counts[name] = (counts[name] || 0) + 1;
    }
    return counts;
  } catch {
    return {};
  }
}

/**
 * Penjaga anti-bocor: apakah memori jenis ini relevan untuk pesan pengguna?
 *
 * Ini yang mencegah memori masuk ke percakapan yang tidak berkaitan. Contoh:
 * tebak-tebakan TIDAK boleh disuntikkan saat pengguna sedang tanya cuaca atau
 * sedang cerita masalah pribadi.
 *
 * Dipakai sebelum memanggil pickMemoryItem, dan diuji di verify_v74.
 */
export function isMemoryRelevant(kind: MemoryKind, userText: string): boolean {
  const t = (userText || '').toLowerCase();

  if (kind === 'riddle') {
    // Hanya saat pengguna meminta tebak-tebakan / teka-teki.
    return /\b(?:tebak(?:an|[\s-]*tebakan)?|teka[\s-]*teki|kuis|riddle|nebak)\b/i.test(t);
  }

  if (kind === 'gombal') {
    // Hanya saat pengguna meminta gombalan / rayuan.
    return /\b(?:gombal(?:an|in)?|rayu(?:an)?|ngerayu|kata[\s-]*kata[\s-]*manis|flirt)\b/i.test(t);
  }

  if (kind === 'fact') {
    // Fakta umum: hanya saat pengguna bertanya sesuatu (ada tanda tanya atau
    // kata tanya). Percakapan biasa tidak memicu pencarian fakta.
    return (
      /\?/.test(t) &&
      /\b(?:apa|siapa|kapan|dimana|di[\s-]*mana|kenapa|mengapa|bagaimana|gimana|berapa|apakah)\b/i.test(t)
    );
  }

  return false;
}

/**
 * Ekstrak pasangan tanya-jawab dari teks hasil scraping.
 *
 * Format teks web bermacam-macam, jadi parser ini toleran:
 *   "Ikan apa yang suka berhenti? Jawaban: Ikan pause"
 *   "**Hewan apa yang bisa kaya?**\nJawab: Hewan to be millionaire"
 *   "- Kutu apa yang menakutkan?\n  Jawaban: Kutukan"
 *
 * Yang penting: pertanyaan diakhiri tanda tanya, dan jawaban ditandai kata
 * "jawaban"/"jawab". Pemisah boleh baris baru, titik, atau spasi.
 *
 * Dipakai untuk menumbuhkan memori dari hasil pencarian internet.
 */
export function extractQAFromText(text: string, limit = 60): MemoryItem[] {
  if (!text || typeof text !== 'string') return [];

  const clean = sanitizeKnowledgeText(text);
  const out: MemoryItem[] = [];
  const seen = new Set<string>();

  // Pola: <pertanyaan?> ... (jawaban|jawab) : <jawaban>
  //
  // ATURAN KETAT (perbaikan v0.74b — parser longgar menghasilkan data sampah):
  // - Pertanyaan WAJIB satu baris (tidak boleh lintas baris). Kalau lintas baris,
  //   yang tertangkap adalah potongan kalimat dari tengah artikel ("na yang paling
  //   pintar di Indonesia?").
  // - Jawaban WAJIB satu baris dan TIDAK boleh memuat tanda tanya. Kalau boleh,
  //   jawaban menyerap pertanyaan berikutnya jadi satu string panjang:
  //   "Pernah lihat kelinci pakai kacamata? 2. Kenapa di keyboard komputer...".
  // - Jawaban tidak boleh memuat penomoran baru ("2." / "3)") — itu tanda sudah
  //   masuk entri berikutnya.
  // - Awal pertanyaan boleh diawali nomor daftar ("1." / "-" / "*") yang dibuang.
  // Tanda pemisah antara "?" dan label jawaban boleh baris baru atau spasi:
  //   "Ikan apa yang suka berhenti? Jawaban: Ikan pause"        (satu baris)
  //   "Tivi apa yang bisa berenang?\n  Jawaban: Tivikir..."      (beda baris)
  // Tapi JAWABAN-nya wajib satu baris (`[^?\n]`), supaya tidak menyerap
  // pertanyaan berikutnya. Ini kunci kualitasnya.
  const re =
    /(?:^|\n)[ \t]*(?:\d{1,3}[.)]\s*|[-*•]\s*)?([^?\n]{10,180}?)\s*\?[\s*_>-]{0,12}(?:jawaban|jawab|a)\s*[:\-–]\s*\*{0,2}([^?\n]{2,150})/gim;

  let m: RegExpExecArray | null;
  while ((m = re.exec(clean)) !== null && out.length < limit) {
    // Tanda tanya ditambahkan kembali: regex menangkap grup SEBELUM "?", jadi
    // tanpa ini pertanyaan tersimpan tanpa tanda tanya dan terbaca seperti
    // pernyataan, bukan pertanyaan.
    const question = m[1].replace(/[*_>`#]/g, '').replace(/^\s*[-*•]\s*/, '').trim() + '?';
    let answer = m[2].replace(/[*_>`#]/g, '').trim().replace(/[.\s]+$/, '');

    if (!question || answer.length < 2) continue;

    // Buang jawaban yang jelas menyerap entri berikutnya.
    if (/\b\d{1,3}[.)]\s/.test(answer)) continue;          // ada nomor baru
    if (/\b(?:jawaban|jawab)\s*[:\-–]/i.test(answer)) continue; // ada label jawaban lagi
    if (/\b(?:tebak|teka)[-\s]?teki\b/i.test(answer)) continue;  // mulai artikel baru
    if (answer.split(/\s+/).length > 22) continue;           // terlalu panjang
    if (question.split(/\s+/).length > 26) continue;         // pertanyaan terlalu panjang
    // Pertanyaan harus berupa kalimat tanya yang masuk akal (ada kata tanya).
    if (!/\b(?:apa|siapa|kapan|dimana|di\s*mana|kenapa|mengapa|bagaimana|berapa|apakah|bisakah|bolehkah|mana|yang)\b/i.test(question)) continue;
    // Buang pertanyaan yang TERPOTONG di tengah kata.
    //
    // BUG YANG DIPERBAIKI (temuan audit v0.79, direproduksi): versi sebelumnya memakai
    // `/^[a-z]{1,4}\s/` yang membuang SEMUA pertanyaan yang dimulai kata huruf kecil
    // pendek. Padahal kata tanya Indonesia yang PALING UMUM justru pendek: "apa", "ikan",
    // "kutu", "kota". Terbukti 3 dari 6 sampel hilang:
    //   "ikan apa yang suka berhenti? Jawaban: Ikan pause"  -> DIBUANG (padahal valid)
    //   "apa yang paling manis di dunia? ..."               -> DIBUANG (padahal valid)
    //   "kutu apa yang menakutkan? Jawab: Kutukan"          -> DIBUANG (padahal valid)
    // Banyak halaman web menulis daftar tebak-tebakan dengan huruf kecil, jadi ini
    // memangkas hasil panen growMemory secara besar.
    // Perbaikan: deteksi potongan kata yang SEBENARNYA, yaitu huruf kecil menempel tanpa
    // spasi ke huruf kapital (mis. "na yang paling pintar" -> "naYang"? tidak; pola nyata
    // adalah awal kata terpotong seperti "ngan apa"). Kriteria baru: buang hanya bila
    // token pertama BUKAN kata yang berdiri sendiri — dicek dengan kamus kata tanya &
    // awalan umum, bukan panjang karakter.
    const firstToken = question.split(/\s+/)[0].toLowerCase();
    const validOpeners = /^(?:apa|apakah|siapa|kapan|dimana|kenapa|mengapa|bagaimana|berapa|mana|yang|ikan|kutu|kota|hewan|buah|benda|orang|binatang|sayur|warna|angka|huruf|pohon|makanan|minuman|profesi|tempat|kata|apa|apa|di|ke|dari|kalau|jika|bila|mas|mbak|pak|bu|adik|kakak)$/;
    const looksTruncated = /^[a-z]{1,3}$/.test(firstToken) && !validOpeners.test(firstToken);
    if (looksTruncated) continue;

    const norm = answer.toLowerCase().trim();
    if (seen.has(norm)) continue;
    seen.add(norm);

    out.push({ question, answer });
  }

  return out;
}

/**
 * Klasifikasi kategori sederhana dari pertanyaan, supaya bisa dipilih sesuai topik.
 */
export function guessCategory(question: string): string {
  const q = question.toLowerCase();
  if (/\b(?:hewan|binatang|ikan|burung|ayam|kucing|anjing|gajah|kuda|ular|kutu|bebek|sapi|kambing|semut|lebah|nyamuk)\b/.test(q)) return 'hewan';
  if (/\b(?:makanan|sayur|buah|nasi|roti|soto|bakso|kue|minuman|es|kopi|teh|sambal|goreng)\b/.test(q)) return 'makanan';
  if (/\b(?:benda|barang|alat|lemari|kursi|meja|pintu|payung|jam|buku|pensil)\b/.test(q)) return 'benda';
  if (/\b(?:kenapa|mengapa|berapa|kalau|jika|logika|hitung)\b/.test(q)) return 'logika';
  return 'kata';
}
