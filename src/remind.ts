import type TelegramBot from 'node-telegram-bot-api';
import { autoReply } from './skills.js';

/**
 * Reminder: timer in-memory via /remind <menit> <pesan>.
 * Semua balasan (konfirmasi/format) dinamis via AI, tanpa template hardcoded.
 * Batasan jujur: hilang saat proses restart. Persistensi DB roadmap berikutnya.
 */
export async function handleRemind(bot: TelegramBot, chatId: number, args: string): Promise<void> {
  const m = args.trim().match(/^(\d+)\s+([\s\S]+)/);
  if (!m) {
    const { reply } = await autoReply('User salah format perintah pengingat (tidak ada angka menit dan pesan). Jelaskan format yang benar dengan satu contoh singkat, ramah.');
    await bot.sendMessage(chatId, reply);
    return;
  }
  const minutes = Number(m[1]);
  const message = m[2].trim().slice(0, 500);
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 1440 || !message) {
    const { reply } = await autoReply(
      `User salah format perintah pengingat (menit="${m[1]}"). Jelaskan syaratnya (angka 1-1440 + pesan) dengan satu contoh singkat, ramah.`,
    );
    await bot.sendMessage(chatId, reply);
    return;
  }
  setTimeout(() => {
    bot.sendMessage(chatId, `Pengingat kak: ${message}`).catch(() => undefined);
  }, minutes * 60_000);
  const { reply } = await autoReply(`Konfirmasi singkat dan hangat: pengingat "${message}" akan dikirim ${minutes} menit lagi.`);
  await bot.sendMessage(chatId, reply);
}
