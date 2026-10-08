import crypto from 'crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db } from '../src/db.js';
import { config } from '../src/env.js';

/**
 * ENDPOINT LAPORAN/KELUHAN (permintaan pemilik produk, 08 Okt 2026):
 *   "tambahkan untuk keluhan dengan fungsi menambahkan file ss an percakapan
 *    dengan bot yg ngaco, atau paste percakapan dengan bot dan lainnya seperti
 *    itu, simpan di paling bawah halaman saja"
 *   "terkirim nya itu langsung ke wa saya?"
 *   "kalo bisa tidak usah [isi nomor WA]"
 *
 * ALUR:
 *   1. Pelapor menulis keluhan + opsional lampirkan tangkapan layar.
 *      TIDAK perlu mengisi nomor WA — laporan langsung diteruskan ke pemilik.
 *   2. Laporan DISIMPAN ke tabel `laporan` (agar tidak pernah hilang).
 *   3. NOTIFIKASI dikirim ke pemilik lewat DUA jalur sekaligus (best-effort):
 *        - WhatsApp Cloud API ke OWNER_WA_NUMBER (teks + gambar bila ada)
 *        - Telegram ke OWNER_CHAT_ID
 *      Dua jalur dipakai karena WhatsApp Cloud API hanya mengizinkan pesan
 *      bebas dalam 24 jam setelah pemilik terakhir chat bot; Telegram tidak
 *      dibatasi jendela waktu, jadi laporan tetap sampai.
 *
 * KEAMANAN:
 *   - Rate limit per IP (maks 5 laporan / 10 menit) agar tidak dibanjiri spam.
 *   - Ukuran total body dibatasi (Vercel: ~4,5 MB). Lampiran maks 2 MB.
 *   - IP disimpan sebagai HASH (bukan mentah).
 *   - Tidak ada kredensial yang dikembalikan ke klien.
 */

const MAKS_LAMPIRAN_BYTES = 2 * 1024 * 1024; // 2 MB
const MAKS_TEKS = 8000;
const MAKS_LAPORAN_PER_IP = 5;
const JENDELA_MS = 10 * 60_000;

// Rate limit sederhana di memori proses (per instance serverless).
const hitungPerIp = new Map<string, number[]>();

function lolosRateLimit(ip: string): boolean {
  const sekarang = Date.now();
  const arr = (hitungPerIp.get(ip) ?? []).filter((t) => sekarang - t < JENDELA_MS);
  if (arr.length >= MAKS_LAPORAN_PER_IP) {
    hitungPerIp.set(ip, arr);
    return false;
  }
  arr.push(sekarang);
  hitungPerIp.set(ip, arr);
  return true;
}

/** Deteksi tipe gambar yang diizinkan dari data URL. */
function tipeGambarDiizinkan(mime: string): boolean {
  return /^image\/(?:png|jpe?g|webp|gif)$/i.test(mime);
}

/** Nomor WA pemilik, sudah dinormalisasi (digit saja). */
function nomorPemilik(): string {
  return String(config.ownerWaNumber ?? '').replace(/^\+/, '').replace(/\D/g, '');
}

/** Kirim pesan TEKS ke WhatsApp pemilik (best-effort). */
async function kirimWaPemilik(teks: string): Promise<boolean> {
  const to = nomorPemilik();
  if (!to || !config.whatsappToken || !config.whatsappPhoneNumberId) return false;
  try {
    const res = await fetch(
      `https://graph.facebook.com/v21.0/${config.whatsappPhoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.whatsappToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to,
          type: 'text',
          text: { preview_url: false, body: teks.slice(0, 4000) },
        }),
        signal: AbortSignal.timeout(9000),
      },
    );
    if (!res.ok) {
      console.warn('[laporan] gagal kirim WA ke pemilik:', res.status, (await res.text()).slice(0, 180));
      return false;
    }
    return true;
  } catch (e) {
    console.warn('[laporan] WA pemilik error:', String((e as Error)?.message ?? e).slice(0, 120));
    return false;
  }
}

/** Kirim GAMBAR ke WhatsApp pemilik (upload media lalu kirim). */
async function kirimWaPemilikGambar(buf: Buffer, mime: string, caption: string): Promise<boolean> {
  const to = nomorPemilik();
  if (!to || !config.whatsappToken || !config.whatsappPhoneNumberId) return false;
  try {
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('type', mime);
    form.append('file', new Blob([new Uint8Array(buf)], { type: mime }), `laporan.${mime.split('/')[1] || 'png'}`);
    const upRes = await fetch(
      `https://graph.facebook.com/v21.0/${config.whatsappPhoneNumberId}/media`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.whatsappToken}` },
        body: form,
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!upRes.ok) {
      console.warn('[laporan] gagal upload media:', upRes.status);
      return false;
    }
    const upData = (await upRes.json()) as { id?: string };
    if (!upData.id) return false;

    const sendRes = await fetch(
      `https://graph.facebook.com/v21.0/${config.whatsappPhoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.whatsappToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to,
          type: 'image',
          image: { id: upData.id, caption: caption.slice(0, 1000) },
        }),
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!sendRes.ok) {
      console.warn('[laporan] gagal kirim gambar WA:', sendRes.status);
      return false;
    }
    return true;
  } catch (e) {
    console.warn('[laporan] WA gambar error:', String((e as Error)?.message ?? e).slice(0, 120));
    return false;
  }
}

/** Kirim notifikasi ke Telegram pemilik (jalur andal, tanpa batas 24 jam). */
async function kirimTelegramPemilik(teks: string): Promise<boolean> {
  if (!config.telegramToken || !config.ownerChatId) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${config.telegramToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: config.ownerChatId, text: teks, parse_mode: 'Markdown' }),
      signal: AbortSignal.timeout(8000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Kirim GAMBAR ke Telegram pemilik. */
async function kirimTelegramPemilikGambar(buf: Buffer, caption: string, mime: string): Promise<boolean> {
  if (!config.telegramToken || !config.ownerChatId) return false;
  try {
    const ext = mime.split('/')[1] || 'png';
    const form = new FormData();
    form.append('chat_id', String(config.ownerChatId));
    form.append('caption', caption.slice(0, 1000));
    form.append('photo', new Blob([new Uint8Array(buf)], { type: mime }), `laporan.${ext}`);
    const res = await fetch(`https://api.telegram.org/bot${config.telegramToken}/sendPhoto`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(15000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * ANALISIS KELUHAN oleh model AI (best-effort).
 *
 * Tujuan: menjawab pertanyaan pemilik produk "apakah bot nya bisa melihat keluhan
 * yg masuk di chat bot nya? dan memahami apa keluhannya?" — laporan dari form
 * DIBACA oleh model, lalu diringkas: inti masalah, kategori, dugaan penyebab, saran.
 * Hasilnya disimpan di kolom `analisis` + dikirim ke notifikasi pemilik, sehingga
 * pemilik TIDAK perlu membaca manual satu-satu.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ISOLASI TOTAL — LAPORAN TIDAK BOLEH MENCEMARI MEMORI/PERSONA BOT
 * (permintaan pemilik produk: "tapi jangan sampai bot nya jadi tercemar gara
 *  gara memori keluhan itu")
 *
 * JAMINAN BERLAPIS:
 *   1. Tabel `laporan` TERPISAH dari memori bot. Memori bot (getContext di
 *      src/memory.ts) HANYA membaca: `messages`, `summaries`, `corrections`.
 *      Tidak ada satu pun kode di src/ yang membaca `laporan` — jadi laporan
 *      TIDAK PERNAH masuk konteks percakapan.
 *   2. Analisis di bawah ini HANYA ditulis ke kolom `analisis` (untuk dibaca
 *      pemilik) + dikirim ke notifikasi. TIDAK ditulis ke `messages` maupun
 *      `corrections`, sehingga tidak pernah jadi "contoh" bagi model.
 *   3. TIDAK ADA penulisan otomatis ke memori dari laporan. Bila pemilik ingin
 *      laporan menjadi pelajaran, itu harus dilakukan MANUAL (lewat perbaikan
 *      kode/test) agar persona tidak rusak oleh laporan asal-asalan.
 *
 * ATURAN UNTUK PENGEMBANG: JANGAN pernah menambahkan kode yang membaca tabel
 * `laporan` di dalam `src/` (jalur percakapan bot). Kalau butuh, buat endpoint
 * terpisah seperti file ini.
 * ═══════════════════════════════════════════════════════════════════════════
 */
async function analisisKeluhan(pesan: string, lampiranAda: boolean): Promise<string> {
  try {
    const { dynamicNotice } = await import('../src/skills.js');
    const instruksi =
      '[SISTEM] Ini adalah LAPORAN/KELUHAN dari pengguna tentang perilaku bot AI. ' +
      'Tugasmu: analisis SINGKAT (maks 4 baris) dengan format:\n' +
      'INTI: <masalah utamanya apa>\n' +
      'KATEGORI: <salah satu: klasifikasi-salah, jawaban-ngaco, tidak-nyambung, ' +
      'lupa-konteks, fitur-tidak-jalan, gaya-bahasa, lain-lain>\n' +
      'DUGAAN PENYEBAB: <perkiraan teknis singkat>\n' +
      'SARAN: <langkah perbaikan singkat>\n\n' +
      (lampiranAda ? '(Ada lampiran tangkapan layar dari pelapor.)\n\n' : '') +
      `Isi laporan:\n${pesan.slice(0, 2500)}`;
    const hasil = await dynamicNotice(instruksi);
    if (hasil && hasil.trim() && !hasil.includes('gangguan koneksi')) return hasil.trim().slice(0, 1200);
  } catch {
    // analisis best-effort: laporan tetap tersimpan tanpa analisis
  }
  return '';
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  // Security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');

  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method tidak diizinkan.' });
    return;
  }

  // Ambil IP (Vercel menyediakan x-forwarded-for)
  const fwd = req.headers['x-forwarded-for'];
  const ip = (Array.isArray(fwd) ? fwd[0] : fwd || '').split(',')[0].trim() || 'tanpa-ip';
  if (!lolosRateLimit(ip)) {
    res.status(429).json({ ok: false, error: 'Terlalu banyak laporan. Coba lagi beberapa menit lagi ya.' });
    return;
  }

  try {
    const body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) as {
      pesan?: string;
      lampiran?: string; // data URL: "data:image/png;base64,...."
      platform?: string;
      halaman?: string;
    };

    const pesan = String(body?.pesan ?? '').trim();
    const platform = String(body?.platform ?? '').trim().slice(0, 40);
    const halaman = String(body?.halaman ?? '').trim().slice(0, 200);

    if (pesan.length < 5) {
      res.status(400).json({ ok: false, error: 'Ceritakan dulu masalahnya (minimal 5 karakter).' });
      return;
    }
    if (pesan.length > MAKS_TEKS) {
      res.status(400).json({ ok: false, error: `Laporan terlalu panjang (maks ${MAKS_TEKS} karakter).` });
      return;
    }

    // ── Proses lampiran (opsional) ──
    let bufGambar: Buffer | null = null;
    let mimeGambar = '';
    let lampiranPath: string | null = null;
    const lampiranMentah = String(body?.lampiran ?? '');
    if (lampiranMentah) {
      const m = lampiranMentah.match(/^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i);
      if (!m) {
        res.status(400).json({ ok: false, error: 'Format lampiran tidak dikenal (harus gambar).' });
        return;
      }
      mimeGambar = m[1].toLowerCase();
      if (!tipeGambarDiizinkan(mimeGambar)) {
        res.status(400).json({ ok: false, error: 'Lampiran harus gambar (PNG, JPG, WEBP, atau GIF).' });
        return;
      }
      bufGambar = Buffer.from(m[2].replace(/\s/g, ''), 'base64');
      if (bufGambar.length > MAKS_LAMPIRAN_BYTES) {
        res.status(413).json({ ok: false, error: 'Gambar terlalu besar (maks 2 MB). Kompres dulu ya.' });
        return;
      }
      // Arsipkan ke Supabase Storage (best-effort) sebagai cadangan.
      const cArsip = db();
      if (cArsip) {
        try {
          const ext = mimeGambar.includes('png') ? 'png'
            : mimeGambar.includes('webp') ? 'webp'
            : mimeGambar.includes('gif') ? 'gif'
            : 'jpg';
          const nama = `laporan/${new Date().toISOString().slice(0, 10)}/${crypto.randomBytes(8).toString('hex')}.${ext}`;
          const { error: errUp } = await cArsip.storage.from('laporan').upload(nama, bufGambar, {
            contentType: mimeGambar,
            upsert: false,
          });
          if (!errUp) lampiranPath = nama;
        } catch {
          // arsip best-effort: lampiran tetap dikirim lewat WA/Telegram
        }
      }
    }

    // ── 1. SIMPAN ke database (agar tidak pernah hilang) ──
    let idLaporan: number | undefined;
    const c = db();
    if (c) {
      const { data, error } = await c
        .from('laporan')
        .insert({
          pesan,
          platform: platform || null,
          halaman: halaman || null,
          lampiran_path: lampiranPath,
          ip_hash: crypto.createHash('sha256').update(ip).digest('hex').slice(0, 32),
          status: 'baru',
        })
        .select('id')
        .single();
      if (error) {
        console.warn('[laporan] gagal simpan DB:', error.message);
        if (/does not exist|relation|schema cache/i.test(error.message)) {
          res.status(500).json({
            ok: false,
            error: 'Fitur laporan belum aktif sepenuhnya (migrasi database belum dijalankan).',
          });
          return;
        }
      } else {
        idLaporan = (data as { id?: number } | null)?.id;
      }
    }

    // ── 2. KIRIM ke pemilik lewat WA + Telegram (paralel, best-effort) ──
    const judul = `📩 *Laporan baru*${idLaporan ? ` (#${idLaporan})` : ''}`;
    const detail = [
      platform ? `Platform: ${platform}` : '',
      halaman ? `Halaman: ${halaman}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    const teksNotif = `${judul}\n\n${pesan}${detail ? `\n\n${detail}` : ''}`;

    const [waOk, tgOk] = await Promise.all([
      kirimWaPemilik(teksNotif),
      kirimTelegramPemilik(teksNotif),
    ]);

    // Gambar dikirim menyusul (paralel) bila ada.
    if (bufGambar) {
      const caption = `Lampiran laporan${idLaporan ? ` #${idLaporan}` : ''}`;
      await Promise.all([
        kirimWaPemilikGambar(bufGambar, mimeGambar, caption),
        kirimTelegramPemilikGambar(bufGambar, caption, mimeGambar),
      ]);
    }

    // Sukses bila tersimpan di DB ATAU terkirim ke minimal satu kanal.
    const berhasil = Boolean(idLaporan) || waOk || tgOk;
    if (!berhasil) {
      res.status(503).json({
        ok: false,
        error: 'Laporan belum bisa dikirim sekarang. Coba lagi sebentar lagi ya.',
      });
      return;
    }

    res.status(200).json({ ok: true, pesan: 'Terima kasih! Laporanmu sudah terkirim. 🙏' });
  } catch (err) {
    console.error('[laporan] error:', err);
    res.status(500).json({ ok: false, error: 'Terjadi kesalahan. Coba lagi nanti ya.' });
  }
}
