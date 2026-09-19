import TelegramBot from 'node-telegram-bot-api';
import { config } from './env.js';
import { autoReply, describeImage, dynamicNotice, splitMessageSmart } from './skills.js';
import { transcribeAudio, processIncomingDocument, processIncomingSticker, processIncomingVideo } from './media.js';
import { saveMessage, isMessageProcessed, claimIncomingMessage, markMessageProcessed } from './db.js';
import { getContext, isResetCommand, noteExchange, resetSession, saveCorrection, updateContextCache, validateCorrection, withChatLock } from './memory.js';
import { fetchStickerBuffer, allowStickerForChat, hasStickerForEmoji, isEdgyStickerEmoji, isPlayfulContext, assistantTurnsSinceLastSticker, lastStickerEmoji, STICKER_MIN_TURNS_SINCE_LAST } from './stickers.js';
import { encodeMarkers } from './markers.js';
import { needsSearch, searchWeb } from './web.js';
import { handleRemind, startReminderWorker } from './remind.js';
import { resolveTimezoneFromCoords, formatInZone } from './timezone.js';

// Versi prompt untuk instrumentasi dataset (dipetakan ke kolom messages.prompt_version)
const PROMPT_VERSION = 'v0.40.0';

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

/**
 * Kirim stiker balasan bot (webp) via Telegram. Mengembalikan true bila terkirim.
 * Bila gagal (file tidak ada / error), caller mengirim emoji sebagai teks (fallback).
 */
export async function sendTelegramStickerSafe(
  bot: TelegramBot,
  chatId: number,
  emoji: string,
): Promise<boolean> {
  try {
    const buf = await fetchStickerBuffer(emoji);
    if (!buf) return false;
    await bot.sendSticker(chatId, buf, {}, { filename: 'sticker.webp', contentType: 'image/webp' });
    return true;
  } catch (err) {
    console.warn('[telegram] Gagal kirim stiker balasan:', err);
    return false;
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
  msgId?: string,
  msgSentAt?: Date,
): Promise<boolean> {
  const dl = await downloadTelegramBuffer(bot, fileId);
  if (!dl) return false;
  const mime = dl.filePath.endsWith('.png') ? 'image/png' : 'image/jpeg';
  const ctx = await getContext(chatKey, msgSentAt);
  const { reply, via, tokens } = await describeImage(dl.buffer.toString('base64'), mime, caption, ctx);
  await sendTelegramMessageSafe(bot, chatId, reply);
  if (msgId) void markMessageProcessed('telegram', msgId);
  await saveMessage({ platform: 'telegram', chat_id: chatKey, role: 'assistant', content: reply, via, tokens });
  noteExchange(chatKey);
  return true;
}

/**
 * Wrapper publik: serialkan pemrosesan per-chat agar balasan tidak keluar urutan
 * saat dua pesan tiba beruntun (audit F3.1). Handler inti dipakai bersama oleh
 * Polling lokal & Webhook Vercel.
 */
export async function handleIncomingMessage(bot: TelegramBot, msg: TelegramBot.Message): Promise<void> {
  const chatKey = msg.chat?.id ? String(msg.chat.id) : 'unknown';
  return withChatLock(`tg:${chatKey}`, () => handleIncomingMessageInner(bot, msg));
}

async function handleIncomingMessageInner(bot: TelegramBot, msg: TelegramBot.Message): Promise<void> {
  try {
    if (msg.from?.is_bot) return;
    const chatId = msg.chat.id;
    const chatType = msg.chat?.type;
    // Abaikan saluran siaran satu arah (channel)
    if (chatType === 'channel') return;

    const isGroup = chatType === 'group' || chatType === 'supergroup';
    const chatKey = String(chatId);
    const msgId = msg.message_id ? String(msg.message_id) : '';
    const ownerId = config.ownerChatId;
    const rawText = msg.text?.trim() ?? '';
    const rawCaption = msg.caption?.trim() ?? '';
    const msgSentAt = msg.date ? new Date(msg.date * 1000) : undefined;
    const botUsername = (config.telegramBotUsername || 'chatkita_bot').toLowerCase();
    const mentionRegex = new RegExp(`@${botUsername}\\b`, 'i');

    const senderName =
      [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(' ') ||
      msg.from?.username ||
      'Anggota Grup';

    // Cek apakah pesan di-reply ke pesan bot
    const isReplyToBot = Boolean(
      msg.reply_to_message?.from?.is_bot &&
      (msg.reply_to_message?.from?.username?.toLowerCase() === botUsername || !msg.reply_to_message?.from?.username)
    );

    // Cek mention bot pada teks atau caption
    const hasMentionInText = mentionRegex.test(rawText);
    const hasMentionInCaption = mentionRegex.test(rawCaption);
    const hasMention = hasMentionInText || hasMentionInCaption;
    const hasEntityMention = (msg.entities || msg.caption_entities || []).some((e) => {
      if (e.type !== 'mention') return false;
      const str = (rawText || rawCaption).slice(e.offset, e.offset + e.length).toLowerCase();
      return str === `@${botUsername}`;
    });

    // Cek perintah / command
    const cmdMatch = rawText.match(/^\/([a-zA-Z0-9_]+)(?:@([a-zA-Z0-9_]+))?/);
    let isTargetedCommand = false;
    if (cmdMatch) {
      const targetBot = cmdMatch[2]?.toLowerCase();
      if (targetBot) {
        if (targetBot !== botUsername) return; // Command spesifik untuk bot lain di grup -> abaikan
        isTargetedCommand = true;
      } else {
        const knownCommands = ['start', 'reset', 'clear', 'remind', 'salah', 'tanya', 'ai', 'help', 'bantuan'];
        if (!isGroup || knownCommands.includes(cmdMatch[1].toLowerCase())) {
          isTargetedCommand = true;
        }
      }
    }

    const hasPhoto = Boolean(msg.photo?.length);
    const hasVideo = Boolean(msg.video || msg.video_note);
    const hasDoc = Boolean(msg.document);
    const hasAudio = Boolean(msg.voice || msg.audio);
    const hasSticker = Boolean(msg.sticker);
    const hasMedia = hasPhoto || hasVideo || hasDoc || hasAudio || hasSticker;

    let isDirectedToBot = !isGroup;
    if (isGroup) {
      if (isTargetedCommand || hasMention || hasEntityMention || isReplyToBot) {
        isDirectedToBot = true;
      } else if (hasMedia) {
        // Untuk stiker di grup: wajib reply ke pesan bot
        if (hasSticker && isReplyToBot) {
          isDirectedToBot = true;
        } else if ((hasPhoto || hasVideo || hasDoc || hasAudio) && (hasMentionInCaption || isReplyToBot)) {
          isDirectedToBot = true;
        }
      }
    }

    // Jika di grup dan pesan BUKAN untuk bot: abaikan seketika (zero overhead, no DB claim)
    if (isGroup && !isDirectedToBot) {
      return;
    }

    // Bersihkan mention dan prefix command
    let text = rawText
      .replace(new RegExp(`@${botUsername}\\b`, 'gi'), '')
      .replace(/^\/(?:tanya|ai)(?:@\w+)?\s*/i, '')
      .replace(/^\/([a-zA-Z0-9_]+)@\w+/i, '/$1')
      .trim();

    let caption = rawCaption
      .replace(new RegExp(`@${botUsername}\\b`, 'gi'), '')
      .trim();

    // Tentukan konten awal pesan untuk klaim atomik agar teks asli dan jenis media langsung tercatat
    let initialContent = text;
    if (!initialContent) {
      if (hasPhoto) initialContent = caption ? (isGroup ? `[Gambar dari ${senderName}] ${caption}` : `[Gambar] ${caption}`) : (isGroup ? `[Gambar dari ${senderName}]` : '[Gambar]');
      else if (hasVideo) initialContent = caption ? (isGroup ? `[Video dari ${senderName}] ${caption}` : `[Video] ${caption}`) : (isGroup ? `[Video dari ${senderName}]` : '[Video]');
      else if (hasDoc) initialContent = `[Dokumen: ${msg.document?.file_name || 'berkas'}${isGroup ? ` dari ${senderName}` : ''}]`;
      else if (hasAudio) initialContent = `[Pesan Suara${isGroup ? ` dari ${senderName}` : ''}]`;
      else if (hasSticker) initialContent = `[Stiker Telegram${msg.sticker?.emoji ? `: ${msg.sticker.emoji}` : ''}${isGroup ? ` dari ${senderName}` : ''}]`;
      else if (msg.location) initialContent = `[Lokasi${isGroup ? ` dari ${senderName}` : ''}]`;
      else initialContent = isGroup ? `[Pesan dari ${senderName}]` : '[telegram-msg]';
    } else if (isGroup) {
      initialContent = `[${senderName}]: ${text}`;
    }

    if (msgId && !(await claimIncomingMessage('telegram', msgId, chatKey, initialContent))) return;

    // Anti-Stale Message Guard: abaikan pesan basi hasil retry Telegram webhook atau saat bot offline (> 180 detik)
    const nowSec = Math.floor(Date.now() / 1000);
    const msgDateSec = msg.date || 0;
    if (msgDateSec > 0 && (nowSec - msgDateSec) > 180) {
      console.warn(`[telegram] Mengabaikan pesan basi/retry (umur: ${nowSec - msgDateSec} detik, id: ${msgId}). Tandai selesai tanpa memanggil AI.`);
      if (msgId) void markMessageProcessed('telegram', msgId);
      return;
    }

    // 1. Perintah /start (sapaan 100% dinamis via LLM — ZERO teks statis)
    if (text === '/start') {
      try {
        const startCtx = await getContext(chatKey, msgSentAt);
        const { reply } = await autoReply(
          `User ${isGroup ? `di grup bersama ${senderName} ` : ''}baru menjalankan /start. Sapa dia secara dinamis dengan gayamu sendiri dan sebutkan singkat kemampuan utamamu (ngobrol, info internet real-time, baca dokumen/gambar/VN/stiker/video, /remind, /salah, /reset).` +
            (isGroup
              ? ` Sebutkan juga cara pakai di grup: tag @${botUsername} atau reply pesanmu, perintah /tanya dan /ai, /remind, /reset.`
              : ''),
          startCtx,
        );
        await sendTelegramMessageSafe(bot, chatId, reply);
      } catch {
        // diam — ZERO teks statis
      }
      if (msgId) void markMessageProcessed('telegram', msgId);
      return;
    }

    // 2. Perintah /salah <koreksi>
    if (text.startsWith('/salah')) {
      const rawCorrection = text.replace(/^\/salah\s*/, '').trim();
      const ctx = await getContext(chatKey, msgSentAt);
      if (!rawCorrection) {
        const { reply } = await autoReply('Jelaskan format perintah /salah dengan satu contoh singkat, santai, dan ramah.', ctx);
        await sendTelegramMessageSafe(bot, chatId, reply);
        if (msgId) void markMessageProcessed('telegram', msgId);
        return;
      }
      const check = validateCorrection(rawCorrection);
      if (!check.valid) {
        const { reply } = await autoReply(
          `User ${senderName} mencoba menggunakan perintah /salah dengan input: "${rawCorrection}". Tanggapi secara spontan, santai, dan bersahabat dengan gayamu sendiri bahwa perintah /salah hanya untuk preferensi personal dia (seperti nama panggilan atau domisili), bukan untuk mengubah identitas developer atau aturan/fakta objektif. DILARANG kaku dan jangan gunakan kalimat template!`,
          ctx,
        );
        await sendTelegramMessageSafe(bot, chatId, reply);
        if (msgId) void markMessageProcessed('telegram', msgId);
        return;
      }
      const saved = await saveCorrection(chatKey, isGroup ? `[${senderName}]: ${check.cleaned}` : check.cleaned);
      const { reply } = await autoReply(
        `User ${senderName} ${isGroup ? 'di grup ' : ''}menyimpan preferensi/koreksi personal: "${check.cleaned}". Konfirmasi secara spontan, singkat, santai, dan hangat dengan gayamu sendiri bahwa kamu mengingatnya. DILARANG template kaku!` +
          (saved ? '' : ' Catatan: penyimpanan permanen gagal — sampaikan singkat dan santai bahwa catatan mungkin tidak tersimpan lama.'),
        ctx,
      );
      await sendTelegramMessageSafe(bot, chatId, reply);
      if (msgId) void markMessageProcessed('telegram', msgId);
      return;
    }

    // 3. Perintah /remind <menit> <pesan>
    if (text.startsWith('/remind')) {
      const args = text.replace(/^\/remind\s*/, '').trim();
      await handleRemind(bot, chatId, args, 'telegram', isGroup ? senderName : undefined);
      if (msgId) void markMessageProcessed('telegram', msgId);
      return;
    }

    // 3b. Perintah /reset atau /clear atau reset sesi (konfirmasi 100% dinamis — ZERO teks statis)
    if (text && isResetCommand(text)) {
      await resetSession(chatKey, 'telegram');
      let resetReply = '';
      try {
        const resetCtx = await getContext(chatKey, msgSentAt);
        const { reply } = await autoReply(
          `Konfirmasi santai 1 kalimat dengan gayamu sendiri bahwa sesi ${isGroup ? `grup (diminta ${senderName}) ` : ''}sudah di-reset dan memori bersih.`,
          resetCtx,
        );
        if (reply.trim()) resetReply = reply;
      } catch {
        // diam — ZERO teks statis
      }
      await sendTelegramMessageSafe(bot, chatId, resetReply);
      if (msgId) void markMessageProcessed('telegram', msgId);
      await saveMessage({
        platform: 'telegram',
        chat_id: chatKey,
        role: 'assistant',
        content: resetReply,
        via: 'system/reset',
      }).catch((err) => console.warn('[telegram] Gagal simpan pesan reset assistant:', err));
      return;
    }

    // 4. Foto / Gambar
    if (msg.photo?.length) {
      const fileId = msg.photo[msg.photo.length - 1].file_id;
      const promptCaption = isGroup ? (caption ? `[Dari ${senderName}]: ${caption}` : `[Dari ${senderName}]`) : caption;
      await saveMessage({
        platform: 'telegram',
        chat_id: chatKey,
        role: 'user',
        content: promptCaption ? `[Gambar] ${promptCaption}` : '[Gambar]',
        msg_id: msgId || undefined,
      }).catch((err) => console.warn('[telegram] Gagal simpan pesan foto user:', err));
      try {
        if (await answerPhoto(bot, chatId, chatKey, fileId, promptCaption, msgId, msgSentAt)) return;
      } catch (err) {
        console.error(`[telegram] vision photo error: ${String((err as Error).message ?? err)}`);
      }
    }

    // 4b. Video (MP4 / WebM) via Google Gemini Multimodal
    if (msg.video) {
      const fileId = msg.video.file_id;
      const mime = msg.video.mime_type || 'video/mp4';
      const promptCaption = isGroup ? (caption ? `[Dari ${senderName}]: ${caption}` : `[Dari ${senderName}]`) : caption;
      await saveMessage({
        platform: 'telegram',
        chat_id: chatKey,
        role: 'user',
        content: promptCaption ? `[Video] ${promptCaption}` : '[Video]',
        msg_id: msgId || undefined,
      }).catch((err) => console.warn('[telegram] Gagal simpan pesan video user:', err));

      const dl = await downloadTelegramBuffer(bot, fileId);
      if (dl) {
        const { reply, via, tokens } = await processIncomingVideo(dl.buffer, mime, 'video.mp4', promptCaption, await getContext(chatKey, msgSentAt));
        await sendTelegramMessageSafe(bot, chatId, reply);
        if (msgId) void markMessageProcessed('telegram', msgId);
        await saveMessage({
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
      const promptCaption = isGroup ? (caption ? `[Dari ${senderName}]: ${caption}` : `[Dari ${senderName}]`) : caption;

      // Jika berkas berupa gambar tanpa kompresi
      if (mime.startsWith('image/')) {
        await saveMessage({
          platform: 'telegram',
          chat_id: chatKey,
          role: 'user',
          content: promptCaption ? `[Gambar: ${filename}] ${promptCaption}` : `[Gambar: ${filename}]`,
          msg_id: msgId || undefined,
        }).catch((err) => console.warn('[telegram] Gagal simpan pesan gambar doc user:', err));
        if (await answerPhoto(bot, chatId, chatKey, fileId, promptCaption, msgId, msgSentAt)) return;
      }

      // Berkas dokumen umum (PDF, DOCX, TXT, CSV, JSON, kode)
      await saveMessage({
        platform: 'telegram',
        chat_id: chatKey,
        role: 'user',
        content: `[Dokumen: ${filename}] ${promptCaption || ''}`.trim(),
        msg_id: msgId || undefined,
      }).catch((err) => console.warn('[telegram] Gagal simpan pesan doc user:', err));

      const dl = await downloadTelegramBuffer(bot, fileId);
      if (dl) {
        try {
          const ctx = await getContext(chatKey, msgSentAt);
          const { reply, via, tokens } = await processIncomingDocument(dl.buffer, mime, filename, promptCaption, ctx);
          await sendTelegramMessageSafe(bot, chatId, reply);
          if (msgId) void markMessageProcessed('telegram', msgId);
          await saveMessage({
            platform: 'telegram',
            chat_id: chatKey,
            role: 'assistant',
            content: reply,
            via,
            tokens,
          }).catch((err) => console.warn('[telegram] Gagal simpan pesan doc assistant:', err));
          noteExchange(chatKey);
        } catch (err) {
          console.error('[telegram] Gagal proses dokumen:', err);
          await sendTelegramMessageSafe(
            bot,
            chatId,
            await dynamicNotice(
              'Dokumen dari temanmu gagal diproses atau isinya tidak terbaca. Beri tahu dia dengan gayamu sendiri, singkat dan hangat, lalu minta kirim ulang atau ketik isinya lewat teks.',
              await getContext(chatKey, msgSentAt),
            ),
          );
        }
        return;
      }
      // Download gagal: beri tahu dinamis — jangan diamkan user tanpa balasan.
      await sendTelegramMessageSafe(
        bot,
        chatId,
        await dynamicNotice(
          'Dokumen dari temanmu gagal diunduh dari server Telegram. Beri tahu dia dengan gayamu sendiri, singkat dan hangat, lalu minta kirim ulang.',
          await getContext(chatKey, msgSentAt),
        ),
      );
      return;
    }

    // 6. Voice Note (VN) atau File Audio
    if (msg.voice || msg.audio) {
      const fileId = msg.voice ? msg.voice.file_id : msg.audio!.file_id;
      const mime = msg.voice ? (msg.voice.mime_type || 'audio/ogg') : (msg.audio?.mime_type || 'audio/mpeg');
      const dl = await downloadTelegramBuffer(bot, fileId);

      if (dl) {
        try {
          const transcription = await transcribeAudio(dl.buffer, mime);
          const ctx = await getContext(chatKey, msgSentAt);

          const savedContent = isGroup ? `[Voice Note dari ${senderName}]: "${transcription}"` : `[Voice Note]: "${transcription}"`;
          await saveMessage({
            platform: 'telegram',
            chat_id: chatKey,
            role: 'user',
            content: savedContent,
            msg_id: msgId || undefined,
          }).catch((err) => console.warn('[telegram] Gagal simpan pesan VN user:', err));

          let web: string | null = null;
          if (needsSearch(transcription)) {
            try {
              const prevContext = ctx?.history?.slice(-3)?.map(h => h.content)?.join(' ') || '';
              const found = await searchWeb(transcription, prevContext);
              if (found) web = found;
            } catch (err) {
              console.warn('[telegram] Gagal penelusuran web audio:', err);
            }
          }

          const prompt = isGroup
            ? `[Pesan Suara / Voice Note di Grup dari ${senderName}]: "${transcription}"\n(Kamu mendengar rekaman suara ini secara jernih di grup. Tanggapi langsung apa yang dibicarakan ${senderName} secara wajar, hangat, dan bersahabat).`
            : `[Pesan Suara / Voice Note dari Temanmu]: "${transcription}"\n(Kamu mendengar rekaman suara ini secara jernih. Tanggapi langsung apa yang dibicarakan temanmu secara wajar, hangat, dan bersahabat).`;
          const { reply, via, tokens } = await autoReply(prompt, ctx, web);
          await sendTelegramMessageSafe(bot, chatId, reply);
          if (msgId) void markMessageProcessed('telegram', msgId);
          await saveMessage({
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
            await dynamicNotice(
              'Rekaman suara dari temanmu gagal diproses atau tidak terdengar jelas. Beri tahu dia dengan gayamu sendiri, singkat dan hangat, lalu minta kirim ulang atau ketik lewat teks.',
              await getContext(chatKey, msgSentAt),
            ),
          );
        }
        return;
      }
      // Download gagal: beri tahu dinamis — jangan diamkan user tanpa balasan.
      await sendTelegramMessageSafe(
        bot,
        chatId,
        await dynamicNotice(
          'Rekaman suara dari temanmu gagal diunduh dari server Telegram. Beri tahu dia dengan gayamu sendiri, singkat dan hangat, lalu minta kirim ulang atau ketik lewat teks.',
          await getContext(chatKey, msgSentAt),
        ),
      );
      return;
    }

    // 6b. Lokasi Pengguna (Location Pin / Live Location)
    if (msg.location) {
      const lat = msg.location.latitude;
      const lon = msg.location.longitude;
      const tzInfo = resolveTimezoneFromCoords(lat, lon);
      const locPrefix = isGroup ? `[Lokasi dari ${senderName}]: ` : 'Lokasi pengguna berada di ';
      await saveCorrection(chatKey, `${locPrefix}koordinat (${lat.toFixed(4)}, ${lon.toFixed(4)}) - Zona Waktu: ${tzInfo.label}`);
      const locTime = formatInZone(new Date(), tzInfo.zone);
      // Konfirmasi 100% dinamis: model menyusun kalimatnya sendiri dari data waktu (ZERO teks statis)
      const reply = await dynamicNotice(
        `Temanmu ${isGroup ? `(di grup) ${senderName} ` : ''}baru membagikan lokasi: ${tzInfo.label}. Waktu setempat saat ini ${locTime.time} ${locTime.tzName} (${locTime.full}). Konfirmasi singkat dengan gayamu sendiri bahwa lokasinya sudah dicatat dan sebutkan waktu setempat itu; nyatakan kamu akan mengingat lokasinya.`,
        await getContext(chatKey, msgSentAt),
      );
      await sendTelegramMessageSafe(bot, chatId, reply);
      if (msgId) void markMessageProcessed('telegram', msgId);
      await saveMessage({ platform: 'telegram', chat_id: chatKey, role: 'assistant', content: reply })
        .catch((err) => console.warn('[telegram] Gagal simpan pesan lokasi assistant:', err));
      return;
    }

    // 7. Stiker Telegram
    if (msg.sticker) {
      const emoji = msg.sticker.emoji;
      const ctx = await getContext(chatKey, msgSentAt);

      const savedStickerContent = isGroup
        ? `[Stiker Telegram dari ${senderName}${emoji ? `: ${emoji}` : ''}]`
        : `[Stiker Telegram${emoji ? `: ${emoji}` : ''}]`;

      await saveMessage({
        platform: 'telegram',
        chat_id: chatKey,
        role: 'user',
        content: savedStickerContent,
        msg_id: msgId || undefined,
      }).catch((err) => console.warn('[telegram] Gagal simpan pesan stiker user:', err));

      // Jika stiker statis (WebP), kita kirim ke Vision
      if (!msg.sticker.is_animated && !msg.sticker.is_video) {
        const dl = await downloadTelegramBuffer(bot, msg.sticker.file_id);
        if (dl) {
          const { reply, via, tokens } = await processIncomingSticker(dl.buffer, 'image/webp', emoji, ctx);
          await sendTelegramMessageSafe(bot, chatId, reply);
          if (msgId) void markMessageProcessed('telegram', msgId);
          await saveMessage({
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
      const prompt = isGroup
        ? `Pengguna ${senderName} di grup mengirim stiker Telegram dengan ekspresi emoji "${emoji || 'ekspresi'}". Tanggapi makna atau emosinya secara hangat, santai, dan bersahabat layaknya sahabat.`
        : `Pengguna mengirim stiker Telegram dengan ekspresi emoji "${emoji || 'ekspresi'}". Tanggapi makna atau emosinya secara hangat, santai, dan bersahabat layaknya seorang sahabat mengobrol.`;
      const { reply, via, tokens } = await autoReply(prompt, ctx);
      await sendTelegramMessageSafe(bot, chatId, reply);
      if (msgId) void markMessageProcessed('telegram', msgId);
      await saveMessage({
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
      const promptCaption = isGroup ? (caption ? `[Dari ${senderName}]: ${caption}` : `[Dari ${senderName}]`) : caption;
      const ctx = await getContext(chatKey, msgSentAt);

      await saveMessage({
        platform: 'telegram',
        chat_id: chatKey,
        role: 'user',
        content: promptCaption ? `[Video] ${promptCaption}` : '[Video]',
        msg_id: msgId || undefined,
      }).catch((err) => console.warn('[telegram] Gagal simpan pesan video user:', err));

      const prompt = promptCaption
        ? (isGroup ? `Pengguna ${senderName} di grup mengirim video dengan catatan: "${promptCaption}". Tolong tanggapi secara relevan, hangat, dan bersahabat.` : `User mengirim video dengan catatan: "${promptCaption}". Tolong tanggapi catatan tersebut secara relevan, informatif, dan bersahabat.`)
        : (isGroup ? `Pengguna ${senderName} di grup mengirim pesan video. Sampaikan secara ramah bahwa videonya diterima, dan tanyakan apa yang ingin dibahas.` : 'User mengirim pesan video. Sampaikan secara ramah bahwa videonya diterima, dan tanyakan apa yang ingin didiskusikan.');

      const { reply, via, tokens } = await autoReply(prompt, ctx);
      await sendTelegramMessageSafe(bot, chatId, reply);
      if (msgId) void markMessageProcessed('telegram', msgId);
      await saveMessage({
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
    if (!text) {
      if (isGroup) {
        // Pengguna men-tag bot di grup tanpa ada teks lanjutan
        const prompt = `Pengguna ${senderName} memanggil atau men-tag kamu di grup Telegram. Sapa dia secara hangat, santai, dan tanyakan apa yang bisa kamu bantu di grup ini.`;
        const ctx = await getContext(chatKey, msgSentAt);
        const { reply, via, tokens } = await autoReply(prompt, ctx);
        await sendTelegramMessageSafe(bot, chatId, reply);
        if (msgId) void markMessageProcessed('telegram', msgId);
        await saveMessage({
          platform: 'telegram',
          chat_id: chatKey,
          role: 'assistant',
          content: reply,
          via,
          tokens,
        }).catch((e) => console.warn('[telegram] Gagal simpan sapaan tag grup:', e));
        return;
      }
      return;
    }

    if (text.startsWith('/')) return;

    // Fast-path in-memory context (0ms saat aktif)
    const ctx = await getContext(chatKey, msgSentAt);

    const promptText = isGroup ? `[Pesan di Grup dari ${senderName}]: ${text}` : text;
    const savedUserContent = isGroup ? `[${senderName}]: ${text}` : text;

    // Update cache in-memory & pastikan pesan teks user tersimpan (non-blocking agar autoReply langsung jalan)
    updateContextCache(chatKey, 'user', savedUserContent);
    void saveMessage({
      platform: 'telegram',
      chat_id: chatKey,
      role: 'user',
      content: savedUserContent,
      msg_id: msgId || undefined,
    }).catch((err) => console.warn('[telegram] Gagal sinkronisasi pesan user:', err));

    let web: string | null = null;
    if (needsSearch(text)) {
      try {
        const prevContext = ctx?.history?.slice(-3)?.map(h => h.content)?.join(' ') || '';
        const found = await searchWeb(text, prevContext);
        if (found) web = found;
      } catch (err) {
        console.warn('[telegram] Gagal penelusuran web:', err);
      }
    }
    const tStart = Date.now();
    const { reply, escalate, via, tokens, sticker, riddleAnswer } = await autoReply(promptText, ctx, web);
    const latencyMs = Date.now() - tStart;
    await sendTelegramMessageSafe(bot, chatId, reply);
    // Stiker balasan (opsional) — hormati cooldown DURABLE (riwayat chat) + fast-path lokal.
    // Emoji "keras" (🖕/🤬/👊) hanya boleh saat konteks bercanda (user bercanda/roasting dulu).
    const edgyOk = !isEdgyStickerEmoji(sticker || '') || isPlayfulContext(text || rawText);
    // Cooldown DURABLE: minimal N balasan sejak stiker terakhir + emoji tidak boleh sama beruntun.
    const turnsSinceSticker = assistantTurnsSinceLastSticker(ctx?.history);
    const prevStickerEmoji = lastStickerEmoji(ctx?.history);
    let stickerSent = false;
    if (
      sticker &&
      reply.trim() &&
      edgyOk &&
      turnsSinceSticker >= STICKER_MIN_TURNS_SINCE_LAST &&
      sticker !== prevStickerEmoji &&
      hasStickerForEmoji(sticker) &&
      allowStickerForChat(`tg:${chatKey}`)
    ) {
      const sent = await sendTelegramStickerSafe(bot, chatId, sticker);
      if (!sent) {
        // Fallback: stiker gagal terkirim -> emoji sebagai teks (konten dari model).
        await sendTelegramMessageSafe(bot, chatId, sticker);
      } else {
        stickerSent = true;
      }
    }
    if (msgId) void markMessageProcessed('telegram', msgId);

    // Update cache memori & simpan balasan asisten ke database secara synchronous (terjamin terekam di serverless)
    updateContextCache(
      chatKey,
      'assistant',
      riddleAnswer
        ? `${reply}\n[Jawaban: ${riddleAnswer}]${stickerSent && sticker ? `\n[Stiker terkirim: ${sticker}]` : ''}`
        : stickerSent && sticker
          ? `${reply}\n[Stiker terkirim: ${sticker}]`
          : reply,
    );
    await saveMessage({
      platform: 'telegram',
      chat_id: chatKey,
      role: 'assistant',
      content: reply,
      via,
      tokens,
      latency_ms: latencyMs,
      needs_search: web !== null,
      prompt_version: PROMPT_VERSION,
      // Sinyal durable: emoji stiker yang benar-benar terkirim (anti-overuse) dan
      // jawaban benar tebakan (agar model giliran berikutnya menilai secara jujur).
      feedback: encodeMarkers({
        sticker: stickerSent && sticker ? sticker : undefined,
        riddle: riddleAnswer || undefined,
      }),
    }).catch((err) => console.warn('[telegram] Gagal simpan pesan assistant:', err));
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
      const { reply, via, tokens } = await autoReply(
        'Terjadi kendala teknis saat memproses pesan temanmu barusan. Sampaikan permintaan maaf singkat dengan gayamu sendiri dan tawarkan agar dia mengirim ulang pesannya.',
      );
      await sendTelegramMessageSafe(bot, msg.chat.id, reply);
      await saveMessage({
        platform: 'telegram',
        chat_id: String(msg.chat.id),
        role: 'assistant',
        content: reply,
        via,
        tokens,
      }).catch((e) => console.warn('[telegram] Gagal simpan fallback assistant:', e));
    } catch {
      // abaikan
    }
  }
}

/** Eksekusi Telegram Webhook Update (dipanggil oleh /api/webhook) */
export async function processTelegramUpdate(bot: TelegramBot, update: TelegramBot.Update): Promise<void> {
  const updId = update.update_id ? `upd_${update.update_id}` : '';
  if (updId && (await isMessageProcessed('telegram', updId))) return;

  if (update.message) {
    await handleIncomingMessage(bot, update.message);
  } else if (update.edited_message) {
    await handleIncomingMessage(bot, update.edited_message);
  }
  if (updId) void markMessageProcessed('telegram', updId);
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
