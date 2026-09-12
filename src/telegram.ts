import TelegramBot from 'node-telegram-bot-api';
import { config } from './env.js';
import { autoReply, describeImage, splitMessageSmart } from './skills.js';
import { transcribeAudio, processIncomingDocument, processIncomingSticker, processIncomingVideo } from './media.js';
import { saveMessage } from './db.js';
import { getContext, isResetCommand, noteExchange, resetSession, saveCorrection, updateContextCache } from './memory.js';
import { needsSearch, searchWeb } from './web.js';
import { handleRemind, startReminderWorker } from './remind.js';
import { resolveTimezoneFromCoords, formatInZone } from './timezone.js';

let sharedBot: TelegramBot | null = null;

export function getTelegramBot(): TelegramBot {
  if (!sharedBot) {
    // In serverless (Vercel), polling must be false.
    sharedBot = new TelegramBot(config.telegramToken, { polling: !config.isServerless });
  }
  return sharedBot;
}

/**
 * Kirim pesan ke Telegram dengan pemecahan cerdas jika teks melebihi limit 4000 karakter.
 * Menggunakan splitMessageSmart yang sadar code-fence markdown agar formatting tidak rusak.
 */
export async function sendTelegramMessageSafe(
  bot: TelegramBot,
  chatId: number,
  text: string,
): Promise<void> {
  if (!text) return;
  const chunks = splitMessageSmart(text, 4000);

  for (const chunk of chunks) {
    await bot.sendMessage(chatId, chunk);
    if (chunks.length > 1) {
      await new Promise((r) => setTimeout(r, 120));
    }
  }
}

/** Unduh buffer file dari server Telegram */
async function downloadTelegramBuffer(
  bot: TelegramBot,
  fileId: string,
): Promise<{ buffer: Buffer; filePath: string } | null> {
  try {
    const file = await bot.getFile(fileId);
    if (!file.file_path) return null;
    const url = `https://api.telegram.org/file/bot${config.telegramToken}/${file.file_path}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(config.downloadTimeoutMs) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > 20_000_000) return null;
    return { buffer: buf, filePath: file.file_path };
  } catch (err) {
    console.error('[telegram] Gagal unduh file:', err);
    return null;
  }
}

async function answerPhoto(
  bot: TelegramBot,
  chatId: number,
  chatKey: string,
  fileId: string,
  caption?: string,
): Promise<boolean> {
  const dl = await downloadTelegramBuffer(bot, fileId);
  if (!dl) return false;
  const mime = dl.filePath.endsWith('.png') ? 'image/png' : 'image/jpeg';
  const ctx = await getContext(chatKey);
  const { reply, via, tokens } = await describeImage(dl.buffer.toString('base64'), mime, caption, ctx);
  await sendTelegramMessageSafe(bot, chatId, reply);
  await saveMessage({ platform: 'telegram', chat_id: chatKey, role: 'assistant', content: reply, via, tokens });
  noteExchange(chatKey);
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

    // 1. Perintah /start (Respons statis instan tanpa memanggil LLM demi kecepatan & efisiensi)
    if (text === '/start') {
      const welcomeText =
        `Halo! Saya *${config.botName}*, asisten AI pribadi kamu.\n\n` +
        `Kemampuan yang dapat kamu gunakan:\n` +
        `- Diskusi, tanya jawab, atau analisis berbagai topik secara mendalam\n` +
        `- Menelusuri informasi internet terkini secara real-time\n` +
        `- Membaca & menganalisis dokumen (PDF, Word, TXT, CSV), gambar, pesan suara (VN), stiker, dan video\n` +
        `- Mengatur pengingat otomatis dengan perintah: /remind <menit> <pesan>\n` +
        `- Menyimpan preferensi/koreksi khusus dengan perintah: /salah <catatan>\n` +
        `- Mereset sesi percakapan dengan perintah: /reset\n\n` +
        `Ada yang bisa saya bantu sekarang?`;
      await sendTelegramMessageSafe(bot, chatId, welcomeText);
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

    // 3b. Perintah /reset atau /clear atau reset sesi
    if (text && isResetCommand(text)) {
      const reply = await resetSession(chatKey, 'telegram');
      await sendTelegramMessageSafe(bot, chatId, reply);
      void saveMessage({
        platform: 'telegram',
        chat_id: chatKey,
        role: 'assistant',
        content: reply,
        via: 'system/reset',
      });
      return;
    }

    // 4. Foto / Gambar
    if (msg.photo?.length) {
      const fileId = msg.photo[msg.photo.length - 1].file_id;
      const caption = msg.caption?.trim();
      void saveMessage({
        platform: 'telegram',
        chat_id: chatKey,
        role: 'user',
        content: caption ? `[Gambar] ${caption}` : '[Gambar]',
      }).catch((err) => console.warn('[telegram] Gagal simpan pesan foto user:', err));
      try {
        if (await answerPhoto(bot, chatId, chatKey, fileId, caption)) return;
      } catch (err) {
        console.error(`[telegram] vision photo error: ${String((err as Error).message ?? err)}`);
      }
    }

    // 4b. Video (MP4 / WebM) via Google Gemini Multimodal
    if (msg.video) {
      const fileId = msg.video.file_id;
      const caption = msg.caption?.trim();
      const mime = msg.video.mime_type || 'video/mp4';
      void saveMessage({
        platform: 'telegram',
        chat_id: chatKey,
        role: 'user',
        content: caption ? `[Video] ${caption}` : '[Video]',
      }).catch((err) => console.warn('[telegram] Gagal simpan pesan video user:', err));

      const dl = await downloadTelegramBuffer(bot, fileId);
      if (dl) {
        const { reply, via, tokens } = await processIncomingVideo(dl.buffer, mime, 'video.mp4', caption);
        await sendTelegramMessageSafe(bot, chatId, reply);
        void saveMessage({
          platform: 'telegram',
          chat_id: chatKey,
          role: 'assistant',
          content: reply,
          via,
          tokens,
        }).catch((err) => console.warn('[telegram] Gagal simpan pesan video assistant:', err));
        noteExchange(chatKey);
        return;
      }
    }

    // 5. Dokumen (PDF, Word .docx, Teks, CSV, JSON, Kode, atau Gambar Asli)
    if (msg.document) {
      const fileId = msg.document.file_id;
      const filename = msg.document.file_name || 'dokumen';
      const mime = msg.document.mime_type || 'application/octet-stream';
      const caption = msg.caption?.trim();

      // Jika berkas berupa gambar tanpa kompresi
      if (mime.startsWith('image/')) {
        void saveMessage({
          platform: 'telegram',
          chat_id: chatKey,
          role: 'user',
          content: caption ? `[Gambar: ${filename}] ${caption}` : `[Gambar: ${filename}]`,
        }).catch((err) => console.warn('[telegram] Gagal simpan pesan gambar doc user:', err));
        if (await answerPhoto(bot, chatId, chatKey, fileId, caption)) return;
      }

      // Berkas dokumen umum (PDF, DOCX, TXT, CSV, JSON, kode)
      void saveMessage({
        platform: 'telegram',
        chat_id: chatKey,
        role: 'user',
        content: `[Dokumen: ${filename}] ${caption || ''}`.trim(),
      }).catch((err) => console.warn('[telegram] Gagal simpan pesan doc user:', err));

      const dl = await downloadTelegramBuffer(bot, fileId);
      if (dl) {
        const ctx = await getContext(chatKey);
        const { reply, via, tokens } = await processIncomingDocument(dl.buffer, mime, filename, caption, ctx);
        await sendTelegramMessageSafe(bot, chatId, reply);
        void saveMessage({
          platform: 'telegram',
          chat_id: chatKey,
          role: 'assistant',
          content: reply,
          via,
          tokens,
        }).catch((err) => console.warn('[telegram] Gagal simpan pesan doc assistant:', err));
        noteExchange(chatKey);
        return;
      }
    }

    // 6. Voice Note (VN) atau File Audio
    if (msg.voice || msg.audio) {
      const fileId = msg.voice ? msg.voice.file_id : msg.audio!.file_id;
      const mime = msg.voice ? (msg.voice.mime_type || 'audio/ogg') : (msg.audio?.mime_type || 'audio/mpeg');
      const dl = await downloadTelegramBuffer(bot, fileId);

      if (dl) {
        try {
          const transcription = await transcribeAudio(dl.buffer, mime);
          const ctx = await getContext(chatKey);

          void saveMessage({
            platform: 'telegram',
            chat_id: chatKey,
            role: 'user',
            content: `[Voice Note]: "${transcription}"`,
          }).catch((err) => console.warn('[telegram] Gagal simpan pesan VN user:', err));

          let web: string | null = null;
          if (needsSearch(transcription)) {
            const prevContext = ctx?.history?.slice(-3)?.map(h => h.content)?.join(' ') || '';
            const found = await searchWeb(transcription, prevContext);
            if (found) web = found;
          }

          const prompt = `[Pesan Suara / Voice Note dari Temanmu]: "${transcription}"\n(Kamu mendengar rekaman suara ini secara jernih. Tanggapi langsung apa yang dibicarakan temanmu secara wajar, hangat, dan bersahabat).`;
          const { reply, via, tokens } = await autoReply(prompt, ctx, web);
          await sendTelegramMessageSafe(bot, chatId, reply);
          void saveMessage({
            platform: 'telegram',
            chat_id: chatKey,
            role: 'assistant',
            content: reply,
            via,
            tokens,
          }).catch((err) => console.warn('[telegram] Gagal simpan pesan VN assistant:', err));
          noteExchange(chatKey);
        } catch (err) {
          console.error('[telegram] Gagal transkripsi audio/VN:', err);
          await sendTelegramMessageSafe(
            bot,
            chatId,
            'Suara dalam rekaman audio tidak terdengar jelas atau kosong. Boleh tolong kirim ulang atau sampaikan melalui teks?',
          );
        }
        return;
      }
    }

    // 6b. Lokasi Pengguna (Location Pin / Live Location)
    if (msg.location) {
      const lat = msg.location.latitude;
      const lon = msg.location.longitude;
      const tzInfo = resolveTimezoneFromCoords(lat, lon);
      await saveCorrection(chatKey, `Lokasi pengguna berada di koordinat (${lat.toFixed(4)}, ${lon.toFixed(4)}) - Zona Waktu: ${tzInfo.label}`);
      const locTime = formatInZone(new Date(), tzInfo.zone);
      const reply = `Lokasimu berhasil aku catat di ${tzInfo.label}. Waktu setempat di lokasimu saat ini adalah *${locTime.time} ${locTime.tzName}* (${locTime.full}). Mulai sekarang aku akan selalu mengingat waktu lokasimu.`;
      await sendTelegramMessageSafe(bot, chatId, reply);
      void saveMessage({ platform: 'telegram', chat_id: chatKey, role: 'assistant', content: reply })
        .catch((err) => console.warn('[telegram] Gagal simpan pesan lokasi assistant:', err));
      return;
    }

    // 7. Stiker Telegram
    if (msg.sticker) {
      const emoji = msg.sticker.emoji;
      const ctx = await getContext(chatKey);

      void saveMessage({
        platform: 'telegram',
        chat_id: chatKey,
        role: 'user',
        content: `[Stiker Telegram${emoji ? `: ${emoji}` : ''}]`,
      }).catch((err) => console.warn('[telegram] Gagal simpan pesan stiker user:', err));

      // Jika stiker statis (WebP), kita kirim ke Vision
      if (!msg.sticker.is_animated && !msg.sticker.is_video) {
        const dl = await downloadTelegramBuffer(bot, msg.sticker.file_id);
        if (dl) {
          const { reply, via, tokens } = await processIncomingSticker(dl.buffer, 'image/webp', emoji, ctx);
          await sendTelegramMessageSafe(bot, chatId, reply);
          void saveMessage({
            platform: 'telegram',
            chat_id: chatKey,
            role: 'assistant',
            content: reply,
            via,
            tokens,
          }).catch((err) => console.warn('[telegram] Gagal simpan pesan stiker assistant:', err));
          noteExchange(chatKey);
          return;
        }
      }

      // Fallback untuk stiker animasi / video stiker atau jika download gagal
      const prompt = `Pengguna mengirim stiker Telegram dengan ekspresi emoji "${emoji || 'ekspresi'}". Tanggapi makna atau emosinya secara hangat, santai, dan bersahabat layaknya seorang sahabat mengobrol.`;
      const { reply, via, tokens } = await autoReply(prompt, ctx);
      await sendTelegramMessageSafe(bot, chatId, reply);
      void saveMessage({
        platform: 'telegram',
        chat_id: chatKey,
        role: 'assistant',
        content: reply,
        via,
        tokens,
      }).catch((err) => console.warn('[telegram] Gagal simpan pesan stiker fallback assistant:', err));
      noteExchange(chatKey);
      return;
    }

    // 8. Video atau Video Note (Lingkaran)
    if (msg.video || msg.video_note) {
      const caption = msg.caption?.trim();
      const ctx = await getContext(chatKey);

      void saveMessage({
        platform: 'telegram',
        chat_id: chatKey,
        role: 'user',
        content: caption ? `[Video] ${caption}` : '[Video]',
      }).catch((err) => console.warn('[telegram] Gagal simpan pesan video user:', err));

      const prompt = caption
        ? `User mengirim video dengan catatan: "${caption}". Tolong tanggapi catatan tersebut secara relevan, informatif, dan bersahabat.`
        : 'User mengirim pesan video. Sampaikan secara ramah bahwa videonya diterima, dan tanyakan apa yang ingin didiskusikan.';

      const { reply, via, tokens } = await autoReply(prompt, ctx);
      await sendTelegramMessageSafe(bot, chatId, reply);
      void saveMessage({
        platform: 'telegram',
        chat_id: chatKey,
        role: 'assistant',
        content: reply,
        via,
        tokens,
      }).catch((err) => console.warn('[telegram] Gagal simpan pesan video assistant:', err));
      noteExchange(chatKey);
      return;
    }

    // 9. Pesan teks umum
    if (!text || text.startsWith('/')) return;

    // Fast-path in-memory context (0ms saat aktif)
    const ctx = await getContext(chatKey);

    // Simpan pesan user ke database secara non-blocking & update cache in-memory
    updateContextCache(chatKey, 'user', text);
    void saveMessage({ platform: 'telegram', chat_id: chatKey, role: 'user', content: text })
      .catch((err) => console.warn('[telegram] Gagal simpan pesan user:', err));

    let web: string | null = null;
    if (needsSearch(text)) {
      const prevContext = ctx?.history?.slice(-3)?.map(h => h.content)?.join(' ') || '';
      const found = await searchWeb(text, prevContext);
      if (found) web = found;
    }
    const { reply, escalate, via, tokens } = await autoReply(text, ctx, web);
    await sendTelegramMessageSafe(bot, chatId, reply);

    // Update cache memori & simpan balasan asisten ke database secara non-blocking
    updateContextCache(chatKey, 'assistant', reply);
    void saveMessage({ platform: 'telegram', chat_id: chatKey, role: 'assistant', content: reply, via, tokens })
      .catch((err) => console.warn('[telegram] Gagal simpan pesan assistant:', err));
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
