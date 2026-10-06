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
  assert.match(TG, /Membalas \$\{quotedFromBot/, 'harus sisipkan ke prompt');
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
