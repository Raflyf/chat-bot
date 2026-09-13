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
  lease_until?: string | null;
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

    // 1. Reaper: Kembalikan reminder 'processing' yang lease-nya kadaluwarsa ke 'pending'
    // Prioritas: cek kolom lease_until (B4)
    await c
      .from('reminders')
      .update({ status: 'pending', lease_until: null })
      .eq('status', 'processing')
      .lte('lease_until', now);

    // Fallback reaper hanya untuk DB pra-migrasi lease_until (lease_until IS NULL).
    // Ambang dinaikkan ke 30 menit (dari 10 menit): pengiriman yang masih in-flight
    // tidak boleh di-reap lalu diklaim ulang worker/cron lain -> cegah dobel kirim.
    // Tradeoff: baris yang benar-benar macet baru pulih setelah 30 menit, bukan 10.
    const staleThreshold = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    await c
      .from('reminders')
      .update({ status: 'pending', lease_until: null })
      .eq('status', 'processing')
      .is('lease_until', null)
      .lte('due_at', staleThreshold);

    // 2. Ambil pengingat yang jatuh tempo
    const { data, error } = await c
      .from('reminders')
      .select('id, chat_id, message, due_at, status, platform, lease_until')
      .eq('status', 'pending')
      .lte('due_at', now)
      .order('due_at', { ascending: true })
      .limit(50);

    if (error || !data || data.length === 0) return 0;

    let processed = 0;
    for (const item of data as ReminderItem[]) {
      // Atomic claim dengan lease_until 10 menit tanpa memodifikasi due_at asli (B4)
      const leaseExpiry = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      let claimSuccess = false;

      // Klaim atomik menggunakan kolom lease_until
      const { data: claimed, error: claimErr } = await c
        .from('reminders')
        .update({ status: 'processing', lease_until: leaseExpiry })
        .eq('id', item.id)
        .eq('status', 'pending')
        .select('id');

      if (!claimErr && claimed && claimed.length > 0) {
        claimSuccess = true;
      } else if (claimErr) {
        // Fallback jika database belum memiliki kolom lease_until
        const { data: directClaim, error: directErr } = await c
          .from('reminders')
          .update({ status: 'processing' })
          .eq('id', item.id)
          .eq('status', 'pending')
          .select('id');

        if (!directErr && directClaim && directClaim.length > 0) {
          claimSuccess = true;
        }
      }

      // Jika baris sudah diklaim worker/cron lain, lewati
      if (!claimSuccess) {
        continue;
      }

      try {
        await sendFn(item.chat_id, `Pengingat kak: ${item.message}`, item.platform);
        // Tandai selesai (sent) HANYA setelah pesan benar-benar sukses terkirim (C1)
        await c.from('reminders').update({ status: 'sent', lease_until: null }).eq('id', item.id);
        processed++;
      } catch (err) {
        console.error(`[remind] gagal kirim reminder id ${item.id}:`, err);
        await c.from('reminders').update({ status: 'failed', lease_until: null }).eq('id', item.id);
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
  senderName?: string,
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
  const rawMessage = m[2].trim().slice(0, 500);
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 1440 || !rawMessage) {
    const { reply } = await autoReply(
      `User salah format perintah pengingat (menit="${m[1]}"). Jelaskan syaratnya (angka 1-1440 + pesan) dengan satu contoh singkat dan ramah.`,
    );
    await bot.sendMessage(chatId, reply);
    return;
  }

  const message = senderName ? `[Pengingat untuk ${senderName}]: ${rawMessage}` : rawMessage;
  const dueAt = new Date(Date.now() + minutes * 60_000);
  const dbSaved = await saveReminderToDb(String(chatId), message, dueAt, platform);

  // In-memory fallback HANYA jika DB tidak tersedia untuk mencegah pesan dobel
  if (!config.isServerless && !dbSaved) {
    setTimeout(() => {
      bot.sendMessage(chatId, `Pengingat kak: ${message}`).catch(() => undefined);
    }, minutes * 60_000);
  }

  const promptConfirm = senderName
    ? `Konfirmasi singkat dan hangat: pengingat "${rawMessage}" untuk ${senderName} telah dicatat dan akan dikirim ${minutes} menit lagi di grup.`
    : `Konfirmasi singkat dan hangat: pengingat "${rawMessage}" telah dicatat dan akan dikirim ${minutes} menit lagi.`;

  const { reply } = await autoReply(promptConfirm);

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
