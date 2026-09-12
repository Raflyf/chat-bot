import { db } from './db.js';
import { chat, type ChatMsg } from './providers.js';

export interface ChatContext {
  history: ChatMsg[];
  summary: string | null;
  corrections: string[];
  chatId?: string;
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

export function updateContextCache(chatKey: string, role: 'user' | 'assistant', content: string): void {
  const cached = contextCache.get(chatKey);
  if (cached && Date.now() - cached.at < CONTEXT_TTL_MS) {
    cached.data.history.push({ role, content });
    if (cached.data.history.length > 10) cached.data.history.shift();
    cached.at = Date.now();
  }
}

/** Ambil konteks chat: 10 pesan terakhir + ringkasan + koreksi. Tanpa DB = kosong. */
export async function getContext(chatKey: string): Promise<ChatContext> {
  const empty: ChatContext = { history: [], summary: null, corrections: [], chatId: chatKey };

  // Fast-path in-memory cache: respon instan 0ms saat user sedang aktif chatting
  const cached = contextCache.get(chatKey);
  if (cached && Date.now() - cached.at < CONTEXT_TTL_MS) {
    return {
      history: [...cached.data.history],
      summary: cached.data.summary,
      corrections: [...cached.data.corrections],
      chatId: chatKey,
    };
  }

  const c = db();
  if (!c) return empty;
  try {
    const [h, s, k] = await Promise.all([
      c.from('messages').select('role,content').eq('chat_id', chatKey).order('created_at', { ascending: false }).limit(24),
      c.from('summaries').select('summary').eq('chat_id', chatKey).limit(1).maybeSingle(),
      c.from('corrections').select('correction').eq('chat_id', chatKey).order('created_at', { ascending: false }).limit(5),
    ]);
    if (h.error) warnOnce('messages', h.error.message);
    if (s.error && s.error.code !== 'PGRST116') warnOnce('summaries', s.error.message);
    if (k.error) warnOnce('corrections', k.error.message);

    const ctx: ChatContext = {
      history: ((h.data ?? []) as Array<{ role: string; content: string }>)
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .reverse()
        .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      summary: (s.data as { summary?: string } | null)?.summary ?? null,
      corrections: ((k.data ?? []) as Array<{ correction: string }>).map((r) => r.correction),
      chatId: chatKey,
    };

    contextCache.set(chatKey, { at: Date.now(), data: ctx });
    return ctx;
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
      const text = (h.data as Array<{ role: string; content: string }>)
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
