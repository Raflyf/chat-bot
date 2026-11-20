/**
 * TEST OTOMATIS — pemisahan otak Baileys vs Cloud API & perbaikan konteks obrolan (20 Nov 2026).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  baileysChatKey,
  baileysGroupChatKey,
  isBaileysChatKey,
  isGroupChatKey,
  sharedChatKeyDari,
  normChatId,
  nomorWhatsApp,
} from '../src/chat_id.js';
import { saringNoiseRiwayat } from '../src/memory.js';
import { imageUserContent } from '../src/media.js';
import {
  systemPrompt,
  bolehPicuGuardAmnesia,
  extractImageDescTag,
  sanitizeAssistantOutput,
} from '../src/skills.js';

const baca = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');

test('kunci chat Baileys vs Cloud: riwayat chat terpisah, data bersama tetap konsisten', () => {
  const bKey = baileysChatKey('628991333323@s.whatsapp.net');
  assert.equal(bKey, 'wa_baileys_628991333323');
  assert.equal(isBaileysChatKey(bKey), true);
  assert.equal(isBaileysChatKey('wa_628991333323'), false);
  assert.equal(normChatId(bKey, 'whatsapp'), 'wa_baileys_628991333323');
  assert.equal(nomorWhatsApp(bKey), '628991333323');
  assert.equal(sharedChatKeyDari(bKey), 'wa_628991333323');
  assert.equal(sharedChatKeyDari('wa_628991333323'), 'wa_628991333323');

  // Kunci grup WA & Telegram terisolasi total dari data privat owner/member
  const grpKey = baileysGroupChatKey('12036312345678@g.us');
  assert.equal(grpKey, 'wa_baileys_group_12036312345678');
  assert.equal(baileysChatKey('12036312345678@g.us'), grpKey);
  assert.equal(isBaileysChatKey(grpKey), true);
  assert.equal(isGroupChatKey(grpKey), true);
  assert.equal(isGroupChatKey('wa_-1001234567890'), true);
  assert.equal(isGroupChatKey('wa_baileys_628991333323'), false);
  assert.equal(sharedChatKeyDari(grpKey), grpKey, 'sharedChatKeyDari tidak boleh memetakan grup ke wa_<angka>');
});

test('systemPrompt: Baileys membuang aturan Cloud-only & tidak ada blok duplikat', () => {
  const bPrompt = systemPrompt(
    { history: [], corrections: [], summary: null, chatId: 'wa_baileys_628991333323' },
    null,
    'halo',
  );
  const cPrompt = systemPrompt(
    { history: [], corrections: [], summary: null, chatId: 'wa_628991333323' },
    null,
    'halo',
  );

  assert.ok(
    !bPrompt.includes('DILARANG menyebut atau mengklaim versi Baileys'),
    'otak Baileys tidak boleh memuat aturan yang menyangkal keberadaan Baileys',
  );
  assert.ok(
    cPrompt.includes('DILARANG menyebut atau mengklaim versi Baileys'),
    'otak Cloud tetap menjaga batasan layanan WhatsApp Cloud',
  );
  assert.equal((cPrompt.match(/ATURAN TINDAKAN \(KERAS\):/g) || []).length, 1, 'ATURAN TINDAKAN hanya boleh 1x');
  assert.ok(!cPrompt.includes('\nNama kamu FreeAIBot.\n'), 'baris redundant "Nama kamu" harus digabung');
  assert.ok(cPrompt.includes('Rafly Firmansyah'), 'status terverifikasi owner tetap berlaku untuk Cloud');
  assert.ok(bPrompt.includes('Rafly Firmansyah'), 'status terverifikasi owner tetap berlaku untuk Baileys');

  // Di grup, status chat privat owner tidak boleh bocor meskipun ID grup memuat digit owner atau owner menjadi anggota
  const grpPrompt = systemPrompt(
    { history: [], corrections: [], summary: null, chatId: 'wa_baileys_group_628991333323' },
    null,
    '[Pesan di Grup dari Rafly]: halo',
  );
  assert.ok(!grpPrompt.includes('Lawan bicaramu SEKARANG adalah Rafly Firmansyah'), 'grup tidak boleh membuka blok owner DM');
  assert.ok(grpPrompt.includes('Lawan bicaramu saat ini adalah teman ngobrol biasa'), 'grup harus diperlakukan sebagai obrolan biasa');
  assert.ok(grpPrompt.includes('KONTEKS GRUP (ATURAN KHUSUS OBROLAN GRUP)'), 'grup harus mendapat blok batasan grup');
});

test('bolehPicuGuardAmnesia: ping/sapaan singkat tidak memicu guard, keluhan nyata memicu', () => {
  for (const ping of ['woy', 'okeh', 'tes', 'bales jir', 'halo', 'p']) {
    assert.equal(bolehPicuGuardAmnesia(ping), false, `"${ping}" tidak boleh memicu guard amnesia`);
  }
  for (const nyata of [
    'saya bilang saya di cianjur',
    'cape ah kamu bodoh terus ngulang chat mulu gajelas',
  ]) {
    assert.equal(bolehPicuGuardAmnesia(nyata), true, `"${nyata}" harus boleh memicu guard amnesia`);
  }
});

test('saringNoiseRiwayat: buang [baileys-msg], batasi reminder & ringkasan, jaga obrolan normal', () => {
  const rowsDesc = [
    { role: 'user', content: 'gimana lanjutannya?' },
    { role: 'assistant', content: '⏰ Pengingat: ON', via: 'reminder' },
    { role: 'assistant', content: '📊 Ringkasan terbaru', via: 'notes/ringkasan' },
    { role: 'user', content: '[baileys-msg]', via: null },
    { role: 'assistant', content: 'Oke sip!', via: 'groq/qwen' },
    { role: 'assistant', content: '⏰ Pengingat: tes lama', via: 'reminder' },
    { role: 'assistant', content: '📊 Ringkasan lama', via: 'notes/ringkasan' },
    { role: 'user', content: 'ringkasan', via: null },
    { role: 'user', content: 'aku suka kopi hitam', via: null },
  ];
  const filtered = saringNoiseRiwayat(rowsDesc);
  assert.equal(filtered.some((r) => r.content === '[baileys-msg]'), false, '[baileys-msg] harus dibuang');
  assert.equal(filtered.filter((r) => r.via === 'reminder').length, 1, 'reminder maksimal 1 yang paling baru');
  assert.equal(filtered.filter((r) => r.via === 'notes/ringkasan').length, 1, 'ringkasan maksimal 1 yang paling baru');
  assert.equal(filtered.some((r) => r.content === 'ringkasan'), false, 'perintah ringkasan lama harus dibuang');
  assert.ok(filtered.some((r) => r.content === 'aku suka kopi hitam'), 'obrolan normal harus dipertahankan');
  assert.ok(filtered.some((r) => r.content === 'Oke sip!'), 'balasan normal harus dipertahankan');
});

test('extractImageDescTag & imageUserContent: metadata gambar terpisah dan bersih di output user', () => {
  const raw = 'Lucu juga logonya, kelihatan simpel.\n[[image_desc:ikon avatar robot tersenyum biru ungu]]';
  const parsed = extractImageDescTag(raw);
  assert.equal(parsed.text, 'Lucu juga logonya, kelihatan simpel.');
  assert.equal(parsed.imageDesc, 'ikon avatar robot tersenyum biru ungu');
  assert.equal(imageUserContent(undefined, parsed.imageDesc), '[Gambar: ikon avatar robot tersenyum biru ungu]');
  assert.equal(imageUserContent('ini bagus ga?', parsed.imageDesc), '[Gambar: ikon avatar robot tersenyum biru ungu] ini bagus ga?');
  assert.equal(sanitizeAssistantOutput(raw, 'gila lu'), 'Lucu juga logonya, kelihatan simpel.');
});

test('wiring otak terpisah Baileys, Cloud API, dan Telegram', () => {
  const BAIL = baca('src/whatsapp_baileys.ts');
  const BRAIN = baca('src/baileys_brain.ts');
  const CLOUD = baca('src/whatsapp_cloud.ts');
  const TELE = baca('src/telegram.ts');

  assert.match(BAIL, /const chatKey = isGroup \? baileysGroupChatKey\(nomorBaileys\) : baileysChatKey\(nomorBaileys\)/);
  assert.match(BAIL, /const personalOwnerId = isGroup \? chatKey : nomorBaileys/);
  assert.match(BAIL, /const sharedDataKey = isGroup \? chatKey : normChatId\(personalOwnerId, 'whatsapp'\)/);
  assert.match(BAIL, /baileysAutoReply\(/);
  assert.match(BAIL, /baileysDescribeImage\(/);
  assert.match(BAIL, /baileysDynamicNotice\(/);
  assert.match(BAIL, /imageUserContent\(/);

  assert.match(BRAIN, /pastikanKonteksBaileys/);
  assert.match(CLOUD, /imageUserContent\(/);
  assert.match(TELE, /imageUserContent\(/);
});

test('perbaikan kontinuitas & kebersihan DB: reminder sync, quote DB fallback, summary filter, upsert update fallback', () => {
  const REMIND = baca('src/remind.ts');
  const BAIL = baca('src/whatsapp_baileys.ts');
  const MEMORY = baca('src/memory.ts');
  const DB = baca('src/db.ts');

  assert.match(REMIND, /options\?\.channelFilter === 'baileys_only'[\s\S]{0,120}baileysChatKey\(item\.chat_id\)/);
  assert.match(REMIND, /updateContextCache\(targetHistoryChatId,\s*'assistant',\s*deliveryText\)/);

  assert.match(BAIL, /cariPesanByMsgId\('whatsapp',\s*idQuoted\)/);
  assert.match(BAIL, /dariDb\.content !== '\[baileys-msg\]'/);
  assert.match(BAIL, /pesanBotTerakhir\('whatsapp',\s*chatKey\)/);

  assert.match(MEMORY, /\.select\('role,content,via'\)/);
  assert.match(MEMORY, /const filteredMessages = saringNoiseRiwayat\(validMessages\)/);

  assert.match(DB, /\.update\(insertPayload\)[\s\S]{0,120}\.eq\('platform',\s*row\.platform\)[\s\S]{0,120}\.eq\('msg_id',\s*row\.msg_id\)/);
  assert.match(DB, /if \(updateErr \|\| !updatedRows \|\| updatedRows\.length === 0\)/);
});
