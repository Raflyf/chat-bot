/**
 * Otak percakapan khusus jalur WhatsApp Baileys.
 * Memisahkan sesi obrolan biasa (`wa_baileys_<nomor>`) dari Cloud API (`wa_<nomor>`),
 * sementara data terstruktur bersama (pengingat, catatan, tugas, keuangan, kebiasaan, fakta, zona waktu)
 * tetap berbagi kunci `wa_<nomor>`.
 */
import type { ChatContext } from './memory.js';
import { autoReply, describeImage, dynamicNotice } from './skills.js';
import { baileysChatKey, isBaileysChatKey } from './chat_id.js';

function pastikanKonteksBaileys(ctx?: ChatContext): ChatContext | undefined {
  if (!ctx) return undefined;
  const chatId = ctx.chatId && !isBaileysChatKey(ctx.chatId)
    ? baileysChatKey(ctx.chatId)
    : ctx.chatId;
  return { ...ctx, chatId };
}

export async function baileysAutoReply(
  prompt: string,
  ctx?: ChatContext,
  web?: string | null,
) {
  return await autoReply(prompt, pastikanKonteksBaileys(ctx), web);
}

export async function baileysDescribeImage(
  base64: string,
  mime: string,
  caption?: string,
  ctx?: ChatContext,
  paksaStiker = false,
) {
  return await describeImage(base64, mime, caption, pastikanKonteksBaileys(ctx), paksaStiker);
}

export async function baileysDynamicNotice(
  instruction: string,
  ctx?: ChatContext,
): Promise<string> {
  return await dynamicNotice(instruction, pastikanKonteksBaileys(ctx));
}
