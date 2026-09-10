// Lookup internet $0 tanpa API key: Wikipedia (faktual) + DuckDuckGo (ringkas).
// Dipicu heuristik kata-kata kebutuhan info terkini, bukan tiap pesan (hemat kuota).

export function needsSearch(text: string): boolean {
  return /(terkini|terbaru|hari ini|saat ini|sekarang|tahun 2026|berita|cari|internet|cuaca|jadwal|saham|kurs|skor|siapa.*(presiden|menteri|juara|pemenang)|kapan|di mana.*(buka|tutup))/i.test(
    text,
  );
}

async function getJson(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'AgentKit/0.8 (bot edukasi)' },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  } catch {
    return null;
  }
}

const STOPWORDS = new Set(
  'siapa,apa,kapan,dimana,di mana,berapa,bagaimana,kenapa,mengapa,tolong,jawab,singkat,jelaskan,cari,carikan,tentang,yang,dan,atau,adalah,itu,ini,saat,kah,apakah,bagaimana,kepada,dari,untuk,dengan,saat ini,sekarang,kak,tolong'.split(','),
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
  // Wikipedia: cari judul halaman dulu (opensearch), baru ambil ringkasan.
  const found = (await getJson(
    `https://id.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(q)}&limit=1&namespace=0&format=json`,
  )) as Array<unknown> | null;
  const title = Array.isArray(found?.[1]) ? (found as Array<Array<string>>)[1][0] : undefined;
  if (title) {
    const wiki = (await getJson(
      `https://id.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
    )) as { title?: string; extract?: string } | null;
    if (wiki?.extract) parts.push(`Wikipedia (${wiki.title ?? title}): ${wiki.extract}`);
  }
  const ddg = (await getJson(
    `https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1&lang=id-id`,
  )) as { AbstractText?: string; AbstractURL?: string } | null;
  if (ddg?.AbstractText) parts.push(`DuckDuckGo: ${ddg.AbstractText} (sumber: ${ddg.AbstractURL ?? '-'})`);
  return parts.join('\n\n');
}
