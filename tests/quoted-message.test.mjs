/**
 * TEST OTOMATIS — pesan yang di-REPLY user (quoted message) 06 Okt 2026.
 *
 * KENAPA: dari screenshot nyata, user membalas pesan bot:
 *   BOT : "Hahaha iya sih, gue juga suka ngeledek. Makanya lu jangan baper ya."
 *   USER: "Mau"   <- balasan pesan itu (artinya: iya mau)
 *   BOT : "Ngom..." <- NGAWUR, karena tidak tahu pesan yang dibalas.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const WA = fs.readFileSync(new URL('../src/whatsapp_cloud.ts', import.meta.url), 'utf8');
const TG = fs.readFileSync(new URL('../src/telegram.ts', import.meta.url), 'utf8');
const BL = fs.readFileSync(new URL('../src/whatsapp_baileys.ts', import.meta.url), 'utf8');
const SK = fs.readFileSync(new URL('../src/skills.ts', import.meta.url), 'utf8');

test('whatsapp-cloud: membaca m.context (quoted message)', () => {
  assert.match(WA, /m as unknown as \{ context\?:/, 'harus baca m.context');
  assert.match(WA, /quotedText/, 'harus punya variabel quotedText');
  assert.match(WA, /Membalas \$\{label\}/, 'harus sisipkan penanda Membalas');
});

test('whatsapp-cloud: deteksi pesan yang dibalas milik BOT', () => {
  assert.match(WA, /quotedFromBot/, 'harus deteksi apakah pesan bot');
});

test('telegram: membaca reply_to_message', () => {
  assert.match(TG, /rtm\?\.text/, 'harus baca isi reply_to_message');
  assert.match(TG, /quotedText/, 'harus punya variabel quotedText');
  assert.match(TG, /Membalas \$\{quotedLabel\}/, 'harus sisipkan ke prompt');
});

test('baileys: membaca contextInfo.quotedMessage', () => {
  assert.match(BL, /ctxInfo\?\.quotedMessage/, 'harus baca contextInfo.quotedMessage');
  assert.match(BL, /quotedText/, 'harus punya variabel quotedText');
});

test('prompt: ada aturan memakai konteks balasan', () => {
  assert.ok(SK.includes('[Membalas ...]'), 'harus ada aturan penanda');
  assert.ok(SK.includes('JANGAN mengabaikan penanda itu'), 'harus larang mengabaikan');
  assert.ok(SK.includes('DIA MAU'), 'harus contoh nyata');
});

test('semua platform: format penanda SAMA', () => {
  for (const [nama, src] of [['whatsapp_cloud', WA], ['telegram', TG], ['baileys', BL]]) {
    assert.ok(src.includes('Membalas'), `${nama} harus memakai penanda Membalas`);
  }
});

// ── 3 LABEL PENGIRIM (perbaikan 06 Okt 2026, dari screenshot nyata) ──
test('3 label: ada label untuk pesan user SENDIRI', () => {
  assert.ok(WA.includes('pesan DIA SENDIRI'), 'WA harus punya label diri');
  assert.ok(TG.includes('pesan DIA SENDIRI'), 'TG harus punya label diri');
  assert.ok(BL.includes('pesan DIA SENDIRI'), 'Baileys harus punya label diri');
});

test('3 label: ada label untuk pesan ORANG LAIN', () => {
  assert.ok(WA.includes('pesan ORANG LAIN'), 'WA harus punya label lain');
  assert.ok(TG.includes('pesan ORANG LAIN'), 'TG harus punya label lain');
  assert.ok(BL.includes('pesan ORANG LAIN'), 'Baileys harus punya label lain');
});

test('3 label: variabel quotedPengirim ada di semua platform', () => {
  assert.ok(WA.includes('quotedPengirim'), 'WA harus punya quotedPengirim');
  assert.ok(TG.includes('quotedPengirim'), 'TG harus punya quotedPengirim');
  assert.ok(BL.includes('quotedPengirim'), 'Baileys harus punya quotedPengirim');
});

test('3 label: prompt menjelaskan cara bedakan 3 label', () => {
  assert.ok(SK.includes('pesan DIA SENDIRI (bukan kamu, bukan orang lain)'), 'prompt harus jelas');
  assert.ok(SK.includes('dia sedang menegaskan/melanjutkan ucapannya sendiri'), 'prompt harus beri contoh');
});

// Replikasi logika penentuan pengirim
function tentukanPengirim(fromNum, botNum, userNum, quotedText) {
  const norm = (x) => String(x || '').replace(/\D/g, '');
  const f = norm(fromNum), b = norm(botNum), u = norm(userNum);
  if (f && b && f.endsWith(b)) return 'bot';
  if (f && u && f === u) return 'diri';
  if (f) return 'lain';
  return /^(?:✅|🗑️|⚠️|📊|⏰|💰|📝|🎮|_)/.test(quotedText) ? 'bot' : 'diri';
}

test('3 label: user reply pesan SENDIRI terdeteksi', () => {
  assert.equal(tentukanPengirim('628991333323', '6283874640066', '628991333323', 'Teman? 💔'), 'diri');
});

test('3 label: user reply pesan BOT terdeteksi', () => {
  assert.equal(tentukanPengirim('6283874640066', '6283874640066', '628991333323', 'Hahaha iya'), 'bot');
});

test('3 label: reply pesan orang lain terdeteksi', () => {
  assert.equal(tentukanPengirim('628111222333', '6283874640066', '628991333323', 'halo'), 'lain');
});
