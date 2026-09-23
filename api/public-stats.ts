import type { VercelRequest, VercelResponse } from '@vercel/node';
import { config } from '../src/env.js';
import { db } from '../src/db.js';

/**
 * Statistik publik untuk landing page.
 *
 * Kenapa endpoint ini ada: halaman depan sebelumnya menampilkan klaim tanpa angka
 * ("enam penyedia cadangan"). Angka yang benar-benar bisa diverifikasi lebih jujur,
 * dan aturan anti-slop (R-17/R-38) melarang angka karangan. Jadi angkanya diambil
 * dari basis data yang sama dengan konsol, bukan ditulis manual di HTML.
 *
 * Yang TIDAK pernah dikembalikan: kunci API, nama akun penyedia, isi percakapan,
 * atau apa pun yang bisa dipakai untuk masuk. Hanya hitungan agregat.
 *
 * Bila basis data tidak terhubung, jawabannya `ok: false` dan halaman menampilkan
 * tanda pisah, bukan angka palsu.
 */

// Hitungan di-cache singkat agar landing page yang dibuka berulang tidak
// membebani basis data. 60 detik cukup: angka ini tidak berubah tiap detik.
const CACHE_TTL_MS = 60_000;
let cached: { at: number; payload: PublicStats } | null = null;

interface PublicStats {
  totalMessages: number;
  totalChats: number;
  activeModels: number;
  providerKeys: number;
  providers: number;
  sinceDate: string | null;
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, error: 'Method Not Allowed' });
    return;
  }

  // Statistik publik boleh di-cache di CDN sebentar: isinya bukan data pribadi.
  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');

  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    res.status(200).json({ ok: true, ...cached.payload });
    return;
  }

  const c = db();

  // Jumlah kunci dan penyedia dihitung dari konfigurasi lingkungan yang sudah ada
  // di memori server, bukan dari basis data. Tidak ada nilai kunci yang dikirim.
  const pools = config.pools;
  const providerKeys =
    pools.xkiro.length +
    pools.openrouter.length +
    pools.groq.length +
    pools.cloudflare.length +
    pools.gemini.length +
    pools.dahl.length;
  const providers = Object.values(pools).filter((list) => list.length > 0).length;

  if (!c) {
    res.status(200).json({
      ok: false,
      reason: 'database_unavailable',
      totalMessages: null,
      totalChats: null,
      activeModels: null,
      providerKeys,
      providers,
      sinceDate: null,
    });
    return;
  }

  try {
    // Tiga hitungan paralel. `head: true` hanya mengambil jumlah, bukan barisnya.
    const [totalRes, firstRes] = await Promise.all([
      c.from('messages').select('*', { count: 'exact', head: true }),
      c
        .from('messages')
        .select('created_at')
        .order('created_at', { ascending: true })
        .limit(1),
    ]);

    // Percakapan unik: kolom chat_id dipakai berulang per pengguna. Ambil sampel
    // dengan paginasi agar tidak terpotong batas bawaan Supabase.
    const chatIds = new Set<string>();
    let from = 0;
    const batch = 1000;
    const maxRows = 20000;
    while (from < maxRows) {
      const { data, error } = await c
        .from('messages')
        .select('chat_id')
        .range(from, from + batch - 1);
      if (error || !data || data.length === 0) break;
      for (const row of data as Array<{ chat_id: string | null }>) {
        if (row.chat_id) chatIds.add(row.chat_id);
      }
      if (data.length < batch) break;
      from += batch;
    }

    // Model aktif: kolom `via` menyimpan "provider/model#t=..." pada balasan bot.
    const { data: viaRows } = await c
      .from('messages')
      .select('via')
      .eq('role', 'assistant')
      .not('via', 'is', null)
      .order('id', { ascending: false })
      .limit(1000);

    const models = new Set<string>();
    for (const row of (viaRows as Array<{ via: string | null }>) || []) {
      const raw = row.via || '';
      const model = raw.split('#')[0].trim();
      if (model && model !== 'cache' && model !== 'unknown') models.add(model);
    }

    const sinceRaw = (firstRes?.data as Array<{ created_at: string }> | null)?.[0]?.created_at ?? null;

    const payload: PublicStats = {
      totalMessages: totalRes.count ?? 0,
      totalChats: chatIds.size,
      activeModels: models.size,
      providerKeys,
      providers,
      sinceDate: sinceRaw ? sinceRaw.slice(0, 10) : null,
    };

    cached = { at: Date.now(), payload };
    res.status(200).json({ ok: true, ...payload });
  } catch (err) {
    console.error('[api/public-stats] gagal mengambil statistik:', err);
    // Tetap balas 200 dengan ok:false supaya halaman tidak menampilkan galat
    // ke pengunjung: cukup tampilkan tanda pisah.
    res.status(200).json({
      ok: false,
      reason: 'query_failed',
      totalMessages: null,
      totalChats: null,
      activeModels: null,
      providerKeys,
      providers,
      sinceDate: null,
    });
  }
}
