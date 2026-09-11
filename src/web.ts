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
 * CATATAN: Hanya strip kata sambung/percakapan — JANGAN strip kata teknis
 * seperti "model", "baru", "terbaru", "versi", "update", "rilis", "launch", dsb.
 */
export function extractCoreEntity(query: string): string {
  if (!query || typeof query !== 'string') return '';
  const qNorm = query
    .toLowerCase()
    .replace(/https?:\/\/[^\s"'<>()]+/gi, ' ')
    .replace(/www\.[a-z0-9-]+\.[a-z]{2,}(?:\/[^\s"'<>()]*)?/gi, ' ')
    // Hanya strip filler percakapan, BUKAN kata teknis/informasional
    .replace(
      /\b(apakah|tolong|coba|carikan|cari|dong|sih|deh|web\s+nya|pokonya|pokoknya|namanya|bisa|dipercaya|apaan|dan|di|ke|dari|adalah|mengenai|gimana|bagaimana|kabar|infokan|berikan|sama\s+kamu|menurutmu|menurut\s+anda|tolong\s+carikan|tolong\s+cari|sebutkan|jelaskan)\b/gi,
      ' ',
    )
    .replace(/[^\w\s.-]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return qNorm.slice(0, 120);
}

/** Deteksi apakah query berhubungan dengan informasi terkini / real-time
 * Mencakup semua variasi temporal bahasa Indonesia & Inggris:
 * - Kata waktu relatif: sekarang, saat ini, hari ini, minggu ini, bulan ini, tahun ini
 * - Kata kualitas informasi: terbaru, terkini, baru, latest, new, current, now
 * - Kata perubahan: update, diperbarui, berubah, naik, turun, rilis
 * - Tahun eksplisit: 2023–2030
 */
function isRecencyQuery(query: string): boolean {
  return /\b(terbaru|terkini|baru|sekarang|saat\s*ini|kini|hari\s*ini|minggu\s*ini|bulan\s*ini|tahun\s*ini|malam\s*ini|siang\s*ini|pagi\s*ini|sore\s*ini|tadi|barusan|baru\s*saja|kemarin|besok|latest|new|current|now|today|tonight|update|updated|diperbarui|berubah|naik|turun|versi|version|rilis|release|launch|announced|diluncurkan|diumumkan|terkini|aktual|real-time|realtime|live|breaking|trending|viral|populer|202[3-9]|203[0-9])\b/i.test(query);
}

/** Deteksi apakah query tentang AI/teknologi (nama model, framework, tools) */
function isTechQuery(query: string): boolean {
  return /\b(gpt|claude|gemini|llm|ai|model|mistral|qwen|llama|deepseek|openai|anthropic|google|meta|nvidia|framework|library|sdk|api|github|release|versi|version)\b/i.test(query);
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

  const queries: string[] = [];
  if (targetSubject.length >= 2) {
    // Query utama — selalu sertakan subject lengkap
    queries.push(targetSubject);

    // Untuk query tentang hal terkini / teknologi, tambahkan anchor waktu
    if (isRecencyQuery(query) || isTechQuery(query)) {
      const currentYear = new Date().getFullYear();
      queries.push(`${targetSubject} ${currentYear}`);
      queries.push(`${targetSubject} latest release announcement`);
      queries.push(`${targetSubject} site:github.com OR site:huggingface.co OR site:openai.com OR site:anthropic.com`);
    } else {
      queries.push(`${targetSubject} terbaru`);
      queries.push(`${targetSubject} info`);
    }
  } else {
    queries.push(query.trim().slice(0, 80));
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

    // 2a. Bing Web Search — jalankan 2 query paralel untuk cakupan lebih luas
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
              const citeMatch = chunk.match(/<cite>([\s\S]*?)<\/cite>/i);
              const titleMatch = chunk.match(/<h2><a[^>]*>([\s\S]*?)<\/a><\/h2>/i) || chunk.match(/<h2[^>]*><a[^>]*>([\s\S]*?)<\/a>/i);
              const descMatch = chunk.match(/<div class="b_caption">[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/i);

              const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : '';
              const cite = citeMatch ? citeMatch[1].replace(/<[^>]+>/g, '').trim() : '';
              const desc = descMatch ? descMatch[1].replace(/<[^>]+>/g, '').trim() : '';

              // Ekstrak URL website asli dari cite
              let directUrl = '';
              const domainFromCite = cite.match(/https?:\/\/[^\s›>]+/i) || cite.match(/^([a-z0-9-]+\.[a-z0-9.-]+)/i);
              if (domainFromCite) {
                directUrl = domainFromCite[0].startsWith('http') ? domainFromCite[0] : `https://${domainFromCite[0]}`;
                if (!directUrl.includes('bing.com') && !directUrl.includes('microsoft.com') && isSafePublicUrl(directUrl)) {
                  discoveredUrls.add(directUrl);
                }
              }

              if (title || desc) {
                addSnippet(`Bing Web`, title || cite, desc, '', directUrl, 55);
              }
            }
          })
          .catch(() => {}),
      );
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
            if (tm) addSnippet('Google Berita', tm[1], dm ? dm[1] : '', pm ? pm[1] : '', lm ? lm[1] : '', 40);
          }
        })
        .catch(() => {}),
    );

    // 2c. Wikipedia (ID & EN)
    fetches.push(
      fetch(`https://id.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(entityQ)}&format=json&origin=*`, {
        headers: { 'User-Agent': 'FreeAIBot/2026' },
        signal: controller.signal,
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          const hits = (data as { query?: { search?: Array<{ title: string; snippet: string }> } })?.query?.search;
          if (Array.isArray(hits) && hits.length > 0) {
            const top = hits[0];
            addSnippet('Wikipedia Indonesia', top.title, top.snippet, '', `https://id.wikipedia.org/wiki/${encodeURIComponent(top.title)}`, 35);
          }
        })
        .catch(() => {}),
    );

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

  // 3. Autonomous Deep Web Scraping untuk Discovered URL Teratas
  // Selalu aktif jika Bing menemukan URL — tidak ada kondisi topik.
  // Filosofi: jika web sudah menemukan halaman relevan, baca isinya langsung.
  // Hanya skip untuk situs sosial/kamus yang tidak informatif.
  if (targetUrls.size === 0 && discoveredUrls.size > 0) {
    const candidates = Array.from(discoveredUrls).filter(
      (u) => !/(kbbi\.|wikipedia\.org|youtube\.com|facebook\.com|instagram\.com|tiktok\.com|twitter\.com|x\.com)/i.test(u),
    );
    const topDiscovered = candidates[0];
    if (topDiscovered) {
      try {
        const deepScraped = await scrapeWebpage(topDiscovered);
        if (deepScraped && deepScraped.length > 80) {
          let host = topDiscovered;
          try {
            host = new URL(topDiscovered).hostname;
          } catch {
            // abaikan
          }
          structuredSnippets.unshift({
            text: `[Isi Lengkap Halaman Web (${host})]:\n${deepScraped.slice(0, 4500)}`,
            timestamp: Date.now() + 500_000_000,
            score: 95,
          });
        }
      } catch {
        // abaikan jika gagal deep scrape
      }
    }
  }

  if (structuredSnippets.length === 0) return '';

  // Urutkan bukti: artikel terbaca langsung di paling atas, kemudian berdasarkan recency & relevansi skor
  structuredSnippets.sort((a, b) => b.score - a.score || b.timestamp - a.timestamp);

  const selected = structuredSnippets.slice(0, 10).map((s) => s.text);
  return selected.join('\n\n');
}

