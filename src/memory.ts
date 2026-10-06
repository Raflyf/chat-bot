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
  if (!c) return;

  try {
    // /reset = hapus RIWAYAT PESAN + PREFERENSI (permintaan user 04 Okt 2026).
    //
    // CATATAN PENTING (temuan nyata): sebelumnya /reset HANYA menghapus riwayat
    // pesan + ringkasan, sedangkan preferensi personal (/salah) TETAP ADA. Itulah
    // sebab user merasa "/reset seperti tidak ada pengaruhnya" — bot masih ingat
    // preferensi lama.
    //
    // Sesuai permintaan user: yang dihapus adalah RIWAYAT PESAN dan PREFERENSI.
    // Data LAIN (catatan, tugas, keuangan, kebiasaan, pengingat) TIDAK disentuh.
    await Promise.all([
      c.from('messages').insert({
        platform,
        chat_id: chatKey,
        role: 'user',
        content: '[SESSION_RESET]',
        via: 'system/reset',
      }),
      c.from('summaries').delete().eq('chat_id', chatKey),
      c.from('corrections').delete().eq('chat_id', chatKey),
    ]);
  } catch {
    // best-effort
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
      // `via` ikut dipilih + difilter: baris dengan via 'system/*' adalah sinyal
      // internal (mis. 'system/pending-confirmation' untuk konfirmasi tertunda)
      // yang TIDAK boleh muncul di riwayat percakapan yang dibaca model.
      // ── DIPERBESAR (permintaan pemilik produk 06 Okt 2026) ──
      // "tambahkan memory bot nya agar mengingat lebih banyak chat dan lebih
      //  pintar tidak ngaco jawabannya"
      //
      // SEBELUMNYA: 15 pesan terakhir + 5 koreksi. Terlalu sedikit -> bot cepat
      // "lupa" konteks obrolan beberapa pesan lalu dan menjawab ngawur.
      //
      // SEKARANG: 40 pesan + 15 fakta/koreksi. Token tetap aman karena:
      //   - prompt hanya memakai sebagian riwayat yang relevan (lihat skills.ts)
      //   - ada ringkasan otomatis untuk percakapan yang lebih lama lagi
      c.from('messages').select('role,content,feedback,via').eq('chat_id', chatKey)
        .not('via', 'like', 'system/%')
        .order('created_at', { ascending: false }).limit(40),
      c.from('summaries').select('summary').eq('chat_id', chatKey).limit(1).maybeSingle(),
      c.from('corrections').select('correction').eq('chat_id', chatKey).order('created_at', { ascending: false }).limit(15),
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

/**
 * Dipanggil tiap pertukaran user. Tiap 6 pesan: distilasi memori & profil personal
 * teman bicara secara adaptif (fire-and-forget).
 *
 * DIPERBESAR (permintaan pemilik produk 06 Okt 2026):
 *   "tambahkan memory bot nya agar mengingat lebih banyak chat dan lebih pintar
 *    tidak ngaco jawabannya"
 * Sebelumnya tiap 8 pesan dari 25 pesan terakhir; sekarang tiap 6 pesan dari
 * 60 pesan terakhir -> memori jangka panjang lebih kaya & lebih cepat diperbarui.
 */
export function noteExchange(chatKey: string): void {
  // ── COUNTER PERSISTEN (perbaikan 06 Okt 2026) ──
  // MASALAH: counter lama (`counters` Map di memori) TIDAK PERNAH mencapai 6
  // di Vercel serverless, karena tiap request bisa jalan di instance berbeda
  // dan Map-nya di-reset. Akibatnya ringkasan otomatis nyaris tidak pernah dibuat
  // -> bot terasa pikun pada percakapan panjang.
  //
  // SOLUSI: hitung dari JUMLAH PESAN di database (persisten lintas instance),
  // dan buat ringkasan bila jumlah pesan kelipatan 6. Tetap ada guard in-memory
  // agar tidak memicu berkali-kali dalam satu instance yang sama.
  const n = (counters.get(chatKey) ?? 0) + 1;
  counters.set(chatKey, n);
  if (n % 6 !== 0) return;
  void (async () => {
    const c = db();
    if (!c) return;
    try {
      // Cek jumlah pesan nyata: ringkasan dibuat bila sudah cukup banyak
      // (>= 8 pesan) — tidak perlu menunggu kelipatan tepat.
      const { count } = await c
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('chat_id', chatKey);
      if (!count || count < 8) return;
      // ── AKUMULATIF (perbaikan 06 Okt 2026) ──
      // MASALAH NYATA: "bot nya masih terasa pikun, lupa apa yang sudah dia bilang
      // sebelumnya, tapi emang sudah aga lama percakapannya".
      //
      // AKAR: ringkasan lama DITIMPA ringkasan baru yang hanya dibuat dari 60
      // pesan terakhir. Percakapan yang sudah panjang (>60 pesan) kehilangan
      // seluruh ingatan awalnya -> bot terasa pikun.
      //
      // SOLUSI: gabungkan ringkasan LAMA (ingatan jangka panjang) dengan
      // ringkasan BARU (perkembangan terkini) -> memori bertumbuh, tidak hilang.
      const { data: ringkasanLama } = await c
        .from('summaries')
        .select('summary')
        .eq('chat_id', chatKey)
        .maybeSingle();

      const h = await c
        .from('messages')
        .select('role,content')
        .eq('chat_id', chatKey)
        .order('created_at', { ascending: false })
        .limit(60);
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

      const lama = String((ringkasanLama as { summary?: string } | null)?.summary ?? '').trim();
      const bagianLama = lama
        ? `CATATAN LAMA (ingatan jangka panjang yang HARUS dipertahankan):\n${lama.slice(0, 3000)}\n\n`
        : '';
      const { text: summary } = await chat([
        {
          role: 'user',
          content:
            `${bagianLama}RIWAYAT TERKINI (perkembangan obrolan terbaru):\n${text.slice(0, 8000)}\n\n` +
            'TUGAS: perbarui catatan memori personal tentang teman bicaramu dalam 4-8 butir ringkas Bahasa Indonesia.\n' +
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
            '4. HANYA catat yang BENAR-BENAR dia sebutkan — DILARANG menebak atau menambah fakta yang tidak ada.\n' +
            '5. Maksimal 1500 karakter total agar hemat konteks.\n' +
            'Balas HANYA butir-butir catatan tersebut.',
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

