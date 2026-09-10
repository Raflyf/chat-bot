import { config } from './env.js';
import { chat, type ChatMsg } from './providers.js';

export const FALLBACK_REPLY =
  'Maaf kak, semua jalur AI sedang sibuk. Coba kirim ulang pesannya sebentar lagi.';

export const PHOTO_REPLY =
  'Gambarnya sudah kami terima kak. Fitur analisis gambar masih tahap berikutnya, saat ini saya baru bisa menjawab pertanyaan teks.';

function systemPrompt(): string {
  return [
    `Kamu ${config.botName}. ${config.botProfile}`,
    'Jawab BENAR dan SINGKAT (maks 5 kalimat), Bahasa Indonesia santai-sopan.',
    'Topik apa pun boleh: pengetahuan umum, sains, teknologi, coding, matematika, bahasa, dll.',
    'Jika benar-benar tidak tahu jawabannya, katakan jujur tidak tahu, jangan mengarang.',
  ].join('\n');
}

/** Balas pesan teks apa pun. Eskalasi hanya jika semua provider gagal. */
export async function autoReply(userText: string): Promise<{ reply: string; escalate: boolean; via: string }> {
  const clean = userText.trim().slice(0, 2000);
  if (!clean) return { reply: FALLBACK_REPLY, escalate: true, via: 'empty' };
  const messages: ChatMsg[] = [
    { role: 'system', content: systemPrompt() },
    { role: 'user', content: clean },
  ];
  try {
    const { text, via } = await chat(messages);
    return { reply: text, escalate: false, via };
  } catch {
    return { reply: FALLBACK_REPLY, escalate: true, via: 'failed' };
  }
}
