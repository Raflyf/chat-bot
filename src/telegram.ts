import TelegramBot from 'node-telegram-bot-api';
import { config } from './env.js';
import { autoReply, describeImage } from './skills.js';
import { saveMessage } from './db.js';
import { getContext, noteExchange, saveCorrection } from './memory.js';
import { needsSearch, searchWeb } from './web.js';
import { handleRemind, startReminderWorker } from './remind.js';

let sharedBot: TelegramBot | null = null;

export function getTelegramBot(): TelegramBot {
  if (!sharedBot) {
    // In serverless (Vercel), polling must be false.
    sharedBot = new TelegramBot(config.telegramToken, { polling: !config.isServerless });
  }
  return sharedBot;
}

/**
 * Kirim pesan ke Telegram dengan pemecahan otomatis jika teks melebihi limit 4000 karakter.
 * Memotong di batas paragraf (\n\n) atau baris baru (\n) agar struktur pesan tetap rapi.
 */
export async function sendTelegramMessageSafe(
  bot: TelegramBot,
  chatId: number,
  text: string,
): Promise<void> {
  if (!text) return;
  const maxLen = 4000;
  if (text.length <= maxLen) {
    await bot.sendMessage(chatId, text);
    return;
  }

  // Pecah teks secara cerdas berdasarkan paragraf
  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }

    let splitIndex = remaining.lastIndexOf('\n\n', maxLen);
    if (splitIndex === -1 || splitIndex < 1000) {
      splitIndex = remaining.lastIndexOf('\n', maxLen);
    }
    if (splitIndex === -1 || splitIndex < 500) {
      splitIndex = remaining.lastIndexOf(' ', maxLen);
    }
    if (splitIndex === -1) {
      splitIndex = maxLen;
    }

    const chunk = remaining.slice(0, splitIndex).trim();
    if (chunk) chunks.push(chunk);
    remaining = remaining.slice(splitIndex).trim();
  }

  for (const chunk of chunks) {
    await bot.sendMessage(chatId, chunk);
    if (chunks.length > 1) {
      await new Promise((r) => setTimeout(r, 120));
    }
  }
}

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
  await sendTelegramMessageSafe(bot, chatId, reply);
  await saveMessage({ platform: 'telegram', chat_id: chatKey, role: 'assistant', content: reply.slice(0, 4000), via });
  return true;
}

/** Handler inti pesan Telegram: dipakai bersama oleh Polling lokal & Webhook Vercel */
export async function handleIncomingMessage(bot: TelegramBot, msg: TelegramBot.Message): Promise<void> {
  try {
    if (msg.from?.is_bot) return;
    const chatId = msg.chat.id;
    const chatKey = String(chatId);
    const ownerId = config.ownerChatId;
    const text = msg.text?.trim() ?? '';

    // 1. Perintah /start
    if (text === '/start') {
      const ctx = await getContext(chatKey);
      const { reply } = await autoReply(
        `Sapa user dengan hangat dan cerdas sebagai ${config.botName}. Perkenalkan kemampuanmu: asisten AI umum yang mengingat percakapan, mencari info internet terkini, menerima koreksi via /salah, dan pengingat via /remind. Tawarkan bantuan.`,
        ctx,
      );
      await sendTelegramMessageSafe(bot, chatId, reply);
      return;
    }

    // 2. Perintah /salah <koreksi>
    if (text.startsWith('/salah')) {
      const correction = text.replace(/^\/salah\s*/, '').trim();
      const ctx = await getContext(chatKey);
      if (!correction) {
        const { reply } = await autoReply('Jelaskan format perintah /salah dengan satu contoh singkat dan ramah.', ctx);
        await sendTelegramMessageSafe(bot, chatId, reply);
        return;
      }
      const saved = await saveCorrection(chatKey, correction);
      const { reply } = await autoReply(`User menyimpan koreksi: "${correction}". Konfirmasi singkat bahwa kamu mengingatnya.`, ctx);
      await sendTelegramMessageSafe(bot, chatId, saved ? reply : `${reply}\n(Catatan: penyimpanan koreksi butuh tabel corrections.)`);
      return;
    }

    // 3. Perintah /remind <menit> <pesan>
    if (text.startsWith('/remind')) {
      const args = text.replace(/^\/remind\s*/, '').trim();
      await handleRemind(bot, chatId, args);
      return;
    }

    // 4. Gambar (Photo atau Document Image)
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
          // owner tidak wajib
        }
      }
      const ctx = await getContext(chatKey);
      const { reply } = await autoReply(
        'Gambar user gagal dianalisis dan sudah diteruskan ke admin. Sampaikan dengan ramah dan tawarkan alternatif: kirim ulang atau tanyakan via teks.',
        ctx,
      );
      await sendTelegramMessageSafe(bot, chatId, reply);
      await saveMessage({ platform: 'telegram', chat_id: chatKey, role: 'assistant', content: reply.slice(0, 4000), via: 'store-forward' });
      return;
    }

    // 5. Pesan teks umum
    if (!text || text.startsWith('/')) return;
    await saveMessage({ platform: 'telegram', chat_id: chatKey, role: 'user', content: text });

    const ctx = await getContext(chatKey);
    let web: string | null = null;
    if (needsSearch(text)) {
      const found = await searchWeb(text);
      if (found) web = found;
    }
    const { reply, escalate, via } = await autoReply(text, ctx, web);
    await sendTelegramMessageSafe(bot, chatId, reply);
    await saveMessage({ platform: 'telegram', chat_id: chatKey, role: 'assistant', content: reply, via });
    noteExchange(chatKey);

    if (escalate && ownerId) {
      try {
        await bot.sendMessage(ownerId, `Semua jalur AI gagal (via ${via}). Chat ${chatKey}: ${text.slice(0, 500)}`);
      } catch {
        // abaikan
      }
    }
  } catch (err) {
    console.error(`[telegram] handler: ${String((err as Error).message ?? err)}`);
    try {
      const { reply } = await autoReply('sapa user dengan ramah dan tawarkan bantuan');
      await sendTelegramMessageSafe(bot, msg.chat.id, reply);
    } catch {
      // abaikan
    }
  }
}

/** Eksekusi Telegram Webhook Update (dipanggil oleh /api/webhook) */
export async function processTelegramUpdate(bot: TelegramBot, update: TelegramBot.Update): Promise<void> {
  if (update.message) {
    await handleIncomingMessage(bot, update.message);
  } else if (update.edited_message) {
    await handleIncomingMessage(bot, update.edited_message);
  }
}

/** Memulai bot dalam mode Polling (hanya saat dijalankan lokal di terminal) */
export function startTelegram(): TelegramBot {
  const bot = getTelegramBot();

  bot.on('polling_error', (err) => {
    console.error(`[telegram] polling_error: ${String((err as Error).message ?? err)}`);
  });

  bot.on('message', async (msg) => {
    await handleIncomingMessage(bot, msg);
  });

  startReminderWorker(bot);
  return bot;
}
