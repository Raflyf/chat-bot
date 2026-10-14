/**
 * TEST: parseNominal TIDAK boleh salah menganggap nomor HP / nomor rekening
 * sebagai nominal uang.
 *
 * TEMUAN AUDIT 14 Okt 2026:
 *   Kandidat angka ">= 1000" dipilih dengan Math.max(), sehingga nomor telepon
 *   yang lebih panjang selalu MENANG atas nominal asli:
 *     "tf 100000 ke 08123456789"            -> 8123456789   (8 MILIAR!)
 *     "bayar kos 500000 no rek 1234567890"  -> 1234567890
 *     "beli pulsa 25000 nomor 628123456789" -> 628123456789
 *   Akibatnya rekap keuangan user hancur total.
 *
 * ATURAN: nomor HP (08xxx / 62xxx) dan nomor rekening TIDAK boleh dipilih
 * sebagai nominal. Nominal besar yang SAH harus tetap terbaca.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNominal } from '../src/notes.js';

test('parseNominal: nomor HP TIDAK dianggap nominal', () => {
  assert.equal(parseNominal('tf 100000 ke 08123456789'), 100000);
  assert.equal(parseNominal('beli pulsa 25000 nomor 628123456789'), 25000);
  assert.equal(parseNominal('kirim ke 081234567890 sebesar 75000'), 75000);
});

test('parseNominal: nomor rekening TIDAK dianggap nominal', () => {
  assert.equal(parseNominal('bayar kos 500000 no rek 1234567890'), 500000);
  assert.equal(parseNominal('transfer ke 1234567890 sebesar 250000'), 250000);
  assert.equal(parseNominal('tf ke rekening 9876543210 dana 100000'), 100000);
});

test('parseNominal: nominal besar yang SAH tetap terbaca', () => {
  assert.equal(parseNominal('gaji saya 2.550.000'), 2550000, 'angka berpemisah ribuan');
  assert.equal(parseNominal('beli laptop 15000000'), 15000000, '15 juta telanjang');
  assert.equal(parseNominal('bayar utang 5000000000'), 5000000000, '5 miliar (10 digit) tanpa konteks nomor');
});

test('parseNominal: format satuan tetap benar', () => {
  assert.equal(parseNominal('60rb'), 60000);
  assert.equal(parseNominal('1,5jt'), 1500000);
  assert.equal(parseNominal('10k'), 10000);
  assert.equal(parseNominal('dua puluh ribu'), 20000);
});

test('parseNominal: tanggal TIDAK menang atas nominal', () => {
  assert.equal(parseNominal('aku gajian tanggal 4 oktober sebesar 2.550.000'), 2550000);
});
