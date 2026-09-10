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
  if (q.length < 3) return false;

  // Jika ada URL atau nama domain, WAJIB search / browse
  if (/https?:\/\/[^\s"'<>]+/i.test(q) || /\b[a-z0-9-]+\.(?:com|org|io|net|id|ai|dev|app|edu|gov)\b/i.test(q)) {
    return true;
  }

  const qNorm = q.toLowerCase().replace(/[?!.,]/g, '').replace(/\s+/g, ' ').trim();

  // Sapaan murni & penutup santai: TIDAK perlu search
  const isCasualGreeting = /^(halo|hai|hey|hei|assalamu(?:'|a)?laikum|selamat\s*(?:pagi|siang|sore|malam)|pagi|siang|sore|malam|tes|test|ping|apa kabar|makasih|terima kasih|thanks|thx|oke|ok|sip|siap|mantap|keren|yup|yes|ya|iya|bye|dadah)$/i.test(
    qNorm,
  );
  if (isCasualGreeting) return false;

  // Pertanyaan identitas murni: TIDAK perlu search
  const isIdentity = /^(kamu siapa|siapa kamu|kamu model apa|model apa kamu|kamu ai apa|kamu ini apa|siapa namamu|namamu siapa|who are you|what are you|what model are you)$/i.test(
    qNorm,
  );
  if (isIdentity) return false;

  // Pertanyaan waktu/jam lokal murni: TIDAK perlu search
  const isClockOnly = /^(jam berapa|sekarang jam berapa|jam berapa sekarang|hari apa sekarang|sekarang hari apa|tanggal berapa sekarang|sekarang tanggal berapa|pukul berapa)$/i.test(
    qNorm,
  );
  if (isClockOnly) return false;

  // Seluruh pertanyaan faktual, informasi, berita, komparasi, tutorial, atau perintah: SEARCH LIVE
  return true;
}

/** Generator kueri cerdas paralel berbasis subjek faktual tanpa filler */
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

  const qNorm = query
    .toLowerCase()
    .replace(/\bperilisann+\b/g, 'perilisan')
    .replace(/\bterbaruu+\b/g, 'terbaru')
    .replace(/\bapaan\b|\bapaann+\b|\bapahh+\b/g, 'apa')
    .replace(/\bkloo+\b|\bklo\b/g, 'kalau')
    .replace(/\bgimna\b|\bgmn\b|\bgmana\b/g, 'bagaimana')
    .replace(/\bknapa\b|\bknp\b/g, 'kenapa')
    .replace(/\bbgtu\b|\bbgt\b/g, 'begitu')
    .replace(/\bdgn\b/g, 'dengan')
    .replace(/\byg\b/g, 'yang')
    .replace(/\btp\b/g, 'tapi')
    .replace(/\budh\b|\bsdh\b/g, 'sudah')
    .replace(/\bblm\b/g, 'belum')
    .replace(/\bjg\b/g, 'juga')
    .replace(/\bbsa\b/g, 'bisa');

  const stripFillers = (text: string) =>
    text
      .replace(
        /\b(lah|kan|deh|dong|sih|kek|kok|ko|ah|eh|oh|nah|ya|yah|nih|tuh|sudah|udah|sdh|udh|belum|blm|tapi|tp|dan|atau|itu|ini|dari|pada|ke|di|yang|yg|tolong|coba|jelaskan|analisis|bagaimana|apa|apaan|siapa|kapan|kenapa|mengapa|dimana|apakah|menurutmu|menurut anda|kalo|kalau|gimana|gimna|gmn|gmana|kabar|info|infokan|berikan|sebutkan|tentang|mengenai|soal|terkait|berita terbaru|berita terkini|kabar terbaru|kabar terkini|kelanjutan|update|terbaru|terkini|knapa|min|gan|kak|bro|perilisan|rilis|saat ini|hari ini|sekarang|era|cari|carikan|mencari)\b/gi,
        ' ',
      )
      .replace(/[^\w\s.-]/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  const coreSubject = stripFillers(qNorm).slice(0, 80);
  const strippedEntity = coreSubject.replace(/\b(model|versi|seri)\b/gi, ' ').replace(/\s+/g, ' ').trim();
  const targetSubject = strippedEntity || coreSubject || qNorm.slice(0, 60);

  const queries: string[] = [];
  if (targetSubject.length >= 2) {
    queries.push(`${targetSubject} latest official news update`);
    queries.push(`${targetSubject} rilis pembaruan berita terkini`);
    queries.push(`${targetSubject} release ${new Date().getFullYear()}`);
    queries.push(targetSubject);
  } else {
    queries.push(query.trim().slice(0, 60));
  }

  return Array.from(new Set(queries)).filter((q) => q.length >= 2).slice(0, 4);
}

/** Kompatibilitas fungsi keywords sebelumnya */
export function keywords(query: string): string {
  const queries = formulateSmartSearchQueries(query);
  return queries[0] ?? query.slice(0, 60);
}

/**
 * Mesin Penelusuran Internet Bebas & Menyeluruh:
 * - Mendeteksi dan men-scrape URL publik secara langsung via Jina AI / Fetch
 * - Melakukan pencarian paralel ke Google News Global, Google News Indonesia, Bing News, Hacker News, Wikipedia, dan arXiv
 * - Menyaring, menduplikasi, dan menyusun bukti menjadi Markdown faktual siap santap untuk AI
 */
export async function searchWeb(query: string): Promise<string> {
  if (!query || typeof query !== 'string' || query.trim().length < 2) return '';

  const cleanQuery = query.trim();
  const structuredSnippets: Array<{ text: string; timestamp: number; score: number }> = [];
  const seenTitles = new Set<string>();

  // 1. Deteksi URL eksplisit atau nama domain yang disebutkan user
  const explicitUrls = cleanQuery.match(/https?:\/\/[^\s"'<>]+/gi) || [];
  const domainMatches = cleanQuery.match(/\b([a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:ai|com|org|io|net|id|co|dev|app|edu|gov)(?:\/[^\s"'<>]*)?)\b/gi) || [];
  const targetUrls = new Set<string>(explicitUrls);
  for (const d of domainMatches) {
    if (!Array.from(targetUrls).some((u) => u.includes(d))) {
      targetUrls.add(`https://${d}`);
    }
  }

  // Jika user menyertakan URL, scrape langsung halaman tersebut
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
            text: `[Halaman Web Terbaca (${host})]:\n${scraped.slice(0, 3500)}`,
            timestamp: Date.now() + 1_000_000_000,
            score: 100,
          });
        }
      } catch {
        // lanjut ke pencarian mesin
      }
    }
  }

  // 2. Formulasi kueri pencarian multi-engine
  const searchQueries = formulateSmartSearchQueries(cleanQuery);
  const primaryQ = searchQueries[0] ?? cleanQuery.slice(0, 60);
  const secondaryQ = searchQueries[1] ?? primaryQ;
  const entityQ = searchQueries[searchQueries.length - 1] ?? primaryQ;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6500);

  const dedupeKey = (str: string) =>
    str
      .replace(/\s*[-–—|]\s*[^-–—|]+$/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 70);

  const addSnippet = (source: string, title: string, desc: string, pubDate: string, link: string) => {
    if (!title || isJunkArticle(title)) return;
    const cleanT = cleanStr(title);
    const key = dedupeKey(cleanT);
    if (seenTitles.has(key)) return;
    seenTitles.add(key);

    let ts = 0;
    let recencyBonus = 0;
    if (pubDate) {
      const parsed = new Date(pubDate).getTime();
      if (!isNaN(parsed)) {
        ts = parsed;
        const daysOld = (Date.now() - parsed) / (1000 * 60 * 60 * 24);
        if (daysOld <= 1) recencyBonus = 50;
        else if (daysOld <= 7) recencyBonus = 35;
        else if (daysOld <= 30) recencyBonus = 20;
        else if (daysOld <= 90) recencyBonus = 10;
        else if (daysOld > 180) recencyBonus = -30;
      }
    }

    const cleanD = cleanStr(desc || '').slice(0, 250);
    const linkSuffix = link && isSafePublicUrl(link) && !link.includes('news.google.com') && !link.includes('bing.com') ? ` | Sumber: ${link}` : '';
    const fullText = cleanD && cleanD.length > 20 ? `${cleanT} — ${cleanD}` : cleanT;
    const dateStr = pubDate ? ` (${pubDate.slice(0, 16)})` : '';

    structuredSnippets.push({
      text: `[${source}${dateStr}${linkSuffix}]: ${fullText}`,
      timestamp: ts,
      score: 10 + recencyBonus,
    });
  };

  const cleanRawLower = cleanQuery.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const isGeneralNews =
    /^(?:infokan|tampilkan|berikan|cari|carikan|apa|ada)?\s*(?:berita|kabar|news|headline|peristiwa)\s*(?:hari\s*ini|terkini|terbaru|pagi\s*ini|siang\s*ini|sore\s*ini|malam\s*ini|saat\s*ini|update)?$/i.test(
      cleanRawLower,
    ) ||
    /^(?:berita|kabar|news|headline)\s*(?:hari\s*ini|terkini|terbaru)$/i.test(cleanRawLower) ||
    /\b(?:berita|kabar|peristiwa|headline)\s+(?:hari\s*ini|terkini|terbaru)\b/i.test(cleanQuery) ||
    /\b(?:berita|kabar|news)\s+terkini\b/i.test(cleanQuery) ||
    /^(?:ada\s+berita\s+apa|apa\s+berita\s+hari\s+ini|berita\s+apa\s+hari\s+ini)/i.test(cleanRawLower);

  try {
    const fetches: Array<Promise<void>> = [];

    // 2a. Top Headlines Indonesia & Global RSS (Langsung menarik tajuk berita hari ini jika kueri umum)
    if (isGeneralNews) {
      fetches.push(
        fetch(`https://news.google.com/rss?hl=id&gl=ID&ceid=ID:id`, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
          signal: controller.signal,
        })
          .then((r) => (r.ok ? r.text() : ''))
          .then((txt) => {
            if (!txt) return;
            const items = txt.match(/<item>[\s\S]*?<\/item>/gi) || [];
            for (const item of items.slice(0, 10)) {
              const tm = item.match(/<title>([\s\S]*?)<\/title>/i);
              const dm = item.match(/<description>([\s\S]*?)<\/description>/i);
              const pm = item.match(/<pubDate>([\s\S]*?)<\/pubDate>/i);
              const lm = item.match(/<link>([\s\S]*?)<\/link>/i);
              addSnippet('Google Berita Indonesia', tm ? tm[1] : '', dm ? dm[1] : '', pm ? pm[1] : '', lm ? lm[1] : '');
            }
          })
          .catch(() => {}),
        fetch(`https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en`, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
          signal: controller.signal,
        })
          .then((r) => (r.ok ? r.text() : ''))
          .then((txt) => {
            if (!txt) return;
            const items = txt.match(/<item>[\s\S]*?<\/item>/gi) || [];
            for (const item of items.slice(0, 10)) {
              const tm = item.match(/<title>([\s\S]*?)<\/title>/i);
              const dm = item.match(/<description>([\s\S]*?)<\/description>/i);
              const pm = item.match(/<pubDate>([\s\S]*?)<\/pubDate>/i);
              const lm = item.match(/<link>([\s\S]*?)<\/link>/i);
              addSnippet('Google News Global', tm ? tm[1] : '', dm ? dm[1] : '', pm ? pm[1] : '', lm ? lm[1] : '');
            }
          })
          .catch(() => {}),
      );
    }

    // 2a. Google News Global RSS
    fetches.push(
      fetch(`https://news.google.com/rss/search?q=${encodeURIComponent(primaryQ)}&hl=en-US&gl=US&ceid=US:en`, {
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
            addSnippet('Google News Global', tm ? tm[1] : '', dm ? dm[1] : '', pm ? pm[1] : '', lm ? lm[1] : '');
          }
        })
        .catch(() => {}),
    );

    // 2b. Google News Indonesia RSS
    fetches.push(
      fetch(`https://news.google.com/rss/search?q=${encodeURIComponent(secondaryQ)}&hl=id&gl=ID&ceid=ID:id`, {
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
            addSnippet('Google Berita Indonesia', tm ? tm[1] : '', dm ? dm[1] : '', pm ? pm[1] : '', lm ? lm[1] : '');
          }
        })
        .catch(() => {}),
    );

    // 2c. Bing News RSS
    fetches.push(
      fetch(`https://www.bing.com/news/search?q=${encodeURIComponent(primaryQ)}&format=rss`, {
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
            addSnippet('Bing News', tm ? tm[1] : '', dm ? dm[1] : '', pm ? pm[1] : '', lm ? lm[1] : '');
          }
        })
        .catch(() => {}),
    );

    // 2d. Hacker News Algolia (Berita teknologi/AI global mutakhir)
    fetches.push(
      fetch(`https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(entityQ)}&tags=story&hitsPerPage=4`, {
        headers: { 'User-Agent': 'FreeAIBot/2026' },
        signal: controller.signal,
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          const hits = (data as { hits?: Array<{ title?: string; story_title?: string; url?: string; created_at?: string }> })?.hits;
          if (Array.isArray(hits)) {
            for (const h of hits) {
              const t = h.title || h.story_title || '';
              if (t) addSnippet('Hacker News Tech', t, '', h.created_at || '', h.url || '');
            }
          }
        })
        .catch(() => {}),
    );

    // 2e. Wikipedia ID & EN
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
            addSnippet('Wikipedia Indonesia', top.title, top.snippet, '', `https://id.wikipedia.org/wiki/${encodeURIComponent(top.title)}`);
          }
        })
        .catch(() => {}),
    );

    fetches.push(
      fetch(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(entityQ)}&format=json&origin=*`, {
        headers: { 'User-Agent': 'FreeAIBot/2026' },
        signal: controller.signal,
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          const hits = (data as { query?: { search?: Array<{ title: string; snippet: string }> } })?.query?.search;
          if (Array.isArray(hits) && hits.length > 0) {
            const top = hits[0];
            addSnippet('Wikipedia English', top.title, top.snippet, '', `https://en.wikipedia.org/wiki/${encodeURIComponent(top.title)}`);
          }
        })
        .catch(() => {}),
    );

    // 2f. arXiv (jika kueri ilmiah/makalah/paper/riset)
    if (/\b(paper|jurnal|makalah|arxiv|penelitian|riset|skripsi|algorithm|teori)\b/i.test(cleanQuery)) {
      fetches.push(
        fetch(`https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(entityQ)}&start=0&max_results=2`, {
          headers: { 'User-Agent': 'FreeAIBot/2026' },
          signal: controller.signal,
        })
          .then((r) => (r.ok ? r.text() : ''))
          .then((xml) => {
            if (!xml) return;
            const entries = xml.match(/<entry>[\s\S]*?<\/entry>/gi) || [];
            for (const entry of entries) {
              const tm = entry.match(/<title>([\s\S]*?)<\/title>/i);
              const sm = entry.match(/<summary>([\s\S]*?)<\/summary>/i);
              const lm = entry.match(/<id>([\s\S]*?)<\/id>/i);
              const pm = entry.match(/<published>([\s\S]*?)<\/published>/i);
              if (tm) addSnippet('arXiv Preprints', tm[1], sm ? sm[1].slice(0, 200) : '', pm ? pm[1] : '', lm ? lm[1] : '');
            }
          })
          .catch(() => {}),
      );
    }

    await Promise.allSettled(fetches);
  } finally {
    clearTimeout(timeout);
  }

  if (structuredSnippets.length === 0) return '';

  // Urutkan bukti: artikel terbaca langsung di paling atas, kemudian berdasarkan recency & relevansi
  structuredSnippets.sort((a, b) => {
    if (a.score >= 100 || b.score >= 100) return b.score - a.score;
    return b.timestamp - a.timestamp || b.score - a.score;
  });

  const selected = structuredSnippets.slice(0, 12).map((s) => s.text);
  return selected.join('\n\n');
}
