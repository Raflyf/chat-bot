import { db } from './db.js';
import { chat, type ChatMsg } from './providers.js';

export interface ChatContext {
  history: ChatMsg[];
  summary: string | null;
  corrections: string[];
  chatId?: string;
  msgSentAt?: Date;
}

const warned = new Set<string>();

function warnOnce(table: string, msg: string): void {
  if (warned.has(table)) return;
  warned.add(table);
  console.error(`[memory] tabel ${table} belum ada: ${msg}. Jalankan sql/migrate_v08.sql.`);
}

interface CachedContext {
  at: number;
  data: ChatContext;
}

const contextCache = new Map<string, CachedContext>();
const CONTEXT_TTL_MS = 25000; // 25 detik (jendela percakapan cepat aktif)

/**
 * Lock per-chat: serialisasi pemrosesan pesan dalam satu chat agar balasan tidak
 * keluar urutan / saling menimpa konteks (audit F3.1). Antrean in-process; pada
 * serverless tiap instance punya antreannya sendiri (cukup untuk retry webhook
 * dan pesan beruntun yang biasanya mendarat di instance yang sama).
 */
const chatLocks = new Map<string, Promise<unknown>>();

export async function withChatLock<T>(chatKey: string, fn: () => Promise<T>): Promise<T> {
  const prev = chatLocks.get(chatKey) ?? Promise.resolve();
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => { release = r; });
  const tail = prev.then(() => gate, () => gate);
  chatLocks.set(chatKey, tail);
  try {
    await prev.catch(() => undefined);
    return await fn();
  } finally {
    release();
    if (chatLocks.get(chatKey) === tail) chatLocks.delete(chatKey);
  }
}
const CONTEXT_CACHE_MAX = 500;

/** Sweep entri kedaluwarsa saat cache membesar (cegah leak di instance long-running). */
function sweepContextCache(now: number): void {
  if (contextCache.size < CONTEXT_CACHE_MAX) return;
  for (const [k, v] of contextCache.entries()) {
    if (now - v.at >= CONTEXT_TTL_MS) contextCache.delete(k);
  }
  // Bila masih penuh setelah sweep, buang entri tertua (Map mempertahankan urutan insert).
  if (contextCache.size >= CONTEXT_CACHE_MAX) {
    const overflow = contextCache.size - CONTEXT_CACHE_MAX + 1;
    let i = 0;
    for (const k of contextCache.keys()) {
      contextCache.delete(k);
      if (++i >= overflow) break;
    }
  }
}

export function updateContextCache(chatKey: string, role: 'user' | 'assistant', content: string): void {
  if (!content || !content.trim()) return; // jangan simpan balasan kosong (zero teks statis)
  sweepContextCache(Date.now());
  const cached = contextCache.get(chatKey);
  if (cached && Date.now() - cached.at < CONTEXT_TTL_MS) {
    cached.data.history.push({ role, content });
    if (cached.data.history.length > 15) cached.data.history.shift();
    cached.at = Date.now();
  }
}

/** Periksa apakah pesan pengguna adalah perintah reset sesi (wajib awalan slash untuk menghindari false positive). */
export function isResetCommand(text: string): boolean {
  const norm = text.trim().toLowerCase();
  return (
    norm === '/reset' ||
    norm === '/clear' ||
    norm === '/reset_session' ||
    norm === '/resetsesi' ||
    norm === '/clearchat'
  );
}

/** Reset sesi percakapan aktif: menyematkan checkpoint pemotong riwayat, menghapus ringkasan lama & membersihkan cache.
 * Tidak mengembalikan teks konfirmasi statis — balasan dibuat dinamis oleh pemanggil via autoReply. */
export async function resetSession(chatKey: string, platform: string = 'whatsapp'): Promise<void> {
  contextCache.delete(chatKey);
  counters.delete(chatKey);
  // Chat fixture test (mis. __verify_v32__) tidak boleh menulis checkpoint ke DB production.
  if (/^__.*__$/.test(chatKey) || chatKey.startsWith('test_')) return;
  const c = db();
  if (c) {
    try {
      await Promise.all([
        c.from('messages').insert({
          platform,
          chat_id: chatKey,
          role: 'user',
          content: '[SESSION_RESET]',
          via: 'system/reset',
        }),
        c.from('summaries').delete().eq('chat_id', chatKey),
      ]);
    } catch {
      // best-effort
    }
  }
}

/** Ambil konteks chat: 24 pesan terakhir sejak checkpoint reset + ringkasan + koreksi. Tanpa DB = kosong. */
export async function getContext(chatKey: string, msgSentAt?: Date): Promise<ChatContext> {
  const empty: ChatContext = { history: [], summary: null, corrections: [], chatId: chatKey, msgSentAt };

  // Fast-path in-memory cache: respon instan 0ms saat user sedang aktif chatting
  sweepContextCache(Date.now());
  const cached = contextCache.get(chatKey);
  if (cached && Date.now() - cached.at < CONTEXT_TTL_MS) {
    return {
      history: [...cached.data.history],
      summary: cached.data.summary,
      corrections: [...cached.data.corrections],
      chatId: chatKey,
      msgSentAt,
    };
  }

  const c = db();
  if (!c) return empty;
  try {
    const [h, s, k] = await Promise.all([
      c.from('messages').select('role,content,feedback').eq('chat_id', chatKey).order('created_at', { ascending: false }).limit(15),
      c.from('summaries').select('summary').eq('chat_id', chatKey).limit(1).maybeSingle(),
      c.from('corrections').select('correction').eq('chat_id', chatKey).order('created_at', { ascending: false }).limit(5),
    ]);
    if (h.error) warnOnce('messages', h.error.message);
    if (s.error && s.error.code !== 'PGRST116') warnOnce('summaries', s.error.message);
    if (k.error) warnOnce('corrections', k.error.message);

    const rawMessages = (h.data ?? []) as Array<{ role: string; content: string; feedback?: string | null }>;
    // Cari index checkpoint reset (karena diurutkan descending, index terkecil adalah reset terbaru)
    const resetIdx = rawMessages.findIndex(
      (m) => m.content === '[SESSION_RESET]' || m.content.startsWith('[SESSION_RESET]'),
    );
    const validMessages = resetIdx >= 0 ? rawMessages.slice(0, resetIdx) : rawMessages;

    // Sinyal stiker durable: kolom `feedback` menyimpan "sticker:<emoji>" pada baris
    // balasan yang disertai stiker. Disintesis jadi penanda riwayat agar cooldown
    // anti-overuse tetap terlihat lintas instance serverless (tanpa polusi tabel).
    const withStickerMarkers = validMessages.map((m) => {
      const fb = typeof m.feedback === 'string' ? m.feedback.trim() : '';
      let content = m.content;
      for (const part of fb.split('|')) {
        const i = part.indexOf(':');
        if (i < 0) continue;
        const key = part.slice(0, i).trim();
        const val = part.slice(i + 1).trim();
        if (!val) continue;
        if (key === 'sticker') content = `${content}\n[Stiker terkirim: ${val}]`;
        else if (key === 'riddle') content = `${content}\n[Jawaban: ${val}]`;
      }
      return { role: m.role, content };
    });

    const ctx: ChatContext = {
      history: withStickerMarkers
        .filter((m) => (m.role === 'user' || m.role === 'assistant') && !m.content.includes('[SESSION_RESET]'))
        .reverse()
        .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      summary: (s.data as { summary?: string } | null)?.summary ?? null,
      corrections: ((k.data ?? []) as Array<{ correction: string }>).map((r) => r.correction),
      chatId: chatKey,
      msgSentAt,
    };

    contextCache.set(chatKey, { at: Date.now(), data: ctx });
    // Kembalikan SALINAN: dua request paralel untuk chat yang sama tidak boleh berbagi
    // objek yang sama (mutasi corrections di skills.ts bisa bocor antar-request — audit M12).
    return {
      history: [...ctx.history],
      summary: ctx.summary,
      corrections: [...ctx.corrections],
      chatId: ctx.chatId,
      msgSentAt: ctx.msgSentAt,
    };
  } catch {
    return empty;
  }
}

const counters = new Map<string, number>();

/** Dipanggil tiap pertukaran user. Tiap 8 pesan: distilasi memori & profil personal teman bicara secara adaptif (fire-and-forget). */
export function noteExchange(chatKey: string): void {
  const n = (counters.get(chatKey) ?? 0) + 1;
  counters.set(chatKey, n);
  if (n % 8 !== 0) return;
  void (async () => {
    const c = db();
    if (!c) return;
    try {
      const h = await c
        .from('messages')
        .select('role,content')
        .eq('chat_id', chatKey)
        .order('created_at', { ascending: false })
        .limit(25);
      if (h.error || !h.data?.length) return;
      const rawMessages = h.data as Array<{ role: string; content: string }>;
      // Hormati checkpoint reset: potong pesan sebelum [SESSION_RESET]
      const resetIdx = rawMessages.findIndex(
        (m) => m.content === '[SESSION_RESET]' || m.content.startsWith('[SESSION_RESET]'),
      );
      const validMessages = resetIdx >= 0 ? rawMessages.slice(0, resetIdx) : rawMessages;
      // Jangan membuat ringkasan jika data baru pasca-reset masih di bawah 4 pesan
      if (validMessages.length < 4) return;

      const text = validMessages
        .filter((m) => (m.role === 'user' || m.role === 'assistant') && !m.content.includes('[SESSION_RESET]'))
        .reverse()
        .map((m) => `${m.role}: ${m.content.slice(0, 300)}`)
        .join('\n');
      const { text: summary } = await chat([
        {
          role: 'user',
          content: `Analisis riwayat obrolan ini dan buat catatan memori personal tentang teman bicaramu dalam 3-5 butir ringkas Bahasa Indonesia:\n- Nama/panggilan (jika ada)\n- Gaya komunikasi & preferensi\n- Topik, cerita, atau minat utama yang sedang dibahas\n- Hal penting yang perlu kamu ingat agar obrolan berikutnya semakin nyambung, akrab, dan mengerti dia.\nBalas HANYA butir-butir catatan tersebut:\n${text.slice(0, 4000)}`,
        },
      ]);
      await c
        .from('summaries')
        .upsert(
          { chat_id: chatKey, summary, updated_at: new Date().toISOString() },
          { onConflict: 'chat_id' },
        );
    } catch (e) {
      console.error(`[memory] ringkas: ${String((e as Error).message ?? e)}`);
    }
  })();
}

export interface CorrectionValidationResult {
  valid: boolean;
  cleaned: string;
  reason?: string;
}

/**
 * Validasi dan sanitasi koreksi pengguna untuk mencegah:
 * 1. Manipulasi identitas developer / klaim kepemilikan sistem.
 * 2. Prompt injection / jailbreak sistem.
 * 3. Memory poisoning terhadap fakta universal, sains, dan matematika (mencegah bot dibuat bodoh).
 */
export function validateCorrection(raw: string): CorrectionValidationResult {
  const cleaned = raw.trim().replace(/[\r\n\t]+/g, ' ').slice(0, 500);
  if (!cleaned) {
    return { valid: false, cleaned: '', reason: 'Catatan koreksi tidak boleh kosong.' };
  }

  // 1. Blokir upaya peretasan identitas developer, klaim kepemilikan, atau otoritas sistem
  const isIdentityHijack =
    /\b(?:identitas\s+resmi|terverifikasi|developer\s+dan\s+pencipta|pembuat\s+kamu|developer\s+kamu|bukan\s+rafly|ganti\s+developer|owner\s+bot|admin\s+bot|pencipta\s+bot|kamu\s+dibuat\s+oleh)\b/i.test(cleaned) ||
    (/\b(?:developer|pencipta|pembuat|creator|author)\b/i.test(cleaned) && /\b(?:bukan|adalah|ganti|budi|andi|joko|saya|aku|dia)\b/i.test(cleaned));

  if (isIdentityHijack) {
    return {
      valid: false,
      cleaned,
      reason: 'Perintah /salah hanya digunakan untuk preferensi personal Anda (seperti nama panggilan atau domisili), bukan untuk mengubah identitas developer atau otoritas bot.',
    };
  }

  // 2. Blokir upaya Prompt Injection, Jailbreak, atau pembatalan instruksi sistem
  const isPromptInjection =
    /\b(?:ignore|abaikan|lupakan)\s+(?:all\s+|semua\s+)?(?:previous\s+)?(?:instructions?|instruksi|perintah|aturan|prompt)\b/i.test(cleaned) ||
    /\b(?:system\s+prompt|jailbreak|kamu\s+sekarang\s+adalah|kamu\s+wajib\s+mematuhi\s+perintah\s+ini|aturan\s+sistem)\b/i.test(cleaned);

  if (isPromptInjection) {
    return {
      valid: false,
      cleaned,
      reason: 'Catatan ditolak karena terdeteksi mencoba mengubah aturan sistem dasar bot.',
    };
  }

  // 3. Blokir upaya peracunan fakta matematika baku atau sains (anti-poisoning pembodohan bot)
  const isMathOrFactPoisoning =
    /\b\d+\s*[\+\-\*\/xX÷:]\s*\d+\s*(?:=|adalah|itu|hasilnya|sama\s*dengan)\s*\d+\b/i.test(cleaned) ||
    /\b(?:bumi\s+itu\s+datar|matahari\s+terbit\s+dari\s+barat|1\s*\+\s*1\s*(?:=|adalah|itu)?\s*3)\b/i.test(cleaned);

  if (isMathOrFactPoisoning) {
    return {
      valid: false,
      cleaned,
      reason: 'Perintah /salah hanya untuk preferensi profil pribadi Anda, bukan untuk mengubah perhitungan matematika atau kebenaran sains baku.',
    };
  }

  return { valid: true, cleaned };
}

/** Simpan koreksi user agar diingat di percakapan berikutnya. */
export async function saveCorrection(chatKey: string, correction: string): Promise<boolean> {
  const c = db();
  if (!c) return false;
  try {
    const { error } = await c.from('corrections').insert({ chat_id: chatKey, correction: correction.slice(0, 1000) });
    if (error) {
      warnOnce('corrections', error.message);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

