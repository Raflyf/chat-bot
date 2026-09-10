import TelegramBot from 'node-telegram-bot-api';
import { config } from './env.js';
import { autoReply, FALLBACK_REPLY, PHOTO_REPLY } from './skills.js';
import { saveMessage } from './db.js';

export function startTelegram(): TelegramBot {
  const bot = new TelegramBot(config.telegramToken, { polling: true });
  const ownerId = config.ownerChatId;

  bot.on('polling_error', (err) => {
    console.error(`[telegram] polling_error: ${String((err as Error).message ?? err)}`);
  });

  bot.onText(/^\/start$/, async (msg) => {
    const chatId = msg.chat.id;
    await bot.sendMessage(chatId, `Halo kak, saya ${config.botName}, asisten AI umum. Silakan tanyakan apa saja.`);
  });

  bot.on('message', async (msg) => {
    try {
      if (msg.from?.is_bot) return;
      const chatId = msg.chat.id;
      const chatKey = String(chatId);

      // Foto/dokumen: store-and-forward P0 (vision fase 2). Teruskan ke owner.
      if (msg.photo?.length || msg.document) {
        await saveMessage({ platform: 'telegram', chat_id: chatKey, role: 'user', content: '[media]' });
        if (ownerId) {
          try {
            await bot.forwardMessage(ownerId, chatId, msg.message_id);
          } catch {
            // owner tidak wajib; abaikan
          }
        }
        const sent = await bot.sendMessage(chatId, PHOTO_REPLY);
        await saveMessage({ platform: 'telegram', chat_id: chatKey, role: 'assistant', content: PHOTO_REPLY, via: 'store-forward' });
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
          await bot.sendMessage(ownerId, `Butuh admin (via ${via}):\nChat ${chatKey}\n${text.slice(0, 500)}`);
        } catch {
          // abaikan
        }
      }
    } catch (err) {
      console.error(`[telegram] handler: ${String((err as Error).message ?? err)}`);
      try {
        await bot.sendMessage(msg.chat.id, FALLBACK_REPLY);
      } catch {
        // abaikan
      }
    }
  });

  return bot;
}
