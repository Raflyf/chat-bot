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
  /** Kapan pengingat dibuat (dipakai agar AI tidak mengarang "kemarin"). */
  created_at?: string | null;
}

/** Simpan reminder ke Supabase untuk persistensi Vercel Serverless & Cron. */
/**
 * Bulatkan waktu jatuh tempo ke AWAL MENIT agar cron per-menit menangkapnya
 * tepat waktu.
 *
 * MASALAH NYATA (04 Okt 2026, keluhan: "masih ngaret 1 menit"):
 *   User: "ingatkan 1 menit lagi login" pukul 22.56 -> due_at = 22.57:xx
 *   cron-job.org memeriksa tiap menit, TAPI dengan jitter 4-40 detik.
 *   Bila due_at = 22.57:45 sedangkan cron memeriksa 22.57:10 (belum jatuh tempo),
 *   pengingat BARU terkirim pada 22.58:10 -> terasa telat ~1 menit.
 *
 * SOLUSI: bulatkan due_at KE BAWAH ke awal menit (22.57:00). Dengan begitu
 * pemeriksaan cron mana pun DALAM menit itu (22.57:04 s/d 22.57:40) sudah
 * menemukan pengingatnya.
 *
 * PENGAMAN: bila hasil pembulatan terlalu dekat dengan SEKARANG (< 30 detik),
 * jangan dipakai — pengingat bisa terasa "kecepetan". Pakai menit berikutnya.
 * Contoh: user minta "1 menit lagi" pada 22.56:50 -> due 22.57:50 ->
 *         pembulatan 22.57:00 hanya 10 detik dari sekarang -> pakai 22.58:00.
 *
 * TRADEOFF JUJUR: dengan cron ber-granularitas 60 detik + jitter 4-40 detik,
 * pengingat tetap bisa meleset ~30-60 detik. Pembulatan ini mempersempit
 * kelewatan, bukan menghilangkannya.
 */
function bulatkanKeAwalMenit(dueAt: Date, sekarang: Date = new Date()): Date {
  const floor = new Date(dueAt);
  floor.setSeconds(0, 0);

  const jarakDetik = (floor.getTime() - sekarang.getTime()) / 1000;
  // Sudah lewat / hampir lewat -> kirim segera (jangan ditunda).
  if (jarakDetik < 0) return dueAt;
  // Terlalu dekat (< 30 detik) -> pakai menit berikutnya agar tidak kecepetan.
  if (jarakDetik < 30) return new Date(floor.getTime() + 60_000);
  return floor;
}
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
      // due_at dimajukan ke awal menit agar cron per-menit menangkapnya lebih cepat
      // (mengurangi "ngaret" — lihat penjelasan di bulatkanKeAwalMenit).
      due_at: bulatkanKeAwalMenit(dueAt).toISOString(),
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
      .select('id, chat_id, message, due_at, status, platform, lease_until, created_at')
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
        // Teks pengingat dibuat dinamis mengikuti gaya bot. ZERO teks statis:
        // bila model mati, teks pengingat milik user sendiri yang dikirim apa adanya.
        let deliveryText = item.message;
        // Waktu pembuatan pengingat (untuk mencegah AI mengarang "kemarin").
        // Bila kolom created_at tidak tersedia, pakai waktu jatuh tempo sebagai acuan.
        const dibuatPada = (item as { created_at?: string }).created_at
          ? new Date((item as { created_at?: string }).created_at as string)
          : new Date(item.due_at);
        const createdAtStr = dibuatPada.toLocaleString('id-ID', {
          timeZone: 'Asia/Jakarta', dateStyle: 'full', timeStyle: 'short',
        });
        //
        // BUG YANG DIPERBAIKI (04 Okt 2026, keluhan pemilik produk):
        //   User: "ingatkan saya 1 menit lagi tidur"
        //   Bot : "Istirahat yang nyenyak ya, jangan begadang terus. 🌙"
        //   -> Itu NASIHAT/UCAPAN, bukan PENGINGAT. User protes: "seharusnya
        //      responnya 'pengingat! waktunya tidur' atau apapun yg MENGINGATKAN,
        //      bukan malah menyuruh atau apapun itu."
        //
        // AKAR: prompt lama hanya "Sampaikan pengingat ini dengan gayamu sendiri,
        // singkat dan hangat" — tanpa menegaskan bahwa ini PENGINGAT yang harus
        // MENGINGATKAN. Model bebas menafsirkan konteks ("tidur") lalu menjawab
        // dengan nasihat/ucapan selamat, bukan mengingatkan.
        //
        // PERBAIKAN: prompt menegaskan TUGAS = MENGINGATKAN (bukan menasihati,
        // bukan mengucapkan selamat, bukan menyuruh). Gaya tetap dinamis.
        // Tiga contoh konkret diberikan sebagai acuan (bukan template wajib) agar
        // model paham BENTUK yang diinginkan, sementara kalimatnya tetap bebas.
        try {
          const gen = await autoReply(
            `TUGAS: Kamu sedang MENGIRIM PENGINGAT yang sudah dijadwalkan user sebelumnya. ` +
            `Isi pengingat user: "${item.message}".\n\n` +
            `ATURAN KERAS:\n` +
            `- Awali dengan kata/penanda pengingat (mis. "Pengingat!" / "⏰ Pengingat:" / "Woy, waktunya..." ).\n` +
            `- Sebut KEMBALI isi pengingatnya secara jelas supaya user tahu apa yang diingatkan.\n` +
            `- DILARANG menasihati, menyuruh, mengucapkan selamat, atau menambah kalimat motivasi ` +
            `(contoh SALAH: "Istirahat yang nyenyak ya", "Jangan begadang terus", "Semangat ya!").\n` +
            `- DILARANG bertanya balik atau menambah obrolan baru.\n` +
            // BUG YANG DIPERBAIKI (04 Okt 2026): bot pernah menulis
            // "waktunya login sesuai jadwalmu KEMARIN" — padahal pengingat dibuat
            // BARU SAJA (beberapa menit lalu). AI MENGARANG keterangan waktu
            // karena tidak diberi tahu kapan pengingat ini dibuat.
            // Perbaikan: beri tahu waktu pembuatan & jatuh tempo yang SEBENARNYA,
            // dan larang menyebut keterangan waktu yang tidak diberikan.
            `- Waktu SEKARANG: ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'full', timeStyle: 'short' })} WIB.\n` +
            `- Pengingat ini dibuat user pada: ${createdAtStr} WIB.\n` +
            `- DILARANG menyebut "kemarin", "besok", "minggu lalu", atau keterangan waktu lain ` +
            `yang TIDAK disebutkan di atas. Kalau ragu soal waktu, JANGAN sebut waktu sama sekali.\n` +
            `- Boleh 1 kalimat pendek saja. Gaya boleh santai/hangat, tapi TETAP sebuah pengingat.\n\n` +
            `Contoh BENAR (bentuknya seperti ini, kalimatnya bebas kamu susun sendiri):\n` +
            `- "Pengingat! Waktunya tidur 🌙"\n` +
            `- "⏰ Woy, waktunya login game nih!"\n` +
            `- "Pengingat: jangan lupa minum obat ya 💊"\n\n` +
            `Sekarang tulis pengingatnya:`,
          );
          if (gen.reply.trim()) deliveryText = gen.reply;
        } catch {
          // kirim teks pengingat user apa adanya
        }
        await sendFn(item.chat_id, deliveryText, item.platform);
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
    if (reply.trim()) await bot.sendMessage(chatId, reply);
    return;
  }

  const minutes = Number(m[1]);
  const rawMessage = m[2].trim().slice(0, 500);
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 43200 || !rawMessage) {
    const { reply } = await autoReply(
      `User salah format perintah pengingat (menit="${m[1]}"). Jelaskan syaratnya (angka 1-43200 + pesan) dengan satu contoh singkat dan ramah.`,
    );
    if (reply.trim()) await bot.sendMessage(chatId, reply);
    return;
  }

  const message = senderName ? `[Pengingat untuk ${senderName}]: ${rawMessage}` : rawMessage;
  const dueAt = new Date(Date.now() + minutes * 60_000);
  const dbSaved = await saveReminderToDb(String(chatId), message, dueAt, platform);

  // In-memory fallback HANYA jika DB tidak tersedia untuk mencegah pesan dobel
  if (!config.isServerless && !dbSaved) {
    setTimeout(() => {
      void (async () => {
        try {
          const gen = await autoReply(
            `Sampaikan pengingat ini ke user dengan gayamu sendiri, singkat dan hangat, tanpa pertanyaan tambahan: "${rawMessage}"`,
          );
          await bot.sendMessage(chatId, gen.reply.trim() || rawMessage);
        } catch {
          await bot.sendMessage(chatId, rawMessage).catch(() => undefined);
        }
      })();
    }, minutes * 60_000);
  }

  const promptConfirm = senderName
    ? `Konfirmasi singkat dan hangat: pengingat "${rawMessage}" untuk ${senderName} telah dicatat dan akan dikirim ${minutes} menit lagi di grup.`
    : `Konfirmasi singkat dan hangat: pengingat "${rawMessage}" telah dicatat dan akan dikirim ${minutes} menit lagi.`;

  const { reply } = await autoReply(promptConfirm);
  if (reply.trim()) await bot.sendMessage(chatId, reply);
}

let workerInterval: NodeJS.Timeout | null = null;

/**
 * Worker lokal untuk memproses reminder tiap 30 detik saat bot dijalankan di terminal.
 * WAJIB menghormati `platform` — chat_id WhatsApp (mis. '62812...') tidak boleh dikirim
 * ke Telegram (Number('62812...') menargetkan chat id Telegram yang salah — misdelivery).
 * sendWhatsApp opsional agar pemanggil WhatsApp-only tidak perlu impor Telegram.
 */
export function startReminderWorker(
  bot: TelegramBot,
  sendWhatsApp?: (chatId: string, text: string) => Promise<unknown>,
): void {
  if (config.isServerless || workerInterval) return;
  workerInterval = setInterval(() => {
    void checkDueReminders(async (chatId, text, platform) => {
      if (platform === 'whatsapp') {
        if (sendWhatsApp) {
          await sendWhatsApp(chatId, text);
        } else {
          console.warn(`[remind] Reminder WhatsApp dilewati (tanpa sender WA): ${chatId}`);
        }
        return;
      }
      // Telegram (atau platform belum tercatat): kirim via bot Telegram.
      await bot.sendMessage(Number(chatId), text);
    });
  }, 30_000);
}
