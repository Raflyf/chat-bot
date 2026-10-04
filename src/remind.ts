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
 * Waktu jatuh tempo dipakai APA ADANYA (tanpa pembulatan).
 *
 * CATATAN PERUBAHAN (04 Okt 2026):
 * Versi sebelumnya membulatkan due_at ke awal menit. Setelah disimulasikan
 * (20.000 sampel), cara itu KALAH dibanding strategi "due_at tepat + endpoint
 * menunggu sebentar":
 *   bulat + tunggu 20s : rata-rata 21,9s | median 21,7s
 *   tepat + tunggu 20s : rata-rata 15,0s | median  9,9s  <- LEBIH BAIK
 * Karena itu pembulatan dibatalkan; ketepatan ditangani oleh mekanisme
 * "tunggu sebentar" di checkDueReminders().
 */
function waktuJatuhTempo(dueAt: Date): Date {
  return dueAt;
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
      due_at: waktuJatuhTempo(dueAt).toISOString(),
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
    // ── TUNGGU SEBENTAR BILA ADA PENGINGAT YANG HAMPIR JATUH TEMPO ──
    //
    // MASALAH (keluhan: "tidak bisa diperkecil lagi jadi 5 atau 10 detik?"):
    // cron-job.org memanggil tiap 60 detik dengan jitter 4-40 detik. Bila
    // panggilan datang sedikit SEBELUM due_at, pengingat harus menunggu
    // panggilan berikutnya (~60 detik lagi) -> terasa ngaret.
    //
    // SOLUSI: bila ada pengingat yang jatuh tempo dalam <= TUNGGU_MAKS detik,
    // endpoint MENUNGGU sebentar (sleep) lalu mengirimnya di panggilan yang SAMA.
    // Hasil simulasi (20.000 sampel):
    //   tanpa tunggu : rata-rata 31,9s | median 30,1s | <=10s hanya 17%
    //   tunggu 25s   : rata-rata 12,0s | median  5,1s | <=10s jadi 58%
    //
    // BATAS AMAN: cron-job.org timeout 30 detik dan Vercel maxDuration 30 detik
    // untuk endpoint cron. Karena itu tunggu maksimum dibatasi 20 detik (sisakan
    // 10 detik untuk proses kirim + respons).
    //
    // PENTING — MENUNGGU HANYA BILA TIDAK ADA YANG SUDAH JATUH TEMPO.
    // BUG YANG DIPERBAIKI (04 Okt 2026, temuan pemilik produk: "kalo gitu yg lama
    // jadi nunggu nya dong?"): versi pertama menunggu TANPA memeriksa apakah ada
    // pengingat yang SUDAH telat. Akibatnya, bila ada pengingat telat 5 menit DAN
    // satu lagi jatuh tempo 15 detik lagi, pengingat yang sudah telat itu IKUT
    // TERTUNDA 15 detik — padahal seharusnya langsung dikirim.
    // Sekarang: kalau ada yang sudah jatuh tempo, kirim SEGERA (jangan menunggu).
    const TUNGGU_MAKS_MS = 20_000;
    try {
      // 1) Ada yang SUDAH jatuh tempo? -> jangan menunggu, kirim sekarang.
      const { data: sudahTelat } = await c
        .from('reminders')
        .select('id')
        .eq('status', 'pending')
        .lte('due_at', new Date().toISOString())
        .limit(1);
      const adaYangTelat = ((sudahTelat ?? []) as unknown[]).length > 0;

      if (!adaYangTelat) {
        // 2) Tidak ada yang telat -> boleh menunggu yang HAMPIR jatuh tempo.
        const batasCek = new Date(Date.now() + TUNGGU_MAKS_MS + 2000).toISOString();
        const { data: hampir } = await c
          .from('reminders')
          .select('due_at')
          .eq('status', 'pending')
          .gt('due_at', new Date().toISOString())   // belum jatuh tempo
          .lte('due_at', batasCek)                  // tapi sangat dekat
          .order('due_at', { ascending: true })
          .limit(1);
        const terdekat = (hampir ?? [])[0] as { due_at?: string } | undefined;
        if (terdekat?.due_at) {
          const selisih = new Date(terdekat.due_at).getTime() - Date.now();
          if (selisih > 0 && selisih <= TUNGGU_MAKS_MS) {
            console.log(`[remind] Menunggu ${Math.round(selisih / 1000)}s agar pengingat terkirim tepat waktu.`);
            await new Promise((r) => setTimeout(r, selisih + 200)); // +200ms margin
          }
        }
      }
    } catch {
      // best-effort: bila gagal, lanjut tanpa menunggu
    }

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
          // BATAS WAKTU 6 DETIK untuk generate teks.
          //
          // MASALAH NYATA (04 Okt 2026): uji menunjukkan pembuatan teks pengingat
          // bisa makan ~9 detik (antrean provider + balapan model). Itu MENUNDA
          // pengiriman, padahal pengingat yang sudah telat harus dikirim SEGERA.
          // Bila model tidak menjawab dalam 6 detik, kirim saja teks asli dari
          // user (item.message) — isi pengingatnya tetap benar, hanya gayanya
          // yang tidak diperhalus. Lebih baik tepat waktu daripada cantik tapi telat.
          const gen = await Promise.race([
            autoReply(
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
            ),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('batas-waktu-generate')), 6000)),
          ]);
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
