/**
 * TEST OTOMATIS — bot bisa melihat pesannya SENDIRI & isi pesan yang di-reply.
 * (09 Okt 2026)
 *
 * LAPORAN PEMILIK PRODUK (2 bug dari screenshot):
 *   1. "emg bot gabisa liat pesan otomatis fitur?"
 *      User me-reply pesan pengingat otomatis bot ("Pengingat! Waktunya mandi
 *      nih.") lalu bertanya "ini apa" — bot menjawab NGAWUR ("Maksudnya, ya cuma
 *      'oyy'") karena TIDAK BISA MELIHAT pesan pengingatnya sendiri.
 *
 *   2. "saya nyoba reply tag pesan yg sudah sangat lama lalu menanyakan ini apa
 *      ternyata bot nya juga masih tidak bisa melihat apa yg di reply tag user"
 *
 * AKAR BUG 1: chat_id TIDAK KONSISTEN.
 *   `reminders` menyimpan "628991333323" (tanpa prefix), sedangkan `messages`
 *   memakai "wa_628991333323". Saat pengingat terkirim, saveMessage() memakai
 *   chat_id tanpa prefix → tersimpan di "kolom percakapan" berbeda → tidak
 *   terbaca getContext() → bot tidak tahu pesannya sendiri.
 *
 * AKAR BUG 2: saat me-reply pesan LAMA, Meta sering hanya mengirim ID-nya
 *   (`context.id`) tanpa isi teks. Bot tidak punya fallback ke database.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normChatId, nomorWhatsApp } from '../src/remind.js';

const DB = fs.readFileSync(new URL('../src/db.ts', import.meta.url), 'utf8');
const WA = fs.readFileSync(new URL('../src/whatsapp_cloud.ts', import.meta.url), 'utf8');
const REMIND = fs.readFileSync(new URL('../src/remind.ts', import.meta.url), 'utf8');

test('chat_id: WhatsApp SELALU berprefix wa_ (konsisten dengan messages)', () => {
  assert.equal(normChatId('628991333323', 'whatsapp'), 'wa_628991333323');
  assert.equal(normChatId('wa_628991333323', 'whatsapp'), 'wa_628991333323');
  // Telegram dibiarkan (messages memang memakai String(chat.id)).
  assert.equal(normChatId('1073504871', 'telegram'), '1073504871');
  assert.equal(normChatId('-1001234567890', 'telegram'), '-1001234567890');
});

test('chat_id: normalisasi DIPAKAI saat menyimpan & mengirim pengingat', () => {
  // Inti perbaikan: fungsi normalisasi harus benar-benar dipanggil.
  assert.ok(/simpanReminderCerdas\([\s\S]{0,200}normChatId/.test(REMIND) || REMIND.includes('chatId = normChatId'),
    'simpanReminderCerdas harus memakai normChatId');
  assert.ok(REMIND.includes('normChatId(chatId, platform)'), 'saveReminderToDb harus memakai normChatId');
});

test('quote: ada fungsi cari pesan lama di database', () => {
  assert.ok(/export async function cariPesanByMsgId/.test(DB), 'harus ada cariPesanByMsgId');
  assert.ok(/export async function pesanBotTerakhir/.test(DB), 'harus ada pesanBotTerakhir');
});

test('quote: fallback ke DB DIPAKAI saat Meta tidak kirim isi pesan', () => {
  // Inti perbaikan bug 2: harus benar-benar dipanggil dari whatsapp_cloud.
  assert.ok(WA.includes('cariPesanByMsgId'), 'cariPesanByMsgId harus dipanggil');
  assert.ok(WA.includes('pesanBotTerakhir'), 'pesanBotTerakhir harus dipanggil sebagai cadangan');
});

test('quote: label "Membalas" tetap disisipkan ke teks untuk AI', () => {
  assert.ok(WA.includes('[Membalas'), 'harus ada label Membalas');
});

test('KIRIM: nomor WA dibersihkan dari prefix wa_ (jangan sampai gagal kirim)', () => {
  // Setelah normalisasi, chat_id memakai "wa_" — prefix itu HARUS dibuang sebelum
  // dikirim ke Meta, kalau tidak pengingat GAGAL TERKIRIM.
  const kasus = [
    ['wa_628991333323', '628991333323'],
    ['628991333323', '628991333323'],
    ['6282116656810@s.whatsapp.net', '6282116656810'],
    ['+6282216412166', '6282216412166'],
    ['62895392942433:12', '62895392942433'],
  ];
  for (const [masuk, harap] of kasus) {
    assert.equal(nomorWhatsApp(masuk), harap, `"${masuk}" -> harus "${harap}"`);
  }
});

test('KIRIM: cron & baileys memakai nomorWhatsApp()', () => {
  const cron = fs.readFileSync(new URL('../api/cron/reminders.ts', import.meta.url), 'utf8');
  const bai = fs.readFileSync(new URL('../src/whatsapp_baileys.ts', import.meta.url), 'utf8');
  assert.ok(cron.includes('nomorWhatsApp('), 'cron harus memakai nomorWhatsApp');
  assert.ok(bai.includes('nomorWhatsApp('), 'baileys harus memakai nomorWhatsApp');
});
