// Lookup internet $0 tanpa API key: Wikipedia Full-Text Search (ID + EN), Page Summaries, dan Hacker News Algolia.
// Memberikan data riil dari internet untuk peristiwa, rilis model, berita, dan fakta terkini.

export function needsSearch(text: string): boolean {
  const t = text.toLowerCase();
  return (
    /(terkini|terbaru|hari ini|saat ini|sekarang|tahun 202|berita|cari|carikan|internet|cuaca|jadwal|saham|kurs|skor|kapan|rilis|update|model|versi|siapa|apa itu|fitur|perkembangan)/i.test(
      t,
    ) ||
    /(gpt|openai|claude|anthropic|gemini|deepseek|meta ai|llama|mistral|chatgpt)/i.test(t)
  );
}

const STOPWORDS = new Set(
  'siapa,apa,kapan,dimana,di mana,berapa,bagaimana,kenapa,mengapa,tolong,jawab,singkat,jelaskan,cari,carikan,tentang,yang,dan,atau,adalah,itu,ini,saat,kah,apakah,bagaimana,kepada,dari,untuk,dengan,saat ini,sekarang,kak,tolong,mengenai,dong,buatkan'.split(','),
);

/** Saring kalimat tanya jadi kata kunci pencarian (maks 6 kata). */
export function keywords(query: string): string {
  const words = query
    .toLowerCase()
    .replace(/[?.!,:;()]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
  return words.slice(0, 6).join(' ') || query.slice(0, 60);
}

/** Kembalikan konteks ber-sumber dari internet, atau string kosong jika tidak ada hasil. */
export async function searchWeb(query: string): Promise<string> {
  const q = keywords(query);
  const parts: string[] = [];

  // 1. Wikipedia Full-Text Search (Bahasa Indonesia)
  try {
    const resId = await fetch(
      `https://id.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&format=json&utf8=1`,
      {
        headers: { 'User-Agent': 'FreeAIBot/1.0 (Personal AI Assistant)' },
        signal: AbortSignal.timeout(5000),
      },
    );
    if (resId.ok) {
      const dataId = (await resId.json()) as { query?: { search?: Array<{ title: string; snippet: string }> } };
      const items = dataId.query?.search ?? [];
      if (items.length > 0) {
        for (const item of items.slice(0, 2)) {
          const cleanSnippet = item.snippet.replace(/<[^>]+>/g, '').trim();
          parts.push(`Wikipedia ID (${item.title}): ${cleanSnippet}`);
        }
        // Ambil summary lengkap halaman teratas
        const topTitle = items[0].title;
        const sumRes = await fetch(
          `https://id.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(topTitle)}`,
          {
            headers: { 'User-Agent': 'FreeAIBot/1.0 (Personal AI Assistant)' },
            signal: AbortSignal.timeout(4000),
          },
        );
        if (sumRes.ok) {
          const sumData = (await sumRes.json()) as { extract?: string };
          if (sumData.extract) {
            parts.push(`Ringkasan Artikel (${topTitle}): ${sumData.extract}`);
          }
        }
      }
    }
  } catch {
    // abaikan jika gagal
  }

  // 2. Wikipedia Full-Text Search (Bahasa Inggris) untuk istilah teknologi & global terkini
  try {
    const resEn = await fetch(
      `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&format=json&utf8=1`,
      {
        headers: { 'User-Agent': 'FreeAIBot/1.0 (Personal AI Assistant)' },
        signal: AbortSignal.timeout(5000),
      },
    );
    if (resEn.ok) {
      const dataEn = (await resEn.json()) as { query?: { search?: Array<{ title: string; snippet: string }> } };
      const items = dataEn.query?.search ?? [];
      if (items.length > 0) {
        for (const item of items.slice(0, 2)) {
          const cleanSnippet = item.snippet.replace(/<[^>]+>/g, '').trim();
          parts.push(`Wikipedia EN (${item.title}): ${cleanSnippet}`);
        }
        const topTitle = items[0].title;
        const sumRes = await fetch(
          `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(topTitle)}`,
          {
            headers: { 'User-Agent': 'FreeAIBot/1.0 (Personal AI Assistant)' },
            signal: AbortSignal.timeout(4000),
          },
        );
        if (sumRes.ok) {
          const sumData = (await sumRes.json()) as { extract?: string };
          if (sumData.extract) {
            parts.push(`Summary (${topTitle}): ${sumData.extract}`);
          }
        }
      }
    }
  } catch {
    // abaikan jika gagal
  }

  // 3. Hacker News Algolia Tech Releases Search (Live tech news)
  try {
    const hnRes = await fetch(
      `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(q)}&tags=story&hitsPerPage=3`,
      {
        headers: { 'User-Agent': 'FreeAIBot/1.0 (Personal AI Assistant)' },
        signal: AbortSignal.timeout(4000),
      },
    );
    if (hnRes.ok) {
      const hnData = (await hnRes.json()) as { hits?: Array<{ title: string; url?: string; created_at: string }> };
      for (const h of hnData.hits ?? []) {
        parts.push(`Berita Teknologi (${h.created_at.slice(0, 10)}): ${h.title}${h.url ? ` [${h.url}]` : ''}`);
      }
    }
  } catch {
    // abaikan jika gagal
  }

  return parts.join('\n\n');
}
