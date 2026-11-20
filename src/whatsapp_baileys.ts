import fs from 'fs';
import path from 'path';
import { sanitizeAssistantOutput } from './skills.js';
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
import { splitMessageSmart } from './skills.js';
import { baileysAutoReply, baileysDescribeImage, baileysDynamicNotice } from './baileys_brain.js';
import { transcribeAudio, processIncomingDocument, processIncomingSticker, stickerUserContent, imageUserContent, processIncomingVideo } from './media.js';
import { saveMessage, isMessageProcessed, claimIncomingMessage, markMessageProcessed, cariPesanByMsgId, pesanBotTerakhir } from './db.js';
import { getContext, isResetCommand, noteExchange, resetSession, saveCorrection, updateContextCache, validateCorrection, withChatLock } from './memory.js';
import { tanganiPencatatan } from './notes.js';
import { tangkapFaktaPersonal } from './user_facts.js';
import { simpanDokumen, ekstrakTeksDokumen } from './documents.js';
import { fetchStickerBuffer, allowStickerForChat, hasStickerForEmoji, isEdgyStickerEmoji, isPlayfulContext, stickerFitsMood, assistantTurnsSinceLastSticker, lastStickerEmoji, STICKER_MIN_TURNS_SINCE_LAST, stripStickerMarker } from './stickers.js';
import { encodeMarkers } from './markers.js';
import { needsSearch, searchWeb } from './web.js';
import { resolveTimezoneFromCoords, formatInZone } from './timezone.js';
import { saveReminderToDb, checkDueReminders, nomorWhatsApp, tandaiPengingatBaileys, tandaiPengingatBaileysEksklusif } from './remind.js';
// Memisahkan memori chat biasa Baileys (wa_baileys_*) dan grup (wa_baileys_group_*) dari Cloud API (wa_*), sementara data bersama tetap pakai wa_*.
import { normChatId, baileysChatKey, baileysGroupChatKey, BAILEYS_GROUP_PREFIX } from './chat_id.js';
// Monitor pengiriman: deteksi kegagalan beruntun -> beri tahu pemilik via Telegram.
import { catatHasilKirimWa } from './wa_monitor.js';
import {
  getGroupModeRecord,
  setGroupMode,
  touchGroupActivity,
  markGroupBotReply,
  isInFollowUpWindow,
  clearFollowUpWindow,
  recordPassiveGroupMessage,
  consumePassiveGroupContext,
  deteksiPanggilanNatural,
  evaluasiResponGrup,
  formatStatusModeGrup,
  adalahPesanBasaBasiPenutup,
  type GroupCommandKind,
} from './group_mode.js';

export interface BaileysGroupTargetInfo {
  isMentioned: boolean;
  mentionsOtherOnly: boolean;
  cleanedText: string;
}

/**
 * Buka lapisan pembungkus pesan WhatsApp Baileys (`ephemeralMessage`,
 * `viewOnceMessage`, `viewOnceMessageV2`, `viewOnceMessageV2Extension`,
 * `documentWithCaptionMessage`, `lottieStickerMessage`, `editedMessage`,
 * dan `protocolMessage.editedMessage`) sampai maksimal 5 tingkat agar
 * media/stiker/dokumen/teks di chat disappearing atau grup tetap terbaca.
 */
export function unwrapBaileysMessage(
  message: WAMessage['message'],
): WAMessage['message'] {
  let cur = message;
  for (let i = 0; i < 5 && cur; i++) {
    const next =
      cur.ephemeralMessage?.message ||
      cur.viewOnceMessage?.message ||
      cur.viewOnceMessageV2?.message ||
      cur.viewOnceMessageV2Extension?.message ||
      cur.documentWithCaptionMessage?.message ||
      cur.lottieStickerMessage?.message ||
      cur.editedMessage?.message ||
      cur.protocolMessage?.editedMessage ||
      null;
    if (!next) break;
    cur = next;
  }
  return cur;
}

/**
 * Deteksi apakah bot di-mention pada pesan grup WhatsApp (baik via nomor PN maupun `@lid`)
 * dan bersihkan token `@<nomor/lid>` dari teks.
 */
export function deteksiTargetBotBaileys(
  text: string,
  mentionedJids: string[] | undefined | null,
  botIds: { botPn?: string | null; botLid?: string | null },
): BaileysGroupTargetInfo {
  const normId = (v?: string | null) => String(v ?? '').split('@')[0].split(':')[0].replace(/\D/g, '');
  const botTokens = new Set<string>();
  const pn = normId(botIds.botPn);
  const lid = normId(botIds.botLid);
  if (pn) botTokens.add(pn);
  if (lid) botTokens.add(lid);

  const list = Array.isArray(mentionedJids) ? mentionedJids : [];
  let isMentioned = false;
  let otherCount = 0;

  for (const jid of list) {
    const tok = normId(jid);
    if (!tok) continue;
    if (botTokens.has(tok)) isMentioned = true;
    else otherCount++;
  }

  let cleaned = String(text ?? '').trim();
  for (const tok of botTokens) {
    cleaned = cleaned.replace(new RegExp(`@${tok}\\b`, 'gi'), '');
  }
  cleaned = cleaned.replace(/[ \t]{2,}/g, ' ').trim();

  return {
    isMentioned,
    mentionsOtherOnly: !isMentioned && otherCount > 0,
    cleanedText: cleaned,
  };
}

function getBotIdentitiesBaileys(sock: WASocket): { botPn: string; botLid: string; botName: string } {
  const userObj = (sock?.user ?? {}) as { id?: string; lid?: string; name?: string };
  const stripJid = (v?: string) => String(v ?? '').split('@')[0].split(':')[0].replace(/\D/g, '');
  const envPn = stripJid(config.whatsappPhoneNumber);
  const sockPn = stripJid(userObj.id);
  return {
    botPn: sockPn || envPn,
    botLid: stripJid(userObj.lid),
    botName: String(userObj.name || config.botName || 'FreeAIBot').trim(),
  };
}

const waGroupAdminCache = new Map<string, { at: number; admins: Set<string> }>();

async function isWhatsAppGroupAdminOrOwner(
  sock: WASocket,
  groupJid: string,
  actorDigits: string,
  rawParticipantJid?: string | null,
): Promise<boolean> {
  const ownerDigits = String(config.ownerWaNumber || '').replace(/\D/g, '');
  const normOwner = ownerDigits.startsWith('0') ? `62${ownerDigits.slice(1)}` : ownerDigits;
  if (normOwner && actorDigits && (actorDigits === normOwner || actorDigits.endsWith(normOwner))) {
    return true;
  }
  const rawToken = String(rawParticipantJid ?? '').split('@')[0].split(':')[0].replace(/\D/g, '');
  if (normOwner && rawToken && rawToken === normOwner) {
    return true;
  }

  const now = Date.now();
  let cached = waGroupAdminCache.get(groupJid);
  if (!cached || now - cached.at > 60_000) {
    try {
      const meta = await sock.groupMetadata(groupJid);
      const admins = new Set<string>();
      for (const p of meta?.participants ?? []) {
        if (p.admin === 'admin' || p.admin === 'superadmin') {
          const pId = String(p.id ?? '').split('@')[0].split(':')[0].replace(/\D/g, '');
          if (pId) admins.add(pId);
          const pPn = String((p as { phoneNumber?: string }).phoneNumber ?? '').split('@')[0].split(':')[0].replace(/\D/g, '');
          if (pPn) admins.add(pPn);
          const pLid = String((p as { lid?: string }).lid ?? '').split('@')[0].split(':')[0].replace(/\D/g, '');
          if (pLid) admins.add(pLid);
        }
      }
      cached = { at: now, admins };
      waGroupAdminCache.set(groupJid, cached);
    } catch {
      return false;
    }
  }
  return Boolean((actorDigits && cached.admins.has(actorDigits)) || (rawToken && cached.admins.has(rawToken)));
}

function normalizeWaPhone(raw: string): string {
  const d = String(raw ?? '').replace(/\D/g, '');
  if (!d) return '';
  return d.startsWith('0') ? `62${d.slice(1)}` : d;
}

function deskripsiMediaPasifWa(flags: {
  hasImage: boolean;
  hasDoc: boolean;
  hasAudio: boolean;
  hasSticker: boolean;
  hasVideo: boolean;
  isGif?: boolean;
  hasLocation?: boolean;
  hasContact?: boolean;
  hasPoll?: boolean;
  docName?: string;
}): string {
  if (flags.hasImage) return '[mengirim foto]';
  if (flags.hasDoc) return `[mengirim dokumen: ${flags.docName || 'berkas'}]`;
  if (flags.hasAudio) return '[mengirim voice note]';
  if (flags.hasSticker) return '[mengirim stiker]';
  if (flags.hasVideo) return flags.isGif ? '[mengirim GIF]' : '[mengirim video]';
  if (flags.hasLocation) return '[mengirim lokasi]';
  if (flags.hasContact) return '[mengirim kontak]';
  if (flags.hasPoll) return '[mengirim polling]';
  return '';
}

function ekstrakTelVcard(vcard?: string | null): string {
  if (!vcard) return '';
  const m = String(vcard).match(/TEL[^:]*:([^\r\n]+)/i);
  return m ? m[1].trim() : '';
}

function ekstrakTeksKontakDanPoll(innerMsg: WAMessage['message']): {
  contactText: string;
  pollText: string;
  hasContact: boolean;
  hasPoll: boolean;
} {
  let contactText = '';
  let hasContact = false;
  if (innerMsg?.contactMessage) {
    hasContact = true;
    const name = innerMsg.contactMessage.displayName?.trim() || 'Kontak';
    const tel = ekstrakTelVcard(innerMsg.contactMessage.vcard);
    contactText = tel ? `[Kontak dibagikan: ${name} (${tel})]` : `[Kontak dibagikan: ${name}]`;
  } else if (innerMsg?.contactsArrayMessage?.contacts?.length) {
    hasContact = true;
    const items = innerMsg.contactsArrayMessage.contacts.slice(0, 10).map((c) => {
      const name = c.displayName?.trim() || 'Kontak';
      const tel = ekstrakTelVcard(c.vcard);
      return tel ? `${name} (${tel})` : name;
    });
    contactText = `[Kontak dibagikan: ${items.join(', ')}]`;
  }

  let pollText = '';
  let hasPoll = false;
  const poll =
    innerMsg?.pollCreationMessage ||
    innerMsg?.pollCreationMessageV2 ||
    innerMsg?.pollCreationMessageV3 ||
    innerMsg?.pollCreationMessageV5;
  if (poll) {
    hasPoll = true;
    const judul = poll.name?.trim() || 'Polling';
    const opsi = (poll.options || [])
      .map((o) => o.optionName?.trim())
      .filter((x): x is string => Boolean(x))
      .slice(0, 15);
    pollText = opsi.length ? `[Polling: ${judul} | Opsi: ${opsi.join(', ')}]` : `[Polling: ${judul}]`;
  }

  return { contactText, pollText, hasContact, hasPoll };
}

async function tanganiPerintahModeGrupWa(
  sock: WASocket,
  m: WAMessage,
  remoteJid: string,
  groupKey: string,
  command: GroupCommandKind,
  actorDigits: string,
  rawParticipantJid: string,
  senderName: string,
): Promise<void> {
  if (command === 'status') {
    const { record } = await getGroupModeRecord(groupKey);
    await sendWhatsAppMessageSafe(sock, remoteJid, formatStatusModeGrup(record), m);
    return;
  }

  const { record: current } = await getGroupModeRecord(groupKey);
  const perluAdmin = command === 'diam' || (current.mode === 'diam' && current.lockedByAdmin);
  const isAdminOrOwner = perluAdmin
    ? await isWhatsAppGroupAdminOrOwner(sock, remoteJid, actorDigits, rawParticipantJid)
    : false;

  const res = await setGroupMode(groupKey, command, {
    actorId: actorDigits,
    actorName: senderName,
    isAdminOrOwner,
  });

  if (!res.ok) {
    const msgTolak =
      res.reason === 'admin_only'
        ? 'Mode `/diam` hanya bisa diaktifkan oleh *Admin Grup* atau *Owner Bot*.'
        : 'Grup sedang dikunci pada mode *DIAM* oleh Admin Grup atau Owner Bot. Hanya Admin Grup / Owner yang bisa membukanya kembali.';
    await sendWhatsAppMessageSafe(sock, remoteJid, msgTolak, m);
    return;
  }

  const msgOk =
    command === 'nimbrung'
      ? 'Siap, mode *NIMBRUNG AKTIF* di grup ini! Aku bakal ikut ngobrol dan otomatis kembali ke mode mention kalau grup sepi 30 menit. Ketik `/mention` atau bilang "berhenti nimbrung" kapan saja untuk berhenti.'
      : command === 'diam'
        ? 'Oke, mode *DIAM* aktif dan dikunci admin/owner. Aku tidak akan merespons pesan apa pun sampai admin/owner mengaktifkan `/mention` atau `/nimbrung` lagi.'
        : 'Oke, balik ke mode *MENTION*. Aku berhenti nimbrung dan hanya membalas kalau di-`@mention`, di-reply, atau dipanggil (mis. "bot ...").';
  await sendWhatsAppMessageSafe(sock, remoteJid, msgOk, m);
}

// ── Reconnect dengan backoff (perbaikan audit 14 Okt 2026) ──
// Sebelumnya delay TETAP 3 detik tanpa batas percobaan -> hot-loop saat
// disconnect persisten, dan socket lama menumpuk (leak). Lihat blok
// 'connection.update' di bawah.
const MAX_RECONNECT = 8;
let reconnectTimer: NodeJS.Timeout | null = null;
let reconnectCount = 0;
let activeSock: WASocket | null = null;
let reminderInitTimer: NodeJS.Timeout | null = null;
let reminderWorkerTimer: NodeJS.Timeout | null = null;
let checkingReminders = false;

function baileysJidDariChatId(chatId: string): string {
  const raw = String(chatId ?? '').trim();
  if (raw.endsWith('@g.us')) return raw;
  if (raw.startsWith(BAILEYS_GROUP_PREFIX)) return `${raw.slice(BAILEYS_GROUP_PREFIX.length)}@g.us`;
  return `${nomorWhatsApp(raw)}@s.whatsapp.net`;
}

async function jalankanCekPengingatBaileys(label: string): Promise<void> {
  if (!activeSock || checkingReminders) return;
  checkingReminders = true;
  try {
    await checkDueReminders(async (chatId, text) => {
      if (!activeSock) return false;
      const jid = baileysJidDariChatId(String(chatId));
      return await sendWhatsAppMessageSafe(activeSock, jid, text);
    }, 'whatsapp', { channelFilter: 'baileys_only', allowWait: false });
  } catch (err) {
    console.warn(`[baileys-remind] Cek pengingat ${label} gagal:`, err);
  } finally {
    checkingReminders = false;
  }
}

/**
 * Worker pengingat Baileys: mengecek pengingat jatuh tempo setiap 10 detik
 * dan mengirimkannya langsung dari nomor WhatsApp Baileys.
 */
export function startBaileysReminderWorker(): void {
  stopBaileysReminderWorker();
  // Cek cepat pertama kali saat tersambung
  reminderInitTimer = setTimeout(() => {
    reminderInitTimer = null;
    void jalankanCekPengingatBaileys('awal');
  }, 3_000);

  // Interval berkala setiap 10 detik
  reminderWorkerTimer = setInterval(() => {
    void jalankanCekPengingatBaileys('berkala');
  }, 10_000);
}

export function stopBaileysReminderWorker(): void {
  if (reminderInitTimer) {
    clearTimeout(reminderInitTimer);
    reminderInitTimer = null;
  }
  if (reminderWorkerTimer) {
    clearInterval(reminderWorkerTimer);
    reminderWorkerTimer = null;
  }
}
import { laporShutdownVps, mulaiTimerPeringatanLokalVps } from './vps_monitor.js';
import {
  restoreSessionFromSupabase,
  syncSessionDirToSupabase,
  clearSessionInSupabase,
} from './whatsapp_session.js';

const logger = pino({ level: 'silent' });
const sessionDir = path.resolve(process.cwd(), 'session_wa');

// Versi prompt untuk instrumentasi dataset (dipetakan ke kolom messages.prompt_version)
const PROMPT_VERSION = 'v0.66.0';

/**
 * Ambil digit nomor telepon asli hanya dari JID PN (`@s.whatsapp.net` / `@c.us` / `@hosted`).
 * JID `@lid`, `@hosted.lid`, dan `@g.us` ditolak agar angka LID tidak disangka nomor HP.
 */
export function extractPnDigits(jid?: string | null): string | null {
  const s = String(jid ?? '').trim();
  if (!s) return null;
  const lower = s.toLowerCase();
  if (lower.endsWith('@lid') || lower.endsWith('@hosted.lid') || lower.endsWith('@g.us')) return null;
  if (lower.includes('@') && !/@(?:s\.whatsapp\.net|c\.us|hosted)$/.test(lower)) return null;
  const digits = s.replace(/@.*$/, '').replace(/:\d+$/, '').replace(/\D/g, '');
  return /^\d{8,15}$/.test(digits) ? digits : null;
}

/**
 * Resolusi pengirim WhatsApp Baileys v7 ke nomor telepon (PN) asli bila protokol
 * mengirim `@lid`. Grup (`@g.us`) tetap memakai ID grup untuk identitas ruang obrolan.
 */
export async function resolveBaileysSenderNumber(
  sock: Pick<WASocket, 'signalRepository'> | null | undefined,
  key: Pick<WAMessage['key'], 'remoteJid' | 'remoteJidAlt'>,
): Promise<string> {
  const remoteJid = String(key?.remoteJid ?? '');
  if (!remoteJid) return '';
  if (remoteJid.endsWith('@g.us')) return remoteJid.split('@')[0].split(':')[0];

  if (remoteJid.endsWith('@lid') || remoteJid.endsWith('@hosted.lid')) {
    const fromAlt = extractPnDigits(key.remoteJidAlt);
    if (fromAlt) return fromAlt;
    try {
      const pn = await sock?.signalRepository?.lidMapping?.getPNForLID(remoteJid);
      const fromMap = extractPnDigits(pn);
      if (fromMap) return fromMap;
    } catch {
      // fallback ke angka JID mentah bila mapping belum tersedia
    }
  }

  return remoteJid.split('@')[0].split(':')[0];
}

async function resolveParticipantId(
  sock: Pick<WASocket, 'signalRepository'> | null | undefined,
  participant?: string | null,
  participantAlt?: string | null,
): Promise<string | undefined> {
  if (!participant) return undefined;
  if (participant.endsWith('@lid') || participant.endsWith('@hosted.lid')) {
    const fromAlt = extractPnDigits(participantAlt);
    if (fromAlt) return fromAlt;
    try {
      const pn = await sock?.signalRepository?.lidMapping?.getPNForLID(participant);
      const fromMap = extractPnDigits(pn);
      if (fromMap) return fromMap;
    } catch {
      // fallback ke raw id
    }
  }
  return participant.replace(/@.*$/, '');
}

/**
 * Mengirim pesan teks ke WhatsApp dengan pemecahan cerdas
 * jika panjang pesan melebihi limit 4000 karakter menggunakan splitMessageSmart.
 */
export async function sendWhatsAppMessageSafe(
  sock: WASocket,
  jid: string,
  text: string,
  // ── BALAS (QUOTE) PESAN — perbaikan 06 Okt 2026 ──
  // Bila diisi, pesan bot tampil sebagai BALASAN (quote) ke pesan itu.
  // Baileys memakai `{ quoted: WAMessage }` — jadi kita perlu pesan aslinya.
  quotedMsg?: unknown,
): Promise<boolean> {
  if (!text) return false;
  const chunks = splitMessageSmart(text, 4000);
  // Mengembalikan status supaya pemanggil bisa membedakan TERKIRIM vs GAGAL.
  // Sebelumnya `Promise<void>`: kegagalan kirim tidak terdeteksi sama sekali
  // (pemberitahuan pemeliharaan ditandai selesai padahal tidak sampai).
  let semuaBerhasil = true;

  for (const chunk of chunks) {
    // Quote hanya untuk chunk PERTAMA.
    const payload: Record<string, unknown> = { text: chunk };
    if (quotedMsg && chunk === chunks[0]) payload.quoted = quotedMsg;
    try {
      await sock.sendMessage(jid, payload as Parameters<typeof sock.sendMessage>[1]);
    } catch (err) {
      console.error('[whatsapp] Gagal kirim pesan:', String((err as Error)?.message ?? err));
      semuaBerhasil = false;
    }
    if (chunks.length > 1) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  void catatHasilKirimWa(
    semuaBerhasil,
    semuaBerhasil ? undefined : 'Baileys gagal mengirim pesan',
  );
  return semuaBerhasil;
}

/**
 * Kirim stiker balasan bot (webp) via Baileys. Mengembalikan true bila terkirim.
 * Bila gagal, caller mengirim emoji sebagai teks (fallback).
 */
export async function sendWhatsAppStickerSafe(
  sock: WASocket,
  jid: string,
  emoji: string,
): Promise<boolean> {
  try {
    const buf = await fetchStickerBuffer(emoji);
    if (!buf) return false;
    await sock.sendMessage(jid, { sticker: buf });
    return true;
  } catch (err) {
    console.warn('[whatsapp] Gagal kirim stiker balasan:', err);
    return false;
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
      // Koneksi berhasil -> reset penghitung reconnect (perbaikan audit 14 Okt 2026).
      reconnectCount = 0;
      activeSock = sock;
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      console.log('[whatsapp] Berhasil terhubung ke jaringan WhatsApp.');
      console.log('[whatsapp] Bot siap menerima dan membalas pesan 24 jam nonstop.');
      await syncSessionDirToSupabase(sessionDir);
      startBaileysReminderWorker();
    }

    if (connection === 'close') {
      stopBaileysReminderWorker();
      if (activeSock === sock) activeSock = null;
      const statusCode = (lastDisconnect?.error as { output?: { statusCode?: number } })?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log(`[whatsapp] Koneksi terputus (status: ${statusCode}). Reconnect: ${shouldReconnect}`);

      if (shouldReconnect) {
        // ── PERBAIKAN AUDIT 14 Okt 2026 ──
        // BUG LAMA: delay TETAP 3 detik tanpa batas percobaan, dan socket lama
        // tidak pernah ditutup / listener tidak dilepas. Akibatnya:
        //   (a) disconnect persisten (401/503) -> loop reconnect tiap 3 detik
        //       SELAMANYA (hot-loop, memicu rate-limit WhatsApp);
        //   (b) setiap reconnect menumpuk socket + listener baru (leak memori,
        //       risiko pesan ganda).
        // SEKARANG: backoff eksponensial (3s, 6s, 12s, ... maks 60s), dibatasi
        // 8 percobaan, socket lama ditutup & listener dilepas lebih dulu.
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectCount += 1;
        if (reconnectCount > MAX_RECONNECT) {
          console.error(
            `[whatsapp] Gagal menyambung ulang ${MAX_RECONNECT}x. Berhenti mencoba otomatis — restart bot untuk mencoba lagi.`,
          );
          return;
        }
        // Tutup socket lama supaya tidak menumpuk (best-effort).
        try {
          sock.ev.removeAllListeners('connection.update');
          sock.ev.removeAllListeners('creds.update');
          sock.ev.removeAllListeners('messages.upsert');
          sock.end(undefined);
        } catch {
          // abaikan: socket mungkin sudah mati
        }
        const jeda = Math.min(3000 * 2 ** (reconnectCount - 1), 60_000);
        console.log(`[whatsapp] Menyambung ulang dalam ${jeda / 1000} detik... (${reconnectCount}/${MAX_RECONNECT})`);
        reconnectTimer = setTimeout(() => {
          void startWhatsApp();
        }, jeda);
      } else {
        console.warn('[whatsapp] Sesi logout permanen oleh pengguna. Membersihkan sesi Supabase dan direktori lokal...');
        await clearSessionInSupabase();
        try {
          fs.rmSync(sessionDir, { recursive: true, force: true });
        } catch (e) {
          console.error('[whatsapp] Gagal menghapus sessionDir lokal:', e);
        }
        console.log('[whatsapp] Sesi telah direset. Silakan restart bot untuk scan QR atau pairing baru.');
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

  // ── LAZY-CHECK PENGINGAT (DITAMBAHKAN 04 Okt 2026) ──
  // KENAPA: Vercel Hobby HANYA mengizinkan cron 1x/hari (bahkan itu presisinya
  // ±59 menit), sehingga cron per-menit GAGAL DEPLOY. Karena itu pengingat tidak
  // bisa diandalkan dari cron di plan Hobby.
  //
  // Solusi: setiap ada pesan masuk, periksa pengingat yang sudah jatuh tempo dan
  // kirim sekarang. Ini "lazy check" — pengiriman terjadi saat bot sedang aktif
  // (dipicu aktivitas), bukan pada detik tepat jatuh tempo.
  //
  // Tradeoff yang diterima: pengingat terkirim saat ADA pesan masuk setelah
  // tenggatnya, bukan tepat waktu. Untuk pengingat presisi detik, dibutuhkan
  // plan Pro (cron per-menit) atau worker lokal (startReminderWorker).
  //
  // Dijalankan tanpa `await` (fire-and-forget) agar TIDAK menambah latensi balasan.
  void (async () => {
    try {
      // HANYA platform 'whatsapp' dan kanal 'baileys_only' — pengingat dikirim langsung
      // via soket Baileys lokal, bukan dialihkan ke Cloud API (audit 20 Nov 2026).
      await checkDueReminders(async (chatId, text) => {
        const jid = baileysJidDariChatId(String(chatId));
        return await sendWhatsAppMessageSafe(sock, jid, text);
      }, 'whatsapp', { channelFilter: 'baileys_only', allowWait: false });
    } catch (err) {
      console.warn('[remind] Lazy-check Baileys gagal:', String((err as Error)?.message ?? err).slice(0, 120));
    }
  })();

  const innerMsg = unwrapBaileysMessage(m.message);
  const mediaMsg = innerMsg && innerMsg !== m.message ? ({ ...m, message: innerMsg } as WAMessage) : m;

  const { contactText, pollText, hasContact: hasContactPre, hasPoll: hasPollPre } = ekstrakTeksKontakDanPoll(innerMsg);

  // Ekstrak teks atau caption dari berbagai tipe pesan (termasuk pesan di dalam pembungkus ephemeral/viewOnce/caption)
  let text =
    innerMsg?.conversation ||
    innerMsg?.extendedTextMessage?.text ||
    innerMsg?.imageMessage?.caption ||
    innerMsg?.documentMessage?.caption ||
    innerMsg?.videoMessage?.caption ||
    contactText ||
    pollText ||
    '';
  text = text.trim();

  // ── PESAN YANG DI-REPLY USER (quoted message) — perbaikan 06 Okt 2026 ──
  // KENAPA PERLU: user sering membalas pesan lama lalu bilang "ini maksudnya
  // apa?" / "mau" tanpa menyebut konteksnya. Tanpa membaca `contextInfo`
  // (quoted), bot TIDAK TAHU pesan mana yang dimaksud -> jawaban ngawur.
  //
  // Baileys menaruh pesan yang dibalas di `contextInfo.quotedMessage`
  // (bisa conversation / extendedTextMessage.text / caption media).
  const ctxInfo = (innerMsg?.extendedTextMessage?.contextInfo ||
    innerMsg?.imageMessage?.contextInfo ||
    innerMsg?.videoMessage?.contextInfo ||
    innerMsg?.documentMessage?.contextInfo ||
    innerMsg?.stickerMessage?.contextInfo ||
    innerMsg?.audioMessage?.contextInfo ||
    innerMsg?.locationMessage?.contextInfo ||
    innerMsg?.liveLocationMessage?.contextInfo ||
    innerMsg?.contactMessage?.contextInfo ||
    innerMsg?.contactsArrayMessage?.contextInfo ||
    innerMsg?.pollCreationMessage?.contextInfo ||
    innerMsg?.pollCreationMessageV2?.contextInfo ||
    innerMsg?.pollCreationMessageV3?.contextInfo ||
    innerMsg?.pollCreationMessageV5?.contextInfo ||
    (innerMsg as { contextInfo?: unknown } | undefined)?.contextInfo) as
    | {
        participant?: string;
        stanzaId?: string;
        mentionedJid?: string[];
        quotedMessage?: {
          conversation?: string;
          extendedTextMessage?: { text?: string };
          imageMessage?: { caption?: string };
          videoMessage?: { caption?: string; gifPlayback?: boolean | null };
          documentMessage?: { caption?: string };
          stickerMessage?: unknown;
          audioMessage?: unknown;
          locationMessage?: unknown;
          liveLocationMessage?: unknown;
          contactMessage?: { displayName?: string | null };
          pollCreationMessage?: { name?: string | null };
        };
      }
    | undefined;
  const nomorBaileys = await resolveBaileysSenderNumber(sock, m.key);
  const rawRemoteNum = String(remoteJid || '').split('@')[0].split(':')[0];
  const botIdentities = getBotIdentitiesBaileys(sock);
  const rawParticipantJid = String(m.key.participant || m.participant || '');
  const actorGrup = isGroup
    ? await resolveParticipantId(sock, rawParticipantJid, m.key.participantAlt)
    : undefined;
  const senderName = isGroup
    ? ((m.pushName || '').trim() || actorGrup || 'Anggota Grup')
    : (m.pushName || '').trim();

  // Di grup: percakapan DAN data terstruktur memakai kunci grup terisolasi (`wa_baileys_group_<groupId>`),
  // sedangkan chat privat memakai `wa_baileys_<nomor>` & `wa_<nomor>` agar data pribadi tak pernah bocor ke grup.
  const chatKey = isGroup ? baileysGroupChatKey(nomorBaileys) : baileysChatKey(nomorBaileys);
  const personalOwnerId = isGroup ? chatKey : nomorBaileys;
  const sharedDataKey = isGroup ? chatKey : normChatId(personalOwnerId, 'whatsapp');
  const groupActorLabel = isGroup ? (senderName || actorGrup) : undefined;

  let quotedText = '';
  let quotedFromBot = false;
  let quotedPengirim: 'bot' | 'diri' | 'lain' = 'diri';
  if (ctxInfo?.quotedMessage) {
    const qm = ctxInfo.quotedMessage;
    quotedText = String(
      qm.conversation || qm.extendedTextMessage?.text || qm.imageMessage?.caption || qm.videoMessage?.caption || qm.documentMessage?.caption || '',
    ).trim();
    if (!quotedText) {
      if (qm.stickerMessage) quotedText = '[stiker]';
      else if (qm.imageMessage) quotedText = '[foto]';
      else if (qm.videoMessage) quotedText = qm.videoMessage.gifPlayback ? '[GIF]' : '[video]';
      else if (qm.audioMessage) quotedText = '[voice note]';
      else if (qm.documentMessage) quotedText = '[dokumen]';
      else if (qm.locationMessage || qm.liveLocationMessage) quotedText = '[lokasi]';
      else if (qm.contactMessage) quotedText = `[kontak: ${qm.contactMessage.displayName || 'kontak'}]`;
      else if (qm.pollCreationMessage) quotedText = `[polling: ${qm.pollCreationMessage.name || 'polling'}]`;
    }
    // Siapa pengirim pesan yang dibalas: 'bot' | 'diri' (user sendiri) | 'lain'.
    const botPn = botIdentities.botPn;
    const botLid = botIdentities.botLid;
    const part = String(ctxInfo.participant || '').split('@')[0].split(':')[0].replace(/\D/g, '');
    const partMatchedBot = Boolean(
      part && ((botPn && (part === botPn || part.endsWith(botPn))) || (botLid && part === botLid)),
    );
    if (partMatchedBot) {
      quotedPengirim = 'bot';
    } else if (
      part &&
      ((actorGrup && part === actorGrup) || (!isGroup && ((rawRemoteNum && part === rawRemoteNum) || (nomorBaileys && part === nomorBaileys))))
    ) {
      quotedPengirim = 'diri';
    } else if (part) {
      quotedPengirim = 'lain';
    } else {
      quotedPengirim = 'diri';
    }
    quotedFromBot = quotedPengirim === 'bot';

    // Fallback DB untuk media/stiker/pesan tanpa teks di payload quote Baileys.
    if (!quotedText || quotedText.startsWith('[')) {
      const idQuoted = String(ctxInfo.stanzaId || '').trim();
      if (idQuoted) {
        const dariDb = await cariPesanByMsgId('whatsapp', idQuoted);
        if (dariDb?.content && dariDb.content !== '[baileys-msg]') {
          quotedText = dariDb.content;
          if (dariDb.role === 'assistant') {
            quotedPengirim = 'bot';
            quotedFromBot = true;
          }
        }
      }
      if ((!quotedText || quotedText.startsWith('[')) && quotedFromBot) {
        const botTerakhir = await pesanBotTerakhir('whatsapp', chatKey);
        if (botTerakhir) {
          quotedText = botTerakhir;
          quotedPengirim = 'bot';
          quotedFromBot = true;
        }
      }
    }
  }

  // Filter grup SEBELUM klaim DB & read receipt supaya pesan grup yang diabaikan
  // tidak membebani Supabase maupun mengirim centang biru prematur.
  const hasImagePre = !!innerMsg?.imageMessage;
  const hasDocPre = !!innerMsg?.documentMessage;
  const hasAudioPre = !!innerMsg?.audioMessage;
  const hasStickerPre = !!innerMsg?.stickerMessage;
  const hasVideoPre = !!innerMsg?.videoMessage;
  const hasLocPre = !!(innerMsg?.locationMessage || innerMsg?.liveLocationMessage);
  const hasMediaPre = hasImagePre || hasDocPre || hasAudioPre || hasStickerPre || hasVideoPre || hasLocPre || hasContactPre || hasPollPre;

  let groupEvalShouldSetFollowUp = false;
  let groupCommandPending: GroupCommandKind | undefined;
  let passiveGroupPrefix = '';
  const groupKey = isGroup ? `wa_g:${nomorBaileys}` : '';

  if (isGroup) {
    if (!config.whatsappRespondGroups) {
      return;
    }
    // Cek umur pesan basi sebelum mode/passive buffer agar history sync lama tidak memicu balasan
    const nowSecPre = Math.floor(Date.now() / 1000);
    const rawTsPre = m.messageTimestamp;
    const msgTsPre = typeof rawTsPre === 'number' ? rawTsPre : (rawTsPre as any)?.low ? Number((rawTsPre as any).low) : 0;
    if (msgTsPre > 0 && (nowSecPre - msgTsPre) > 180) {
      return;
    }

    const targetMention = deteksiTargetBotBaileys(text, ctxInfo?.mentionedJid, botIdentities);
    const naturalWake = deteksiPanggilanNatural(
      targetMention.cleanedText,
      botIdentities.botName ? [botIdentities.botName] : [],
    );
    const { record: groupRec } = await getGroupModeRecord(groupKey);
    const actorFollowKey = actorGrup || String(rawParticipantJid || '').split('@')[0];
    const inFollowUp = isInFollowUpWindow(groupKey, actorFollowKey);
    const isCmdSlash = /(?:^|\s)\/(?:help|start|reset|clear|salah|remind|catat|catatan|cari|tugas|list|uang|masuk|rekap|hapusuang|barang|ringkasan|tanya|ai|nimbrung|mention|stop|stopnimbrung|diam|mute|statusgrup|status)\b/i.test(
      targetMention.cleanedText,
    );

    const groupEval = evaluasiResponGrup({
      mode: groupRec.mode,
      text: targetMention.cleanedText,
      actorId: actorFollowKey,
      isMentioned: targetMention.isMentioned,
      isReplyToBot: quotedFromBot,
      isTargetedCommand: isCmdSlash,
      hasWakeWord: naturalWake.dipanggil,
      wakeCleanedText: naturalWake.dipanggil ? naturalWake.bersih : targetMention.cleanedText,
      hasMedia: hasMediaPre,
      hasSticker: hasStickerPre,
      mentionsOtherOnly: targetMention.mentionsOtherOnly,
      inFollowUpWindow: inFollowUp,
      lastBotReplyAt: groupRec.lastBotReplyAt,
    });

    if (groupEval.action === 'silent_ignore') {
      return;
    }

    if (groupEval.action === 'passive_ignore') {
      if (groupEval.reason === 'followup_ended_by_filler_or_other') {
        clearFollowUpWindow(groupKey, actorFollowKey);
      }
      if (groupRec.mode === 'nimbrung') {
        touchGroupActivity(groupKey);
      }
      const deskPasif =
        text ||
        deskripsiMediaPasifWa({
          hasImage: hasImagePre,
          hasDoc: hasDocPre,
          hasAudio: hasAudioPre,
          hasSticker: hasStickerPre,
          hasVideo: hasVideoPre,
          isGif: Boolean(innerMsg?.videoMessage?.gifPlayback),
          hasLocation: hasLocPre,
          hasContact: hasContactPre,
          hasPoll: hasPollPre,
          docName: innerMsg?.documentMessage?.fileName || undefined,
        });
      if (deskPasif) {
        recordPassiveGroupMessage(groupKey, senderName, deskPasif);
      }
      return;
    }

    if (groupEval.action === 'mode_command' && groupEval.command) {
      groupCommandPending = groupEval.command;
    } else {
      if (groupRec.mode === 'nimbrung') {
        touchGroupActivity(groupKey);
      }
      text = groupEval.cleanedText;
      groupEvalShouldSetFollowUp = groupEval.shouldSetFollowUp;
      if (text === '' && targetMention.isMentioned && !naturalWake.dipanggil) {
        // user hanya mengirim "@bot" tanpa pertanyaan -> akan dijawab sapaan hangat
      }
    }
  }

  // ── KUNCI PER-CHAT (audit 14 Okt 2026) ──
  // Handler ini sebelumnya TIDAK memakai withChatLock (padahal Telegram sudah).
  // Bila user mengirim beberapa pesan beruntun, pemrosesan berjalan BERSAMAAN pada
  // chat yang sama: konteks saling menimpa & balasan keluar urutan.
  // Fungsi ini memakai `return` (bukan `continue`), jadi aman dibungkus.
  return await withChatLock(chatKey, async () => {
  const messageId = m.key.id;
  // Klaim atomik anti-TOCTOU
  if (messageId && !(await claimIncomingMessage('whatsapp', messageId, chatKey, text || '[baileys-msg]', { dedupKonten: false }))) return;

  // Anti-Stale Message Guard: abaikan pesan basi hasil history sync atau saat bot offline (> 180 detik)
  const nowSec = Math.floor(Date.now() / 1000);
  const rawTs = m.messageTimestamp;
  const msgTs = typeof rawTs === 'number' ? rawTs : (rawTs as any)?.low ? Number((rawTs as any).low) : 0;
  const msgSentAt = msgTs > 0 ? new Date(msgTs * 1000) : undefined;
  if (msgTs > 0 && (nowSec - msgTs) > 180) {
    console.warn(`[whatsapp] Mengabaikan pesan basi/history sync (umur: ${nowSec - msgTs} detik, id: ${messageId}). Tandai selesai tanpa memanggil AI.`);
    if (messageId) void markMessageProcessed('whatsapp', messageId, chatKey);
    return;
  }

  // ── RESPON OTOMATIS PEMELIHARAAN (MAINTENANCE MODE) SEMENTARA ──
  // Mengarahkan pengguna ke Telegram sementara penautan payment method Meta diselesaikan.
  if (config.whatsappMaintenanceMode) {
    const maintenanceMsg =
      'Halo! Layanan bot WhatsApp sedang dalam pemeliharaan (maintenance) sementara.\n\n' +
      'Kamu tetap bisa ngobrol dan menggunakan seluruh fitur bot seperti biasa di Telegram kami yang aktif normal:\n' +
      '👉 https://t.me/chatkita_bot';
    const terkirim = await sendWhatsAppMessageSafe(sock, remoteJid, maintenanceMsg);
    if (terkirim) {
      if (messageId) void markMessageProcessed('whatsapp', messageId, chatKey);
      void saveMessage({
        platform: 'whatsapp',
        chat_id: chatKey,
        role: 'assistant',
        content: maintenanceMsg,
        via: 'system/maintenance',
      }).catch(() => undefined);
    } else {
      // Bila pemberitahuan pemeliharaan pun GAGAL terkirim, JANGAN tandai selesai
      // dan JANGAN simpan sebagai balasan: kalau disimpan, dataset seolah bot
      // sudah menjawab padahal pengguna tidak menerima apa pun. Log dibuat
      // eksplisit supaya kegagalan ini tidak lewat "diam-diam".
      console.error(
        '[whatsapp] MAINTENANCE: pemberitahuan pemeliharaan GAGAL terkirim. ' +
          'Pesan TIDAK ditandai selesai dan TIDAK disimpan sebagai balasan.' +
          (messageId ? ` msg_id=${messageId}` : ''),
      );
    }
    return;
  }

  const hasImage = !!innerMsg?.imageMessage;
  const hasDoc = !!innerMsg?.documentMessage;
  const hasAudio = !!innerMsg?.audioMessage;
  const hasSticker = !!innerMsg?.stickerMessage;
  const hasVideo = !!innerMsg?.videoMessage;
  const isGif = Boolean(innerMsg?.videoMessage?.gifPlayback);

  // Jika di dalam grup, eksekusi perintah mode grup bila diminta (/nimbrung, /mention, /diam, /statusgrup, dll)
  if (isGroup && groupCommandPending) {
    await tanganiPerintahModeGrupWa(
      sock,
      m,
      remoteJid,
      groupKey,
      groupCommandPending,
      actorGrup || '',
      rawParticipantJid,
      senderName,
    );
    if (messageId) void markMessageProcessed('whatsapp', messageId, chatKey);
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

  const groupReplyRef = isGroup ? m : undefined;
  const quotedOrGroupRef = isGroup || quotedText ? m : undefined;
  const actorFollowKeyFinal = actorGrup || String(rawParticipantJid || '').split('@')[0];
  if (isGroup) {
    passiveGroupPrefix = consumePassiveGroupContext(groupKey);
  }
  const tandaiBalasGrup = () => {
    if (isGroup) {
      markGroupBotReply(groupKey, actorFollowKeyFinal, Date.now(), groupEvalShouldSetFollowUp);
    }
  };

  // Kasus 1: Pesan berupa Gambar / Foto
  if (hasImage) {
    try {
      await sock.sendPresenceUpdate('composing', remoteJid);
      const buffer = await downloadMediaMessage(
        mediaMsg,
        'buffer',
        {},
        {
          logger,
          reuploadRequest: sock.updateMediaMessage,
        },
      );

      if (buffer && buffer.length > 0 && buffer.length <= 20_000_000) {
        const mime = innerMsg?.imageMessage?.mimetype || 'image/jpeg';
        const base64 = buffer.toString('base64');
        const context = await getContext(chatKey, msgSentAt);
        const imgCaptionForAi = isGroup && passiveGroupPrefix
          ? (text ? `${passiveGroupPrefix}\n${text}` : passiveGroupPrefix)
          : (text || undefined);
        const { reply, via, tokens, imageDesc } = await baileysDescribeImage(base64, mime, imgCaptionForAi, context);
        const kontenGambarUser = imageUserContent(text || undefined, imageDesc);
        await saveMessage({
          platform: 'whatsapp',
          chat_id: chatKey,
          role: 'user',
          content: isGroup ? `[${senderName}]: ${kontenGambarUser}` : kontenGambarUser,
          msg_id: messageId || undefined,
        });
        updateContextCache(chatKey, 'user', isGroup ? `[${senderName}]: ${kontenGambarUser}` : kontenGambarUser);

        await sendWhatsAppMessageSafe(sock, remoteJid, reply, groupReplyRef);
        tandaiBalasGrup();
        if (messageId) void markMessageProcessed('whatsapp', messageId, chatKey);
        await saveMessage({
          platform: 'whatsapp',
          chat_id: chatKey,
          role: 'assistant',
          content: reply,
          via,
          tokens,
        });
        updateContextCache(chatKey, 'assistant', reply);
        noteExchange(chatKey);
        return;
      } else if (buffer && buffer.length > 20_000_000) {
        await sendWhatsAppMessageSafe(
          sock,
          remoteJid,
          await baileysDynamicNotice(
            'Ukuran foto melebihi batas 20 MB sehingga tidak bisa dianalisis. Minta pengirim mengompres atau mengirim foto lebih kecil dengan bahasa santai.',
            await getContext(chatKey, msgSentAt),
          ),
          groupReplyRef,
        );
        tandaiBalasGrup();
        if (messageId) void markMessageProcessed('whatsapp', messageId, chatKey);
      }
    } catch (err) {
      console.error('[whatsapp] Gagal memproses gambar:', err);
      await sendWhatsAppMessageSafe(
        sock,
        remoteJid,
        await baileysDynamicNotice(
          'Gambar dari temanmu gagal diproses atau tidak terbaca. Beri tahu dia dengan gayamu sendiri, singkat dan hangat, lalu minta kirim ulang.',
          await getContext(chatKey, msgSentAt),
        ),
        groupReplyRef,
      );
    } finally {
      try {
        await sock.sendPresenceUpdate('paused', remoteJid);
      } catch {
        // best-effort
      }
    }
    return;
  }

  // Kasus 2: Dokumen (PDF, Word .docx, Teks, CSV, JSON, Kode)
  if (hasDoc) {
    try {
      await sock.sendPresenceUpdate('composing', remoteJid);
      const buffer = await downloadMediaMessage(
        mediaMsg,
        'buffer',
        {},
        {
          logger,
          reuploadRequest: sock.updateMediaMessage,
        },
      );

      if (buffer && buffer.length > 0 && buffer.length <= 20_000_000) {
        const filename = innerMsg?.documentMessage?.fileName || 'dokumen';
        const mime = innerMsg?.documentMessage?.mimetype || 'application/octet-stream';
        const caption = innerMsg?.documentMessage?.caption?.trim() || text || undefined;
        const captionForAi = isGroup && passiveGroupPrefix
          ? (caption ? `${passiveGroupPrefix}\n${caption}` : passiveGroupPrefix)
          : caption;
        const context = await getContext(chatKey, msgSentAt);

        const docUserContent = `[Dokumen: ${filename}] ${caption || ''}`.trim();
        await saveMessage({
          platform: 'whatsapp',
          chat_id: chatKey,
          role: 'user',
          content: isGroup ? `[${senderName}]: ${docUserContent}` : docUserContent,
          msg_id: messageId || undefined,
        });
        updateContextCache(chatKey, 'user', isGroup ? `[${senderName}]: ${docUserContent}` : docUserContent);

        const { reply, via, tokens } = await processIncomingDocument(
          buffer,
          mime,
          filename,
          captionForAi,
          context,
        );

        void (async () => {
          try {
            const teksDok = await ekstrakTeksDokumen(buffer, mime, filename);
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

        await sendWhatsAppMessageSafe(sock, remoteJid, reply, groupReplyRef);
        tandaiBalasGrup();
        if (messageId) void markMessageProcessed('whatsapp', messageId, chatKey);
        await saveMessage({
          platform: 'whatsapp',
          chat_id: chatKey,
          role: 'assistant',
          content: reply,
          via,
          tokens,
        });
        updateContextCache(chatKey, 'assistant', reply);
        noteExchange(chatKey);
        return;
      } else if (buffer && buffer.length > 20_000_000) {
        await sendWhatsAppMessageSafe(
          sock,
          remoteJid,
          await baileysDynamicNotice(
            'Ukuran dokumen melebihi batas 20 MB sehingga tidak bisa dibaca. Minta pengirim meringkas atau mengirim dokumen lebih kecil dengan bahasa santai.',
            await getContext(chatKey, msgSentAt),
          ),
          groupReplyRef,
        );
        tandaiBalasGrup();
        if (messageId) void markMessageProcessed('whatsapp', messageId, chatKey);
      }
    } catch (err) {
      console.error('[whatsapp] Gagal memproses dokumen:', err);
      await sendWhatsAppMessageSafe(
        sock,
        remoteJid,
        await baileysDynamicNotice(
          'Dokumen dari temanmu gagal diproses atau isinya tidak terbaca. Beri tahu dia dengan gayamu sendiri, singkat dan hangat, lalu minta kirim ulang atau ketik isinya lewat teks.',
          await getContext(chatKey, msgSentAt),
        ),
        groupReplyRef,
      );
    } finally {
      try {
        await sock.sendPresenceUpdate('paused', remoteJid);
      } catch {
        // best-effort
      }
    }
    return;
  }

  // Kasus 3: Voice Note / Rekaman Audio
  if (hasAudio) {
    try {
      await sock.sendPresenceUpdate('composing', remoteJid);
      const buffer = await downloadMediaMessage(
        mediaMsg,
        'buffer',
        {},
        {
          logger,
          reuploadRequest: sock.updateMediaMessage,
        },
      );

      if (buffer && buffer.length > 0 && buffer.length <= 20_000_000) {
        const mime = innerMsg?.audioMessage?.mimetype || 'audio/ogg';
        try {
          let transcription = await transcribeAudio(buffer, mime);
          let context = await getContext(chatKey, msgSentAt);
          const vnUserContent = isGroup ? `[Voice Note dari ${senderName}]: "${transcription}"` : `[Voice Note]: "${transcription}"`;

          await saveMessage({
            platform: 'whatsapp',
            chat_id: chatKey,
            role: 'user',
            content: vnUserContent,
            msg_id: messageId || undefined,
          });
          updateContextCache(chatKey, 'user', vnUserContent);

          const hasilCatatVn = await tanganiPencatatan(transcription, isGroup ? chatKey : nomorBaileys, context, {
            actor: groupActorLabel,
            platform: 'whatsapp',
            channel: 'baileys',
          });
          if (hasilCatatVn.ditangani) {
            await sendWhatsAppMessageSafe(sock, remoteJid, hasilCatatVn.reply, groupReplyRef);
            void saveMessage({
              platform: 'whatsapp',
              chat_id: chatKey,
              role: 'assistant',
              content: hasilCatatVn.reply,
              via: `notes/${hasilCatatVn.jalur}`,
            });
            updateContextCache(chatKey, 'assistant', hasilCatatVn.reply);
            if (hasilCatatVn.teruskanKeAi) {
              transcription = hasilCatatVn.teruskanKeAi;
              context = await getContext(chatKey, msgSentAt);
              updateContextCache(chatKey, 'user', transcription);
            } else {
              tandaiBalasGrup();
              if (messageId) void markMessageProcessed('whatsapp', messageId, chatKey);
              noteExchange(chatKey);
              return;
            }
          } else {
            try {
              const faktaBaruVn = isGroup
                ? await tangkapFaktaPersonal(chatKey, transcription)
                : await tangkapFaktaPersonal(nomorBaileys, transcription);
              if (faktaBaruVn) context = await getContext(chatKey, msgSentAt);
            } catch {
              // best-effort
            }
          }

          let web: string | null = null;
          // Konteks dihitung SEBELUM needsSearch: percakapan lanjutan tentang
          // berita/politik harus ikut ditelusuri walau pesannya pendek
          // (temuan 25 Sep — 6 dari 7 pesan lanjutan tidak ditelusuri).
          const prevContextVn = context?.history?.slice(-3)?.map(h => h.content)?.join(' ') || '';
          if (needsSearch(transcription, prevContextVn)) {
            try {
              const prevContext = prevContextVn;
              const found = await searchWeb(transcription, prevContext);
              if (found) web = found;
            } catch (err) {
              console.warn('[whatsapp] Gagal penelusuran web audio:', err);
            }
          }

          const vnPromptBase = isGroup
            ? `[Pesan Suara / Voice Note di Grup dari ${senderName}]: "${transcription}"\n(Kamu mendengar rekaman suara ini secara jernih di grup. Tanggapi langsung apa yang dibicarakan ${senderName} secara wajar, hangat, dan bersahabat).`
            : `[Pesan Suara / Voice Note dari Temanmu]: "${transcription}"\n(Kamu mendengar rekaman suara ini secara jernih. Tanggapi langsung apa yang dibicarakan temanmu secara wajar, hangat, dan bersahabat).`;
          const prompt = (isGroup && passiveGroupPrefix ? `${passiveGroupPrefix}\n` : '') + vnPromptBase;
          const { reply, via, tokens } = await baileysAutoReply(prompt, context, web);
          await sendWhatsAppMessageSafe(sock, remoteJid, reply, groupReplyRef);
          tandaiBalasGrup();
          if (messageId) void markMessageProcessed('whatsapp', messageId, chatKey);
          await saveMessage({
            platform: 'whatsapp',
            chat_id: chatKey,
            role: 'assistant',
            content: reply,
            via,
            tokens,
          });
          updateContextCache(chatKey, 'assistant', reply);
          noteExchange(chatKey);
        } catch (err) {
          console.error('[whatsapp] Gagal transkripsi audio/VN:', err);
          await sendWhatsAppMessageSafe(
            sock,
            remoteJid,
            await baileysDynamicNotice(
              'Rekaman suara dari temanmu gagal diproses atau tidak terdengar jelas. Beri tahu dia dengan gayamu sendiri, singkat dan hangat, lalu minta kirim ulang atau ketik lewat teks.',
              await getContext(chatKey, msgSentAt),
            ),
            groupReplyRef,
          );
        }
        return;
      } else if (buffer && buffer.length > 20_000_000) {
        await sendWhatsAppMessageSafe(
          sock,
          remoteJid,
          await baileysDynamicNotice(
            'Ukuran rekaman suara atau audio melebihi batas 20 MB. Minta pengirim mengirim pesan suara yang lebih pendek atau mengetik lewat teks dengan santai.',
            await getContext(chatKey, msgSentAt),
          ),
          groupReplyRef,
        );
        tandaiBalasGrup();
        if (messageId) void markMessageProcessed('whatsapp', messageId, chatKey);
      }
    } catch (err) {
      console.error('[whatsapp] Gagal memproses voice note:', err);
      await sendWhatsAppMessageSafe(
        sock,
        remoteJid,
        await baileysDynamicNotice(
          'Rekaman suara dari temanmu gagal diunduh atau diproses. Beri tahu dia dengan gayamu sendiri, singkat dan hangat, lalu minta kirim ulang atau ketik lewat teks.',
          await getContext(chatKey, msgSentAt),
        ),
        groupReplyRef,
      );
    } finally {
      try {
        await sock.sendPresenceUpdate('paused', remoteJid);
      } catch {
        // best-effort
      }
    }
    return;
  }

  // Kasus 4: Stiker WhatsApp (.webp / animasi)
  if (hasSticker) {
    try {
      await sock.sendPresenceUpdate('composing', remoteJid);
      const buffer = await downloadMediaMessage(
        mediaMsg,
        'buffer',
        {},
        {
          logger,
          reuploadRequest: sock.updateMediaMessage,
        },
      );

      if (buffer && buffer.length > 0 && buffer.length <= 20_000_000) {
        const mime = innerMsg?.stickerMessage?.mimetype || 'image/webp';
        const context = await getContext(chatKey, msgSentAt);
        const stickerCaptionArg = isGroup && passiveGroupPrefix
          ? (text ? `${passiveGroupPrefix}\n${text}` : passiveGroupPrefix)
          : (text || undefined);

        const stickerArg = stickerCaptionArg || text || undefined;

        const { reply: replyStiker, via, tokens, sticker: stickerBalasan, stickerText } = await processIncomingSticker(buffer, mime, undefined, context, stickerArg);

        const stickerLabel = innerMsg?.stickerMessage?.isAnimated
          ? (isGroup ? `[Stiker Animasi WhatsApp dari ${senderName}]` : '[Stiker Animasi WhatsApp]')
          : (isGroup ? `[Stiker WhatsApp dari ${senderName}]` : '[Stiker WhatsApp]');
        // Simpan isi pengirim, bukan reaksi bot sebagai ucapan user.
        const kontenStikerUser = stickerUserContent(stickerLabel, text, stickerText);
        await saveMessage({
          platform: 'whatsapp',
          chat_id: chatKey,
          role: 'user',
          content: kontenStikerUser,
          msg_id: messageId || undefined,
        });
        updateContextCache(chatKey, 'user', kontenStikerUser);
        let teksStiker = sanitizeAssistantOutput(replyStiker, kontenStikerUser, undefined, true).trim();
        if (teksStiker) {
          await sendWhatsAppMessageSafe(sock, remoteJid, teksStiker, groupReplyRef);
        }
        let stikerBaileys = false;
        if (stickerBalasan && hasStickerForEmoji(stickerBalasan) && stickerFitsMood(stickerBalasan, kontenStikerUser)) {
          stikerBaileys = await sendWhatsAppStickerSafe(sock, remoteJid, stickerBalasan);
        }
        if (!teksStiker && !stikerBaileys) {
          teksStiker = (
            await baileysDynamicNotice(
              'Temanmu baru mengirim stiker sebagai balasan di chat. Balas langsung secara natural 1 kalimat pendek seperti chat biasa yang nyambung dengan obrolan terakhir, tanpa mengomentari atau menyebut isi/tokoh stiker dan tanpa bertanya balik.',
              context,
            )
          ).trim();
          if (teksStiker) {
            await sendWhatsAppMessageSafe(sock, remoteJid, teksStiker, groupReplyRef);
          }
        }
        tandaiBalasGrup();
        if (messageId) void markMessageProcessed('whatsapp', messageId, chatKey);
        const kontenAssistant = [teksStiker, stikerBaileys ? `[Stiker terkirim: ${stickerBalasan}]` : '']
          .filter(Boolean)
          .join('\n');
        await saveMessage({
          platform: 'whatsapp',
          chat_id: chatKey,
          role: 'assistant',
          content: kontenAssistant,
          via,
          tokens,
        });
        updateContextCache(chatKey, 'assistant', kontenAssistant);
        noteExchange(chatKey);
        return;
      } else if (buffer && buffer.length > 20_000_000) {
        await sendWhatsAppMessageSafe(
          sock,
          remoteJid,
          await baileysDynamicNotice(
            'Ukuran stiker terlalu besar (>20 MB) sehingga gagal dibuka. Beri tahu pengirim singkat dan santai.',
            await getContext(chatKey, msgSentAt),
          ),
          groupReplyRef,
        );
        tandaiBalasGrup();
        if (messageId) void markMessageProcessed('whatsapp', messageId, chatKey);
      }
    } catch (err) {
      console.error('[whatsapp] Gagal memproses stiker:', err);
      await sendWhatsAppMessageSafe(
        sock,
        remoteJid,
        await baileysDynamicNotice(
          'Stiker dari temanmu gagal diproses. Beri tahu dia dengan gayamu sendiri, singkat dan santai, lalu minta kirim ulang.',
          await getContext(chatKey, msgSentAt),
        ),
        groupReplyRef,
      );
    } finally {
      try {
        await sock.sendPresenceUpdate('paused', remoteJid);
      } catch {
        // best-effort
      }
    }
    return;
  }

  // Kasus 5: Video / GIF via Google Gemini Multimodal API
  if (hasVideo) {
    try {
      await sock.sendPresenceUpdate('composing', remoteJid);
      const caption = innerMsg?.videoMessage?.caption?.trim() || text;
      const context = await getContext(chatKey, msgSentAt);
      const mediaTag = isGif ? '[GIF]' : '[Video]';
      const mediaFile = isGif ? 'gif.mp4' : 'video.mp4';

      const videoUserContent = caption ? `${mediaTag} ${caption}` : mediaTag;
      await saveMessage({
        platform: 'whatsapp',
        chat_id: chatKey,
        role: 'user',
        content: isGroup ? `[${senderName}]: ${videoUserContent}` : videoUserContent,
        msg_id: messageId || undefined,
      });
      updateContextCache(chatKey, 'user', isGroup ? `[${senderName}]: ${videoUserContent}` : videoUserContent);

      const buffer = await downloadMediaMessage(
        mediaMsg,
        'buffer',
        {},
        {
          logger,
          reuploadRequest: sock.updateMediaMessage,
        },
      );

      if (buffer && buffer.length > 0 && buffer.length <= 20_000_000) {
        const mime = innerMsg?.videoMessage?.mimetype || 'video/mp4';
        const captionForVideo = [
          isGroup && passiveGroupPrefix ? passiveGroupPrefix : '',
          isGif && !caption ? 'Pengguna mengirim GIF animasi sebagai reaksi. Balas singkat, santai, dan nyambung.' : caption,
        ].filter(Boolean).join('\n') || undefined;
        const { reply, via, tokens } = await processIncomingVideo(buffer, mime, mediaFile, captionForVideo, await getContext(chatKey, msgSentAt));
        await sendWhatsAppMessageSafe(sock, remoteJid, reply, groupReplyRef);
        tandaiBalasGrup();
        if (messageId) void markMessageProcessed('whatsapp', messageId, chatKey);
        await saveMessage({
          platform: 'whatsapp',
          chat_id: chatKey,
          role: 'assistant',
          content: reply,
          via,
          tokens,
        });
        updateContextCache(chatKey, 'assistant', reply);
        noteExchange(chatKey);
        return;
      }

      const prompt = caption
        ? `User ${isGroup ? `${senderName} di grup ` : ''}mengirim ${isGif ? 'GIF' : 'video'} dengan catatan: "${caption}". Tolong tanggapi secara relevan, santai, dan bersahabat.`
        : `User ${isGroup ? `${senderName} di grup ` : ''}mengirim berkas ${isGif ? 'GIF' : 'video'}. Beritahukan dengan ramah bahwa medianya diterima, dan tanyakan apa yang ingin dibahas.`;

      const { reply, via, tokens } = await baileysAutoReply((isGroup && passiveGroupPrefix ? `${passiveGroupPrefix}\n` : '') + prompt, context);
      await sendWhatsAppMessageSafe(sock, remoteJid, reply, groupReplyRef);
      tandaiBalasGrup();
      if (messageId) void markMessageProcessed('whatsapp', messageId, chatKey);
      await saveMessage({
        platform: 'whatsapp',
        chat_id: chatKey,
        role: 'assistant',
        content: reply,
        via,
        tokens,
      });
      updateContextCache(chatKey, 'assistant', reply);
      noteExchange(chatKey);
      return;
    } catch (err) {
      console.error('[whatsapp] Gagal memproses video:', err);
      await sendWhatsAppMessageSafe(
        sock,
        remoteJid,
        await baileysDynamicNotice(
          'Video atau GIF dari temanmu gagal diproses atau tidak terbaca. Beri tahu dia dengan gayamu sendiri, singkat dan hangat, lalu minta kirim ulang atau ketik isinya lewat teks.',
          await getContext(chatKey, msgSentAt),
        ),
        groupReplyRef,
      );
    } finally {
      try {
        await sock.sendPresenceUpdate('paused', remoteJid);
      } catch {
        // best-effort
      }
    }
    return;
  }

  // Kasus 6: Lokasi Pengguna (Share Location Pin / Live Location)
  const locMsg = innerMsg?.locationMessage || innerMsg?.liveLocationMessage;
  if (locMsg) {
    const lat = locMsg.degreesLatitude;
    const lon = locMsg.degreesLongitude;
    if (typeof lat === 'number' && typeof lon === 'number') {
      const tzInfo = resolveTimezoneFromCoords(lat, lon);
      const teksLokasi = `Lokasi pengguna berada di koordinat (${lat.toFixed(4)}, ${lon.toFixed(4)}) - Zona Waktu: ${tzInfo.label}`;
      if (isGroup) {
        await saveCorrection(chatKey, `[Lokasi dari ${senderName}]: ${teksLokasi}`);
      } else {
        await Promise.all([
          saveCorrection(sharedDataKey, teksLokasi),
          saveCorrection(chatKey, teksLokasi),
        ]);
      }
      const locTime = formatInZone(new Date(), tzInfo.zone);
      // Konfirmasi 100% dinamis: model menyusun kalimatnya sendiri dari data waktu (ZERO teks statis)
      const reply = await baileysDynamicNotice(
        `Temanmu ${isGroup ? `(di grup) ${senderName} ` : ''}baru membagikan lokasi: ${tzInfo.label}. Waktu setempat saat ini ${locTime.time} ${locTime.tzName} (${locTime.full}). Konfirmasi singkat dengan gayamu sendiri bahwa lokasinya sudah dicatat dan sebutkan waktu setempat itu; nyatakan kamu akan mengingat lokasinya.`,
        await getContext(chatKey, msgSentAt),
      );
      await sendWhatsAppMessageSafe(sock, remoteJid, reply, groupReplyRef);
      tandaiBalasGrup();
      if (messageId) void markMessageProcessed('whatsapp', messageId, chatKey);
      await saveMessage({
        platform: 'whatsapp',
        chat_id: chatKey,
        role: 'assistant',
        content: reply,
      });
      noteExchange(chatKey);
      return;
    }
  }

  // Kasus 2: Pesan Teks (atau panggilan kosong ke bot di grup tanpa teks lanjutan)
  if (!text) {
    if (isGroup) {
      const greetCtx = await getContext(chatKey, msgSentAt);
      const greetPrompt =
        (passiveGroupPrefix ? `${passiveGroupPrefix}\n` : '') +
        `Anggota grup ${senderName} memanggil atau men-tag kamu di grup WhatsApp tanpa pertanyaan lanjutan. Sapa singkat secara hangat, santai, dan tanyakan apa yang bisa dibantu.`;
      const { reply, via, tokens } = await baileysAutoReply(greetPrompt, greetCtx);
      if (reply.trim()) {
        await sendWhatsAppMessageSafe(sock, remoteJid, reply, groupReplyRef);
        tandaiBalasGrup();
        void saveMessage({
          platform: 'whatsapp',
          chat_id: chatKey,
          role: 'assistant',
          content: reply,
          via,
          tokens,
        });
        updateContextCache(chatKey, 'assistant', reply);
      }
      if (messageId) void markMessageProcessed('whatsapp', messageId, chatKey);
    }
    return;
  }

  // Cek perintah reset sesi (konfirmasi 100% dinamis — ZERO teks statis)
  if (isResetCommand(text)) {
    await resetSession(chatKey, 'whatsapp');
    let reply = '';
    try {
      const resetCtx = await getContext(chatKey, msgSentAt);
      const dyn = await baileysAutoReply(
        'Konfirmasi singkat 1 kalimat pendek (maksimal 12 kata) bahwa sesi sudah di-reset. Gaya santai dan wajar. DILARANG memakai metafora/kiasan panjang, DILARANG menyebut perasaan berlebihan tentang dirimu, DILARANG menambahkan kalimat motivasi atau pernyataan aneh soal hubungan kita.',
        resetCtx,
      );
      if (dyn.reply.trim()) reply = dyn.reply;
    } catch {
      // diam — ZERO teks statis
    }
    await sendWhatsAppMessageSafe(sock, remoteJid, reply);
    if (messageId) void markMessageProcessed('whatsapp', messageId, chatKey);
    void saveMessage({
      platform: 'whatsapp',
      chat_id: chatKey,
      role: 'assistant',
      content: reply,
      via: 'system/reset',
    });
    return;
  }

  // Cek perintah koreksi fakta /salah
  if (text.startsWith('/salah ') || text === '/salah') {
    const rawCorrection = text.replace(/^\/salah\s*/, '').trim();
    const ctx = await getContext(chatKey, msgSentAt);
    if (!rawCorrection) {
      const { reply } = await baileysAutoReply('Jelaskan format perintah /salah dengan satu contoh singkat, santai, dan ramah.', ctx);
      await sendWhatsAppMessageSafe(sock, remoteJid, reply, groupReplyRef);
      tandaiBalasGrup();
      if (messageId) void markMessageProcessed('whatsapp', messageId, chatKey);
      return;
    }
    const check = validateCorrection(rawCorrection);
    if (!check.valid) {
      const { reply } = await baileysAutoReply(
        `User ${senderName || ''} mencoba menggunakan perintah /salah dengan input: "${rawCorrection}". Tanggapi secara spontan, santai, dan bersahabat dengan gayamu sendiri bahwa perintah /salah hanya untuk preferensi personal dia (seperti nama panggilan atau domisili), bukan untuk mengubah identitas developer atau aturan/fakta objektif. DILARANG kaku dan jangan gunakan kalimat template!`,
        ctx,
      );
      await sendWhatsAppMessageSafe(sock, remoteJid, reply, groupReplyRef);
      tandaiBalasGrup();
      if (messageId) void markMessageProcessed('whatsapp', messageId, chatKey);
      return;
    }
    const saved = await saveCorrection(sharedDataKey, isGroup ? `[${senderName}]: ${check.cleaned}` : check.cleaned);
    const { reply } = await baileysAutoReply(
      `User ${senderName || ''} menyimpan preferensi/koreksi personal: "${check.cleaned}". Konfirmasi secara spontan, singkat, santai, dan hangat dengan gayamu sendiri bahwa kamu mengingatnya. DILARANG template kaku!` +
        (saved ? '' : ' Catatan: penyimpanan permanen gagal — sampaikan singkat dan santai bahwa catatan mungkin tidak tersimpan lama.'),
      ctx,
    );
    await sendWhatsAppMessageSafe(sock, remoteJid, reply, groupReplyRef);
    tandaiBalasGrup();
    if (messageId) void markMessageProcessed('whatsapp', messageId, chatKey);
    return;
  }

  // Cek perintah pengingat /remind
  if (text.startsWith('/remind ') || text === '/remind') {
    const args = text.replace(/^\/remind\s*/, '').trim();
    const mRemind = args.match(/^(\d+)\s+([\s\S]+)/);
    const remindCtx = await getContext(chatKey, msgSentAt);
    if (!mRemind) {
      const { reply } = await baileysAutoReply(
        'User salah format perintah pengingat (tidak ada angka menit dan pesan). Jelaskan format yang benar: /remind <menit> <pesan>, dengan satu contoh singkat dan ramah.',
        remindCtx,
      );
      await sendWhatsAppMessageSafe(sock, remoteJid, reply, groupReplyRef);
      tandaiBalasGrup();
      if (messageId) void markMessageProcessed('whatsapp', messageId, chatKey);
      return;
    }
    const minutes = Number(mRemind[1]);
    const message = mRemind[2].trim().slice(0, 500);
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 43200 || !message) {
      const { reply } = await baileysAutoReply(
        `User salah format perintah pengingat (menit="${mRemind[1]}"). Jelaskan syaratnya (angka 1-43200 + pesan) dengan satu contoh singkat dan ramah.`,
        remindCtx,
      );
      await sendWhatsAppMessageSafe(sock, remoteJid, reply, groupReplyRef);
      tandaiBalasGrup();
      if (messageId) void markMessageProcessed('whatsapp', messageId, chatKey);
      return;
    }
    const dueAt = (() => {
      const d = new Date(Date.now() + minutes * 60_000);
      d.setSeconds(0, 0);
      return d;
    })();
    const targetChat = isGroup ? chatKey : nomorBaileys;
    const msgRemindTagged = isGroup ? tandaiPengingatBaileysEksklusif(`[Untuk ${senderName}]: ${message}`) : tandaiPengingatBaileys(message);
    const reminderSaved = await saveReminderToDb(targetChat, msgRemindTagged, dueAt, 'whatsapp');
    const { reply } = await baileysAutoReply(
      `Konfirmasi singkat dan hangat: pengingat "${message}" telah dicatat${isGroup ? ' di grup ini' : ''} dan akan dikirim ${minutes} menit lagi.` +
        (reminderSaved ? '' : ' Catatan: penyimpanan permanen gagal — sampaikan singkat dan santai bahwa pengingat mungkin tidak tersimpan.'),
      remindCtx,
    );
    await sendWhatsAppMessageSafe(sock, remoteJid, reply, groupReplyRef);
    tandaiBalasGrup();
    if (messageId) void markMessageProcessed('whatsapp', messageId, chatKey);
    return;
  }

  // ── PENCATATAN (catatan, tugas, keuangan) — grup memakai ruang grup, privat memakai ruang privat ──
  {
    const catatCtx = await getContext(chatKey, msgSentAt);
    const targetChat = isGroup ? chatKey : nomorBaileys;
    const hasil = await tanganiPencatatan(text, targetChat, catatCtx, { actor: groupActorLabel, platform: 'whatsapp', channel: 'baileys' });
    if (hasil.ditangani) {
      updateContextCache(chatKey, 'user', isGroup ? `[${senderName}]: ${text}` : text);
      if (hasil.teruskanKeAi) {
        await sendWhatsAppMessageSafe(sock, remoteJid, hasil.reply, groupReplyRef);
        void saveMessage({
          platform: 'whatsapp', chat_id: chatKey, role: 'assistant',
          content: hasil.reply, via: `notes/${hasil.jalur}`,
        });
        updateContextCache(chatKey, 'assistant', hasil.reply);
        text = hasil.teruskanKeAi;
      } else {
        await sendWhatsAppMessageSafe(sock, remoteJid, hasil.reply, groupReplyRef);
        tandaiBalasGrup();
        if (messageId) void markMessageProcessed('whatsapp', messageId, chatKey);
        void saveMessage({
          platform: 'whatsapp', chat_id: chatKey, role: 'assistant',
          content: hasil.reply, via: `notes/${hasil.jalur}`,
        });
        updateContextCache(chatKey, 'assistant', hasil.reply);
        return;
      }
    } else {
      try { await tangkapFaktaPersonal(targetChat, isGroup ? `${senderName}: ${text}` : text); } catch { /* best-effort */ }
    }
  }

  // Berikan indikator sedang mengetik (composing)
  try {
    await sock.sendPresenceUpdate('composing', remoteJid);
  } catch {
    // best-effort
  }

  try {
    // 1. Ambil konteks percakapan sebelumnya (fast-path 0ms in-memory cache jika sesi aktif, atau Supabase)
    const context = await getContext(chatKey, msgSentAt);

    // 2. Update cache memori (pesan user sudah tercatat saat klaim atomik)
    const savedUserLine = isGroup ? `[${senderName}]: ${text}` : text;
    updateContextCache(chatKey, 'user', savedUserLine);

    // 3. Periksa kebutuhan penelusuran web real-time 2026
    let webResults: string | null = null;
    // Konteks dihitung SEBELUM needsSearch (lihat catatan di needsSearch):
    // lanjutan topik berita wajib ditelusuri walau pesannya pendek.
    //
    // PENTING (perbaikan 04 Okt): konteks WAJIB memuat `corrections` (memori
    // jangka panjang), bukan hanya 3 pesan terakhir. Kasus nyata: lokasi user
    // ("Lokasi/domisili pengguna: Cianjur") tersimpan di corrections, tetapi
    // searchWeb hanya menerima history sehingga kota user tidak terbaca dan bot
    // menjawab cuaca JAKARTA. Ringkasan percakapan ikut disertakan karena
    // lokasi kadang tersimpan di sana.
    const prevContextTeks = [
      context?.history?.slice(-3)?.map(h => h.content).join(' ') || '',
      context?.summary || '',
      ...(context?.corrections || []),
    ].filter(Boolean).join(' ');
    if (needsSearch(text, prevContextTeks)) {
      try {
        const prevContext = prevContextTeks;
        webResults = await searchWeb(text, prevContext);
      } catch (err) {
        console.warn('[whatsapp] Gagal penelusuran web:', err);
      }
    }

    // 4. Panggil model AI universal (Urutan rolling model dipertahankan 100%)
    const tStart = Date.now();
    // Sisipkan konteks pesan yang di-reply (bila ada) dan konteks pasif grup agar bot tahu apa yang dimaksud.
    const quotedLabel =
      quotedPengirim === 'bot' ? 'pesan KAMU (bot)'
      : quotedPengirim === 'lain' ? 'pesan ORANG LAIN'
      : 'pesan DIA SENDIRI (bukan kamu, bukan orang lain)';
    const promptBody = isGroup ? `[Pesan di Grup dari ${senderName}]: ${text}` : text;
    const promptFinal =
      (passiveGroupPrefix ? `${passiveGroupPrefix}\n` : '') +
      (quotedText ? `[Membalas ${quotedLabel}: "${quotedText.slice(0, 300)}"] ` : '') +
      promptBody;
    const { reply: replyAwal, via, tokens, sticker, riddleAnswer } = await baileysAutoReply(promptFinal, context, webResults);
    let reply = replyAwal;
    const latencyMs = Date.now() - tStart;

    if (!reply || !reply.trim()) {
      console.warn('[whatsapp] Balasan kosong dari baileysAutoReply — meminta pemberitahuan dinamis.');
      try {
        const pemberitahuan = await baileysDynamicNotice(
          'Semua layanan model sedang tidak bisa dihubungi. Sampaikan singkat, santai, dan jujur bahwa kamu sedang ada gangguan teknis sebentar dan minta user mencoba lagi sebentar lagi. JANGAN pakai kalimat template kaku.',
          context,
        );
        if (pemberitahuan && pemberitahuan.trim()) reply = pemberitahuan.trim();
      } catch {
        // biarkan kosong
      }
    }

    if (!reply || !reply.trim()) {
      console.warn('[whatsapp] Balasan tetap kosong — pesan tidak dikirim dan tidak disimpan.');
      return;
    }

    // 5. Kirim balasan ke WhatsApp secepat mungkin
    // Di grup selalu reply (quote) pesan pengirim agar jelas siapa yang dijawab;
    // di DM quote hanya bila dia me-reply pesan lama (perbaikan 06 Okt 2026).
    await sendWhatsAppMessageSafe(sock, remoteJid, reply, quotedOrGroupRef);
    tandaiBalasGrup();
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
      const sent = await sendWhatsAppStickerSafe(sock, remoteJid, sticker);
      if (!sent) {
        // Fallback: stiker gagal terkirim -> emoji sebagai teks (konten dari model).
        await sendWhatsAppMessageSafe(sock, remoteJid, sticker);
      } else {
        stickerSent = true;
      }
    }
    if (messageId) void markMessageProcessed('whatsapp', messageId, chatKey);

    // 6. Update cache memori & simpan balasan asisten ke database secara non-blocking
    updateContextCache(
      chatKey,
      'assistant',
      riddleAnswer
        ? `${reply}\n[Jawaban: ${riddleAnswer}]${stickerSent && sticker ? `\n[Stiker terkirim: ${sticker}]` : ''}`
        : stickerSent && sticker
          ? `${reply}\n[Stiker terkirim: ${sticker}]`
          : reply,
    );
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
    }).catch((err) => console.warn('[whatsapp] Gagal simpan pesan assistant:', err));

    // 7. Hitung pertukaran pesan untuk auto-summary per 20 chat
    noteExchange(chatKey);
  } catch (err) {
    console.error('[whatsapp] Gagal menghasilkan balasan AI:', err);
    // Beri tahu secara dinamis (ZERO template statis); bila AI juga mati, tidak ada pesan terkirim.
    await sendWhatsAppMessageSafe(
      sock,
      remoteJid,
      await baileysDynamicNotice(
        'Ada kendala teknis saat memproses pesan temanmu. Beri tahu dia dengan gayamu sendiri, singkat dan hangat, minta coba kirim ulang sebentar lagi.',
      ),
    );
  } finally {
    try {
      await sock.sendPresenceUpdate('paused', remoteJid);
    } catch {
      // best-effort
    }
  }
  }); // tutup withChatLock (kunci per-chat)
}

// Jika dijalankan langsung sebagai entrypoint file
if (process.argv[1] && process.argv[1].includes('whatsapp_baileys')) {
  void startWhatsApp();

  const stopVpsTimer = mulaiTimerPeringatanLokalVps({
    kirimWaOwner: async (teks) => {
      if (!activeSock || !config.ownerWaNumber) return false;
      let digits = config.ownerWaNumber.replace(/\D/g, '');
      if (digits.startsWith('0')) digits = '62' + digits.slice(1);
      if (!/^\d{8,15}$/.test(digits)) return false;
      return await sendWhatsAppMessageSafe(activeSock, `${digits}@s.whatsapp.net`, teks);
    },
  });

  let stopping = false;
  const stop = (signal: string) => {
    if (stopping) return;
    stopping = true;
    stopVpsTimer();
    stopBaileysReminderWorker();
    console.log(`\n[whatsapp] Proses dihentikan (${signal}).`);
    void laporShutdownVps(signal).finally(() => {
      process.exit(0);
    });
  };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));
}
