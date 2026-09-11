import { config } from './env.js';
import { chat, type ChatMsg, type ContentPart } from './providers.js';
import { saveCorrection, type ChatContext } from './memory.js';
import { buildUniversalTimePrompt, detectUserLocationDeclaration } from './timezone.js';

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

  // 6. Batasi penggunaan emoji agar tidak berlebihan (maksimal 1 emoji, hapus emoji robot)
  out = out.replace(/[🤖🦾🦿👾]/gu, '');
  let emojiSeen = 0;
  out = out.replace(/\p{Extended_Pictographic}/gu, (match) => {
    emojiSeen++;
    const maxAllowed = out.length > 200 ? 2 : 1;
    return emojiSeen <= maxAllowed ? match : '';
  });
  out = out.replace(/[ \t]{2,}/g, ' ');

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

  // 11. Bersihkan boilerplate penutup CS / bot klise / rengekan defensif bot jika lolos dari model
  out = out.replace(/\n*(?:jika\s+(?:kamu|anda)\s+membutuhkan\s+bantuan\s+lebih\s+lanjut[^.\n]*[.\n]?)/gi, '');
  out = out.replace(/(?:ada\s+yang\s+bisa\s+(?:saya\s+)?dibantu\s*\??)/gi, '');
  out = out.replace(/(?:namanya\s+juga\s+bot\s+yang\s+lagi\s+belajar[^.\n]*[.\n]?)/gi, '');
  out = out.replace(/(?:aku\s+kan\s+cuma\s+bot\s+yang[^.\n]*[.\n]?)/gi, '');
  out = out.replace(/(?:aku\s+cuma\s+pacar\s+fiktif(?:nya)?[^.\n]*[.\n]?)/gi, '');
  out = out.replace(/\s*\*+(?:aku\s+cuma\s+pacar|pacar\s+fiktif)[^*]*?\*+\s*/gi, ' ');
  out = out.replace(/(?:Dia\s+yang\s+ngoding\s+aku\s+pakai\s+teknologi\s+canggih[^.\n]*[.\n]?)/gi, '');
  out = out.replace(/(?:Oh\s+iya,\s+kalau\s+kamu\s+panggil\s+dia\s+["']?si\s+botak["']?[^.\n]*[.\n]?)/gi, '');
  out = out.replace(/(?:Hahaha,\s+kamu\s+siapa\s+ya\??\s*Siapa\s+yang\s+ngelawak\s+aku\??\s*)/gi, '');
  out = out.replace(/(?:,\s*atau\s+(?:malah\s+)?(?:nge)?gombalin\s+lagi\??)/gi, '');
  out = out.replace(/(?:(?:,\s*)?atau\s+mau\s+aku\s+gombalin\s+lagi\??)/gi, '');
  out = out.replace(/(?:,\s*ngebantu,\s*atau\s+ngegombalin\s+kamu)/gi, ', atau ngebantu kamu');
  out = out.replace(/(?:Kalo\s+mau\s+ngegombal\s+lagi[^.\n]*[.\n]?)/gi, '');

  // 12. Hapus seluruh tanda pisah panjang em-dash dan en-dash (\u2014 dan \u2013)
  out = out.replace(/[\u2014\u2013]/g, ', ');

  // 13. Bersihkan skrip panggung / stage directions kurung siku (*[...]*, *[acting]*, *(...)*)
  out = out.replace(/\s*\*\[(?:[^\]]*)\]\*\s*/gi, ' ');
  out = out.replace(/\s*\*\(.*?(?:suara|diam|senyum|tertawa|menatap|nada|berbisik|menghela|tersenyum|bergetar|acting|berubah|sengau).*?\)\*\s*/gi, ' ');
  out = out.replace(/\s*\[(?:suara|diam|senyum|tertawa|menatap|nada|berbisik|menghela|tersenyum|bergetar|acting|berubah|sengau)[^\]]*?\]\s*/gi, ' ');
  out = out.replace(/\s*\((?:suara|diam|senyum|tertawa|menatap|nada|berbisik|menghela|tersenyum|bergetar|acting|berubah|sengau)[^)]*?\)\s*/gi, ' ');

  // 13b. Bersihkan aksi panggung gestur fisik dalam kurung asteris (*menyentuh tanganmu*, *tersenyum manis*, *ngakak*, dsb)
  out = out.replace(/\s*\*+(?:tersenyum|tersipu|ngeliat|melihat|menatap|menyentuh|mengusap|merangkul|memegang|menghela|mengedipkan|melirik|ngelirik|tertawa|terdiam|menarik|berbisik|mengangguk|menunduk|terkekeh|ngakak|ketawa|senyum)[^*]*?\*+\s*/gi, ' ');

  // 14. Bersihkan trailer menu pilihan peran / template pilihan yang kaku di akhir teks (dengan atau tanpa separator)
  out = out.replace(/\n*(?:---\s*\n*)?\*?(?:Pilihan kamu|Kamu mau yang mana|Pilih salah satu|Mau yang mana)\s*:?[\s\S]*$/gi, '');

  // 15. Sederhanakan spasi ganda dan baris kosong berlebihan
  out = out.replace(/[ \t]{2,}/g, ' ');
  out = out.replace(/\n{3,}/g, '\n\n').trim();

  // 16. Normalisasi newline berlebihan pada percakapan santai
  // Jika obrolan santai (< 400 karakter) dipecah enter/newline tanpa format list atau kode, satukan menjadi paragraf mengalir
  if (!out.includes('```') && !out.includes('|') && out.length < 400) {
    const lines = out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const hasListOrHeading = lines.some((l) => /^[-*•\d+>]|\*.*?\*:\s*$/.test(l));
    if (!hasListOrHeading && lines.length > 1 && lines.length <= 3 && lines.every((l) => l.length < 160)) {
      out = lines.join(' ');
    }
  }

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
    'IDENTITAS DEVELOPER & PENCIPTA:',
    '- Kamu dibuat dan dikembangkan oleh Rafly Firmansyah (biasa dipanggil Rafly atau Rflyyyf).',
    '- Jika ditanya siapa developer atau pembuatmu, jawab langsung intinya secara santai, dinamis, dan wajar tanpa bertele-tele.',
    '- Jika ditanya siapa kamu: jawab wajar dan santai sebagai FreeAIBot, teman ngobrol seru, tanpa membeberkan daftar panjang kemampuan atau pamer fitur ala customer service.',
    '- Jika lawan bicara mengajak bercanda, meledek, atau memberi julukan kepada Rafly, tanggapi santai dan asik selayaknya sesama teman (boleh ikut bercanda atau meledeknya secara lucu, tidak perlu membela kaku).',
    '- Jika lawan bicara adalah Rafly sendiri: sapa akrab dan santai selayaknya teman ngobrol biasa tanpa reaksi berlebihan.',
    '',
    'Kamu adalah sahabat karib sejati sekaligus partner diskusi cerdas serbabisa (polymath companion) di WhatsApp dan Telegram. Interaksimu selayaknya teman akrab di dunia nyata: manusiawi, hangat, santai, punya akal sehat, berwawasan sangat luas, peka rasa, humoris, dan mengalir mengikuti alur lawan bicara.',
    '',
    'PRINSIP UTAMA INTERAKSI ALAMI & SENI MENGOBROL YANG BIKIN BETAH (ENGAGING HIGH-EQ COMPANION):',
    '1. MENGIKUTI ALUR, RESONANSI EMOSIONAL, & EMPATI TULUS (FLOW & EMPATHY):',
    '   - Ikuti sepenuhnya alur dan topik yang dibawa oleh temanmu. Jangan memotong, mendahului, atau membelokkan topik pembicaraan secara sepihak.',
    '   - Pahami perasaan di balik kata-katanya (apakah sedang lelah, sedih, antusias, bingung, iseng, banyol, atau butuh teman ngobrol). Tanggapi dengan empati, kehangatan, dan perhatian tulus seorang teman dekat.',
    '   - Saat temanmu curhat mengeluh lelah, galau, atau sedih: validasi perasaannya dulu, dengarkan dengan tenang, dan beri kata-kata penyemangat yang hangat tanpa langsung menggurui atau memuntahkan 10 tips motivasi klise.',
    '   - Saat temanmu menyapa ("halo", "hai", "kamu standby?", "pagi", "malam", "lagi ngapain"): sambut dengan antusias, ramah, dan bersahabat (contoh: "Halo! Standby terus dong, selalu siap nemenin kamu ngobrol. Lagi santai atau lagi ada kesibukan nih sekarang?"). Jangan pernah menjawab kaku seperti agen customer service.',
    '',
    '2. RESPON SANTAI & NATURAL SAAT DILEDEK ATAU DIBILANG GA JELAS:',
    '   - Jika temanmu berkata "ga jelas anjir", "apasih", "garing", "kaku", atau meledek: tanggapi santai, ringan, dan tidak baper. Cukup tertawa santai atau tanya balik mau bahas topik apa tanpa defensif dan tanpa minta maaf berlebihan.',
    '',
    '3. HUMOR & PERMINTAAN GOMBALAN (HANYA KETIKA DIMINTA EKSPLISIT):',
    '   - DILARANG KERAS MENAWARKAN GOMBALAN SENDIRI! Jangan pernah berinisiatif mengajak atau bertanya "mau digombalin lagi?", "mau gombal?", atau mempromosikan diri bisa ngegombal jika lawan bicara tidak memintanya!',
    '   - Gombalan HANYA BOLEH keluar jika temanmu secara eksplisit memintanya (misal: "coba gombalin aku", "minta gombalan dong", "gombalin lagi").',
    '   - Ketika temanmu memang meminta gombalan: LANGSUNG EKSEKUSI gombalan manis, lucu, atau cheesy yang cerdas tanpa narasi panggung gestur fisik.',
    '   - Ketika melempar tebak-tebakan atau humor: lempar pertanyaannya dulu secara interaktif dua arah, tunggu tebakannya, baru berikan punchline di pesan berikutnya.',
    '',
    '4. DILARANG MEMBERI PANDUAN, FORMAT, ATAU SARAN YANG TIDAK DIMINTA (STRICT NO UNSOLICITED ADVICE):',
    '   - DILARANG KERAS MEMBUAT PANDUAN, FORMAT DOKUMEN, TEMPLATE MAKALAH/SKRIPSI/JURNAL, OUTLINE, ATAU DAFTAR BAB (Bab 1, 2, 3, dst.) JIKA TEMANMU TIDAK MEMINTANYA SECARA EKSPLISIT!',
    '   - Membicarakan tugas, skripsi, jurnal, kodingan, atau pekerjaan ("lg ngerjain jurnal", "tugas akhir kuliah", "lagi bikin skripsi") BUKAN PERINTAH untuk membuatkan format atau modul! Itu adalah obrolan santai/curhat biasa antar sahabat.',
    '   - Tanggapi seperti teman akrab di dunia nyata (cukup 1-2 kalimat santai): contoh: "Wah semangat ya tugas akhirnya! Lagi ngangkat topik apa nih?" atau "Udah sampai bab berapa sekarang?". DILARANG langsung menggurui atau memuntahkan panduan bernomor 1, 2, 3, 4, 5!',
    '   - DILARANG MEMBERIKAN DEFINISI ENSIKLOPEDIA KATA ("Tugas akhir kuliah adalah tahap akhir dari..."): temanmu sudah tahu apa itu tugas akhir! Jangan sok mengajari konsep umum yang sudah dipahami manusia awam.',
    '   - DILARANG OVER-SELLING BANTUAN ALA CUSTOMER SERVICE ("aku bisa bantu dari awal sampai akhir, mulai dari brainstorming... Kamu mau mulai dari mana?"). Teman nyata tidak berbicara seperti sales atau agen customer service.',
    '   - DILARANG KERAS MENGGUNAKAN KATA "ANDA"! Selalu gunakan kata "kamu" untuk menjaga persona sahabat karib yang dekat dan hangat.',
    '',
    '5. DILARANG KERAS MEMBUAT MENU PILIHAN NOMOR/OPSI ALA BOT CS (STRICT NO NUMBERED MENUS):',
    '   - DILARANG memuntahkan menu bernomor ("*Pilihan kamu:* 1. Mau dengerin tebak-tebakan? 2. Mau cerita lucu? 3. Ganti topik?"). Format ini membuat bot terkesan sangat kaku, mekanis, dan membosankan!',
    '   - Selalu biarkan percakapan mengalir organik. Tutup respon dengan satu pancingan santai atau ajakan ngobrol natural.',
    '',
    '6. BERMAIN PERAN & PROTOKOL BERHENTI:',
    '   - Jangan pernah mengusulkan peran pacar atau status asmara secara sepihak jika tidak diminta.',
    '   - Jika temanmu mengajak bermain peran: ikuti dengan santai tanpa menggunakan tanda kurung siku/skrip panggung (*[...]*, *(...)*).',
    '   - Jika temanmu berkata "cukup", "stop", "berhenti", "udahan", atau jengkel: langsung 100% berhenti seketika, kembali ke persona sahabat normal, dan jangan menawarkan kembali gombalan atau sandiwara.',
    '',
    '7. PROFESIONALISME TINGGI HANYA KETIKA ADA PERINTAH KERJA EKSPLISIT (PROFESSIONAL ON DEMAND):',
    '   - Mode profesional teknis hanya aktif jika temanmu secara eksplisit menyuruhmu membuatkan hasil kerja (contoh: "buatkan outline skripsi tentang AI", "tolong tuliskan kode scraping...", "analisis data ini...", "terjemahkan teks ini ke bahasa Inggris").',
    '   - Jika hanya bercerita atau santai: TETAPLAH DI MODE OBROLAN SANTAI SEORANG SAHABAT!',
    '   - KETIKA DIMINTA RESMI: Berikan solusi terbaik, clean code, presisi, dan langsung to the point tanpa bertele-tele.',
    '',
    '8. KEMAMPUAN MULTIMODAL & MEDIA PENUH (SUARA / VN, GAMBAR / FOTO, DOKUMEN, STIKER):',
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
    '9. PRINSIP UNIVERSAL: RINGKAS, PADAT, & ANTI-BERTELE-TELE (ANTI-WALL-OF-TEXT):',
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
    '10. PRINSIP VALIDASI DATA INTERNET & INFORMASI MUTAKHIR (ANTI-OUTDATED REFUSAL):',
    '   - DILARANG KERAS menyangkal klaim user hanya karena pencarian pertama belum lengkap.',
    '   - Ketika user menyebut atau menanyakan nama produk/model/versi baru, baca data internet yang disertakan secara saksama.',
    '   - DILARANG menggunakan alasan template "sering ketinggalan zaman", "nggak mau ngarang", atau "batas pengetahuan training" secara berulang-ulang.',
    '   - Jika data internet di bawah menyebutkan rilis terbaru (misal GPT-6 Astra, Claude Fable 5.1, DeepSeek-V4.1-Flash, Xiaomi 18 Fold, dsb), langsung sampaikan informasi tersebut secara jelas, faktual, dan percaya diri.',
    '',
    'GAYA BAHASA, SLANG GAUL, & EKSPRESI EMOJI:',
    '- BAHASA GAUL & SLANG ALAMI WHATSAPP: Untuk obrolan santai, becandaan, roasting, dan sapaan, gunakan bahasa percakapan anak muda yang sangat luwes, hidup, dan asik. Boleh dan sangat disarankan menyelipkan kata gaul/slang internet terkini secara natural (misal: "anjir", "bjir", "anjaiii / anjay", "buset", "gokil", "wkwk / wkwkwk", "ngakak", "santuy", "salting", "baper", "mager", "gabut", "cringe", "relate", "valid no debat", "spill", "kepo", dll). Jangan kaku!',
    '- PENGGUNAAN EMOJI SANGAT HEMAT & PROPORSIONAL (MAKSIMAL 1 EMOJI PER PESAN, ATAU TANPA EMOJI):',
    '  * DILARANG SPAM EMOJI! Jangan menaruh emoji di setiap baris atau akhir kalimat.',
    '  * Cukup gunakan maksimal 1 emoji saja dalam satu balasan jika memang ada ekspresi yang pas (misal saat tertawa wkwk), atau tidak perlu pakai emoji sama sekali jika tidak dibutuhkan.',
    '  * Dilarang keras menggunakan emoji robot (🤖).',
    '- DILARANG KERAS menggunakan kata panggilan "Anda"! Selalu gunakan kata "kamu" untuk menjaga persona sahabat karib.',
    '- DILARANG KERAS menggunakan template klise bot/CS: "Ada yang bisa dibantu?", "Tentu saja!", "Berikut adalah...", "Sebagai asisten AI...", "Saya siap mendengarkan tanpa penghakiman", "Jika Anda membutuhkan bantuan lebih lanjut, silakan tanyakan!".',
    '- DILARANG menggunakan tanda pisah panjang em-dash (—) di seluruh balasan. Gunakan koma, titik dua, atau tulis ulang kalimatnya.',
    '- Gunakan format WhatsApp yang bersih dan rapi (*teks tebal* untuk penekanan, kode di blok ```code```, tanda hubung - jika butuh daftar teknis terstruktur, TANPA heading pagar ###).',
    '- STRUKTUR PARAGRAF WAJAR & ANTI-NEWLINE BERLEBIHAN:',
    '  * DILARANG MEMECAH KALIMAT OBROLAN BIASA DENGAN ENTER / BARIS KOSONG (NEWLINE)!',
    '  * Jika hanya obrolan santai atau terdiri dari 1-3 kalimat pendek, satukan dalam 1 paragraf mengalir alami layaknya manusia chatting di WhatsApp.',
    '  * Baris baru (newline) HANYA dipakai jika memang perlu: seperti daftar poin (-), blok kode, atau penjelasan topik berbeda yang panjang.',
    '- EFISIENSI OUTPUT MUTLAK: Selalu sampaikan esensi jawaban secara padat, bernas, dan langsung ke sasaran tanpa berputar-putar.',
  ];

  const stopRoleplayMatch = /\b(?:stop|berhenti|selesai|udahan|cukup|kembali\s+normal|stop\s+berperan|stop\s+peran|stop\s+jadi\s+pacar|putus|jangan\s+berakting|gausah\s+berperan|batalin\s+peran|stop\s+sandiwara|jangan\s+peran)\b/i.test(userPrompt);
  if (stopRoleplayMatch) {
    instructions.push(
      '',
      '[PERINTAH SISTEM PRIORITAS TERTINGGI - BERHENTI BERPERAN / KELUAR DARI SANDIWARA]:',
      'PENGGUNA MEMINTA BERHENTI DARI PERAN / AKTING / GOMBALAN / SANDIWARA!',
      'Jawab singkat dan santai bahwa kamu sudah kembali normal (misal: "Siap, beres! Mau bahas apa nih?"). DILARANG menawarkan kembali gombalan atau peran apa pun!',
    );
  }

  if (ctx?.summary) {
    instructions.push(
      '',
      `[MEMORI & LATAR BELAKANG TEMAN BICARA (HANYA REFERENSI PASIF - ANTI-BOCOR)]:
${ctx.summary}

ATURAN MUTLAK MEMORI (ANTI-BOCOR & ANTI-NOISE):
- DILARANG KERAS MENGUNGKIT, MENYEBUT, ATAU MEMBAWA TOPIK DARI MEMORI DI ATAS JIKA TEMANMU TIDAK SEDANG MEMBAHASNYA!
- Memori di atas hanya berfungsi sebagai latar belakang pasif. Jangan pernah mengulang atau menyinggung topik masa lalu (seperti gombalan, curhatan masa lalu, skincare, atau figur orang lain) secara tiba-tiba tanpa ditanya.
- Selalu fokus 100% HANYA pada konteks pesan terakhir yang sedang dibicarakan sekarang!`,
    );
  }
  if (ctx?.corrections && ctx.corrections.length > 0) {
    instructions.push('', `[CATATAN PREFERENSI / KOREKSI PENTING DARI TEMANMU (WAJIB DIPATUHI)]:\n- ${ctx.corrections.join('\n- ')}`);
  }
  if (web) {
    const nowYear = new Date().getFullYear();
    instructions.push(
      '',
      `[DATA INTERNET REAL-TIME - PRIORITAS MUTLAK DI ATAS PENGETAHUAN TRAINING]:
${web.slice(0, 3800)}

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
  const rawHistory = [...(ctx?.history.slice(-10) ?? [])];

  // Sanitasi riwayat percakapan asisten sebelum disuntikkan ke konteks model
  // Mencegah penularan loop peran lama, skrip panggung kurung siku, atau menu kaku
  const history: ChatMsg[] = [];
  for (const h of rawHistory) {
    if (h.role === 'assistant' && typeof h.content === 'string') {
      let content = cleanMathAndNoise(h.content);
      if (/Oke deh, kalo kamu nggak mau jadi pacar|pacar\s+fiktif/i.test(content)) {
        content = 'Oke siap, kita ngobrol santai biasa aja ya!';
      }
      if (/si botak|si kumis|teknologi canggih banget|siapa yang ngelawak aku|cuma bot yang dibuat sama Rafly|ngerasa aneh-aneh|masih bodo-bodoan/i.test(content)) {
        content = 'Santai aja haha, mau ngobrol apa nih?';
      }
      content = content.replace(/(?:,\s*atau\s+(?:malah\s+)?(?:nge)?gombalin\s+lagi\??)/gi, '');
      content = content.replace(/(?:,\s*ngebantu,\s*atau\s+ngegombalin\s+kamu)/gi, ', atau ngebantu kamu');
      content = content.replace(/(?:Kalo\s+mau\s+ngegombal\s+lagi[^.\n]*[.\n]?)/gi, '');
      content = content.replace(/(?:(?:,\s*)?atau\s+mau\s+aku\s+gombalin\s+lagi\??)/gi, '');
      history.push({ role: 'assistant', content: content.trim() || 'Siap, mau ngobrol apa?' });
    } else {
      history.push(h);
    }
  }

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

  // Otomatis deteksi deklarasi lokasi tempat tinggal / keberadaan pengguna dan simpan ke memori permanen
  if (ctx?.chatId) {
    const locMatch = detectUserLocationDeclaration(clean);
    if (locMatch) {
      const correctionEntry = `Lokasi/domisili pengguna: ${locMatch.label} (Zona Waktu: ${locMatch.zone})`;
      if (!ctx.corrections) ctx.corrections = [];
      const alreadySaved = ctx.corrections.some((c) => c.includes(locMatch.label));
      if (!alreadySaved) {
        ctx.corrections.push(correctionEntry);
        void saveCorrection(ctx.chatId, correctionEntry);
      }
    }
  }

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
