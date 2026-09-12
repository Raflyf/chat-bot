import { config } from './env.js';
import { autoReply, describeImage, sanitizeAssistantOutput } from './skills.js';
import type { ChatContext } from './memory.js';
import mammoth from 'mammoth';
import zlib from 'node:zlib';

/** Helper transkripsi via Groq Whisper API */
async function transcribeViaGroq(buffer: Buffer, mime: string, model: string): Promise<string | null> {
  const keys = config.pools.groq;
  if (!keys || keys.length === 0) return null;

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
      formData.append('model', model);
      formData.append('response_format', 'json');

      const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}` },
        body: formData,
      });

      if (!res.ok) continue;
      const data = (await res.json()) as { text?: string };
      if (data.text && data.text.trim()) {
        return data.text.trim();
      }
    } catch (err) {
      console.warn(`[media] Groq transkripsi [${model}] gagal:`, err);
    }
  }
  return null;
}

/** Helper transkripsi audio via Google Gemini Multimodal API */
async function transcribeViaGemini(buffer: Buffer, mime: string, model: string): Promise<string | null> {
  const keys = config.pools.gemini;
  if (!keys || keys.length === 0) return null;

  for (const key of keys) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            role: 'user',
            parts: [
              { inlineData: { mimeType: mime, data: buffer.toString('base64') } },
              { text: 'Transkripsikan isi rekaman suara ini persis kata demi kata dalam Bahasa Indonesia tanpa komentar tambahan. Tuliskan teks transkripsinya saja.' }
            ]
          }],
          generationConfig: { temperature: 0.1 }
        })
      });

      if (!res.ok) continue;
      const data = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      if (text) return text;
    } catch (err) {
      console.warn(`[media] Gemini audio [${model}] gagal:`, err);
    }
  }
  return null;
}

/**
 * Transkripsi audio / Voice Note (VN) WhatsApp & Telegram:
 * - Primary: whisper-large-v3 (Groq)
 * - Cadangan 1: gemini-3.8-flash (Gemini native audio)
 * - Cadangan 2: whisper-large-v3-turbo (Groq)
 * - Cadangan 3: gemini-2.5-flash (Gemini native audio)
 */
export async function transcribeAudio(buffer: Buffer, mime: string = 'audio/ogg'): Promise<string> {
  // 1. Primary: Groq whisper-large-v3
  const t1 = await transcribeViaGroq(buffer, mime, 'whisper-large-v3');
  if (t1) return t1;

  // 2. Cadangan 1: Gemini gemini-3.8-flash
  const geminiPrimary = config.models.geminiPrimary || 'gemini-3.8-flash';
  const t2 = await transcribeViaGemini(buffer, mime, geminiPrimary);
  if (t2) return t2;

  // 3. Cadangan 2: Groq whisper-large-v3-turbo
  const t3 = await transcribeViaGroq(buffer, mime, 'whisper-large-v3-turbo');
  if (t3) return t3;

  // 4. Cadangan 3: Gemini gemini-2.5-flash
  const geminiBackup = config.models.geminiBackup || 'gemini-2.5-flash';
  const t4 = await transcribeViaGemini(buffer, mime, geminiBackup);
  if (t4) return t4;

  throw new Error('TRANSCRIPTION_ALL_KEYS_FAILED');
}

/**
 * Ekstraksi teks dari PDF sederhana (uncompressed stream atau FlateDecode stream).
 */
export function extractPdfTextSimple(buffer: Buffer): string | null {
  try {
    let fullText = '';
    const content = buffer.toString('binary');
    const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
    let match: RegExpExecArray | null;
    while ((match = streamRegex.exec(content)) !== null) {
      const streamData = match[1];
      let decompressed = streamData;
      try {
        decompressed = zlib.inflateSync(Buffer.from(streamData, 'binary')).toString('utf-8');
      } catch {
        // stream mungkin uncompressed teks polos
      }
      const textMatches = decompressed.matchAll(/\(([^)]+)\)\s*Tj/g);
      for (const tm of textMatches) {
        fullText += tm[1] + ' ';
      }
      const tjMatches = decompressed.matchAll(/\[(.*?)\]\s*TJ/g);
      for (const tm of tjMatches) {
        const inner = tm[1].matchAll(/\(([^)]+)\)/g);
        for (const im of inner) {
          fullText += im[1] + ' ';
        }
      }
    }
    const clean = fullText.replace(/\s+/g, ' ').trim();
    return clean.length > 0 ? clean : null;
  } catch (err) {
    console.warn('[media] Gagal ekstraksi teks PDF lokal:', err);
    return null;
  }
}

/**
 * Helper analisis native PDF via Google Gemini Multimodal API.
 */
async function processPdfViaGemini(
  buffer: Buffer,
  prompt: string,
  model: string,
): Promise<{ reply: string; via: string } | null> {
  const keys = config.pools.gemini;
  if (!keys || keys.length === 0) return null;

  for (const key of keys) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            role: 'user',
            parts: [
              { inlineData: { mimeType: 'application/pdf', data: buffer.toString('base64') } },
              { text: prompt }
            ]
          }],
          generationConfig: { temperature: 0.3 }
        })
      });

      if (!res.ok) continue;
      const data = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      if (text) {
        return { reply: sanitizeAssistantOutput(text), via: `gemini/${model}` };
      }
    } catch (err) {
      console.warn(`[media] Gemini PDF [${model}] gagal:`, err);
    }
  }
  return null;
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

  // 1. Dokumen Microsoft Word (.docx) via parser Mammoth lokal (21 ms)
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

  // 2. Berkas teks polos, kode sumber, data terstruktur (.txt, .md, .csv, .json, dsb)
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
 * Dokumen PDF:
 * - Primary: gemini-3.8-flash (native multimodal document)
 * - Cadangan: gemini-2.5-flash (native multimodal document)
 * - Parser Teks Lokal (Fallback): Ekstrak teks lokal lalu teruskan ke xKiro Qwen 3.8.
 */
export async function processIncomingDocument(
  buffer: Buffer,
  mime: string,
  filename: string,
  caption?: string,
  ctx?: ChatContext,
): Promise<{ reply: string; via: string }> {
  const lowerName = filename.toLowerCase();

  // Kasus A: Dokumen PDF
  if (lowerName.endsWith('.pdf') || mime.includes('pdf')) {
    const prompt = caption && caption.trim()
      ? `Pengguna mengirim dokumen PDF "${filename}". Pertanyaan / instruksi temanmu:\n${caption.trim()}\n\nAturan: Jawab langsung to-the-point, jelas, dan manusiawi layaknya sahabat diskusi tanpa pembuka klise robotik.`
      : `Pengguna mengirim dokumen PDF "${filename}". Tolong baca dan rangkum inti terpentingnya secara ringkas, padat, dan ramah selayaknya teman ngobrol yang membantu meringkas isi dokumen (gunakan gaya: "Udah kubaca nih dokumennya. Intinya...").`;

    // 1. Primary: gemini-3.8-flash
    const p1 = await processPdfViaGemini(buffer, prompt, config.models.geminiPrimary || 'gemini-3.8-flash');
    if (p1) return p1;

    // 2. Cadangan: gemini-2.5-flash
    const p2 = await processPdfViaGemini(buffer, prompt, config.models.geminiBackup || 'gemini-2.5-flash');
    if (p2) return p2;

    // 3. Parser Teks Lokal (Fallback): Ekstrak teks halaman PDF secara lokal lalu teruskan ke xKiro Qwen 3.8
    const extractedText = extractPdfTextSimple(buffer);
    if (extractedText && extractedText.length > 20) {
      const localPrompt = [
        `[BERKAS DOKUMEN PDF (EKSTRAKSI TEKS LOKAL): "${filename}"]`,
        '--- ISI DOKUMEN ---',
        extractedText.slice(0, 25000),
        '--- AKHIR ISI DOKUMEN ---',
        '',
        caption && caption.trim()
          ? `Pertanyaan / instruksi temanmu tentang dokumen ini: ${caption.trim()}`
          : 'Tolong baca dan rangkum inti dokumen PDF ini secara jelas, padat, dan terstruktur.',
      ].join('\n');
      const autoRes = await autoReply(localPrompt, ctx);
      return { reply: autoRes.reply, via: `local-parser/${autoRes.via}` };
    }

    return {
      reply: `Berkas PDF *${filename}* berhasil diterima, namun sistem AI sedang mengalami antrean pemrosesan dokumen visual. Silakan coba kirim ulang beberapa saat lagi atau tanyakan bagian tertentu via teks.`,
      via: 'fallback-pdf-error',
    };
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
 * Memproses video (MP4 / WebM) via Google Gemini Multimodal API.
 */
export async function processIncomingVideo(
  buffer: Buffer,
  mime: string = 'video/mp4',
  filename: string = 'video.mp4',
  caption?: string,
): Promise<{ reply: string; via: string }> {
  const prompt = caption && caption.trim()
    ? `Pengguna mengirim video "${filename}". Pertanyaan / instruksi:\n${caption.trim()}\n\nAturan: Jawab langsung to-the-point, santai, dan alami tanpa kalimat pembuka robotik seperti "Video ini menampilkan...".`
    : `Pengguna mengirim video "${filename}". Tonton dan tanggapi kejadian atau suasana dalam video ini secara wajar, santai, dan seru layaknya teman yang baru saja menonton bersama. DILARANG membuka dengan "Video ini memperlihatkan...".`;

  const models = [config.models.geminiPrimary || 'gemini-3.8-flash', config.models.geminiBackup || 'gemini-2.5-flash'];
  const keys = config.pools.gemini;

  for (const model of models) {
    for (const key of keys) {
      try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              role: 'user',
              parts: [
                { inlineData: { mimeType: mime, data: buffer.toString('base64') } },
                { text: prompt }
              ]
            }],
            generationConfig: { temperature: 0.3 }
          })
        });

        if (!res.ok) continue;
        const data = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        if (text) {
          return { reply: sanitizeAssistantOutput(text), via: `gemini/${model}` };
        }
      } catch (err) {
        console.warn(`[media] Video via Gemini [${model}] gagal:`, err);
      }
    }
  }

  return {
    reply: `Video *${filename}* berhasil diterima, namun sistem AI video sedang sibuk. Silakan coba kirim ulang beberapa saat lagi.`,
    via: 'fallback-video-error',
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
