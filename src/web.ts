// Mesin Pencari & Penjelajah Web Bebas Real-Time 2026 (Zero-API-Key)
// Menggabungkan Google News Global & ID, Bing News, Hacker News, Wikipedia (ID/EN), arXiv, serta Deep Webpage Scraper & Jina Reader.
// Diadaptasi dari arsitektur teruji Terminal AI Portofolio Rafly Firmansyah.
import { getKnowledge, saveKnowledge } from './knowledge.js';

/** SSRF & Private Network Shield: mencegah scraping ke localhost, metadata cloud, atau IP privat. */
export function isSafePublicUrl(urlString: string): boolean {
  if (!urlString || typeof urlString !== 'string') return false;
  try {
    const parsed = new URL(urlString);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    let host = parsed.hostname.toLowerCase().trim();

    if (host.startsWith('[') && host.endsWith(']')) {
      host = host.slice(1, -1);
    }

    if (
      host === 'localhost' ||
      host.endsWith('.localhost') ||
      host.endsWith('.local') ||
      host.endsWith('.internal') ||
      host === 'metadata.google.internal' ||
      host === 'instance-data' ||
      host === '169.254.169.254'
    ) {
      return false;
    }

    if (host.includes(':')) {
      if (
        host === '::1' ||
        host === '::' ||
        host.startsWith('fe80:') ||
        host.startsWith('fc00:') ||
        host.startsWith('fd00:')
      ) {
        return false;
      }
      return true;
    }

    const ipMatch = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (ipMatch) {
      const b0 = parseInt(ipMatch[1], 10);
      const b1 = parseInt(ipMatch[2], 10);
      if (b0 === 10) return false;
      if (b0 === 127) return false;
      if (b0 === 169 && b1 === 254) return false;
      if (b0 === 172 && b1 >= 16 && b1 <= 31) return false;
      if (b0 === 192 && b1 === 168) return false;
      if (b0 === 0 || b0 >= 224) return false;
    }

    return true;
  } catch {
    return false;
  }
}

/** Bersihkan entitas HTML dan tag */
export function cleanStr(str: string): string {
  if (!str) return '';
  const entityMap: Record<string, string> = {
    '&quot;': '"',
    '&#39;': "'",
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&nbsp;': ' ',
    '&mdash;': ' - ',
    '&ndash;': ' - ',
  };
  // URUTAN PENTING: decode entitas HTML DULU (sehingga &lt;p&gt; menjadi <p>),
  // BARU buang tag. Bila dibalik, HTML yang ter-encode lolos mentah ke konteks model
  // (pernah kejadian: deskripsi RSS tampil sebagai "<ol><li><a href=...>" di balasan).
  let out = str.replace(/&(?:quot|#39|amp|lt|gt|nbsp|mdash|ndash);/g, (m) => entityMap[m] || m);
  // Buang tag HTML/XML berulang (termasuk yang muncul setelah decode) hingga stabil.
  for (let i = 0; i < 3 && /<[^>]+>/.test(out); i++) {
    out = out.replace(/<[^>]+>/g, ' ');
  }
  return out
    .replace(/[—–]/g, ' - ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Decode URL tujuan asli dari link klik redirect Bing (u=a1<base64>).
 * Memungkinkan deep scraping langsung ke artikel/halaman target, bukan sekadar domain utama.
 */
export function decodeBingUrl(href: string): string | null {
  if (!href) return null;
  const cleanHref = href.replace(/&amp;/g, '&');
  const m = cleanHref.match(/[?&]u=a1([a-zA-Z0-9_-]+)/);
  if (!m) return null;
  let b64 = m[1].replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4 !== 0) b64 += '=';
  try {
    const decoded = Buffer.from(b64, 'base64').toString('utf8');
    if (decoded.startsWith('http://') || decoded.startsWith('https://')) {
      return decoded;
    }
  } catch {
    // fallback
  }
  return null;
}

/** Filter artikel sampah, zodiak, atau judi */
export function isJunkArticle(str: string): boolean {
  if (!str || typeof str !== 'string') return true;
  const lower = str.toLowerCase();
  return /\b(zodiak|ramalan|togel|slot gacor|judi|casino|chord gitar|lirik lagu|sinopsis sinetron)\b/i.test(lower);
}

/** Ekstrak teks bersih / Fit-Markdown dari konten HTML mentah */
export function extractFitMarkdownContent(rawHtml: string): string {
  if (!rawHtml || typeof rawHtml !== 'string') return '';
  if (!rawHtml.includes('<html') && !rawHtml.includes('<body') && !rawHtml.includes('<div') && !rawHtml.includes('<p')) {
    return rawHtml.slice(0, 4000).trim();
  }

  let html = rawHtml;
  const semanticMatch = html.match(/<(?:article|main)\b[^>]*>([\s\S]*?)<\/(?:article|main)>/i);
  if (semanticMatch && semanticMatch[1] && semanticMatch[1].length > 200) {
    html = semanticMatch[1];
  }

  html = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
    .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, ' ')
    .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, ' ')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, ' ')
    .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, ' ')
    .replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, ' ')
    .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');

  html = html.replace(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/gi, '\n\n### $1\n');
  html = html.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, '\n- $1');
  html = html.replace(/<p\b[^>]*>([\s\S]*?)<\/p>/gi, '\n\n$1\n');
  html = html.replace(/<br\s*\/?>/gi, '\n');
  html = html.replace(/<[^>]+>/g, ' ');

  return cleanStr(html).slice(0, 4000);
}

/** Ambil isi URL publik secara langsung atau via Jina AI LLM Reader */
export async function scrapeWebpage(url: string): Promise<string> {
  if (!url || !isSafePublicUrl(url)) return '';

  // 0. PDF & dokumen biner: HANYA lewat Jina Reader (direct fetch akan mengembalikan biner rusak)
  const isBinaryDoc = /\.(?:pdf|docx?|xlsx?|pptx?)(?:[?#]|$)/i.test(url);

  // 1. Coba Jina AI LLM Reader (merender SPA dan Javascript menjadi Markdown)
  try {
    const jinaRes = await fetch(`https://r.jina.ai/${url}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'text/plain',
      },
      // Timeout SANGAT pendek (1,5 dtk): Jina biasanya membalas 403 (Cloudflare) dalam
      // ~0,2 dtk atau timeout penuh. Menunggu lama membuang jatah waktu direct fetch.
      // Diuji: dengan 2 dtk, scrape GitHub gagal 3/5 (butuh 6+ dtk untuk direct fetch).
      signal: AbortSignal.timeout(1500),
    });
    if (jinaRes.ok) {
      const text = await jinaRes.text();
      // Deteksi halaman challenge/anti-bot yang dikembalikan sebagai "sukses".
      // Jina mengembalikan 200 dengan body Cloudflare "Just a moment..." / captcha untuk
      // sebagian situs; body itu BUKAN isi halaman, jadi harus ditolak agar direct fetch
      // (yang sering berhasil) tetap dijalankan. Tanpa cek ini, bot "berhasil" membaca
      // halaman challenge lalu menyimpulkan isi situs tidak terbaca (temuan produksi:
      // GitHub, docs.anthropic.com, dan SPA Vercel semuanya 0 chars padahal direct OK).
      const isChallenge =
        /just a moment|attention required|cf-browser-verification|enable javascript and cookies|checking your browser|access denied|are you a robot|captcha/i.test(
          text.slice(0, 1500),
        );
      if (!isChallenge && text && text.length > 80) {
        return text.slice(0, 6000).trim();
      }
    }
  } catch {
    // abaikan fallback ke direct fetch
  }

  // 1b. Coba varian tanpa trailing slash (beberapa SPA Vercel membalas berbeda)
  if (/\/$/.test(url)) {
    try {
      const alt = url.replace(/\/+$/, '');
      const jr = await fetch(`https://r.jina.ai/${alt}`, {
        headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'text/plain' },
        signal: AbortSignal.timeout(1500),
      });
      if (jr.ok) {
        const t = await jr.text();
        if (t && t.length > 80) return t.slice(0, 6000).trim();
      }
    } catch {
      // lanjut
    }
  }

  if (isBinaryDoc) return ''; // biner tidak bisa dibaca via direct fetch

  // 2. Direct fetch fallback.
  // RETRY 1x untuk situs berat: GitHub (358 KB) butuh 4-8 dtk dan KADANG melewati
  // batas 9 dtk karena variasi jaringan — diuji 5x, 2-3 kali timeout. Percobaan kedua
  // hampir selalu berhasil karena koneksi sudah "hangat" (DNS+TLS tersimpan).
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 FreeAIBot/2026',
          Accept: 'text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.5',
        },
        // 9 dtk: situs berat (GitHub 358 KB, docs.anthropic 393 KB) butuh 4-8 dtk.
        signal: AbortSignal.timeout(9000),
      });
      if (res.ok) {
        const raw = await res.text();
        const parsed = extractFitMarkdownContent(raw);
        if (parsed && parsed.length > 80) return parsed;
        // SPA (React/Vue/Next): HTML awal hanya shell kosong + metadata. Ambil metadata
        // yang ADA (title, description, og:*) agar bot tetap punya fakta halaman —
        // lebih baik daripada 0 karakter yang memaksa bot bilang "tidak terbaca".
        const meta = extractSpaMetadata(raw);
        if (meta && meta.length > 40) return meta;
      }
      // Respons OK tapi isi tidak bisa di-parse: percobaan kedua tidak akan membantu.
      break;
    } catch {
      // Timeout/error jaringan -> coba sekali lagi (koneksi biasanya sudah hangat).
    }
  }

  return '';
}

/**
 * Ambil metadata halaman SPA yang tidak bisa dirender tanpa JavaScript.
 * SPA (Vercel/Next/React) mengirim shell kosong, tetapi <title>, meta description,
 * og:title/og:description/og:site_name hampir selalu terisi dan cukup untuk menjawab
 * pertanyaan dasar "ini web apa" secara faktual tanpa mengarang.
 */
export function extractSpaMetadata(html: string): string {
  if (!html || typeof html !== 'string') return '';
  const pick = (re: RegExp): string => {
    const m = html.match(re);
    return m && m[1] ? cleanStr(m[1]).slice(0, 300) : '';
  };
  const title = pick(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const desc = pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)
    || pick(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i);
  const ogTitle = pick(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  const ogDesc = pick(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i);
  const ogSite = pick(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i);
  const parts: string[] = [];
  const mainTitle = ogTitle || title;
  if (mainTitle) parts.push(`Judul halaman: ${mainTitle}`);
  if (ogSite) parts.push(`Nama situs: ${ogSite}`);
  const mainDesc = ogDesc || desc;
  if (mainDesc) parts.push(`Deskripsi halaman: ${mainDesc}`);
  if (parts.length === 0) return '';
  return `[Metadata Halaman (isi JS tidak dirender)]:\n${parts.join('\n')}`;
}

/** Tentukan apakah kueri memerlukan penelusuran internet live */
export function needsSearch(text: string): boolean {
  if (!text || typeof text !== 'string') return false;
  const q = text.trim();
  if (q.length < 2) return false;

  // 1. Jika ada URL, link, atau nama domain, WAJIB search / browse / scrape
  if (
    /https?:\/\/[^\s"'<>()]+/i.test(q) ||
    /www\.[a-z0-9-]+\.[a-z]{2,}/i.test(q) ||
    /\b[a-z0-9-]+\.(?:com|org|io|net|id|ai|co|xyz|dev|app|tech|info|me|site|cloud|edu|gov|ac\.id|co\.id|go\.id)\b/i.test(q)
  ) {
    return true;
  }

  // Normalisasi awal: buang kata sisipan/filler yang MEMUTUS pola frasa.
  // Contoh nyata yang gagal sebelum perbaikan: "carikan lagi berita yg terbaru" -> SKIP
  // (seharusnya SEARCH), karena pola "berita terbaru" tidak cocok dengan "berita yg terbaru".
  // Kata sisipan ini sangat lazim di chat Indonesia, jadi dibersihkan sebelum pencocokan.
  // CATATAN: 'lagi' TIDAK dibuang di sini karena bermakna ganda ("lagi rame" = sedang,
  // "lagi dong" = minta tambah); ia dibersihkan hanya bila berada di antara frasa kunci.
  const qNorm = q
    .toLowerCase()
    .replace(/[?!.,]/g, '')
    .replace(/\b(?:yg|yang|nih|dong|deh|sih|lah|tuh|kan|ya|kah|kok|loh)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // 2. Sapaan murni, salam, dan ucapan terima kasih: lewati search
  if (
    /^(?:halo|hai|hey|hei|assalamu(?:'|a)?laikum|selamat\s*(?:pagi|siang|sore|malam)|pagi|siang|sore|malam)(?:\s+(?:halo|hai|hey|hei|apa kabar|kawan|bro|kak|min|semuanya|sahabat))?$/i.test(qNorm) ||
    /^(?:apa kabar|gimana kabarnya|kabarmu gimana)(?:\s+(?:kawan|bro|kak|min|kamu|sahabat|semuanya))?$/i.test(qNorm) ||
    /^(?:makasih|terima kasih|thanks|thx|oke|ok|sip|siap|mantap|keren|yup|yes|ya|iya|bye|dadah)$/i.test(qNorm)
  ) {
    return false;
  }

  // 3. Pertanyaan identitas murni bot: TIDAK perlu search
  if (/^(kamu siapa|siapa kamu|kamu model apa|model apa kamu|kamu ai apa|kamu ini apa|siapa namamu|namamu siapa|who are you|what are you|what model are you)$/i.test(qNorm)) {
    return false;
  }

  // 4. Pertanyaan waktu/jam saat ini (lokal maupun kota/negara di dunia): TIDAK perlu search karena ditangani mesin waktu presisi
  if (
    /^(?:kalo\s+|kalau\s+|dan\s+)?(?:di\s+[a-z\s]+\s+)?(?:sekarang\s+)?(?:jam|pukul|waktu|hari|tanggal)\s+(?:berapa|apa)(?:\s+(?:sekarang|saat ini))?(?:\s+(?:di|pada|untuk)\s+[a-z\s]+)?$/i.test(qNorm) ||
    /^(?:kalo\s+|kalau\s+|dan\s+)?(?:sekarang\s+)?(?:jam|pukul|waktu|hari|tanggal)\s+(?:berapa|apa)(?:\s+(?:sekarang|saat ini))?(?:\s+(?:di|pada|untuk)\s+[a-z\s]+)?$/i.test(qNorm) ||
    /^(?:di\s+[a-z\s]+\s+)?(?:sekarang\s+)?(?:jam|pukul)\s+berapa/i.test(qNorm)
  ) {
    if (!/\b(?:pertandingan|konser|acara|jadwal|tayang|rilis|kick\s*off|main)\b/i.test(qNorm)) {
      return false;
    }
  }

  // 5. Soal aritmatika murni: e.g. "12 + 15" atau "50 * 4 / 2"
  if (/^[\d\s+\-*/^()=.,]+$/.test(qNorm)) {
    return false;
  }

  // 6. Percakapan santai, curhat, perasaan, dan kondisi fisik/mental: LEWATI search (Menghemat 7-10 detik latency)
  if (
    /\b(?:laper|lapar|mager|curhat|capek|ngantuk|pusing|sedih|senang|seneng|bosan|bosen|kesepian|kangen|galau)\b/i.test(qNorm) ||
    /^(?:aku|saya|gue|gw)\s+(?:laper|lapar|mager|capek|ngantuk|pusing|sedih|senang|bosan|galau)/i.test(qNorm) ||
    /\b(?:lagi ngapain|lagi apa|kamu lagi apa|kamu udah makan|udah makan belum)\b/i.test(qNorm) ||
    /^(?:saya|aku|gw|gue)\s+(?:di|lagi di)\s+[a-z\s]+$/i.test(qNorm)
  ) {
    return false;
  }

  // 7. Tanya saran / rekomendasi makanan, ide santai, kado, tempat nongkrong: LEWATI search
  if (
    /\b(?:rekomendasi makanan|menu makanan|makan apa|masak apa|saran makanan|rekomendasi kuliner)\b/i.test(qNorm) ||
    /\b(?:ide kado|rekomendasi hadiah|rekomendasi film|film bagus|lagu enak|tempat nongkrong)\b/i.test(qNorm) ||
    /\b(?:mending mana|bagusan mana|pilih mana|saran dong|menurutmu gimana)\b/i.test(qNorm)
  ) {
    return false;
  }

  // 8. Pembahasan seputar tugas kuliah, skripsi, jurnal, atau pekerjaan tanpa minta data internet: LEWATI search
  if (
    /^(?:tugas akhir|skripsi|jurnal|makalah|tugas kuliah|tugas sekolah|pr|kerjaan|proyek|thesis|tesis)(?:\s+(?:kuliah|sekolah|kantor))?$/i.test(qNorm) ||
    /^(?:lagi|lg)\s+ngerjain\s+(?:jurnal|skripsi|tugas|makalah|pr|laporan)/i.test(qNorm)
  ) {
    return false;
  }

  // 9. Koding, matematika, rumus, atau konsep sains umum tanpa merujuk software rilis baru: LEWATI search
  if (
    /^(?:buatkan|tuliskan|bikin|kode|script|fungsi|function|regex|sql query|algoritma)\s+/i.test(qNorm) ||
    /\b(?:hitung|rumus|cara koding|cara buat fungsi|contoh koding)\b/i.test(qNorm) ||
    /^(?:apa itu|jelaskan apa itu|pengertian|definisi)\s+(?:fotosintesis|gravitasi|mitokondria|oop|polimorfisme|rekursi|stack|queue)/i.test(qNorm)
  ) {
    return false;
  }

  // 9a. Topik pengetahuan faktual-dinamis (hukum, ekonomi, kesehatan, olahraga, hiburan,
  // sains terapan) + kata recency → wajib cari data terbaru agar tidak kaku/basi.
  if (
    /\b(?:hukum|uu|undang-undang|regulasi|kebijakan|aturan\s+baru|pajak|ekonomi|inflasi|kurs|investasi|crypto|bitcoin|kesehatan|obat|vaksin|penyakit|olahraga|liga|klub|transfer|pemain|hiburan|film|series|anime|konser|musik|game|turnamen|kejuaraan|beasiswa|seleksi|pendaftaran)\b/i.test(qNorm) &&
    /\b(?:terbaru|terkini|baru|sekarang|rilis|update|jadwal|hasil|kapan|20\d\d)\b/i.test(qNorm)
  ) {
    return true;
  }

  // 9b. Topik teknologi/AI/gadget UMUM + kata recency → WAJIB cari data terbaru.
  // Menangkap pertanyaan TANPA nama brand (mis. "model AI terbaru sekarang apa?",
  // "hp terbaru 2026", "teknologi terbaru") yang sebelumnya lolos tanpa penelusuran
  // sehingga model menjawab dari ingatan lama (basi/salah).
  if (
    /\b(?:ai|llm|model|teknologi|tech|gadget|hp|smartphone|ponsel|laptop|komputer|software|aplikasi|chip|chipset|android|ios|windows|browser|game)\b/i.test(qNorm) &&
    /\b(?:terbaru|terkini|terpanas|terupdate|rilis|launch|meluncur|versi\s+baru|update|202[4-9]|203\d)\b/i.test(qNorm)
  ) {
    return true;
  }

  // 10. TRIGGER EKSPLISIT SEARCH LIVE:
  // - Permintaan gombalan, tebak-tebakan, atau humor segar
  if (/\b(?:gombal(?:an)?|gombalin|rayuan|tebak(?:an|\s*-?\s*tebakan)?|pantun)\b/i.test(qNorm)) {
    if (!/^(?:nyerah|gatau|gak tau|ga tau|apa tuh|apaan|apa|bukan)\b/i.test(qNorm)) {
      return true;
    }
  }

  // - Keyword recency informal & viralitas (C4)
  // CATATAN: kata sisipan ('yang') sudah dibuang di normalisasi awal, jadi pola harus
  // mencocokkan BENTUK TERSISA juga ("lagi viral", bukan hanya "yang lagi viral").
  if (/\b(?:lagi\s+rame|lagi\s+viral|viral|berita\s+heboh|heboh|ada\s+apa\s+(?:sih\s+)?sekarang|yang\s+baru\s+keluar|baru\s+keluar|kabar\s+terbaru|info\s+terbaru|update\s+terkini|trending)\b/i.test(qNorm)) {
    return true;
  }

  // - Event, status cuaca, pasar, kurs, atau bencana alam real-time
  if (/\b(?:kurs|saham|cuaca|gempa|tsunami|banjir|skor\s+bola|klasemen|hasil\s+pertandingan|pemilu|pilkada)\b/i.test(qNorm)) {
    return true;
  }

  // - Berita terarah, update produk, harga komoditas & recency terarah
  // Frasa fleksibel: izinkan 1-2 kata sisipan antara kata benda berita dan kata recency
  // (mis. "berita yg terbaru", "berita nih terbaru", "carikan lagi berita terbaru").
  if (
    /\b(?:berita|kabar|info|informasi)\b[\w\s]{0,20}\b(?:terkini|terbaru|terpanas|terupdate|teranyar|update|hari\s+ini|dunia|politik|panas|nasional|viral|heboh)\b/i.test(qNorm) ||
    /\b(?:carikan|cari|infokan|kasih|kasi|berikan|tampilkan|minta|mau)\b[\w\s]{0,25}\b(?:berita|kabar|info|informasi)\b/i.test(qNorm) ||
    /\b(?:berita\s+(?:terkini|terbaru|hari\s+ini|dunia|politik|panas|nasional)|ada\s+berita)\b/i.test(qNorm) ||
    /\b(?:kabar\s+(?:terkini|terbaru|berita|dunia|politik|pasar|terpanas)|ada\s+kabar\s+(?:apa|terbaru|tentang)|kabar\s+soal)\b/i.test(qNorm) ||
    /\b(?:info(?:rmasi)?\s+(?:terbaru|terkini|terupdate|teranyar|update|hangat|viral)|kapan\s+(?:rilis|launch|tayang|berita|kejadian|terjadi)|rilis\s+(?:terbaru|resmi|versi|baru))\b/i.test(qNorm) ||
    /\b(?:ketinggalan\s+(?:berita|informasi|kabar|info)|cari(?:kan)?\s+(?:informasi|berita|kabar|info))\b/i.test(qNorm) ||
    /\b(?:mana\s+informasi\s+waktu|tanggal\s+berapa|kapan\s+(?:kejadiannya|peristiwanya|beritanya))\b/i.test(qNorm) ||
    /\b(?:internet\s+realtime|akses\s+internet|browsing\s+internet|akses\s+real-?time)\b/i.test(qNorm) ||
    /\b(?:harga\s+(?:emas|bbm|minyak|hp|beras|telur|kripto|bitcoin|saham)|berapa\s+harga)\b/i.test(qNorm) ||
    /\b(?:update\s+(?:terbaru|terkini|patch|versi|info|berita|sistem|fitur|harga)|ada\s+update)\b/i.test(qNorm) ||
    /\bjadwal\s+(?:rilis|tayang|pertandingan|tanding|bola|match|liga|konser|sholat|solat|imsakiyah|krl|kereta|pesawat|kuliah|bioskop)\b/i.test(qNorm) ||
    /\b(?:presiden|menteri)\s+(?:ri|indonesia|baru|as|amerika|prabowo|jokowi|trump|keuangan|esdm|pertahanan|terpilih)\b/i.test(qNorm) ||
    /\b(?:siapa|ganti)\s+(?:presiden|menteri)\b/i.test(qNorm)
  ) {
    return true;
  }

  // - Kata kunci brand teknologi & model AI spesifik (C1)
  // Brand unik / model AI tanpa homograf umum
  if (
    /\b(?:xiaomi|samsung|iphone|redmi|poco|vivo|oppo|deepseek|claude|openai|chatgpt|gpt-4|gpt-5|gpt-6|gemini|qwen|mistral|llama|grok|nvidia|snapdragon|rtx\s*\d+)\b/i.test(qNorm)
  ) {
    return true;
  }

  // Brand dengan potensi homograf kata biasa (apple, intel, amd, asus, lenovo): wajib ada konteks teknologi/produk
  if (
    /\b(?:apple\s*(?:inc|watch|iphone|mac|vision|car|tv|silicon|m\d|a\d+)|intel\s*(?:core|chip|prosesor|cpu|arc|evo|gen\s*\d+)|amd\s*(?:ryzen|radeon|gpu|prosesor|cpu)|laptop\s*(?:asus|lenovo)|rog|thinkpad)\b/i.test(qNorm)
  ) {
    return true;
  }

  // - Anchor tahun & waktu terkini: HANYA jika disertai konteks berita, produk, atau peristiwa (C3)
  if (
    /\b(?:2024|2025|2026|tahun ini|bulan ini|minggu ini|hari ini|kemarin)\b/i.test(qNorm) &&
    /\b(?:kejadian|peristiwa|skor|pemenang|juara|rilis|konser|spek|versi|presiden|kebijakan|isu|kasus|tragedi|viral|angka|data)\b/i.test(qNorm)
  ) {
    return true;
  }

  // - Kata tanya fakta eksplisit: "kapan rilis", "siapa juara", "berapa harga", "ada apa di"
  if (/\b(?:kapan rilis|kapan tayang|siapa juara|berapa harga|ada apa di|kenapa sekarang|apa yang terjadi)\b/i.test(qNorm)) {
    return true;
  }

  // - FOLLOW-UP KONTEKSTUAL: pertanyaan lanjutan tentang sesuatu yang baru dibahas
  //   (biasanya web/halaman). Contoh nyata: user kirim link lalu tanya "coba lihat isi nya
  //   apa aja" / "ada model free apa aja" — tanpa deteksi ini, bot menjawab dari ingatan
  //   dan MENGARANG isi halaman (temuan produksi: isi web dikarang total).
  if (
    /\b(?:isi(?:nya)?|konten|halaman|web(?:nya)?|situs|website|link|url|model|fitur|daftar|list|harga|produk|layanan)\b/i.test(qNorm) &&
    /\b(?:apa(?:\s*(?:aja|saja|itu|isinya))?|liat|lihat|cek|tengok|kasih\s+tau|jelasin|rangkum|sebutin|tunjukin|coba|tentang)\b/i.test(qNorm)
  ) {
    return true;
  }

  return false;
}

/** Ekstrak entitas inti kueri penelusuran tanpa filler percakapan
 * - Memperbaiki salah ketik / typo umum (calude -> claude, deepsik -> deepseek, xiomi -> xiaomi, dll).
 * - Menormalkan kata ponsel / hp agar tidak rancu dengan Hewlett-Packard.
 * - Menyingkirkan seluruh stop words percakapan (ganti topik, coba deh, kalo, kamu tahu, dll).
 * - Mengaitkan konteks percakapan sebelumnya jika kueri pengguna pendek/merujuk (anaphora).
 */
export function extractCoreEntity(query: string, previousContext?: string): string {
  if (!query || typeof query !== 'string') return '';
  let q = query.toLowerCase();

  // 1. Perbaiki typo brand & kata kunci umum
  q = q
    .replace(/\bcalude\b/g, 'claude')
    .replace(/\b(deepsik|deepsek|depseek)\b/g, 'deepseek')
    .replace(/\b(xiomi|xiaomy|siomi)\b/g, 'xiaomi')
    .replace(/\b(samung|samsun)\b/g, 'samsung')
    .replace(/\b(ipon|aipon)\b/g, 'iphone')
    .replace(/\bgemni\b/g, 'gemini')
    .replace(/\bchat\s*gpt\b/g, 'chatgpt');

  // 2. Normalisasi kata ponsel / smartphone agar tidak rancu dengan HP (Hewlett-Packard)
  q = q.replace(/\bhp\s+([a-z0-9]+)/g, '$1 smartphone');
  q = q.replace(/([a-z0-9]+)\s+hp\b/g, '$1 smartphone');
  q = q.replace(/\bhp\b/g, 'smartphone');

  // 3. Hapus URL atau domain mentah
  q = q
    .replace(/https?:\/\/[^\s"'<>()]+/gi, ' ')
    .replace(/www\.[a-z0-9-]+\.[a-z]{2,}(?:\/[^\s"'<>()]*)?/gi, ' ');

  // 4. Hapus filler percakapan dan stop words menyeluruh
  const stopWords = [
    // 'lagi' sebagai filler ("carikan lagi berita") dibuang; frasa bermakna seperti
    // "lagi rame" sudah ditangani di tempat lain sehingga aman dibersihkan di sini.
    'carikan lagi', 'cari lagi', 'lagi', 'coba deh', 'coba', 'deh', 'dong', 'sih', 'lah', 'nih', 'tuh', 'ya', 'kan', 'kok', 'loh',
    'ganti topik', 'topik', 'pindah topik', 'ngomongin', 'bahas',
    'kalo', 'kalau', 'klo', 'kl', 'gimana kalau', 'bagaimana kalau',
    'lalu', 'terus', 'trus', 'kemudian', 'nah', 'jadi',
    'kamu tahu', 'kamu tau', 'kamu ketahui', 'kamu pelajari', 'kamu ingat',
    'yang kamu tahu', 'yg kamu tahu', 'yang kamu tau', 'yg kamu tau',
    'kamu', 'kau', 'mu', 'anda', 'lu', 'loe', 'gue', 'gw',
    'tahu', 'tau', 'ketahui', 'ingat',
    'aja', 'saja', 'doang', 'hanya', 'cuma',
    'atau', 'ataupun', 'maupun',
    'apakah', 'apa', 'apaan', 'apanya',
    'tolong', 'mohon', 'bantu', 'bantuin',
    'carikan', 'cari', 'search', 'searching',
    'infokan', 'kasih tahu', 'kasih tau', 'beritahu', 'beritau',
    'sebutkan', 'jelaskan', 'ceritakan', 'tampilkan', 'berikan',
    'yang', 'yg', 'itu', 'ini',
    'menurutmu', 'menurut anda', 'menurut kamu',
    'ada', 'nggak', 'ngga', 'ga', 'gak', 'tidak', 'bukan',
    'sudah', 'udah', 'udh', 'belum', 'blm',
    'tentang', 'mengenai', 'soal', 'terkait',
    'pokonya', 'pokoknya', 'namanya', 'bisa', 'dipercaya',
    'sama', 'dari', 'ke', 'di', 'dan', 'dengan', 'web nya',
  ];

  for (const sw of stopWords) {
    const reg = new RegExp(`\\b${sw.replace(/\s+/g, '\\s+')}\\b`, 'gi');
    q = q.replace(reg, ' ');
  }

  q = q.replace(/[^\w\s.-]/gi, ' ').replace(/\s+/g, ' ').trim();

  // 5. Resolusi anaphora: jika kueri sangat pendek (misal "kalo calude" -> "claude" atau "model terakhir")
  // dan ada konteks percakapan sebelumnya, sertakan kata kunci penting dari konteks sebelumnya
  if (previousContext && (q.length < 5 || /\b(terakhir|terbaru|model|versi)\b/i.test(q))) {
    const prevClean = previousContext
      .toLowerCase()
      .replace(/[^\w\s.-]/g, ' ')
      .replace(/\b(halo|hai|oke|iya|ya|tidak|makasih|terima kasih)\b/gi, ' ')
      .trim();
    const prevMatch = prevClean.match(/\b(ai|model|gpt|claude|gemini|deepseek|qwen|mistral|smartphone|xiaomi|samsung|iphone)\b/gi);
    if (prevMatch && prevMatch.length > 0) {
      const topContextWord = prevMatch[prevMatch.length - 1];
      if (!q.includes(topContextWord)) {
        q = `${topContextWord} ${q}`.trim();
      }
    }
  }

  return q.slice(0, 120);
}

/** Deteksi apakah query berhubungan dengan informasi terkini / real-time */
function isRecencyQuery(query: string): boolean {
  return /\b(terbaru|terkini|baru|sekarang|saat\s*ini|kini|hari\s*ini|minggu\s*ini|bulan\s*ini|tahun\s*ini|malam\s*ini|siang\s*ini|pagi\s*ini|sore\s*ini|tadi|barusan|baru\s*saja|kemarin|besok|latest|new|current|now|today|tonight|update|updated|diperbarui|berubah|naik|turun|versi|version|rilis|release|launch|announced|diluncurkan|diumumkan|aktual|real-time|realtime|live|breaking|trending|viral|populer|202[3-9]|203[0-9])\b/i.test(query);
}

/** Deteksi apakah query tentang AI/teknologi */
function isTechQuery(query: string): boolean {
  return /\b(gpt|claude|calude|gemini|llm|ai|model|mistral|qwen|llama|deepseek|openai|anthropic|google|meta|nvidia|framework|library|sdk|api|github|release|versi|version|agentrouter|huggingface|ollama|groq|xkiro|openrouter)\b/i.test(query);
}

/**
 * Ekstrak nama brand/produk tech dari query Indonesia dan bangun query Inggris bersih.
 * Contoh: "model terbaru claude" → "claude latest model 2026"
 * Ini penting karena Bing setlang=en dan Google News EN bekerja optimal dengan query English.
 */
function extractEnglishTechQuery(query: string, currentYear: number): string | null {
  const lower = query.toLowerCase()
    .replace(/\bcalude\b/g, 'claude')
    .replace(/\b(deepsik|deepsek|depseek)\b/g, 'deepseek')
    .replace(/\b(xiomi|xiaomy|siomi)\b/g, 'xiaomi');

  // Daftar brand tech yang dikenali
  const techBrands = [
    'claude', 'anthropic', 'gpt', 'openai', 'chatgpt', 'gemini', 'google',
    'mistral', 'qwen', 'llama', 'deepseek', 'meta', 'nvidia', 'groq',
    'agentrouter', 'huggingface', 'ollama', 'openrouter', 'xkiro',
    'perplexity', 'cohere', 'grok', 'x.ai', 'copilot', 'microsoft',
    'stable diffusion', 'midjourney', 'runway', 'sora',
    'xiaomi', 'samsung', 'apple', 'iphone', 'redmi', 'poco', 'huawei', 'oppo', 'vivo'
  ];
  const foundBrands = techBrands.filter((b) => lower.includes(b));
  if (foundBrands.length === 0) return null;

  const entity = foundBrands.join(' ');
  const isLatest = isRecencyQuery(query);
  const isModelContext = /\b(model|versi|version|rilis|release|update|terbaru|latest|new|smartphone|phone)\b/i.test(query);

  if (isLatest && isModelContext) return `${entity} latest release announcement ${currentYear}`;
  if (isLatest) return `${entity} latest update ${currentYear}`;
  if (isModelContext) return `${entity} release ${currentYear}`;
  return `${entity} ${currentYear}`;
}

/** Generator kueri cerdas paralel multi-engine */
export function formulateSmartSearchQueries(query: string, previousContext?: string): string[] {
  if (!query || typeof query !== 'string') return [];

  const cleanRawLower = query.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const isAskingTimeOrRecency = /\b(?:kapan|waktu(?:nya)?|tanggal\s+berapa|jam\s+berapa|tahun\s+berapa|mana\s+informasi\s+waktu)\b/i.test(cleanRawLower);
  if (isAskingTimeOrRecency && previousContext) {
    // Cari entitas atau topik dari percakapan sebelumnya
    const contextTopics = previousContext.match(/\b(gempa(?:\s+[a-z]+)?|ntt|prabowo|jokowi|smelter|nikel|tsunami|banjir|pemilu|pilkada|kpk|dpr|mpr|presiden|menteri|[a-z]{4,})\b/gi);
    if (contextTopics && contextTopics.length > 0) {
      const topTopic = Array.from(new Set(contextTopics)).slice(-3).join(' ');
      return [
        `${topTopic} tanggal waktu kejadian`,
        `${topTopic} kapan berita ${new Date().getFullYear()}`,
        `${topTopic} berita terbaru`,
      ];
    }
  }

  const isGeneralNewsQuery =
    /^(?:infokan|tampilkan|berikan|cari|carikan|apa|ada)?\s*(?:berita|kabar|news|headline|peristiwa)\s*(?:hari\s*ini|terkini|terbaru|pagi\s*ini|siang\s*ini|sore\s*ini|malam\s*ini|saat\s*ini|update)?$/i.test(
      cleanRawLower,
    ) ||
    // Frasa fleksibel dengan kata sisipan: "berita yg terbaru", "carikan lagi berita terbaru",
    // "kasih info terbaru dong" — sebelumnya tidak dikenali sehingga tidak memakai Top Headlines.
    /\b(?:berita|kabar|info|informasi)\b[\w\s]{0,20}\b(?:terkini|terbaru|terpanas|terupdate|update|hari\s+ini)\b/i.test(cleanRawLower) ||
    /^(?:carikan|cari|infokan|kasih|kasi|berikan|tampilkan|minta|mau|ada)\b[\w\s]{0,30}\b(?:berita|kabar|info|informasi)\b/i.test(cleanRawLower) ||
    /^(?:berita|kabar|news|headline)\s*(?:hari\s*ini|terkini|terbaru)$/i.test(cleanRawLower) ||
    /\b(?:berita|kabar|peristiwa|headline)\s+(?:hari\s*ini|terkini|terbaru)\b/i.test(query) ||
    /\b(?:berita|kabar|news)\s+terkini\b/i.test(query) ||
    /\b(?:ketinggalan\s+berita|informasi\s+terbaru|berita\s+terbaru|update\s+terbaru|kabar\s+terbaru)\b/i.test(cleanRawLower) ||
    /\b(?:akses\s+internet\s+realtime|akses\s+internet)\b/i.test(cleanRawLower) ||
    /^(?:ada\s+berita\s+apa|apa\s+berita\s+hari\s+ini|berita\s+apa\s+hari\s+ini)/i.test(cleanRawLower);

  if (isGeneralNewsQuery) {
    return [
      'berita utama terkini hari ini indonesia',
      'breaking news headlines today',
      'peristiwa penting hari ini indonesia',
    ];
  }

  const isGombalOrJokeQuery = /\b(?:gombal(?:an)?|gombalin|rayuan|tebak(?:an|\s*-?\s*tebakan)?|pantun)\b/i.test(cleanRawLower);
  if (isGombalOrJokeQuery) {
    return [
      'tebak tebakan gombal romantis lucu masuk akal',
      'kata kata tebak tebakan gombalan bikin baper',
      'tebak tebakan lucu receh bikin ngakak',
    ];
  }

  const coreEntity = extractCoreEntity(query, previousContext);
  const targetSubject = coreEntity.length >= 2 ? coreEntity : cleanRawLower.slice(0, 80);
  const currentYear = new Date().getFullYear();

  const queries: string[] = [];
  if (targetSubject.length >= 2) {
    queries.push(targetSubject);
    // Selalu anchor tahun untuk semua query
    queries.push(`${targetSubject} ${currentYear}`);

    if (isRecencyQuery(query) || isTechQuery(query)) {
      // Tambahkan versi English yang bersih untuk Bing & Google News EN
      const englishQ = extractEnglishTechQuery(query, currentYear);
      if (englishQ) queries.push(englishQ);
      else {
        const enSubj = targetSubject
          .replace(/\bterbaru\b/gi, 'latest')
          .replace(/\brilis\b/gi, 'release')
          .replace(/\bterakhir\b/gi, 'latest');
        queries.push(`${enSubj} release ${currentYear}`);
      }
    } else {
      queries.push(`${targetSubject} terbaru ${currentYear}`);
    }
  } else {
    const raw = query.trim().slice(0, 80);
    queries.push(raw);
    queries.push(`${raw} ${currentYear}`);
  }

  return Array.from(new Set(queries)).filter((q) => q.length >= 2).slice(0, 4);
}

/** Kompatibilitas fungsi keywords sebelumnya */
export function keywords(query: string, previousContext?: string): string {
  const queries = formulateSmartSearchQueries(query, previousContext);
  return queries[0] ?? query.slice(0, 60);
}

/**
 * Mesin Penelusuran & Penjelajahan Web Universal 2026:
 * - Mendeteksi dan men-scrape URL publik mana pun (Jina AI SPA Reader + Direct Fetch).
 * - Menelusuri seluruh indeks web global via Bing Web Search dengan URL Click Decoder otomatis.
 * - Melakukan penelusuran berita terkini paralel via Google News (Global EN & Indonesia ID).
 * - Menghubungkan langsung ke Katalog Resmi Hugging Face API untuk info model AI open-weights terkini.
 * - Menyerap ensiklopedia Wikipedia (ID & EN) dan komunitas teknologi Hacker News.
 * - Secara otomatis melakukan Autonomous Deep-Scraping pada halaman web tujuan teratas yang ditemukan.
 */
export async function searchWeb(query: string, previousContext?: string): Promise<string> {
  if (!query || typeof query !== 'string' || query.trim().length < 2) return '';

  // Follow-up kontekstual: bila pesan ini TIDAK memuat URL tapi percakapan sebelumnya
  // memuat URL, baca ulang halaman itu. Contoh nyata: user kirim link lalu tanya
  // "coba lihat isi nya apa aja" / "ada model free apa aja" — tanpa ini bot menjawab
  // tanpa data halaman dan cenderung mengarang.
  const hasUrlNow = /https?:\/\//i.test(query);
  if (!hasUrlNow && previousContext && /https?:\/\//i.test(previousContext)) {
    const prevUrls = previousContext.match(/https?:\/\/[^\s"'<>()`]+/gi) || [];
    if (prevUrls.length > 0) {
      query = `${query} ${prevUrls[prevUrls.length - 1].replace(/[`'"),.;:!?]+$/, '')}`;
    }
  }

  const searchStart = Date.now();
  // Budget latensi total: balasan harus tetap gesit. Fase yang tidak kritis
  // (crawl lanjutan, deep-scrape tambahan) dilewati bila sudah melewati anggaran.
  const SEARCH_BUDGET_MS = 9000;
  const elapsed = () => Date.now() - searchStart;
  const overBudget = (ms: number = SEARCH_BUDGET_MS) => elapsed() > ms;

  const cleanQuery = query.trim();

  // Deteksi kueri berita (freshness-critical). Cache web_knowledge TIDAK dipakai untuk
  // berita: entri berita berumur 12 jam bisa berisi artikel lama — pernah kejadian berita
  // April tampil sebagai "kabar hari ini" karena cache. Berita selalu diambil live.
  const isNewsLike =
    /\b(?:berita|kabar|headline|news|peristiwa|breaking|viral)\b/i.test(cleanQuery) ||
    /^(?:ada\s+berita\s+apa|apa\s+berita\s+hari\s+ini|berita\s+apa\s+hari\s+ini)/i.test(cleanQuery.toLowerCase());
  const strictFreshNews =
    isNewsLike &&
    /\b(?:hari\s*ini|terkini|terbaru|terpanas|pagi\s*ini|siang\s*ini|sore\s*ini|malam\s*ini|breaking|viral|saat\s*ini)\b/i.test(cleanQuery);

  // Kueri yang memuat URL/link: kontennya spesifik halaman, bukan entitas — cache
  // berbasis entity key akan MENABRAKKAN kueri berbeda (URL dibuang saat normalisasi,
  // mis. dua pertanyaan "ringkas <url>" menjadi kunci "ringkas" yang sama) sehingga
  // jawaban bisa tertukar. Karena itu kueri ber-URL selalu live, tanpa cache.
  const queryHasUrl =
    /https?:\/\//i.test(cleanQuery) ||
    /\bwww\.[a-z0-9-]+\.[a-z]{2,}/i.test(cleanQuery) ||
    /\b[a-z0-9-]+\.(?:com|org|io|net|id|ai|co|xyz|dev|app|tech|info|me|site|cloud|edu|gov|ac\.id|co\.id|go\.id)\b/i.test(cleanQuery);

  // 0. Cek Persistent Knowledge Memory (Hot Cache & Supabase web_knowledge)
  // Jika fakta sudah pernah dipelajari dan masih berlaku segar, kembalikan instan (0 - 30ms)!
  if (!isNewsLike && !queryHasUrl) {
    try {
      const cached = await getKnowledge(cleanQuery);
      if (cached && cached.knowledge && cached.knowledge.length > 50) {
        return cached.knowledge;
      }
    } catch {
      // Fail-safe: jika pencarian memori gagal, lanjutkan penelusuran web live
    }
  }

  const structuredSnippets: Array<{ text: string; timestamp: number; score: number }> = [];
  const seenTitles = new Set<string>();
  const discoveredUrls = new Set<string>();

  const dedupeKey = (str: string) =>
    str
      .replace(/\s*[-–—|]\s*[^-–—|]+$/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 70);

  const addSnippet = (source: string, title: string, desc: string, pubDate: string, link: string, baseScore: number = 20) => {
    if (!title && !desc) return;
    // Kueri berita "hari ini/terkini": buang item yang jelas basi (> 7 hari) agar model
    // tidak menyajikan berita lama sebagai kabar terkini.
    if (strictFreshNews && pubDate) {
      const pd = new Date(pubDate).getTime();
      if (!isNaN(pd) && Date.now() - pd > 7 * 24 * 3600 * 1000) return;
    }
    // Filter tahun lawas untuk kueri berita/fresh: artikel 1990-2020 tidak pernah relevan
    // sebagai "kabar terkini" — sumber ensiklopedia (Wikipedia/HN) sering mengembalikannya
    // untuk kueri berita umum tanpa kata kunci spesifik.
    if (isNewsLike || strictFreshNews) {
      const oldYear = `${title} ${desc}`.match(/\b(?:19[89]\d|20[01]\d|2020)\b/);
      if (oldYear) return;
    }
    // Filter artikel sampah (zodiak/judi/lirik/sinetron) khusus kueri berita.
    if (isNewsLike && isJunkArticle(`${title} ${desc}`)) return;
    const cleanT = cleanStr(title);
    const key = dedupeKey(cleanT);
    if (key && seenTitles.has(key)) return;
    if (key) seenTitles.add(key);

    let ts = 0;
    let recencyBonus = 0;
    if (pubDate) {
      const parsed = new Date(pubDate).getTime();
      if (!isNaN(parsed)) {
        ts = parsed;
        const daysOld = (Date.now() - parsed) / (1000 * 60 * 60 * 24);
        if (daysOld <= 1) recencyBonus = 25;
        else if (daysOld <= 7) recencyBonus = 15;
        else if (daysOld <= 30) recencyBonus = 10;
      }
    }

    const cleanD = cleanStr(desc || '').slice(0, 300);
    const linkSuffix = link && isSafePublicUrl(link) && !link.includes('bing.com') && !link.includes('google.com') ? ` | Sumber: ${link}` : '';
    const fullText = cleanD && cleanD.length > 15 ? `${cleanT}: ${cleanD}` : cleanT;
    const dateStr = pubDate ? ` (${pubDate.slice(0, 16)})` : '';

    structuredSnippets.push({
      text: `[${source}${dateStr}${linkSuffix}]: ${fullText}`,
      timestamp: ts,
      score: baseScore + recencyBonus,
    });
  };

  // 1. Deteksi URL eksplisit atau nama domain dalam teks pengguna.
  // PENTING: backtick & karakter markup lain dikecualikan — pesan WhatsApp sering
  // mengirim URL terbungkus format seperti @url:`https://...` dan backtick yang ikut
  // terbaca membuat URL tidak valid sehingga scrape selalu gagal (temuan produksi).
  const explicitUrls = (cleanQuery.match(/https?:\/\/[^\s"'<>()`]+/gi) || []).map((u) => u.replace(/[`'"),.;:!?]+$/, ''));
  const domainMatches = cleanQuery.match(/\b([a-z0-9][a-z0-9-]{1,62}\.(?:com|org|net|id|ai|io|co|xyz|dev|app|tech|info|biz|me|online|site|store|cloud|edu|gov|cc|tv|ac\.id|co\.id|go\.id|my\.id|web\.id)(?:\/[^\s"'<>()]*)?)\b/gi) || [];
  const targetUrls = new Set<string>(explicitUrls);
  for (const d of domainMatches) {
    targetUrls.add(d.startsWith('http') ? d : `https://${d}`);
  }

  // Jika user menyertakan link/URL, langsung jelajahi dan baca isi halaman web tersebut
  const alreadyScrapedUrls = new Set<string>();
  // Fase 1 (baca URL user) TIDAK di-await di sini: dijalankan paralel dengan fase 2
  // (mesin pencari) lalu ditunggu bersama di akhir. Serialisasi keduanya menambah
  // ~3-4 dtk latensi balasan tanpa manfaat.
  const urlScrapePromise: Promise<void> = (async () => {
    if (targetUrls.size === 0) return;
    // Semua URL yang dikirim user dibaca PARALEL (maks 4). Sekuensial akan menjumlahkan
    // timeout tiap URL (4 x ~4.5s) dan membuat balasan lambat; paralel = 1x timeout terlama.
    const urlsToScrape = Array.from(targetUrls).slice(0, 4);
    const urlResults = await Promise.allSettled(
      urlsToScrape.map((u) => scrapeWebpage(u).then((content) => ({ u, content }))),
    );
    for (const r of urlResults) {
      if (r.status !== 'fulfilled') continue;
      const { u, content } = r.value;
      alreadyScrapedUrls.add(u);
      if (content && content.length > 50) {
        let host = u;
        try {
          host = new URL(u).hostname;
        } catch {
          // abaikan
        }
        structuredSnippets.push({
          text: `[Isi Lengkap Halaman Web (${host})]:\n${content.slice(0, 4500)}`,
          timestamp: Date.now() + 1_000_000_000,
          score: 130,
        });
      }
    }
  })();

  // 2. Formulasi Kueri Entitas Multi-Engine dengan Anaphora Resolution
  const searchQueries = formulateSmartSearchQueries(cleanQuery, previousContext);
  const primaryQ = searchQueries[0] ?? cleanQuery.slice(0, 80);
  const secondaryQ = searchQueries[1] ?? primaryQ;
  const englishQ = searchQueries[2] ?? primaryQ;
  const entityQ = cleanQuery.slice(0, 100);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3200);

  try {
    const fetches: Array<Promise<void>> = [];

    // 2a. Bing Web Search (Relevansi Akurat tanpa sortby=Date yang merusak indeks)
    const bingQueries = [primaryQ, secondaryQ].filter((q, i, arr) => arr.indexOf(q) === i).slice(0, 2);
    for (const bq of bingQueries) {
      fetches.push(
        fetch(`https://www.bing.com/search?q=${encodeURIComponent(bq)}&setlang=en`, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
            'Accept-Language': 'en-US,en;q=0.9,id-ID;q=0.8,id;q=0.7',
          },
          signal: controller.signal,
        })
          .then((r) => (r.ok ? r.text() : ''))
          .then((html) => {
            if (!html) return;
            const items = html.split('<li class="b_algo"');
            for (let i = 1; i < Math.min(items.length, 8); i++) {
              const chunk = items[i];
              const linkMatch = chunk.match(/<h2[^>]*><a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
              const descMatch = chunk.match(/<div class="b_caption">[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/i)
                || chunk.match(/<p class="b_lineclamp[^"]*"[^>]*>([\s\S]*?)<\/p>/i)
                || chunk.match(/<p[^>]*>([\s\S]{20,300}?)<\/p>/i);

              const rawHref = linkMatch ? linkMatch[1] : '';
              const title = linkMatch ? linkMatch[2].replace(/<[^>]+>/g, '').trim() : '';
              const desc = descMatch ? descMatch[1].replace(/<[^>]+>/g, '').trim() : '';

              let directUrl = '';
              if (rawHref) {
                const decoded = decodeBingUrl(rawHref);
                directUrl = decoded || (rawHref.startsWith('http') ? rawHref : '');
                if (directUrl && !/(bing\.com|microsoft\.com|msn\.com)/i.test(directUrl) && isSafePublicUrl(directUrl)) {
                  discoveredUrls.add(directUrl);
                }
              }

              if (title || desc) addSnippet('Bing Web', title, desc, '', directUrl, 55);
            }

            // Fallback parser jika b_algo tidak ditemukan
            if (items.length <= 1) {
              const linkMatches = html.matchAll(/<a[^>]+href="([^"]+)"[^>]*>([^<]{10,120})<\/a>/gi);
              let count = 0;
              for (const m of linkMatches) {
                if (count >= 6) break;
                const rawUrl = m[1];
                const title = m[2].trim();
                const decoded = decodeBingUrl(rawUrl);
                const finalUrl = decoded || rawUrl;
                if (isSafePublicUrl(finalUrl) && !/(bing\.com|microsoft\.com|msn\.com)/i.test(finalUrl)) {
                  discoveredUrls.add(finalUrl);
                  addSnippet('Bing Web (fallback)', title, '', '', finalUrl, 40);
                  count++;
                }
              }
            }
          })
          .catch(() => {}),
      );
    }

    // 2b. Google News Global (English) RSS
    fetches.push(
      fetch(`https://news.google.com/rss/search?q=${encodeURIComponent(englishQ)}&hl=en-US&gl=US&ceid=US:en`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        signal: controller.signal,
      })
        .then((r) => (r.ok ? r.text() : ''))
        .then((txt) => {
          if (!txt) return;
          const items = txt.match(/<item>[\s\S]*?<\/item>/gi) || [];
          for (const item of items.slice(0, 6)) {
            const tm = item.match(/<title>([\s\S]*?)<\/title>/i);
            const dm = item.match(/<description>([\s\S]*?)<\/description>/i);
            const pm = item.match(/<pubDate>([\s\S]*?)<\/pubDate>/i);
            const lm = item.match(/<link>([\s\S]*?)<\/link>/i);
            if (tm) {
              addSnippet('Google News Global', tm[1], dm ? dm[1] : '', pm ? pm[1] : '', lm ? lm[1] : '', 58);
              if (lm && lm[1] && isSafePublicUrl(lm[1].trim())) {
                discoveredUrls.add(lm[1].trim());
              }
            }
          }
        })
        .catch(() => {}),
    );

    // 2c. Hugging Face Direct API untuk Katalog Model AI Open-Weights (DeepSeek, Qwen, Mistral, Llama, Meta)
    const queryLower = cleanQuery.toLowerCase();
    const hfMap: Record<string, string> = {
      deepseek: 'deepseek-ai',
      qwen: 'Qwen',
      mistral: 'mistralai',
      llama: 'meta-llama',
      meta: 'meta-llama',
    };
    for (const [key, author] of Object.entries(hfMap)) {
      if (queryLower.includes(key)) {
        fetches.push(
          fetch(`https://huggingface.co/api/models?author=${author}&sort=lastModified&direction=-1&limit=5`, {
            headers: { 'User-Agent': 'FreeAIBot/2026' },
            signal: controller.signal,
          })
            .then((r) => (r.ok ? r.json() : null))
            .then((data: any) => {
              if (Array.isArray(data) && data.length > 0) {
                const list = data
                  .map((m: any) => `- ${m.id} (rilis/pembaruan: ${m.lastModified ? m.lastModified.slice(0, 10) : 'terkini'})`)
                  .join('\n');
                structuredSnippets.unshift({
                  text: `[Katalog Resmi Hugging Face (${author})]:\nModel ${key.toUpperCase()} paling mutakhir:\n${list}`,
                  timestamp: Date.now() + 2_500_000_000,
                  score: 99,
                });
              }
            })
            .catch(() => {}),
        );
        break;
      }
    }

    // 2d. Direct scrape sumber resmi brand saat query tentang tech brand spesifik
    const brandNewsPages: Record<string, string[]> = {
      claude:      ['https://www.anthropic.com/news', 'https://docs.anthropic.com/en/release-notes/overview'],
      anthropic:   ['https://www.anthropic.com/news', 'https://docs.anthropic.com/en/release-notes/overview'],
      openai:      ['https://openai.com/news', 'https://openai.com/blog'],
      chatgpt:     ['https://openai.com/news', 'https://openai.com/blog'],
      gpt:         ['https://openai.com/news', 'https://openai.com/blog'],
      gemini:      ['https://blog.google/technology/google-deepmind/', 'https://ai.google.dev/gemini-api/docs/changelog'],
      google:      ['https://blog.google/technology/ai/'],
      mistral:     ['https://mistral.ai/news/'],
      groq:        ['https://groq.com/blog/', 'https://console.groq.com/docs/changelog'],
      deepseek:    ['https://huggingface.co/deepseek-ai', 'https://github.com/deepseek-ai/DeepSeek-V3/blob/main/README.md'],
      perplexity:  ['https://www.perplexity.ai/hub/blog'],
      meta:        ['https://ai.meta.com/blog/'],
      llama:       ['https://ai.meta.com/blog/'],
      qwen:        ['https://qwenlm.github.io/'],
      cohere:      ['https://cohere.com/blog'],
      nvidia:      ['https://blogs.nvidia.com/blog/category/generative-ai/'],
      grok:        ['https://x.ai/blog'],
      xai:         ['https://x.ai/blog'],
      microsoft:   ['https://blogs.microsoft.com/ai/'],
      copilot:     ['https://blogs.microsoft.com/ai/'],
      midjourney:  ['https://www.midjourney.com/updates'],
      stability:   ['https://stability.ai/news'],
      runway:      ['https://runwayml.com/blog/'],
      sora:        ['https://openai.com/sora'],
      openrouter:  ['https://openrouter.ai/announcements'],
      agentrouter: ['https://agentrouter.org'],
      huggingface: ['https://huggingface.co/blog'],
      ollama:      ['https://ollama.com/blog'],
      xiaomi:      ['https://www.mi.com/global/product-list/'],
      samsung:     ['https://news.samsung.com/global/'],
      apple:       ['https://www.apple.com/newsroom/'],
    };

    for (const [brand, newsUrls] of Object.entries(brandNewsPages)) {
      if (queryLower.includes(brand)) {
        const tryUrls = Array.isArray(newsUrls) ? newsUrls : [newsUrls];
        const scrapeWithFallback = async () => {
          for (const newsUrl of tryUrls) {
            try {
              const content = await scrapeWebpage(newsUrl);
              if (content && content.length > 80) {
                let host = newsUrl;
                try { host = new URL(newsUrl).hostname; } catch { /* */ }
                structuredSnippets.unshift({
                  text: `[Sumber Resmi ${brand.toUpperCase()} (${host})]:\n${content.slice(0, 4500)}`,
                  timestamp: Date.now() + 2_000_000_000,
                  score: 98,
                });
                return;
              }
            } catch { /* coba fallback */ }
          }
        };
        fetches.push(scrapeWithFallback());
        break;
      }
    }

    // 2e. Google News Indonesia RSS (Top Headlines langsung jika kueri berita umum agar update detik ini)
    const isGeneralNews =
      /\b(?:ketinggalan\s+berita|informasi\s+terbaru|berita\s+terbaru|update\s+terbaru|kabar\s+terbaru|berita\s+hari\s+ini|headline\s+hari\s+ini|berita\s+terkini|kabar\s+terkini|news\s+today)\b/i.test(cleanQuery) ||
      /\b(?:akses\s+internet\s+realtime|akses\s+internet)\b/i.test(cleanQuery) ||
      /^(?:berita|kabar|news|headline)\s*(?:hari\s*ini|terkini|terbaru)?$/i.test(cleanQuery.trim()) ||
      /^(?:ada\s+berita\s+apa|apa\s+berita\s+hari\s*ini|berita\s+apa\s+hari\s*ini)/i.test(cleanQuery.trim());

    // Kueri berita segar: batasi Google News ke 7 hari terakhir (when:7d) agar artikel
    // lama tidak ikut masuk; kueri berita umum langsung memakai Top Headlines (detik ini).
    const gNewsQuery = strictFreshNews && !isGeneralNews ? `${primaryQ} when:7d` : primaryQ;
    const gNewsUrl = isGeneralNews
      ? 'https://news.google.com/rss?hl=id&gl=ID&ceid=ID:id'
      : `https://news.google.com/rss/search?q=${encodeURIComponent(gNewsQuery)}&hl=id&gl=ID&ceid=ID:id`;

    fetches.push(
      fetch(gNewsUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        signal: controller.signal,
      })
        .then((r) => (r.ok ? r.text() : ''))
        .then((txt) => {
          if (!txt) return;
          const items = txt.match(/<item>[\s\S]*?<\/item>/gi) || [];
          for (const item of items.slice(0, 8)) {
            const tm = item.match(/<title>([\s\S]*?)<\/title>/i);
            const dm = item.match(/<description>([\s\S]*?)<\/description>/i);
            const pm = item.match(/<pubDate>([\s\S]*?)<\/pubDate>/i);
            const lm = item.match(/<link>([\s\S]*?)<\/link>/i);
            if (tm) {
              addSnippet('Google Berita', tm[1], dm ? dm[1] : '', pm ? pm[1] : '', lm ? lm[1] : '', isGeneralNews ? 85 : 50);
              if (lm && lm[1] && isSafePublicUrl(lm[1].trim())) {
                discoveredUrls.add(lm[1].trim());
              }
            }
          }
        })
        .catch(() => {}),
    );

    // 2e1. RSS MEDIA INDONESIA LANGSUNG (link artikel asli — bisa dibaca penuh).
    // Hanya untuk kueri berita: memberi isi berita nyata, bukan sekadar judul + redirect.
    if (isNewsLike) {
      // 10 feed media Indonesia — semuanya diverifikasi live (status 200 + item > 0).
      // Banyak feed = data berita tidak pernah kosong walau beberapa sedang down/diblokir.
      const directFeeds = [
        'https://www.antaranews.com/rss/terkini',
        'https://www.cnnindonesia.com/rss/',
        'https://www.cnbcindonesia.com/rss',
        'https://rss.tempo.co/',
        'https://lapi.kumparan.com/v2.0/rss',
        'https://www.sindonews.com/rss',
        'https://www.republika.co.id/rss',
        'https://sindikasi.okezone.com/index.php/rss/0/RSS2.0',
        'https://katadata.co.id/rss',
        'https://mediaindonesia.com/feed',
      ];
      for (const feed of directFeeds) {
        fetches.push(
          fetch(feed, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
            signal: controller.signal,
          })
            .then((r) => (r.ok ? r.text() : ''))
            .then((txt) => {
              if (!txt) return;
              let feedHost = feed;
              try { feedHost = new URL(feed).hostname; } catch { /* */ }
              const items = txt.match(/<item[\s>][\s\S]*?<\/item>/gi) || [];
              for (const item of items.slice(0, 6)) {
                const tm = item.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i);
                const lm = item.match(/<link>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/i);
                const pm = item.match(/<pubDate>([\s\S]*?)<\/pubDate>/i);
                if (!tm) continue;
                const link = lm ? lm[1].trim() : '';
                if (link && isSafePublicUrl(link)) discoveredUrls.add(link);
                addSnippet(feedHost, tm[1], '', pm ? pm[1] : '', link, isGeneralNews ? 88 : 60);
              }
            })
            .catch(() => {}),
        );
      }
    }

    // 2e1a. FEED TOPIK KHUSUS: bila kueri menyebut topik tertentu, ambil feed khusus topik
    // itu (jauh lebih relevan daripada feed berita umum yang bercampur semua hal).
    const topicFeeds: Array<[RegExp, string[]]> = [
      [/\b(?:ekonomi|bisnis|keuangan|pasar|saham|investasi|rupiah|dolar|inflasi|harga|pajak|bank|crypto|bitcoin|umkm)\b/i,
       ['https://www.kontan.co.id/rss', 'https://www.cnbcindonesia.com/rss', 'https://katadata.co.id/rss', 'https://www.bisnis.com/rss']],
      [/\b(?:olahraga|bola|liga|sepakbola|badminton|bulutangkis|motogp|f1|basket|timnas|transfer|klub)\b/i,
       ['https://www.cnnindonesia.com/olahraga/rss', 'https://www.antaranews.com/rss/olahraga', 'https://www.jpnn.com/rss']],
      [/\b(?:teknologi|teknologi|gadget|ai|startup|internet|digital|komputer|hp|smartphone)\b/i,
       ['https://www.cnnindonesia.com/teknologi/rss', 'https://www.antaranews.com/rss/tekno', 'https://katadata.co.id/rss']],
      [/\b(?:hiburan|film|musik|selebriti|artis|konser|drama|series|anime)\b/i,
       ['https://www.cnnindonesia.com/hiburan/rss', 'https://www.antaranews.com/rss/hiburan']],
      [/\b(?:kesehatan|dokter|obat|vaksin|penyakit|rumah sakit|gizi|diet)\b/i,
       ['https://www.antaranews.com/rss/kesehatan', 'https://www.cnbcindonesia.com/rss']],
    ];
    for (const [re, feeds] of topicFeeds) {
      if (!re.test(cleanQuery)) continue;
      for (const feed of feeds.slice(0, 3)) {
        fetches.push(
          fetch(feed, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
            signal: controller.signal,
          })
            .then((r) => (r.ok ? r.text() : ''))
            .then((txt) => {
              if (!txt) return;
              let host = feed;
              try { host = new URL(feed).hostname; } catch { /* */ }
              const items = txt.match(/<item[\s>][\s\S]*?<\/item>/gi) || [];
              for (const item of items.slice(0, 10)) {
                const tm = item.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i);
                const lm = item.match(/<link>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/i);
                const pm = item.match(/<pubDate>([\s\S]*?)<\/pubDate>/i);
                if (!tm) continue;
                const link = lm ? lm[1].trim() : '';
                if (link && isSafePublicUrl(link)) discoveredUrls.add(link);
                // Skor TERTINGGI: feed topik khusus = paling relevan dengan pertanyaan user,
                // harus mengalahkan isi halaman hasil deep-scrape artikel acak.
                addSnippet(`${host} (topik)`, tm[1], '', pm ? pm[1] : '', link, 115);
              }
            })
            .catch(() => {}),
        );
      }
      break; // hanya satu topik yang cocok (yang pertama)
    }

    // 2e1b. BING NEWS RSS: mesin pencari berita generik (query apa pun) — RSS stabil,
    // tidak kena blokir seperti HTML scraping, dan memberi tanggal terbit.
    fetches.push(
      fetch(`https://www.bing.com/news/search?q=${encodeURIComponent(primaryQ)}&format=RSS`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36' },
        signal: controller.signal,
      })
        .then((r) => (r.ok ? r.text() : ''))
        .then((txt) => {
          if (!txt) return;
          const items = txt.match(/<item[\s>][\s\S]*?<\/item>/gi) || [];
          for (const item of items.slice(0, 8)) {
            const tm = item.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i);
            const dm = item.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/i);
            const pm = item.match(/<pubDate>([\s\S]*?)<\/pubDate>/i);
            const lm = item.match(/<link>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/i);
            if (tm) addSnippet('Bing News', tm[1], dm ? dm[1] : '', pm ? pm[1] : '', lm ? lm[1] : '', 62);
          }
        })
        .catch(() => {}),
    );

    // 2e2. DuckDuckGo HTML (mesin cadangan bila Bing kosong / kena blokir)
    if (bingQueries.length > 0) {
      fetches.push(
        fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(bingQueries[0])}`, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
            'Accept-Language': 'id-ID,id;q=0.9,en;q=0.8',
          },
          signal: controller.signal,
        })
          .then((r) => (r.ok ? r.text() : ''))
          .then((html) => {
            if (!html) return;
            const items = html.split('class="result__body"');
            for (let i = 1; i < Math.min(items.length, 7); i++) {
              const chunk = items[i];
              const linkMatch = chunk.match(/<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
              const descMatch = chunk.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i);
              if (!linkMatch) continue;
              let rawUrl = linkMatch[1].replace(/&amp;/g, '&');
              // DDG membungkus tautan: /l/?uddg=<encoded>
              const uddg = rawUrl.match(/[?&]uddg=([^&]+)/);
              if (uddg) { try { rawUrl = decodeURIComponent(uddg[1]); } catch { /* */ } }
              const title = linkMatch[2].replace(/<[^>]+>/g, '').trim();
              const desc = descMatch ? descMatch[1].replace(/<[^>]+>/g, '').trim() : '';
              if (isSafePublicUrl(rawUrl)) {
                discoveredUrls.add(rawUrl);
                addSnippet('DuckDuckGo', title, desc, '', rawUrl, 52);
              }
            }
          })
          .catch(() => {}),
      );
    }

    // 2e3. GDELT Project: indeks berita global (90+ bahasa, arsip luas) — sumber pelengkap
    // untuk topik yang jarang diberitakan media Indonesia.
    if (isNewsLike || strictFreshNews) {
      fetches.push(
        fetch(`https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(primaryQ.slice(0, 80))}&mode=artlist&maxrecords=8&format=json&timespan=3d`, {
          headers: { 'User-Agent': 'FreeAIBot/2026' },
          signal: controller.signal,
        })
          .then((r) => (r.ok ? r.json() : null))
          .then((data: any) => {
            const arts = data?.articles;
            if (!Array.isArray(arts)) return;
            for (const a of arts.slice(0, 8)) {
              const title = a?.title || '';
              const url = a?.url || '';
              const seen = a?.seendate || '';
              if (!title) continue;
              // seendate format: YYYYMMDDTHHMMSSZ -> ISO agar recency bonus bekerja
              let iso = '';
              if (typeof seen === 'string' && seen.length >= 15) {
                iso = `${seen.slice(0,4)}-${seen.slice(4,6)}-${seen.slice(6,8)}T${seen.slice(9,11)}:${seen.slice(11,13)}:${seen.slice(13,15)}Z`;
              }
              addSnippet('GDELT News', title, '', iso, url, 56);
              if (url && isSafePublicUrl(url)) discoveredUrls.add(url);
            }
          })
          .catch(() => {}),
      );
    }

    // 2f. Wikipedia ID + EN paralel
    const wikiQueries = [
      { lang: 'id', base: 'https://id.wikipedia.org', label: 'Wikipedia Indonesia', q: entityQ },
      { lang: 'en', base: 'https://en.wikipedia.org', label: 'Wikipedia English', q: englishQ },
    ];
    for (const w of wikiQueries) {
      fetches.push(
        fetch(`${w.base}/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(w.q)}&format=json&origin=*`, {
          headers: { 'User-Agent': 'FreeAIBot/2026' },
          signal: controller.signal,
        })
          .then((r) => (r.ok ? r.json() : null))
          .then((data) => {
            const hits = (data as { query?: { search?: Array<{ title: string; snippet: string }> } })?.query?.search;
            if (Array.isArray(hits) && hits.length > 0) {
              const top = hits[0];
              addSnippet(w.label, top.title, top.snippet, '', `${w.base}/wiki/${encodeURIComponent(top.title)}`, 35);
            }
          })
          .catch(() => {}),
      );
    }

    // 2g. Hacker News Algolia (Tech & Open-Source)
    fetches.push(
      fetch(`https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(entityQ)}&tags=story&hitsPerPage=3`, {
        headers: { 'User-Agent': 'FreeAIBot/2026' },
        signal: controller.signal,
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          const hits = (data as { hits?: Array<{ title?: string; story_title?: string; url?: string; created_at?: string }> })?.hits;
          if (Array.isArray(hits)) {
            for (const h of hits) {
              const t = h.title || h.story_title || '';
              if (t) addSnippet('Hacker News Tech', t, '', h.created_at || '', h.url || '', 30);
            }
          }
        })
        .catch(() => {}),
    );

    await Promise.allSettled(fetches);
  } finally {
    clearTimeout(timeout);
  }
  // Fase 1 & 2 selesai — pastikan hasil baca URL user sudah masuk sebelum deep-scrape.
  await urlScrapePromise;

  // 3. Universal Autonomous Deep Web Scraping + Crawl 1 Level
  // Deep-scrape halaman bila: user menyertakan link eksplisit, hasil snippet minim, ATAU
  // kueri berita/teknologi segar (butuh isi artikel langsung, bukan hanya deskripsi RSS).
  const shouldDeepScrape =
    targetUrls.size > 0 || structuredSnippets.length < 2 || strictFreshNews ||
    (isNewsLike && structuredSnippets.length < 6);
  // Link redirect Google News/Bing tidak bisa dibaca langsung — dibuang dari target scrape.
  const skippedDomains = /(kbbi\.|wikipedia\.org|youtube\.com|facebook\.com|instagram\.com|tiktok\.com|twitter\.com|x\.com|google\.com|bing\.com|duckduckgo\.com|news\.google\.com)/i;
  // Prioritas target deep-scrape: URL eksplisit user > halaman dari feed TOPIK > feed umum.
  // Halaman topik dibaca lebih dulu agar isi yang relevan ikut masuk konteks.
  const topicUrls = structuredSnippets
    .filter((s) => s.text.includes('(topik)'))
    .map((s) => {
      const m = s.text.match(/\|\s*Sumber:\s*(\S+)/);
      return m ? m[1] : '';
    })
    .filter((u) => u && isSafePublicUrl(u) && !alreadyScrapedUrls.has(u) && !skippedDomains.test(u));
  const scrapeTargets = shouldDeepScrape && !overBudget(7000)
    ? [
        ...Array.from(targetUrls).filter((u) => !alreadyScrapedUrls.has(u)),
        ...topicUrls,
        ...Array.from(discoveredUrls).filter((u) => !skippedDomains.test(u) && !alreadyScrapedUrls.has(u)),
      ].slice(0, targetUrls.size > 0 ? 4 : isNewsLike ? 3 : 3)
    : [];

  if (scrapeTargets.length > 0) {
    const scrapeResults = await Promise.allSettled(
      scrapeTargets.map((url) => scrapeWebpage(url).then((content) => ({ url, content })))
    );
    // Kumpulkan tautan internal same-host dari halaman yang berhasil dibaca → crawl 1 level
    const followLinks: string[] = [];
    for (const result of scrapeResults) {
      if (result.status === 'fulfilled' && result.value.content && result.value.content.length > 80) {
        const { url, content } = result.value;
        let host = url;
        try { host = new URL(url).hostname; } catch { /* */ }
        structuredSnippets.unshift({
          text: `[Isi Halaman Web (${host})]:\n${content.slice(0, 4000)}`,
          timestamp: Date.now() + 500_000_000,
          // 100: di atas berita umum (60-88) tapi DI BAWAH feed topik khusus (115) —
          // artikel acak dari feed umum tidak boleh mengubur hasil yang relevan topik.
          score: 100,
        });
        // Ekstrak tautan markdown internal (same host) untuk pendalaman — maks 3 kandidat.
        try {
          for (const m of content.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)) {
            if (followLinks.length >= 3) break;
            const link = m[1];
            if (/\.(?:jpg|jpeg|png|gif|svg|webp|mp4|zip|rar|mp3)(?:[?#]|$)/i.test(link)) continue;
            try {
              const lh = new URL(link).hostname;
              if (lh === host && !scrapeTargets.includes(link) && !followLinks.includes(link)) followLinks.push(link);
            } catch { /* */ }
          }
        } catch { /* */ }
      }
    }
    // Crawl 1 level: baca 2 tautan internal teratas bila hasil masih belum kaya (< 8 snippet)
    // DAN masih ada anggaran waktu (menjaga latensi balasan tetap gesit).
    if (followLinks.length > 0 && structuredSnippets.length < 8 && !overBudget(4500)) {
      const followResults = await Promise.allSettled(
        followLinks.slice(0, 2).map((url) => scrapeWebpage(url).then((content) => ({ url, content }))),
      );
      for (const result of followResults) {
        if (result.status === 'fulfilled' && result.value.content && result.value.content.length > 80) {
          const { url, content } = result.value;
          let host = url;
          try { host = new URL(url).hostname; } catch { /* */ }
          structuredSnippets.unshift({
            text: `[Halaman Terkait (${host})]:\n${content.slice(0, 3000)}`,
            timestamp: Date.now() + 400_000_000,
            score: 110,
          });
        }
      }
    }
  }

  // FALLBACK BERLAPIS: kueri berita yang hasilnya tipis (< 4 snippet) dipulihkan bertingkat.
  // Tujuan: data berita TIDAK PERNAH kosong — beberapa feed pasti lolos walau yang lain
  // sedang down/diblokir. Kueri percakapan ("ada berita apa yg terbaru") kadang tidak cocok
  // dengan indeks mesin pencari, sedangkan headline murni selalu cocok.
  const recoverNews = async (label: string, urls: string[], score: number): Promise<void> => {
    for (const u of urls) {
      if (overBudget(SEARCH_BUDGET_MS - 500)) return;
      try {
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), 3000);
        try {
          const r = await fetch(u, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
            signal: ctrl.signal,
          });
          if (!r.ok) continue;
          const txt = await r.text();
          const items = txt.match(/<item[\s>][\s\S]*?<\/item>/gi) || [];
          for (const item of items.slice(0, 12)) {
            const tm = item.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i);
            const pm = item.match(/<pubDate>([\s\S]*?)<\/pubDate>/i);
            const lm = item.match(/<link>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/i);
            if (tm) addSnippet(label, tm[1], '', pm ? pm[1] : '', lm ? lm[1] : '', score);
          }
          if (structuredSnippets.length >= 4) return; // sudah cukup, berhenti
        } finally {
          clearTimeout(to);
        }
      } catch {
        // coba sumber berikutnya
      }
    }
  };

  if (isNewsLike && structuredSnippets.length < 4) {
    // Tingkat 1: Top Headlines (Google ID + Bing News) — paling cepat & paling segar.
    await recoverNews('Google Berita', ['https://news.google.com/rss?hl=id&gl=ID&ceid=ID:id'], 82);
    if (structuredSnippets.length < 4) {
      await recoverNews('Bing News', ['https://www.bing.com/news/search?q=berita+terkini&format=RSS'], 80);
    }
    // Tingkat 2: feed media langsung (banyak cadangan, satu pasti lolos).
    if (structuredSnippets.length < 4) {
      await recoverNews('Media Indonesia', [
        'https://www.antaranews.com/rss/terkini',
        'https://www.cnnindonesia.com/rss/',
        'https://mediaindonesia.com/feed',
        'https://www.jpnn.com/rss',
      ], 75);
    }
    // Tingkat 3: pencarian berita generik English (jaring terakhir untuk topik global).
    if (structuredSnippets.length < 4) {
      await recoverNews('Google News EN', ['https://news.google.com/rss/search?q=breaking+news+today&hl=en-US&gl=US&ceid=US:en'], 70);
    }
  }

  if (structuredSnippets.length === 0) return '';

  // Urutkan bukti: artikel terbaca langsung di paling atas, kemudian berdasarkan recency & relevansi skor
  structuredSnippets.sort((a, b) => b.score - a.score || b.timestamp - a.timestamp);

  // RELEVANSI TOPIK: beri bonus pada snippet yang memuat kata kunci topik dari kueri user.
  // Tanpa ini, untuk kueri seperti "berita ekonomi terbaru" hasil ekonomi tenggelam di
  // antara berita umum (bola/politik) karena semuanya dapat recency bonus yang sama.
  const topicWords = (cleanQuery.toLowerCase().match(/[a-z]{4,}/g) || [])
    .filter((wd) => !/^(?:berita|kabar|terbaru|terkini|headline|news|update|info|informasi|hari|dengan|untuk|yang|tentang|apa|saja|dong|nanti|sekarang|carikan|infokan|tampilkan|berikan|coba)$/.test(wd))
    .slice(0, 4);
  if (topicWords.length > 0) {
    for (const s of structuredSnippets) {
      const hay = s.text.toLowerCase();
      const hits = topicWords.filter((wd) => hay.includes(wd)).length;
      if (hits > 0) s.score += hits * 18; // bonus proporsional jumlah kata topik yang cocok
    }
  }

  // Ambil lebih banyak sumber (20) agar pengetahuan lebih luas — model memilih yang relevan.
  // JAMINAN: isi halaman hasil deep-scrape (konten artikel penuh, paling kaya) SELALU ikut
  // masuk walau kalah skor dari feed topik — tanpa ini ia terpotong slice dan hilang
  // (bug nyata: scrape jalan 7 halaman tapi 0 yang sampai ke konteks model).
  const scrapedBlocks = structuredSnippets.filter((s) => s.text.startsWith('[Isi Halaman Web') || s.text.startsWith('[Halaman Terkait') || s.text.startsWith('[Isi Lengkap Halaman Web'));
  const scrapedSet = new Set(scrapedBlocks.map((s) => s.text));
  const others = structuredSnippets.filter((s) => !scrapedSet.has(s.text));
  const selected = [
    ...scrapedBlocks.slice(0, 5).map((s) => s.text),
    ...others.slice(0, 20).map((s) => s.text),
  ];
  const finalKnowledge = selected.join('\n\n');

  // Simpan hasil ke Persistent Knowledge Memory secara non-blocking.
  // Kueri berita & kueri ber-URL TIDAK disimpan: berita cepat basi, dan kunci entitas
  // kueri ber-URL menabrak kueri lain (URL dibuang saat normalisasi) sehingga jawaban
  // bisa tertukar antar pertanyaan berbeda.
  if (!isNewsLike && !queryHasUrl && finalKnowledge.length > 80) {
    const sourceUrls = Array.from(discoveredUrls).slice(0, 5);
    void saveKnowledge(cleanQuery, finalKnowledge, sourceUrls).catch(() => {});
  }

  return finalKnowledge;
}

