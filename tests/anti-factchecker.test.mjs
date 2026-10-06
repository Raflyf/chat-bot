/**
 * TEST OTOMATIS — bot bukan mesin fact-checker (06 Okt 2026).
 *
 * KENAPA: user bertanya personal "Katanya tadi suka aku?" -> bot menjawab
 * "Aku belum nemu dasar yang jelas soal itu di data yang aku pegang.
 *  Kalau kamu punya sumbernya, boleh share — biar aku bantu cek bareng."
 * -> dingin, tidak manusiawi, seperti mesin.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const SK = fs.readFileSync(new URL('../src/skills.ts', import.meta.url), 'utf8');

test('fact-checker: teks hardcoded dihapus dari KODE', () => {
  // Hanya boleh ada di komentar (//), bukan di return statement.
  const barisAktif = SK.split('\n').filter((l) => {
    const t = l.trim();
    return t.includes('Aku belum nemu dasar yang jelas') && !t.startsWith('//') && !t.startsWith('*');
  });
  assert.equal(barisAktif.length, 0, 'teks hardcoded tidak boleh di kode aktif');
});

test('fact-checker: guard konteksPersonal ada', () => {
  assert.match(SK, /konteksPersonal/, 'harus ada guard personal');
  assert.ok(SK.includes('suka|cinta|sayang|rindu|kangen'), 'harus kenali kata personal');
});

test('fact-checker: return kosong untuk regenerasi (bukan teks statis)', () => {
  assert.match(SK, /if \(!sisa \|\| sisa\.length < 15\) return '';/, 'harus return kosong');
});

test('fact-checker: klaim faktual tetap dijaga', () => {
  assert.ok(SK.includes('userMenyodorkanKlaim'), 'penegak klaim faktual tetap ada');
});
