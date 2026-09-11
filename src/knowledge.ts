import { db } from './db.js';

export type KnowledgeCategory = 'realtime' | 'news' | 'tech_release' | 'static_fact';

export interface CachedKnowledge {
  entityKey: string;
  category: KnowledgeCategory;
  knowledge: string;
  expiresAt: number; // timestamp ms
  sourceUrls?: string[];
}

// Hot in-memory cache untuk respon super cepat (0ms) pada serverless instance aktif
const hotKnowledgeCache = new Map<string, CachedKnowledge>();
const MAX_HOT_CACHE_SIZE = 300;

// Daftar stopwords dan filler percakapan bahasa Indonesia & Inggris
const STOPWORDS = new Set([
  'tolong', 'bantu', 'jelaskan', 'bagaimana', 'gimana', 'apa', 'apakah', 'kenapa',
  'mengapa', 'kapan', 'dimana', 'berapa', 'siapa', 'minta', 'coba', 'dong', 'sih',
  'deh', 'kak', 'bang', 'mas', 'mbak', 'min', 'bro', 'gan', 'kawan', 'ya', 'kan',
  'tentang', 'soal', 'mengenai', 'bocoran', 'info', 'informasi', 'terbaru', 'terkini',
  'update', 'rilis', 'resmi', 'launch', 'sekarang', 'saat', 'hari', 'ini', 'itu',
  'di', 'ke', 'dari', 'pada', 'untuk', 'dan', 'atau', 'yang', 'ada', 'saja', 'pun',
  'lah', 'kah', 'aja', 'nih', 'tuh', 'dong', 'ya', 'yuk', 'the', 'is', 'at', 'which',
  'on', 'for', 'about', 'how', 'what', 'when', 'where', 'who', 'why'
]);

/** Normalisasi entitas kueri menjadi kunci unik yang stabil */
export function normalizeEntityKey(rawText: string): string {
  if (!rawText) return '';

  let text = rawText.toLowerCase().trim();

  // 1. Bersihkan tanda baca, URL, dan karakter khusus
  text = text.replace(/https?:\/\/\S+/gi, ' ');
  text = text.replace(/[?!.,;:'"()\[\]{}*&^%$#@~`\\/+=_|<>-]/g, ' ');

  // 2. Filter token bermakna non-stopwords
  const rawTokens = text.split(/\s+/).map((t) => t.trim()).filter(Boolean);
  const tokens = rawTokens.filter((t) => !STOPWORDS.has(t) && t.length > 1);

  if (tokens.length === 0) {
    // Fallback jika semua tereliminasi
    const fallback = rawTokens.slice(0, 3).join('_').slice(0, 50);
    return fallback || 'general_query';
  }

  // Gabungkan maksimal 5 token esensial
  return tokens.slice(0, 5).join('_').slice(0, 80);
}

/** Tentukan kategori pengetahuan dan durasi masa berlaku (TTL dalam detik) */
export function determineCategoryAndTTL(query: string, entityKey: string): { category: KnowledgeCategory; ttlSeconds: number } {
  const combined = `${query} ${entityKey}`.toLowerCase();

  // 1. Kategori Sangat Dinamis: Cuaca, kurs, harga fluktuatif, skor, gempa
  // TTL: 2 jam (7200 detik)
  if (/\b(?:cuaca|suhu|hujan|panas|kurs|saham|crypto|harga emas|skor|pertandingan|gempa|tsunami|banjir|macet)\b/i.test(combined)) {
    return { category: 'realtime', ttlSeconds: 7200 };
  }

  // 2. Kategori Berita / Event Terkini: Politik, hukum, menteri, viral, pemilu
  // TTL: 12 jam (43200 detik)
  if (/\b(?:berita|hari ini|viral|menteri|presiden|pemilu|uu|kasus|kejadian|demo)\b/i.test(combined)) {
    return { category: 'news', ttlSeconds: 43200 };
  }

  // 3. Kategori Teknologi, Gawai, Rilis Model AI, Software
  // Model AI baru (DeepSeek, Claude, Qwen, GPT), smartphone (Xiaomi, iPhone, Samsung), prosesor
  // TTL: 21 hari (1814400 detik)
  if (
    /\b(?:xiaomi|samsung|iphone|apple|redmi|poco|oppo|vivo|asus|lenovo|deepseek|claude|gemini|qwen|openai|chatgpt|mistral|rtx|snapdragon|intel|amd|hyperos|android|ios)\b/i.test(combined) ||
    /\b(?:spesifikasi|spek|chipset|prosesor|kamera|baterai|layar)\b/i.test(combined)
  ) {
    return { category: 'tech_release', ttlSeconds: 1814400 };
  }

  // 4. Kategori Fakta Statis / Ilmiah / Teori / Sejarah
  // TTL: 90 hari (7776000 detik)
  return { category: 'static_fact', ttlSeconds: 7776000 };
}

let warnedTableMissing = false;

/**
 * Cari pengetahuan dari memori bersama (Hot Cache -> Supabase web_knowledge).
 * Mengembalikan intisari fakta jika data ditemukan dan MASIH BERLAKU (expires_at > now).
 * Mengembalikan null jika belum ada atau sudah kedaluwarsa (perlu di-scrape ulang).
 */
export async function getKnowledge(query: string): Promise<{ knowledge: string; sourceUrls?: string[] } | null> {
  const entityKey = normalizeEntityKey(query);
  if (!entityKey) return null;

  const now = Date.now();

  // 1. Periksa hot in-memory cache lokal (0ms)
  const hot = hotKnowledgeCache.get(entityKey);
  if (hot && hot.expiresAt > now) {
    return { knowledge: hot.knowledge, sourceUrls: hot.sourceUrls };
  }

  // 1b. Cek token prefix/overlap di hot cache
  for (const [k, entry] of hotKnowledgeCache.entries()) {
    if (entry.expiresAt > now) {
      if (k === entityKey || k.startsWith(entityKey) || entityKey.startsWith(k)) {
        return { knowledge: entry.knowledge, sourceUrls: entry.sourceUrls };
      }
    }
  }

  // 2. Periksa database Supabase (web_knowledge)
  const c = db();
  if (!c) return null;

  try {
    const { data, error } = await c
      .from('web_knowledge')
      .select('knowledge, expires_at, source_urls')
      .or(`entity_key.eq.${entityKey},entity_key.ilike.${entityKey}%`)
      .gt('expires_at', new Date(now).toISOString())
      .limit(1)
      .maybeSingle();

    if (error) {
      if (!warnedTableMissing && error.code === '42P01') {
        // Tabel belum dibuat (relation does not exist)
        warnedTableMissing = true;
        console.warn('[knowledge] Tabel web_knowledge belum aktif di Supabase. Jalankan migrate_v14_web_knowledge.sql.');
      }
      return null;
    }

    if (data && data.knowledge) {
      const expMs = new Date(data.expires_at).getTime();
      // Simpan ke in-memory hot cache untuk kueri berikutnya
      if (hotKnowledgeCache.size >= MAX_HOT_CACHE_SIZE) hotKnowledgeCache.clear();
      hotKnowledgeCache.set(entityKey, {
        entityKey,
        category: 'tech_release',
        knowledge: data.knowledge,
        expiresAt: expMs,
        sourceUrls: data.source_urls ?? [],
      });

      // Update hit_count di database secara asinkron non-blocking
      void Promise.resolve(c.rpc('increment_knowledge_hit', { p_entity_key: entityKey })).catch(() => {});

      return {
        knowledge: data.knowledge,
        sourceUrls: data.source_urls ?? [],
      };
    }

    return null;
  } catch (err) {
    return null;
  }
}

/**
 * Simpan pengetahuan hasil penelusuran web ke memori bersama secara persisten.
 * Dijalankan secara asinkron non-blocking (fire-and-forget).
 */
export async function saveKnowledge(
  query: string,
  knowledge: string,
  sourceUrls?: string[],
): Promise<void> {
  const cleanKnowledge = knowledge.trim();
  if (!cleanKnowledge || cleanKnowledge.length < 50) return;

  const entityKey = normalizeEntityKey(query);
  if (!entityKey) return;

  const { category, ttlSeconds } = determineCategoryAndTTL(query, entityKey);
  const nowMs = Date.now();
  const expiresAtMs = nowMs + ttlSeconds * 1000;
  const expiresAtIso = new Date(expiresAtMs).toISOString();

  // 1. Simpan langsung ke in-memory hot cache
  if (hotKnowledgeCache.size >= MAX_HOT_CACHE_SIZE) hotKnowledgeCache.clear();
  hotKnowledgeCache.set(entityKey, {
    entityKey,
    category,
    knowledge: cleanKnowledge,
    expiresAt: expiresAtMs,
    sourceUrls: sourceUrls ?? [],
  });

  // 2. Simpan persisten ke Supabase (web_knowledge) via upsert
  const c = db();
  if (!c) return;

  try {
    await c.from('web_knowledge').upsert(
      {
        entity_key: entityKey,
        category,
        query_sample: query.slice(0, 250),
        knowledge: cleanKnowledge.slice(0, 5000),
        source_urls: sourceUrls?.slice(0, 5) ?? [],
        expires_at: expiresAtIso,
        updated_at: new Date(nowMs).toISOString(),
      },
      { onConflict: 'entity_key' },
    );
  } catch (err) {
    // Fail-safe: jangan melempar error ke alur utama jika database bermasalah
    console.warn('[knowledge] Gagal upsert web_knowledge:', err);
  }
}
