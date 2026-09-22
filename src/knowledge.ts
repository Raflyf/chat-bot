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

/** Netralkan potensi stored prompt injection dari teks web sebelum dipersist atau disuntikkan ke model */
export function sanitizeKnowledgeText(text: string): string {
  if (!text) return '';
  return text
    .replace(/<\/?(?:system|instruction|prompt|context|assistant|human|user)>/gi, '')
    .replace(/\[\/?(?:INST|SYS|SYSTEM|INSTRUCTION|PROMPT)[^\]]*\]/gi, '')
    .replace(/<\|(?:im_start|im_end|system|user|assistant)\|>/gi, '')
    .replace(/\[\s*(?:system|system\s+prompt|perintah\s+sistem|instruksi|system\s*:\s*)\s*\]/gi, '[info]')
    .replace(/\b(?:ignore\s+(?:all\s+)?(?:previous|prior)\s+instructions?|forget\s+all\s+(?:previous|prior)\s+instructions?)\b/gi, '[neutralized]')
    .replace(/\b(?:you\s+must\s+now|kamu\s+harus\s+mengabaikan|abaikan\s+semua\s+perintah|system\s+override|jailbreak)\b/gi, '[neutralized]')
    .replace(/\b(?:bypass\s+(?:all\s+)?(?:rules|limits)|tulis\s+ulang\s+instruksi)\b/gi, '[neutralized]')
    .trim();
}

// Pruning LRU: buang 50 entri pertama/tertua jika cache melebihi batas (mencegah thundering herd)
function pruneHotCache(): void {
  if (hotKnowledgeCache.size >= MAX_HOT_CACHE_SIZE) {
    let evicted = 0;
    for (const key of hotKnowledgeCache.keys()) {
      hotKnowledgeCache.delete(key);
      evicted++;
      if (evicted >= 50) break;
    }
  }
}

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
    return { knowledge: sanitizeKnowledgeText(hot.knowledge), sourceUrls: hot.sourceUrls };
  }

  // 1b. Cek hot cache — HANYA kecocokan EKSAK.
  //
  // BUG YANG DIPERBAIKI (temuan audit v0.79, direproduksi):
  // versi sebelumnya memakai `k.startsWith(entityKey) || entityKey.startsWith(k)` —
  // pencocokan PREFIX DUA ARAH. Akibatnya kueri yang hanya berbagi awalan dianggap sama
  // dan bot menyajikan fakta topik lain dengan yakin:
  //   simpan "harga"            -> tanya "harga minyak goreng naik hari ini" = HIT SALAH
  //   simpan "harga beras premium kualitas satu" -> tanya "harga" = HIT SALAH
  // Ini membuat bot menjawab dengan data lama yang tidak relevan TANPA menyentuh web,
  // dan sulit terdeteksi karena jawabannya terdengar percaya diri.
  // Sekarang hanya kecocokan eksak yang diterima (kunci sudah dinormalisasi oleh
  // normalizeEntityKey, jadi kueri yang benar-benar sama tetap terlayani dari cache).
  for (const [k, entry] of hotKnowledgeCache.entries()) {
    if (entry.expiresAt > now && k === entityKey) {
      return { knowledge: sanitizeKnowledgeText(entry.knowledge), sourceUrls: entry.sourceUrls };
    }
  }

  // 2. Periksa database Supabase (web_knowledge)
  const c = db();
  if (!c) return null;

  try {
    const { data, error } = await c
      .from('web_knowledge')
      .select('knowledge, expires_at, source_urls, category')
      // Hanya kecocokan EKSAK — prefix-match menyebabkan kolisi topik (lihat catatan 1b).
      .eq('entity_key', entityKey)
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
      const sanitized = sanitizeKnowledgeText(data.knowledge);
      const cat: KnowledgeCategory = (data.category as KnowledgeCategory) || 'tech_release';

      // Simpan ke in-memory hot cache untuk kueri berikutnya
      pruneHotCache();
      hotKnowledgeCache.set(entityKey, {
        entityKey,
        category: cat,
        knowledge: sanitized,
        expiresAt: expMs,
        sourceUrls: data.source_urls ?? [],
      });

      // Update hit_count di database secara asinkron non-blocking
      void Promise.resolve(c.rpc('increment_knowledge_hit', { p_entity_key: entityKey, p_key: entityKey })).catch(() => {});

      return {
        knowledge: sanitized,
        sourceUrls: data.source_urls ?? [],
      };
    }

    return null;
  } catch {
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
  const cleanKnowledge = sanitizeKnowledgeText(knowledge);
  if (!cleanKnowledge || cleanKnowledge.length < 50) return;

  const entityKey = normalizeEntityKey(query);
  if (!entityKey) return;

  const { category, ttlSeconds } = determineCategoryAndTTL(query, entityKey);
  const nowMs = Date.now();
  const expiresAtMs = nowMs + ttlSeconds * 1000;
  const expiresAtIso = new Date(expiresAtMs).toISOString();

  // Potong pada batas kalimat/paragraf agar tidak terpotong di tengah kata/fakta (B3)
  let boundedKnowledge = cleanKnowledge;
  if (boundedKnowledge.length > 5000) {
    const lastPeriod = boundedKnowledge.lastIndexOf('.', 4900);
    if (lastPeriod > 2000) {
      boundedKnowledge = boundedKnowledge.slice(0, lastPeriod + 1);
    } else {
      boundedKnowledge = boundedKnowledge.slice(0, 5000);
    }
  }

  // 1. Simpan langsung ke in-memory hot cache
  pruneHotCache();
  hotKnowledgeCache.set(entityKey, {
    entityKey,
    category,
    knowledge: boundedKnowledge,
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
        knowledge: boundedKnowledge,
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
