/**
 * TEST OTOMATIS — stiker: teks dulu, baru konsep, baru ekspresi (08 Okt 2026).
 *
 * PERMINTAAN PEMILIK PRODUK:
 *   "knapa bot nya jarang memberikan stiker?" + "bukan jarang bahkan hampir tidak
 *    pernah" + "yg utama dari stiker nya itu text atau caption yg ada di stiker nya,
 *    jika tidak ada baru dari konsep dan konsep isi stiker nya, baik stiker yg di
 *    kirim bot, maupun yg di kirim user maka yg pertama di lihat apakah ada text
 *    atau captionya, kalo tidak ada baru dari ekspresi stiker nya di sesuaikan
 *    dengan suasana percakapan".
 *
 * AKAR MASALAH YANG DIPERBAIKI:
 *  1. Teks & konsep stiker TIDAK PERNAH diekspor ke model — model hanya dapat
 *     daftar emoji, jadi tidak tahu tulisan di stiker.
 *  2. Aturan prompt menekankan "JANGAN BERLEBIHAN" + "1 dari 8-10 balasan"
 *     sehingga model praktis tidak pernah menyisipkan stiker (uji 5/5 = nol).
 *  3. Daftar stiker lengkap (110 emoji + teks + konsep) membengkakkan prompt
 *     sampai 6.941/7.000 token — nyaris mentok batas provider.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { STICKER_INFO, STICKER_MANIFEST } from '../src/sticker-manifest.js';

const SK = fs.readFileSync(new URL('../src/skills.ts', import.meta.url), 'utf8');

test('manifest: STICKER_INFO tersedia dengan teks + konsep', () => {
  assert.ok(STICKER_INFO && Object.keys(STICKER_INFO).length > 50, 'harus ada STICKER_INFO');
  const contoh = Object.entries(STICKER_INFO).find(([, d]) => d.teks && d.teks.trim());
  assert.ok(contoh, 'harus ada minimal satu stiker berteks');
  assert.ok(contoh[1].pakai, 'harus ada konsep pemakaian');
});

test('manifest: setiap emoji STICKER_INFO ada file-nya', () => {
  for (const [emoji, d] of Object.entries(STICKER_INFO)) {
    assert.ok(STICKER_MANIFEST[emoji], `emoji ${emoji} harus ada di STICKER_MANIFEST`);
    assert.ok(typeof d.teks === 'string', `${emoji} harus punya field teks`);
    assert.ok(typeof d.pakai === 'string', `${emoji} harus punya field pakai`);
  }
});

test('prompt: aturan stiker didorong (bukan "jangan berlebihan")', () => {
  assert.ok(SK.includes('PAKAI SAAT MOMENNYA PAS'), 'harus ada dorongan pakai');
  assert.ok(SK.includes('KAPAN PAKAI'), 'harus ada panduan kapan pakai');
  assert.ok(!SK.includes('Rata-rata hanya 1 dari 8-10 balasan'), 'aturan lama yang mengekang harus hilang');
});

test('prompt: TEKS stiker dikirim ke model (hemat token)', () => {
  assert.ok(SK.includes('TEKS DI STIKER'), 'harus ada bagian teks stiker');
  assert.ok(SK.includes('STICKER_INFO'), 'harus pakai STICKER_INFO');
  // Harus memakai emoji yang BERTEKS saja (hemat token), bukan seluruh daftar.
  assert.ok(SK.includes('.filter(([, d]) => d.teks'), 'harus filter yang berteks saja');
});

test('prompt: URUTAN teks -> konsep -> ekspresi ditegaskan', () => {
  assert.ok(SK.includes('URUTAN MEMBACA STIKER'), 'harus ada urutan membaca');
  assert.ok(SK.includes('(1) TEKS/CAPTION'), 'prioritas 1 = teks');
  assert.ok(SK.includes('(2) KONSEP/ISI'), 'prioritas 2 = konsep');
  assert.ok(SK.includes('(3) EKSPRESI'), 'prioritas 3 = ekspresi');
});

test('manifest: urutan berlaku untuk stiker BOT maupun USER', () => {
  // Frasa dua-arah ada di manifest (bukan skills.ts) — sumber aturannya.
  const MAN = fs.readFileSync(new URL('../src/sticker-manifest.ts', import.meta.url), 'utf8');
  assert.ok(MAN.includes('DIKIRIM BOT maupun yang DIKIRIM USER'), 'harus berlaku dua arah');
});
