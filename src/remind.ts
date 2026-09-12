import type TelegramBot from 'node-telegram-bot-api';
import { autoReply } from './skills.js';
import { db } from './db.js';
import { config } from './env.js';

export interface ReminderItem {
  id: number;
  chat_id: string;
  message: string;
  due_at: string;
  status: 'pending' | 'processing' | 'sent' | 'failed';
  platform?: 'telegram' | 'whatsapp';
}

/** Simpan reminder ke Supabase untuk persistensi Vercel Serverless & Cron. */
export async function saveReminderToDb(
  chatId: string,
  message: string,
  dueAt: Date,
  platform: 'telegram' | 'whatsapp' = 'telegram',
): Promise<boolean> {
  const c = db();
  if (!c) return false;
  try {
    const { error } = await c.from('reminders').insert({
      chat_id: chatId,
      message,
      due_at: dueAt.toISOString(),
      status: 'pending',
      platform,
    });
    return !error;
  } catch {
    return false;
  }
}

/**
 * Cek dan kirim semua reminder yang jatuh tempo dengan atomic claim (CAS).
 * Mencegah duplikasi pesan saat cron dan worker berjalan beriringan.
 */
export async function checkDueReminders(
  sendFn: (chatId: string, text: string, platform?: 'telegram' | 'whatsapp') => Promise<unknown>,
): Promise<number> {
  const c = db();
  if (!c) return 0;
  try {
    const now = new Date().toISOString();

    // 1. Reaper: Kembalikan reminder 'processing' yang macet > 5 menit ke 'pending' (C2 & P1-1)
    const staleThreshold = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    await c
      .from('reminders')
      .update({ status: 'pending' })
      .eq('status', 'processing')
      .lte('due_at', staleThreshold);

    // 2. Ambil pengingat yang jatuh tempo
    const { data, error } = await c
      .from('reminders')
      .select('id, chat_id, message, due_at, status, platform')
      .eq('status', 'pending')
      .lte('due_at', now)
      .order('due_at', { ascending: true })
      .limit(50);

    if (error || !data || data.length === 0) return 0;

    let processed = 0;
    for (const item of data as ReminderItem[]) {
      // Atomic claim: coba kunci status ke 'processing'
      const { data: claimed, error: claimErr } = await c
        .from('reminders')
        .update({ status: 'processing' })
        .eq('id', item.id)
        .eq('status', 'pending')
        .select('id');

      if (claimErr) {
        // Fallback jika database belum update CHECK constraint 'processing' (error 23514):
        // Kunci atomik dengan memundurkan due_at +5 menit (lease lock) TANPA menandai 'sent' sebelum kirim (C1 & P1-1)
        console.warn(`[remind] status 'processing' ditolak DB (${claimErr.message}), gunakan lease-lock due_at.`);
        const leaseTime = new Date(Date.now() + 5 * 60 * 1000).toISOString();
        const { data: directClaim, error: directErr } = await c
          .from('reminders')
          .update({ due_at: leaseTime })
          .eq('id', item.id)
          .eq('status', 'pending')
          .select('id');

        // Jika baris sudah diklaim worker lain atau error, lewati!
        if (directErr || !directClaim || directClaim.length === 0) {
          continue;
        }
      } else {
        // Jika 0 baris ter-update (artinya sudah diklaim worker/cron lain), lewati!
        if (!claimed || claimed.length === 0) {
          continue;
        }
      }

      try {
        await sendFn(item.chat_id, `Pengingat kak: ${item.message}`, item.platform);
        // Tandai selesai (sent) HANYA setelah pesan benar-benar sukses terkirim (C1)
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
 * 2. Pasang in-memory timer HANYA jika database tidak tersedia saat running local.
 * 3. Balasan konfirmasi dinamis via AI.
 */
export async function handleRemind(
  bot: TelegramBot,
  chatId: number,
  args: string,
  platform: 'telegram' | 'whatsapp' = 'telegram',
): Promise<void> {
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
  const dbSaved = await saveReminderToDb(String(chatId), message, dueAt, platform);

  // In-memory fallback HANYA jika DB tidak tersedia untuk mencegah pesan dobel
  if (!config.isServerless && !dbSaved) {
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

let workerInterval: NodeJS.Timeout | null = null;

/** Worker lokal untuk memproses reminder tiap 30 detik saat bot dijalankan di terminal. */
export function startReminderWorker(bot: TelegramBot): void {
  if (config.isServerless || workerInterval) return;
  workerInterval = setInterval(() => {
    void checkDueReminders(async (chatId, text) => {
      await bot.sendMessage(Number(chatId), text);
    });
  }, 30_000);
}
