// Mesin Pencari & Penjelajah Web Bebas Real-Time 2026 (Zero-API-Key)
// Menggabungkan Google News Global & ID, Bing News, Hacker News, Wikipedia (ID/EN), arXiv, serta Deep Webpage Scraper & Jina Reader.
// Diadaptasi dari arsitektur teruji Terminal AI Portofolio Rafly Firmansyah.

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
    '&mdash;': '—',
    '&ndash;': '–',
  };
  return str
    .replace(/<[^>]+>/g, '')
    .replace(/&(?:quot|#39|amp|lt|gt|nbsp|mdash|ndash);/g, (m) => entityMap[m] || m)
    .replace(/\s+/g, ' ')
    .trim();
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

  // 1. Coba Jina AI LLM Reader (merender SPA dan Javascript menjadi Markdown)
  try {
    const jinaRes = await fetch(`https://r.jina.ai/${url}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'text/plain',
      },
      signal: AbortSignal.timeout(5000),
    });
    if (jinaRes.ok) {
      const text = await jinaRes.text();
      if (text && text.length > 80) {
        return text.slice(0, 5000).trim();
      }
    }
  } catch {
    // abaikan fallback ke direct fetch
  }

  // 2. Direct fetch fallback
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 FreeAIBot/2026',
        Accept: 'text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.5',
      },
      signal: AbortSignal.timeout(4500),
    });
    if (res.ok) {
      const raw = await res.text();
      const parsed = extractFitMarkdownContent(raw);
      if (parsed && parsed.length > 80) return parsed;
    }
  } catch {
    // gagal scrape
  }

  return '';
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

  const qNorm = q.toLowerCase().replace(/[?!.,]/g, '').replace(/\s+/g, ' ').trim();

  // 2. Sapaan murni dan ucapan terima kasih pendek: lewati search
  if (
    /^(?:halo|hai|hey|hei|assalamu(?:'|a)?laikum|selamat\s*(?:pagi|siang|sore|malam)|pagi|siang|sore|malam)(?:\s+(?:halo|hai|hey|hei|apa kabar|kawan|bro|kak|min|semuanya|sahabat))?$/i.test(qNorm) ||
    /^(?:apa kabar|gimana kabarnya|kabarmu gimana|makasih|terima kasih|thanks|thx|oke|ok|sip|siap|mantap|keren|yup|yes|ya|iya|bye|dadah)$/i.test(qNorm)
  ) {
    return false;
  }

  // 3. Pertanyaan identitas murni bot: TIDAK perlu search
  if (/^(kamu siapa|siapa kamu|kamu model apa|model apa kamu|kamu ai apa|kamu ini apa|siapa namamu|namamu siapa|who are you|what are you|what model are you)$/i.test(qNorm)) {
    return false;
  }

  // 4. Pertanyaan waktu/jam lokal murni: TIDAK perlu search
  if (/^(jam berapa|sekarang jam berapa|jam berapa sekarang|hari apa sekarang|sekarang hari apa|tanggal berapa sekarang|sekarang tanggal berapa|pukul berapa)$/i.test(qNorm)) {
    return false;
  }

  // 5. Soal aritmatika murni tanpa teks kata: e.g. "12 + 15" atau "50 * 4 / 2"
  if (/^[\d\s+\-*/^()=.,]+$/.test(qNorm)) {
    return false;
  }

  // Seluruh pertanyaan fakta, website, informasi, nama produk, kata kunci, opini web: SEARCH LIVE
  return true;
}

/** Ekstrak entitas inti kueri penelusuran tanpa filler percakapan
 * Strip dua kategori:
 * 1. Kata filler percakapan: tolong, carikan, dong, sih, deh, dll.
 * 2. Kata penunjuk/tanya murni: itu, ini, yang, yg, apa — bukan konten
 * JANGAN strip: model, terbaru, baru, terkini, versi, info, web (kata konten)
 */
export function extractCoreEntity(query: string): string {
  if (!query || typeof query !== 'string') return '';
  const qNorm = query
    .toLowerCase()
    .replace(/https?:\/\/[^\s"'<>()]+/gi, ' ')
    .replace(/www\.[a-z0-9-]+\.[a-z]{2,}(?:\/[^\s"'<>()]*)?/gi, ' ')
    .replace(
      /\b(apakah|tolong|coba|carikan|cari|dong|sih|deh|lah|nih|web\s+nya|pokonya|pokoknya|namanya|bisa|dipercaya|apaan|apa|itu|ini|yang|yg|dan|di|ke|dari|adalah|mengenai|gimana|bagaimana|kabar|infokan|berikan|sama\s+kamu|menurutmu|menurut\s+anda|tolong\s+carikan|tolong\s+cari|sebutkan|jelaskan|tentang)\b/gi,
      ' ',
    )
    .replace(/[^\w\s.-]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return qNorm.slice(0, 120);
}

/** Deteksi apakah query berhubungan dengan informasi terkini / real-time */
function isRecencyQuery(query: string): boolean {
  return /\b(terbaru|terkini|baru|sekarang|saat\s*ini|kini|hari\s*ini|minggu\s*ini|bulan\s*ini|tahun\s*ini|malam\s*ini|siang\s*ini|pagi\s*ini|sore\s*ini|tadi|barusan|baru\s*saja|kemarin|besok|latest|new|current|now|today|tonight|update|updated|diperbarui|berubah|naik|turun|versi|version|rilis|release|launch|announced|diluncurkan|diumumkan|aktual|real-time|realtime|live|breaking|trending|viral|populer|202[3-9]|203[0-9])\b/i.test(query);
}

/** Deteksi apakah query tentang AI/teknologi */
function isTechQuery(query: string): boolean {
  return /\b(gpt|claude|gemini|llm|ai|model|mistral|qwen|llama|deepseek|openai|anthropic|google|meta|nvidia|framework|library|sdk|api|github|release|versi|version|agentrouter|huggingface|ollama|groq|xkiro|openrouter)\b/i.test(query);
}

/**
 * Ekstrak nama brand/produk tech dari query Indonesia dan bangun query Inggris bersih.
 * Contoh: "model terbaru claude" → "claude latest model 2026"
 * Ini penting karena Bing setlang=en bekerja lebih baik dengan query English.
 */
function extractEnglishTechQuery(query: string, currentYear: number): string | null {
  const lower = query.toLowerCase();
  // Daftar brand tech yang dikenali
  const techBrands = [
    'claude', 'anthropic', 'gpt', 'openai', 'chatgpt', 'gemini', 'google',
    'mistral', 'qwen', 'llama', 'deepseek', 'meta', 'nvidia', 'groq',
    'agentrouter', 'huggingface', 'ollama', 'openrouter', 'xkiro',
    'perplexity', 'cohere', 'grok', 'x.ai', 'copilot', 'microsoft',
    'stable diffusion', 'midjourney', 'runway', 'sora',
  ];
  const foundBrands = techBrands.filter((b) => lower.includes(b));
  if (foundBrands.length === 0) return null;

  const entity = foundBrands.join(' ');
  const isLatest = isRecencyQuery(query);
  // Deteksi konteks: model, versi, update, rilis
  const isModelContext = /\b(model|versi|version|rilis|release|update|terbaru|latest|new)\b/i.test(query);

  if (isLatest && isModelContext) return `${entity} latest model release ${currentYear}`;
  if (isLatest) return `${entity} latest update ${currentYear}`;
  if (isModelContext) return `${entity} model ${currentYear}`;
  return `${entity} ${currentYear}`;
}

/** Generator kueri cerdas paralel multi-engine */
export function formulateSmartSearchQueries(query: string): string[] {
  if (!query || typeof query !== 'string') return [];

  const cleanRawLower = query.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const isGeneralNewsQuery =
    /^(?:infokan|tampilkan|berikan|cari|carikan|apa|ada)?\s*(?:berita|kabar|news|headline|peristiwa)\s*(?:hari\s*ini|terkini|terbaru|pagi\s*ini|siang\s*ini|sore\s*ini|malam\s*ini|saat\s*ini|update)?$/i.test(
      cleanRawLower,
    ) ||
    /^(?:berita|kabar|news|headline)\s*(?:hari\s*ini|terkini|terbaru)$/i.test(cleanRawLower) ||
    /\b(?:berita|kabar|peristiwa|headline)\s+(?:hari\s*ini|terkini|terbaru)\b/i.test(query) ||
    /\b(?:berita|kabar|news)\s+terkini\b/i.test(query) ||
    /^(?:ada\s+berita\s+apa|apa\s+berita\s+hari\s+ini|berita\s+apa\s+hari\s+ini)/i.test(cleanRawLower);

  if (isGeneralNewsQuery) {
    return [
      'berita utama terkini hari ini indonesia',
      'top breaking news headlines today',
      'peristiwa penting hari ini indonesia',
    ];
  }

  const coreEntity = extractCoreEntity(query);
  const targetSubject = coreEntity.length >= 2 ? coreEntity : cleanRawLower.slice(0, 80);
  const currentYear = new Date().getFullYear();

  const queries: string[] = [];
  if (targetSubject.length >= 2) {
    queries.push(targetSubject);
    // Selalu anchor tahun untuk semua query
    queries.push(`${targetSubject} ${currentYear}`);

    if (isRecencyQuery(query) || isTechQuery(query)) {
      // Tambahkan versi English yang bersih untuk Bing (lebih efektif)
      const englishQ = extractEnglishTechQuery(query, currentYear);
      if (englishQ) queries.push(englishQ);
      else queries.push(`${targetSubject} latest release announcement ${currentYear}`);
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
export function keywords(query: string): string {
  const queries = formulateSmartSearchQueries(query);
  return queries[0] ?? query.slice(0, 60);
}

/**
 * Mesin Penelusuran & Penjelajahan Web Universal 2026:
 * - Mendeteksi dan men-scrape URL publik mana pun (Jina AI SPA Reader + Direct Fetch).
 * - Menelusuri seluruh indeks web global via Bing Web Search (mencakup situs, link, web app, tools, repo GitHub, dsb).
 * - Melakukan penelusuran berita terkini paralel via Google News (Global & Indonesia).
 * - Menyerap ensiklopedia Wikipedia (ID & EN) dan komunitas teknologi Hacker News.
 * - Secara otomatis melakukan Autonomous Deep-Scraping pada halaman web tujuan teratas yang ditemukan.
 */
export async function searchWeb(query: string): Promise<string> {
  if (!query || typeof query !== 'string' || query.trim().length < 2) return '';

  const cleanQuery = query.trim();
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
    const fullText = cleanD && cleanD.length > 15 ? `${cleanT} — ${cleanD}` : cleanT;
    const dateStr = pubDate ? ` (${pubDate.slice(0, 16)})` : '';

    structuredSnippets.push({
      text: `[${source}${dateStr}${linkSuffix}]: ${fullText}`,
      timestamp: ts,
      score: baseScore + recencyBonus,
    });
  };

  // 1. Deteksi URL eksplisit atau nama domain dalam teks pengguna
  const explicitUrls = cleanQuery.match(/https?:\/\/[^\s"'<>()]+/gi) || [];
  const domainMatches = cleanQuery.match(/\b([a-z0-9][a-z0-9-]{1,62}\.(?:com|org|net|id|ai|io|co|xyz|dev|app|tech|info|biz|me|online|site|store|cloud|edu|gov|cc|tv|ac\.id|co\.id|go\.id|my\.id|web\.id)(?:\/[^\s"'<>()]*)?)\b/gi) || [];
  const targetUrls = new Set<string>(explicitUrls);
  for (const d of domainMatches) {
    targetUrls.add(d.startsWith('http') ? d : `https://${d}`);
  }

  // Jika user menyertakan link/URL, langsung jelajahi dan baca isi halaman web tersebut
  if (targetUrls.size > 0) {
    const urlsToScrape = Array.from(targetUrls).slice(0, 2);
    for (const u of urlsToScrape) {
      try {
        const scraped = await scrapeWebpage(u);
        if (scraped && scraped.length > 50) {
          let host = u;
          try {
            host = new URL(u).hostname;
          } catch {
            // abaikan
          }
          structuredSnippets.push({
            text: `[Isi Lengkap Halaman Web (${host})]:\n${scraped.slice(0, 4500)}`,
            timestamp: Date.now() + 1_000_000_000,
            score: 100,
          });
        }
      } catch {
        // lanjut ke pencarian web
      }
    }
  }

  // 2. Formulasi Kueri Entitas Multi-Engine
  const searchQueries = formulateSmartSearchQueries(cleanQuery);
  const primaryQ = searchQueries[0] ?? cleanQuery.slice(0, 80);
  const secondaryQ = searchQueries[1] ?? primaryQ;
  // entityQ: gunakan query asli (lebih lengkap) untuk Wikipedia & HN — jangan terlalu di-strip
  const entityQ = cleanQuery.slice(0, 100);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6500);

  try {
    const fetches: Array<Promise<void>> = [];

    // 2a. Bing Web Search + DuckDuckGo HTML sebagai backup
    // Bing: 2 query paralel sorted by date
    const bingQueries = [primaryQ, secondaryQ].filter((q, i, arr) => arr.indexOf(q) === i).slice(0, 2);
    for (const bq of bingQueries) {
      fetches.push(
        fetch(`https://www.bing.com/search?q=${encodeURIComponent(bq)}&setlang=en&sortby=Date`, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
            'Accept-Language': 'en-US,en;q=0.9,id-ID;q=0.8,id;q=0.7',
          },
          signal: controller.signal,
        })
          .then((r) => (r.ok ? r.text() : ''))
          .then((html) => {
            if (!html) return;
            // Parser utama: b_algo list
            const items = html.split('<li class="b_algo"');
            for (let i = 1; i < Math.min(items.length, 8); i++) {
              const chunk = items[i];
              const citeMatch = chunk.match(/<cite>([\s\S]*?)<\/cite>/i);
              const titleMatch = chunk.match(/<h2><a[^>]*>([\s\S]*?)<\/a><\/h2>/i) || chunk.match(/<h2[^>]*><a[^>]*>([\s\S]*?)<\/a>/i);
              const descMatch = chunk.match(/<div class="b_caption">[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/i)
                || chunk.match(/<p class="b_lineclamp[^"]*"[^>]*>([\s\S]*?)<\/p>/i)
                || chunk.match(/<p[^>]*>([\s\S]{20,300}?)<\/p>/i);

              const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : '';
              const cite = citeMatch ? citeMatch[1].replace(/<[^>]+>/g, '').trim() : '';
              const desc = descMatch ? descMatch[1].replace(/<[^>]+>/g, '').trim() : '';

              let directUrl = '';
              const domainFromCite = cite.match(/https?:\/\/[^\s›>]+/i) || cite.match(/^([a-z0-9-]+\.[a-z0-9.-]+)/i);
              if (domainFromCite) {
                directUrl = domainFromCite[0].startsWith('http') ? domainFromCite[0] : `https://${domainFromCite[0]}`;
                if (!directUrl.includes('bing.com') && !directUrl.includes('microsoft.com') && isSafePublicUrl(directUrl)) {
                  discoveredUrls.add(directUrl);
                }
              }
              if (title || desc) addSnippet('Bing Web', title || cite, desc, '', directUrl, 55);
            }

            // Fallback parser jika b_algo tidak ditemukan (Bing ganti struktur HTML)
            if (items.length <= 1) {
              const linkMatches = html.matchAll(/<a[^>]+href="(https?:\/\/(?!www\.bing\.)[^"]+)"[^>]*>([^<]{10,120})<\/a>/gi);
              let count = 0;
              for (const m of linkMatches) {
                if (count >= 6) break;
                const url = m[1]; const title = m[2].trim();
                if (isSafePublicUrl(url) && !/(bing\.com|microsoft\.com|msn\.com)/i.test(url)) {
                  discoveredUrls.add(url);
                  addSnippet('Bing Web (fallback)', title, '', '', url, 40);
                  count++;
                }
              }
            }
          })
          .catch(() => {}),
      );
    }

    // 2a-2. DuckDuckGo HTML — engine independen, tidak bergantung Bing
    const englishQ = searchQueries[2] ?? primaryQ; // gunakan English query jika ada
    fetches.push(
      fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(englishQ)}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        signal: controller.signal,
      })
        .then((r) => (r.ok ? r.text() : ''))
        .then((html) => {
          if (!html) return;
          const results = html.split('class="result__body"');
          for (let i = 1; i < Math.min(results.length, 6); i++) {
            const chunk = results[i];
            const titleM = chunk.match(/class="result__a"[^>]*>([\s\S]*?)<\/a>/i);
            const snippetM = chunk.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i)
              || chunk.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/span>/i);
            const urlM = chunk.match(/class="result__url"[^>]*>([\s\S]*?)<\/a>/i)
              || chunk.match(/href="(\/\/duckduckgo\.com\/l\/[^"]+)"/i);

            const title = titleM ? titleM[1].replace(/<[^>]+>/g, '').trim() : '';
            const snippet = snippetM ? snippetM[1].replace(/<[^>]+>/g, '').trim() : '';
            let url = '';
            if (urlM) {
              const rawUrl = urlM[1].replace(/<[^>]+>/g, '').trim();
              url = rawUrl.startsWith('//') ? `https:${rawUrl}` : rawUrl;
            }
            if ((title || snippet) && url && isSafePublicUrl(url)) {
              discoveredUrls.add(url);
              addSnippet('DuckDuckGo', title, snippet, '', url, 52);
            }
          }
        })
        .catch(() => {}),
    );

    // 2a-3. Direct scrape sumber resmi brand saat query tentang tech brand spesifik
    // URL dipilih yang bisa dibaca Jina AI (hindari SPA murni tanpa konten HTML)
    // Untuk SPA: Jina AI tetap dapat render, tapi halaman /news atau /blog lebih baik
    const brandNewsPages: Record<string, string[]> = {
      claude:      ['https://www.anthropic.com/news', 'https://docs.anthropic.com/en/release-notes/overview'],
      anthropic:   ['https://www.anthropic.com/news', 'https://docs.anthropic.com/en/release-notes/overview'],
      openai:      ['https://openai.com/news', 'https://openai.com/blog'],
      chatgpt:     ['https://openai.com/news', 'https://openai.com/blog'],
      gpt:         ['https://openai.com/news', 'https://openai.com/blog'],
      gemini:      ['https://blog.google/technology/google-deepmind/', 'https://ai.google.dev/gemini-api/docs/changelog'],
      google:      ['https://blog.google/technology/ai/'],
      mistral:     ['https://mistral.ai/news/', 'https://huggingface.co/mistralai'],
      groq:        ['https://groq.com/blog/', 'https://console.groq.com/docs/changelog'],
      deepseek:    ['https://huggingface.co/deepseek-ai', 'https://github.com/deepseek-ai/DeepSeek-V3/blob/main/README.md'],
      perplexity:  ['https://www.perplexity.ai/hub/blog'],
      meta:        ['https://ai.meta.com/blog/', 'https://huggingface.co/meta-llama'],
      llama:       ['https://ai.meta.com/blog/', 'https://huggingface.co/meta-llama'],
      qwen:        ['https://huggingface.co/Qwen', 'https://qwenlm.github.io/'],
      cohere:      ['https://cohere.com/blog'],
      nvidia:      ['https://blogs.nvidia.com/blog/category/generative-ai/'],
      grok:        ['https://x.ai/blog', 'https://huggingface.co/xai-org'],
      xai:         ['https://x.ai/blog'],
      microsoft:   ['https://blogs.microsoft.com/ai/', 'https://azure.microsoft.com/en-us/blog/category/ai-and-machine-learning/'],
      copilot:     ['https://blogs.microsoft.com/ai/'],
      midjourney:  ['https://www.midjourney.com/updates'],
      stability:   ['https://stability.ai/news'],
      runway:      ['https://runwayml.com/blog/'],
      sora:        ['https://openai.com/sora'],
      openrouter:  ['https://openrouter.ai/announcements'],
      agentrouter: ['https://agentrouter.org'],
      huggingface: ['https://huggingface.co/blog'],
      ollama:      ['https://ollama.com/blog'],
    };
    const queryLower = cleanQuery.toLowerCase();
    for (const [brand, newsUrls] of Object.entries(brandNewsPages)) {
      if (queryLower.includes(brand)) {
        // Scrape URL pertama; jika gagal/kosong, coba URL kedua (fallback)
        const tryUrls = Array.isArray(newsUrls) ? newsUrls : [newsUrls];
        const scrapeWithFallback = async () => {
          for (const newsUrl of tryUrls) {
            try {
              const content = await scrapeWebpage(newsUrl);
              if (content && content.length > 80) {
                let host = newsUrl;
                try { host = new URL(newsUrl).hostname; } catch { /* */ }
                structuredSnippets.unshift({
                  text: `[Sumber Resmi ${brand.toUpperCase()} (${host})]:\n${content.slice(0, 3000)}`,
                  timestamp: Date.now() + 2_000_000_000,
                  score: 98,
                });
                return; // berhasil, tidak perlu fallback
              }
            } catch { /* coba URL berikutnya */ }
          }
        };
        fetches.push(scrapeWithFallback());
        break; // cukup satu brand per request
      }
    }

    // 2b. Google News Indonesia & Global RSS
    fetches.push(
      fetch(`https://news.google.com/rss/search?q=${encodeURIComponent(primaryQ)}&hl=id&gl=ID&ceid=ID:id`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        signal: controller.signal,
      })
        .then((r) => (r.ok ? r.text() : ''))
        .then((txt) => {
          if (!txt) return;
          const items = txt.match(/<item>[\s\S]*?<\/item>/gi) || [];
          for (const item of items.slice(0, 5)) {
            const tm = item.match(/<title>([\s\S]*?)<\/title>/i);
            const dm = item.match(/<description>([\s\S]*?)<\/description>/i);
            const pm = item.match(/<pubDate>([\s\S]*?)<\/pubDate>/i);
            const lm = item.match(/<link>([\s\S]*?)<\/link>/i);
            if (tm) {
              addSnippet('Google Berita', tm[1], dm ? dm[1] : '', pm ? pm[1] : '', lm ? lm[1] : '', 40);
              // Tambahkan URL artikel ke discoveredUrls untuk di-scrape universal
              if (lm && lm[1] && isSafePublicUrl(lm[1].trim())) {
                discoveredUrls.add(lm[1].trim());
              }
            }
          }
        })
        .catch(() => {}),
    );

    // 2c. Wikipedia ID + EN paralel
    const wikiQueries = [
      { lang: 'id', base: 'https://id.wikipedia.org', label: 'Wikipedia Indonesia', q: entityQ },
      { lang: 'en', base: 'https://en.wikipedia.org', label: 'Wikipedia English', q: searchQueries[2] ?? primaryQ },
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

    // 2d. Hacker News Algolia (Tech & Open-Source)
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

  // 3. Universal Autonomous Deep Web Scraping
  // Scrape top 3 URL dari SEMUA hasil pencarian (Bing + DDG + Google News)
  // Universal: berlaku untuk query apapun, tidak bergantung pada topik atau brand
  const skippedDomains = /(kbbi\.|wikipedia\.org|youtube\.com|facebook\.com|instagram\.com|tiktok\.com|twitter\.com|x\.com|google\.com\/search|bing\.com|duckduckgo\.com)/i;
  const scrapeTargets = [
    // Prioritas: URL yang eksplisit disebut user
    ...Array.from(targetUrls),
    // Lalu URL dari hasil pencarian
    ...Array.from(discoveredUrls).filter((u) => !skippedDomains.test(u)),
  ].slice(0, targetUrls.size > 0 ? 2 : 3); // Scrape maks 3 URL jika tidak ada URL eksplisit

  if (scrapeTargets.length > 0) {
    // Scrape paralel semua target sekaligus
    const scrapeResults = await Promise.allSettled(
      scrapeTargets.map((url) => scrapeWebpage(url).then((content) => ({ url, content })))
    );
    for (const result of scrapeResults) {
      if (result.status === 'fulfilled' && result.value.content && result.value.content.length > 80) {
        const { url, content } = result.value;
        let host = url;
        try { host = new URL(url).hostname; } catch { /* */ }
        structuredSnippets.unshift({
          text: `[Isi Halaman Web (${host})]:\n${content.slice(0, 4000)}`,
          timestamp: Date.now() + 500_000_000,
          score: 95,
        });
      }
    }
  }

  if (structuredSnippets.length === 0) return '';

  // Urutkan bukti: artikel terbaca langsung di paling atas, kemudian berdasarkan recency & relevansi skor
  structuredSnippets.sort((a, b) => b.score - a.score || b.timestamp - a.timestamp);

  const selected = structuredSnippets.slice(0, 14).map((s) => s.text);
  return selected.join('\n\n');
}

