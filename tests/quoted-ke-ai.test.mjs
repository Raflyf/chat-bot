/**
 * TEST OTOMATIS — konteks pesan yang di-reply HARUS sampai ke AI (06 Okt 2026).
 *
 * KENAPA: "padahal user tag reply yg kalo ada 2 awas ya itu bukan begitu mksd nya,
 * tapi botnya kaya ga bisa melihat apa yg di tag reply user jadi ga nyambung"
 *
 * AKAR (WhatsApp Cloud): `quotedText` hanya disisipkan ke `initialContent`
 * (untuk klaim DB), TETAPI teks yang dikirim ke AI diambil ULANG dari
 * `m.text.body`, sehingga penanda "[Membalas ...]" HILANG.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const WA = fs.readFileSync(new URL('../src/whatsapp_cloud.ts', import.meta.url), 'utf8');
const TG = fs.readFileSync(new URL('../src/telegram.ts', import.meta.url), 'utf8');
const BL = fs.readFileSync(new URL('../src/whatsapp_baileys.ts', import.meta.url), 'utf8');

test('whatsapp-cloud: teks ke AI MEMUAT penanda [Membalas ...]', () => {
  assert.match(WA, /const textUntukAi = quotedText/, 'harus ada textUntukAi');
  assert.ok(WA.includes('[Membalas ${'), 'harus sisipkan penanda');
  assert.match(WA, /autoReply\(textUntukAi/, 'autoReply harus pakai textUntukAi');
});

test('whatsapp-cloud: autoReply TIDAK lagi pakai teks mentah', () => {
  assert.ok(!WA.includes('await autoReply(text, context, webResults)'), 'teks mentah tidak boleh dipakai');
});

test('whatsapp-cloud: penanda disisipkan SETELAH deteksi perintah', () => {
  // /remind, /salah, /reset harus tetap baca teks asli.
  const idxReset = WA.indexOf('if (isResetCommand(text))');
  const idxTextAi = WA.indexOf('const textUntukAi = quotedText');
  assert.ok(idxReset > 0 && idxTextAi > idxReset, 'penanda harus SETELAH deteksi perintah');
});

test('telegram: promptText (dengan penanda) dipakai autoReply', () => {
  assert.match(TG, /autoReply\(promptText/, 'harus pakai promptText');
});

test('baileys: promptFinal (dengan penanda) dipakai autoReply', () => {
  assert.match(BL, /autoReply\(promptFinal/, 'harus pakai promptFinal');
});
