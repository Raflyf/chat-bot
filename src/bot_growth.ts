/**
 * Pertumbuhan memori bot: cari dari internet, simpan ke memori.
 *
 * KENAPA MODUL INI ADA:
 * Pemilik produk meminta bot tumbuh sendiri:
 *
 *   "jangan hanya di tebak tebakan saja, contoh nya gombalan, pertanyaan yg tidak
 *    ada di pengetahuan bot, apapun itu yg bisa memvalidasi pengetahuan bot maka
 *    search dari internet, scrapping, lalu simpan di memori bot dan itu jadi modal
 *    pertumbuhan bot nya makin dipakai maka akan makin terus bertambah pintar"
 *
 * Cara kerjanya (dua tahap, dan tahap kedua itu penting):
 * 1. Cari di internet untuk mendapat DAFTAR URL sumber.
 * 2. Scrape ISI halaman dari URL itu — karena hasil pencarian hanya berisi judul
 *    dan cuplikan, sedangkan daftar tebak-tebakan ada di dalam halamannya.
 *
 * Tanpa tahap 2, parser tidak menemukan pasangan tanya-jawab: hasil pencarian
 * hanya memuat judul artikel seperti "70 Teka-Teki MPLS Makanan, Minuman...".
 * Ini bug yang ketemu saat pengujian v0.74.
 *
 * HEMAT KUOTA:
 * Pencarian hanya dilakukan bila memori benar-benar kosong atau menipis.
 *
 * ASINKRON:
 * Pertumbuhan di jalur balasan dijalankan di latar belakang (tidak di-await),
 * supaya latensi balasan tidak bertambah. Sesuai instruksi pemilik produk:
 * "jangan membuat respon bot nya jadi lama, kalo naik sedikit saja tidak apa apa".
 */
import { searchWeb, scrapeWebpage } from './web.js';
import {
  extractQAFromText,
  extractKnowledgeFromText,
  guessCategory,
  saveMemoryItems,
  pickMemoryItem,
  countMemory,
  type MemoryKind,
  type MemoryItem,
} from './bot_memory.js';

/** Kata kunci pencarian per jenis memori. Ditujukan untuk sumber berbahasa Indonesia. */
const SEARCH_QUERIES: Record<MemoryKind, string[]> = {
  riddle: [
    'kumpulan tebak tebakan lucu dan jawabannya',
    'teka teki lucu beserta jawaban bahasa indonesia',
    '100 tebak tebakan receh dan jawabannya',
    // Variasi tema supaya stok tidak monoton dan tidak mengulang tema yang sama.
    'tebak tebakan hewan dan jawabannya',
    'tebak tebakan buah sayur dan jawabannya',
    'teka teki logika sederhana dan jawaban',
  ],
  gombal: [
    'kumpulan gombalan lucu dan jawabannya',
    'tebak tebakan gombal romantis beserta jawaban',
    'gombalan baper singkat dan jawabannya',
  ],
  fact: [
    'fakta menarik dan penjelasannya',
    'fakta unik sains dan penjelasannya',
    'fakta sejarah indonesia dan penjelasannya',
  ],
  // ── JENIS BARU (permintaan pemilik produk 24 Sep 2026) ─────────────────────
  // Bot harus terus bertambah pintar seperti self-improvement, bukan hanya
  // mengandalkan tebak-tebakan. Pengetahuan yang dipakai berulang disimpan agar
  // giliran berikutnya tidak perlu mencari lagi (hemat kuota + lebih cepat).
  knowledge: [
    'penjelasan lengkap dan benar tentang',
    'panduan praktis langkah demi langkah',
    'fakta dasar yang perlu diketahui tentang',
  ],
  // Pengetahuan profesional untuk antisipasi pemakaian di perusahaan.
  professional: [
    'panduan bisnis praktis untuk pemula',
    'dasar akuntansi dan laporan keuangan',
    'prosedur kerja standar perusahaan',
    'dasar hukum bisnis di indonesia',
  ],
};

/** Kunci pertumbuhan yang sedang berjalan, supaya tidak ada pencarian ganda bersamaan. */
const growing = new Set<string>();

/**
 * Domain tepercaya per jenis memori.
 *
 * Ini "pengungkit terbesar" menurut dokumentasi xKiro, dan terbukti saat diuji:
 * tanpa filter, hasil pencarian acak (mediaindonesia, inilah, deepublish) dan
 * sebagian besar GAGAL di-scrape. Dengan filter ke domain yang terbukti berisi
 * daftar dan bisa dibaca, hasilnya 10/10 relevan.
 *
 * Domain di bawah ini sudah diuji nyata: gramedia.com menghasilkan 60 pasangan,
 * wolipop.detik.com menghasilkan 38 pasangan.
 */
const TRUSTED_DOMAINS: Record<MemoryKind, string[]> = {
  riddle: ['gramedia.com', 'detik.com', 'wolipop.detik.com'],
  gombal: ['gramedia.com', 'detik.com', 'wolipop.detik.com'],
  fact: ['kompas.com', 'detik.com', 'tempo.co'],
  // Sumber pengetahuan umum: ensiklopedia + media yang isinya bisa dibaca penuh.
  knowledge: ['wikipedia.org', 'kompas.com', 'kbbi.kemdikbud.go.id'],
  // Sumber profesional: domain resmi & media bisnis yang teksnya bisa di-scrape.
  professional: ['ojk.go.id', 'pajak.go.id', 'kemenkeu.go.id', 'cnbcindonesia.com', 'kontan.co.id'],
};

/**
 * Cari lewat xKiro /v1/search dengan filter domain.
 *
 * Keunggulan dibanding pencarian kita sendiri: hasilnya JSON terstruktur
 * (url/title/snippet/source/publishedDate), jadi URL sumber langsung bisa
 * dipakai tanpa mengurai teks, dan filter domain membuat sumbernya terarah.
 *
 * Kuota: 20 pencarian/hari per kunci (kita punya beberapa kunci). Kalau satu
 * kunci habis, kunci berikutnya dicoba. Kalau semua habis atau gagal, kembalikan
 * null supaya pemanggil memakai pencarian gratis kita sebagai cadangan.
 */
async function searchViaXKiro(query: string, domains: string[]): Promise<string[] | null> {
  const keys = (process.env.XKIRO_KEYS || '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
  if (keys.length === 0) return null;

  // Rotasi kunci supaya kuota 20/hari/kunci terpakai merata.
  const start = Math.floor(Date.now() / 60000) % keys.length;

  for (let i = 0; i < keys.length; i++) {
    const key = keys[(start + i) % keys.length];
    try {
      const res = await fetch('https://api.xkiro.com/v1/search', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'xkiro/web-search',
          query,
          max_results: 10,
          search_domain_filter: domains,
        }),
        signal: AbortSignal.timeout(12000),
      });

      // Kuota habis / kunci ditolak -> coba kunci berikutnya.
      if (res.status === 429 || res.status === 402 || res.status === 403) continue;
      if (!res.ok) continue;

      const data: any = await res.json();
      const results: any[] = Array.isArray(data?.results) ? data.results : [];
      const urls = results
        .map((r) => r?.url)
        .filter((u): u is string => typeof u === 'string' && u.startsWith('http'));

      if (urls.length > 0) {
        console.log(
          `[bot_growth] xKiro search: ${urls.length} URL terarah (kuota sisa ${data?.usage?.remainingToday ?? '?'}).`,
        );
        return urls;
      }
      return null;
    } catch {
      // Kunci ini gagal (jaringan/timeout) -> coba kunci berikutnya.
    }
  }
  return null;
}

/**
 * Baca isi halaman dengan batas lebih besar dari `scrapeWebpage`.
 *
 * Kenapa perlu fungsi sendiri: `scrapeWebpage` membatasi 6000 karakter karena
 * dipakai untuk menjawab pertanyaan pengguna (harus ringkas). Untuk pertumbuhan
 * memori, daftar tebak-tebakan ada di BAGIAN BAWAH halaman — dengan batas 6000
 * karakter, daftarnya tidak ikut terbaca dan parser menemukan nol pasangan.
 *
 * Jina Reader dipanggil langsung dengan timeout lebih longgar (4 detik) dan
 * hasilnya dipakai sampai 60.000 karakter.
 */
async function fetchPageForGrowth(url: string): Promise<string> {
  // URUTAN INI PENTING. Direct fetch dicoba LEBIH DULU, bukan scrapeWebpage.
  //
  // Alasan (temuan pengujian v0.74): `scrapeWebpage` mengembalikan hasil
  // TERPOTONG (batas 6000 karakter, dan pemanggilnya memotong lagi jadi 4000).
  // Daftar tebak-tebakan ada di BAGIAN BAWAH halaman, jadi hasil terpotong tidak
  // memuatnya — parser menemukan nol pasangan walau halamannya sebenarnya berisi
  // 41 tebak-tebakan. Direct fetch menghasilkan teks penuh (17.791 karakter pada
  // halaman uji) dan parser menemukan 38 pasangan.
  //
  // scrapeWebpage tetap dipakai sebagai cadangan untuk halaman yang butuh render
  // JavaScript (SPA), di mana direct fetch hanya menghasilkan kerangka kosong.
  const direct = await fetchDirectText(url);
  if (direct && direct.length >= 1000 && /\?/.test(direct)) return direct;

  try {
    const viaScrape = await scrapeWebpage(url);
    if (viaScrape && viaScrape.length >= 500) return viaScrape;
  } catch {
    // abaikan, kembalikan hasil direct apa adanya
  }
  return direct || '';
}

/** Ambil isi halaman langsung (tanpa perantara), dipakai untuk melengkapi hasil. */
async function fetchDirectText(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'id-ID,id;q=0.9,en;q=0.8',
      },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return '';
    const html = await res.text();
    if (!html || html.length < 300) return '';
    // Buang tag, simpan teksnya saja. Cukup untuk parser tanya-jawab.
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, '\n')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&[a-z]+;/gi, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{2,}/g, '\n')
      .trim();
    return text.slice(0, 60000);
  } catch {
    return '';
  }
}

/**
 * Ambil URL kandidat dari hasil pencarian.
 *
 * `searchWeb` mengembalikan teks berisi URL sumber (untuk halaman yang dibaca
 * mendalam). Fungsi ini mengumpulkan URL itu, disaring supaya hanya artikel
 * yang masuk akal untuk dibaca (bukan halaman beranda atau sosial media).
 */
export function extractUrlsFromSearch(searchText: string, limit = 4): string[] {
  if (!searchText) return [];

  const urls = new Set<string>();
  const re = /https?:\/\/[^\s"'<>()\]]+/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(searchText)) !== null) {
    let u = m[0].replace(/[.,;:!?]+$/, '');
    // Buang halaman yang jelas bukan artikel daftar.
    if (/\.(?:jpg|jpeg|png|gif|webp|svg|mp4|mp3|zip|rar)$/i.test(u)) continue;
    if (/^https?:\/\/(?:www\.)?(?:facebook|instagram|twitter|x|tiktok|youtube|pinterest)\./i.test(u)) continue;
    if (/^https?:\/\/[^/]+\/?$/i.test(u)) continue; // beranda
    urls.add(u);
    if (urls.size >= limit) break;
  }
  return [...urls];
}

/**
 * Cari tebak-tebakan/gombalan dari internet, lalu simpan ke memori.
 *
 * Dijalankan di latar belakang. Aman dipanggil berkali-kali: ada penjaga agar
 * satu jenis tidak dicari dua kali bersamaan, dan penyimpanan bersifat idempoten.
 *
 * @returns jumlah item baru yang tersimpan
 */
export async function growMemory(kind: MemoryKind): Promise<number> {
  const guardKey = `grow_${kind}`;
  if (growing.has(guardKey)) return 0;
  growing.add(guardKey);

  try {
    const queries = SEARCH_QUERIES[kind] ?? [];
    if (queries.length === 0) return 0;

    const collected: MemoryItem[] = [];
    const seen = new Set<string>();

    // Batasi kueri per pertumbuhan supaya tidak boros kuota dan waktu.
    // Pengetahuan butuh lebih banyak sumber (halaman penjelasan lebih jarang
    // menghasilkan banyak kalimat padat dibanding daftar tebak-tebakan).
    const maxQueries = kind === 'knowledge' || kind === 'professional' ? 3 : 2;
    for (const q of queries.slice(0, maxQueries)) {
      try {
        // TAHAP 1: cari untuk mendapat daftar URL sumber.
        // Jalur utama: xKiro search + filter domain (hasil terarah, sedikit
        // buangan). Cadangan: pencarian gratis kita (Bing/DuckDuckGo) yang
        // tanpa batas kuota, untuk saat kuota xKiro habis atau sedang gagal.
        let urls: string[] = [];
        const viaXKiro = await searchViaXKiro(q, TRUSTED_DOMAINS[kind] ?? []);
        if (viaXKiro && viaXKiro.length > 0) {
          urls = viaXKiro.slice(0, 3);
        } else {
          const searchText = await searchWeb(q);
          if (!searchText) continue;
          urls = extractUrlsFromSearch(searchText, 3);
        }
        if (urls.length === 0) {
          console.warn(`[bot_growth] Tidak ada URL dari pencarian "${q}".`);
          continue;
        }
        console.log(`[bot_growth] ${urls.length} halaman akan dibaca untuk "${q}".`);

        // TAHAP 2: baca ISI setiap halaman. Ini bagian yang wajib — hasil
        // pencarian hanya berisi judul, sedangkan daftar tebak-tebakannya ada
        // di dalam halaman.
        for (const url of urls) {
          try {
            const page = await fetchPageForGrowth(url);
            if (!page || page.length < 200) continue;

            // Jenis 'knowledge'/'professional' tidak berbentuk tanya-jawab, jadi
            // memakai ekstraktor kalimat penjelasan; sisanya memakai ekstraktor QA.
            const pakaiPengetahuan = kind === 'knowledge' || kind === 'professional';
            const items = pakaiPengetahuan
              ? extractKnowledgeFromText(page, q, 12)
              : extractQAFromText(page, 40);
            for (const it of items) {
              const norm = it.answer.toLowerCase().trim();
              if (seen.has(norm)) continue;
              seen.add(norm);
              collected.push({
                ...it,
                // Kategori: untuk pengetahuan dipakai jenisnya sendiri (agar bisa
                // difilter saat pengambilan); untuk tebak-tebakan tetap ditebak
                // dari kata kuncinya supaya tidak mengulang tema yang sama.
                category: kind === 'knowledge' || kind === 'professional' ? kind : guessCategory(it.question),
                explanation: '',
                sourceUrl: url,
              });
            }
          } catch (err) {
            console.warn(`[bot_growth] Gagal baca ${url}:`, (err as Error).message);
          }
        }
      } catch (err) {
        console.warn(`[bot_growth] Pencarian "${q}" gagal:`, (err as Error).message);
      }
    }

    if (collected.length === 0) {
      console.warn(`[bot_growth] Tidak ada ${kind} yang bisa diambil dari internet.`);
      return 0;
    }

    const saved = await saveMemoryItems(kind, collected);
    if (saved > 0) {
      console.log(`[bot_growth] ${saved} ${kind} baru disimpan ke memori (dari ${collected.length} kandidat).`);
    } else {
      console.log(`[bot_growth] ${collected.length} kandidat ${kind} sudah ada semua di memori.`);
    }
    return saved;
  } finally {
    growing.delete(guardKey);
  }
}

/**
 * Ambil item dari memori; kalau kosong, cari dulu dari internet.
 *
 * Ini pintu utama yang dipakai jalur balasan. Alurnya:
 *   1. Coba ambil dari memori (cepat, tanpa internet).
 *   2. Kalau memori kosong -> cari dari internet SEKARANG (tunggu, karena
 *      pengguna sedang menunggu), simpan, lalu ambil hasilnya.
 *   3. Kalau masih kosong -> kembalikan null (pemanggil memakai benih darurat).
 *
 * Setelah ini, panggil `growMemory` di latar belakang untuk menambah stok,
 * supaya permintaan berikutnya tidak perlu menunggu pencarian lagi.
 */
export async function getOrGrowMemory(
  kind: MemoryKind,
  opts: { excludeAnswers?: string[]; category?: string } = {},
): Promise<(MemoryItem & { key: string }) | null> {
  // 1. Coba memori dulu.
  const fromMemory = await pickMemoryItem(kind, opts);
  if (fromMemory) return fromMemory;

  // 2. Memori kosong: cari sekarang.
  console.log(`[bot_growth] Memori ${kind} kosong — mencari dari internet.`);
  await growMemory(kind);

  // 3. Coba lagi setelah pertumbuhan.
  return await pickMemoryItem(kind, opts);
}

/**
 * Berapa banyak stok memori per jenis. Dipakai untuk memutuskan perlu tumbuh
 * atau tidak, dan untuk laporan.
 */
export async function memoryStock(): Promise<Record<string, number>> {
  return await countMemory();
}

/** Apakah stok jenis ini menipis (perlu diisi ulang di latar belakang)? */
export async function needsGrowth(kind: MemoryKind, minStock = 5): Promise<boolean> {
  const counts = await countMemory(kind);
  return (counts[kind] ?? 0) < minStock;
}
