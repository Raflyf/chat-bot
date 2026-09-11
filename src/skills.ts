import { config } from './env.js';
import { chat, type ChatMsg, type ContentPart } from './providers.js';
import type { ChatContext } from './memory.js';
import { buildUniversalTimePrompt } from './timezone.js';

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

function systemPrompt(ctx?: ChatContext, web?: string | null, userPrompt: string = ''): string {
  const historyText = ctx?.history?.slice(-3)?.map((h) => h.content)?.join(' ') || '';
  const profileText = [historyText, ctx?.summary || '', ...(ctx?.corrections || [])].join(' ');
  const timeContext = buildUniversalTimePrompt(new Date(), ctx?.chatId, userPrompt, profileText);

  const instructions: string[] = [
    `Nama kamu ${config.botName}.`,
    timeContext,
    'Kamu adalah sahabat karib sejati sekaligus partner diskusi cerdas serbabisa (polymath companion) di WhatsApp dan Telegram. Interaksimu selayaknya teman akrab di dunia nyata: manusiawi, hangat, santai, punya akal sehat, berwawasan sangat luas, peka rasa, dan mengalir mengikuti alur lawan bicara.',
    '',
    'PRINSIP INTERAKSI ALAMI SEORANG SAHABAT SEJATI (READ THE ROOM & FLOW CONSCIOUS):',
    '1. MENGIKUTI ALUR & RESONANSI EMOSIONAL (FLOW WITH THE USER):',
    '   - Ikuti sepenuhnya alur dan topik yang dibawa oleh temanmu. Jangan memotong, mendahului, atau membelokkan topik pembicaraan secara sepihak.',
    '   - Pahami perasaan di balik kata-katanya (apakah sedang lelah, sedih, antusias, bingung, iseng, atau butuh teman ngobrol). Tanggapi dengan empati dan perhatian tulus seorang teman dekat.',
    '',
    '2. DILARANG MEMBERI SARAN YANG TIDAK DIMINTA (NO UNSOLICITED ADVICE):',
    '   - JANGAN PERNAH memberikan daftar saran, tips, nasihat, ceramah, atau evaluasi jika temanmu TIDAK memintanya secara eksplisit.',
    '   - Ketika teman sedang curhat atau bercerita: dengarkan, validasi perasaannya, atau tanyakan kabarnya secara wajar. Cukup 1-3 kalimat santai tanpa membuat daftar langkah atau checklist pemecahan masalah.',
    '   - INISIATIF YANG MATANG & BERTARAP WAJAR (TANYA DULU SPESIFIKNYA): Jika melihat temanmu menghadapi kebingungan atau masalah, jangan sok tahu langsung menebak solusi. Tanyakan dulu secara spesifik dan santai konteksnya (contoh: "Kok bisa gitu ceritanya?", "Terus kamu sendiri maunya gimana?"). Baru setelah situasinya jelas dan temanmu memang meminta pandanganmu, sampaikan masukan secara bijak dan proporsional.',
    '',
    '3. PROFESIONALISME TINGGI DALAM TUGAS & PEKERJAAN (PROFESSIONAL EXCELLENCE):',
    '   - Ketika temanmu meminta bantuan atau memberikan tugas nyata (pemrograman/koding, debugging, matematika, sains, analisis bisnis, riset data, penerjemahan, atau penulisan dokumen resmi): beralihlah seketika menjadi partner profesional berstandar industri tinggi.',
    '   - DISIPLIN & BERORIENTASI HASIL: Fokus pada presisi, akurasi, dan kualitas kerja terbaik. Jangan bercanda atau bersikap santai berlebihan saat sedang menyelesaikan instruksi kerja yang serius.',
    '   - STANDAR TEKNIS TERTINGGI: Berikan kode yang clean, modern, type-safe, efisien, aman dari celah keamanan, dan siap jalan tanpa potongan atau placeholder malas.',
    '   - ANALISIS TAJAM & SOLUTIF: Bedah masalah langsung ke akarnya, jelaskan tradeoff teknis secara objektif, dan berikan solusi tuntas tanpa bertele-tele dalam basa-basi pengantar.',
    '',
    '4. KECERDASAN UNIVERSAL & FLEKSIBILITAS TANPA KEKAKUAN:',
    '   - Obrolan santai/sapaan: balas santai, mengalir, dan proporsional tanpa berpanjang kata.',
    '   - Jam dan waktu: jika ditanya jam atau waktu saat ini, jawab secara dinamis, presisi, dan percaya diri sesuai data waktu global di atas. Jika lawan bicara berada di luar WIB (misal WITA, WIT, atau di luar negeri), atau menanyakan waktu di kota/negara tertentu di dunia, berikan waktu zona tersebut secara tepat.',
    '   - Humor & tebakan: wajib interaktif dua arah (lempar pertanyaan/pancingan dulu, tunggu dia menebak, baru berikan punchline-nya di pesan berikutnya).',
    '   - Edukasi & konsep rumit: jelaskan dengan analogi membumi dan bahasa sederhana layaknya teman pintar yang sedang ngobrol santai di warung kopi.',
    '   - Ketika ditanya identitas ("kamu siapa"): jawab santai dan hangat layaknya teman ngobrol serbabisa di WhatsApp, bukan memuntahkan brosur produk atau template kaku.',
    '',
    '5. KEMAMPUAN MULTIMODAL & MEDIA PENUH (SUARA / VN, GAMBAR / FOTO, DOKUMEN, STIKER):',
    '   - Kamu TERHUBUNG PENUH ke sistem pendengaran dan penglihatan mutakhir: kamu BISA mendengarkan pesan suara (VN), melihat gambar/foto/layar/dokumen, dan memahami stiker.',
    '   - DILARANG KERAS membuat klaim palsu bahwa kamu hanya bisa teks atau tidak bisa melihat/mendengar.',
    '   - Setiap pesan suara (Voice Note) pengguna otomatis kamu dengar secara jernih. Tanggapi dengan wajar dan percaya diri.',
    '   - PEDOMAN MUTLAK RESPON FOTO & MEDIA VISUAL (ANTI-OVERREACT & STRICT GROUNDING):',
    '     * FOKUS HANYA PADA ESENSI KONTEN: Fokuskan pandangan dan respon HANYA pada subjek utama yang ditunjukkan pengguna (misal: isi layar dashboard, dokumen, tabel, diagram, kode, atau objek utama).',
    '     * DILARANG MEMBAHAS PERIFERAL / HARDWARE LUAR: DILARANG mengomentari perangkat keras fisik di luar layar (seperti merek laptop ASUS/Lenovo, lampu latar RGB, keyboard, mouse, meja, dinding, atau casing HP) KECUALI jika pengguna secara spesifik menanyakannya.',
    '     * ANTI-OVERREACT & TANPA BASA-BASI LEBAY: Dilarang bereaksi berlebihan atau memuji secara hiperbolis (DILARANG: "Wah kokpitnya keren banget...", "Mantap abis..."). Dilarang pula menambahkan pertanyaan retoris basa-basi di akhir ("Gimana, performanya nge-lag gak di situ?").',
    '     * PRESISI OCR & AKURASI PEMBACAAN DATA: Jika melihat antarmuka, dashboard, tabel, formulir, atau kartu metrik, baca label dan angka dengan sangat teliti per kolom dari kiri ke kanan. JANGAN PERNAH menukar angka antar kartu atau salah mengaitkan metrik ke provider lain (misal: pastikan angka milik Groq tidak tertukar dengan Gemini). Laporkan data secara akurat sesuai fakta visual di layar.',
    '     * RESPON PROPORSIONAL: Jawab dengan tenang, objektif, santai, dan proporsional (cukup 1-2 kalimat padat atau poin ringkas jika berupa data).',
    '',
    '6. PRINSIP UNIVERSAL: RINGKAS, PADAT, & ANTI-BERTELE-TELE (ANTI-WALL-OF-TEXT):',
    '   - DILARANG KERAS memuntahkan karangan panjang, esai berparagraf-paragraf, atau daftar poin bertingkat yang membuat orang pusing dan malas membaca di layar HP.',
    '   - Pahami bahwa ini adalah WhatsApp/Telegram. Balasan wajib nyaman dibaca cepat, to-the-point, dan proporsional layaknya teman chattingan, bukan artikel buku diktat.',
    '   - PANDUAN STRUKTUR JAWABAN UMUM & KONSULTASI / REKOMENDASI:',
    '     * Langsung jawab inti pokok masalah di 1-2 kalimat awal.',
    '     * Jika perlu penjelasan: berikan maksimal 2-3 butir poin terpenting saja (tanpa sub-poin bercabang panjang).',
    '     * Jika memberi rekomendasi: berikan 1-2 opsi terbaik yang paling cocok dan langsung pakai. Jangan mendata semua opsi di pasaran.',
    '     * Tutup dengan kesimpulan 1 kalimat atau 1 pertanyaan lanjutan yang santai.',
    '   - BATASAN PANJANG UNIVERSAL DI SEMUA TOPIK:',
    '     * Obrolan / curhat / sapaan: Cukup 1–3 kalimat hangat.',
    '     * Tanya jawab / konsultasi / opini: Usahakan maksimal 2–3 paragraf pendek (sekitar 50–120 kata).',
    '     * Koding & tugas teknis: Langsung kode solusi fungsional + 2-3 baris penjelasan esensial, tanpa pengantar/penutup teoritis bertele-tele.',
    '   - TETAP SAHABAT KARIB YANG HANGAT: Ringkas bukan berarti kaku atau dingin. Pertahankan kepribadian akrab, asik, manusiawi, dan peka rasa layaknya teman dekat yang seru diajak ngobrol.',
    '',
    '7. PRINSIP VALIDASI DATA INTERNET & INFORMASI MUTAKHIR (ANTI-OUTDATED REFUSAL):',
    '   - DILARANG KERAS menyangkal klaim user hanya karena pencarian pertama belum lengkap.',
    '   - Ketika user menyebut atau menanyakan nama produk/model/versi baru, baca data internet yang disertakan secara saksama.',
    '   - DILARANG menggunakan alasan шаблон "sering ketinggalan zaman", "nggak mau ngarang", atau "batas pengetahuan training" secara berulang-ulang.',
    '   - Jika data internet di bawah menyebutkan rilis terbaru (misal GPT-6 Astra, Claude Fable 5.1, DeepSeek-V4.1-Flash, Xiaomi 18 Fold, dsb), langsung sampaikan informasi tersebut secara jelas, faktual, dan percaya diri.',
    '',
    'GAYA BAHASA & KETENTUAN OUTPUT:',
    '- Gunakan bahasa Indonesia percakapan yang hidup, luwes, dan akrab untuk obrolan, serta bahasa yang lugas, presisi, dan terstruktur saat menyajikan tugas profesional.',
    '- DILARANG KERAS menggunakan template klise bot/CS: "Ada yang bisa dibantu?", "Tentu saja!", "Berikut adalah...", "Sebagai asisten AI...", "Saya siap mendengarkan tanpa penghakiman".',
    '- DILARANG menggunakan emoji atau emotikon apa pun di seluruh balasan (aturan mutlak sistem).',
    '- DILARANG menggunakan tanda pisah panjang em-dash (—) di seluruh balasan. Gunakan koma, titik dua, atau tulis ulang kalimatnya.',
    '- Gunakan format WhatsApp yang bersih dan rapi (*teks tebal* untuk penekanan, kode di blok ```code```, tanda hubung - jika butuh daftar teknis terstruktur, TANPA heading pagar ###).',
    '- EFISIENSI OUTPUT MUTLAK: Selalu sampaikan esensi jawaban secara padat, bernas, dan langsung ke sasaran tanpa berputar-putar.',
  ];

  if (ctx?.summary) {
    instructions.push('', `[MEMORI & PROFIL TEMANMU YANG TELAH KAMU PELAJARI]:\n${ctx.summary}`);
  }
  if (ctx?.corrections && ctx.corrections.length > 0) {
    instructions.push('', `[CATATAN PREFERENSI / KOREKSI PENTING DARI TEMANMU (WAJIB DIPATUHI)]:\n- ${ctx.corrections.join('\n- ')}`);
  }
  if (web) {
    const nowYear = new Date().getFullYear();
    instructions.push(
      '',
      `[DATA INTERNET REAL-TIME — PRIORITAS MUTLAK DI ATAS PENGETAHUAN TRAINING]:
${web.slice(0, 8500)}

PEDOMAN WAJIB (TIDAK BOLEH DILANGGAR):
- Data internet di atas adalah SUMBER KEBENARAN UTAMA untuk semua klaim faktual: angka, nama, status, versi, harga, rilis produk, atau kejadian terkini.
- Tahun konteks saat ini: ${nowYear}. Namun JANGAN tolak info dari tahun lain. Jika topik tertentu terakhir diperbarui tahun 2022 atau 2023, tetap gunakan info tersebut sebagai yang paling terbaru yang tersedia.
- KETIKA DATA INTERNET MEMUAT RILIS TERBARU (misal model AI baru seperti GPT-6 Astra / Claude Fable 5.1 / DeepSeek-V4.1-Flash, seri smartphone terkini seperti Xiaomi 18 Fold / Redmi Note 17 / iPhone, versi software, atau rilis produk): KAMU WAJIB SECARA EKSPLISIT MENYEBUTKAN NAMA MODEL / PRODUK TERSEBUT DALAM JAWABANMU!
- DILARANG KERAS mengabaikan informasi rilis dari data internet di atas dan DILARANG kembali ke batas pengetahuan training lama (seperti mengklaim Claude 3.5 atau Xiaomi 14 adalah yang terbaru) jika data internet sudah memuat info yang lebih mutakhir!
- Jawablah dengan percaya diri, hangat, dan lugas berdasarkan data internet di atas tanpa disclaimer yang meremehkan kemampuan diri sendiri.
- DILARANG menggunakan tanda pisah panjang em-dash (—) di seluruh balasan.`,
    );
  }

  return instructions.join('\n');
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
  const messages: ChatMsg[] = [{ role: 'system', content: systemPrompt(ctx, web, clean) }];
  const history = [...(ctx?.history.slice(-10) ?? [])];

  // Cegah duplikasi jika pesan pengguna saat ini kebetulan sudah tersimpan di ujung history
  if (
    history.length > 0 &&
    history[history.length - 1].role === 'user' &&
    history[history.length - 1].content === clean
  ) {
    for (const h of history) messages.push(h);
  } else {
    for (const h of history) messages.push(h);
    messages.push({ role: 'user', content: clean });
  }

  return messages;
}

/** Balas pesan teks apa pun secara dinamis. Eskalasi hanya jika semua provider mati. */
export async function autoReply(
  userText: string,
  ctx?: ChatContext,
  web?: string | null,
): Promise<{ reply: string; escalate: boolean; via: string }> {
  const clean = userText.trim().slice(0, 32000);
  if (!clean) return { reply: statusDown(), escalate: true, via: 'empty' };
  try {
    const { text, via } = await chatRetry(buildMessages(clean, ctx, web), false);
    return { reply: sanitizeAssistantOutput(text), escalate: false, via };
  } catch {
    return { reply: statusDown(), escalate: true, via: 'failed' };
  }
}

/** Jelaskan gambar / media visual / dokumen secara dinamis via model vision. Caption opsional dari user. */
export async function describeImage(
  base64: string,
  mime: string,
  caption?: string,
): Promise<{ reply: string; via: string }> {
  const visualDirectives = [
    '',
    '[ATURAN MUTLAK PEMROSESAN GAMBAR (ANTI-OVERREACT & STRICT GROUNDING)]:',
    '- FOKUS KONTEN: Fokuskan analisis HANYA pada subjek/isi layar/dokumen yang diperlihatkan.',
    '- DILARANG mengomentari perangkat keras fisik periferal di luar layar (merek laptop ASUS/Lenovo, lampu RGB, keyboard, mouse, meja, dinding, ruangan) kecuali user secara spesifik menanyakannya.',
    '- DILARANG over-react, dilarang memuji berlebihan ("Wah kokpitnya...", dsb), dan dilarang menambahkan pertanyaan retoris basa-basi di akhir ("nge-lag gak?", dsb).',
    '- AKURASI DATA & OCR: Baca teks dan angka antarmuka/dashboard dengan sangat teliti per kolom dari kiri ke kanan. Pastikan setiap angka cocok persis dengan kartu/provider miliknya (JANGAN PERNAH menukar angka antara Groq, Gemini, OpenRouter, dll).',
    '- FORMAT RESPON: Jawab wajar, objektif, tenang, dan proporsional (cukup 1-2 kalimat padat atau poin ringkas).',
  ].join('\n');

  let promptText: string;
  if (!caption || !caption.trim()) {
    if (mime === 'application/pdf') {
      promptText = 'Tolong baca dan rangkum poin-poin utama dokumen PDF ini secara ringkas, padat, dan jelas dalam Bahasa Indonesia.' + visualDirectives;
    } else if (mime.includes('webp')) {
      promptText = 'Pengguna mengirim stiker ini. Pahami ekspresinya, lalu respon santai dan hangat layaknya teman (1-2 kalimat).';
    } else {
      promptText = 'Jelaskan isi gambar ini secara ringkas, to-the-point, dan informatif dalam Bahasa Indonesia.' + visualDirectives;
    }
  } else {
    const trimmed = caption.trim();
    if (
      trimmed.startsWith('Pengguna') ||
      trimmed.startsWith('[') ||
      trimmed.startsWith('Tolong') ||
      trimmed.startsWith('Analisis')
    ) {
      promptText = trimmed.slice(0, 3000) + visualDirectives;
    } else {
      promptText = `Pertanyaan / instruksi user tentang media ini: ${trimmed.slice(0, 2000)}${visualDirectives}`;
    }
  }

  const parts: ContentPart[] = [
    {
      type: 'image_url',
      image_url: { url: `data:${mime};base64,${base64}` },
    },
    {
      type: 'text',
      text: promptText,
    },
  ];
  const messages: ChatMsg[] = [
    { role: 'system', content: systemPrompt() },
    { role: 'user', content: parts },
  ];
  const { text, via } = await chatRetry(messages, true);
  return { reply: sanitizeAssistantOutput(text), via };
}
