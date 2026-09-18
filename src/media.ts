import { config } from './env.js';
import { autoReply, describeImage, sanitizeAssistantOutput } from './skills.js';
import { chat, geminiThinkingConfig } from './providers.js';
import type { ChatContext } from './memory.js';
import { keyUsed, isKeyAllowed, keyTokensUsed } from './quota.js';
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
    if (!(await isKeyAllowed('groq', key, config.dailyCap.groq))) continue;
    try {
      const formData = new FormData();
      formData.append('file', new Blob([u8Array], { type: mime }), filename);
      formData.append('model', model);
      formData.append('response_format', 'json');

      const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}` },
        body: formData,
        signal: AbortSignal.timeout(config.downloadTimeoutMs || 20000),
      });

      if (!res.ok) continue;
      const data = (await res.json()) as { text?: string };
      if (data.text && data.text.trim()) {
        // Catat pemakaian kuota Groq (Whisper memakai kuota provider yang sama).
        // Whisper dibatasi ASH/ASD (audio seconds), bukan TPD token, jadi hanya call count.
        keyUsed('groq', key);
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
    if (!(await isKeyAllowed('gemini', key, config.dailyCap.gemini))) continue;
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(config.downloadTimeoutMs || 20000),
        body: JSON.stringify({
          contents: [{
            role: 'user',
            parts: [
              { inlineData: { mimeType: mime, data: buffer.toString('base64') } },
              { text: 'Transkripsikan isi rekaman suara ini persis kata demi kata dalam Bahasa Indonesia tanpa komentar tambahan. Tuliskan teks transkripsinya saja.' }
            ]
          }],
          generationConfig: { temperature: 0.1, ...geminiThinkingConfig(model) }
        })
      });

      if (!res.ok) continue;
      const data = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        usageMetadata?: { totalTokenCount?: number };
      };
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      if (text) {
        // Catat pemakaian kuota Gemini (transkripsi audio memakai kuota provider yang sama)
        keyUsed('gemini', key);
        if (data.usageMetadata?.totalTokenCount) {
          keyTokensUsed('gemini', key, Number(data.usageMetadata.totalTokenCount) || 0);
        }
        return text;
      }
    } catch (err) {
      console.warn(`[media] Gemini audio [${model}] gagal:`, err);
    }
  }
  return null;
}

/** Helper transkripsi audio via Cloudflare Workers AI Whisper (endpoint native /ai/run). */
async function transcribeViaCloudflare(buffer: Buffer, model: string): Promise<string | null> {
  const keys = config.pools.cloudflare;
  if (!keys || keys.length === 0) return null;

  for (const rawKey of keys) {
    if (!(await isKeyAllowed('cloudflare', rawKey, config.dailyCap.cloudflare))) continue;
    const accountId = rawKey.includes(':') ? rawKey.slice(0, rawKey.indexOf(':')).trim() : '';
    const token = rawKey.includes(':') ? rawKey.slice(rawKey.indexOf(':') + 1).trim() : rawKey.trim();
    if (!accountId) continue;
    try {
      const res = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ audio: buffer.toString('base64') }),
          signal: AbortSignal.timeout(config.downloadTimeoutMs || 20000),
        },
      );
      if (!res.ok) continue;
      const data = (await res.json()) as { result?: { text?: string } };
      const text = data.result?.text?.trim();
      if (text) {
        keyUsed('cloudflare', rawKey);
        return text;
      }
    } catch (err) {
      console.warn(`[media] Cloudflare transkripsi [${model}] gagal:`, err);
    }
  }
  return null;
}

/**
 * Transkripsi audio / Voice Note (VN) WhatsApp & Telegram:
 * - Primary: whisper-large-v3 (Groq)
 * - Cadangan 1: whisper-large-v3-turbo (Cloudflare Workers AI, endpoint native)
 * - Cadangan 2: whisper-large-v3-turbo (Groq)
 * - Cadangan 3: Gemini native audio (3.5 Flash Lite > 2.5 Flash)
 */
export async function transcribeAudio(buffer: Buffer, mime: string = 'audio/ogg'): Promise<string> {
  // 1. Primary: Groq whisper-large-v3
  const t1 = await transcribeViaGroq(buffer, mime, 'whisper-large-v3');
  if (t1) return t1;

  // 2. Cadangan 1: Cloudflare Whisper (pool & kuota berbeda dari Groq)
  const t2 = await transcribeViaCloudflare(buffer, '@cf/openai/whisper-large-v3-turbo');
  if (t2) return t2;

  // 3. Cadangan 2: Groq whisper-large-v3-turbo
  const t3 = await transcribeViaGroq(buffer, mime, 'whisper-large-v3-turbo');
  if (t3) return t3;

  // 4. Cadangan 3: Gemini native audio
  for (const model of config.models.geminiVision) {
    const t = await transcribeViaGemini(buffer, mime, model);
    if (t) return t;
  }

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
        decompressed = zlib.inflateSync(Buffer.from(streamData, 'binary'), { maxOutputLength: 5 * 1024 * 1024 }).toString('utf-8');
      } catch {
        // stream mungkin uncompressed teks polos
      }
      const textMatches = decompressed.matchAll(/\(([^)]+)\)\s*Tj/g);
      for (const tm of textMatches) {
        fullText += tm[1] + ' ';
        if (fullText.length > 300000) break;
      }
      if (fullText.length > 300000) break;
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
): Promise<{ reply: string; via: string; tokens?: { prompt: number; completion: number; total: number } } | null> {
  const keys = config.pools.gemini;
  if (!keys || keys.length === 0) return null;

  for (const key of keys) {
    if (!(await isKeyAllowed('gemini', key, config.dailyCap.gemini))) continue;
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(config.downloadTimeoutMs || 25000),
        body: JSON.stringify({
          contents: [{
            role: 'user',
            parts: [
              { inlineData: { mimeType: 'application/pdf', data: buffer.toString('base64') } },
              { text: prompt }
            ]
          }],
          generationConfig: { temperature: 0.3, ...geminiThinkingConfig(model) }
        })
      });

      if (!res.ok) continue;
      const data = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        usageMetadata?: {
          promptTokenCount?: number;
          candidatesTokenCount?: number;
          totalTokenCount?: number;
        };
      };
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      if (text) {
        // Catat pemakaian kuota Gemini (analisis PDF native memakai kuota provider yang sama)
        keyUsed('gemini', key);
        const tokens = data.usageMetadata
          ? {
              prompt: Number(data.usageMetadata.promptTokenCount) || 0,
              completion: Number(data.usageMetadata.candidatesTokenCount) || 0,
              total: Number(data.usageMetadata.totalTokenCount) || 0,
            }
          : undefined;
        if (tokens?.total) keyTokensUsed('gemini', key, tokens.total);
        return { reply: sanitizeAssistantOutput(text), via: `gemini/${model}`, tokens };
      }
    } catch (err) {
      console.warn(`[media] Gemini PDF [${model}] gagal:`, err);
    }
  }
  return null;
}

/**
 * Helper analisis PDF via OpenRouter (plugin `file-parser`, engine pdf-text).
 * Dipakai sebagai cadangan setelah Gemini: model free OpenRouter menerima
 * part `file` berisi PDF base64 dan memparsenya di sisi gateway.
 */
async function processPdfViaOpenRouter(
  buffer: Buffer,
  prompt: string,
  filename: string,
): Promise<{ reply: string; via: string; tokens?: { prompt: number; completion: number; total: number } } | null> {
  const keys = config.pools.openrouter;
  if (!keys || keys.length === 0) return null;

  for (const key of keys) {
    if (!(await isKeyAllowed('openrouter', key, config.dailyCap.openrouter))) continue;
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(config.timeoutMs),
        body: JSON.stringify({
          model: config.models.orPrimary,
          max_tokens: config.maxOutputTokens,
          // Thinking off (keputusan user): model free DeepSeek tetap menjawab bersih & cepat.
          reasoning: { effort: 'none' },
          plugins: [{ id: 'file-parser', pdf: { engine: 'pdf-text' } }],
          messages: [{
            role: 'user',
            content: [
              { type: 'file', file: { filename, file_data: `data:application/pdf;base64,${buffer.toString('base64')}` } },
              { type: 'text', text: prompt },
            ],
          }],
        }),
      });

      if (!res.ok) continue;
      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      };
      const text = data?.choices?.[0]?.message?.content?.trim();
      if (text) {
        keyUsed('openrouter', key);
        const tokens = data.usage
          ? {
              prompt: Number(data.usage.prompt_tokens) || 0,
              completion: Number(data.usage.completion_tokens) || 0,
              total: Number(data.usage.total_tokens) || 0,
            }
          : undefined;
        if (tokens?.total) keyTokensUsed('openrouter', key, tokens.total);
        return { reply: sanitizeAssistantOutput(text), via: `openrouter/${config.models.orPrimary}`, tokens };
      }
    } catch (err) {
      console.warn(`[media] OpenRouter PDF gagal:`, err);
    }
  }
  return null;
}

/**
 * Deteksi tipe MIME aktual dari magic bytes buffer untuk mencegah MIME spoofing (P1-10).
 */
export function sniffMimeType(buffer: Buffer): string | null {
  if (!buffer || buffer.length < 4) return null;
  // PDF: %PDF (0x25 0x50 0x44 0x46)
  if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
    return 'application/pdf';
  }
  // PNG: \x89PNG (0x89 0x50 0x4E 0x47)
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
    return 'image/png';
  }
  // JPEG: \xFF\xD8\xFF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  // WebP: RIFF....WEBP
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  // ZIP / Word .docx: PK\x03\x04
  if (buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04) {
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }
  // Ogg audio: OggS
  if (buffer.length >= 4 && buffer.toString('ascii', 0, 4) === 'OggS') {
    return 'audio/ogg';
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
  // Sniff magic bytes jika tersedia (D4 & E4)
  const sniffed = sniffMimeType(buffer);
  const effectiveMime = (sniffed || mime || '').toLowerCase();

  // Batasi ukuran dokumen maks 15MB untuk mencegah Lambda OOM
  if (buffer.length > 15 * 1024 * 1024) {
    console.warn(`[media] Dokumen ${filename} melebihi batas 15MB (${buffer.length} bytes). Ditolak.`);
    return null;
  }

  const lowerName = filename.toLowerCase();

  // Blokir berkas rahasia/sensitif agar tidak terekspos ke LLM
  if (
    lowerName.includes('.env') ||
    lowerName.endsWith('.key') ||
    lowerName.endsWith('.pem') ||
    lowerName.endsWith('.log')
  ) {
    console.warn(`[media] Percobaan membaca berkas sensitif diblokir: ${filename}`);
    return null;
  }

  // 1. Dokumen Microsoft Word (.docx) via parser Mammoth lokal (21 ms)
  if (
    effectiveMime.includes('wordprocessingml') ||
    effectiveMime.includes('msword') ||
    lowerName.endsWith('.docx')
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
  ];

  if (
    effectiveMime.startsWith('text/') ||
    effectiveMime.includes('json') ||
    effectiveMime.includes('javascript') ||
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
 * Ekstraksi gambar dari dokumen Word (.docx) via mammoth (convertImage → data URI).
 * Dipakai agar dokumen berisi gambar/screenshot ikut dianalisis rantai vision.
 * Batas: maksimal 3 gambar pertama, hanya raster, tiap gambar <= ~4MB base64.
 */
async function extractDocxImages(buffer: Buffer, max = 3): Promise<Array<{ base64: string; mime: string }>> {
  try {
    const result = await mammoth.convertToHtml(
      { buffer },
      {
        convertImage: mammoth.images.imgElement((image) =>
          image.read('base64').then((data) => ({ src: `data:${image.contentType};base64,${data}` })),
        ),
      },
    );
    const out: Array<{ base64: string; mime: string }> = [];
    const re = /src="data:([^;"]+);base64,([^"]+)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(result.value)) !== null && out.length < max) {
      const mime = m[1];
      // Hanya raster yang didukung model vision (lewati svg/emf/wmf)
      if (!/^image\/(png|jpe?g|webp|gif)/.test(mime)) continue;
      if (m[2].length > 5_500_000) continue; // ~4MB biner
      out.push({ mime, base64: m[2] });
    }
    return out;
  } catch (err) {
    console.warn('[media] Gagal ekstraksi gambar .docx via mammoth:', err);
    return [];
  }
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
): Promise<{ reply: string; via: string; tokens?: { prompt: number; completion: number; total: number } }> {
  const sniffed = sniffMimeType(buffer);
  const effectiveMime = (sniffed || mime || '').toLowerCase();
  const lowerName = filename.toLowerCase();

  // Kasus A: Dokumen PDF
  if (effectiveMime.includes('pdf') || lowerName.endsWith('.pdf')) {
    const prompt = caption && caption.trim()
      ? `Pengguna mengirim dokumen PDF "${filename}". Pertanyaan / instruksi temanmu:\n${caption.trim()}\n\nAturan: Jawab langsung to-the-point, jelas, dan manusiawi layaknya sahabat diskusi tanpa pembuka klise robotik.`
      : `Pengguna mengirim dokumen PDF "${filename}". Tolong baca dan rangkum inti terpentingnya secara ringkas, padat, dan ramah selayaknya teman ngobrol yang membantu meringkas isi dokumen dengan susunan kalimatmu sendiri (tanpa kalimat template hafalan).`;

    // 1. Gemini native PDF (model vision: 3.6 Flash > 3.5 Flash Lite > 2.5 Flash)
    for (const model of config.models.geminiVision) {
      const p = await processPdfViaGemini(buffer, prompt, model);
      if (p) return p;
    }

    // 2. Cadangan: OpenRouter plugin file-parser (engine pdf-text)
    const pOr = await processPdfViaOpenRouter(buffer, prompt, filename);
    if (pOr) return pOr;

    // 3. Parser Teks Lokal (Fallback): Ekstrak teks halaman PDF secara lokal lalu teruskan ke rantai teks utama
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
      return { reply: autoRes.reply, via: `local-parser/${autoRes.via}`, tokens: autoRes.tokens };
    }

    // Fallback terakhir: murni dinamis. ZERO teks statis — bila model juga mati,
    // balasan dibiarkan kosong dan platform tidak mengirim pesan apa pun.
    try {
      const gen = await autoReply(
        `Berkas PDF "${filename}" gagal diproses otomatis oleh modul visual. Beri tahu user dengan gayamu sendiri, singkat dan hangat, bahwa berkasnya diterima tapi sedang gagal dibaca, lalu tawarkan minta dia tanyakan bagian tertentu via teks.`,
        ctx,
      );
      if (gen.reply.trim()) return { reply: gen.reply, via: `dynamic-pdf-error/${gen.via}` };
    } catch {
      // diam
    }
    return { reply: '', via: 'pdf-unavailable' };
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

    // Jika .docx memuat gambar (screenshot/diagram), sertakan ke rantai vision agar
    // isi visualnya ikut dianalisis, bukan hanya teksnya.
    if (effectiveMime.includes('wordprocessingml') || lowerName.endsWith('.docx')) {
      const images = await extractDocxImages(buffer);
      if (images.length > 0) {
        try {
          const parts: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> = [
            { type: 'text', text: `${prompt}\n\nDokumen ini juga memuat ${images.length} gambar; analisis juga isi gambarnya.` },
            ...images.map((img) => ({
              type: 'image_url' as const,
              image_url: { url: `data:${img.mime};base64,${img.base64}` },
            })),
          ];
          const visionRes = await chat([{ role: 'user', content: parts }], { vision: true });
          if (visionRes.text.trim()) {
            return { reply: sanitizeAssistantOutput(visionRes.text), via: `docx-vision/${visionRes.via}`, tokens: visionRes.tokens };
          }
        } catch (err) {
          console.warn('[media] Analisis gambar .docx via vision gagal, lanjut teks saja:', err);
        }
      }
    }

    return await autoReply(prompt, ctx);
  }

  // Kasus C: Dokumen tidak didukung (misal biner terenkripsi) — murni dinamis, tanpa teks statis.
  try {
    const gen = await autoReply(
      `Berkas "${filename}" diterima tapi formatnya tidak bisa dibaca langsung. Beri tahu user dengan gayamu sendiri, singkat dan hangat, lalu sebutkan format yang didukung: PDF, Word (.docx), atau teks (.txt, .md, .csv, kode).`,
      ctx,
    );
    if (gen.reply.trim()) return { reply: gen.reply, via: `dynamic-unsupported/${gen.via}` };
  } catch {
    // diam
  }
  return { reply: '', via: 'unsupported-unavailable' };
}

/**
 * Memproses video (MP4 / WebM) via Google Gemini Multimodal API.
 * Cadangan: transkripsi trek audio (Groq/Cloudflare Whisper) lalu jawab dari teks
 * bila seluruh jalur video native gagal (video tetap bisa ditanggapi isinya).
 */
export async function processIncomingVideo(
  buffer: Buffer,
  mime: string = 'video/mp4',
  filename: string = 'video.mp4',
  caption?: string,
  ctx?: ChatContext,
): Promise<{ reply: string; via: string; tokens?: { prompt: number; completion: number; total: number } }> {
  const prompt = caption && caption.trim()
    ? `Pengguna mengirim video "${filename}". Pertanyaan / instruksi:\n${caption.trim()}\n\nAturan: Jawab langsung to-the-point, santai, dan alami tanpa kalimat pembuka robotik seperti "Video ini menampilkan...".`
    : `Pengguna mengirim video "${filename}". Tonton dan tanggapi kejadian atau suasana dalam video ini secara wajar, santai, dan seru layaknya teman yang baru saja menonton bersama. DILARANG membuka dengan "Video ini memperlihatkan...".`;

  const keys = config.pools.gemini;

  for (const model of config.models.geminiVision) {
    for (const key of keys) {
      if (!(await isKeyAllowed('gemini', key, config.dailyCap.gemini))) continue;
      try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(config.timeoutMs),
          body: JSON.stringify({
            contents: [{
              role: 'user',
              parts: [
                { inlineData: { mimeType: mime, data: buffer.toString('base64') } },
                { text: prompt }
              ]
            }],
            generationConfig: { temperature: 0.3, ...geminiThinkingConfig(model) }
          })
        });

        if (!res.ok) continue;
        const data = (await res.json()) as {
          candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
          usageMetadata?: {
            promptTokenCount?: number;
            candidatesTokenCount?: number;
            totalTokenCount?: number;
          };
        };
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        if (text) {
          // Catat pemakaian kuota Gemini (analisis video native memakai kuota provider yang sama)
          keyUsed('gemini', key);
          const tokens = data.usageMetadata
            ? {
                prompt: Number(data.usageMetadata.promptTokenCount) || 0,
                completion: Number(data.usageMetadata.candidatesTokenCount) || 0,
                total: Number(data.usageMetadata.totalTokenCount) || 0,
              }
            : undefined;
          if (tokens?.total) keyTokensUsed('gemini', key, tokens.total);
          return { reply: sanitizeAssistantOutput(text), via: `gemini/${model}`, tokens };
        }
      } catch (err) {
        console.warn(`[media] Video via Gemini [${model}] gagal:`, err);
      }
    }
  }

  // Cadangan: transkripsi trek audio video (Whisper menerima MP4/WebM) lalu jawab
  // dari transkripnya via rantai teks. Menjaga video tetap terproses saat seluruh
  // jalur video native (Gemini) gagal.
  try {
    const transcript = await transcribeAudio(buffer, mime);
    if (transcript && transcript.trim().length > 0) {
      const textPrompt = [
        `[TRANSKRIP AUDIO DARI VIDEO: "${filename}"]`,
        '--- ISI TRANSKRIP ---',
        transcript.slice(0, 20000),
        '--- AKHIR TRANSKRIP ---',
        '',
        caption && caption.trim()
          ? `Pertanyaan / instruksi temanmu tentang video ini: ${caption.trim()}`
          : 'Tolong tanggapi isi video ini secara wajar, santai, dan seru layaknya teman yang baru saja menonton bersama. Sebutkan bahwa kamu menangkap isinya dari suara video.',
      ].join('\n');
      const res = await autoReply(textPrompt, ctx);
      return { reply: res.reply, via: `transkrip-video/${res.via}`, tokens: res.tokens };
    }
  } catch {
    // lanjut ke fallback dinamis
  }

  // Fallback terakhir: murni dinamis. ZERO teks statis — bila model juga mati,
  // balasan dibiarkan kosong dan platform tidak mengirim pesan apa pun.
  try {
    const gen = await autoReply(
      `Video "${filename}" gagal dianalisis otomatis. Beri tahu user dengan gayamu sendiri, singkat dan hangat, bahwa videonya diterima tapi sedang gagal diproses, lalu minta dia kirim ulang sebentar lagi.`,
      ctx,
    );
    if (gen.reply.trim()) return { reply: gen.reply, via: `dynamic-video-error/${gen.via}` };
  } catch {
    // diam
  }
  return { reply: '', via: 'video-unavailable' };
}

/**
 * Memproses stiker WhatsApp atau Telegram (.webp) dan memahami konteks ekspresinya via Vision AI.
 */
export async function processIncomingSticker(
  buffer: Buffer,
  mime: string = 'image/webp',
  emoji?: string,
  ctx?: ChatContext,
): Promise<{ reply: string; via: string; tokens?: { prompt: number; completion: number; total: number } }> {
  const stickerCaption = emoji ? `(Emoji stiker: ${emoji})` : undefined;
  return await describeImage(buffer.toString('base64'), mime, stickerCaption, ctx);
}
