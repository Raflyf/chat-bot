/**
 * Sistem stiker balasan bot (aset stiker WhatsApp milik user).
 *
 * Model memilih emoji secara DINAMIS (lewat tag [[sticker:<emoji>]] di balasannya —
 * bukan daftar template hardcode). Modul ini memetakan emoji pilihan model ke aset
 * stiker webp di public/stickers/ via manifest hasil pelabelan vision
 * (src/sticker-manifest.json: emoji → nama file).
 *
 * Bila emoji tidak ada di manifest, fallback: emoji dikirim sebagai teks (konten model).
 *
 * Anti-spam (aturan program, bukan teks balasan):
 * - Maksimal 1 stiker per balasan (parser hanya mengambil tag pertama).
 * - Cooldown per chat: maksimal 2 stiker per 10 menit.
 */

import { STICKER_MANIFEST, EDGY_STICKER_EMOJIS } from './sticker-manifest.js';

const STICKER_COOLDOWN_MS = 10 * 60 * 1000;
const STICKER_MAX_PER_WINDOW = 2;

const recentStickerUses = new Map<string, number[]>();

const EMOJI_TO_FILE: Record<string, string> = STICKER_MANIFEST;
const EDGY_SET = new Set<string>(EDGY_STICKER_EMOJIS);

/** True bila emoji termasuk "keras" (umpatan/provokasi) — hanya untuk konteks bercanda. */
export function isEdgyStickerEmoji(emoji: string): boolean {
  if (!emoji) return false;
  const e = emoji.trim();
  return EDGY_SET.has(e) || EDGY_SET.has(e.replace(/\uFE0F/g, ''));
}

/**
 * Deteksi sinyal bercanda/roasting dari pesan user — gerbang untuk emoji "keras".
 * Keputusan user: emoji seperti 🖕/🤬 boleh dipakai "dalam konteks bercanda, dan saat
 * user juga memberikan stiker seperti itu saat bercanda". Guard ini murni PEMBATAS:
 * bila tidak ada sinyal bercanda, emoji edgy TIDAK dikirim (fallback ke teks biasa).
 */
export function isPlayfulContext(userText?: string): boolean {
  if (!userText) return false;
  return /(?:wkwk+|kwkwk+|haha+|hehe+|hihi+|ngakak|kocak|lucu|garing|cringe|joke|lelucon|banyolan|lawak|candaan|bercanda|becanda|iseng|gabut|roast|ledek|tebak|gombal|rayu|anjay|gokil|buset|jir+|bjir+|troll|prank|santai|tongkrongan|becandaan|nyindir|sindir|ketawa|tertawa|ngeledek|bales dendam|baper|meme|komuk|😹|😂|🤣|😆|😅|😄|😁|😜|🤪)/i.test(
    userText,
  );
}

/**
 * Kategori suasana sebuah emoji stiker.
 *
 * KENAPA ADA (permintaan pemilik produk 24 Sep 2026): "kadang bot nya memberikan
 * stiker yg tidak sesuai dengan suasana". Akar masalahnya bukan jumlah stiker,
 * melainkan KECOCOKAN: stiker lucu dikirim saat user sedih, atau stiker mesra
 * dikirim saat user marah. Prompt saja tidak cukup karena model berganti setiap
 * pesan pada rantai failover — jadi kecocokan ditegakkan di kode.
 */
export type StickerMood =
  | 'lucu'      // tertawa, bercanda ringan
  | 'sindir'    // nyinyir, roasting, ledek
  | 'kesal'     // marah, kesal, jengkel
  | 'sedih'     // sedih, kecewa, menahan nangis
  | 'hangat'    // mesra, sayang, gemas
  | 'sopan'     // hormat, minta maaf, setuju, terima kasih
  | 'netral';   // bingung, kaget, datar

const MOOD_MAP: Record<string, StickerMood> = {
  // lucu / tertawa
  '😂': 'lucu', '🤣': 'lucu', '😆': 'lucu', '😅': 'lucu', '😹': 'lucu', '😁': 'lucu',
  '😜': 'lucu', '🤪': 'lucu', '😛': 'lucu', '🎉': 'lucu', '🥳': 'lucu',
  // sindir / roasting
  '😏': 'sindir', '🙄': 'sindir', '😒': 'sindir', '🤨': 'sindir', '😼': 'sindir',
  '🫣': 'sindir', '😈': 'sindir',
  // kesal / marah
  '😠': 'kesal', '😡': 'kesal', '🤬': 'kesal', '😤': 'kesal', '😾': 'kesal',
  '🖕': 'kesal', '👊': 'kesal', '💢': 'kesal', '💩': 'kesal', '💀': 'kesal',
  // sedih / kecewa
  '😢': 'sedih', '😭': 'sedih', '😔': 'sedih', '😞': 'sedih', '😿': 'sedih',
  '🥺': 'sedih', '💔': 'sedih', '😩': 'sedih', '😫': 'sedih', '🫠': 'sedih',
  '😰': 'sedih', '😨': 'sedih', '😧': 'sedih', '😦': 'sedih',
  // hangat / mesra
  '🥰': 'hangat', '😍': 'hangat', '😘': 'hangat', '❤': 'hangat', '❤️': 'hangat',
  '😳': 'hangat', '🤗': 'hangat', '🫶': 'hangat', '💕': 'hangat',
  // sopan / hormat
  '🙏': 'sopan', '👍': 'sopan', '👎': 'sopan', '🤝': 'sopan', '🫡': 'sopan',
  '👋': 'sopan', '✋': 'sopan', '🙋': 'sopan', '🆗': 'sopan', '👌': 'sopan',
  '🎂': 'sopan', '🤲': 'sopan', '💪': 'sopan', '🍳': 'sopan',
  // netral
  '🤔': 'netral', '🧐': 'netral', '😐': 'netral', '😑': 'netral', '🤷': 'netral',
  '😮': 'netral', '😲': 'netral', '😱': 'netral', '😵': 'netral', '🤯': 'netral',
  '😴': 'netral', '🥱': 'netral', '🤫': 'netral', '🙈': 'netral', '🙉': 'netral',
  '🚀': 'netral', '📢': 'netral', '📍': 'netral', '📝': 'netral', '🧠': 'netral',
  '👀': 'netral', '🐱': 'netral', '😺': 'netral', '🚶': 'netral', '🏃': 'netral',
  '🚗': 'netral', '🤥': 'netral', '🧘': 'netral', '😎': 'netral', '🙃': 'netral',
};

/** Suasana sebuah emoji stiker. Emoji yang tidak dikenal dianggap netral. */
export function stickerMood(emoji: string): StickerMood {
  if (!emoji) return 'netral';
  const e = emoji.trim();
  return MOOD_MAP[e] ?? MOOD_MAP[e.replace(/\uFE0F/g, '')] ?? 'netral';
}

/**
 * Apakah stiker ini PANTAS dikirim untuk pesan user tertentu.
 *
 * Aturannya sederhana dan konservatif — lebih baik tidak mengirim stiker
 * daripada mengirim yang salah suasana:
 *  - Suasana user SEDIH/KESAL -> hanya stiker 'sedih' atau 'sopan'. Stiker lucu
 *    dan mesra DILARANG (inilah keluhan nyatanya).
 *  - Suasana user MARAH ke bot -> hanya 'sopan' (minta maaf wajar) atau 'sedih'.
 *  - Suasana user BERCANDA -> 'lucu'/'sindir' boleh, 'sedih' jangan.
 *  - Suasana user FORMAL/PROFESIONAL -> tidak ada stiker sama sekali.
 *  - Selain itu -> apa pun boleh kecuali yang edgy (dijaga guard terpisah).
 */
export function stickerFitsMood(emoji: string, userText: string | undefined, isProfessional = false): boolean {
  if (isProfessional) return false;

  const mood = stickerMood(emoji);
  const t = (userText || '').toLowerCase();

  const userSedih = /\b(?:sedih|nangis|menangis|kecewa|galau|putus|capek|lelah|lemas|sakit hati|terluka|down|hancur|minder|sendirian|kesepian|gagal)\b/.test(t);
  const userKesal = /\b(?:kesal|marah|jengkel|sebal|muak|bete|emosi|ngamuk|nyebelin|goblok|bego|tolol|bodoh|dongo|gaje|ngaco|bacot)\b/.test(t);
  const userBercanda = /(?:wkwk+|haha+|hehe+|ngakak|lucu|kocak|garing|cringe|joke|becanda|bercanda|iseng|roast|ledek|tebak|gombal|gokil|jir+|anjay|😂|🤣|😹|😅)/i.test(t);
  const userFormal = /\b(?:mohon|dengan hormat|dimohon|saudara|yang terhormat|terima kasih atas|saya ingin menanyakan)\b/.test(t);

  if (userFormal) return false;

  // Sedih: hanya stiker yang ikut sedih atau sopan (menemani), bukan lucu/mesra.
  if (userSedih) return mood === 'sedih' || mood === 'sopan';

  // Kesal: hanya sopan/sedih (mengakui, bukan bercanda).
  if (userKesal && !userBercanda) return mood === 'sopan' || mood === 'sedih';

  // Bercanda: jangan kirim stiker sedih ATAU kesal — keduanya merusak suasana
  // lucu. (Kasus nyata: user baru tertawa, bot malah mengirim stiker marah.)
  if (userBercanda) return mood !== 'sedih' && mood !== 'kesal';

  // Default: hindari stiker yang menuntut suasana tertentu.
  return mood === 'netral' || mood === 'sopan' || mood === 'lucu';
}

/** Nama file stiker untuk emoji (null bila emoji tidak punya aset). */
export function stickerFileForEmoji(emoji: string): string | null {
  if (!emoji) return null;
  const e = emoji.trim();
  if (EMOJI_TO_FILE[e]) return EMOJI_TO_FILE[e];
  // Coba tanpa variation selector (mis. "❤️" → "❤")
  const stripped = e.replace(/\uFE0F/g, '');
  if (EMOJI_TO_FILE[stripped]) return EMOJI_TO_FILE[stripped];
  // Coba basis tanpa modifier warna kulit (mis. "👍🏽" → "👍")
  const base = e.replace(/[\u{1F3FB}-\u{1F3FF}]/gu, '');
  if (EMOJI_TO_FILE[base]) return EMOJI_TO_FILE[base];
  return null;
}

/** True bila ada aset stiker untuk emoji tsb. */
export function hasStickerForEmoji(emoji: string): boolean {
  return stickerFileForEmoji(emoji) !== null;
}

/** Basis URL publik aset stiker (Vercel menyediakan env ini otomatis di serverless). */
function assetBaseUrl(): string {
  const explicit = process.env.STICKER_BASE_URL || '';
  if (explicit) return explicit.replace(/\/+$/, '');
  const prod = process.env.VERCEL_PROJECT_PRODUCTION_URL || '';
  if (prod) return `https://${prod}`;
  const url = process.env.VERCEL_URL || '';
  if (url) return `https://${url}`;
  return '';
}

/** URL publik file stiker untuk emoji (null bila tidak ada aset / base URL). */
export function stickerPublicUrl(emoji: string): string | null {
  const file = stickerFileForEmoji(emoji);
  if (!file) return null;
  const base = assetBaseUrl();
  if (!base) return null;
  return `${base}/stickers/${file}`;
}

/** Ambil buffer stiker dari URL publik (dengan cache in-memory per instance). */
const stickerBufferCache = new Map<string, Buffer>();

export async function fetchStickerBuffer(emoji: string): Promise<Buffer | null> {
  const file = stickerFileForEmoji(emoji);
  if (!file) return null;
  const cached = stickerBufferCache.get(file);
  if (cached) return cached;

  const url = stickerPublicUrl(emoji);
  if (!url) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0) return null;
    if (stickerBufferCache.size > 60) stickerBufferCache.clear();
    stickerBufferCache.set(file, buf);
    return buf;
  } catch {
    return null;
  }
}

/**
 * Cek cooldown per chat. Mengembalikan true bila stiker BOLEH dikirim
 * (menghormati batas 2 stiker / 10 menit), dan mencatat pemakaian bila boleh.
 *
 * PENTING (serverless): state in-memory per-instance tidak reliable di Vercel —
 * beberapa request berurutan bisa mendarat di instance berbeda sehingga cooldown
 * tidak terlihat. Karena itu caller WAJIB juga memeriksa riwayat chat
 * (getRecentStickerCount) yang tersimpan durable; fungsi ini adalah fast-path lokal.
 */
export function allowStickerForChat(chatKey: string): boolean {
  const now = Date.now();
  const uses = (recentStickerUses.get(chatKey) || []).filter((t) => now - t < STICKER_COOLDOWN_MS);
  if (uses.length >= STICKER_MAX_PER_WINDOW) {
    recentStickerUses.set(chatKey, uses);
    return false;
  }
  uses.push(now);
  recentStickerUses.set(chatKey, uses);
  if (recentStickerUses.size > 500) {
    // prune chat lama agar map tidak tumbuh tanpa batas
    for (const [k, v] of recentStickerUses.entries()) {
      if (!v.some((t) => now - t < STICKER_COOLDOWN_MS)) recentStickerUses.delete(k);
    }
  }
  return true;
}

/**
 * Jarak MINIMUM (dalam jumlah balasan asisten) sebelum bot boleh mengirim stiker lagi.
 * Mengapa berbasis balasan, bukan waktu: cooldown berbasis waktu (10 menit) tidak
 * handal di serverless Vercel (tiap request bisa mendarat di instance berbeda dengan
 * state in-memory kosong). Menghitung balasan sejak stiker terakhir bersifat DURABLE
 * karena dibaca dari riwayat percakapan yang tersimpan.
 */
export const STICKER_MIN_TURNS_SINCE_LAST = 5;

/**
 * Penanda durable stiker di riwayat: "[Stiker terkirim: <emoji>]".
 * Sengaja TANPA anchor: penanda bisa berdiri sendiri (entri cache) atau
 * ditempel sebagai baris terakhir balasan (hasil sintesis dari DB), keduanya valid.
 */
const STICKER_MARKER_RE = /\[Stiker terkirim:\s*([^\]]+)\]/;

/** True bila konten memuat penanda stiker (baik berdiri sendiri maupun menempel di akhir balasan). */
export function isStickerMarker(content: unknown): boolean {
  return typeof content === 'string' && STICKER_MARKER_RE.test(content);
}

/** Buang baris penanda stiker dari konten balasan (agar tidak ikut ke model). */
export function stripStickerMarker(content: string): string {
  return content.replace(/\n?\[Stiker terkirim:[^\]]*\]/g, '').trim();
}

/**
 * Emoji stiker terakhir yang dikirim ke chat ini (dari riwayat durable), atau null.
 * Dipakai untuk mencegah pengiriman emoji stiker yang SAMA dua kali beruntun.
 */
export function lastStickerEmoji(
  history: Array<{ role: string; content: string | unknown }> | undefined,
): string | null {
  if (!history || history.length === 0) return null;
  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i];
    if (h.role !== 'assistant' || typeof h.content !== 'string') continue;
    const m = h.content.match(STICKER_MARKER_RE);
    if (m) return m[1].trim();
    if (history.length - i > 40) break;
  }
  return null;
}

/**
 * Berapa balasan asisten (teks biasa) yang sudah lewat sejak stiker TERAKHIR dikirim.
 * Bila belum pernah ada stiker dalam jendela riwayat, kembalikan angka besar (boleh).
 * Durable: dibaca dari riwayat percakapan yang tersimpan, bukan state in-memory.
 */
export function assistantTurnsSinceLastSticker(
  history: Array<{ role: string; content: string | unknown }> | undefined,
): number {
  if (!history || history.length === 0) return Number.MAX_SAFE_INTEGER;
  let turns = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i];
    if (h.role !== 'assistant' || typeof h.content !== 'string') continue;
    if (isStickerMarker(h.content)) return turns;
    turns++;
    if (turns > 60) break;
  }
  return Number.MAX_SAFE_INTEGER;
}
