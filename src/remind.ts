import type TelegramBot from 'node-telegram-bot-api';
import { autoReply } from './skills.js';
import { db } from './db.js';
import { config } from './env.js';

export interface ReminderItem {
  id: number;
  chat_id: string;
  message: string;
  due_at: string;
  status: 'pending' | 'sent' | 'failed';
}

/** Simpan reminder ke Supabase untuk persistensi Vercel Serverless & Cron. */
async function saveReminderToDb(chatId: string, message: string, dueAt: Date): Promise<boolean> {
  const c = db();
  if (!c) return false;
  try {
    const { error } = await c.from('reminders').insert({
      chat_id: chatId,
      message,
      due_at: dueAt.toISOString(),
      status: 'pending',
    });
    return !error;
  } catch {
    return false;
  }
}

/**
 * Cek dan kirim semua reminder yang jatuh tempo.
 * Dipanggil oleh Vercel Cron (/api/cron/reminders) atau local background interval.
 */
export async function checkDueReminders(
  sendFn: (chatId: string, text: string) => Promise<unknown>,
): Promise<number> {
  const c = db();
  if (!c) return 0;
  try {
    const now = new Date().toISOString();
    const { data, error } = await c
      .from('reminders')
      .select('id, chat_id, message, due_at, status')
      .eq('status', 'pending')
      .lte('due_at', now)
      .limit(50);

    if (error || !data || data.length === 0) return 0;

    let processed = 0;
    for (const item of data as ReminderItem[]) {
      try {
        await sendFn(item.chat_id, `Pengingat kak: ${item.message}`);
        await c.from('reminders').update({ status: 'sent' }).eq('id', item.id);
        processed++;
      } catch (err) {
        console.error(`[remind] gagal kirim reminder id ${item.id}:`, err);
        await c.from('reminders').update({ status: 'failed' }).eq('id', item.id);
      }
    }
    return processed;
  } catch (err) {
    console.error('[remind] error checkDueReminders:', err);
    return 0;
  }
}

/**
 * Reminder handler:
 * 1. Simpan ke database Supabase (tabel reminders) agar persisten di Vercel.
 * 2. Pasang in-memory timer jika running di local terminal (non-serverless).
 * 3. Balasan konfirmasi dinamis via AI.
 */
export async function handleRemind(bot: TelegramBot, chatId: number, args: string): Promise<void> {
  const m = args.trim().match(/^(\d+)\s+([\s\S]+)/);
  if (!m) {
    const { reply } = await autoReply(
      'User salah format perintah pengingat (tidak ada angka menit dan pesan). Jelaskan format yang benar: /remind <menit> <pesan>, dengan satu contoh singkat dan ramah.',
    );
    await bot.sendMessage(chatId, reply);
    return;
  }

  const minutes = Number(m[1]);
  const message = m[2].trim().slice(0, 500);
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 1440 || !message) {
    const { reply } = await autoReply(
      `User salah format perintah pengingat (menit="${m[1]}"). Jelaskan syaratnya (angka 1-1440 + pesan) dengan satu contoh singkat dan ramah.`,
    );
    await bot.sendMessage(chatId, reply);
    return;
  }

  const dueAt = new Date(Date.now() + minutes * 60_000);
  const dbSaved = await saveReminderToDb(String(chatId), message, dueAt);

  // In-memory fallback untuk local mode
  if (!config.isServerless) {
    setTimeout(() => {
      bot.sendMessage(chatId, `Pengingat kak: ${message}`).catch(() => undefined);
    }, minutes * 60_000);
  }

  const { reply } = await autoReply(
    `Konfirmasi singkat dan hangat: pengingat "${message}" telah dicatat dan akan dikirim ${minutes} menit lagi.`,
  );

  const note = !dbSaved && config.isServerless ? '\n(Catatan: pastikan tabel reminders sudah dimigrasi di Supabase.)' : '';
  await bot.sendMessage(chatId, `${reply}${note}`);
}

/** Worker lokal untuk memproses reminder tiap 30 detik saat bot dijalankan di terminal. */
export function startReminderWorker(bot: TelegramBot): void {
  if (config.isServerless) return;
  setInterval(() => {
    void checkDueReminders(async (chatId, text) => {
      await bot.sendMessage(chatId, text);
    });
  }, 30_000);
}
