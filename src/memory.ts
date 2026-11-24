import { db } from './db.js';
import { normChatId, isBaileysChatKey, isGroupChatKey, sharedChatKeyDari } from './chat_id.js';
import { resolveTableName } from './group_db.js';
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
// OPTIMASI (05 Okt 2026): 25s -> 60s. Diukur: satu query DB ke Supabase butuh
// 244-800ms (jaringan), dan getContext memakai 3 query paralel. Dalam obrolan
// aktif (balas dalam <1 menit), TTL 60 detik membuat pesan kedua dan seterusnya
// HAMPIR TANPA query DB -> menghemat ~600-1000ms per balasan.
//
// KEAMANAN DATA: cache ini HANYA mempercepat BACA riwayat percakapan. Setiap
// penulisan (saveMessage) tetap langsung ke database, dan cache diperbarui
// segera lewat updateContextCache() setelah pesan diproses. Jadi tidak ada
// risiko "kehilangan" pesan — hanya menghindari baca berulang yang sama.
const CONTEXT_TTL_MS = 60000; // 60 detik (jendela percakapan cepat aktif)

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

/** Uji apakah chatKey berasal dari test/fixture agar tidak mencemari DB produksi. */
export function adalahTestChatId(chatKey: string): boolean {
  const id = String(chatKey ?? '').trim();
  return /^__.*__$/.test(id) || /^(?:test_|tz_)/i.test(id);
}

/** Hapus cache konteks untuk chatKey dan pasangan Baileys/shared-nya bila ada perubahan profil/fakta/ringkasan. */
export function invalidateContextCache(chatKey: string): void {
  const key = normChatId(chatKey);
  if (!key) return;
  contextCache.delete(key);
  if (isGroupChatKey(key)) return;
  if (isBaileysChatKey(key)) {
    const shared = sharedChatKeyDari(key);
    if (shared) contextCache.delete(shared);
  } else if (key.startsWith('wa_')) {
    const num = key.slice(3);
    if (num) contextCache.delete(`wa_baileys_${num}`);
  }
}

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
  chatKey = normChatId(chatKey);   // konsistensi chat_id (satu sumber)
  if (!content || !content.trim()) return; // jangan simpan balasan kosong (zero teks statis)
  sweepContextCache(Date.now());
  const cached = contextCache.get(chatKey);
  if (cached && Date.now() - cached.at < CONTEXT_TTL_MS) {
    cached.data.history.push({ role, content });
    if (cached.data.history.length > 40) cached.data.history.shift();
    cached.at = Date.now();
  }
}

/** Periksa apakah pesan pengguna adalah perintah reset sesi. */
export function isResetCommand(text: string): boolean {
  const norm = text.trim().toLowerCase();
  // Slash command (paling pasti).
  if (
    norm === '/reset' ||
    norm === '/clear' ||
    norm === '/reset_session' ||
    norm === '/resetsesi' ||
    norm === '/clearchat'
  ) {
    return true;
  }

  // ── BAHASA ALAMI (temuan nyata 08 Okt 2026) ──
  // LAPORAN: "Bores reset semua percakapan kita. Mulai dari awal" -> bot menjawab
  // "chat nggak bisa di-reset dari sini" (SALAH! seharusnya reset).
  //
  // AKAR: fungsi ini HANYA menerima slash command, padahal user menulis dengan
  // bahasa alami + nama bot di depan ("Bores reset ...").
  //
  // ATURAN: kenali permintaan reset yang JELAS (reset/hapus riwayat/percakapan/
  // mulai dari nol/awal). Ketat agar obrolan biasa tidak memicu reset.
  const mintaReset =
    /\b(?:reset|hapus|bersihkan|clear|delete)\b[^.!?\n]{0,30}\b(?:semua\s+)?(?:percakapan|chat|riwayat|obrolan|memori|ingatan|history|konteks|sesi)\b/i.test(norm) ||
    /\b(?:mulai|start)\b[^.!?\n]{0,15}\b(?:dari\s+)?(?:awal|nol|0|baru)\b/i.test(norm) ||
    /\b(?:lupakan|hapus)\b[^.!?\n]{0,20}\b(?:semua|segalanya)\b[^.!?\n]{0,20}\b(?:tentang|soal|percakapan|chat)\b/i.test(norm);
  return mintaReset;
}


/** Reset sesi percakapan aktif: menyematkan checkpoint pemotong riwayat, menghapus ringkasan lama & membersihkan cache.
 * Tidak mengembalikan teks konfirmasi statis — balasan dibuat dinamis oleh pemanggil via autoReply. */
export async function resetSession(chatKey: string, platform: string = 'whatsapp'): Promise<void> {
  chatKey = normChatId(chatKey);   // konsistensi chat_id (satu sumber)
  invalidateContextCache(chatKey);
  counters.delete(chatKey);
  lastSummaryCheckAt.delete(chatKey);
  // Chat fixture test (mis. __verify_v32__) tidak boleh menulis checkpoint ke DB production.
  if (adalahTestChatId(chatKey)) return;
  const c = db();
  if (!c) return;

  try {
    const [msgTbl, sumTbl, corTbl] = await Promise.all([
      resolveTableName('messages', chatKey),
      resolveTableName('summaries', chatKey),
      resolveTableName('corrections', chatKey),
    ]);
    await Promise.all([
      (msgTbl === 'group_messages' ? c.from('group_messages') : c.from('messages')).insert({
        platform,
        chat_id: chatKey,
        role: 'user',
        content: '[SESSION_RESET]',
        via: 'system/reset',
      }),
      (sumTbl === 'group_summaries' ? c.from('group_summaries') : c.from('summaries')).delete().eq('chat_id', chatKey),
      (corTbl === 'group_corrections' ? c.from('group_corrections') : c.from('corrections')).delete().eq('chat_id', chatKey),
    ]);
  } catch {
    // best-effort
  }
}

/** Ambil konteks chat: 24 pesan terakhir sejak checkpoint reset + ringkasan + koreksi. Tanpa DB = kosong. */
/**
 * Ambil konteks percakapan yang dibaca MODEL.
 *
 * ── ISOLASI MEMORI (penting, jangan diubah tanpa alasan) ──
 * Fungsi ini HANYA membaca 3 tabel: `messages`, `summaries`, `corrections`.
 *
 * Tabel `laporan` (keluhan dari landing page) SENGAJA TIDAK dibaca di sini.
 * Permintaan pemilik produk (08 Okt 2026): "jangan sampai bot nya jadi tercemar
 * gara gara memori keluhan itu". Laporan bisa berisi kalimat kasar/ngaco yang,
 * bila masuk konteks, akan ditiru model sebagai gaya bicara.
 *
 * JANGAN menambahkan pembacaan tabel `laporan` di fungsi ini atau di jalur
 * percakapan mana pun (src/). Akses laporan hanya lewat `api/laporan.ts`.
 */
/**
 * Saring noise sistem dari riwayat percakapan (input: urutan terbaru-dulu / descending).
 * Membuang placeholder `[baileys-msg]` serta membatasi ringkasan/pengingat berulang agar
 * tidak membanjiri jendela konteks model.
 */
export function saringNoiseRiwayat<T extends { role: string; content: string; via?: string | null }>(rowsDesc: T[]): T[] {
  const out: T[] = [];
  let keptReminder = 0;
  let keptRingkasan = 0;
  for (let i = 0; i < rowsDesc.length; i++) {
    const r = rowsDesc[i];
    const konten = String(r.content ?? '').trim();
    const via = String(r.via ?? '');
    if (!konten || konten === '[baileys-msg]' || konten.includes('[SESSION_RESET]')) continue;
    if (via === 'reminder') {
      if (i < 4 && keptReminder < 1) {
        keptReminder++;
        out.push(r);
      }
      continue;
    }
    if (via === 'notes/ringkasan') {
      if (i < 4 && keptRingkasan < 1) {
        keptRingkasan++;
        out.push(r);
      }
      continue;
    }
    if (r.role === 'user' && /^\/?ringkasan\b/i.test(konten) && i >= 4) continue;
    out.push(r);
  }
  return out;
}

export async function getContext(chatKey: string, msgSentAt?: Date): Promise<ChatContext> {
  // NORMALISASI chat_id (satu sumber): agar data lama yang tersimpan TANPA prefix
  // (mis. "628991333323") tetap terbaca walau percakapan memakai "wa_628991333323".
  chatKey = normChatId(chatKey);
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
    const [msgTbl, sumTbl, corTbl] = await Promise.all([
      resolveTableName('messages', chatKey),
      resolveTableName('summaries', chatKey),
      resolveTableName('corrections', chatKey),
    ]);
    const [h, s, k, resetRes] = await Promise.all([
      (msgTbl === 'group_messages' ? c.from('group_messages') : c.from('messages')).select('role,content,feedback,via,created_at').eq('chat_id', chatKey)
        .or('via.is.null,via.not.like.system/%')
        .order('created_at', { ascending: false }).limit(40),
      (sumTbl === 'group_summaries' ? c.from('group_summaries') : c.from('summaries')).select('summary').eq('chat_id', chatKey).limit(1).maybeSingle(),
      (corTbl === 'group_corrections' ? c.from('group_corrections') : c.from('corrections')).select('correction').eq('chat_id', chatKey).order('created_at', { ascending: false }).limit(15),
      (msgTbl === 'group_messages' ? c.from('group_messages') : c.from('messages'))
        .select('created_at')
        .eq('chat_id', chatKey)
        .eq('via', 'system/reset')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    if (h.error) warnOnce('messages', h.error.message);
    if (s.error && s.error.code !== 'PGRST116') warnOnce('summaries', s.error.message);
    if (k.error) warnOnce('corrections', k.error.message);

    const resetRow = resetRes?.data && !Array.isArray(resetRes.data)
      ? (resetRes.data as { created_at?: string | null })
      : null;
    const resetMs = resetRow?.created_at ? Date.parse(resetRow.created_at) : 0;

    const rawMessages = (h.data ?? []) as Array<{
      role: string;
      content: string;
      feedback?: string | null;
      via?: string | null;
      created_at?: string | null;
    }>;
    // Cari index checkpoint reset (karena diurutkan descending, index terkecil adalah reset terbaru)
    // Sekaligus hormati timestamp row `via = 'system/reset'` karena filter `via.not.like.system/%`
    // di query utama sengaja menyembunyikan baris sistem.
    const resetIdx = rawMessages.findIndex(
      (m) => m.content === '[SESSION_RESET]' || m.content.startsWith('[SESSION_RESET]'),
    );
    const slicedMessages = resetIdx >= 0 ? rawMessages.slice(0, resetIdx) : rawMessages;
    const validMessages = resetMs > 0
      ? slicedMessages.filter((m) => {
          if (!m.created_at) return true;
          const rowMs = Date.parse(m.created_at);
          return !Number.isFinite(rowMs) || rowMs > resetMs;
        })
      : slicedMessages;
    const filteredMessages = saringNoiseRiwayat(validMessages);

    // Sinyal stiker durable: kolom `feedback` menyimpan "sticker:<emoji>" pada baris
    // balasan yang disertai stiker. Disintesis jadi penanda riwayat agar cooldown
    // anti-overuse tetap terlihat lintas instance serverless (tanpa polusi tabel).
    const withStickerMarkers = filteredMessages.map((m) => {
      const fb = typeof m.feedback === 'string' ? m.feedback.trim() : '';
      // Riwayat stiker lama memuat reaksi bot sebagai teks user; hanya abaikan saat membaca.
      let content = m.role === 'user' && /^\[Stiker (?:Telegram|WhatsApp)[^\]]*\] [^\[]/.test(m.content)
        ? m.content.replace(/^(\[Stiker (?:Telegram|WhatsApp)[^\]]*\]).*$/s, '$1') : m.content;
      for (const part of fb.split('|')) {
        const i = part.indexOf(':');
        if (i < 0) continue;
        const key = part.slice(0, i).trim();
        const val = part.slice(i + 1).trim();
        if (!val) continue;
        if (key === 'sticker') content = `${content}\n[Stiker terkirim: ${val}]`;
        else if (key === 'riddle') content = `${content}\n[Jawaban: ${val}]`;
        else if (key === 'vn') content = `${content}\n[VN terkirim: ${val}]`;
      }
      return { role: m.role, content };
    });

    let corrections = ((k.data ?? []) as Array<{ correction: string }>).map((r) => r.correction);
    if (isBaileysChatKey(chatKey) && !isGroupChatKey(chatKey)) {
      const sharedKey = sharedChatKeyDari(chatKey);
      if (sharedKey && sharedKey !== chatKey) {
        try {
          const { data: sharedCors } = await c
            .from('corrections')
            .select('correction')
            .eq('chat_id', sharedKey)
            .order('created_at', { ascending: false })
            .limit(15);
          const sharedList = ((sharedCors ?? []) as Array<{ correction: string }>)
            .map((r) => r.correction)
            .filter((x) => /^(?:\[FAKTA\]|\[ZONA_WAKTU\]|Lokasi)/i.test(x));
          const merged = new Set([...corrections, ...sharedList]);
          corrections = [...merged].slice(0, 20);
        } catch {
          // best-effort: gagal baca profil bersama tidak memblokir obrolan
        }
      }
    }

    const ctx: ChatContext = {
      history: withStickerMarkers
        .filter((m) => (m.role === 'user' || m.role === 'assistant') && !m.content.includes('[SESSION_RESET]'))
        .reverse()
        .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      summary: (s.data as { summary?: string } | null)?.summary ?? null,
      corrections,
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
const lastSummaryCheckAt = new Map<string, number>();
const SUMMARY_CHECK_THROTTLE_MS = 30_000;

/**
 * Dipanggil tiap pertukaran user. Distilasi memori & profil personal teman bicara
 * berbasis jumlah pesan di DB (berjalan stabil di Serverless maupun VPS).
 */
export function noteExchange(chatKey: string): void {
  chatKey = normChatId(chatKey);   // konsistensi chat_id (satu sumber)
  if (!chatKey || adalahTestChatId(chatKey)) return;
  const now = Date.now();
  const lastCheck = lastSummaryCheckAt.get(chatKey) ?? 0;
  if (now - lastCheck < SUMMARY_CHECK_THROTTLE_MS) return;
  lastSummaryCheckAt.set(chatKey, now);
  if (lastSummaryCheckAt.size > CONTEXT_CACHE_MAX) {
    for (const [k, t] of lastSummaryCheckAt.entries()) {
      if (now - t >= SUMMARY_CHECK_THROTTLE_MS) lastSummaryCheckAt.delete(k);
    }
  }
  const n = (counters.get(chatKey) ?? 0) + 1;
  counters.set(chatKey, n);
  // Throttle per-chat 30 detik di atas menggantikan gate in-memory lama `n % 6 !== 0` agar Serverless tetap cek ke DB.
  void (async () => {
    const c = db();
    if (!c) return;
    try {
      const [msgTbl, sumTbl] = await Promise.all([
        resolveTableName('messages', chatKey),
        resolveTableName('summaries', chatKey),
      ]);
      const [{ count }, { data: ringkasanLama }] = await Promise.all([
        (msgTbl === 'group_messages' ? c.from('group_messages') : c.from('messages')).select('id', { count: 'exact', head: true }).eq('chat_id', chatKey),
        (sumTbl === 'group_summaries'
          ? c.from('group_summaries').select('summary')
          : c.from('summaries').select('summary')
        )
          .eq('chat_id', chatKey)
          .maybeSingle(),
      ]);
      const lama = String((ringkasanLama as { summary?: string } | null)?.summary ?? '').trim();
      if (!count || count < 8) return;
      if (lama && count % 6 !== 0) return;

      const h = await (msgTbl === 'group_messages' ? c.from('group_messages') : c.from('messages'))
        .select('role,content,via')
        .eq('chat_id', chatKey)
        .order('created_at', { ascending: false })
        .limit(60);
      if (h.error || !h.data?.length) return;
      const rawMessages = h.data as Array<{ role: string; content: string; via?: string | null }>;
      // Hormati checkpoint reset: potong pesan sebelum [SESSION_RESET]
      const resetIdx = rawMessages.findIndex(
        (m) => m.content === '[SESSION_RESET]' || m.content.startsWith('[SESSION_RESET]'),
      );
      const validMessages = resetIdx >= 0 ? rawMessages.slice(0, resetIdx) : rawMessages;
      const filteredMessages = saringNoiseRiwayat(validMessages);
      // Jangan membuat ringkasan jika data baru pasca-reset masih di bawah 4 pesan
      if (filteredMessages.length < 4) return;

      const text = filteredMessages
        .filter((m) => (m.role === 'user' || m.role === 'assistant') && !m.content.includes('[SESSION_RESET]'))
        .reverse()
        .map((m) => `${m.role === 'user' ? 'USER (teman bicaramu)' : 'BOT (kamu / FreeAIBot)'}: ${m.content.slice(0, 300)}`)
        .join('\n');

      const bagianLama = lama
        ? `CATATAN LAMA (ingatan jangka panjang yang HARUS dipertahankan):\n${lama.slice(0, 3000)}\n\n`
        : '';
      const { text: rawSummary } = await chat([
        {
          role: 'user',
          content:
            `${bagianLama}RIWAYAT TERKINI (perkembangan obrolan terbaru):\n${text.slice(0, 8000)}\n\n` +
            'TUGAS: perbarui catatan memori personal tentang USER (teman bicaramu) dalam 4-8 butir ringkas Bahasa Indonesia.\n' +
            'ATURAN PENTING:\n' +
            '1. GABUNGKAN catatan lama dengan informasi baru — JANGAN membuang fakta lama yang masih relevan.\n' +
            '2. Bila ada informasi baru yang bertentangan dengan lama, PAKAI yang baru (mis. dia pindah kerja).\n' +
            '3. Butir yang dicakup:\n' +
            '- Nama/panggilan\n' +
            '- Pekerjaan/status/kegiatan\n' +
            '- Kesukaan & hal yang TIDAK dia sukai (makanan, hobi, musik, dll)\n' +
            '- Kebiasaan & rutinitas harian\n' +
            '- Gaya komunikasi & preferensi (formal/santai, suka bercanda, dll)\n' +
            '- Topik/cerita/minat yang pernah dibahas (agar kamu ingat & nyambung)\n' +
            '- Hal penting yang perlu kamu ingat\n' +
            '4. HANYA catat yang BENAR-BENAR diucapkan USER — DILARANG menebak atau menambah fakta yang tidak ada.\n' +
            '5. DILARANG KERAS mencatat identitas BOT (FreeAIBot, Asisten AI, atau Rafly Firmansyah sebagai pembuat bot) sebagai nama atau pekerjaan teman bicaramu. Catat HANYA fakta yang diucapkan oleh USER tentang dirinya sendiri.\n' +
            '6. Maksimal 1500 karakter total agar hemat konteks.\n' +
            'Balas HANYA butir-butir catatan tersebut.',
        },
      ]);
      const summary = rawSummary
        .split('\n')
        .filter((line) => {
          const l = line.trim();
          if (!l) return false;
          if (/nama\/panggilan[^:\n]*:\s*[^\n]*(?:freeaibot|asisten\s*ai)/i.test(l)) return false;
          if (/pekerjaan\/status\/kegiatan[^:\n]*:\s*[^\n]*asisten\s*ai\b/i.test(l)) return false;
          return true;
        })
        .join('\n')
        .trim();
      if (!summary || summary.length < 10) return;
      await (sumTbl === 'group_summaries' ? c.from('group_summaries') : c.from('summaries'))
        .upsert(
          { chat_id: chatKey, summary, updated_at: new Date().toISOString() },
          { onConflict: 'chat_id' },
        );
      invalidateContextCache(chatKey);
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
  chatKey = normChatId(chatKey);   // konsistensi chat_id (satu sumber)
  if (!chatKey || adalahTestChatId(chatKey)) return false;
  const c = db();
  if (!c) return false;
  try {
    const corTbl = await resolveTableName('corrections', chatKey);
    const { error } = await (corTbl === 'group_corrections' ? c.from('group_corrections') : c.from('corrections'))
      .insert({ chat_id: chatKey, correction: correction.slice(0, 1000) });
    if (error) {
      warnOnce(corTbl, error.message);
      return false;
    }
    invalidateContextCache(chatKey);
    return true;
  } catch {
    return false;
  }
}

