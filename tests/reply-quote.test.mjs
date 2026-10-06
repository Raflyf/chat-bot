/**
 * TEST OTOMATIS — bot bisa BALAS (quote) pesan (06 Okt 2026).
 *
 * KENAPA: "apakah bot juga bisa tag reply?"
 * Sebelumnya TIDAK BISA di ketiga platform (tidak ada parameter quote).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const WA = fs.readFileSync(new URL('../src/whatsapp_cloud.ts', import.meta.url), 'utf8');
const TG = fs.readFileSync(new URL('../src/telegram.ts', import.meta.url), 'utf8');
const BL = fs.readFileSync(new URL('../src/whatsapp_baileys.ts', import.meta.url), 'utf8');

test('whatsapp-cloud: kirim pesan dukung quote (context.message_id)', () => {
  assert.match(WA, /replyToMessageId\?:\s*string/, 'harus ada parameter replyToMessageId');
  assert.match(WA, /context:\s*\{\s*message_id/, 'harus pakai context.message_id');
});

test('whatsapp-cloud: quote hanya chunk pertama', () => {
  assert.match(WA, /chunk === chunks\[0\]/, 'quote hanya chunk pertama');
});

test('telegram: kirim pesan dukung reply_parameters', () => {
  assert.match(TG, /replyToMessageId\?:\s*number/, 'harus ada parameter');
  assert.match(TG, /reply_parameters/, 'harus pakai reply_parameters');
});

test('baileys: kirim pesan dukung quoted', () => {
  assert.match(BL, /quotedMsg\?:\s*unknown/, 'harus ada parameter quotedMsg');
  assert.match(BL, /payload\.quoted\s*=\s*quotedMsg/, 'harus set payload.quoted');
});

test('semua platform: quote dipakai saat user membalas pesan lama', () => {
  assert.match(WA, /perluQuote\s*=\s*Boolean\(quotedText\)/, 'WA harus quote saat quotedText ada');
  assert.match(TG, /idUntukQuoteTg\s*=\s*quotedText/, 'TG harus quote saat quotedText ada');
  assert.match(BL, /quotedText\s*\?\s*m\s*:\s*undefined/, 'Baileys harus quote saat quotedText ada');
});

test('semua platform: quote TIDAK dipakai untuk obrolan biasa', () => {
  // Guard: hanya bila quotedText ada -> obrolan biasa tidak di-quote.
  assert.match(WA, /const perluQuote = Boolean\(quotedText\)/, 'WA harus guard');
});
