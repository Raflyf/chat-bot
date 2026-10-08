/**
 * TEST OTOMATIS — klasifikasi mood stiker benar (08 Okt 2026).
 *
 * PERMINTAAN PEMILIK PRODUK: "lihat semua stiker nya sama kamu, konsep stiker nya,
 * caption stiker nya, ekspresi stiker nya lalu beri label dengan benar dan
 * klasifikasikan dengan benar agar bot tidak asal pakai stiker" +
 * "awas jangan salah klasifikasikan stiker nya".
 *
 * CARA: 221 stiker dilihat langsung lewat montase (scripts/make_sticker_sheets.py),
 * lalu emoji + mood dikoreksi berdasarkan TEKS yang tertulis di stiker.
 *
 * TEMUAN FATAL: 😂 bertulisan "LU DONGO APA GIMANA" dulu diklasifikasi 'lucu',
 * padahal itu EJEKAN. Bot bisa tertawa saat menghina user.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stickerMood, stickerFitsMood } from '../src/stickers.js';
import { STICKER_INFO } from '../src/sticker-manifest.js';

test('stiker: teks EJEKAN tidak boleh bermood lucu', () => {
  // Emoji yang teksnya menghina/ejek harus 'kesal'/'sindir', BUKAN 'lucu'.
  const ejek = ['😂', '🐷', '👎', '🤦', '🐌', '🐟'];
  for (const e of ejek) {
    const d = STICKER_INFO[e];
    if (!d || !d.teks) continue;
    const m = stickerMood(e);
    assert.notEqual(m, 'lucu', `${e} "${d.teks}" tidak boleh 'lucu' (dapat ${m})`);
  }
});

test('stiker: mood cocok dengan teks (audit 221 stiker)', () => {
  const aturan = [
    [/dongo|bego|tolol|bodoh|goblok|babi|tuman|bacot|bangsad|brisik|pakyu|anjing|tai\b|sialan/i, 'kesal'],
    [/nangis|hancur|duit gue tinggal|menangis|forgor|ijin.*nangis/i, 'sedih'],
    [/otak|mikir|dipake|princess|nyawit|bau kebohongan|manuk akal/i, 'sindir'],
  ];
  let salah = 0;
  for (const [emoji, d] of Object.entries(STICKER_INFO)) {
    const teks = (d.teks || '').toLowerCase();
    if (!teks) continue;
    for (const [pola, harus] of aturan) {
      if (pola.test(teks)) {
        const ada = stickerMood(emoji);
        if (ada !== harus) salah++;
        break;
      }
    }
  }
  assert.equal(salah, 0, `${salah} stiker mood-nya tidak cocok dengan teksnya`);
});

test('stiker: user sedih tidak dapat stiker lucu', () => {
  assert.equal(stickerFitsMood('😂', 'aku sedih banget hari ini'), false, '😂 tidak cocok saat sedih');
  assert.equal(stickerFitsMood('😢', 'aku sedih banget hari ini'), true, '😢 cocok saat sedih');
});

test('stiker: user kesal tidak dapat stiker lucu', () => {
  assert.equal(stickerFitsMood('😂', 'aku kesal banget sama kamu'), false);
  assert.equal(stickerFitsMood('🙏', 'aku kesal banget sama kamu'), true);
});

test('stiker: suasana formal tidak ada stiker', () => {
  assert.equal(stickerFitsMood('😂', 'mohon bantuan untuk laporan ini', true), false);
});
