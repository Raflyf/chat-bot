/**
 * Sistem stiker balasan bot.
 *
 * Model memilih emoji yang cocok secara DINAMIS (lewat tag [[sticker:<emoji>]] di
 * balasannya — bukan daftar template hardcode). Modul ini memetakan emoji pilihan
 * model ke aset stiker webp di public/stickers/, lalu platform mengirimkannya.
 *
 * Anti-spam (aturan program, bukan teks balasan):
 * - Maksimal 1 stiker per balasan (parser hanya mengambil tag pertama).
 * - Cooldown per chat: bila 2 stiker terakhir masih dalam 10 menit, tag diabaikan.
 * - Bila file stiker tidak tersedia / pengiriman gagal, fallback = emoji sebagai teks.
 */

const STICKER_COOLDOWN_MS = 10 * 60 * 1000;
const STICKER_MAX_PER_WINDOW = 2;

const recentStickerUses = new Map<string, number[]>();

/** Emoji → nama file hex (sama dengan generator aset, mis. 😹 → "1f639"). */
export function emojiToHex(emoji: string): string {
  const cps: string[] = [];
  for (const ch of emoji) {
    const cp = ch.codePointAt(0);
    if (cp) cps.push(cp.toString(16));
  }
  return cps.join('-');
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

/** URL publik file stiker untuk emoji (null bila tidak ada base URL — mis. dev lokal). */
export function stickerPublicUrl(emoji: string): string | null {
  const base = assetBaseUrl();
  if (!base) return null;
  return `${base}/stickers/${emojiToHex(emoji)}.webp`;
}

/** Ambil buffer stiker dari URL publik (dengan cache in-memory per instance). */
const stickerBufferCache = new Map<string, Buffer>();

export async function fetchStickerBuffer(emoji: string): Promise<Buffer | null> {
  const hex = emojiToHex(emoji);
  const cached = stickerBufferCache.get(hex);
  if (cached) return cached;

  const url = stickerPublicUrl(emoji);
  if (!url) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0) return null;
    if (stickerBufferCache.size > 60) stickerBufferCache.clear();
    stickerBufferCache.set(hex, buf);
    return buf;
  } catch {
    return null;
  }
}

/**
 * Cek cooldown per chat. Mengembalikan true bila stiker BOLEH dikirim
 * (menghormati batas 2 stiker / 10 menit), dan mencatat pemakaian bila boleh.
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
