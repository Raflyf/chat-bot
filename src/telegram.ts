import TelegramBot from 'node-telegram-bot-api';
import { config } from './env.js';
import { autoReply, describeImage } from './skills.js';
import { saveMessage } from './db.js';
import { handleRemind } from './remind.js';

async function answerPhoto(
  bot: TelegramBot,
  chatId: number,
  chatKey: string,
  fileId: string,
  caption?: string,
): Promise<boolean> {
  const file = await bot.getFile(fileId);
  if (!file.file_path) return false;
  const url = `https://api.telegram.org/file/bot${config.telegramToken}/${file.file_path}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(config.downloadTimeoutMs) });
  if (!res.ok) return false;
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0 || buf.length > 8_000_000) return false;
  const mime = file.file_path.endsWith('.png') ? 'image/png' : 'image/jpeg';
  const { reply, via } = await describeImage(buf.toString('base64'), mime, caption);
  await bot.sendMessage(chatId, reply);
  await saveMessage({ platform: 'telegram', chat_id: chatKey, role: 'assistant', content: reply.slice(0, 4000), via });
  return true;
}

export function startTelegram(): TelegramBot {
  const bot = new TelegramBot(config.telegramToken, { polling: true });
  const ownerId = config.ownerChatId;

  bot.on('polling_error', (err) => {
    console.error(`[telegram] polling_error: ${String((err as Error).message ?? err)}`);
  });

  bot.onText(/^\/start$/, async (msg) => {
    const chatId = msg.chat.id;
    await bot.sendMessage(
      chatId,
      `Halo kak, saya ${config.botName}, asisten AI umum. Silakan tanyakan apa saja, kapan saja.\nPerintah: /remind <menit> <pesan> untuk pengingat.`,
    );
  });

  bot.onText(/^\/remind([\s\S]*)$/, async (msg, match) => {
    await handleRemind(bot, msg.chat.id, match?.[1] ?? '');
  });

  bot.on('message', async (msg) => {
    try {
      if (msg.from?.is_bot) return;
      const chatId = msg.chat.id;
      const chatKey = String(chatId);

      // Gambar: unduh lalu analisis dinamis via model vision.
      // Dokumen non-gambar: teruskan ke owner (di luar kemampuan vision).
      if (msg.photo?.length || msg.document) {
        const fileId = msg.photo?.length
          ? msg.photo[msg.photo.length - 1].file_id
          : msg.document?.mime_type?.startsWith('image/')
            ? msg.document.file_id
            : undefined;
        const caption = msg.caption?.trim();
        await saveMessage({
          platform: 'telegram',
          chat_id: chatKey,
          role: 'user',
          content: caption ? `[gambar] ${caption}` : '[gambar]',
        });
        if (fileId) {
          try {
            if (await answerPhoto(bot, chatId, chatKey, fileId, caption)) return;
          } catch (err) {
            console.error(`[telegram] vision: ${String((err as Error).message ?? err)}`);
          }
        }
        if (ownerId) {
          try {
            await bot.forwardMessage(ownerId, chatId, msg.message_id);
          } catch {
            // owner tidak wajib; abaikan
          }
        }
        const sent = await bot.sendMessage(chatId, 'Maaf kak, gambar ini belum bisa saya analisis. Saya teruskan ke admin.');
        await saveMessage({ platform: 'telegram', chat_id: chatKey, role: 'assistant', content: 'Gambar gagal dianalisis, diteruskan.', via: 'store-forward' });
        void sent;
        return;
      }

      const text = msg.text?.trim();
      if (!text || text.startsWith('/')) return;
      await saveMessage({ platform: 'telegram', chat_id: chatKey, role: 'user', content: text });

      const { reply, escalate, via } = await autoReply(text);
      await bot.sendMessage(chatId, reply);
      await saveMessage({ platform: 'telegram', chat_id: chatKey, role: 'assistant', content: reply, via });

      if (escalate && ownerId) {
        try {
          await bot.sendMessage(ownerId, `Semua provider gagal (via ${via}). Chat ${chatKey}: ${text.slice(0, 500)}`);
        } catch {
          // abaikan
        }
      }
    } catch (err) {
      console.error(`[telegram] handler: ${String((err as Error).message ?? err)}`);
      try {
        const { reply } = await autoReply('sapa user dengan ramah dan tawarkan bantuan');
        await bot.sendMessage(msg.chat.id, reply);
      } catch {
        // abaikan
      }
    }
  });

  return bot;
}
