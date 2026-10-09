/**
 * TEST OTOMATIS — chat_id KONSISTEN di SELURUH tabel (09 Okt 2026).
 *
 * ATURAN PEMILIK PRODUK: "yg saya kirim dan keluhkan itu hanya sebagai 1 contoh
 * kesalahan, jadi jika itu di perbaiki maka yg lain itu belum tentu benar juga"
 * -> perbaikan WAJIB universal, bukan tambal sulit pada contoh yang disebut.
 *
 * TEMUAN AUDIT: chat_id TIDAK KONSISTEN antar tabel:
 *   messages   : "wa_628991333323"  (dengan prefix)
 *   reminders  : "628991333323"     (tanpa prefix)
 *   notes/todos/expenses : tanpa prefix
 *   corrections: campur (3 prefix, 3 telanjang, 61 lain)
 *
 * AKIBAT NYATA: bot TIDAK BISA MELIHAT datanya sendiri — user me-reply pesan
 * pengingat bot lalu bertanya "ini apa", bot menjawab ngawur.
 *
 * SOLUSI: satu sumber normalisasi `src/chat_id.ts`, dipakai di SEMUA jalur
 * baca & tulis. Data lama di 11 tabel dimigrasi.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normChatId, nomorWhatsApp } from '../src/chat_id.js';

const baca = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');

test('chat_id: WhatsApp SELALU berprefix wa_', () => {
  assert.equal(normChatId('628991333323', 'whatsapp'), 'wa_628991333323');
  assert.equal(normChatId('wa_628991333323', 'whatsapp'), 'wa_628991333323');
  assert.equal(normChatId('+628991333323', 'whatsapp'), 'wa_628991333323');
  assert.equal(normChatId('628991333323', 'whatsapp'), 'wa_628991333323');
});

test('chat_id: Telegram dibiarkan angka apa adanya', () => {
  assert.equal(normChatId('1073504871', 'telegram'), '1073504871');
  assert.equal(normChatId('-1001234567890', 'telegram'), '-1001234567890');
});

test('chat_id: kunci non-nomor dibiarkan (fixture test)', () => {
  assert.equal(normChatId('tz_b865', 'whatsapp'), 'tz_b865');
  assert.equal(normChatId('__uji__', 'whatsapp'), '__uji__');
});

test('chat_id: normalisasi IDEMPOTEN (aman diulang)', () => {
  const a = normChatId('628991333323', 'whatsapp');
  assert.equal(normChatId(a, 'whatsapp'), a, 'normalisasi dua kali harus sama');
});

test('KIRIM: nomor WhatsApp dibersihkan dari prefix', () => {
  assert.equal(nomorWhatsApp('wa_628991333323'), '628991333323');
  assert.equal(nomorWhatsApp('628991333323'), '628991333323');
  assert.equal(nomorWhatsApp('6282116656810@s.whatsapp.net'), '6282116656810');
  assert.equal(nomorWhatsApp('+6282216412166'), '6282216412166');
});

test('chat_id: SATU SUMBER — dipakai di semua jalur tulis utama', () => {
  // db.ts (messages), memory.ts (corrections/summaries), notes.ts (notes/todos/expenses),
  // user_facts.ts (fakta personal).
  for (const f of ['src/db.ts', 'src/memory.ts', 'src/notes.ts', 'src/user_facts.ts', 'src/remind.ts']) {
    const isi = baca(f);
    assert.ok(isi.includes('chat_id.js'), `${f} harus memakai chat_id.js (satu sumber)`);
  }
});

test('chat_id: getContext menormalisasi saat BACA (data lama tetap terbaca)', () => {
  const mem = baca('src/memory.ts');
  assert.ok(/getContext[\s\S]{0,300}normChatId/.test(mem),
    'getContext harus menormalisasi chat_id agar data lama terbaca');
});

test('KIRIM: Telegram Number() dibersihkan dari prefix', () => {
  // Bila chat_id berprefix "wa_", Number("wa_...") = NaN -> pengiriman GAGAL.
  for (const f of ['src/remind.ts', 'api/cron/reminders.ts']) {
    const isi = baca(f);
    if (isi.includes('Number(chatId)')) {
      assert.ok(!/Number\(chatId\)/.test(isi), `${f} jangan Number(chatId) langsung`);
    }
  }
});
