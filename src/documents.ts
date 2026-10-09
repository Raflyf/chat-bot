/**
 * SIMPAN DOKUMEN — teks hasil ekstraksi PDF/Word agar bisa DIAUDIT.
 *
 * KENAPA (permintaan pemilik produk, 09 Okt 2026):
 *   "apalah bot benar menjelaskan isi pdf nya? coba kamu cek isi pdf nya dan
 *    bandingkan dengan bot apakah sudah sesuai" + "itu pdf yg dikirim user emg
 *    ga masuk db?"
 *
 * MASALAH YANG DIPERBAIKI: saat user mengirim dokumen, isinya dibaca → dikirim ke
 * AI untuk dirangkum → lalu DIBUANG. Yang tersimpan di `messages` hanya nama file
 * ("[Dokumen: ....pdf]"). Akibatnya ringkasan bot TIDAK BISA diverifikasi, dan bot
 * tidak bisa mengingat isi dokumen di percakapan berikutnya.
 *
 * SOLUSI: simpan teks ekstraksi + ringkasan bot ke tabel `documents` (migrasi v32).
 *
 * TAHAN BANTING: bila tabel `documents` belum ada (migrasi belum dijalankan),
 * fungsi ini TIDAK melempar error — hanya mengembalikan false. Bot tetap jalan.
 */
import { db } from './db.js';
import { normChatId } from './chat_id.js';
import { logWarn } from './logger.js';

/** Batas karakter teks yang disimpan (agar DB tidak membengkak). */
const BATAS_TEKS = 40_000;

/** Agar peringatan "tabel belum ada" hanya tampil SEKALI, tidak membanjiri log. */
let peringatanTabelSudahDitampilkan = false;

export interface DokumenTersimpan {
  chatId: string;
  filename: string;
  mime?: string;
  teks?: string | null;
  ringkasan?: string | null;
  via?: string | null;
  platform?: string;
}

/**
 * Simpan dokumen (teks + ringkasan) ke tabel `documents`.
 * Mengembalikan true bila berhasil. GAGAL DIAM-DIAM bila tabel belum ada.
 */
export async function simpanDokumen(d: DokumenTersimpan): Promise<boolean> {
  const c = db();
  if (!c || !d?.chatId || !d?.filename) return false;
  d.chatId = normChatId(d.chatId);   // konsistensi chat_id (satu sumber)
  const teksAsli = typeof d.teks === 'string' ? d.teks : '';
  try {
    const { error } = await c.from('documents').insert({
      chat_id: d.chatId,
      platform: d.platform ?? 'whatsapp',
      filename: String(d.filename).slice(0, 300),
      mime: d.mime ? String(d.mime).slice(0, 120) : null,
      teks: teksAsli ? teksAsli.slice(0, BATAS_TEKS) : null,
      teks_panjang: teksAsli.length || null,
      ringkasan: d.ringkasan ? String(d.ringkasan).slice(0, 8000) : null,
      via: d.via ? String(d.via).slice(0, 120) : null,
    });
    if (error) {
      // Tabel belum ada (migrasi v32 belum dijalankan) -> beri tahu SEKALI saja.
      const kode = (error as { code?: string }).code || '';
      if (kode === 'PGRST205' || kode === '42P01' || /documents/i.test(String((error as { message?: string }).message))) {
        if (!peringatanTabelSudahDitampilkan) {
          peringatanTabelSudahDitampilkan = true;
          logWarn('Tabel `documents` belum ada — jalankan sql/migrate_v32_documents.sql agar isi dokumen bisa diaudit.');
        }
      }
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Ambil dokumen terakhir user (untuk konteks percakapan lanjutan).
 * Berguna bila user bertanya "tadi isi PDF-nya apa?".
 */
export async function dokumenTerakhir(
  chatId: string,
  limit = 3,
): Promise<Array<{ filename: string; teks: string | null; ringkasan: string | null; created_at: string }>> {
  chatId = normChatId(chatId);   // konsistensi chat_id (satu sumber)
  const c = db();
  if (!c || !chatId) return [];
  try {
    const { data, error } = await c
      .from('documents')
      .select('filename, teks, ringkasan, created_at')
      .eq('chat_id', chatId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return data as Array<{ filename: string; teks: string | null; ringkasan: string | null; created_at: string }>;
  } catch {
    return [];
  }
}

/**
 * Ekstrak teks dokumen APA PUN (PDF/DOCX/XLSX/CSV/TXT) agar isinya bisa DISIMPAN,
 * bukan hanya dikirim ke model lalu dibuang.
 *
 * Memakai `extractDocumentText()` dari media.ts yang sudah menangani semua format
 * (PDF via pdf-parse, Word via mammoth, Excel via pembaca ZIP+XML internal).
 * Mengembalikan null bila gagal (mis. PDF hasil scan tanpa lapisan teks).
 */
export async function ekstrakTeksDokumen(
  buffer: Buffer,
  mime: string,
  filename: string,
): Promise<string | null> {
  try {
    const lower = (filename || '').toLowerCase();
    const isPdf = (mime || '').toLowerCase().includes('pdf') || lower.endsWith('.pdf');

    // PDF: pakai pdf-parse (paling andal untuk lapisan teks PDF).
    // CATATAN: `extractDocumentText()` di media.ts mengembalikan null untuk PDF
    // karena jalur PDF di sana diarahkan ke model VISION (bukan ekstraksi teks).
    if (isPdf) {
      const t = await ekstrakTeksPdf(buffer);
      if (t) return t;
      // PDF hasil scan tanpa lapisan teks -> jatuh ke extractDocumentText (null),
      // isi tetap bisa dibaca model vision walau tidak bisa disimpan.
    }

    const { extractDocumentText } = await import('./media.js');
    const teks = await extractDocumentText(buffer, mime, filename);
    return teks && teks.trim().length >= 20 ? teks.trim() : null;
  } catch {
    return null;
  }
}

/**
 * Ekstrak teks dari PDF SAJA (pdf-parse langsung). Dipertahankan untuk pemakaian
 * khusus PDF; untuk umum pakai `ekstrakTeksDokumen()`.
 */
export async function ekstrakTeksPdf(buffer: Buffer): Promise<string | null> {
  try {
    // ── PENTING: impor `lib/pdf-parse.js`, BUKAN `pdf-parse` ──
    // BUG TERKENAL pdf-parse@1.1.1: `index.js` menjalankan KODE TES internal
    // (`if (!module.parent) { Fs.readFileSync('./test/data/05-versions-space.pdf') }`)
    // yang langsung ERROR di serverless karena file test tidak ikut ter-deploy:
    //   "ENOENT: no such file or directory, open '.../test/data/05-versions-space.pdf'"
    // Mengimpor langsung file library-nya melewati blok tes itu.
    //
    // Impor dinamis juga dipakai agar pdf-parse hanya dimuat saat ada PDF,
    // tidak membebani cold start serverless untuk pesan teks biasa.
    const mod = await import('pdf-parse/lib/pdf-parse.js');
    const pdfParse = (mod as unknown as { default?: (b: Buffer) => Promise<{ text?: string }> }).default
      ?? (mod as unknown as (b: Buffer) => Promise<{ text?: string }>);
    const hasil = await pdfParse(buffer);
    const teks = String(hasil?.text ?? '').replace(/\u0000/g, '').trim();
    return teks.length >= 20 ? teks : null;
  } catch {
    return null;
  }
}
