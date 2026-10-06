/**
 * TEST OTOMATIS — anti-kontaminasi memori (06 Okt 2026).
 *
 * KENAPA: "makin ngaco respon bot nya" + "tercemar oleh memori sepertinya jadi rusak".
 *
 * AKAR: balasan bot yang SALAH ikut tersimpan di riwayat, lalu dikirim kembali
 * ke model sebagai contoh -> bot MENIRU kesalahannya sendiri.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const SK = fs.readFileSync(new URL('../src/skills.ts', import.meta.url), 'utf8');

test('kontaminasi: balasan konfirmasi LAMA dibuang dari riwayat', () => {
  assert.ok(SK.includes('Balas \\*iya\\* untuk simpan'), 'harus saring konfirmasi lama');
});

test('kontaminasi: "Belum ada jadwal rutin" dibuang dari riwayat', () => {
  assert.ok(SK.includes('Belum ada jadwal rutin yang tersimpan'), 'harus saring jawaban salah');
});

test('kontaminasi: gaya norak berlebihan dibuang', () => {
  assert.ok(SK.includes('sokk'), 'harus saring gaya norak');
});

test('kontaminasi: "Halah" pembuka dibuang dari riwayat', () => {
  assert.match(SK, /\^\\s\*halah\\b/, 'harus saring halah pembuka');
});

test('tebakan: keluhan "kenapa suka tebak-tebakan" menghentikan mode', () => {
  assert.ok(SK.includes('suka\\s+banget'), 'harus tangkap keluhan');
});

test('tebakan: minta dongeng menghentikan mode tebakan', () => {
  assert.ok(SK.includes('dongeng(?:in|kan)?'), 'harus tangkap permintaan dongeng');
});

test('tebakan: "stop tebakannya" tertangkap', () => {
  assert.match(SK, /stop\|berhenti\|udahan\|skip\|jangan\|cukup\|gausah\|gausa/, 'harus tangkap stop');
});
