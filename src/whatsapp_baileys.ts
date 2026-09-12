import path from 'path';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  downloadMediaMessage,
  type WASocket,
  type WAMessage,
} from '@whiskeysockets/baileys';
import { config, assertRuntime } from './env.js';
import { autoReply, describeImage } from './skills.js';
import { transcribeAudio, processIncomingDocument, processIncomingSticker, processIncomingVideo } from './media.js';
import { saveMessage } from './db.js';
import { getContext, noteExchange, saveCorrection, updateContextCache } from './memory.js';
import { needsSearch, searchWeb } from './web.js';
import { resolveTimezoneFromCoords, formatInZone } from './timezone.js';
import {
  restoreSessionFromSupabase,
  syncSessionDirToSupabase,
  clearSessionInSupabase,
} from './whatsapp_session.js';

const logger = pino({ level: 'silent' });
const sessionDir = path.resolve(process.cwd(), 'session_wa');

/**
 * Mengirim pesan teks ke WhatsApp dengan pemecahan otomatis di batas paragraf
 * jika panjang pesan melebihi limit 4000 karakter.
 */
export async function sendWhatsAppMessageSafe(
  sock: WASocket,
  jid: string,
  text: string,
): Promise<void> {
  if (!text) return;
  const maxLen = 4000;

  if (text.length <= maxLen) {
    await sock.sendMessage(jid, { text });
    return;
  }

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
    await sock.sendMessage(jid, { text: chunk });
    if (chunks.length > 1) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
}

/**
 * Memulai instance WhatsApp Multi-Device Baileys dengan persistensi sesi ke Supabase.
 */
export async function startWhatsApp(): Promise<void> {
  assertRuntime('whatsapp');

  console.log('[whatsapp] Memeriksa sesi tersimpan di Supabase...');
  await restoreSessionFromSupabase(sessionDir);

  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

  const sock = makeWASocket({
    auth: state,
    logger,
    printQRInTerminal: false,
    defaultQueryTimeoutMs: 60000,
  });

  // 1. Simpan perubahan kredensial ke disk lokal dan sinkronkan ke Supabase
  sock.ev.on('creds.update', async () => {
    await saveCreds();
    await syncSessionDirToSupabase(sessionDir);
  });

  // Jika nomor telepon disediakan dan belum terdaftar, gunakan Pairing Code 8-digit
  if (config.whatsappPhoneNumber && !state.creds.registered) {
    let cleanNumber = config.whatsappPhoneNumber.replace(/\D/g, '');
    if (cleanNumber.startsWith('0')) cleanNumber = '62' + cleanNumber.slice(1);

    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(cleanNumber);
        console.log('\n======================================================');
        console.log(`KODE PAIRING WHATSAPP: ${code}`);
        console.log('======================================================');
        console.log(`1. Buka WhatsApp di HP (${cleanNumber})`);
        console.log('2. Ketuk Titik Tiga / Pengaturan -> Perangkat Tertaut');
        console.log('3. Ketuk "Tautkan Perangkat" -> pilih "Tautkan dengan nomor telepon saja"');
        console.log(`4. Masukkan kode di atas: ${code}\n`);
      } catch (err) {
        console.warn('[whatsapp] Gagal meminta kode pairing, beralih ke QR Code:', err);
      }
    }, 3000);
  }

  // 2. Tangani status koneksi (QR, Open, Close / Reconnect)
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      if (!config.whatsappPhoneNumber) {
        console.log('\n======================================================');
        console.log('PINDAI QR CODE WHATSAPP INI DARI HP ANDA (NOMOR BOT)');
        console.log('======================================================\n');
        qrcode.generate(qr, { small: true });
        console.log('\nPanduan: Buka WhatsApp di HP -> Titik Tiga / Pengaturan -> Perangkat Tertaut -> Tautkan Perangkat.\n');
      } else {
        console.log('[whatsapp] QR Code alternatif tersedia (atau gunakan kode pairing di atas):');
        qrcode.generate(qr, { small: true });
      }
    }

    if (connection === 'open') {
      console.log('[whatsapp] Berhasil terhubung ke jaringan WhatsApp.');
      console.log('[whatsapp] Bot siap menerima dan membalas pesan 24 jam nonstop.');
      await syncSessionDirToSupabase(sessionDir);
    }

    if (connection === 'close') {
      const statusCode = (lastDisconnect?.error as { output?: { statusCode?: number } })?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log(`[whatsapp] Koneksi terputus (status: ${statusCode}). Reconnect: ${shouldReconnect}`);

      if (shouldReconnect) {
        console.log('[whatsapp] Menyambung ulang dalam 3 detik...');
        setTimeout(() => {
          void startWhatsApp();
        }, 3000);
      } else {
        console.warn('[whatsapp] Sesi logout permanen oleh pengguna. Membersihkan sesi Supabase...');
        await clearSessionInSupabase();
        console.log('[whatsapp] Sesi telah direset. Silakan restart bot untuk scan QR baru.');
      }
    }
  });

  // 3. Tangani pesan masuk (teks dan gambar)
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const m of messages) {
      try {
        await handleIncomingWAMessage(sock, m);
      } catch (err) {
        console.error('[whatsapp] Error saat menangani pesan:', err);
      }
    }
  });
}

/**
 * Handler pemrosesan tiap pesan WhatsApp masuk.
 */
async function handleIncomingWAMessage(sock: WASocket, m: WAMessage): Promise<void> {
  // Abaikan pesan yang dikirim oleh bot sendiri
  if (m.key.fromMe) return;

  const remoteJid = m.key.remoteJid;
  if (!remoteJid || remoteJid === 'status@broadcast') return;

  const isGroup = remoteJid.endsWith('@g.us');

  // Ekstrak teks atau caption dari berbagai tipe pesan
  let text =
    m.message?.conversation ||
    m.message?.extendedTextMessage?.text ||
    m.message?.imageMessage?.caption ||
    m.message?.documentMessage?.caption ||
    m.message?.videoMessage?.caption ||
    '';
  text = text.trim();

  const hasImage = !!m.message?.imageMessage;
  const hasDoc = !!m.message?.documentMessage;
  const hasAudio = !!m.message?.audioMessage;
  const hasSticker = !!m.message?.stickerMessage;
  const hasVideo = !!m.message?.videoMessage;

  // Jika di dalam grup, periksa apakah bot diizinkan merespons grup
  if (isGroup && !config.whatsappRespondGroups) {
    return;
  }

  // Jika ada prefix khusus yang diset di environment, periksa apakah pesan cocok
  if (config.whatsappPrefix) {
    if (!text.toLowerCase().startsWith(config.whatsappPrefix.toLowerCase())) {
      return;
    }
    // Hapus prefix dari teks pertanyaan
    text = text.slice(config.whatsappPrefix.length).trim();
  }

  // Kirim tanda centang biru (read receipt)
  try {
    await sock.readMessages([m.key]);
  } catch {
    // best-effort
  }

  const chatKey = 'wa_' + remoteJid;

  // Kasus 1: Pesan berupa Gambar / Foto
  if (hasImage) {
    try {
      await sock.sendPresenceUpdate('composing', remoteJid);
      const buffer = await downloadMediaMessage(
        m,
        'buffer',
        {},
        {
          logger,
          reuploadRequest: sock.updateMediaMessage,
        },
      );

      if (buffer && buffer.length > 0 && buffer.length <= 20_000_000) {
        const mime = m.message?.imageMessage?.mimetype || 'image/jpeg';
        const base64 = buffer.toString('base64');
        await saveMessage({
          platform: 'whatsapp',
          chat_id: chatKey,
          role: 'user',
          content: text ? `[Gambar] ${text}` : '[Gambar]',
        });

        const { reply, via } = await describeImage(base64, mime, text || undefined);
        await sendWhatsAppMessageSafe(sock, remoteJid, reply);
        await saveMessage({
          platform: 'whatsapp',
          chat_id: chatKey,
          role: 'assistant',
          content: reply.slice(0, 4000),
          via,
        });
        noteExchange(chatKey);
        return;
      }
    } catch (err) {
      console.error('[whatsapp] Gagal memproses gambar:', err);
    } finally {
      try {
        await sock.sendPresenceUpdate('paused', remoteJid);
      } catch {
        // best-effort
      }
    }
  }

  // Kasus 2: Dokumen (PDF, Word .docx, Teks, CSV, JSON, Kode)
  if (hasDoc) {
    try {
      await sock.sendPresenceUpdate('composing', remoteJid);
      const buffer = await downloadMediaMessage(
        m,
        'buffer',
        {},
        {
          logger,
          reuploadRequest: sock.updateMediaMessage,
        },
      );

      if (buffer && buffer.length > 0 && buffer.length <= 20_000_000) {
        const filename = m.message?.documentMessage?.fileName || 'dokumen';
        const mime = m.message?.documentMessage?.mimetype || 'application/octet-stream';
        const caption = m.message?.documentMessage?.caption?.trim() || text || undefined;
        const context = await getContext(chatKey);

        await saveMessage({
          platform: 'whatsapp',
          chat_id: chatKey,
          role: 'user',
          content: `[Dokumen: ${filename}] ${caption || ''}`.trim(),
        });

        const { reply, via } = await processIncomingDocument(
          buffer,
          mime,
          filename,
          caption,
          context,
        );

        await sendWhatsAppMessageSafe(sock, remoteJid, reply);
        await saveMessage({
          platform: 'whatsapp',
          chat_id: chatKey,
          role: 'assistant',
          content: reply.slice(0, 4000),
          via,
        });
        noteExchange(chatKey);
        return;
      }
    } catch (err) {
      console.error('[whatsapp] Gagal memproses dokumen:', err);
    } finally {
      try {
        await sock.sendPresenceUpdate('paused', remoteJid);
      } catch {
        // best-effort
      }
    }
  }

  // Kasus 3: Voice Note / Rekaman Audio
  if (hasAudio) {
    try {
      await sock.sendPresenceUpdate('composing', remoteJid);
      const buffer = await downloadMediaMessage(
        m,
        'buffer',
        {},
        {
          logger,
          reuploadRequest: sock.updateMediaMessage,
        },
      );

      if (buffer && buffer.length > 0 && buffer.length <= 20_000_000) {
        const mime = m.message?.audioMessage?.mimetype || 'audio/ogg';
        try {
          const transcription = await transcribeAudio(buffer, mime);
          const context = await getContext(chatKey);

          await saveMessage({
            platform: 'whatsapp',
            chat_id: chatKey,
            role: 'user',
            content: `[Voice Note]: "${transcription}"`,
          });

          let webResults: string | null = null;
          if (needsSearch(transcription)) {
            try {
              const prevContext = context?.history?.slice(-3)?.map(h => h.content)?.join(' ') || '';
              webResults = await searchWeb(transcription, prevContext);
            } catch (err) {
              console.warn('[whatsapp] Gagal penelusuran web audio:', err);
            }
          }

          const prompt = `[Pesan Suara / Voice Note dari Temanmu]: "${transcription}"\n(Kamu mendengar rekaman suara ini secara jernih. Tanggapi langsung apa yang dibicarakan temanmu secara wajar, hangat, dan bersahabat).`;
          const { reply, via } = await autoReply(prompt, context, webResults);
          await sendWhatsAppMessageSafe(sock, remoteJid, reply);
          await saveMessage({
            platform: 'whatsapp',
            chat_id: chatKey,
            role: 'assistant',
            content: reply.slice(0, 4000),
            via,
          });
          noteExchange(chatKey);
          return;
        } catch (err) {
          console.error('[whatsapp] Gagal transkripsi audio/VN:', err);
          await sendWhatsAppMessageSafe(
            sock,
            remoteJid,
            'Suara dalam rekaman audio tidak terdengar jelas atau kosong. Boleh tolong kirim ulang atau sampaikan melalui teks?',
          );
          return;
        }
      }
    } catch (err) {
      console.error('[whatsapp] Gagal memproses audio:', err);
    } finally {
      try {
        await sock.sendPresenceUpdate('paused', remoteJid);
      } catch {
        // best-effort
      }
    }
  }

  // Kasus 4: Stiker WhatsApp (.webp)
  if (hasSticker) {
    try {
      await sock.sendPresenceUpdate('composing', remoteJid);
      const buffer = await downloadMediaMessage(
        m,
        'buffer',
        {},
        {
          logger,
          reuploadRequest: sock.updateMediaMessage,
        },
      );

      if (buffer && buffer.length > 0 && buffer.length <= 20_000_000) {
        const mime = m.message?.stickerMessage?.mimetype || 'image/webp';
        const context = await getContext(chatKey);

        await saveMessage({
          platform: 'whatsapp',
          chat_id: chatKey,
          role: 'user',
          content: '[Stiker WhatsApp]',
        });

        const { reply, via } = await processIncomingSticker(buffer, mime, undefined, context);
        await sendWhatsAppMessageSafe(sock, remoteJid, reply);
        await saveMessage({
          platform: 'whatsapp',
          chat_id: chatKey,
          role: 'assistant',
          content: reply.slice(0, 4000),
          via,
        });
        noteExchange(chatKey);
        return;
      }
    } catch (err) {
      console.error('[whatsapp] Gagal memproses stiker:', err);
    } finally {
      try {
        await sock.sendPresenceUpdate('paused', remoteJid);
      } catch {
        // best-effort
      }
    }
  }

  // Kasus 5: Video via Google Gemini Multimodal API
  if (hasVideo) {
    try {
      await sock.sendPresenceUpdate('composing', remoteJid);
      const caption = m.message?.videoMessage?.caption?.trim() || text;
      const context = await getContext(chatKey);

      await saveMessage({
        platform: 'whatsapp',
        chat_id: chatKey,
        role: 'user',
        content: caption ? `[Video] ${caption}` : '[Video]',
      });

      const buffer = await downloadMediaMessage(
        m,
        'buffer',
        {},
        {
          logger,
          reuploadRequest: sock.updateMediaMessage,
        },
      );

      if (buffer && buffer.length > 0 && buffer.length <= 20_000_000) {
        const mime = m.message?.videoMessage?.mimetype || 'video/mp4';
        const { reply, via } = await processIncomingVideo(buffer, mime, 'video.mp4', caption);
        await sendWhatsAppMessageSafe(sock, remoteJid, reply);
        await saveMessage({
          platform: 'whatsapp',
          chat_id: chatKey,
          role: 'assistant',
          content: reply.slice(0, 4000),
          via,
        });
        noteExchange(chatKey);
        return;
      }

      const prompt = caption
        ? `User mengirim video dengan catatan: "${caption}". Tolong tanggapi catatan tersebut secara relevan, informatif, dan bersahabat.`
        : 'User mengirim berkas video. Beritahukan dengan ramah bahwa videonya diterima, dan tanyakan apa yang ingin dibahas.';

      const { reply, via } = await autoReply(prompt, context);
      await sendWhatsAppMessageSafe(sock, remoteJid, reply);
      await saveMessage({
        platform: 'whatsapp',
        chat_id: chatKey,
        role: 'assistant',
        content: reply.slice(0, 4000),
        via,
      });
      noteExchange(chatKey);
      return;
    } catch (err) {
      console.error('[whatsapp] Gagal memproses video:', err);
    } finally {
      try {
        await sock.sendPresenceUpdate('paused', remoteJid);
      } catch {
        // best-effort
      }
    }
  }

  // Kasus 6: Lokasi Pengguna (Share Location Pin / Live Location)
  const locMsg = m.message?.locationMessage || m.message?.liveLocationMessage;
  if (locMsg) {
    const lat = locMsg.degreesLatitude;
    const lon = locMsg.degreesLongitude;
    if (typeof lat === 'number' && typeof lon === 'number') {
      const tzInfo = resolveTimezoneFromCoords(lat, lon);
      await saveCorrection(chatKey, `Lokasi pengguna berada di koordinat (${lat.toFixed(4)}, ${lon.toFixed(4)}) - Zona Waktu: ${tzInfo.label}`);
      const locTime = formatInZone(new Date(), tzInfo.zone);
      const reply = `Lokasimu berhasil aku catat di ${tzInfo.label}. Waktu setempat di lokasimu saat ini adalah *${locTime.time} ${locTime.tzName}* (${locTime.full}). Mulai sekarang aku akan selalu mengingat waktu lokasimu.`;
      await sendWhatsAppMessageSafe(sock, remoteJid, reply);
      await saveMessage({
        platform: 'whatsapp',
        chat_id: chatKey,
        role: 'assistant',
        content: reply.slice(0, 4000),
      });
      noteExchange(chatKey);
      return;
    }
  }

  // Kasus 2: Pesan Teks
  if (!text) return;

  // Berikan indikator sedang mengetik (composing)
  try {
    await sock.sendPresenceUpdate('composing', remoteJid);
  } catch {
    // best-effort
  }

  try {
    // 1. Ambil konteks percakapan sebelumnya (fast-path 0ms in-memory cache jika sesi aktif, atau Supabase)
    const context = await getContext(chatKey);

    // 2. Simpan pesan user ke basis data secara non-blocking & update cache memori
    updateContextCache(chatKey, 'user', text);
    void saveMessage({
      platform: 'whatsapp',
      chat_id: chatKey,
      role: 'user',
      content: text,
    }).catch((err) => console.warn('[whatsapp] Gagal simpan pesan user:', err));

    // 3. Periksa kebutuhan penelusuran web real-time 2026
    let webResults: string | null = null;
    if (needsSearch(text)) {
      try {
        const prevContext = context?.history?.slice(-3)?.map(h => h.content)?.join(' ') || '';
        webResults = await searchWeb(text, prevContext);
      } catch (err) {
        console.warn('[whatsapp] Gagal penelusuran web:', err);
      }
    }

    // 4. Panggil model AI universal (Urutan rolling model dipertahankan 100%)
    const { reply, via } = await autoReply(text, context, webResults);

    // 5. Kirim balasan ke WhatsApp secepat mungkin
    await sendWhatsAppMessageSafe(sock, remoteJid, reply);

    // 6. Update cache memori & simpan balasan asisten ke database secara non-blocking
    updateContextCache(chatKey, 'assistant', reply);
    void saveMessage({
      platform: 'whatsapp',
      chat_id: chatKey,
      role: 'assistant',
      content: reply.slice(0, 4000),
      via,
    }).catch((err) => console.warn('[whatsapp] Gagal simpan pesan assistant:', err));

    // 7. Hitung pertukaran pesan untuk auto-summary per 20 chat
    noteExchange(chatKey);
  } catch (err) {
    console.error('[whatsapp] Gagal menghasilkan balasan AI:', err);
    await sock.sendMessage(remoteJid, {
      text: 'Maaf, terjadi kendala teknis saat memproses pesan Anda. Silakan coba sesaat lagi.',
    });
  } finally {
    try {
      await sock.sendPresenceUpdate('paused', remoteJid);
    } catch {
      // best-effort
    }
  }
}

// Jika dijalankan langsung sebagai entrypoint file
if (process.argv[1] && process.argv[1].includes('whatsapp_baileys')) {
  void startWhatsApp();

  const stop = () => {
    console.log('\n[whatsapp] Proses dihentikan.');
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
