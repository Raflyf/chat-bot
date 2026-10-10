import crypto from 'crypto';
import { config } from './env.js';
import { autoReply, describeImage, dynamicNotice, splitMessageSmart } from './skills.js';
import { sanitizeAssistantOutput } from './skills.js';
import { transcribeAudio, processIncomingDocument, processIncomingSticker } from './media.js';
import { saveMessage, isMessageProcessed, claimIncomingMessage, markMessageProcessed, cariPesanByMsgId, pesanBotTerakhir } from './db.js';
import { getContext, isResetCommand, noteExchange, resetSession, saveCorrection, updateContextCache, validateCorrection } from './memory.js';
import { fetchStickerBuffer, allowStickerForChat, hasStickerForEmoji, isEdgyStickerEmoji, isPlayfulContext, stickerFitsMood, assistantTurnsSinceLastSticker, lastStickerEmoji, STICKER_MIN_TURNS_SINCE_LAST, stripStickerMarker } from './stickers.js';
import { encodeMarkers } from './markers.js';
import { needsSearch, searchWeb } from './web.js';
import { resolveTimezoneFromCoords, formatInZone } from './timezone.js';
import { saveReminderToDb, checkDueReminders } from './remind.js';
import { tanganiPencatatan } from './notes.js';
import { tangkapFaktaPersonal } from './user_facts.js';
import { simpanDokumen, ekstrakTeksDokumen } from './documents.js';

// Versi prompt untuk instrumentasi dataset (dipetakan ke kolom messages.prompt_version)
const PROMPT_VERSION = 'v0.66.0';

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
 * FAIL-CLOSED (diperketat 24 Sep 2026 saat audit):
 * - Secret TERSEDIA: verifikasi ketat — signature salah/kosong/kurang → TOLAK.
 * - Secret BELUM diset: request DITOLAK. Sebelumnya fungsi ini mengembalikan `true`
 *   (fail-OPEN) hanya dengan peringatan di log. Itu berbahaya: tanpa App Secret,
 *   siapa pun yang tahu URL webhook bisa mengirim payload palsu dan bot akan
 *   memprosesnya sebagai pesan sah — termasuk memicu balasan ke nomor mana pun.
 *   Konsekuensinya endpoint WhatsApp mati sampai secret dipasang; itu memang
 *   perilaku yang benar (gagal dengan berisik, bukan diam-diam tidak aman).
 * - Bypass hanya untuk pengembangan lokal, dan HARUS disengaja: set
 *   WHATSAPP_INSECURE_SKIP_VERIFY=1 DAN jalankan di luar serverless.
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
        '[whatsapp] KEAMANAN: WHATSAPP_APP_SECRET belum diset — webhook WhatsApp Cloud DITOLAK ' +
          '(fail-closed). Set App Secret dari Meta App Dashboard (Settings > Basic > App Secret) ' +
          'di environment server untuk mengaktifkan kembali. Untuk pengembangan lokal saja, set ' +
          'WHATSAPP_INSECURE_SKIP_VERIFY=1 di luar serverless.',
      );
    }
    return false;
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
  // ── BALAS (QUOTE) PESAN — perbaikan 06 Okt 2026 ──
  // Bila diisi, pesan bot akan tampil sebagai BALASAN (quote) ke pesan itu,
  // persis seperti manusia menekan "Reply" di WhatsApp.
  //
  // KAPAN DIPAKAI: saat balasan bot merujuk pesan TERTENTU di tengah obrolan
  // yang ramai (mis. user membalas pesan lama), atau saat bot menjawab
  // pertanyaan spesifik agar tidak ambigu.
  replyToMessageId?: string,
): Promise<boolean> {
  if (!text || !config.whatsappToken || !config.whatsappPhoneNumberId) {
    console.warn('[wa-cloud] Token atau PhoneNumberId belum diset di environment.');
    return false;
  }

  const chunks = splitMessageSmart(text, 4000);
  const url = `https://graph.facebook.com/v21.0/${config.whatsappPhoneNumberId}/messages`;
  // ── LACAK KEBERHASILAN (temuan nyata 08 Okt 2026) ──
  // LAPORAN: "kenapa pengingat waktu bangun saya ko ga aktif ya hari ini?"
  // AKAR: fungsi ini dulu `Promise<void>` -> PEMANGGIL TIDAK TAHU apakah kirim
  // BERHASIL atau GAGAL. Akibatnya pengingat yang gagal terkirim tetap dianggap
  // sukses (jadwal dimajukan) -> hilang permanen.
  // SEKARANG: mengembalikan true bila SEMUA chunk terkirim, false bila ada gagal.
  let semuaBerhasil = true;

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
          // Quote pesan (bila diminta). Meta memakai field `context.message_id`.
          // Hanya untuk chunk PERTAMA (sisanya lanjutan, tidak perlu quote ulang).
          ...(replyToMessageId && chunk === chunks[0]
            ? { context: { message_id: replyToMessageId } }
            : {}),
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        console.error(`[wa-cloud] Gagal kirim pesan: ${res.status} ${errText}`);
        semuaBerhasil = false;
      }
    } catch (err) {
      console.error('[wa-cloud] Network error kirim pesan:', err);
      semuaBerhasil = false;
    }

    if (chunks.length > 1) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  return semuaBerhasil;
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

  // ── LAZY-CHECK PENGINGAT (DITAMBAHKAN 04 Okt 2026) ──
  // KENAPA DI SINI (dan bukan di whatsapp_baileys.ts):
  // PRODUKSI memakai WhatsApp CLOUD API (webhook Meta -> api/whatsapp.ts ->
  // fungsi ini). Modul whatsapp_baileys.ts TIDAK dipakai di produksi, sehingga
  // lazy-check yang dulu ditaruh di sana TIDAK PERNAH BERJALAN — itulah sebab
  // pengingat tidak pernah terkirim meski kodenya "ada".
  //
  // CARA KERJA: setiap webhook pesan masuk, periksa pengingat yang sudah jatuh
  // tempo lalu kirim sekarang. Dijalankan tanpa await (fire-and-forget) agar
  // tidak menambah latensi balasan.
  //
  // LAPISAN PENGIRIMAN PENGINGAT (berlapis):
  //   1. GitHub Actions tiap 5 menit (utama, tepat waktu)
  //   2. Lazy-check ini (cadangan saat ada aktivitas pesan)
  //   3. startReminderWorker (bila bot dijalankan lokal)
  void (async () => {
    try {
      await checkDueReminders(async (chatId, text, platform) => {
        if (platform === 'telegram') return; // Telegram ditangani webhook-nya sendiri
        const cleanTo = String(chatId).replace(/@.*$/, '').replace(/^\+/, '');
        await sendWhatsAppCloudMessageSafe(cleanTo, text);
      });
    } catch (err) {
      console.warn('[remind] Lazy-check gagal:', String((err as Error)?.message ?? err).slice(0, 120));
    }
  })();

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

        // ── PESAN YANG DI-REPLY USER (quoted message) — perbaikan 06 Okt 2026 ──
        // KENAPA PERLU: user sering membalas pesan lama lalu bilang "ini maksudnya
        // apa?" / "yang ini gimana?" tanpa menyebut konteksnya. Tanpa membaca
        // `m.context`, bot TIDAK TAHU pesan mana yang dimaksud -> jawaban ngawur.
        //
        // Meta mengirim ini di `m.context`:
        //   { from, id, quoted: { body/text, type, ... } }  atau
        //   { from, id, forwarded, frequently_forwarded, ... } (tanpa isi teks)
        const quoted = (m as unknown as { context?: { quoted?: Record<string, unknown>; from?: string; id?: string } }).context;
        let quotedText = '';
        let quotedFromBot = false;
        let quotedPengirim: 'bot' | 'diri' | 'lain' = 'diri';
        if (quoted) {
          const q = quoted.quoted || {};
          const qAny = q as Record<string, unknown>;
          quotedText = String(
            qAny.body ??
            (qAny.text as { body?: string } | undefined)?.body ??
            qAny.caption ??
            '',
          ).trim();
          // Bila quoted tidak punya teks (mis. stiker/gambar), sebut jenisnya.
          if (!quotedText && typeof qAny.type === 'string') {
            quotedText = `[${qAny.type}]`;
          }
          // ── FALLBACK: AMBIL ISI PESAN LAMA DARI DATABASE (perbaikan 09 Okt 2026) ──
          // LAPORAN PEMILIK PRODUK: "saya nyoba reply tag pesan yg sudah sangat lama
          // lalu menanyakan ini apa ternyata bot nya juga masih tidak bisa melihat
          // apa yg di reply tag user".
          //
          // AKAR: saat me-reply pesan LAMA, Meta sering TIDAK menyertakan isi pesan
          // yang di-quote — hanya ID-nya (`context.id`). Akibatnya bot menjawab ngawur
          // karena tidak tahu apa yang dimaksud user.
          //
          // SOLUSI: cari isi pesan itu di DATABASE lewat msg_id. Setiap pesan masuk
          // & keluar sudah tersimpan dengan `msg_id`.
          if (!quotedText || quotedText.startsWith('[')) {
            const idQuoted = String((quoted as { id?: string }).id || '').trim();
            if (idQuoted) {
              const dariDb = await cariPesanByMsgId('whatsapp', idQuoted);
              if (dariDb?.content) {
                quotedText = dariDb.content;
                quotedFromBot = dariDb.role === 'assistant';
                quotedPengirim = dariDb.role === 'assistant' ? 'bot' : 'diri';
              }
            }
            // Masih kosong? Ambil pesan BOT TERAKHIR (kemungkinan itu yang di-reply,
            // mis. pengingat otomatis yang dikirim bot).
            if (!quotedText || quotedText.startsWith('[')) {
              const botTerakhir = await pesanBotTerakhir('whatsapp', chatKey);
              if (botTerakhir) {
                quotedText = botTerakhir;
                quotedFromBot = true;
                quotedPengirim = 'bot';
              }
            }
          }
          // Siapa pengirim pesan yang dibalas? Ada 3 kemungkinan:
          //   'bot'   -> pesan bot sendiri
          //   'diri'  -> pesan user SENDIRI (dia me-reply chat-nya sendiri)
          //   'lain'  -> pesan orang lain (di grup)
          const botNumber = config.whatsappPhoneNumber || '';
          const norm = (x?: string) => String(x || '').replace(/\D/g, '');
          const fromNum = norm(quoted.from);
          if (fromNum && botNumber && fromNum.endsWith(norm(botNumber))) {
            quotedPengirim = 'bot';
          } else if (fromNum && norm(from) && fromNum === norm(from)) {
            // Pengirim pesan yang dibalas == user yang sedang menulis -> pesan dia SENDIRI.
            quotedPengirim = 'diri';
          } else if (fromNum) {
            quotedPengirim = 'lain';
          } else {
            // Meta tidak selalu mengirim 'from' -> tebak dari awalan teks bot.
            quotedPengirim = /^(?:✅|🗑️|⚠️|📊|⏰|💰|📝|🎮|_)/.test(quotedText) ? 'bot' : 'diri';
          }
          quotedFromBot = quotedPengirim === 'bot';
        }

        let initialContent = `[${m.type || 'msg'}]`;
        if (m.type === 'text' && m.text?.body) {
          initialContent = m.text.body;
        } else if (m.type === 'interactive') {
          initialContent = m.interactive?.button_reply?.title || m.interactive?.list_reply?.title || '[interactive]';
        } else if (m.type === 'image' && m.image?.caption) {
          initialContent = `[Gambar] ${m.image.caption}`;
        }

        // Sisipkan konteks balasan ke teks yang diproses AI (bila ada).
        // Format eksplisit supaya model tahu INI pesan yang sedang dibalas.
        if (quotedText) {
          // Label jelas agar bot tidak salah paham siapa yang menulis pesan itu.
          const label =
            quotedPengirim === 'bot' ? 'pesan KAMU (bot)'
            : quotedPengirim === 'lain' ? 'pesan ORANG LAIN'
            : 'pesan DIA SENDIRI (bukan kamu, bukan orang lain)';
          initialContent = `[Membalas ${label}: "${quotedText.slice(0, 300)}"] ${initialContent}`;
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

            // ── SIMPAN ISI DOKUMEN (perbaikan 09 Okt 2026) ──
            // LAPORAN PEMILIK PRODUK: "apalah bot benar menjelaskan isi pdf nya?
            // coba kamu cek isi pdf nya dan bandingkan dengan bot apakah sudah
            // sesuai" + "itu pdf yg dikirim user emg ga masuk db?".
            //
            // Sebelumnya isi dokumen DIBUANG setelah dirangkum — sehingga ringkasan
            // bot tidak bisa diverifikasi dan bot tak bisa mengingat isinya.
            // Sekarang teks ekstraksi + ringkasan disimpan ke tabel `documents`.
            void (async () => {
              try {
                const teksDok = await ekstrakTeksDokumen(media.buffer, mime, filename);
                await simpanDokumen({
                  chatId: chatKey,
                  filename,
                  mime,
                  teks: teksDok,
                  ringkasan: reply,
                  via,
                  platform: 'whatsapp',
                });
              } catch {
                // best-effort: jangan sampai menggagalkan balasan ke user
              }
            })();

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
              // Konteks dihitung SEBELUM needsSearch (lihat catatan di needsSearch).
              const prevContextVn = context?.history?.slice(-3)?.map(h => h.content)?.join(' ') || '';

              // ── BUG YANG DIPERBAIKI (05 Okt 2026) ──
              // MASALAH: Voice Note LANGSUNG dikirim ke autoReply(), MELEWATI
              // tanganiPencatatan(). Akibatnya permintaan seperti
              // "ingatkan saya satu menit lagi untuk login" (lewat VN) TIDAK
              // tersimpan ke database, tetapi AI MENGARANG balasan
              // "✅ Pengingat disimpan" — pengingat tidak pernah datang.
              // (Terbukti dari CSV evaluasi: id 2268, 05 Okt 22:05, VN berisi
              //  "ingatkan saya satu menit lagi untuk login", tapi tabel
              //  `reminders` tidak punya baris itu.)
              //
              // PERBAIKAN: hasil transkripsi VN diperlakukan SAMA seperti pesan
              // teks — diperiksa dulu oleh tanganiPencatatan() (pengingat,
              // catatan, tugas, keuangan, pertanyaan). Bila ditangani, balas
              // hasilnya dan berhenti (jangan diteruskan ke AI).
              const hasilCatatVn = await tanganiPencatatan(transcription, String(from), context, {
                platform: 'whatsapp',
              });
              if (hasilCatatVn.ditangani) {
                await sendWhatsAppCloudMessageSafe(from, hasilCatatVn.reply);
                void markMessageProcessed('whatsapp', messageId);
                await saveMessage({
                  platform: 'whatsapp',
                  chat_id: chatKey,
                  role: 'assistant',
                  content: hasilCatatVn.reply,
                  via: `notes/${hasilCatatVn.jalur}`,
                });
                noteExchange(chatKey);
                continue;
              }

              if (needsSearch(transcription, prevContextVn)) {
                try {
                  const prevContext = prevContextVn;
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

            const { reply: replyStikerMentah, via, tokens, sticker: stickerBalasan } = await processIncomingSticker(
              media.buffer,
              media.mime || 'image/webp',
              undefined,
              context,
            );

            // ── SIMPAN DESKRIPSI STIKER, BUKAN HANYA PENANDA (perbaikan 10 Okt 2026) ──
            // LAPORAN PEMILIK PRODUK: "ketika saya tag reply pesan saya sendiri yg
            // stiker itu bot nya seperti tidak bisa lihat apa yg saya tag reply".
            //
            // AKAR: stiker disimpan sebagai teks polos "[Stiker WhatsApp]" TANPA isi.
            // Saat user me-REPLY stiker itu, fallback DB (cariPesanByMsgId) hanya
            // mengembalikan "[Stiker WhatsApp]" -> bot tidak tahu stiker APA yang
            // dimaksud -> menjawab "Kurang nangkep nih, ulah yang mana?".
            //
            // SOLUSI: simpan HASIL BACAAN stiker (yang sudah dibaca vision) sebagai
            // isi pesan, dengan penanda jenis tetap ada agar jalur stiker lain tahu
            // ini stiker. Format: "[Stiker WhatsApp] <deskripsi>".
            // Deskripsi diambil dari balasan model TANPA tag stiker & dipotong.
            const deskripsiStiker = stripStickerMarker(String(replyStikerMentah || ''))
              .replace(/\s+/g, ' ').trim().slice(0, 200);
            await saveMessage({
              platform: 'whatsapp',
              chat_id: chatKey,
              role: 'user',
              content: deskripsiStiker ? `[Stiker WhatsApp] ${deskripsiStiker}` : '[Stiker WhatsApp]',
              msg_id: messageId,
            });

            // ── PERBAIKAN (10 Okt 2026) ──
            // LAPORAN PEMILIK PRODUK: "ga nyambung anjir klo dikasih stiker, kaya
            // yg gabisa lihat itu stiker apaan, kaya yg asal jawab aja" + "kalo
            // bisa jika ada user membalas dengan stiker maka bot juga diperbolehkan
            // membalas dengan stiker juga".
            //
            // BUG YANG DIPERBAIKI:
            //  (a) Balasan stiker dikirim MENTAH tanpa sanitizeAssistantOutput ->
            //      "iya salah liat" / "iya tuh lucu banget" (ngawur) lolos ke user.
            //  (b) Tag [[sticker:emoji]] dibuang tapi tidak dipakai -> bot TIDAK
            //      PERNAH membalas stiker dengan stiker.
            const replyStiker = sanitizeAssistantOutput(replyStikerMentah, '[Stiker WhatsApp]', undefined, true);

            // Bila balasan mentah ngawur & habis disanitasi, JANGAN kirim teks kosong:
            // pakai fallback reaksi stiker yang jujur (tetap 1 kalimat pendek).
            const teksAkhir = replyStiker.trim();

            await sendWhatsAppCloudMessageSafe(from, teksAkhir);
            void markMessageProcessed('whatsapp', messageId);

            // Kirim STIKER balasan bila model memilihnya (user balas stiker -> bot
            // boleh balas stiker juga, sesuai permintaan pemilik produk).
            let stikerTerkirim = false;
            if (stickerBalasan && hasStickerForEmoji(stickerBalasan) && stickerFitsMood(stickerBalasan, '[Stiker WhatsApp]')) {
              stikerTerkirim = await sendWhatsAppCloudStickerSafe(from, stickerBalasan);
            }

            await saveMessage({
              platform: 'whatsapp',
              chat_id: chatKey,
              role: 'assistant',
              content: stikerTerkirim ? `${teksAkhir}\n[Stiker terkirim: ${stickerBalasan}]` : teksAkhir,
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
              'Konfirmasi singkat 1 kalimat pendek (maksimal 12 kata) bahwa sesi sudah di-reset. Gaya santai dan wajar. DILARANG memakai metafora/kiasan panjang, DILARANG menyebut perasaan berlebihan tentang dirimu, DILARANG menambahkan kalimat motivasi atau pernyataan aneh soal hubungan kita.',
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
          if (!Number.isFinite(minutes) || minutes < 1 || minutes > 43200 || !message) {
            const { reply } = await autoReply(
              `User salah format perintah pengingat (menit="${mRemind[1]}"). Jelaskan syaratnya (angka 1-43200 + pesan) dengan satu contoh singkat dan ramah.`,
              remindCtx,
            );
            await sendWhatsAppCloudMessageSafe(from, reply);
            void markMessageProcessed('whatsapp', messageId);
            continue;
          }
          // PRESISI (06 Okt 2026): bulatkan ke awal menit lalu -5 detik, agar cron
          // per menit mengirim TEPAT WAKTU (bukan ngaret 1 menit karena detik).
          const dueAt = (() => {
            const d = new Date(Date.now() + minutes * 60_000);
            // Bulatkan ke BAWAH ke awal menit (TANPA -5 detik) agar MENIT yang
            // ditampilkan == MENIT pengiriman. Cron per menit dieksekusi sedikit
            // setelah detik 0, sehingga `due_at <= now` tetap terpenuhi tepat waktu.
            d.setSeconds(0, 0);
            return d;
          })();
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

        // ── PENCATATAN PRIBADI (catatan, tugas, keuangan, kebiasaan) ──
        // DITAMBAHKAN 04 Okt 2026. Dua jalur: (A) perintah / eksplisit,
        // (B) deteksi niat dari bahasa alami. Keduanya DIKONFIRMASI dulu
        // sebelum disimpan (permintaan user: aman — hindari salah catat).
        //
        // PENTING: blok ini HARUS ada di whatsapp_cloud.ts, bukan hanya di
        // whatsapp_baileys.ts — PRODUKSI memakai Cloud API (webhook Meta),
        // sehingga kode di baileys TIDAK PERNAH berjalan.
        // OPTIMASI (05 Okt 2026): `getContext` diambil SEKALI di sini lalu dipakai
        // ulang untuk pencatatan DAN autoReply di bawah (sebelumnya dipanggil dua
        // kali: di blok ini dan di langkah 1). Fast-path cache membuat yang kedua
        // murah, tetapi menghindari pemanggilan ganda tetap menghemat overhead.
        let contextBersama: Awaited<ReturnType<typeof getContext>> | null = null;
        {
          // ── TANGKAP FAKTA PERSONAL (permintaan pemilik produk 06 Okt 2026) ──
          // "buat agar bot bisa menangkap personality, kesukaan, dan lainnya dari
          //  user, simpan di database"
          //
          // DIAM-DIAM: tidak membalas apa pun ke user. Fakta tersimpan ke tabel
          // `corrections` dengan penanda [FAKTA], lalu otomatis terbaca getContext()
          // dan disuntikkan ke prompt sebagai konteks personal.
          try {
            const faktaBaru = await tangkapFaktaPersonal(String(from), text);
            if (faktaBaru) {
              console.log(`[wa-cloud] Fakta personal tersimpan: ${faktaBaru.kategori} = ${faktaBaru.fakta}`);
              // Segarkan cache konteks agar fakta baru langsung terbaca di balasan ini.
              contextBersama = null;
            }
          } catch (e) {
            console.warn('[wa-cloud] Gagal menangkap fakta personal:', e);
          }
          contextBersama = await getContext(chatKey, msgSentAt);
          const hasil = await tanganiPencatatan(text, String(from), contextBersama, {
            platform: 'whatsapp',
          });
          if (hasil.ditangani) {
            // LANJUTAN KE AI (06 Okt 2026): bila permintaan user bukan pencatatan
            // (mis. "cuaca hari ini") tetapi tertunda karena lokasi belum diketahui,
            // notes.ts mengembalikan `teruskanKeAi` berisi permintaan ASLI.
            // Kirim pengantar zona, lalu proses permintaan asli lewat AI di bawah.
            if (hasil.teruskanKeAi) {
              await sendWhatsAppCloudMessageSafe(from, hasil.reply);
              void saveMessage({
                platform: 'whatsapp', chat_id: chatKey, role: 'assistant',
                content: hasil.reply, via: `notes/${hasil.jalur}`,
              }).catch(() => undefined);
              // Ganti teks yang akan diproses AI dengan permintaan ASLI user,
              // supaya jawabannya benar-benar menjawab pertanyaan tadi.
              text = hasil.teruskanKeAi;
              updateContextCache(chatKey, 'user', text);
              // Lanjut ke alur AI (jangan `continue`).
            } else {
              await sendWhatsAppCloudMessageSafe(from, hasil.reply);
              void markMessageProcessed('whatsapp', messageId);
              void saveMessage({
                platform: 'whatsapp', chat_id: chatKey, role: 'assistant',
                content: hasil.reply, via: `notes/${hasil.jalur}`,
              }).catch(() => undefined);
              continue;
            }
          }
        }

        // 1. Riwayat percakapan — pakai hasil yang SUDAH diambil di atas (tanpa query ulang).
        const context = contextBersama ?? await getContext(chatKey, msgSentAt);

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
        // Konteks dihitung SEBELUM needsSearch (lihat catatan di needsSearch).
        const prevContextTeks = context?.history?.slice(-3)?.map(h => h.content)?.join(' ') || '';
        if (needsSearch(text, prevContextTeks)) {
          try {
            const prevContext = prevContextTeks;
            webResults = await searchWeb(text, prevContext);
          } catch (err) {
            console.warn('[wa-cloud] Gagal penelusuran web:', err);
          }
        }

        // ── SISIPKAN KONTEKS PESAN YANG DI-REPLY (temuan pemilik produk 06 Okt 2026) ──
        // "padahal user tag reply yg kalo ada 2 awas ya itu bukan begitu mksd nya,
        //  tapi botnya kaya ga bisa melihat apa yg di tag reply user jadi ga nyambung"
        //
        // AKAR: `quotedText` hanya disisipkan ke `initialContent` (untuk klaim DB),
        // TETAPI teks yang dikirim ke AI diambil ULANG dari `m.text.body`, sehingga
        // penanda "[Membalas ...]" HILANG -> bot tidak tahu pesan mana yang dibalas.
        //
        // CATATAN: disisipkan DI SINI (bukan di atas) supaya deteksi perintah
        // (/remind, /salah, /reset) tetap membaca teks ASLI tanpa penanda.
        const textUntukAi = quotedText
          ? `[Membalas ${
              quotedPengirim === 'bot' ? 'pesan KAMU (bot)'
              : quotedPengirim === 'lain' ? 'pesan ORANG LAIN'
              : 'pesan DIA SENDIRI (bukan kamu, bukan orang lain)'
            }: "${quotedText.slice(0, 300)}"] ${text}`
          : text;

        // 4. Panggil model AI universal (Urutan rolling model dipertahankan 100%)
        const tStart = Date.now();
        const { reply: replyAwal, via, tokens, sticker, riddleAnswer } = await autoReply(textUntukAi, context, webResults);
        let reply = replyAwal;
        const latencyMs = Date.now() - tStart;

        // 5. Kirim balasan ke WhatsApp pengguna secepat mungkin
        //
        // PENJAGA ANTI-KOSONG (perbaikan 06 Okt 2026):
        // TEMUAN EVALUASI: ada balasan yang terkirim KOSONG (via '-') ketika
        // SEMUA provider gagal (`autoReply` mengembalikan reply: ''). User
        // melihat bot "diam" tanpa penjelasan. Sekarang bila balasan kosong,
        // JANGAN kirim pesan kosong — minta model menyusun pemberitahuan
        // singkat secara DINAMIS (tanpa teks template statis).
        if (!reply || !reply.trim()) {
          console.warn('[wa-cloud] Balasan kosong dari autoReply — meminta pemberitahuan dinamis.');
          try {
            const { dynamicNotice } = await import('./skills.js');
            const pemberitahuan = await dynamicNotice(
              'Semua layanan model sedang tidak bisa dihubungi. Sampaikan singkat, santai, dan jujur bahwa kamu sedang ada gangguan teknis sebentar dan minta user mencoba lagi sebentar lagi. JANGAN pakai kalimat template kaku.',
              context,
            );
            if (pemberitahuan && pemberitahuan.trim()) reply = pemberitahuan.trim();
          } catch {
            // biarkan; di bawah masih ada jaring terakhir
          }
        }
        // ── KAPAN BOT MEMAKAI BALASAN (QUOTE)? (perbaikan 06 Okt 2026) ──
        // Bot BISA membalas (quote) pesan seperti manusia menekan "Reply".
        // Dipakai HANYA bila memang membantu kejelasan:
        //   (a) User membalas pesan LAMA -> bot quote pesan user saat ini agar
        //       jelas pesan mana yang dijawab (menghindari salah konteks).
        //   (b) Balasan bot PENDEK & user tadi membalas pesan lama (kasus ambigu).
        //
        // TIDAK dipakai untuk obrolan biasa -> agar tidak berisik/penuh quote.
        const perluQuote = Boolean(quotedText);
        const idUntukQuote = perluQuote ? messageId : undefined;

        // Jaring terakhir: bila tetap kosong, jangan kirim apa pun (hindari pesan hampa).
        if (reply && reply.trim()) {
          await sendWhatsAppCloudMessageSafe(from, reply, idUntukQuote);
        } else {
          console.warn('[wa-cloud] Balasan tetap kosong — pesan tidak dikirim (menghindari pesan hampa).');
        }
        // Stiker balasan (opsional) — cooldown DURABLE (riwayat chat) + fast-path lokal.
        // Emoji "keras" (🖕/🤬/👊) hanya saat konteks bercanda (user bercanda/roasting dulu).
        const edgyOk = !isEdgyStickerEmoji(sticker || '') || isPlayfulContext(text);
        // KECOCOKAN SUASANA (permintaan pemilik produk 24 Sep 2026): stiker harus pas
        // dengan suasana pesan. Keluhan nyata: stiker lucu dikirim saat user sedih/kesal.
        // Prompt saja tidak cukup karena model berganti tiap pesan pada rantai failover.
        const moodOk = stickerFitsMood(sticker || '', text);
        // Cooldown DURABLE: minimal N balasan sejak stiker terakhir + emoji tidak boleh sama beruntun.
        const turnsSinceSticker = assistantTurnsSinceLastSticker(context?.history);
        const prevStickerEmoji = lastStickerEmoji(context?.history);
        let stickerSent = false;
        if (
          sticker &&
          reply.trim() &&
          edgyOk &&
          moodOk &&
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
        // OPTIMASI (05 Okt 2026): balasan SUDAH terkirim ke user di atas, jadi
        // menyimpan ke DB TIDAK perlu ditunggu. Dulu di-`await` -> menambah
        // ~645ms sebelum handler selesai (memblokir pesan berikutnya).
        // Sekarang non-blocking (fire-and-forget) dengan penanganan error.
        void saveMessage({
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
