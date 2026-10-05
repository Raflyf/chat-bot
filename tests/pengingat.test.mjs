/**
 * TEST OTOMATIS — deteksi duplikat pengingat & kemiripan teks.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kemiripanPesan, normalisasiUntukBanding, AMBANG_MIRIP, AMBANG_GABUNG } from '../src/reminder-dedup.js';

test('kemiripanPesan: pengingat SAMA dengan kalimat berbeda -> tinggi', () => {
  const s1 = kemiripanPesan('ada rapat', 'jangan lupa besok jam 9 ada rapat');
  const s2 = kemiripanPesan('ada rapat', 'ingatkan besok jam 9 ada rapat');
  assert.ok(s1 >= AMBANG_GABUNG, `skor 1 = ${s1}`);
  assert.ok(s2 >= AMBANG_GABUNG, `skor 2 = ${s2}`);
});

test('kemiripanPesan: pengingat BERBEDA -> rendah', () => {
  const s1 = kemiripanPesan('antar anak', 'ada rapat');
  const s2 = kemiripanPesan('bayar listrik', 'beli susu');
  assert.ok(s1 < AMBANG_MIRIP, `skor 1 = ${s1}`);
  assert.ok(s2 < AMBANG_MIRIP, `skor 2 = ${s2}`);
});

test('normalisasiUntukBanding: buang kata perintah & filler', () => {
  const hasil = normalisasiUntukBanding('jangan lupa besok jam 9 ada rapat');
  assert.ok(!hasil.includes('jangan'));
  assert.ok(!hasil.includes('lupa'));
  assert.ok(!hasil.includes('besok'));
  assert.ok(hasil.includes('rapat'));
});

test('kemiripanPesan: identik -> 1.0', () => {
  assert.equal(kemiripanPesan('ada rapat', 'ada rapat'), 1);
});

test('kemiripanPesan: kosong tidak crash', () => {
  assert.equal(kemiripanPesan('', ''), 1);
  assert.equal(kemiripanPesan('ada rapat', ''), 0);
});
