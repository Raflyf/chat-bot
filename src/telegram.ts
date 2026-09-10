import TelegramBot from 'node-telegram-bot-api';
import { config } from './env.js';
import { autoReply, describeImage } from './skills.js';
import { saveMessage } from './db.js';
import {
  looksLikeOrder,
  parseOrder,
  saveOrder,
  confirmText,
  todayOrders,
  formatRecap,
  type ParsedOrder,
} from './orders.js';
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
  const res = await fetch(url, { signal: AbortSignal.timeout(config.timeoutMs) });
  if (!res.ok) return false;
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0 || buf.length > 8_000_000) return false;
  const mime = file.file_path.endsWith('.png') ? 'image/png' : 'image/jpeg';
  const { reply, via } = await describeImage(buf.toString('base64'), mime, caption);
  await bot.sendMessage(chatId, reply);
  await saveMessage({ platform: 'telegram', chat_id: chatKey, role: 'assistant', content: reply.slice(0, 4000), via });
  return true;
}

async function answerOrder(
  bot: TelegramBot,
  chatId: number,
  chatKey: string,
  text: string,
): Promise<boolean> {
  const order: ParsedOrder | null = await parseOrder(text);
  if (!order || !order.is_order) return false;
  const saved = await saveOrder(chatKey, order);
  const reply = confirmText(order, saved);
  await bot.sendMessage(chatId, reply);
  await saveMessage({ platform: 'telegram', chat_id: chatKey, role: 'assistant', content: reply, via: 'order-parser' });
  return true;
}

function recapTarget(): string {
  return process.env.RECAP_CHAT_ID ?? config.ownerChatId;
}

function recapTime(): string {
  return process.env.RECAP_TIME ?? '21:00';
}

let lastRecapDay = '';

function startDailyRecap(bot: TelegramBot): void {
  setInterval(() => {
    try {
      const now = new Date();
      const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      const day = now.toISOString().slice(0, 10);
      if (hhmm !== recapTime() || lastRecapDay === day) return;
      const target = recapTarget();
      if (!target) return;
      lastRecapDay = day;
      void (async () => {
        const rows = await todayOrders();
        await bot.sendMessage(target, formatRecap(rows));
      })();
    } catch {
      // scheduler tidak boleh mematikan bot
    }
  }, 30_000).unref();
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
      `Halo kak, saya ${config.botName}, asisten AI umum. Silakan tanyakan apa saja.\nPerintah: /order <teks pesanan> • /rekap • /remind <menit> <pesan>`,
    );
  });

  bot.onText(/^\/order([\s\S]*)$/, async (msg, match) => {
    const chatId = msg.chat.id;
    const text = (match?.[1] ?? '').trim();
    if (!text) {
      await bot.sendMessage(chatId, 'Format: /order <teks pesanan>, contoh: /order 2 kaos polos M, 1 topi');
      return;
    }
    await saveMessage({ platform: 'telegram', chat_id: String(chatId), role: 'user', content: text });
    const handled = await answerOrder(bot, chatId, String(chatId), text);
    if (!handled) await bot.sendMessage(chatId, 'Teks itu tidak terbaca sebagai pesanan kak. Coba format: nama barang + jumlah.');
  });

  bot.onText(/^\/rekap$/, async (msg) => {
    const rows = await todayOrders();
    await bot.sendMessage(msg.chat.id, formatRecap(rows));
  });

  bot.onText(/^\/remind([\s\S]*)$/, async (msg, match) => {
    await handleRemind(bot, msg.chat.id, match?.[1] ?? '');
  });

  bot.on('message', async (msg) => {
    try {
      if (msg.from?.is_bot) return;
      const chatId = msg.chat.id;
      const chatKey = String(chatId);

      // Foto/dokumen gambar: unduh lalu analisis dinamis via model vision.
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

      // Deteksi order dulu (heuristik murah), baru asisten umum.
      if (looksLikeOrder(text)) {
        const handled = await answerOrder(bot, chatId, chatKey, text);
        if (handled) return;
      }

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
        const { reply } = await autoReply('sapa user dengan ramah dan tawarkan bantuan');
        await bot.sendMessage(msg.chat.id, reply);
      } catch {
        // abaikan
      }
    }
  });

  startDailyRecap(bot);
  return bot;
}
