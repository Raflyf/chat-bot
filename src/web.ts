// Lookup internet $0 tanpa API key: Wikipedia (ID + EN fallback) + DuckDuckGo.
// Dilengkapi SSRF guard, timeout cepat, dan fallback multi-bahasa.

export function needsSearch(text: string): boolean {
  return /(terkini|terbaru|hari ini|saat ini|sekarang|tahun 2025|tahun 2026|berita|cari|internet|cuaca|jadwal|saham|kurs|skor|siapa.*(presiden|menteri|juara|pemenang)|kapan|di mana.*(buka|tutup)|rilis|update)/i.test(
    text,
  );
}

async function getJson(url: string): Promise<unknown | null> {
  try {
    // Validasi URL ketat (SSRF Prevention)
    const u = new URL(url);
    if (u.protocol !== 'https:' || !(u.hostname.endsWith('wikipedia.org') || u.hostname.endsWith('duckduckgo.com'))) {
      return null;
    }

    const res = await fetch(url, {
      headers: { 'User-Agent': 'AgentKit/0.9 (Personal AI Assistant)' },
      signal: AbortSignal.timeout(6_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  } catch {
    return null;
  }
}

const STOPWORDS = new Set(
  'siapa,apa,kapan,dimana,di mana,berapa,bagaimana,kenapa,mengapa,tolong,jawab,singkat,jelaskan,cari,carikan,tentang,yang,dan,atau,adalah,itu,ini,saat,kah,apakah,bagaimana,kepada,dari,untuk,dengan,saat ini,sekarang,kak,tolong,mengenai'.split(','),
);

/** Saring kalimat tanya jadi kata kunci pencarian (maks 8 kata). */
export function keywords(query: string): string {
  const words = query
    .toLowerCase()
    .replace(/[?.!,":;()]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
  return words.slice(0, 8).join(' ') || query.slice(0, 80);
}

/** Kembalikan konteks ber-sumber, atau string kosong jika tidak ada hasil. */
export async function searchWeb(query: string): Promise<string> {
  const q = keywords(query);
  const parts: string[] = [];

  // 1. Wikipedia Indonesia
  let title: string | undefined;
  const foundId = (await getJson(
    `https://id.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(q)}&limit=1&namespace=0&format=json`,
  )) as Array<unknown> | null;
  title = Array.isArray(foundId?.[1]) ? (foundId as Array<Array<string>>)[1][0] : undefined;

  let wikiHost = 'id.wikipedia.org';
  // Fallback ke English Wikipedia jika istilah teknis/global tidak ada di Wikipedia Indonesia
  if (!title) {
    const foundEn = (await getJson(
      `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(q)}&limit=1&namespace=0&format=json`,
    )) as Array<unknown> | null;
    title = Array.isArray(foundEn?.[1]) ? (foundEn as Array<Array<string>>)[1][0] : undefined;
    wikiHost = 'en.wikipedia.org';
  }

  if (title) {
    const wiki = (await getJson(
      `https://${wikiHost}/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
    )) as { title?: string; extract?: string } | null;
    if (wiki?.extract) {
      parts.push(`Wikipedia (${wiki.title ?? title}): ${wiki.extract}`);
    }
  }

  // 2. DuckDuckGo Instant Answer
  const ddg = (await getJson(
    `https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1&lang=id-id`,
  )) as { AbstractText?: string; AbstractURL?: string } | null;
  if (ddg?.AbstractText) {
    parts.push(`DuckDuckGo: ${ddg.AbstractText} (sumber: ${ddg.AbstractURL ?? '-'})`);
  }

  return parts.join('\n\n');
}
