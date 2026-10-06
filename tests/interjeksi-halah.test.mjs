/**
 * TEST OTOMATIS — interjeksi "halah" berlebihan (06 Okt 2026).
 *
 * KENAPA: "knapa pake halah awalannya? terlalu banyak menggunakan kata halah
 * di respon yg tidak perlu halah juga".
 *
 * Bot memakai "Halah, ..." sebagai pembuka di banyak balasan — termasuk saat
 * user sakit ("Halah, udah ya jangan sakit-sakit lagi dong bub") yang tidak peka.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const SK = fs.readFileSync(new URL('../src/skills.ts', import.meta.url), 'utf8');

test('halah: ada di daftar interjeksi', () => {
  assert.ok(SK.includes("'halah'"), '"halah" harus ada di daftar');
  assert.ok(SK.includes("'hala'"), '"hala" harus ada');
  assert.ok(SK.includes("'yaelah'"), '"yaelah" harus ada');
  assert.ok(SK.includes("'alah'"), '"alah" harus ada');
});

test('halah: ada set INTERJEKSI_BERLEBIHAN', () => {
  assert.match(SK, /INTERJEKSI_BERLEBIHAN/, 'harus ada set khusus');
});

test('halah: ada fungsi cooldown batasiInterjeksiBerlebihan', () => {
  assert.match(SK, /function batasiInterjeksiBerlebihan/, 'harus ada fungsi');
  assert.match(SK, /batasiInterjeksiBerlebihan\(reply/, 'harus dipanggil di alur utama');
});

test('halah: prompt melarang pakai di setiap balasan', () => {
  assert.ok(SK.includes('JANGAN menjadikan "halah"'), 'harus ada larangan');
  assert.ok(SK.includes('DILARANG memakainya saat dia sedang sedih, sakit, kesal'), 'harus larang saat sedih/sakit');
});

test('halah: prompt minta variasikan pembuka', () => {
  assert.ok(SK.includes('Balasan tanpa pembuka justru terasa lebih dewasa'), 'harus dorong variasi');
});
