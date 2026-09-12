import crypto from 'crypto';
import { config } from './env.js';
import { autoReply, describeImage } from './skills.js';
import { transcribeAudio, processIncomingDocument, processIncomingSticker } from './media.js';
import { saveMessage } from './db.js';
import { getContext, noteExchange, saveCorrection, updateContextCache } from './memory.js';
import { needsSearch, searchWeb } from './web.js';
import { resolveTimezoneFromCoords, formatInZone } from './timezone.js';

// Cache deduplikasi pesan (mencegah Meta webhook retry memproses pesan 2 kali)
const processedMessageIds = new Map<string, number>();

function isDuplicate(messageId: string): boolean {
  const now = Date.now();
  // Bersihkan ID yang lebih dari 15 menit
  for (const [id, time] of processedMessageIds.entries()) {
    if (now - time > 900000) processedMessageIds.delete(id);
  }
  if (processedMessageIds.has(messageId)) return true;
  processedMessageIds.set(messageId, now);
  return false;
}

/**
 * Verifikasi GET Handshake dari Meta saat pertama kali mendaftarkan Webhook URL.
 */
export function verifyWhatsAppWebhook(
  mode: string | undefined,
  token: string | undefined,
  challenge: string | undefined,
): { ok: boolean; challenge?: string } {
  if (mode === 'subscribe' && token === config.whatsappVerifyToken && challenge) {
    return { ok: true, challenge };
  }
  return { ok: false };
}

/**
 * Verifikasi signature HMAC-SHA256 dari header `x-hub-signature-256` Meta.
 */
export function verifyWhatsAppSignature(
  signature: string | undefined,
  rawBody: string,
): boolean {
  if (!config.whatsappAppSecret) return true; // Opsional jika belum diset
  if (!signature || !signature.startsWith('sha256=')) return false;

  const expected =
    'sha256=' +
    crypto
      .createHmac('sha256', config.whatsappAppSecret)
      .update(rawBody)
      .digest('hex');

  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Mengirim balasan teks melalui Meta WhatsApp Cloud API dengan pemecahan aman.
 */
export async function sendWhatsAppCloudMessageSafe(
  to: string,
  text: string,
): Promise<void> {
  if (!text || !config.whatsappToken || !config.whatsappPhoneNumberId) {
    console.warn('[wa-cloud] Token atau PhoneNumberId belum diset di environment.');
    return;
  }

  const maxLen = 4000;
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

  const url = `https://graph.facebook.com/v21.0/${config.whatsappPhoneNumberId}/messages`;

  for (const chunk of chunks) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.whatsappToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to,
          type: 'text',
          text: { preview_url: false, body: chunk },
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        console.error(`[wa-cloud] Gagal kirim pesan: ${res.status} ${errText}`);
      }
    } catch (err) {
      console.error('[wa-cloud] Network error kirim pesan:', err);
    }

    if (chunks.length > 1) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
}

/**
 * Mengirim status baca (centang biru) ke pengguna WhatsApp.
 */
export async function markWhatsAppCloudMessageRead(messageId: string): Promise<void> {
  if (!config.whatsappToken || !config.whatsappPhoneNumberId) return;

  const url = `https://graph.facebook.com/v21.0/${config.whatsappPhoneNumberId}/messages`;
  try {
    await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.whatsappToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
      }),
    });
  } catch {
    // best-effort
  }
}

/**
 * Mengunduh media (gambar, dokumen, audio, stiker) dari Meta Graph API.
 */
async function downloadWhatsAppCloudMedia(mediaId: string): Promise<{ buffer: Buffer; base64: string; mime: string } | null> {
  if (!config.whatsappToken) return null;

  try {
    // 1. Ambil URL media
    const metaRes = await fetch(`https://graph.facebook.com/v21.0/${mediaId}`, {
      headers: { Authorization: `Bearer ${config.whatsappToken}` },
    });
    if (!metaRes.ok) return null;
    const metaData = (await metaRes.json()) as { url?: string; mime_type?: string };
    if (!metaData.url) return null;

    // 2. Unduh binary media
    const fileRes = await fetch(metaData.url, {
      headers: { Authorization: `Bearer ${config.whatsappToken}` },
    });
    if (!fileRes.ok) return null;

    const buf = Buffer.from(await fileRes.arrayBuffer());
    if (buf.length === 0 || buf.length > 20_000_000) return null;

    return {
      buffer: buf,
      base64: buf.toString('base64'),
      mime: metaData.mime_type || 'application/octet-stream',
    };
  } catch (err) {
    console.error('[wa-cloud] Gagal mengunduh media dari Meta:', err);
    return null;
  }
}

/**
 * Memproses webhook notifikasi pesan masuk dari Meta WhatsApp Cloud API.
 */
export async function processWhatsAppCloudWebhook(body: any): Promise<void> {
  if (!body || typeof body !== 'object') return;

  const entries = body.entry;
  if (!Array.isArray(entries)) return;

  for (const entry of entries) {
    const changes = entry.changes;
    if (!Array.isArray(changes)) continue;

    for (const change of changes) {
      const value = change.value;
      if (!value || value.messaging_product !== 'whatsapp') continue;

      const messages = value.messages;
      if (!Array.isArray(messages) || messages.length === 0) continue;

      for (const m of messages) {
        const messageId = m.id;
        if (!messageId || isDuplicate(messageId)) continue;

        const from = m.from; // Nomor telepon pengirim (misal: 628123456789)
        if (!from) continue;

        // Tandai pesan telah dibaca (centang dua biru)
        void markWhatsAppCloudMessageRead(messageId);

        const chatKey = 'wa_' + from;
        const msgType = m.type;

        // Kasus 1: Pesan Gambar / Foto
        if (msgType === 'image' && m.image?.id) {
          const caption = m.image.caption || undefined;
          const media = await downloadWhatsAppCloudMedia(m.image.id);

          if (media) {
            await saveMessage({
              platform: 'whatsapp',
              chat_id: chatKey,
              role: 'user',
              content: caption ? `[Gambar] ${caption}` : '[Gambar]',
            });

            const { reply, via, tokens } = await describeImage(media.base64, media.mime, caption);
            await sendWhatsAppCloudMessageSafe(from, reply);
            await saveMessage({
              platform: 'whatsapp',
              chat_id: chatKey,
              role: 'assistant',
              content: reply.slice(0, 4000),
              via,
              tokens,
            });
            noteExchange(chatKey);
            continue;
          }
        }

        // Kasus 2: Dokumen (PDF, Word .docx, Teks, CSV, JSON, Kode)
        if (msgType === 'document' && m.document?.id) {
          const filename = m.document.filename || 'dokumen';
          const mime = m.document.mime_type || 'application/octet-stream';
          const caption = m.document.caption?.trim() || undefined;
          const media = await downloadWhatsAppCloudMedia(m.document.id);

          if (media) {
            const context = await getContext(chatKey);
            await saveMessage({
              platform: 'whatsapp',
              chat_id: chatKey,
              role: 'user',
              content: `[Dokumen: ${filename}] ${caption || ''}`.trim(),
            });

            const { reply, via, tokens } = await processIncomingDocument(
              media.buffer,
              mime,
              filename,
              caption,
              context,
            );

            await sendWhatsAppCloudMessageSafe(from, reply);
            await saveMessage({
              platform: 'whatsapp',
              chat_id: chatKey,
              role: 'assistant',
              content: reply.slice(0, 4000),
              via,
              tokens,
            });
            noteExchange(chatKey);
            continue;
          }
        }

        // Kasus 3: Voice Note / Rekaman Audio
        if (msgType === 'audio' && m.audio?.id) {
          const mime = m.audio.mime_type || 'audio/ogg';
          const media = await downloadWhatsAppCloudMedia(m.audio.id);

          if (media) {
            try {
              const transcription = await transcribeAudio(media.buffer, mime);
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
                  console.warn('[wa-cloud] Gagal penelusuran web audio:', err);
                }
              }

              const prompt = `[Pesan Suara / Voice Note dari Temanmu]: "${transcription}"\n(Kamu mendengar rekaman suara ini secara jernih. Tanggapi langsung apa yang dibicarakan temanmu secara wajar, hangat, dan bersahabat).`;
              const { reply, via, tokens } = await autoReply(prompt, context, webResults);
              await sendWhatsAppCloudMessageSafe(from, reply);
              await saveMessage({
                platform: 'whatsapp',
                chat_id: chatKey,
                role: 'assistant',
                content: reply.slice(0, 4000),
                via,
                tokens,
              });
              noteExchange(chatKey);
            } catch (err) {
              console.error('[wa-cloud] Gagal transkripsi audio/VN:', err);
              await sendWhatsAppCloudMessageSafe(
                from,
                'Suara dalam rekaman audio tidak terdengar jelas atau kosong. Boleh tolong kirim ulang atau ketik melalui teks?',
              );
            }
            continue;
          }
        }

        // Kasus 4: Stiker WhatsApp (.webp)
        if (msgType === 'sticker' && m.sticker?.id) {
          const media = await downloadWhatsAppCloudMedia(m.sticker.id);
          if (media) {
            const context = await getContext(chatKey);
            await saveMessage({
              platform: 'whatsapp',
              chat_id: chatKey,
              role: 'user',
              content: '[Stiker WhatsApp]',
            });

            const { reply, via, tokens } = await processIncomingSticker(
              media.buffer,
              media.mime || 'image/webp',
              undefined,
              context,
            );

            await sendWhatsAppCloudMessageSafe(from, reply);
            await saveMessage({
              platform: 'whatsapp',
              chat_id: chatKey,
              role: 'assistant',
              content: reply.slice(0, 4000),
              via,
              tokens,
            });
            noteExchange(chatKey);
            continue;
          }
        }

        // Kasus 5: Video
        if (msgType === 'video' && m.video?.id) {
          const caption = m.video.caption?.trim();
          const context = await getContext(chatKey);

          await saveMessage({
            platform: 'whatsapp',
            chat_id: chatKey,
            role: 'user',
            content: `[Video] ${caption || ''}`.trim(),
          });

          const prompt = caption
            ? `User mengirim video dengan catatan: "${caption}". Tolong tanggapi catatan tersebut secara relevan, jelas, dan bersahabat.`
            : 'User mengirim video. Beritahukan dengan ramah bahwa videonya diterima, dan tanyakan apa yang ingin didiskusikan.';

          const { reply, via, tokens } = await autoReply(prompt, context);
          await sendWhatsAppCloudMessageSafe(from, reply);
          await saveMessage({
            platform: 'whatsapp',
            chat_id: chatKey,
            role: 'assistant',
            content: reply.slice(0, 4000),
            via,
            tokens,
          });
          noteExchange(chatKey);
          continue;
        }

        // Kasus 5b: Lokasi Pengguna (Share Location Pin)
        if (msgType === 'location' && m.location) {
          const lat = m.location.latitude;
          const lon = m.location.longitude;
          if (typeof lat === 'number' && typeof lon === 'number') {
            const tzInfo = resolveTimezoneFromCoords(lat, lon);
            await saveCorrection(chatKey, `Lokasi pengguna berada di koordinat (${lat.toFixed(4)}, ${lon.toFixed(4)}) - Zona Waktu: ${tzInfo.label}`);
            const locTime = formatInZone(new Date(), tzInfo.zone);
            const reply = `Lokasimu berhasil aku catat di ${tzInfo.label}. Waktu setempat di lokasimu saat ini adalah *${locTime.time} ${locTime.tzName}* (${locTime.full}). Mulai sekarang aku akan selalu mengingat waktu lokasimu.`;
            await sendWhatsAppCloudMessageSafe(from, reply);
            await saveMessage({
              platform: 'whatsapp',
              chat_id: chatKey,
              role: 'assistant',
              content: reply.slice(0, 4000),
            });
            noteExchange(chatKey);
            continue;
          }
        }

        // Kasus 6: Pesan Teks & Tombol Interaktif
        let text = '';
        if (msgType === 'text' && m.text?.body) {
          text = m.text.body.trim();
        } else if (msgType === 'interactive') {
          text =
            m.interactive?.button_reply?.title ||
            m.interactive?.list_reply?.title ||
            '';
        }

        if (!text) continue;

        // 1. Ambil riwayat percakapan (fast-path 0ms in-memory cache jika sesi aktif, atau Supabase)
        const context = await getContext(chatKey);

        // 2. Simpan pesan pengguna secara non-blocking & update cache in-memory langsung
        updateContextCache(chatKey, 'user', text);
        void saveMessage({
          platform: 'whatsapp',
          chat_id: chatKey,
          role: 'user',
          content: text,
        }).catch((err) => console.warn('[wa-cloud] Gagal simpan pesan user:', err));

        // 3. Periksa kebutuhan pencarian web real-time 2026
        let webResults: string | null = null;
        if (needsSearch(text)) {
          try {
            const prevContext = context?.history?.slice(-3)?.map(h => h.content)?.join(' ') || '';
            webResults = await searchWeb(text, prevContext);
          } catch (err) {
            console.warn('[wa-cloud] Gagal penelusuran web:', err);
          }
        }

        // 4. Panggil model AI universal (Urutan rolling model dipertahankan 100%)
        const { reply, via, tokens } = await autoReply(text, context, webResults);

        // 5. Kirim balasan ke WhatsApp pengguna secepat mungkin
        await sendWhatsAppCloudMessageSafe(from, reply);

        // 6. Update cache memori & simpan balasan asisten ke database Supabase secara non-blocking
        updateContextCache(chatKey, 'assistant', reply);
        void saveMessage({
          platform: 'whatsapp',
          chat_id: chatKey,
          role: 'assistant',
          content: reply.slice(0, 4000),
          via,
          tokens,
        }).catch((err) => console.warn('[wa-cloud] Gagal simpan pesan assistant:', err));

        // 7. Hitung pertukaran pesan untuk auto-summary per 20 chat
        noteExchange(chatKey);
      }
    }
  }
}
