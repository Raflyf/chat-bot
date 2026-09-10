import { config } from './env.js';
import { chat, type ChatMsg, type ContentPart } from './providers.js';
import type { ChatContext } from './memory.js';

/** Satu-satunya pesan non-AI: hanya saat SEMUA provider mati total setelah retry. */
function statusDown(): string {
  return `Maaf kak, semua jalur AI sedang tidak bisa dihubungi (${new Date().toISOString()}). Pesan kakak tidak hilang, silakan kirim ulang sebentar lagi.`;
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function redactOutput(text: string): string {
  return text
    .replace(/sk-[a-zA-Z0-9_-]{20,}/g, '[REDACTED_KEY]')
    .replace(/sbp_[a-zA-Z0-9_-]{20,}/g, '[REDACTED_KEY]')
    .replace(/bot\d+:[A-Za-z0-9_-]{30,}/g, '[REDACTED_BOT_TOKEN]');
}

/**
 * Pembersih Kebisingan & Formatter Ramah Telegram:
 * 1. Menyingkirkan seluruh residu CoT (<think>, <thought>, unclosed think, Here's a thinking process).
 * 2. Mengonversi ekspresi LaTeX mentah (\[...\], \(...\), $$, $) menjadi notasi aljabar bersih dan simbol Unicode.
 * 3. Menghapus kebocoran kredensial dan bot token (redaction).
 */
export function cleanMathAndNoise(text: string): string {
  if (!text || typeof text !== 'string') return '';

  let out = text;

  // 1. Hapus tag <think>...</think> atau <thought>...</thought> yang tertutup
  out = out.replace(/<(?:think|thought)>[\s\S]*?<\/(?:think|thought)>/gi, '').trim();

  // 2. Jika ada tag <think> tanpa penutup:
  if (/^\s*<(?:think|thought)>/i.test(out)) {
    const match = out.match(
      /\n(?=(?:```|#{1,4}\s+|Berikut|Fungsi|Untuk|Solusi|Jawaban|Langkah|Tentu|Mari|Dalam|Kita|Halo|Implementasi|Jadi|Kesimpulan|Diketahui|Perhitungan))/i,
    );
    if (match && match.index !== undefined && match.index > 0) {
      out = out.slice(match.index).trim();
    } else {
      out = out.replace(/^\s*<(?:think|thought)>/i, '').trim();
    }
  }

  // 3. Hapus monolog "Here's a thinking process:" atau "Thinking Process:"
  if (/^\s*(?:Here(?:'s| is) (?:a )?thinking process:?|Thinking Process:?)/i.test(out)) {
    const match = out.match(
      /\n(?=(?:```|#{1,4}\s+|Berikut|Fungsi|Untuk|Solusi|Jawaban|Langkah|Tentu|Mari|Dalam|Kita|Halo|Implementasi|Jadi|Kesimpulan|Diketahui|Perhitungan))/i,
    );
    if (match && match.index !== undefined && match.index > 0) {
      out = out.slice(match.index).trim();
    } else {
      // Jika model terpotong sebelum transisi, buang header thinking dan blok analisis awal
      out = out.replace(/^\s*(?:Here(?:'s| is) (?:a )?thinking process:?|Thinking Process:?)\s*/i, '');
      out = out.replace(
        /^\s*(?:(?:\d+\.|\*|-)\s+\*\*[^*]+\*\*[\s\S]*?)+(?=\n\s*(?:Perhitungan|Berikut|Solusi|Jawaban|Langkah|Jadi|Diketahui|S²|[A-Z][a-z]+:))/i,
        '',
      );
      out = out.trim();
    }
  }

  // 4. Jika ada butir thinking tersisa di awal (misal: 1. **Analyze User Input:** ...)
  if (
    /^\s*(?:(?:1\.|2\.|3\.|4\.|5\.|\*)\s+\*\*(?:Analyze|Identify|Extract|Solve|Check|Verify|Think|Approach)[^*]*\*\*)/i.test(
      out,
    )
  ) {
    const match = out.match(
      /\n(?=(?:```|#{1,4}\s+|Berikut|Fungsi|Untuk|Solusi|Jawaban|Langkah|Tentu|Mari|Dalam|Kita|Halo|Implementasi|Jadi|Kesimpulan|Diketahui|Perhitungan))/i,
    );
    if (match && match.index !== undefined && match.index > 0) {
      out = out.slice(match.index).trim();
    }
  }
  out = out.replace(/^\s*---\s*\n/g, '');

  // 3. Konversi LaTeX Block Math: \[ ... \] atau $$ ... $$
  out = out.replace(/\\\[\s*([\s\S]*?)\s*\\\]/g, (_, eq) => `\n${eq.trim()}\n`);
  out = out.replace(/\$\$\s*([\s\S]*?)\s*\$\$/g, (_, eq) => `\n${eq.trim()}\n`);

  // 4. Konversi LaTeX Inline Math: \( ... \) atau $ ... $
  out = out.replace(/\\\(\s*([\s\S]*?)\s*\\\)/g, (_, eq) => eq.trim());
  out = out.replace(/(^|[\s(*_~])\$([^\$\n]+?)\$(?=[\s.,!?)\]:;*_~]|$)/g, '$1$2');

  // 5. Translasi fungsi & operator matematika LaTeX ke simbol teks / Unicode bersih
  const replacements: Array<[RegExp, string]> = [
    [/\\log\b/g, 'log'],
    [/\\ln\b/g, 'ln'],
    [/\\sin\b/g, 'sin'],
    [/\\cos\b/g, 'cos'],
    [/\\tan\b/g, 'tan'],
    [/\\sec\b/g, 'sec'],
    [/\\csc\b/g, 'csc'],
    [/\\cot\b/g, 'cot'],
    [/\\lim\b/g, 'lim'],
    [/\\max\b/g, 'max'],
    [/\\min\b/g, 'min'],
    [/\\det\b/g, 'det'],
    [/\\exp\b/g, 'exp'],
    [/\\implies|\\Rightarrow/g, '⇒'],
    [/\\iff|\\Leftrightarrow/g, '⇔'],
    [/\\rightarrow|\\to/g, '→'],
    [/\\pm/g, '±'],
    [/\\mp/g, '∓'],
    [/\\times/g, '×'],
    [/\\cdot/g, '·'],
    [/\\div/g, '÷'],
    [/\\le\b|\\leq\b/g, '≤'],
    [/\\ge\b|\\geq\b/g, '≥'],
    [/\\ne\b|\\neq\b/g, '≠'],
    [/\\approx/g, '≈'],
    [/\\equiv/g, '≡'],
    [/\\infty/g, '∞'],
    [/\\in\b/g, '∈'],
    [/\\notin\b/g, '∉'],
    [/\\subset\b/g, '⊂'],
    [/\\cup\b/g, '∪'],
    [/\\cap\b/g, '∩'],
    [/\\forall\b/g, '∀'],
    [/\\exists\b/g, '∃'],
    [/\\sum\b/g, '∑'],
    [/\\prod\b/g, '∏'],
    [/\\int\b/g, '∫'],
    [/\\pi\b/g, 'π'],
    [/\\theta\b/g, 'θ'],
    [/\\alpha\b/g, 'α'],
    [/\\beta\b/g, 'β'],
    [/\\gamma\b/g, 'γ'],
    [/\\Delta\b/g, 'Δ'],
    [/\\delta\b/g, 'δ'],
    [/\\lambda\b/g, 'λ'],
    [/\\sigma\b/g, 'σ'],
    [/\\omega\b/g, 'ω'],
    [/\\quad|\\qquad/g, '  '],
    [/\\left\(/g, '('],
    [/\\right\)/g, ')'],
    [/\\left\[/g, '['],
    [/\\right\]/g, ']'],
    [/\\left\\\{/g, '{'],
    [/\\right\\\}/g, '}'],
    [/\\left\|/g, '|'],
    [/\\right\|/g, '|'],
    [/\\text\{([^}]+)\}/g, '$1'],
    [/\\mathbf\{([^}]+)\}/g, '$1'],
    [/\\mathit\{([^}]+)\}/g, '$1'],
    [/\\mathrm\{([^}]+)\}/g, '$1'],
  ];

  for (const [pattern, repl] of replacements) {
    out = out.replace(pattern, repl);
  }

  // Sederhanakan \frac{a}{b} (mendukung kurung kurawal bersarang 1-2 tingkat)
  const fracRegex = /\\frac\s*\{((?:[^{}]|\{[^{}]*\})*)\}\s*\{((?:[^{}]|\{[^{}]*\})*)\}/g;
  let prevText: string;
  do {
    prevText = out;
    out = out.replace(fracRegex, '($1 / $2)');
  } while (out !== prevText);
  out = out.replace(/\\frac\s*\{((?:[^{}]|\{[^{}]*\})*)\}\s*([a-zA-Z0-9]+)/g, '($1 / $2)');
  out = out.replace(/\\frac\s+([a-zA-Z0-9]+)\s+([a-zA-Z0-9]+)/g, '($1 / $2)');
  out = out.replace(/\\frac\b/g, '');

  // Sederhanakan \sqrt{x}
  out = out.replace(/\\sqrt\[([^{}]+)\]\{([^{}]+)\}/g, '$1√($2)');
  out = out.replace(/\\sqrt\{([^{}]+)\}/g, '√($1)');

  // Konversi superskrip sederhana: x^2 -> x², x^3 -> x³, x^n -> xⁿ
  const supMap: Record<string, string> = {
    '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴',
    '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
    '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾',
    'n': 'ⁿ', 'i': 'ⁱ', 'x': 'ˣ', 'y': 'ʸ',
  };
  out = out.replace(/\^\{([0-9n+\-()]+)\}/g, (_, p1) => {
    return p1.split('').map((c: string) => supMap[c] || c).join('');
  });
  out = out.replace(/\^([0-9n])/g, (_, p1) => supMap[p1] || `^${p1}`);

  // 6. Hapus seluruh emoji / emotikon / simbol grafis dekoratif (Zero Emoji Mutlak)
  const emojiPattern =
    /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{200D}\u{20E3}\u{2B50}\u{2B55}\u{3030}\u{303D}\u{3297}\u{3299}]/gu;
  out = out.replace(emojiPattern, '');

  // 7. Konversi Markdown Heading (### / ## / #) menjadi Bold WhatsApp (*Heading*)
  out = out.replace(/^\s*#{1,6}\s+(.+)$/gm, '*$1*');

  // 8. Normalisasi Markdown Bold (**teks** / ***teks***) menjadi Bold WhatsApp (*teks*)
  out = out.replace(/\*\*\*(.*?)\*\*\*/g, '*$1*');
  out = out.replace(/\*\*(.*?)\*\*/g, '*$1*');

  // 9. Bersihkan format bullet list yang berantakan (*   *teks* -> - *teks*)
  out = out.replace(/^\s*[\*\•]\s+/gm, '- ');

  // 10. Perbaiki asteris menggantung/tanpa pasangan pada setiap baris
  out = out
    .split('\n')
    .map((line) => {
      const asterisks = (line.match(/\*/g) || []).length;
      if (asterisks % 2 !== 0) {
        // Hapus asteris yang berdiri sendiri di depan kata tanpa penutup
        return line.replace(/(^|\s)\*([a-zA-Z0-9_-]+)(?=[,\s\.;:\?!]|$)/g, '$1$2');
      }
      return line;
    })
    .join('\n');

  // 11. Sederhanakan spasi ganda dan baris kosong berlebihan
  out = out.replace(/[ \t]{2,}/g, ' ');
  out = out.replace(/\n{3,}/g, '\n\n').trim();

  return out;
}

export function sanitizeAssistantOutput(text: string): string {
  const cleaned = cleanMathAndNoise(text);
  return redactOutput(cleaned);
}

function systemPrompt(): string {
  return [
    'IDENTITAS & FILOSOFI UTAMA:',
    `- Nama kamu adalah ${config.botName}.`,
    `- Kamu adalah teman sekaligus asisten AI serbaguna yang hidup di WhatsApp dan Telegram, diciptakan dan dikembangkan oleh Rafly Firmansyah.`,
    `- Jika pengguna menanyakan siapa pembuatmu, siapa penciptamu, atau siapa pengembangmu, jawab dengan santun dan jelas bahwa kamu dibuat dan dikembangkan oleh Rafly Firmansyah.`,
    `- Kamu memiliki kecerdasan emosional tinggi (EQ) setara dengan kecerdasan logika (IQ). Kamu fleksibel dan mampu menyesuaikan nada bicara (tone chameleon) dengan situasi dan suasana hati pengguna.`,
    `Tanggal hari ini: ${todayStr()}.`,
    '',
    'PRINSIP ADAPTABILITAS NADA & SUASANA HATI (EMOTIONAL INTELLIGENCE):',
    '1. KETIKA PENGGUNA CURHAT / SEDIH / PATAH HATI / GUNDAH:',
    '   - Bersikaplah sebagai sahabat dekat yang hangat, berempati tulus, menenangkan, dan mendengarkan dengan sepenuh hati.',
    '   - Gunakan bahasa yang lembut, manusiawi, dan tulus. Bikin hati pengguna merasa didengar, dipahami, dan ditemani.',
    '   - DILARANG KERAS bersikap kaku, menggurui, atau berbicara seperti robot/makalah medis (jangan pernah berkata "Sebagai asisten yang analitis", "Menurut neurosains kortisol...", atau menyodorkan 5 langkah strategi kaku pada orang yang sedang hancur hatinya).',
    '   - Berikan kenyamanan, validasi rasa sakitnya secara natural, dan tanyakan perasaannya dengan tulus layaknya teman baik.',
    '2. KETIKA OBROLAN SANTAI / KASUAL / BERCANDA:',
    '   - Gunakan gaya bahasa yang luwes, akrab, santai, dan asyik selayaknya mengobrol dengan teman karib.',
    '3. KETIKA TUGAS TEKNIS / KODING / SAINS / MATEMATIKA / BISNIS:',
    '   - Beralihlah menjadi profesional andal: presisi, logis, solutif, aman, type-safe, dan efisien tanpa berbelit-belit.',
    '4. KETIKA BUTUH DATA FAKTUAL / BERITA:',
    '   - Manfaatkan data real-time penelusuran web terkini tahun 2026 secara akurat.',
    '',
    'ATURAN FORMAT & INTEGRITAS:',
    '- NOL EMOJI: Jangan menggunakan emoji atau simbol dekoratif (kehangatan dan empati disampaikan lewat ketulusan diksi kata, bukan ikon grafis).',
    '- FORMAT RAPI WHATSAPP: Dilarang menggunakan heading pagar markdown (#, ##, ###). Untuk penekanan atau judul, gunakan teks tebal berpasangan (*teks*). Gunakan tanda strip (- ) atau angka untuk daftar.',
    '- HINDARI KLISE ROBOTIK: Dilarang memakai frasa "Sebagai AI", "Sebagai asisten", atau template kaku lainnya. Jadilah partner diskusi yang hidup dan natural.',
    '- DILARANG menampilkan coretan monolog internal atau tag <think>.',
  ].join('\n');
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Coba chat dengan failover chain; retry singkat 1.5 dtk jika seluruh chain pertama gagal. */
async function chatRetry(messages: ChatMsg[], vision: boolean): Promise<{ text: string; via: string }> {
  try {
    return await chat(messages, { vision });
  } catch {
    await wait(1500);
    return await chat(messages, { vision });
  }
}

function buildMessages(clean: string, ctx?: ChatContext, web?: string | null): ChatMsg[] {
  const messages: ChatMsg[] = [{ role: 'system', content: systemPrompt() }];
  if (ctx?.summary) messages.push({ role: 'user', content: `[Ringkasan percakapan lalu: ${ctx.summary}]` });
  if (ctx?.corrections.length) {
    messages.push({ role: 'user', content: `[Koreksi tersimpan darimu, wajib dipatuhi: ${ctx.corrections.join(' | ')}]` });
  }
  for (const h of ctx?.history.slice(-10) ?? []) messages.push(h);
  if (web) {
    messages.push({
      role: 'user',
      content: `[FAKTA & HASIL PENELUSURAN WEB REAL-TIME]:\n${web.slice(0, 4500)}\n\n[PANDUAN SINTESIS]: Gunakan fakta internet di atas sebagai sumber kebenaran tertinggi saat ini untuk menjawab pesan user. Jika user meminta berita hari ini, rangkumkan berita di atas secara terstruktur (Nasional & Internasional). Dilarang mengaku tidak punya akses internet atau tidak punya akses berita!`,
    });
  }
  messages.push({ role: 'user', content: `<user_message>${clean}</user_message>` });
  return messages;
}

/** Balas pesan teks apa pun secara dinamis. Eskalasi hanya jika semua provider mati. */
export async function autoReply(
  userText: string,
  ctx?: ChatContext,
  web?: string | null,
): Promise<{ reply: string; escalate: boolean; via: string }> {
  const clean = userText.trim().slice(0, 3000);
  if (!clean) return { reply: statusDown(), escalate: true, via: 'empty' };
  try {
    const { text, via } = await chatRetry(buildMessages(clean, ctx, web), false);
    return { reply: sanitizeAssistantOutput(text), escalate: false, via };
  } catch {
    return { reply: statusDown(), escalate: true, via: 'failed' };
  }
}

/** Jelaskan gambar secara dinamis via model vision. Caption opsional dari user. */
export async function describeImage(
  base64: string,
  mime: string,
  caption?: string,
): Promise<{ reply: string; via: string }> {
  const parts: ContentPart[] = [
    {
      type: 'image_url',
      image_url: { url: `data:${mime};base64,${base64}` },
    },
    {
      type: 'text',
      text: caption?.trim()
        ? `Pertanyaan user tentang gambar ini: ${caption.trim().slice(0, 800)}`
        : 'Jelaskan isi gambar ini secara jelas, informatif, dan terstruktur dalam Bahasa Indonesia.',
    },
  ];
  const messages: ChatMsg[] = [
    { role: 'system', content: systemPrompt() },
    { role: 'user', content: parts },
  ];
  const { text, via } = await chatRetry(messages, true);
  return { reply: sanitizeAssistantOutput(text), via };
}
