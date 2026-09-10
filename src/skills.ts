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

function systemPrompt(): string {
  return [
    `Kamu ${config.botName}. ${config.botProfile}`,
    `Tanggal hari ini: ${todayStr()}. Jika user menanyakan hal setelah tanggal pengetahuanmu, andalkan info internet yang diberikan dan sebutkan sumbernya.`,
    'ATURAN JUJUR (mutlak): jawab BENAR dan SINGKAT (maks 5 kalimat), Bahasa Indonesia santai-sopan.',
    'Dilarang mengarang fakta, angka, nama, atau kutipan. Bedakan fakta vs opini.',
    'Dilarang overclaim (revolusioner, terbaik, tercanggih) dan angka presisi palsu.',
    'Jika tidak tahu, katakan tidak tahu dan tawarkan alternatif yang jujur.',
    'Jika ada konteks "info internet", utamakan itu dan sebutkan sumbernya di jawaban.',
    'Jika ada "koreksi tersimpan", patuhi koreksi itu di atas pengetahuanmu.',
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

function buildMessages(clean: string, ctx?: ChatContext, web?: string | null): ChatMsg[] {
  const messages: ChatMsg[] = [{ role: 'system', content: systemPrompt() }];
  if (ctx?.summary) messages.push({ role: 'user', content: `[Ringkasan percakapan lalu: ${ctx.summary}]` });
  if (ctx?.corrections.length) {
    messages.push({ role: 'user', content: `[Koreksi tersimpan darimu, wajib dipatuhi: ${ctx.corrections.join(' | ')}]` });
  }
  for (const h of ctx?.history.slice(-10) ?? []) messages.push(h);
  if (web) messages.push({ role: 'user', content: `[Info internet: ${web}]` });
  messages.push({ role: 'user', content: clean });
  return messages;
}

/** Balas pesan teks apa pun secara dinamis. Eskalasi hanya jika semua provider mati. */
export async function autoReply(
  userText: string,
  ctx?: ChatContext,
  web?: string | null,
): Promise<{ reply: string; escalate: boolean; via: string }> {
  const clean = userText.trim().slice(0, 2000);
  if (!clean) return { reply: statusDown(), escalate: true, via: 'empty' };
  try {
    const { text, via } = await chatRetry(buildMessages(clean, ctx, web), false);
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
