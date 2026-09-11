import { config } from './env.js';
import { autoReply, describeImage } from './skills.js';
import type { ChatContext } from './memory.js';
import mammoth from 'mammoth';

/**
 * Transkripsi audio / Voice Note (VN) menggunakan model Whisper dari Groq API.
 * Sangat cepat (~500ms), akurat dalam Bahasa Indonesia, dan efisien.
 */
export async function transcribeAudio(buffer: Buffer, mime: string = 'audio/ogg'): Promise<string> {
  const keys = config.pools.groq;
  if (!keys || keys.length === 0) {
    throw new Error('NO_GROQ_KEYS_FOR_WHISPER');
  }

  let ext = 'ogg';
  if (mime.includes('mp4') || mime.includes('m4a')) ext = 'm4a';
  else if (mime.includes('wav')) ext = 'wav';
  else if (mime.includes('mp3') || mime.includes('mpeg')) ext = 'mp3';
  const filename = `voice.${ext}`;
  const u8Array = new Uint8Array(buffer);

  for (const key of keys) {
    try {
      const formData = new FormData();
      formData.append('file', new Blob([u8Array], { type: mime }), filename);
      formData.append('model', 'whisper-large-v3-turbo');
      formData.append('response_format', 'json');

      const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}` },
        body: formData,
      });

      if (!res.ok) {
        // Coba model cadangan whisper-large-v3 jika turbo tidak tersedia
        const retryForm = new FormData();
        retryForm.append('file', new Blob([u8Array], { type: mime }), filename);
        retryForm.append('model', 'whisper-large-v3');
        retryForm.append('response_format', 'json');

        const retryRes = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}` },
          body: retryForm,
        });

        if (!retryRes.ok) continue;
        const retryData = (await retryRes.json()) as { text?: string };
        if (retryData.text && retryData.text.trim()) {
          return retryData.text.trim();
        }
        continue;
      }

      const data = (await res.json()) as { text?: string };
      if (data.text && data.text.trim()) {
        return data.text.trim();
      }
    } catch (err) {
      console.warn('[media] Gagal transkripsi via Groq Whisper:', err);
    }
  }

  throw new Error('TRANSCRIPTION_ALL_KEYS_FAILED');
}

/**
 * Ekstraksi teks dari berbagai format dokumen teks & Word (.docx).
 */
export async function extractDocumentText(
  buffer: Buffer,
  mime: string,
  filename: string,
): Promise<string | null> {
  const lowerName = filename.toLowerCase();

  // 1. Dokumen Microsoft Word (.docx)
  if (
    lowerName.endsWith('.docx') ||
    mime.includes('wordprocessingml') ||
    mime.includes('msword')
  ) {
    try {
      const result = await mammoth.extractRawText({ buffer });
      if (result.value && result.value.trim().length > 0) {
        return result.value.trim();
      }
    } catch (err) {
      console.warn('[media] Gagal ekstrak Word .docx via mammoth:', err);
    }
  }

  // 2. Berkas teks polos, kode sumber, data terstruktur
  const textExtensions = [
    '.txt',
    '.md',
    '.csv',
    '.json',
    '.js',
    '.ts',
    '.jsx',
    '.tsx',
    '.py',
    '.html',
    '.css',
    '.sql',
    '.yaml',
    '.yml',
    '.xml',
    '.env',
    '.log',
  ];

  if (
    mime.startsWith('text/') ||
    mime.includes('json') ||
    mime.includes('javascript') ||
    textExtensions.some((ext) => lowerName.endsWith(ext))
  ) {
    try {
      const text = buffer.toString('utf-8').trim();
      if (text.length > 0) return text;
    } catch {
      // abaikan
    }
  }

  return null;
}

/**
 * Memproses dan menganalisis berkas dokumen (PDF, Word, File Teks) secara cerdas.
 */
export async function processIncomingDocument(
  buffer: Buffer,
  mime: string,
  filename: string,
  caption?: string,
  ctx?: ChatContext,
): Promise<{ reply: string; via: string }> {
  const lowerName = filename.toLowerCase();

  // Kasus A: PDF - Kirim langsung sebagai multimodal document ke model vision (Gemini / OpenRouter)
  if (lowerName.endsWith('.pdf') || mime.includes('pdf')) {
    const prompt = caption && caption.trim()
      ? `Pengguna mengirim berkas PDF "${filename}". Instruksi / pertanyaan:\n${caption.trim()}`
      : `Pengguna mengirim berkas PDF "${filename}". Tolong baca, analisis, dan rangkum poin-poin terpenting dalam dokumen ini secara jelas, terstruktur, dan mudah dipahami.`;

    try {
      return await describeImage(buffer.toString('base64'), 'application/pdf', prompt);
    } catch (err) {
      console.warn('[media] Gagal memproses PDF via multimodal vision:', err);
      return {
        reply: `Berkas PDF *${filename}* berhasil diterima, namun sistem AI sedang mengalami antrean pemrosesan dokumen visual. Silakan coba kirim ulang beberapa saat lagi atau tanyakan bagian tertentu via teks.`,
        via: 'fallback-pdf-error',
      };
    }
  }

  // Kasus B: Dokumen Word (.docx) atau berkas teks/kode
  const extracted = await extractDocumentText(buffer, mime, filename);
  if (extracted) {
    const prompt = [
      `[BERKAS DOKUMEN DARI TEMANMU: "${filename}"]`,
      '--- ISI BERKAS ---',
      extracted.slice(0, 25000), // Batas aman token
      '--- AKHIR ISI BERKAS ---',
      '',
      caption && caption.trim()
        ? `Pertanyaan / instruksi temanmu tentang berkas ini: ${caption.trim()}`
        : 'Tolong baca dan rangkum inti dokumen ini secara bersahabat, jelas, dan terstruktur.',
    ].join('\n');

    return await autoReply(prompt, ctx);
  }

  // Kasus C: Dokumen tidak didukung (misal biner terenkripsi)
  return {
    reply: `Berkas *${filename}* berhasil diterima, namun formatnya tidak dapat dibaca secara langsung. Coba kirim dalam format PDF, Word (.docx), atau file teks (.txt, .md, .csv, kode).`,
    via: 'fallback-unsupported',
  };
}

/**
 * Memproses stiker WhatsApp atau Telegram (.webp) dan memahami konteks ekspresinya via Vision AI.
 */
export async function processIncomingSticker(
  buffer: Buffer,
  mime: string = 'image/webp',
  emoji?: string,
  _ctx?: ChatContext,
): Promise<{ reply: string; via: string }> {
  const prompt = emoji
    ? `Pengguna mengirim stiker ekspresi (terkait dengan emoji: ${emoji}). Tolong pahami emosi atau konteks humor dari stiker ini dan tanggapi secara santai, akrab, dan bersahabat layaknya seorang teman mengobrol.`
    : 'Pengguna mengirim stiker ini. Tolong pahami emosi atau konteks humor dari stiker ini dan tanggapi secara santai, akrab, dan bersahabat layaknya seorang teman mengobrol.';

  return await describeImage(buffer.toString('base64'), mime, prompt);
}
