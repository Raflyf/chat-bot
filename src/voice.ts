/**
 * Sistem balasan Voice Note (VN) untuk WhatsApp Baileys, WhatsApp Cloud API, dan Telegram.
 *
 * Arsitektur natural human-like TTS (berjalan di Vercel serverless & VPS tanpa ffmpeg):
 * - VN obrolan biasa (`mode: 'chat'`):
 *   1. Utama: Gemini 3.8 Flash-Lite TTS (`gemini-3.8-flash-lite-tts`, cepat & natural bahasa Indonesia).
 *   2. Cadangan 1: Gemini 3.8 Flash TTS (`gemini-3.8-flash-tts`, ekspresif).
 *   3. Cadangan 2: Gemini 2.5 Flash Preview TTS (`gemini-2.5-flash-preview-tts`, kuota terpisah).
 *   4. Opsional: Edge-TTS hanya bila `VOICE_EDGE_FALLBACK=1`; default `false` agar tidak jadi suara robot.
 * - VN nyanyi acapella (`mode: 'sing'`):
 *   1. Utama: Gemini 3.8 Flash TTS (`gemini-3.8-flash-tts`) dengan `speech_metadata.style` melodis/acapella.
 *   2. Cadangan 1: Gemini 3.8 Flash-Lite TTS (`gemini-3.8-flash-lite-tts`).
 *   3. Cadangan 2: Gemini 2.5 Flash Preview TTS (`gemini-2.5-flash-preview-tts`).
 * - Semua WAV/PCM 24kHz di-encode langsung ke `audio/ogg; codecs=opus` lewat WASM `@audio/encode-opus`.
 * - Fallback terakhir di caller: bila kuota semua TTS habis, kirim teks biasa agar balasan tetap lancar.
 */

import { EdgeTTS } from '@andresaya/edge-tts';
import encodeOpus from '@audio/encode-opus';
import { config } from './env.js';
import { assistantTurnsSinceLastVn, assistantTurnCount, lastRecentVnMode } from './markers.js';

export type VoiceMode = 'chat' | 'sing';
export type VoiceDecisionReason =
  | 'explicit_sing'
  | 'explicit_vn'
  | 'spontaneous_vn'
  | 'disabled'
  | 'text_only_requested'
  | 'unsuitable_context'
  | 'unsuitable_reply'
  | 'cooldown'
  | 'random_skip';

export interface VoiceDecision {
  sendVn: boolean;
  mode: VoiceMode;
  reason: VoiceDecisionReason;
}

export interface SynthesizedVoiceNote {
  buffer: Buffer;
  mimetype: 'audio/ogg; codecs=opus';
  durationSec: number;
  waveform: Uint8Array;
  engine: 'edge-tts' | 'gemini-tts';
  model: string;
  mode: VoiceMode;
}

/** Minimal balasan teks sebelum bot boleh kirim VN spontan lagi (target rasio ~5:1). */
export const VN_MIN_TURNS_BETWEEN = 4;

/** Batas panjang teks wajar untuk VN spontan vs eksplisit. */
const MAX_SPONTANEOUS_VN_CHARS = 260;
const MAX_SPONTANEOUS_VN_WORDS = 46;
const MIN_SPONTANEOUS_VN_CHARS = 18;
const MAX_EXPLICIT_VN_CHARS = 460;

// ============================================================================
// 1. DETEKSI NIAT USER & PENJAGA SUASANA (KAPAN BOLEH / DILARANG VN)
// ============================================================================

const TEXT_ONLY_OPT_OUT_RE =
  /\b(?:jangan\s+(?:kirim\s+|pakai\s+|pake\s+|balas\s+(?:pakai\s+|pake\s+)?)?(?:vn|voice\s*note|suara)|ga\s*usah\s+(?:vn|voice\s*note|suara)|gak\s*usah\s+(?:vn|voice\s*note|suara)|nggak\s*usah\s+(?:vn|voice\s*note|suara)|teks\s+aja|text\s+aja|ketik\s+aja|tulis\s+aja|lewat\s+teks\s+aja)\b/i;

const SING_NEGATED_RE =
  /\b(?:jangan\s+(?:nyanyi|bernyanyi|nyanyiin|nyanyikan)|siapa\s+penyanyi|lagu\s+apa\s+itu|judul\s+lagu|arti\s+lirik|makna\s+lagu|penyanyi\s+(?:asli|nya))\b/i;

const SING_REQUEST_RE =
  /\b(?:nyanyiin|nyanyikan(?:lah)?|coba\s+(?:kamu\s+|lu\s+|lo\s+)?(?:nyanyi|bernyanyi|senandung)|tolong\s+(?:kamu\s+)?(?:nyanyi|nyanyiin|nyanyikan)|nyanyi\s+(?:dong|donk|deh|dulu|bentar|sebentar|satu|lagu|in|yuk|coba|pakai|pake|lewat)|nyanyi\s+aja|bernyanyi(?:lah)?\s+(?:dong|dulu|bentar|untukku|buatku)?|senandungin|senandungkan)\b/i;

const EXPLICIT_VN_RE =
  /\b(?:kirim(?:in)?\s+(?:aku\s+|gue\s+|dong\s+)?(?:vn|voice\s*note|pesan\s*suara)|balas\s+(?:pakai|pake|dengan|lewat)\s+(?:vn|voice\s*note|pesan\s*suara|suara)|jawab\s+(?:pakai|pake|dengan|lewat)\s+(?:vn|voice\s*note|pesan\s*suara|suara)|(?:pakai|pake|lewat)\s+(?:vn|voice\s*note|pesan\s*suara)|ngomong\s+(?:pakai|pake|lewat)\s+(?:vn|voice\s*note|suara)|coba\s+(?:kirim\s+)?(?:vn|voice\s*note|ngomong\s+(?:dong|pake\s+vn|pakai\s+vn)|dengar\s+suara(?:mu)?|denger\s+suara(?:mu)?)|pengen\s+(?:denger|dengar)\s+suara(?:mu)?|mau\s+(?:denger|dengar)\s+suara(?:mu)?|(?:vn|voice\s*note)\s+(?:dong|donk|deh|ya|plis|please|aja))\b/i;

const COMPLEX_OR_SERIOUS_USER_RE = new RegExp(
  [
    // Pekerjaan, formal, hukum, medis, keuangan serius
    '\\b(?:perusahaan|kantor|korporat|bisnis|klien|atasan|karyawan|laporan|proposal|kontrak|invoice|faktur|surat resmi|notulen|rapat|meeting|presentasi|deadline|sop|hukum|legalitas|pajak|akuntansi|audit|investasi|saham|strategi bisnis|manajemen|diagnosis|resep\\s+(?:dokter|obat|medis)|dosis|pasien|medis|klinis|regulasi|sertifikasi|secara profesional|profesional|formal|resmi|serius|seriusan|jangan bercanda|tanpa candaan)\\b',
    // Pertanyaan rumit, teknis, koding, akademik, hitungan, tutorial
    '\\b(?:jelaskan|jelasin\\s+detail|bagaimana\\s+cara|gimana\\s+cara(?:nya)?|tutorial|langkah\\s*-?\\s*langkah|step\\s+by\\s+step|perbedaan|bandingkan|analisis|analisa|rangkum|ringkas(?:kan)?|ringkasan|rumus|persamaan|hitung(?:kan|in)?|konversi|terjemah(?:kan|in)?|translate|coding|koding|kode|program|script|skrip|algoritma|error|bug|debug|stack\\s*trace|database|sql|query|regex|api|json|html|css|typescript|javascript|python|docker|linux|server|deploy|skripsi|makalah|jurnal|essay|esai|definisi|sejarah\\s+lengkap|sebutkan\\s+\\d+|daftar\\s+lengkap|rekomendasi\\s+\\d+)\\b',
    // Suasana sedih, marah, duka, sakit, stres berat -> tetap teks hangat & tenang
    '\\b(?:sedih|nangis|menangis|duka|berduka|meninggal|wafat|putus\\s+cinta|galau\\s+berat|depresi|stres\\s+berat|burnout|kecewa\\s+berat|marah|kesel|kesal|emosi|ngamuk|sakit\\s+(?:parah|banget|hati)|demam|masuk\\s+rs|rumah\\s+sakit|curhat|capek\\s+banget|lelah\\s+banget|putus\\s+asa|frustrasi|takut\\s+banget|panik\\s+banget)\\b',
  ].join('|'),
  'i',
);

const PLAYFUL_OR_CASUAL_SIGNAL_RE =
  /(?:wkwk+|kwkw+|haha+|hehe+|hihi+|ngakak|kocak|lucu|garing|receh|canda|bercanda|becanda|iseng|gabut|roast|ledek|gombal|tebak|anjay|gokil|buset|bjir+|jir+|santai|tongkrongan|nongkrong|mabar|gabut|halo+|hai+|woy+|oy+|pagi+|siang+|sore+|malem+|malam+|lagi\s+apa|ngapain|udah\s+makan|kangen|makasih|thanks|sip+|oke+|mantap+|gas+|yoi|iyalah|bener\s+juga|parah\s+sih|asik|seru|😂|🤣|😆|😅|😄|😁|😜|🤪|😹)/i;

const SYSTEM_OUTPUT_RE =
  /^(?:📊\s*\*?Ringkasan|⏰\s*\*?Pengingat|📋\s*\*?Daftar|✅\s*(?:Pengingat|Catatan|Tugas|Pengeluaran|Pemasukan)\s+(?:disimpan|dicatat|selesai))/i;

const VN_RETRY_RE =
  /^\s*(?:ulang(?:i+|in|g+)?|coba\s+ulang(?:i+|in)?|coba\s+lagi|sekali\s+lagi|nyanyi\s+lagi|vn\s+lagi|lagi\s+dong|ulang\s+dong|coba\s+lagi\s+dong)[!.?\s]*$/i;

/** True bila user secara eksplisit melarang VN di giliran ini. */
export function detectTextOnlyPreference(userText: string): boolean {
  return TEXT_ONLY_OPT_OUT_RE.test(userText || '');
}

/** True bila user meminta mengulang VN/nyanyian yang baru saja dikirim ("ulangii", "coba lagi"). */
export function detectVnRetryMode(
  userText: string,
  history?: Array<{ role: string; content: string | unknown }>,
): VoiceMode | null {
  const t = (userText || '').trim();
  if (!t || detectTextOnlyPreference(t) || !VN_RETRY_RE.test(t)) return null;
  return lastRecentVnMode(history, 4);
}

/** True bila user meminta bot menyanyi acapella lewat VN. */
export function detectSingRequest(userText: string): boolean {
  const t = (userText || '').trim();
  if (!t || detectTextOnlyPreference(t) || SING_NEGATED_RE.test(t)) return false;
  return SING_REQUEST_RE.test(t);
}

/** True bila user meminta bot membalas memakai VN/suara secara eksplisit. */
export function detectExplicitVnRequest(userText: string): boolean {
  const t = (userText || '').trim();
  if (!t || detectTextOnlyPreference(t)) return false;
  return EXPLICIT_VN_RE.test(t);
}

/**
 * Cek apakah teks balasan pantas diubah menjadi VN (ringkas, lisan, tanpa kode/link/daftar/angka berat).
 */
export function isReplySpeakable(reply: string, explicit = false): boolean {
  const raw = (reply || '').trim();
  if (!raw) return false;
  if (SYSTEM_OUTPUT_RE.test(raw)) return false;
  // Blok kode, URL, tabel markdown, atau daftar panjang tidak nyaman didengar lewat VN.
  if (/```/.test(raw) || /`[^`]{2,}`/.test(raw)) return false;
  if (/https?:\/\/|www\./i.test(raw)) return false;
  if (/(?:^|\n)\s*(?:[-*•]|\d+[.)])\s+/.test(raw) && !explicit) return false;
  if (/\|.+\|/.test(raw)) return false;
  // Banyak angka/harga/tanggal/koordinat -> lebih enak dibaca lewat teks.
  const digitRuns = raw.match(/\d{3,}/g);
  if (!explicit && digitRuns && digitRuns.length >= 2) return false;
  if (!explicit && /\bRp\.?\s*\d/i.test(raw)) return false;
  // Banyak baris / paragraf panjang -> tidak cocok jadi VN spontan.
  const lineCount = raw.split(/\n+/).filter((l) => l.trim()).length;
  if (!explicit && lineCount > 3) return false;

  const cleaned = prepareTextForTts(raw, 'chat');
  if (!cleaned) return false;
  if (explicit) {
    return cleaned.length >= 4 && cleaned.length <= MAX_EXPLICIT_VN_CHARS;
  }
  const words = cleaned.split(/\s+/).filter(Boolean).length;
  return (
    cleaned.length >= MIN_SPONTANEOUS_VN_CHARS &&
    cleaned.length <= MAX_SPONTANEOUS_VN_CHARS &&
    words >= 4 &&
    words <= MAX_SPONTANEOUS_VN_WORDS
  );
}

export interface DecideVoiceParams {
  userText: string;
  reply: string;
  history?: Array<{ role: string; content: string | unknown }>;
  hasWebResults?: boolean;
  isGroup?: boolean;
  fromUserVoiceNote?: boolean;
  hasRiddleAnswer?: boolean;
  enabled?: boolean;
  /** Interval target teks-banding-VN (default 5 -> sekitar 5:1). */
  targetInterval?: number;
  /** RNG opsional (untuk unit test deterministik). */
  rng?: () => number;
}

/**
 * Putuskan apakah balasan giliran ini dikirim sebagai Voice Note (`chat` atau `sing`).
 *
 * Logika:
 * 1. User minta "teks aja / jangan vn" -> selalu teks.
 * 2. User minta nyanyi (`coba nyanyikan...`, `nyanyi dong`) -> VN mode `sing` (Gemini TTS).
 * 3. User minta VN (`kirim vn`, `balas pake suara`) -> VN mode `chat` (Edge-TTS).
 * 4. VN spontan (~5:1):
 *    - HANYA saat suasana santai/ringan/bercanda (bukan topik rumit, teknis, serius, sedih, formal, pencarian web).
 *    - HANYA saat balasan pendek & lisan (18–260 char, tanpa kode/URL/daftar/tabel/angka berat).
 *    - Cooldown durable dari riwayat (`[VN terkirim: ...]`), minimal `interval - 1` balasan teks sejak VN terakhir:
 *      - Bila belum pernah kirim VN di riwayat, tunggu sampai ada minimal 4 balasan teks sebelumnya (atau 2 bila user baru kirim VN).
 *      - Pada turn ke-4 sejak VN terakhir: peluang 35% (atau 65% jika user bercanda/kirim VN).
 *      - Pada turn ke-5 (rasio 5:1): peluang 75% (atau 90% jika user bercanda/kirim VN).
 *      - Pada turn >= 6: 100% langsung kirim VN begitu ketemu momen santai yang cocok.
 */
export function decideVoiceReply(params: DecideVoiceParams): VoiceDecision {
  const enabled = params.enabled ?? config.voiceNoteEnabled;
  if (!enabled) {
    return { sendVn: false, mode: 'chat', reason: 'disabled' };
  }

  const userText = (params.userText || '').trim();
  const reply = (params.reply || '').trim();
  if (!reply) {
    return { sendVn: false, mode: 'chat', reason: 'unsuitable_reply' };
  }
  if (detectTextOnlyPreference(userText)) {
    return { sendVn: false, mode: 'chat', reason: 'text_only_requested' };
  }

  // 1. Permintaan nyanyi eksplisit (atau mengulang VN nyanyi sebelumnya: "ulangii", "coba lagi")
  const retryMode = detectVnRetryMode(userText, params.history);
  if (detectSingRequest(userText) || retryMode === 'sing') {
    if (!isReplySpeakable(reply, true)) {
      return { sendVn: false, mode: 'sing', reason: 'unsuitable_reply' };
    }
    return { sendVn: true, mode: 'sing', reason: 'explicit_sing' };
  }

  // 2. Permintaan VN eksplisit (atau mengulang VN bicara sebelumnya)
  if (detectExplicitVnRequest(userText) || retryMode === 'chat') {
    if (!isReplySpeakable(reply, true)) {
      return { sendVn: false, mode: 'chat', reason: 'unsuitable_reply' };
    }
    return { sendVn: true, mode: 'chat', reason: 'explicit_vn' };
  }

  // 3. VN spontan — filter ketat konteks & bentuk balasan
  if (params.hasWebResults) {
    return { sendVn: false, mode: 'chat', reason: 'unsuitable_context' };
  }
  if (params.hasRiddleAnswer) {
    // Tebak-tebakan lebih enak dibaca teks agar permainan kata/ejaan jelas.
    return { sendVn: false, mode: 'chat', reason: 'unsuitable_context' };
  }
  if (COMPLEX_OR_SERIOUS_USER_RE.test(userText)) {
    return { sendVn: false, mode: 'chat', reason: 'unsuitable_context' };
  }
  // Pertanyaan panjang (>140 karakter) umumnya butuh penjelasan serius/detail.
  if (userText.length > 140) {
    return { sendVn: false, mode: 'chat', reason: 'unsuitable_context' };
  }
  // Perintah slash (/help, /status, dll) selalu teks.
  if (/^\s*\//.test(userText)) {
    return { sendVn: false, mode: 'chat', reason: 'unsuitable_context' };
  }
  if (!isReplySpeakable(reply, false)) {
    return { sendVn: false, mode: 'chat', reason: 'unsuitable_reply' };
  }

  // 4. Cek jeda durable (~5:1) dari riwayat percakapan
  const interval = Math.max(2, params.targetInterval ?? config.vnSpontaneousInterval ?? 5);
  const minTurns = Math.max(2, interval - 1);
  const turnsSinceVn = assistantTurnsSinceLastVn(params.history);
  const totalAssistantTurns = assistantTurnCount(params.history);
  const effectiveTurns = turnsSinceVn === Number.MAX_SAFE_INTEGER ? totalAssistantTurns : turnsSinceVn;

  const isPlayful = PLAYFUL_OR_CASUAL_SIGNAL_RE.test(userText) || PLAYFUL_OR_CASUAL_SIGNAL_RE.test(reply);

  // Di grup, lebih selektif: hanya saat suasana benar-benar santai/bercanda dan jeda lebih lega.
  if (params.isGroup) {
    if (!isPlayful && !params.fromUserVoiceNote) {
      return { sendVn: false, mode: 'chat', reason: 'unsuitable_context' };
    }
    if (effectiveTurns < interval + 1) {
      return { sendVn: false, mode: 'chat', reason: 'cooldown' };
    }
  } else {
    // Di DM: bila user baru saja mengirim VN, boleh balas VN sedikit lebih awal (>= 2 balasan teks)
    const minRequired = params.fromUserVoiceNote ? Math.min(2, minTurns) : minTurns;
    if (effectiveTurns < minRequired) {
      return { sendVn: false, mode: 'chat', reason: 'cooldown' };
    }
  }

  // Probabilitas alami agar terasa spontan tapi DIJAMIN muncul sekitar rasio 5:1:
  // - effectiveTurns == interval - 1 (mis. 4): 35% (65% bila bercanda / balas VN user)
  // - effectiveTurns == interval     (mis. 5): 75% (90% bila bercanda / balas VN user)
  // - effectiveTurns >= interval + 1 (mis. >=6): 100% (pasti kirim begitu momen santai tiba)
  let prob: number;
  if (effectiveTurns >= interval + 1) {
    prob = 1.0;
  } else if (effectiveTurns >= interval) {
    prob = isPlayful || params.fromUserVoiceNote ? 0.9 : 0.75;
  } else {
    prob = isPlayful || params.fromUserVoiceNote ? 0.65 : 0.35;
  }

  const roll = (params.rng ?? Math.random)();
  if (roll < prob) {
    return { sendVn: true, mode: 'chat', reason: 'spontaneous_vn' };
  }
  return { sendVn: false, mode: 'chat', reason: 'random_skip' };
}

// ============================================================================
// 2. PEMBERSIH TEKS UNTUK UCAPAN TTS BAHASA INDONESIA YANG NATURAL
// ============================================================================

const CHAT_ABBREV_MAP: Array<[RegExp, string]> = [
  [/\b(?:(?:wk){2,}w?|(?:kw){2,}k?|wkw+k+|awok(?:wok)*)\b/gi, 'haha'],
  [/\byg\b/gi, 'yang'],
  [/\bdgn\b/gi, 'dengan'],
  [/\bkrn\b/gi, 'karena'],
  [/\bkarna\b/gi, 'karena'],
  [/\bbgt\b/gi, 'banget'],
  [/\bbangett+\b/gi, 'banget'],
  [/\btp\b/gi, 'tapi'],
  [/\bsm\b/gi, 'sama'],
  [/\butk\b/gi, 'untuk'],
  [/\borg\b/gi, 'orang'],
  [/\bbkn\b/gi, 'bukan'],
  [/\bblm\b/gi, 'belum'],
  [/\bsdh\b/gi, 'sudah'],
  [/\budh\b/gi, 'udah'],
  [/\blg\b/gi, 'lagi'],
  [/\bskrg\b/gi, 'sekarang'],
  [/\bemg\b/gi, 'emang'],
  [/\bgmn\b/gi, 'gimana'],
  [/\bknp\b/gi, 'kenapa'],
  [/\bkm\b/gi, 'kamu'],
  [/\bsy\b/gi, 'saya'],
  [/\bgw\b/gi, 'gue'],
  [/\btdk\b/gi, 'tidak'],
  [/\bgak\b/gi, 'nggak'],
  [/\bga\b/gi, 'nggak'],
  [/\bngga\b/gi, 'nggak'],
  [/\bgt\b/gi, 'gitu'],
  [/\bgtu\b/gi, 'gitu'],
  [/\bdlm\b/gi, 'dalam'],
  [/\bsbntr\b/gi, 'sebentar'],
  [/\bbntr\b/gi, 'bentar'],
  [/\bmksd\b/gi, 'maksud'],
  [/\bspt\b/gi, 'seperti'],
  [/\bjd\b/gi, 'jadi'],
  [/\bjgn\b/gi, 'jangan'],
  [/\bdr\b/gi, 'dari'],
  [/\bdtg\b/gi, 'datang'],
  [/\bkl\b/gi, 'kalau'],
  [/\bklo\b/gi, 'kalau'],
  [/\bvn\b/gi, 'voice note'],
];

/**
 * Bersihkan markdown, emoji, tag internal, dan singkatan chat agar ucapan TTS terdengar natural.
 */
export function prepareTextForTts(text: string, mode: VoiceMode = 'chat'): string {
  let out = String(text || '');
  // Buang tag internal & penanda durable
  out = out.replace(/\[\[(?:sticker|jawab|sticker_read):[^\]]*\]\]/gi, '');
  out = out.replace(/\[(?:Stiker terkirim|Jawaban|VN terkirim):[^\]]*\]/gi, '');
  // Buang stage direction / aksi dalam bintang/kurung siku (terutama saat nyanyi)
  out = out.replace(/\*[^*\n]{1,40}\*/g, (m) => {
    const inner = m.slice(1, -1).trim();
    // Bila terlihat seperti aksi panggung (*berdehem*, *nyanyi*, *tertawa*), buang; kalau penekanan kata, ambil isinya.
    if (/^(?:berdehem|dehem|nyanyi|bernyanyi|tertawa|ketawa|senyum|hela\s+napas|musik|intro|outro|bisik)/i.test(inner)) {
      return ' ';
    }
    return inner;
  });
  out = out.replace(/\[(?:musik|intro|outro|chorus|reff|bait|verse|lagu|nyanyi|senandung|tepuk\s+tangan)[^\]]*\]/gi, ' ');
  // Buang formatting markdown
  out = out.replace(/```[\s\S]*?```/g, ' ');
  out = out.replace(/[*_~`#>]/g, '');
  // Buang emoji Unicode agar mesin TTS tidak mengeja deskripsi emoji
  out = out.replace(/\p{Extended_Pictographic}/gu, ' ');
  out = out.replace(/[\u200D\uFE0E\uFE0F]/g, '');

  // Rapikan huruf berulang ekstrem ("iyaaaaaa" -> "iyaa", "mantappppp" -> "mantap")
  out = out.replace(/([a-zA-Z])\1{2,}/g, '$1$1');

  // Ubah singkatan chat Indonesia ke bentuk lisan yang enak diucapkan TTS
  for (const [re, rep] of CHAT_ABBREV_MAP) {
    out = out.replace(re, rep);
  }

  // Untuk nyanyi, ubah newline antar-baris lirik jadi jeda koma lembut agar melodi mengalir
  if (mode === 'sing') {
    out = out.replace(/\r?\n+/g, ', ');
  } else {
    out = out.replace(/\r?\n+/g, '. ');
  }

  out = out
    .replace(/\s+([,.;!?])/g, '$1')
    .replace(/([,.;!?]){2,}/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();

  const maxLen = mode === 'sing' ? MAX_EXPLICIT_VN_CHARS : MAX_EXPLICIT_VN_CHARS;
  if (out.length > maxLen) {
    const cut = out.slice(0, maxLen);
    const lastStop = Math.max(cut.lastIndexOf('.'), cut.lastIndexOf(','), cut.lastIndexOf(' '));
    out = (lastStop > maxLen * 0.6 ? cut.slice(0, lastStop) : cut).trim();
  }
  return out;
}

// ============================================================================
// 3. KONVERSI AUDIO KE OGG OPUS (`audio/ogg; codecs=opus`) — TANPA FFMPEG
// ============================================================================

/** Tabel CRC-32 Ogg standar (non-reflected, polinomial 0x04C11DB7, RFC 3533). */
const OGG_CRC_TABLE = (() => {
  const tbl = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let r = i << 24;
    for (let j = 0; j < 8; j++) {
      r = (r & 0x80000000) !== 0 ? ((r << 1) ^ 0x04c11db7) >>> 0 : (r << 1) >>> 0;
    }
    tbl[i] = r >>> 0;
  }
  return tbl;
})();

function oggCrc32(buf: Uint8Array): number {
  let crc = 0;
  for (let i = 0; i < buf.length; i++) {
    crc = (((crc << 8) >>> 0) ^ OGG_CRC_TABLE[((crc >>> 24) ^ buf[i]) & 0xff]) >>> 0;
  }
  return crc >>> 0;
}

function buildOggPage(
  packets: Uint8Array[],
  headerType: number,
  granulePos: bigint,
  serial: number,
  seqNo: number,
): Buffer {
  const lacing: number[] = [];
  let payloadLen = 0;
  for (const pkt of packets) {
    payloadLen += pkt.length;
    let rem = pkt.length;
    while (rem >= 255) {
      lacing.push(255);
      rem -= 255;
    }
    lacing.push(rem);
  }
  const page = Buffer.allocUnsafe(27 + lacing.length + payloadLen);
  page.write('OggS', 0, 'ascii');
  page[4] = 0; // version
  page[5] = headerType;
  page.writeBigInt64LE(granulePos, 6);
  page.writeUInt32LE(serial >>> 0, 14);
  page.writeUInt32LE(seqNo >>> 0, 18);
  page.writeUInt32LE(0, 22); // CRC placeholder
  page[26] = lacing.length;
  for (let i = 0; i < lacing.length; i++) {
    page[27 + i] = lacing[i];
  }
  let off = 27 + lacing.length;
  for (const pkt of packets) {
    Buffer.from(pkt.buffer, pkt.byteOffset, pkt.byteLength).copy(page, off);
    off += pkt.length;
  }
  const crc = oggCrc32(page);
  page.writeUInt32LE(crc, 22);
  return page;
}

/** Hitung jumlah sampel 48kHz dari satu paket Opus mentah sesuai RFC 6716 Section 3.1. */
function opusPacketSamples48k(pkt: Uint8Array): number {
  if (pkt.length === 0) return 960;
  const toc = pkt[0];
  const cfg = (toc >> 3) & 0x1f;
  let frameSamples: number;
  if (cfg < 12) {
    frameSamples = [480, 960, 1920, 2880][cfg & 3];
  } else if (cfg < 16) {
    frameSamples = [480, 960][cfg & 1];
  } else {
    frameSamples = [120, 240, 480, 960][cfg & 3];
  }
  const c = toc & 0x03;
  let frameCount = 1;
  if (c === 1 || c === 2) frameCount = 2;
  else if (c === 3 && pkt.length >= 2) frameCount = Math.max(1, pkt[1] & 0x3f);
  return frameSamples * frameCount;
}

function readEbmlVint(buf: Buffer, pos: number, isId: boolean): { value: number; length: number; unknown: boolean } | null {
  if (pos >= buf.length) return null;
  const first = buf[pos];
  if (first === 0) return null;
  let mask = 0x80;
  let length = 1;
  while (length <= 8 && (first & mask) === 0) {
    mask >>= 1;
    length++;
  }
  if (length > 8 || pos + length > buf.length) return null;
  if (isId) {
    if (length > 4) return null;
    let id = 0;
    for (let i = 0; i < length; i++) id = id * 256 + buf[pos + i];
    return { value: id, length, unknown: false };
  }
  let val = first & (mask - 1);
  let allOnes = val === mask - 1;
  for (let i = 1; i < length; i++) {
    val = val * 256 + buf[pos + i];
    if (buf[pos + i] !== 0xff) allOnes = false;
  }
  return { value: val, length, unknown: allOnes };
}

const WEBM_CONTAINERS = new Set([
  0x18538067, // Segment
  0x1654ae6b, // Tracks
  0xae,       // TrackEntry
  0x1f43b675, // Cluster
  0xa0,       // BlockGroup
]);

/** Ekstrak paket Opus mentah + OpusHead dari WebM (`webm-24khz-16bit-mono-opus`) lalu bungkus ulang lossless ke Ogg Opus. */
export function remuxWebmOpusToOgg(webm: Buffer): { ogg: Buffer; durationSec: number; waveform: Uint8Array } {
  const packets: Uint8Array[] = [];
  let opusHead: Buffer | null = null;

  const walk = (start: number, end: number) => {
    let pos = start;
    while (pos < end) {
      const id = readEbmlVint(webm, pos, true);
      if (!id) break;
      pos += id.length;
      const sz = readEbmlVint(webm, pos, false);
      if (!sz) break;
      pos += sz.length;
      const elemEnd = sz.unknown ? end : Math.min(end, pos + sz.value);

      if (WEBM_CONTAINERS.has(id.value)) {
        walk(pos, elemEnd);
      } else if (id.value === 0x63a2) {
        // CodecPrivate (OpusHead)
        const slice = webm.subarray(pos, elemEnd);
        if (slice.length >= 19 && slice.subarray(0, 8).toString('ascii') === 'OpusHead') {
          opusHead = Buffer.from(slice);
        }
      } else if (id.value === 0xa3 || id.value === 0xa1) {
        // SimpleBlock (0xA3) / Block (0xA1)
        const trackVint = readEbmlVint(webm, pos, false);
        if (trackVint) {
          const headerBytes = trackVint.length + 3; // track VINT + int16 timecode + uint8 flags
          const pStart = pos + headerBytes;
          if (pStart < elemEnd) {
            const flags = webm[pos + trackVint.length + 2];
            const lacingType = (flags >> 1) & 0x03;
            if (lacingType === 0) {
              packets.push(new Uint8Array(webm.subarray(pStart, elemEnd)));
            } else if (lacingType === 2 && pStart + 1 < elemEnd) {
              // Fixed-size lacing
              const frameCount = webm[pStart] + 1;
              const dataStart = pStart + 1;
              const frameSize = Math.floor((elemEnd - dataStart) / frameCount);
              for (let i = 0; i < frameCount; i++) {
                const fStart = dataStart + i * frameSize;
                if (fStart + frameSize <= elemEnd) {
                  packets.push(new Uint8Array(webm.subarray(fStart, fStart + frameSize)));
                }
              }
            } else {
              // Fallback: anggap satu paket
              packets.push(new Uint8Array(webm.subarray(pStart, elemEnd)));
            }
          }
        }
      }

      if (sz.unknown) break;
      pos = elemEnd;
    }
  };

  walk(0, webm.length);
  if (packets.length === 0) {
    throw new Error('Tidak ada paket Opus ditemukan di stream WebM Edge-TTS');
  }

  if (!opusHead) {
    opusHead = Buffer.alloc(19);
    opusHead.write('OpusHead', 0, 'ascii');
    opusHead[8] = 1; // version
    opusHead[9] = 1; // channels (mono)
    opusHead.writeUInt16LE(312, 10); // pre-skip
    opusHead.writeUInt32LE(24000, 12); // input sample rate
    opusHead.writeInt16LE(0, 16); // output gain
    opusHead[18] = 0; // channel mapping family
  }

  const preSkip = opusHead.readUInt16LE(10);
  const vendor = Buffer.from('FreeAIBot', 'utf8');
  const opusTags = Buffer.alloc(8 + 4 + vendor.length + 4);
  opusTags.write('OpusTags', 0, 'ascii');
  opusTags.writeUInt32LE(vendor.length, 8);
  vendor.copy(opusTags, 12);
  opusTags.writeUInt32LE(0, 12 + vendor.length);

  const serial = (Math.floor(Math.random() * 0x7fffffff) + 1) >>> 0;
  const pages: Buffer[] = [];
  let seq = 0;
  pages.push(buildOggPage([opusHead], 0x02, 0n, serial, seq++));
  pages.push(buildOggPage([opusTags], 0x00, 0n, serial, seq++));

  let granule = BigInt(preSkip);
  let totalSamples = 0;
  let batch: Uint8Array[] = [];
  let batchSegments = 0;

  for (let i = 0; i < packets.length; i++) {
    const pkt = packets[i];
    const segs = Math.floor(pkt.length / 255) + 1;
    if (batch.length > 0 && (batch.length >= 25 || batchSegments + segs > 240)) {
      pages.push(buildOggPage(batch, 0x00, granule, serial, seq++));
      batch = [];
      batchSegments = 0;
    }
    const samples = opusPacketSamples48k(pkt);
    granule += BigInt(samples);
    totalSamples += samples;
    batch.push(pkt);
    batchSegments += segs;
  }
  if (batch.length > 0) {
    pages.push(buildOggPage(batch, 0x04, granule, serial, seq++));
  }

  const waveform = buildWaveformFromPackets(packets);
  return {
    ogg: Buffer.concat(pages),
    durationSec: Math.max(1, Math.round(totalSamples / 48000)),
    waveform,
  };
}

/** Bentuk 64-byte waveform visual untuk WhatsApp Baileys dari ukuran paket Opus (korelasi tinggi dengan energi suara). */
function buildWaveformFromPackets(packets: Uint8Array[]): Uint8Array {
  const bars = new Uint8Array(64);
  if (packets.length === 0) return bars;
  let maxLen = 1;
  const bucketAvg: number[] = new Array(64).fill(0);
  for (let i = 0; i < 64; i++) {
    const start = Math.floor((i * packets.length) / 64);
    const end = Math.max(start + 1, Math.floor(((i + 1) * packets.length) / 64));
    let sum = 0;
    for (let j = start; j < end && j < packets.length; j++) sum += packets[j].length;
    const avg = sum / Math.max(1, end - start);
    bucketAvg[i] = avg;
    if (avg > maxLen) maxLen = avg;
  }
  for (let i = 0; i < 64; i++) {
    bars[i] = Math.min(100, Math.max(8, Math.round((bucketAvg[i] / maxLen) * 95)));
  }
  return bars;
}

/** Bentuk 64-byte waveform visual dari sampel PCM Float32. */
function buildWaveformFromPcm(samples: Float32Array): Uint8Array {
  const bars = new Uint8Array(64);
  if (samples.length === 0) return bars;
  const rms: number[] = new Array(64).fill(0);
  let peak = 0.001;
  for (let i = 0; i < 64; i++) {
    const start = Math.floor((i * samples.length) / 64);
    const end = Math.max(start + 1, Math.floor(((i + 1) * samples.length) / 64));
    let sumSq = 0;
    const step = Math.max(1, Math.floor((end - start) / 256));
    let count = 0;
    for (let j = start; j < end && j < samples.length; j += step) {
      sumSq += samples[j] * samples[j];
      count++;
    }
    const v = Math.sqrt(sumSq / Math.max(1, count));
    rms[i] = v;
    if (v > peak) peak = v;
  }
  for (let i = 0; i < 64; i++) {
    bars[i] = Math.min(100, Math.max(6, Math.round((rms[i] / peak) * 96)));
  }
  return bars;
}

/** Parse WAV (RIFF PCM 16-bit) atau raw PCM L16 24kHz mono lalu encode ke Ogg Opus via WASM `@audio/encode-opus`. */
export async function encodeWavOrPcmToOggOpus(
  audioBuf: Buffer,
  mimeType: string,
  application: 'voip' | 'audio' = 'voip',
  bitrate = 28,
): Promise<{ ogg: Buffer; durationSec: number; waveform: Uint8Array }> {
  let sampleRate = 24000;
  let channels = 1;
  let dataOffset = 0;
  let dataLength = audioBuf.length;

  const isWav = audioBuf.length >= 44 && audioBuf.subarray(0, 4).toString('ascii') === 'RIFF';
  if (isWav) {
    let off = 12;
    while (off + 8 <= audioBuf.length) {
      const id = audioBuf.subarray(off, off + 4).toString('ascii');
      const sz = audioBuf.readUInt32LE(off + 4);
      if (id === 'fmt ' && off + 24 <= audioBuf.length) {
        channels = Math.max(1, audioBuf.readUInt16LE(off + 10));
        sampleRate = audioBuf.readUInt32LE(off + 12) || 24000;
      } else if (id === 'data') {
        dataOffset = off + 8;
        dataLength = Math.min(sz, audioBuf.length - dataOffset);
        break;
      }
      off += 8 + sz + (sz % 2);
    }
  } else {
    const rateMatch = /rate=(\d+)/i.exec(mimeType || '');
    if (rateMatch) sampleRate = Number(rateMatch[1]) || 24000;
  }

  const totalFrames = Math.floor(dataLength / (2 * channels));
  if (totalFrames <= 0) {
    throw new Error('Buffer audio PCM kosong');
  }

  // Downmix ke mono Float32 untuk ukuran VN kecil & kompatibel penuh dengan Meta voice:true
  const mono = new Float32Array(totalFrames);
  for (let i = 0; i < totalFrames; i++) {
    let sum = 0;
    for (let ch = 0; ch < channels; ch++) {
      const bytePos = dataOffset + (i * channels + ch) * 2;
      if (bytePos + 1 < audioBuf.length) {
        sum += audioBuf.readInt16LE(bytePos) / 32768;
      }
    }
    mono[i] = sum / channels;
  }

  const encoder = await encodeOpus({
    sampleRate,
    channels: 1,
    bitrate,
    application,
  });
  try {
    const head = encoder.encode([mono]);
    const tail = encoder.flush();
    const ogg = Buffer.concat([Buffer.from(head), Buffer.from(tail)]);
    return {
      ogg,
      durationSec: Math.max(1, Math.round(totalFrames / sampleRate)),
      waveform: buildWaveformFromPcm(mono),
    };
  } finally {
    encoder.free();
  }
}

// ============================================================================
// 4. ENGINE SINTESIS: EDGE-TTS & GEMINI 3.8 TTS
// ============================================================================

let lastEdgeTtsCallMs = 0;

/** Cooldown per (model, keyIndex) saat kena HTTP 429 agar langsung lompat ke model/key berikutnya tanpa buang waktu. */
const geminiTtsCooldownUntil = new Map<string, number>();
const GEMINI_TTS_429_COOLDOWN_MS = 10 * 60 * 1000;

function isGeminiBucketCooling(model: string, keyIdx: number): boolean {
  const until = geminiTtsCooldownUntil.get(`${model}#${keyIdx}`) || 0;
  return Date.now() < until;
}

function markGeminiBucketRateLimited(model: string, keyIdx: number): void {
  geminiTtsCooldownUntil.set(`${model}#${keyIdx}`, Date.now() + GEMINI_TTS_429_COOLDOWN_MS);
}

/** Sintesis VN lewat Microsoft Edge Neural TTS (`id-ID-ArdiNeural` / `id-ID-GadisNeural`). */
async function synthesizeViaEdgeTts(
  spokenText: string,
  mode: VoiceMode,
): Promise<SynthesizedVoiceNote> {
  // Jaga jarak tipis antar-koneksi Edge-TTS agar terhindar dari HTTP 429 burst limit
  const elapsed = Date.now() - lastEdgeTtsCallMs;
  if (elapsed < 1200) {
    await new Promise((r) => setTimeout(r, 1200 - elapsed));
  }
  lastEdgeTtsCallMs = Date.now();

  const gecVersion = config.edgeTtsGecVersion || '1-143.0.3650.75';
  const major = gecVersion.split('-')[1]?.split('.')[0] || '143';
  const ua = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36 Edg/${major}.0.0.0`;

  const voice = config.ttsVoice || 'id-ID-ArdiNeural';
  const rate = mode === 'sing' ? '+2%' : (config.ttsRate || '+0%');
  const pitch = mode === 'sing' ? '+4Hz' : (config.ttsPitch || '+0Hz');

  const tts = new EdgeTTS({
    secMsGecVersion: gecVersion,
    headers: { 'User-Agent': ua },
  });

  await tts.synthesize(spokenText, voice, {
    outputFormat: 'webm-24khz-16bit-mono-opus',
    rate,
    pitch,
    timeout: 12000,
  });
  const webmBuf = tts.toBuffer();
  if (!webmBuf || webmBuf.length < 200) {
    throw new Error('Edge-TTS mengembalikan audio kosong');
  }

  const { ogg, durationSec, waveform } = remuxWebmOpusToOgg(webmBuf);
  return {
    buffer: ogg,
    mimetype: 'audio/ogg; codecs=opus',
    durationSec,
    waveform,
    engine: 'edge-tts',
    model: voice,
    mode,
  };
}

/** Sintesis VN natural lewat Gemini TTS (`v1beta/interactions` untuk seri 3.8, `:generateContent` untuk 2.5 preview). */
async function synthesizeViaGeminiTts(
  spokenText: string,
  mode: VoiceMode,
  preferredModels?: string[],
): Promise<SynthesizedVoiceNote> {
  const keys = config.pools.gemini;
  if (!keys || keys.length === 0) {
    throw new Error('GEMINI_KEYS tidak tersedia untuk Gemini TTS');
  }

  const defaultChain = mode === 'sing'
    ? [config.geminiTtsModel, config.geminiTtsLiteModel, config.geminiTtsBackupModel]
    : [config.geminiTtsLiteModel, config.geminiTtsModel, config.geminiTtsBackupModel];
  const models = Array.from(new Set((preferredModels && preferredModels.length > 0 ? preferredModels : defaultChain).filter(Boolean)));

  const voiceName = config.geminiTtsVoice || (/gadis/i.test(config.ttsVoice || '') ? 'Aoede' : 'Puck');
  const isEnglishLyrics =
    mode === 'sing' &&
    /\b(?:the|you|and|with|smile|love|heart|world|night|hold|close|never|want|if|was|over|be|next|to)\b/i.test(spokenText);
  const isSlowEmotionalSong =
    mode === 'sing' &&
    /\b(?:die|smile|love|heart|world|hold|cry|miss|forever|rindu|cinta|luka|hati|pergi|hilang|air\s+mata|malam|sepi|kenangan|sendiri|sial|menangis|sayang)\b/i.test(spokenText);
  const singLang = isEnglishLyrics ? 'natural English' : 'natural Indonesian';
  const style = mode === 'sing'
    ? isSlowEmotionalSong
      ? `singing acapella softly and soulfully in ${singLang}, slow heartfelt emotional pop ballad melody, warm natural human voice with gentle vibrato and smooth phrasing, no background instruments`
      : `singing acapella smoothly in ${singLang}, warm rhythmic melodic vocal phrasing like a friend humming and singing casually, no background instruments`
    : 'relaxed young Indonesian close friend sending a casual spontaneous WhatsApp voice note, warm natural everyday Jakarta conversational rhythm, effortless human breathing and intonation, never formal or robotic';

  let lastErr: Error = new Error('Gemini TTS gagal');

  for (const model of models) {
    const useLegacyGenerateContent = /^gemini-2\.5-/i.test(model);

    for (let kIdx = 0; kIdx < keys.length; kIdx++) {
      if (isGeminiBucketCooling(model, kIdx)) continue;
      const key = keys[kIdx];
      try {
        let audioBase64 = '';
        let audioMime = useLegacyGenerateContent ? 'audio/L16;codec=pcm;rate=24000' : 'audio/wav';

        if (useLegacyGenerateContent) {
          const direction = mode === 'sing'
            ? `Sing playfully acapella in natural Indonesian: ${spokenText}`
            : `Speak casually like a relaxed young Indonesian friend sending a warm WhatsApp voice note (not formal, not robotic): ${spokenText}`;
          const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{ parts: [{ text: direction }] }],
                generationConfig: {
                  responseModalities: ['AUDIO'],
                  speechConfig: {
                    voiceConfig: {
                      prebuiltVoiceConfig: { voiceName },
                    },
                  },
                },
              }),
              signal: AbortSignal.timeout(18000),
            },
          );
          if (!res.ok) {
            if (res.status === 429) markGeminiBucketRateLimited(model, kIdx);
            const errText = await res.text().catch(() => '');
            lastErr = new Error(`Gemini TTS ${model} HTTP ${res.status}: ${errText.slice(0, 140)}`);
            continue;
          }
          const data = (await res.json()) as {
            candidates?: Array<{
              content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }> };
            }>;
          };
          const inline = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData;
          if (inline?.data) {
            audioBase64 = inline.data;
            if (inline.mimeType) audioMime = inline.mimeType;
          }
        } else {
          const res = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-goog-api-key': key,
              'Api-Revision': '2026-05-20',
            },
            body: JSON.stringify({
              model,
              input: [
                {
                  type: 'user_input',
                  content: [
                    {
                      type: 'text',
                      text: spokenText,
                      annotations: [
                        {
                          type: 'speech_metadata',
                          style,
                        },
                      ],
                    },
                  ],
                },
              ],
              response_format: { type: 'audio' },
              generation_config: {
                speech_config: [{ voice: voiceName }],
              },
            }),
            signal: AbortSignal.timeout(18000),
          });

          if (!res.ok) {
            if (res.status === 429) markGeminiBucketRateLimited(model, kIdx);
            const errText = await res.text().catch(() => '');
            lastErr = new Error(`Gemini TTS ${model} HTTP ${res.status}: ${errText.slice(0, 140)}`);
            continue;
          }

          const data = (await res.json()) as {
            steps?: Array<{
              type?: string;
              content?: Array<{ type?: string; mime_type?: string; data?: string }>;
            }>;
          };
          for (const step of data.steps ?? []) {
            for (const item of step.content ?? []) {
              if (item.type === 'audio' && typeof item.data === 'string' && item.data.length > 0) {
                audioBase64 = item.data;
                if (item.mime_type) audioMime = item.mime_type;
                break;
              }
            }
            if (audioBase64) break;
          }
        }

        if (!audioBase64) {
          lastErr = new Error(`Gemini TTS ${model} tidak mengembalikan payload audio`);
          continue;
        }

        const rawBuf = Buffer.from(audioBase64, 'base64');
        // Pakai mode 'audio' 32–36 kbps agar nuansa suara manusia tetap hangat & jernih (tidak cempreng/telepon).
        const { ogg, durationSec, waveform } = await encodeWavOrPcmToOggOpus(
          rawBuf,
          audioMime,
          'audio',
          mode === 'sing' ? 36 : 32,
        );

        return {
          buffer: ogg,
          mimetype: 'audio/ogg; codecs=opus',
          durationSec,
          waveform,
          engine: 'gemini-tts',
          model,
          mode,
        };
      } catch (err) {
        lastErr = err instanceof Error ? err : new Error(String(err));
      }
    }
  }

  throw lastErr;
}

/**
 * Sintesis Voice Note OGG/Opus siap kirim dengan prioritas suara paling natural:
 * - `chat`: Gemini 3.8 Flash-Lite TTS -> Gemini 3.8 Flash TTS -> Gemini 2.5 Flash Preview TTS.
 * - `sing`: Gemini 3.8 Flash TTS -> Gemini 3.8 Flash-Lite TTS -> Gemini 2.5 Flash Preview TTS.
 * - Edge-TTS hanya dipakai sebagai cadangan opsional bila `VOICE_EDGE_FALLBACK=1` (default mati
 *   agar kualitas VN tidak turun jadi suara robotik saat kuota Gemini TTS habis; caller fallback ke teks).
 */
export async function synthesizeVoiceNote(
  replyText: string,
  mode: VoiceMode = 'chat',
): Promise<SynthesizedVoiceNote | null> {
  const spoken = prepareTextForTts(replyText, mode);
  if (!spoken || spoken.length < 3) return null;

  try {
    return await synthesizeViaGeminiTts(spoken, mode);
  } catch (err) {
    console.warn(`[voice] Gemini TTS (${mode}) gagal:`, String((err as Error)?.message ?? err));
    if (!config.voiceEdgeFallback) {
      return null;
    }
    try {
      return await synthesizeViaEdgeTts(spoken, mode);
    } catch (err2) {
      console.warn(`[voice] Edge-TTS fallback (${mode}) gagal:`, String((err2 as Error)?.message ?? err2));
      return null;
    }
  }
}
