import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db } from '../src/db.js';
import { config } from '../src/env.js';
import { extractSessionToken, verifySessionToken } from '../src/admin_auth.js';

function maskChatId(chatId: string): string {
  if (!chatId) return '-';
  if (chatId.length <= 6) return chatId;
  return `${chatId.slice(0, 3)}...${chatId.slice(-4)}`;
}

export interface DatasetPair {
  id: number;
  platform: string;
  chatIdMasked: string;
  /** chat_id penuh apa adanya dari DB (mis. "wa_628991333323" / "wa_1073504871"). */
  chatId: string;
  userPrompt: string;
  botReply: string;
  via: string;
  createdAt: string;
  dateStr?: string;
  timeStr?: string;
  fullLocalStr?: string;
  promptTokens: number;
  completionTokens: number;
  contextTokens: number;
  totalTokens: number;
  isRealUsage?: boolean;
}

export function formatLocalComponents(
  isoDateStr: string,
  tz: string = 'Asia/Jakarta',
): {
  dateStr: string;
  timeStr: string;
  fullLocalStr: string;
} {
  const d = new Date(isoDateStr);
  if (isNaN(d.getTime())) {
    return {
      dateStr: '-',
      timeStr: '-',
      fullLocalStr: '-',
    };
  }

  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(d);

    const year = parts.find((p) => p.type === 'year')?.value || '1970';
    const month = parts.find((p) => p.type === 'month')?.value || '01';
    const day = parts.find((p) => p.type === 'day')?.value || '01';
    const hour = parts.find((p) => p.type === 'hour')?.value || '00';
    const minute = parts.find((p) => p.type === 'minute')?.value || '00';
    const second = parts.find((p) => p.type === 'second')?.value || '00';

    const dateStr = `${year}-${month}-${day}`;
    const timeStr = `${hour}:${minute}:${second}`;
    const tzLabel =
      tz === 'Asia/Jakarta'
        ? 'WIB'
        : tz === 'Asia/Makassar'
        ? 'WITA'
        : tz === 'Asia/Jayapura'
        ? 'WIT'
        : tz;
    const fullLocalStr = `${dateStr} ${timeStr} ${tzLabel}`;

    return { dateStr, timeStr, fullLocalStr };
  } catch {
    const dateStr = d.toISOString().slice(0, 10);
    const timeStr = d.toISOString().slice(11, 19);
    return { dateStr, timeStr, fullLocalStr: `${dateStr} ${timeStr} UTC` };
  }
}

function calculateTimeBounds(
  range: string,
  dateParam?: string | null,
  tz: string = 'Asia/Jakarta',
): {
  startDateIso: string | null;
  endDateIso: string | null;
  localTodayStr: string;
  localTimeStr: string;
  fileLabel: string;
} {
  const now = new Date();
  let startDateIso: string | null = null;
  let endDateIso: string | null = null;

  let localTodayStr = 'today';
  let localTimeStr = '00-00';
  try {
    const dateParts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
    localTodayStr = dateParts;

    const timeParts = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(now);
    const h = timeParts.find((p) => p.type === 'hour')?.value || '00';
    const m = timeParts.find((p) => p.type === 'minute')?.value || '00';
    localTimeStr = `${h}-${m}`;
  } catch {
    localTodayStr = now.toISOString().slice(0, 10);
    localTimeStr = `${String(now.getUTCHours()).padStart(2, '0')}-${String(now.getUTCMinutes()).padStart(2, '0')}`;
  }

  function getTzOffset(date: Date, timeZone: string): string {
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hour: 'numeric',
        hour12: false,
        timeZoneName: 'shortOffset',
      }).formatToParts(date);
      const tzPart = parts.find((p) => p.type === 'timeZoneName')?.value || 'GMT+7';
      const m = tzPart.match(/GMT([+-]\d+)(?::(\d+))?/);
      if (m) {
        const sign = m[1][0];
        const h = Math.abs(parseInt(m[1], 10)).toString().padStart(2, '0');
        const min = (m[2] || '00').padStart(2, '0');
        return sign + h + ':' + min;
      }
    } catch {}
    return '+07:00';
  }

  const offset = getTzOffset(now, tz);

  if (dateParam) {
    const targetDate = dateParam === 'today' ? localTodayStr : dateParam.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
      startDateIso = new Date(`${targetDate}T00:00:00${offset}`).toISOString();
      endDateIso = new Date(`${targetDate}T23:59:59.999${offset}`).toISOString();
      return {
        startDateIso,
        endDateIso,
        localTodayStr,
        localTimeStr,
        fileLabel: (targetDate === localTodayStr ? `hari_ini_${targetDate}` : `tgl_${targetDate}`) + `_jam_${localTimeStr}`,
      };
    }
  }

  let fileLabel = `${range}_${localTodayStr}_jam_${localTimeStr}`;
  if (range === 'today') {
    startDateIso = new Date(`${localTodayStr}T00:00:00${offset}`).toISOString();
    fileLabel = `hari_ini_${localTodayStr}_jam_${localTimeStr}`;
  } else if (range === '7d') {
    startDateIso = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    fileLabel = `7_hari_${localTodayStr}_jam_${localTimeStr}`;
  } else if (range === '14d') {
    startDateIso = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();
    fileLabel = `14_hari_${localTodayStr}_jam_${localTimeStr}`;
  } else if (range === '30d') {
    startDateIso = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    fileLabel = `30_hari_${localTodayStr}_jam_${localTimeStr}`;
  } else {
    fileLabel = `semua_${localTodayStr}_jam_${localTimeStr}`;
  }

  return { startDateIso, endDateIso, localTodayStr, localTimeStr, fileLabel };
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  // Security headers
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  // Verifikasi Session Token Admin
  // Token hanya diterima via header Authorization/x-admin-token (tidak via query
  // string — query bocor ke log proxy, history browser, dan Referer).
  const token = extractSessionToken(req);
  const isAuthed = token ? await verifySessionToken(token) : false;
  if (!isAuthed) {
    res.status(401).json({
      error: 'Unauthorized. Akses dataset percakapan memerlukan Master PIN admin yang valid.',
      authRequired: true,
    });
    return;
  }

  const c = db();
  if (!c) {
    const format = String(req.query.format || 'json').toLowerCase();
    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="riwayat_percakapan_empty.csv"');
      res.status(200).send('ID,Tanggal,Jam,Waktu_Lokal,Platform,Chat_ID,Pertanyaan_User,Jawaban_Bot,Model_Via,Context_Tokens,Output_Tokens,Total_Tokens,Waktu_UTC\n');
      return;
    }
    if (format === 'jsonl') {
      res.setHeader('Content-Type', 'application/x-jsonlines; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="riwayat_percakapan_empty.jsonl"');
      res.status(200).send('');
      return;
    }
    res.status(200).json({
      pairs: [],
      total: 0,
      isDatabaseConnected: false,
      notice: 'Basis data Supabase belum terhubung di Vercel. Tambahkan SUPABASE_URL dan SUPABASE_SERVICE_KEY di dashboard Vercel.',
    });
    return;
  }

  const format = String(req.query.format || 'json').toLowerCase();
  const search = typeof req.query.q === 'string' ? req.query.q.toLowerCase().trim() : '';
  // Pencarian nomor WA / ID Telegram: query yang isinya cuma digit (boleh
  // berprefix "wa_"/"tg_", spasi, "+", "-") dicari langsung ke kolom chat_id
  // lewat SQL, bukan hanya menyaring 600 baris terakhir di memori.
  const searchDigits = search.replace(/^(wa_|tg_)/, '').replace(/[\s+-]/g, '');
  const isIdSearch = /^\d{6,}$/.test(searchDigits);
  const platform = typeof req.query.platform === 'string' ? req.query.platform.toLowerCase().trim() : '';
  const range = typeof req.query.range === 'string' ? req.query.range.toLowerCase().trim() : 'all';
  const dateParam = typeof req.query.date === 'string' ? req.query.date.trim() : null;
  const tzParam = typeof req.query.tz === 'string' ? req.query.tz.trim() : 'Asia/Jakarta';
  const modelFilter = typeof req.query.model === 'string' ? req.query.model.toLowerCase().trim() : '';
  const explicitLimit = req.query.limit !== undefined && req.query.limit !== ''
    ? Math.min(5000, Math.max(1, Number(req.query.limit) || 200))
    : null;
  const limit = explicitLimit ?? 200;

  const { startDateIso, endDateIso, fileLabel } = calculateTimeBounds(range, dateParam, tzParam);

  try {
    // Optimasi performa: tarik hanya kolom penting secara descending dari pesan terbaru
    const isExport = format === 'jsonl' || format === 'csv';
    const dbLimit = explicitLimit
      ? Math.min(5000, explicitLimit * 2 + 60)
      : (isExport ? 3000 : Math.min(600, limit * 2 + 60));

    let query = c
      .from('messages')
      .select('id, platform, chat_id, role, content, via, created_at')
      .order('id', { ascending: false })
      .limit(dbLimit);

    // Filter tanggal dinamis
    if (startDateIso) {
      query = query.gte('created_at', startDateIso);
    }
    if (endDateIso) {
      query = query.lte('created_at', endDateIso);
    }

    // Filter ID di sisi SQL supaya pencarian nomor/ID menjangkau SELURUH tabel,
    // bukan hanya jendela dbLimit baris terakhir.
    if (isIdSearch) {
      query = query.ilike('chat_id', `%${searchDigits}%`);
    }

    const { data: messagesRaw, error } = await query;

    if (error) {
      console.error('[api/dataset] Database query error:', error);
      res.status(500).json({ ok: false, error: 'Gagal mengambil riwayat pesan dari database.' });
      return;
    }

    // ── BUANG BARIS SISTEM DARI RIWAYAT (perbaikan 04 Okt 2026) ──
    //
    // MASALAH: riwayat dashboard menampilkan sampah internal sehingga tabel
    // terlihat "rusak" dan filter model ikut tercemar:
    //   - system/reset        -> "[SESSION_RESET]" (penanda potong riwayat)
    //   - notes/niat-note     -> "Sepertinya kamu mau mencatat: ..." (konfirmasi)
    //   - notes/konfirmasi-ya -> "✅ Pengingat disimpan ..." (balasan internal)
    //   - notes/perintah-*    -> balasan perintah internal
    //
    // Filter dilakukan DI SINI (JavaScript), bukan lewat `.or()` PostgREST:
    // sintaks `.or('via.is.null,via.not.like...')` diuji TIDAK menyaring apa pun
    // (sampah tetap 20 baris), jadi penyaringan yang dapat diandalkan adalah di
    // kode. Baris user dengan `via` NULL tetap dipertahankan (itu normal).
    const isBarisSistem = (via: unknown): boolean => {
      const v = String(via ?? '');
      // HANYA buang penanda internal 'system/*' (mis. system/reset ->
      // "[SESSION_RESET]" yang bukan percakapan).
      //
      // BUG YANG DIPERBAIKI (04 Okt 2026): sebelumnya 'notes/*' IKUT dibuang.
      // Padahal baris 'notes/*' adalah BALASAN BOT yang nyata ke user:
      //   notes/niat-note     -> "Sepertinya kamu mau mencatat: ..."
      //   notes/konfirmasi-ya -> "✅ Pengingat disimpan ..."
      //   notes/perintah-*    -> "Catat ini? ..."
      // Akibatnya kolom "BALASAN BOT" di dashboard KOSONG, model tampil "-",
      // dan Out token 0 — pasangan pertanyaan/jawaban jadi tidak lengkap.
      return v.startsWith('system/');
    };
    const messages = (messagesRaw || []).filter((m: { via?: string | null }) => !isBarisSistem(m.via));

    // Rekonstruksi pasangan prompt user dan jawaban bot
    const rawList = (messages || []).slice().reverse();
    const pairs: DatasetPair[] = [];

    // ── PERBAIKAN AUDIT 14 Okt 2026: dari O(n²) ke O(n) ──
    // BUG LAMA: untuk SETIAP pesan user, ada loop mencari jawaban bot berikutnya
    // dari awal. Pada 5.000 pesan itu ~25 juta iterasi -> endpoint lambat dan
    // berisiko kena batas waktu.
    // SEKARANG: indeks dibangun SEKALI (satu lintasan dari BELAKANG) sehingga
    // setiap pencarian menjadi O(1).
    //
    // Cara kerja: menelusuri dari belakang sambil mengingat "indeks jawaban bot
    // terdekat berikutnya" per (chat_id|platform). Begitu menemukan pesan user,
    // pasangkan dengan jawaban tercatat LALU HAPUS entri — penghapusan inilah
    // yang meniru aturan lama: rantai terputus bila ada pesan USER lain lebih dulu.
    const indeksJawaban = new Map<string, number>();
    const pasangan = new Map<number, number>(); // index pesan user -> index jawaban bot
    for (let k = rawList.length - 1; k >= 0; k--) {
      const r = rawList[k] as { chat_id?: string; platform?: string; role?: string };
      const key = `${r.chat_id}|${r.platform}`;
      if (r.role === 'assistant') {
        indeksJawaban.set(key, k);
      } else if (r.role === 'user') {
        const j = indeksJawaban.get(key);
        if (j !== undefined) pasangan.set(k, j);
        indeksJawaban.delete(key); // putus rantai (perilaku lama)
      }
    }

    for (let i = 0; i < rawList.length; i++) {
      const userMsg = rawList[i];
      if (userMsg.role === 'user') {
        const j = pasangan.get(i);
        const botMsg: any = j !== undefined ? rawList[j] : null;

        const prompt = userMsg.content || '';
        const reply = botMsg ? (botMsg.content || '') : '';
        const rawVia = botMsg?.via || '-';
        const pForm = userMsg.platform || 'whatsapp';

        // Terapkan filter model/via
        if (modelFilter && modelFilter !== 'all' && !rawVia.toLowerCase().includes(modelFilter)) {
          continue;
        }

        // Terapkan filter pencarian
        if (platform && platform !== 'all' && pForm !== platform) continue;
        if (search) {
          const matchUser = prompt.toLowerCase().includes(search);
          const matchBot = reply.toLowerCase().includes(search);
          const matchVia = rawVia.toLowerCase().includes(search);
          const chatIdRaw = String(userMsg.chat_id || '').toLowerCase();
          const matchChat =
            chatIdRaw.includes(search) ||
            (searchDigits.length >= 4 && chatIdRaw.replace(/^wa_/, '').includes(searchDigits));
          if (!matchUser && !matchBot && !matchVia && !matchChat) continue;
        }

        // Ekstraksi Token Usage Asli Upstream (Bukan Estimasi Buatan)
        // Format metadata via: "provider/model#t=prompt,completion,total"
        let via = rawVia;
        let promptTokens = 0;
        let completionTokens = 0;
        let contextTokens = 0;
        let totalTokens = 0;
        let isRealUsage = false;

        const tokenMatch = rawVia.match(/#t=(\d+),(\d+),(\d+)/);
        if (tokenMatch) {
          via = rawVia.replace(/#t=\d+,\d+,\d+/, '').trim();
          contextTokens = parseInt(tokenMatch[1], 10);
          completionTokens = parseInt(tokenMatch[2], 10);
          totalTokens = parseInt(tokenMatch[3], 10);
          promptTokens = Math.max(1, Math.ceil(prompt.length / 3.8));
          isRealUsage = true;
        } else if (botMsg && ((botMsg as { total_tokens?: number }).total_tokens || (botMsg as { prompt_tokens?: number }).prompt_tokens)) {
          contextTokens = Number((botMsg as { prompt_tokens?: number }).prompt_tokens) || 0;
          completionTokens = Number((botMsg as { completion_tokens?: number }).completion_tokens) || 0;
          totalTokens = Number((botMsg as { total_tokens?: number }).total_tokens) || 0;
          promptTokens = Math.max(1, Math.ceil(prompt.length / 3.8));
          isRealUsage = true;
        } else {
          // Data historis lama sebelum token logging aktif:
          // Hitung representasi panjang payload nyata sistem (system prompt ~18K karakter)
          promptTokens = Math.max(1, Math.ceil(prompt.length / 3.8));
          completionTokens = reply ? Math.max(1, Math.ceil(reply.length / 3.8)) : 0;
          contextTokens = 2400 + promptTokens;
          totalTokens = contextTokens + completionTokens;
          isRealUsage = false;
        }

        const tsRaw = botMsg?.created_at || userMsg.created_at;
        const timeInfo = formatLocalComponents(tsRaw, tzParam);

        pairs.push({
          id: userMsg.id,
          platform: pForm,
          chatIdMasked: maskChatId(userMsg.chat_id),
          chatId: String(userMsg.chat_id || ''),
          userPrompt: prompt,
          botReply: reply,
          via,
          createdAt: tsRaw,
          dateStr: timeInfo.dateStr,
          timeStr: timeInfo.timeStr,
          fullLocalStr: timeInfo.fullLocalStr,
          promptTokens,
          completionTokens,
          contextTokens,
          totalTokens,
          isRealUsage,
        });
      }
    }

    // Urutkan dari yang terbaru untuk tampilan evaluasi
    pairs.reverse();
    const finalPairs = explicitLimit ? pairs.slice(0, explicitLimit) : (isExport ? pairs : pairs.slice(0, limit));

    // Susun nama file ekspor yang mencerminkan filter aktif
    let exportFileLabel = fileLabel;
    if (platform && platform !== 'all') {
      exportFileLabel += `_${platform}`;
    }
    if (modelFilter && modelFilter !== 'all') {
      exportFileLabel += `_${modelFilter.replace(/[^a-z0-9_-]/gi, '')}`;
    }

    // Format 1: JSONL (satu objek JSON per baris)
    if (format === 'jsonl') {
      const systemMsg = `Nama kamu ${config.botName}. Sahabat karib sekaligus partner cerdas serbabisa.`;
      const lines = finalPairs
        .filter((p) => p.botReply && p.botReply !== '(menunggu balasan/gagal)')
        .map((p) =>
          JSON.stringify({
            messages: [
              { role: 'system', content: systemMsg },
              { role: 'user', content: p.userPrompt },
              { role: 'assistant', content: p.botReply },
            ],
            metadata: {
              id: p.id,
              platform: p.platform,
              model_via: p.via,
              timestamp_lokal: p.fullLocalStr,
              tanggal_lokal: p.dateStr,
              jam_lokal: p.timeStr,
              timestamp_utc: p.createdAt,
              context_tokens: p.contextTokens,
              output_tokens: p.completionTokens,
              total_tokens: p.totalTokens,
            },
          }),
        );

      res.setHeader('Content-Type', 'application/x-jsonlines; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="riwayat_percakapan_${exportFileLabel}.jsonl"`,
      );
      res.status(200).send(lines.join('\n'));
      return;
    }

    // Format 2: CSV (Format Evaluasi Spreadsheet / Excel dengan Tanggal & Jam Terpisah)
    if (format === 'csv') {
      // Prefix ' mencegah formula execution (CSV injection) di Excel/Sheets —
      // sel yang diawali = + - @ tab CR dieksekusi sebagai formula oleh spreadsheet.
      const sanitizeCsvCell = (value: unknown): string => {
        let s = String(value ?? '');
        if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
        return s;
      };
      const escapeCsv = (str: unknown): string => `"${sanitizeCsvCell(str).replace(/"/g, '""')}"`;
      const csvHeader = 'ID,Tanggal,Jam,Waktu_Lokal,Platform,Chat_ID,Pertanyaan_User,Jawaban_Bot,Model_Via,Context_Tokens,Output_Tokens,Total_Tokens,Waktu_UTC\n';
      const csvRows = finalPairs
        .map((p) =>
          [
            p.id,
            escapeCsv(p.dateStr),
            escapeCsv(p.timeStr),
            escapeCsv(p.fullLocalStr),
            escapeCsv(p.platform),
            escapeCsv(p.chatId),
            escapeCsv(p.userPrompt),
            escapeCsv(p.botReply),
            escapeCsv(p.via),
            p.contextTokens,
            p.completionTokens,
            p.totalTokens,
            escapeCsv(p.createdAt),
          ].join(','),
        )
        .join('\n');

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="riwayat_percakapan_${exportFileLabel}.csv"`,
      );
      res.status(200).send('\uFEFF' + csvHeader + csvRows); // BOM untuk Excel UTF-8
      return;
    }

    // Default: JSON API Response
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.status(200).json({
      ok: true,
      totalCount: pairs.length,
      returnedCount: finalPairs.length,
      pairs: finalPairs,
      dataset: finalPairs,
    });
  } catch (err) {
    console.error('[api/dataset] Gagal menyusun dataset:', err);
    res.status(500).json({ ok: false, error: 'Internal Server Error' });
  }
}
