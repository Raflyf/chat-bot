import type TelegramBot from 'node-telegram-bot-api';

/**
 * Reminder P1: timer in-memory via /remind <menit> <pesan>.
 * Batasan jujur: hilang saat proses restart. Persistensi DB fase P2.
 */
export function handleRemind(bot: TelegramBot, chatId: number, args: string): Promise<unknown> {
  const m = args.trim().match(/^(\d+)\s+([\s\S]+)/);
  if (!m) return bot.sendMessage(chatId, 'Format: /remind <menit 1-1440> <pesan>');
  const minutes = Number(m[1]);
  const message = m[2].trim().slice(0, 500);
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 1440 || !message) {
    return bot.sendMessage(chatId, 'Format: /remind <menit 1-1440> <pesan>');
  }
  setTimeout(() => {
    bot.sendMessage(chatId, `Pengingat kak: ${message}`).catch(() => undefined);
  }, minutes * 60_000);
  return bot.sendMessage(chatId, `Siap kak, saya ingatkan ${minutes} menit lagi.`);
}
