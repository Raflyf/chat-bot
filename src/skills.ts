import { config } from './env.js';
import { chat, type ChatMsg, type ContentPart } from './providers.js';

/** Satu-satunya pesan non-AI: hanya saat SEMUA provider mati total setelah retry. */
function statusDown(): string {
  return `Maaf kak, semua jalur AI sedang tidak bisa dihubungi (${new Date().toISOString()}). Pesan kakak tidak hilang, silakan kirim ulang sebentar lagi.`;
}

function systemPrompt(): string {
  return [
    `Kamu ${config.botName}. ${config.botProfile}`,
    'Jawab BENAR dan SINGKAT (maks 5 kalimat), Bahasa Indonesia santai-sopan.',
    'Topik apa pun boleh: pengetahuan umum, sains, teknologi, coding, matematika, bahasa, dll.',
    'Jika benar-benar tidak tahu jawabannya, katakan jujur tidak tahu, jangan mengarang.',
  ].join('\n');
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Coba chat, sekali retry berdelay 20 dtk jika seluruh chain gagal. */
async function chatRetry(messages: ChatMsg[], vision: boolean): Promise<{ text: string; via: string }> {
  try {
    return await chat(messages, { vision });
  } catch {
    await wait(20_000);
    return await chat(messages, { vision });
  }
}

/** Balas pesan teks apa pun secara dinamis. Eskalasi hanya jika semua provider mati. */
export async function autoReply(userText: string): Promise<{ reply: string; escalate: boolean; via: string }> {
  const clean = userText.trim().slice(0, 2000);
  if (!clean) return { reply: statusDown(), escalate: true, via: 'empty' };
  const messages: ChatMsg[] = [
    { role: 'system', content: systemPrompt() },
    { role: 'user', content: clean },
  ];
  try {
    const { text, via } = await chatRetry(messages, false);
    return { reply: text, escalate: false, via };
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
        ? `Pertanyaan user tentang gambar ini: ${caption.trim().slice(0, 500)}`
        : 'Jelaskan isi gambar ini secara singkat dalam Bahasa Indonesia (maks 5 kalimat).',
    },
  ];
  const messages: ChatMsg[] = [
    { role: 'system', content: systemPrompt() },
    { role: 'user', content: parts },
  ];
  const { text, via } = await chatRetry(messages, true);
  return { reply: text, via };
}
