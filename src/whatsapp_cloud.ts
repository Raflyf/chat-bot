import crypto from 'crypto';
import { config } from './env.js';
import { autoReply, describeImage, dynamicNotice, splitMessageSmart } from './skills.js';
import { transcribeAudio, processIncomingDocument, processIncomingSticker } from './media.js';
import { saveMessage, isMessageProcessed, claimIncomingMessage, markMessageProcessed } from './db.js';
import { getContext, isResetCommand, noteExchange, resetSession, saveCorrection, updateContextCache, validateCorrection } from './memory.js';
import { fetchStickerBuffer, allowStickerForChat, hasStickerForEmoji, isEdgyStickerEmoji, isPlayfulContext, assistantTurnsSinceLastSticker, lastStickerEmoji, STICKER_MIN_TURNS_SINCE_LAST } from './stickers.js';
import { encodeMarkers } from './markers.js';
import { needsSearch, searchWeb } from './web.js';
import { resolveTimezoneFromCoords, formatInZone } from './timezone.js';
import { saveReminderToDb } from './remind.js';

// Versi prompt untuk instrumentasi dataset (dipetakan ke kolom messages.prompt_version)
const PROMPT_VERSION = 'v0.57.0';

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
  if (!config.whatsappVerifyToken || !token || !challenge) return { ok: false };
  const bufToken = Buffer.from(token, 'utf8');
  const bufExpected = Buffer.from(config.whatsappVerifyToken, 'utf8');
  const isMatch = bufToken.length === bufExpected.length && crypto.timingSafeEqual(bufToken, bufExpected);
  if (mode === 'subscribe' && isMatch) {
    return { ok: true, challenge };
  }
  return { ok: false };
}

/**
 * Verifikasi signature webhook Meta X-Hub-Signature-256 secara timing-safe.
 *
 * - Secret TERSEDIA: verifikasi ketat fail-closed (signature salah/kosong → tolak).
 * - Secret BELUM diset: request diterima dengan peringatan keamanan mencolok (sekali
 *   per instance) agar bot tetap berjalan; operator WAJIB segera memasang
 *   WHATSAPP_APP_SECRET di Vercel (Meta App Dashboard > Settings > Basic > App Secret)
 *   supaya verifikasi penuh otomatis aktif tanpa perubahan kode.
 */
let warnedMissingSecret = false;
export function verifyMetaSignature(rawBody: string | Buffer, signatureHeader?: string): boolean {
  if (!config.whatsappAppSecret) {
    if (process.env.WHATSAPP_INSECURE_SKIP_VERIFY === '1' && !config.isServerless) {
      console.warn('[whatsapp] DEV MODE: verifikasi HMAC dilewati (WHATSAPP_INSECURE_SKIP_VERIFY=1, non-serverless).');
      return true;
    }
    if (!warnedMissingSecret) {
      warnedMissingSecret = true;
      console.error(
        '[whatsapp] PERINGATAN KEAMANAN: WHATSAPP_APP_SECRET belum diset di environment ini — ' +
          'webhook WhatsApp Cloud berjalan TANPA verifikasi X-Hub-Signature-256. Segera set App Secret ' +
          'dari Meta App Dashboard (Settings > Basic > App Secret) di environment server agar ' +
          'verifikasi HMAC otomatis aktif.',
      );
    }
    return true;
  }
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) return false;

  const hmac = crypto.createHmac('sha256', config.whatsappAppSecret);
  if (Buffer.isBuffer(rawBody)) {
    hmac.update(rawBody);
  } else {
    hmac.update(String(rawBody), 'utf8');
  }
  const expectedSignature = hmac.digest('hex');

  const incomingHash = signatureHeader.slice(7);
  try {
    const expectedBuf = Buffer.from(expectedSignature, 'utf8');
    const incomingBuf = Buffer.from(incomingHash, 'utf8');
    if (expectedBuf.length !== incomingBuf.length) return false;
    return crypto.timingSafeEqual(expectedBuf, incomingBuf);
  } catch {
    return false;
  }
}

export const verifyWhatsAppSignature = (signature: string | undefined, rawBody: string | Buffer): boolean => {
  return verifyMetaSignature(rawBody, signature);
};

/**
 * Mengirim balasan teks melalui Meta WhatsApp Cloud API dengan pemecahan aman.
 * Menggunakan splitMessageSmart yang sadar code-fence markdown agar formatting tidak rusak.
 */
export async function sendWhatsAppCloudMessageSafe(
  to: string,
  text: string,
): Promise<void> {
  if (!text || !config.whatsappToken || !config.whatsappPhoneNumberId) {
    console.warn('[wa-cloud] Token atau PhoneNumberId belum diset di environment.');
    return;
  }

  const chunks = splitMessageSmart(text, 4000);
  const url = `https://graph.facebook.com/v21.0/${config.whatsappPhoneNumberId}/messages`;

  for (const chunk of chunks) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        signal: AbortSignal.timeout(config.timeoutMs),
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
 * Kirim stiker balasan bot (webp) via Meta WhatsApp Cloud API.
 * Meta mengharuskan stiker dikirim sebagai MEDIA (upload dulu), bukan link biasa.
 * Mengembalikan true bila terkirim; false -> caller memakai fallback emoji teks.
 */
export async function sendWhatsAppCloudStickerSafe(to: string, emoji: string): Promise<boolean> {
  if (!config.whatsappToken || !config.whatsappPhoneNumberId) return false;
  try {
    const buf = await fetchStickerBuffer(emoji);
    if (!buf) return false;

    // 1. Upload media ke Meta
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('type', 'image/webp');
    form.append('file', new Blob([new Uint8Array(buf)], { type: 'image/webp' }), 'sticker.webp');
    const upRes = await fetch(
      `https://graph.facebook.com/v21.0/${config.whatsappPhoneNumberId}/media`,
      {
        method: 'POST',
        signal: AbortSignal.timeout(config.timeoutMs),
        headers: { Authorization: `Bearer ${config.whatsappToken}` },
        body: form,
      },
    );
    if (!upRes.ok) {
      console.warn('[wa-cloud] Gagal upload stiker:', upRes.status);
      return false;
    }
    const upData = (await upRes.json()) as { id?: string };
    if (!upData.id) return false;

    // 2. Kirim pesan stiker memakai media id
    const sendRes = await fetch(
      `https://graph.facebook.com/v21.0/${config.whatsappPhoneNumberId}/messages`,
      {
        method: 'POST',
        signal: AbortSignal.timeout(config.timeoutMs),
        headers: {
          Authorization: `Bearer ${config.whatsappToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to,
          type: 'sticker',
          sticker: { id: upData.id },
        }),
      },
    );
    if (!sendRes.ok) {
      const errText = await sendRes.text().catch(() => '');
      console.warn(`[wa-cloud] Gagal kirim stiker: ${sendRes.status} ${errText.slice(0, 120)}`);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[wa-cloud] Stiker error:', err);
    return false;
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
      signal: AbortSignal.timeout(config.downloadTimeoutMs),
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
      signal: AbortSignal.timeout(config.downloadTimeoutMs),
      headers: { Authorization: `Bearer ${config.whatsappToken}` },
    });
    if (!metaRes.ok) return null;
    const metaData = (await metaRes.json()) as { url?: string; mime_type?: string };
    if (!metaData.url) return null;

    // 2. Unduh binary media
    const fileRes = await fetch(metaData.url, {
      signal: AbortSignal.timeout(config.downloadTimeoutMs),
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
        const from = m.from; // Nomor telepon pengirim (misal: 628123456789)
        if (!messageId || !from || isDuplicate(messageId)) continue;

        // Satu pesan poison TIDAK boleh menggagalkan seluruh batch webhook (audit F2.3):
        // tanpa try/catch per-pesan, throw dari describeImage/processIncomingDocument/autoReply
        // membatalkan sisa array dan webhook tetap di-ack 200 → pesan lain hilang permanen.
        try {
        const msgSentAt = Number(m.timestamp) ? new Date(Number(m.timestamp) * 1000) : undefined;

        const chatKey = 'wa_' + from;
        let initialContent = `[${m.type || 'msg'}]`;
        if (m.type === 'text' && m.text?.body) {
          initialContent = m.text.body;
        } else if (m.type === 'interactive') {
          initialContent = m.interactive?.button_reply?.title || m.interactive?.list_reply?.title || '[interactive]';
        } else if (m.type === 'image' && m.image?.caption) {
          initialContent = `[Gambar] ${m.image.caption}`;
        }
        // Klaim atomik (zero TOCTOU): jika sudah pernah ada, drop langsung!
        if (!(await claimIncomingMessage('whatsapp', messageId, chatKey, initialContent))) continue;

        // Tandai pesan telah dibaca (centang dua biru)
        void markWhatsAppCloudMessageRead(messageId);

        // Anti-Stale Message Guard: abaikan pesan basi hasil retry webhook Meta (> 180 detik)
        const nowSec = Math.floor(Date.now() / 1000);
        const msgTimeSec = Number(m.timestamp) || 0;
        if (msgTimeSec > 0 && (nowSec - msgTimeSec) > 180) {
          console.warn(`[wa-cloud] Mengabaikan pesan basi/stale retry (umur: ${nowSec - msgTimeSec} detik, id: ${messageId}). Tandai selesai tanpa memanggil AI.`);
          void markMessageProcessed('whatsapp', messageId);
          continue;
        }

        const msgType = m.type;

        // Kasus 1: Pesan Gambar / Foto
        if (msgType === 'image' && m.image?.id) {
          const caption = m.image.caption || undefined;
          const media = await downloadWhatsAppCloudMedia(m.image.id);

          if (media) {
            const context = await getContext(chatKey, msgSentAt);
            await saveMessage({
              platform: 'whatsapp',
              chat_id: chatKey,
              role: 'user',
              content: caption ? `[Gambar] ${caption}` : '[Gambar]',
              msg_id: messageId,
            });

            const { reply, via, tokens } = await describeImage(media.base64, media.mime, caption, context);
            await sendWhatsAppCloudMessageSafe(from, reply);
            void markMessageProcessed('whatsapp', messageId);
            await saveMessage({
              platform: 'whatsapp',
              chat_id: chatKey,
              role: 'assistant',
              content: reply,
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
            const context = await getContext(chatKey, msgSentAt);
            await saveMessage({
              platform: 'whatsapp',
              chat_id: chatKey,
              role: 'user',
              content: `[Dokumen: ${filename}] ${caption || ''}`.trim(),
              msg_id: messageId,
            });

            const { reply, via, tokens } = await processIncomingDocument(
              media.buffer,
              mime,
              filename,
              caption,
              context,
            );

            await sendWhatsAppCloudMessageSafe(from, reply);
            void markMessageProcessed('whatsapp', messageId);
            await saveMessage({
              platform: 'whatsapp',
              chat_id: chatKey,
              role: 'assistant',
              content: reply,
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
              const context = await getContext(chatKey, msgSentAt);

              await saveMessage({
                platform: 'whatsapp',
                chat_id: chatKey,
                role: 'user',
                content: `[Voice Note]: "${transcription}"`,
                msg_id: messageId,
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
              void markMessageProcessed('whatsapp', messageId);
              await saveMessage({
                platform: 'whatsapp',
                chat_id: chatKey,
                role: 'assistant',
                content: reply,
                via,
                tokens,
              });
              noteExchange(chatKey);
            } catch (err) {
              console.error('[wa-cloud] Gagal transkripsi audio/VN:', err);
              await sendWhatsAppCloudMessageSafe(
                from,
                await dynamicNotice(
                  'Rekaman suara dari temanmu gagal diproses atau tidak terdengar jelas. Beri tahu dia dengan gayamu sendiri, singkat dan hangat, lalu minta kirim ulang atau ketik lewat teks.',
                  await getContext(chatKey, msgSentAt),
                ),
              );
            }
            continue;
          }
        }

        // Kasus 4: Stiker WhatsApp (.webp)
        if (msgType === 'sticker' && m.sticker?.id) {
          const media = await downloadWhatsAppCloudMedia(m.sticker.id);
          if (media) {
            const context = await getContext(chatKey, msgSentAt);
            await saveMessage({
              platform: 'whatsapp',
              chat_id: chatKey,
              role: 'user',
              content: '[Stiker WhatsApp]',
              msg_id: messageId,
            });

            const { reply, via, tokens } = await processIncomingSticker(
              media.buffer,
              media.mime || 'image/webp',
              undefined,
              context,
            );

            await sendWhatsAppCloudMessageSafe(from, reply);
            void markMessageProcessed('whatsapp', messageId);
            await saveMessage({
              platform: 'whatsapp',
              chat_id: chatKey,
              role: 'assistant',
              content: reply,
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
          const context = await getContext(chatKey, msgSentAt);

          await saveMessage({
            platform: 'whatsapp',
            chat_id: chatKey,
            role: 'user',
            content: `[Video] ${caption || ''}`.trim(),
            msg_id: messageId,
          });

          const prompt = caption
            ? `User mengirim video dengan catatan: "${caption}". Tolong tanggapi catatan tersebut secara relevan, jelas, dan bersahabat.`
            : 'User mengirim video. Beritahukan dengan ramah bahwa videonya diterima, dan tanyakan apa yang ingin didiskusikan.';

          const { reply, via, tokens } = await autoReply(prompt, context);
          await sendWhatsAppCloudMessageSafe(from, reply);
          void markMessageProcessed('whatsapp', messageId);
          await saveMessage({
            platform: 'whatsapp',
            chat_id: chatKey,
            role: 'assistant',
            content: reply,
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
            // Konfirmasi 100% dinamis: model menyusun kalimatnya sendiri dari data waktu (ZERO teks statis)
            const reply = await dynamicNotice(
              `Temanmu baru membagikan lokasi: ${tzInfo.label}. Waktu setempat saat ini ${locTime.time} ${locTime.tzName} (${locTime.full}). Konfirmasi singkat dengan gayamu sendiri bahwa lokasinya sudah dicatat dan sebutkan waktu setempat itu; nyatakan kamu akan mengingat lokasinya.`,
              await getContext(chatKey, msgSentAt),
            );
            await sendWhatsAppCloudMessageSafe(from, reply);
            void markMessageProcessed('whatsapp', messageId);
            await saveMessage({
              platform: 'whatsapp',
              chat_id: chatKey,
              role: 'assistant',
              content: reply,
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

        // Cek perintah reset sesi (konfirmasi 100% dinamis — ZERO teks statis)
        if (isResetCommand(text)) {
          await resetSession(chatKey, 'whatsapp');
          let reply = '';
          try {
            const resetCtx = await getContext(chatKey, msgSentAt);
            const dyn = await autoReply(
              'Konfirmasi santai 1 kalimat dengan gayamu sendiri bahwa sesi sudah di-reset dan memori bersih.',
              resetCtx,
            );
            if (dyn.reply.trim()) reply = dyn.reply;
          } catch {
            // diam — ZERO teks statis
          }
          await sendWhatsAppCloudMessageSafe(from, reply);
          void markMessageProcessed('whatsapp', messageId);
          await saveMessage({
            platform: 'whatsapp',
            chat_id: chatKey,
            role: 'assistant',
            content: reply,
            via: 'system/reset',
          }).catch((err) => console.warn('[wa-cloud] Gagal simpan pesan reset assistant:', err));
          continue;
        }

        // Cek perintah koreksi fakta /salah
        if (text.startsWith('/salah ') || text === '/salah') {
          const rawCorrection = text.replace(/^\/salah\s*/, '').trim();
          const ctx = await getContext(chatKey, msgSentAt);
          if (!rawCorrection) {
            const { reply } = await autoReply('Jelaskan format perintah /salah dengan satu contoh singkat, santai, dan ramah.', ctx);
            await sendWhatsAppCloudMessageSafe(from, reply);
            void markMessageProcessed('whatsapp', messageId);
            continue;
          }
          const check = validateCorrection(rawCorrection);
          if (!check.valid) {
            const { reply } = await autoReply(
              `User mencoba menggunakan perintah /salah dengan input: "${rawCorrection}". Tanggapi secara spontan, santai, dan bersahabat dengan gayamu sendiri bahwa perintah /salah hanya untuk preferensi personal dia (seperti nama panggilan atau domisili), bukan untuk mengubah identitas developer atau aturan/fakta objektif. DILARANG kaku dan jangan gunakan kalimat template!`,
              ctx,
            );
            await sendWhatsAppCloudMessageSafe(from, reply);
            void markMessageProcessed('whatsapp', messageId);
            continue;
          }
          const saved = await saveCorrection(chatKey, check.cleaned);
          const { reply } = await autoReply(
            `User menyimpan preferensi/koreksi personal: "${check.cleaned}". Konfirmasi secara spontan, singkat, santai, dan hangat dengan gayamu sendiri bahwa kamu mengingatnya. DILARANG template kaku!` +
              (saved ? '' : ' Catatan: penyimpanan permanen gagal — sampaikan singkat dan santai bahwa catatan mungkin tidak tersimpan lama.'),
            ctx,
          );
          await sendWhatsAppCloudMessageSafe(from, reply);
          void markMessageProcessed('whatsapp', messageId);
          continue;
        }

        // Cek perintah pengingat /remind
        if (text.startsWith('/remind ') || text === '/remind') {
          const args = text.replace(/^\/remind\s*/, '').trim();
          const mRemind = args.match(/^(\d+)\s+([\s\S]+)/);
          const remindCtx = await getContext(chatKey, msgSentAt);
          if (!mRemind) {
            const { reply } = await autoReply(
              'User salah format perintah pengingat (tidak ada angka menit dan pesan). Jelaskan format yang benar: /remind <menit> <pesan>, dengan satu contoh singkat dan ramah.',
              remindCtx,
            );
            await sendWhatsAppCloudMessageSafe(from, reply);
            void markMessageProcessed('whatsapp', messageId);
            continue;
          }
          const minutes = Number(mRemind[1]);
          const message = mRemind[2].trim().slice(0, 500);
          if (!Number.isFinite(minutes) || minutes < 1 || minutes > 1440 || !message) {
            const { reply } = await autoReply(
              `User salah format perintah pengingat (menit="${mRemind[1]}"). Jelaskan syaratnya (angka 1-1440 + pesan) dengan satu contoh singkat dan ramah.`,
              remindCtx,
            );
            await sendWhatsAppCloudMessageSafe(from, reply);
            void markMessageProcessed('whatsapp', messageId);
            continue;
          }
          const dueAt = new Date(Date.now() + minutes * 60_000);
          const reminderSaved = await saveReminderToDb(from, message, dueAt, 'whatsapp');
          const { reply } = await autoReply(
            `Konfirmasi singkat dan hangat: pengingat "${message}" telah dicatat dan akan dikirim ${minutes} menit lagi.` +
              (reminderSaved ? '' : ' Catatan: penyimpanan permanen gagal — sampaikan singkat dan santai bahwa pengingat mungkin tidak tersimpan.'),
            remindCtx,
          );
          await sendWhatsAppCloudMessageSafe(from, reply);
          void markMessageProcessed('whatsapp', messageId);
          continue;
        }

        // 1. Ambil riwayat percakapan (fast-path 0ms in-memory cache jika sesi aktif, atau Supabase)
        const context = await getContext(chatKey, msgSentAt);

        // 2. Update cache in-memory & sinkronkan teks riil user ke database (non-blocking agar tidak menunda autoReply)
        updateContextCache(chatKey, 'user', text);
        void saveMessage({
          platform: 'whatsapp',
          chat_id: chatKey,
          role: 'user',
          content: text,
          msg_id: messageId,
        }).catch((err) => console.warn('[wa-cloud] Gagal update pesan user:', err));

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
        const tStart = Date.now();
        const { reply, via, tokens, sticker, riddleAnswer } = await autoReply(text, context, webResults);
        const latencyMs = Date.now() - tStart;

        // 5. Kirim balasan ke WhatsApp pengguna secepat mungkin
        await sendWhatsAppCloudMessageSafe(from, reply);
        // Stiker balasan (opsional) — cooldown DURABLE (riwayat chat) + fast-path lokal.
        // Emoji "keras" (🖕/🤬/👊) hanya saat konteks bercanda (user bercanda/roasting dulu).
        const edgyOk = !isEdgyStickerEmoji(sticker || '') || isPlayfulContext(text);
        // Cooldown DURABLE: minimal N balasan sejak stiker terakhir + emoji tidak boleh sama beruntun.
        const turnsSinceSticker = assistantTurnsSinceLastSticker(context?.history);
        const prevStickerEmoji = lastStickerEmoji(context?.history);
        let stickerSent = false;
        if (
          sticker &&
          reply.trim() &&
          edgyOk &&
          turnsSinceSticker >= STICKER_MIN_TURNS_SINCE_LAST &&
          sticker !== prevStickerEmoji &&
          hasStickerForEmoji(sticker) &&
          allowStickerForChat(`wa:${chatKey}`)
        ) {
          const sent = await sendWhatsAppCloudStickerSafe(from, sticker);
          if (!sent) {
            // Fallback: stiker gagal terkirim -> emoji sebagai teks (konten dari model).
            await sendWhatsAppCloudMessageSafe(from, sticker);
          } else {
            stickerSent = true;
          }
        }
        void markMessageProcessed('whatsapp', messageId);

        // 6. Update cache memori & simpan balasan asisten ke database Supabase
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
          platform: 'whatsapp',
          chat_id: chatKey,
          role: 'assistant',
          content: reply,
          via,
          tokens,
          latency_ms: latencyMs,
          needs_search: webResults !== null,
          prompt_version: PROMPT_VERSION,
          // Sinyal durable: emoji stiker yang benar-benar terkirim (anti-overuse) dan
          // jawaban benar tebakan (agar model giliran berikutnya menilai secara jujur).
          feedback: encodeMarkers({
            sticker: stickerSent && sticker ? sticker : undefined,
            riddle: riddleAnswer || undefined,
          }),
        }).catch((err) => console.warn('[wa-cloud] Gagal simpan pesan assistant:', err));

        // 7. Hitung pertukaran pesan untuk auto-summary per 20 chat
        noteExchange(chatKey);
        } catch (err) {
          console.error(`[wa-cloud] Gagal memproses pesan ${messageId} (lanjut ke pesan berikutnya):`, err);
          // Tandai selesai agar Meta tidak retry-storm pesan yang sama.
          void markMessageProcessed('whatsapp', messageId);
          // Beri tahu pengguna secara dinamis bila memungkinkan (best-effort).
          try {
            const notice = await dynamicNotice(
              'Terjadi kendala teknis saat memproses pesan temanmu. Sampaikan permintaan maaf singkat dengan gayamu sendiri dan minta dia mengirim ulang pesannya.',
              undefined,
            );
            if (notice.trim()) await sendWhatsAppCloudMessageSafe(from, notice);
          } catch {
            // best-effort
          }
        }
      }
    }
  }
}
