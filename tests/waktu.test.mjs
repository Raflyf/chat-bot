/**
 * TEST OTOMATIS — parsing waktu & nominal.
 * Jalankan: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWaktuAlami, parseNominal, angkaKataKeDigit } from '../src/notes.js';

const JKT = (d) => d.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'short', timeStyle: 'short' });
/** Jam di zona WIB (TIDAK tergantung zona mesin — CI berjalan di UTC). */
const jamWIB = (d) => Number(d.toLocaleString('en-GB', { timeZone: 'Asia/Jakarta', hour: '2-digit', hour12: false }));
const jamWIBStr = (d) => d.toLocaleString('en-GB', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hour12: false });


test('parseNominal: digit & satuan', () => {
  assert.equal(parseNominal('50000'), 50000);
  assert.equal(parseNominal('50.000'), 50000);
  assert.equal(parseNominal('50rb'), 50000);
  assert.equal(parseNominal('50 ribu'), 50000);
  assert.equal(parseNominal('1jt'), 1000000);
  assert.equal(parseNominal('2 juta'), 2000000);
  assert.equal(parseNominal('10k'), 10000);
});

test('parseNominal: ANGKA KATA (penting untuk Voice Note)', () => {
  assert.equal(parseNominal('dua puluh ribu'), 20000);
  assert.equal(parseNominal('lima puluh ribu'), 50000);
  assert.equal(parseNominal('seratus ribu'), 100000);
  assert.equal(parseNominal('dua puluh lima ribu'), 25000);
  assert.equal(parseNominal('satu juta'), 1000000);
});

test('parseNominal: tidak salah baca', () => {
  assert.equal(parseNominal('aku tadi makan enak'), null);
  assert.equal(parseNominal('halo apa kabar'), null);
});

test('angkaKataKeDigit', () => {
  assert.match(angkaKataKeDigit('satu dua tiga'), /1 2 3/);
  assert.match(angkaKataKeDigit('sebelas'), /11/);
  assert.match(angkaKataKeDigit('dua puluh'), /20/);
});

test('parseWaktuAlami: menit/jam lagi (digit)', () => {
  const now = new Date('2026-10-05T10:00:00+07:00');
  const d = parseWaktuAlami('1 menit lagi', now);
  assert.ok(d);
  assert.equal(Math.round((d.getTime() - now.getTime()) / 60000), 1);
});

test('parseWaktuAlami: menit/jam lagi (ANGKA KATA)', () => {
  const now = new Date('2026-10-05T10:00:00+07:00');
  for (const [teks, menit] of [['satu menit lagi', 1], ['dua menit lagi', 2], ['lima menit lagi', 5], ['satu jam lagi', 60]]) {
    const d = parseWaktuAlami(teks, now);
    assert.ok(d, `gagal: ${teks}`);
    assert.equal(Math.round((d.getTime() - now.getTime()) / 60000), menit, `salah: ${teks}`);
  }
});

test('parseWaktuAlami: setengah jam', () => {
  const now = new Date('2026-10-05T10:00:00+07:00');
  const d = parseWaktuAlami('setengah jam lagi', now);
  assert.ok(d);
  assert.equal(Math.round((d.getTime() - now.getTime()) / 60000), 30);
});

test('parseWaktuAlami: jam absolut', () => {
  const now = new Date('2026-10-05T06:00:00+07:00');
  const d = parseWaktuAlami('jam 9', now);
  assert.ok(d);
  assert.equal(jamWIB(d), 9);
});

test('parseWaktuAlami: rentang waktu (jam 9 sampai jam 10)', () => {
  const now = new Date('2026-10-05T06:00:00+07:00');
  const d = parseWaktuAlami('jam 9 sampai jam 10', now);
  assert.ok(d);
  assert.equal(jamWIB(d), 9);
  assert.ok(d.selesai, 'harus punya properti selesai');
  assert.equal(jamWIB(d.selesai), 10);
});

test('parseWaktuAlami: bagian hari tanpa jam', () => {
  const now = new Date('2026-10-05T06:00:00+07:00');
  const d = parseWaktuAlami('nanti malam', now);
  assert.ok(d);
  assert.equal(jamWIB(d), 19);
});

test('parseWaktuAlami: teks tanpa waktu -> null', () => {
  assert.equal(parseWaktuAlami('halo apa kabar'), null);
  assert.equal(parseWaktuAlami('aku suka warna biru'), null);
});
