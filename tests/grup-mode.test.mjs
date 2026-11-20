/**
 * TEST OTOMATIS — Sistem Mode Grup Cerdas (mention / nimbrung / diam), passive listening,
 * follow-up window 75 detik, auto-revert 30 menit, proteksi admin/owner, & deteksi mention Baileys.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  NIMBRUNG_IDLE_TIMEOUT_MS,
  NIMBRUNG_COOLDOWN_MS,
  FOLLOW_UP_WINDOW_MS,
  PASSIVE_BUFFER_MAX,
  getGroupModeRecord,
  setGroupMode,
  touchGroupActivity,
  markGroupBotReply,
  isInFollowUpWindow,
  clearFollowUpWindow,
  recordPassiveGroupMessage,
  peekPassiveGroupContext,
  consumePassiveGroupContext,
  deteksiPanggilanNatural,
  deteksiPerintahModeGrup,
  adalahPesanBasaBasiPenutup,
  adalahPesanLayakNimbrung,
  evaluasiResponGrup,
  formatStatusModeGrup,
  resetGroupModeUntukTest,
} from '../src/group_mode.js';
import { deteksiTargetBotBaileys, unwrapBaileysMessage } from '../src/whatsapp_baileys.js';

const baca = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');

test('default mode grup adalah mention', async () => {
  resetGroupModeUntukTest();
  const { record, autoReverted } = await getGroupModeRecord('wa_g:120363001');
  assert.equal(record.mode, 'mention');
  assert.equal(record.lockedByAdmin, false);
  assert.equal(autoReverted, false);
});

test('deteksiPanggilanNatural menangkap kata panggil natural tanpa salah tangkap robot/botol', () => {
  assert.deepEqual(deteksiPanggilanNatural('bot cuaca jakarta gimana'), {
    dipanggil: true,
    bersih: 'cuaca jakarta gimana',
  });
  assert.deepEqual(deteksiPanggilanNatural('oi bot jelasin dong'), {
    dipanggil: true,
    bersih: 'jelasin dong',
  });
  assert.deepEqual(deteksiPanggilanNatural('FreeAIBot 2, tolong cek kurs'), {
    dipanggil: true,
    bersih: 'tolong cek kurs',
  });
  assert.deepEqual(deteksiPanggilanNatural('harga emas sekarang berapa, bot?'), {
    dipanggil: true,
    bersih: 'harga emas sekarang berapa',
  });
  assert.deepEqual(deteksiPanggilanNatural('/ai apa itu DNS'), {
    dipanggil: true,
    bersih: 'apa itu DNS',
  });

  // Negatif: tidak boleh menangkap "robot", "botol", atau chatbot
  assert.equal(deteksiPanggilanNatural('robot ini keren banget').dipanggil, false);
  assert.equal(deteksiPanggilanNatural('botol minum tertinggal di meja').dipanggil, false);
  assert.equal(deteksiPanggilanNatural('makan nasi goreng yuk').dipanggil, false);
});

test('deteksiPerintahModeGrup menangkap slash command & bahasa natural dengan guard negasi', () => {
  assert.equal(deteksiPerintahModeGrup('/nimbrung', { isDirected: true, currentMode: 'mention' }), 'nimbrung');
  assert.equal(deteksiPerintahModeGrup('/mention', { isDirected: true, currentMode: 'nimbrung' }), 'mention');
  assert.equal(deteksiPerintahModeGrup('/stop', { isDirected: true, currentMode: 'nimbrung' }), 'mention');
  assert.equal(deteksiPerintahModeGrup('/diam', { isDirected: true, currentMode: 'mention' }), 'diam');
  assert.equal(deteksiPerintahModeGrup('/statusgrup', { isDirected: true, currentMode: 'mention' }), 'status');

  // Natural phrases saat dipanggil atau saat sedang nimbrung
  assert.equal(deteksiPerintahModeGrup('ikut nimbrung dong', { isDirected: true, currentMode: 'mention' }), 'nimbrung');
  assert.equal(deteksiPerintahModeGrup('berhenti nimbrung dulu ya', { isDirected: false, currentMode: 'nimbrung' }), 'mention');
  assert.equal(deteksiPerintahModeGrup('balas kalau ditag aja ya', { isDirected: true, currentMode: 'nimbrung' }), 'mention');
  assert.equal(deteksiPerintahModeGrup('diam dulu bot', { isDirected: true, currentMode: 'nimbrung' }), 'diam');

  // Guard negasi & obrolan tidak ditujukan ke bot saat mode mention
  assert.equal(deteksiPerintahModeGrup('jangan berhenti nimbrung', { isDirected: true, currentMode: 'nimbrung' }), null);
  assert.equal(deteksiPerintahModeGrup('ikut nimbrung dong', { isDirected: false, currentMode: 'mention' }), null);
});

test('izin mode: anggota biasa boleh toggle mention<->nimbrung, /diam dikunci admin/owner', async () => {
  resetGroupModeUntukTest();
  const gk = 'wa_g:perm01';

  const r1 = await setGroupMode(gk, 'nimbrung', { actorId: '628111', actorName: 'Budi', isAdminOrOwner: false });
  assert.equal(r1.ok, true);
  assert.equal(r1.record.mode, 'nimbrung');

  const r2 = await setGroupMode(gk, 'mention', { actorId: '628111', actorName: 'Budi', isAdminOrOwner: false });
  assert.equal(r2.ok, true);
  assert.equal(r2.record.mode, 'mention');

  // Non-admin ditolak mengunci /diam
  const r3 = await setGroupMode(gk, 'diam', { actorId: '628111', actorName: 'Budi', isAdminOrOwner: false });
  assert.equal(r3.ok, false);
  assert.equal(r3.reason, 'admin_only');

  // Admin/owner boleh mengunci /diam
  const r4 = await setGroupMode(gk, 'diam', { actorId: '628991', actorName: 'Rafly', isAdminOrOwner: true });
  assert.equal(r4.ok, true);
  assert.equal(r4.record.mode, 'diam');
  assert.equal(r4.record.lockedByAdmin, true);

  // Non-admin ditolak membuka kunci /diam
  const r5 = await setGroupMode(gk, 'mention', { actorId: '628111', actorName: 'Budi', isAdminOrOwner: false });
  assert.equal(r5.ok, false);
  assert.equal(r5.reason, 'locked_by_admin');

  // Admin/owner bisa membuka kunci /diam ke nimbrung/mention
  const r6 = await setGroupMode(gk, 'mention', { actorId: '628991', actorName: 'Rafly', isAdminOrOwner: true });
  assert.equal(r6.ok, true);
  assert.equal(r6.record.mode, 'mention');
  assert.equal(r6.record.lockedByAdmin, false);
});

test('nimbrung cerdas: skip basa-basi & @orang lain, jeda anti-spam 5 detik, auto-revert 30 menit sepi', async () => {
  resetGroupModeUntukTest();
  const gk = 'wa_g:smart01';
  const t0 = 1_700_000_000_000;
  await setGroupMode(gk, 'nimbrung', { actorId: '628111', nowMs: t0 });

  // Filler / pesan 1 kata kosong dilewati
  assert.equal(adalahPesanBasaBasiPenutup('ok'), true);
  assert.equal(adalahPesanBasaBasiPenutup('wkwkwk'), true);
  assert.equal(adalahPesanLayakNimbrung('siap'), false);

  const skipFiller = evaluasiResponGrup({
    mode: 'nimbrung',
    text: 'wkwkwk',
    actorId: '628111',
    isMentioned: false,
    isReplyToBot: false,
    isTargetedCommand: false,
    hasWakeWord: false,
    nowMs: t0 + 10_000,
    lastBotReplyAt: 0,
  });
  assert.equal(skipFiller.action, 'passive_ignore');
  assert.equal(skipFiller.reason, 'nimbrung_skip_filler');

  // Mention ke orang lain bukan ke bot -> skip
  const skipOther = evaluasiResponGrup({
    mode: 'nimbrung',
    text: 'tolong cek ini ya',
    actorId: '628111',
    isMentioned: false,
    isReplyToBot: false,
    isTargetedCommand: false,
    hasWakeWord: false,
    mentionsOtherOnly: true,
    nowMs: t0 + 10_000,
    lastBotReplyAt: 0,
  });
  assert.equal(skipOther.action, 'passive_ignore');
  assert.equal(skipOther.reason, 'nimbrung_mentions_other');

  // Obrolan bermakna dibalas bila lewat jeda cooldown 5 detik
  const okChat = evaluasiResponGrup({
    mode: 'nimbrung',
    text: 'menurut kalian besok hujan ga sih?',
    actorId: '628111',
    isMentioned: false,
    isReplyToBot: false,
    isTargetedCommand: false,
    hasWakeWord: false,
    nowMs: t0 + 10_000,
    lastBotReplyAt: t0 + 4_000,
  });
  assert.equal(okChat.action, 'reply');

  // Terlalu cepat (< 5 detik setelah balasan bot sebelumnya) -> cooldown
  const throttled = evaluasiResponGrup({
    mode: 'nimbrung',
    text: 'kalian mau makan apa nanti malam?',
    actorId: '628222',
    isMentioned: false,
    isReplyToBot: false,
    isTargetedCommand: false,
    hasWakeWord: false,
    nowMs: t0 + 10_000 + NIMBRUNG_COOLDOWN_MS - 1_000,
    lastBotReplyAt: t0 + 10_000,
  });
  assert.equal(throttled.action, 'passive_ignore');
  assert.equal(throttled.reason, 'nimbrung_cooldown');

  // Auto-revert setelah 30 menit sepi
  touchGroupActivity(gk, t0);
  const { record: revertedRec, autoReverted } = await getGroupModeRecord(gk, t0 + NIMBRUNG_IDLE_TIMEOUT_MS + 1_000);
  assert.equal(autoReverted, true);
  assert.equal(revertedRec.mode, 'mention');
});

test('follow-up window 75 detik aktif setelah dipanggil dan berhenti pada penutup atau timeout', () => {
  resetGroupModeUntukTest();
  const gk = 'wa_g:fu01';
  const t0 = 1_700_000_000_000;
  markGroupBotReply(gk, '628111', t0, true);

  assert.equal(isInFollowUpWindow(gk, '628111', t0 + 10_000), true);
  assert.equal(isInFollowUpWindow(gk, '628999', t0 + 10_000), false);
  assert.equal(isInFollowUpWindow(gk, '628111', t0 + FOLLOW_UP_WINDOW_MS + 1), false);

  markGroupBotReply(gk, '628111', t0, true);
  const cont = evaluasiResponGrup({
    mode: 'mention',
    text: 'terus kalau dibandingin sama kemarin gimana?',
    actorId: '628111',
    isMentioned: false,
    isReplyToBot: false,
    isTargetedCommand: false,
    hasWakeWord: false,
    inFollowUpWindow: true,
  });
  assert.equal(cont.action, 'reply');
  assert.equal(cont.reason, 'follow_up_window');

  const closeByThanks = evaluasiResponGrup({
    mode: 'mention',
    text: 'makasih banyak',
    actorId: '628111',
    isMentioned: false,
    isReplyToBot: false,
    isTargetedCommand: false,
    hasWakeWord: false,
    inFollowUpWindow: true,
  });
  assert.equal(closeByThanks.action, 'passive_ignore');
  clearFollowUpWindow(gk, '628111');
  assert.equal(isInFollowUpWindow(gk, '628111', t0 + 5_000), false);
});

test('passive listening buffer menyimpan maks 15 pesan, dikonsumsi sekali, dan diam mengabaikan total', () => {
  resetGroupModeUntukTest();
  const gk = 'wa_g:pas01';
  const t0 = 1_700_000_000_000;
  for (let i = 1; i <= 20; i++) {
    recordPassiveGroupMessage(gk, `User${i}`, `pesan nomor ${i}`, t0 + i * 1000);
  }
  const peeked = peekPassiveGroupContext(gk, t0 + 25_000);
  assert.ok(!peeked.includes('pesan nomor 5'));
  assert.ok(peeked.includes(`pesan nomor ${20 - PASSIVE_BUFFER_MAX + 1}`));
  assert.ok(peeked.includes('pesan nomor 20'));

  const consumed = consumePassiveGroupContext(gk, t0 + 25_000);
  assert.equal(consumed, peeked);
  assert.equal(consumePassiveGroupContext(gk, t0 + 25_000), '');

  const diamRes = evaluasiResponGrup({
    mode: 'diam',
    text: 'halo bot',
    actorId: '628111',
    isMentioned: true,
    isReplyToBot: true,
    isTargetedCommand: false,
    hasWakeWord: true,
  });
  assert.equal(diamRes.action, 'silent_ignore');
  assert.ok(formatStatusModeGrup({ mode: 'nimbrung', lockedByAdmin: false, updatedAt: t0, lastGroupActivityAt: t0, lastBotReplyAt: 0 }).includes('NIMBRUNG AKTIF'));
});

test('deteksiTargetBotBaileys mengenali mention via nomor PN maupun @lid Baileys v7', () => {
  const botIds = { botPn: '6283874640066:1@s.whatsapp.net', botLid: '12345678901234@lid' };

  const byLid = deteksiTargetBotBaileys('@12345678901234 apa kabar?', ['12345678901234@lid'], botIds);
  assert.equal(byLid.isMentioned, true);
  assert.equal(byLid.mentionsOtherOnly, false);
  assert.equal(byLid.cleanedText, 'apa kabar?');

  const byPn = deteksiTargetBotBaileys('@6283874640066 cek cuaca', ['6283874640066@s.whatsapp.net'], botIds);
  assert.equal(byPn.isMentioned, true);
  assert.equal(byPn.cleanedText, 'cek cuaca');

  const otherOnly = deteksiTargetBotBaileys('@6281234567890 makan yuk', ['6281234567890@s.whatsapp.net'], botIds);
  assert.equal(otherOnly.isMentioned, false);
  assert.equal(otherOnly.mentionsOtherOnly, true);
});

test('wiring whatsapp_baileys.ts, telegram.ts, dan commands.ts terhubung ke group_mode', () => {
  const WA = baca('src/whatsapp_baileys.ts');
  const TG = baca('src/telegram.ts');
  const CMD = baca('src/commands.ts');
  const ENV = baca('src/env.ts');

  assert.match(ENV, /WHATSAPP_RESPOND_GROUPS !== 'false'/);
  assert.match(WA, /evaluasiResponGrup/);
  assert.match(WA, /deteksiTargetBotBaileys/);
  assert.match(WA, /consumePassiveGroupContext/);
  assert.match(TG, /evaluasiResponGrup/);
  assert.match(TG, /consumePassiveGroupContext/);
  assert.match(CMD, /command:\s*'nimbrung'/);
  assert.match(CMD, /command:\s*'mention'/);
  assert.match(CMD, /command:\s*'diam'/);
  assert.match(CMD, /command:\s*'statusgrup'/);
});

test('deteksiPerintahModeGrup mengenali /nimbrung setelah sapaan dan alias /status', () => {
  assert.equal(deteksiPerintahModeGrup('oyy /nimbrung', { isDirected: true, currentMode: 'mention' }), 'nimbrung');
  assert.equal(deteksiPerintahModeGrup('halo bot /stopnimbrung', { isDirected: true, currentMode: 'nimbrung' }), 'mention');
  assert.equal(deteksiPerintahModeGrup('/status', { isDirected: false, currentMode: 'mention' }), 'status');
  assert.equal(deteksiPerintahModeGrup('status', { isDirected: true, currentMode: 'mention' }), 'status');
  assert.equal(deteksiPerintahModeGrup('status', { isDirected: false, currentMode: 'mention' }), null);
});

test('stiker & media tanpa caption tetap dibalas saat nimbrung dan di jendela follow-up 75 detik', () => {
  const nimbrungStiker = evaluasiResponGrup({
    mode: 'nimbrung',
    text: '',
    actorId: 'u1',
    isMentioned: false,
    isReplyToBot: false,
    isTargetedCommand: false,
    hasWakeWord: false,
    wakeCleanedText: '',
    hasMedia: true,
    hasSticker: true,
  });
  assert.equal(nimbrungStiker.action, 'reply');

  const followStiker = evaluasiResponGrup({
    mode: 'mention',
    text: '',
    actorId: 'u1',
    isMentioned: false,
    isReplyToBot: false,
    isTargetedCommand: false,
    hasWakeWord: false,
    wakeCleanedText: '',
    hasMedia: true,
    hasSticker: true,
    inFollowUpWindow: true,
    lastBotReplyAt: Date.now() - 5000,
  });
  assert.equal(followStiker.action, 'reply');
  assert.equal(followStiker.shouldSetFollowUp, true);

  const followFoto = evaluasiResponGrup({
    mode: 'mention',
    text: '',
    actorId: 'u2',
    isMentioned: false,
    isReplyToBot: false,
    isTargetedCommand: false,
    hasWakeWord: false,
    wakeCleanedText: '',
    hasMedia: true,
    hasSticker: false,
    inFollowUpWindow: true,
    lastBotReplyAt: Date.now() - 5000,
  });
  assert.equal(followFoto.action, 'reply');
  assert.equal(followFoto.shouldSetFollowUp, true);
});

test('unwrapBaileysMessage membuka pembungkus ephemeral, viewOnceV2, documentWithCaption, lottieSticker, dan edited', () => {
  const stiker = { stickerMessage: { mimetype: 'image/webp' } };
  assert.deepEqual(unwrapBaileysMessage({ ephemeralMessage: { message: stiker } }), stiker);
  assert.deepEqual(unwrapBaileysMessage({ viewOnceMessageV2: { message: stiker } }), stiker);
  const dok = { documentMessage: { fileName: 'uji.pdf' } };
  assert.deepEqual(unwrapBaileysMessage({ documentWithCaptionMessage: { message: dok } }), dok);
  assert.deepEqual(unwrapBaileysMessage({ lottieStickerMessage: { message: stiker } }), stiker);
  const teks = { conversation: 'editan' };
  assert.deepEqual(unwrapBaileysMessage({ editedMessage: { message: teks } }), teks);
});
