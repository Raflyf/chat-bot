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

import { STICKER_MANIFEST } from './sticker-manifest.js';

const STICKER_COOLDOWN_MS = 10 * 60 * 1000;
const STICKER_MAX_PER_WINDOW = 2;

const recentStickerUses = new Map<string, number[]>();

const EMOJI_TO_FILE: Record<string, string> = STICKER_MANIFEST;

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
