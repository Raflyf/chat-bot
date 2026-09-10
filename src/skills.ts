import { config } from './env.js';
import { chat, type ChatMsg } from './providers.js';

export const FALLBACK_REPLY =
  'Halo kak, terima kasih sudah menghubungi kami. Admin kami akan segera membantu. Jam layanan 08.00-21.00 WIB.';

export const PHOTO_REPLY =
  'Terima kasih kak, gambarnya sudah kami terima dan teruskan ke admin untuk pengecekan lebih lanjut.';

function systemPrompt(): string {
  return [
    `Kamu admin chat ${config.shopName}. ${config.shopProfile}`,
    'Jawab SINGKAT (maks 3 kalimat), Bahasa Indonesia santai-sopan.',
    'Hanya jawab seputar produk, harga, stok, jam layanan, dan pemesanan.',
    'Jika tidak tahu / di luar topik / butuh kepastian, jawab persis: BUTUH_ADMIN',
  ].join('\n');
}

/** Balas pesan teks. Return BUTUH_ADMIN jika harus eskalasi ke owner. */
export async function autoReply(userText: string): Promise<{ reply: string; escalate: boolean; via: string }> {
  const clean = userText.trim().slice(0, 1000);
  if (!clean) return { reply: FALLBACK_REPLY, escalate: true, via: 'empty' };
  const messages: ChatMsg[] = [
    { role: 'system', content: systemPrompt() },
    { role: 'user', content: clean },
  ];
  try {
    const { text, via } = await chat(messages);
    if (text.includes('BUTUH_ADMIN')) return { reply: FALLBACK_REPLY, escalate: true, via };
    return { reply: text, escalate: false, via };
  } catch {
    return { reply: FALLBACK_REPLY, escalate: true, via: 'failed' };
  }
}
