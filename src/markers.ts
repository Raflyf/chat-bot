/**
 * Sinyal durable antar-giliran percakapan yang disimpan di kolom `feedback`
 * tabel messages (tanpa menambah kolom baru / mengotori data).
 *
 * Mengapa perlu: balasan bot diproduksi oleh model yang bisa BERGANTI tiap pesan
 * (failover provider). Model di pesan berikutnya tidak otomatis tahu konteks
 * tersembunyi dari pesan sebelumnya — mis. jawaban benar sebuah tebak-tebakan
 * yang ia lempar sendiri. Tanpa jejak durable, model mengarang ("orang aring
 * matanya melek terus") demi terdengar nyambung. Marker ini menyimpan fakta itu.
 *
 * Format: "key:value" dipisah "|", mis. "sticker:😂|riddle:Apel".
 * - sticker:<emoji>  → stiker yang benar-benar terkirim (anti-overuse).
 * - riddle:<jawaban> → jawaban benar tebak-tebakan/gombalan tanya-jawab terakhir.
 */

export interface DurableMarkers {
  sticker?: string;
  riddle?: string;
}

const MAX_RIDDLE_LEN = 80;

/** Encode sinyal durable ke string kolom `feedback` (undefined bila kosong). */
export function encodeMarkers(m: DurableMarkers): string | undefined {
  const parts: string[] = [];
  if (m.sticker && m.sticker.trim()) parts.push(`sticker:${m.sticker.trim()}`);
  if (m.riddle && m.riddle.trim()) {
    // Buang karakter pemisah agar format tidak rusak.
    const safe = m.riddle.trim().replace(/[|\r\n]+/g, ' ').slice(0, MAX_RIDDLE_LEN);
    if (safe) parts.push(`riddle:${safe}`);
  }
  return parts.length ? parts.join('|') : undefined;
}

/** Decode string kolom `feedback` menjadi sinyal durable. */
export function decodeMarkers(s: string | null | undefined): DurableMarkers {
  const out: DurableMarkers = {};
  if (!s || typeof s !== 'string') return out;
  for (const part of s.split('|')) {
    const i = part.indexOf(':');
    if (i < 0) continue;
    const key = part.slice(0, i).trim();
    const val = part.slice(i + 1).trim();
    if (!val) continue;
    if (key === 'sticker') out.sticker = val;
    else if (key === 'riddle') out.riddle = val;
  }
  return out;
}

/** Penanda jawaban di riwayat: "[Jawaban: <teks>]". */
const RIDDLE_MARKER_RE = /\[Jawaban:\s*([^\]]+)\]/;

/** True bila konten memuat penanda jawaban tebakan. */
export function hasRiddleMarker(content: unknown): boolean {
  return typeof content === 'string' && RIDDLE_MARKER_RE.test(content);
}

/** Buang baris penanda jawaban dari konten (agar tidak ikut ke model / user). */
export function stripRiddleMarker(content: string): string {
  return content.replace(/\n?\[Jawaban:[^\]]*\]/g, '').trim();
}

/**
 * Jawaban benar tebak-tebakan terakhir dari riwayat durable, atau null.
 * Dipakai untuk menilai jawaban teman secara JUJUR (bukan mengarang pembenaran).
 */
export function lastRiddleAnswer(
  history: Array<{ role: string; content: string | unknown }> | undefined,
): string | null {
  if (!history || history.length === 0) return null;
  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i];
    if (h.role !== 'assistant' || typeof h.content !== 'string') continue;
    const m = h.content.match(RIDDLE_MARKER_RE);
    if (m) return m[1].trim();
    if (history.length - i > 40) break;
  }
  return null;
}
