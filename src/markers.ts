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
  /** Mode VN yang benar-benar terkirim ('chat' | 'sing') untuk cooldown 5:1 durable. */
  vn?: string;
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
  if (m.vn && m.vn.trim()) {
    const safeVn = m.vn.trim().replace(/[|\r\n]+/g, '').slice(0, 16);
    if (safeVn) parts.push(`vn:${safeVn}`);
  }
  return parts.length ? parts.join('|') : undefined;
}


/** Penanda jawaban di riwayat: "[Jawaban: <teks>]". */
const RIDDLE_MARKER_RE = /\[Jawaban:\s*([^\]]+)\]/;

/** Penanda durable Voice Note di riwayat: "[VN terkirim: chat|sing]". */
const VN_MARKER_RE = /\[VN terkirim:\s*([^\]]+)\]/;


/** Buang baris penanda jawaban dari konten (agar tidak ikut ke model / user). */
export function stripRiddleMarker(content: string): string {
  return content.replace(/\n?\[Jawaban:[^\]]*\]/g, '').trim();
}

/** True bila konten memuat penanda Voice Note terkirim. */
export function isVnMarker(content: unknown): boolean {
  return typeof content === 'string' && VN_MARKER_RE.test(content);
}

/** Buang baris penanda Voice Note dari konten (agar tidak ikut ke model / user). */
export function stripVnMarker(content: string): string {
  return content.replace(/\n?\[VN terkirim:[^\]]*\]/g, '').trim();
}

/**
 * Jumlah balasan asisten teks biasa yang lewat sejak Voice Note TERAKHIR dikirim.
 * Mengembalikan Number.MAX_SAFE_INTEGER bila belum ada VN dalam jendela riwayat.
 */
export function assistantTurnsSinceLastVn(
  history: Array<{ role: string; content: string | unknown }> | undefined,
): number {
  if (!history || history.length === 0) return Number.MAX_SAFE_INTEGER;
  let turns = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i];
    if (h.role !== 'assistant' || typeof h.content !== 'string') continue;
    if (isVnMarker(h.content)) return turns;
    turns++;
    if (turns > 60) break;
  }
  return Number.MAX_SAFE_INTEGER;
}

/** Total balasan asisten yang tersimpan di jendela riwayat percakapan aktif. */
export function assistantTurnCount(
  history: Array<{ role: string; content: string | unknown }> | undefined,
): number {
  if (!history || history.length === 0) return 0;
  let count = 0;
  for (const h of history) {
    if (h.role === 'assistant') count++;
  }
  return count;
}

/**
 * Mode VN terakhir ('sing' | 'chat') dalam N balasan asisten terbaru, atau null bila tidak ada.
 * Dipakai untuk mengenali perintah pendek seperti "ulangii" / "coba lagi" tepat setelah VN.
 */
export function lastRecentVnMode(
  history: Array<{ role: string; content: string | unknown }> | undefined,
  maxAssistantLookback = 4,
): 'chat' | 'sing' | null {
  if (!history || history.length === 0) return null;
  let seen = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i];
    if (h.role !== 'assistant' || typeof h.content !== 'string') continue;
    const m = h.content.match(VN_MARKER_RE);
    if (m) {
      const val = m[1].trim().toLowerCase();
      return val === 'sing' ? 'sing' : 'chat';
    }
    seen++;
    if (seen >= maxAssistantLookback) break;
  }
  return null;
}

/** Gabungkan teks balasan asisten dengan penanda durable (riddle / stiker / VN) untuk cache konteks. */
export function appendDurableMarkers(reply: string, m: DurableMarkers): string {
  const suffix: string[] = [];
  if (m.riddle && m.riddle.trim()) suffix.push(`[Jawaban: ${m.riddle.trim()}]`);
  if (m.sticker && m.sticker.trim()) suffix.push(`[Stiker terkirim: ${m.sticker.trim()}]`);
  if (m.vn && m.vn.trim()) suffix.push(`[VN terkirim: ${m.vn.trim()}]`);
  return suffix.length ? `${reply}\n${suffix.join('\n')}` : reply;
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
