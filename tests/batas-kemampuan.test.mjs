/**
 * TEST OTOMATIS — BATAS KEMAMPUAN (anti-halusinasi kemampuan). 09 Okt 2026.
 *
 * LAPORAN PEMILIK PRODUK: user mengirim ".play wali", ".play Mahalini - Sial",
 * "putar" — dan bot MENJAWAB SEOLAH SEDANG MEMUTAR MUSIK:
 *   "Oke, aku putar wali nih! 🎶"
 *   "Sialnya betul nih, tapi lagunya keren! 🎶"
 *   "Okee, lagi diputer Mahalini Sial nih."
 *
 * Padahal bot TIDAK BISA memutar musik / mengirim audio / mengontrol pemutar.
 * Ini HALUSINASI KEMAMPUAN: model mengarang karena prompt hanya menyebut yang
 * BISA dilakukan, tanpa menyebut BATASNYA.
 *
 * PERBAIKAN: tambah blok "BATAS KEMAMPUAN" ke system prompt + dikunci test ini.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const SKILLS = fs.readFileSync(new URL('../src/skills.ts', import.meta.url), 'utf8');

test('batas: prompt punya blok BATAS KEMAMPUAN', () => {
  assert.ok(SKILLS.includes('BATAS KEMAMPUAN'), 'harus ada blok batas kemampuan');
});

test('batas: melarang mengaku bisa memutar musik', () => {
  assert.ok(/TIDAK BISA[^']*memutar|Memutar\/mengirim musik/i.test(SKILLS),
    'harus melarang klaim bisa memutar musik');
  // Perintah .play disebut eksplisit sebagai contoh.
  assert.ok(SKILLS.includes('.play'), 'perintah .play harus disebut sebagai contoh');
});

test('batas: melarang klaim kemampuan lain yang tidak ada', () => {
  for (const kemampuan of ['Mengirim file', 'Menelepon', 'Mengakses kamera']) {
    assert.ok(SKILLS.includes(kemampuan), `harus menyebut larangan: ${kemampuan}`);
  }
});

test('batas: menginstruksikan AKUI JUJUR + tawarkan yang bisa', () => {
  assert.ok(/AKUI JUJUR dengan santai/.test(SKILLS), 'harus mengaku jujur');
  assert.ok(/TAWARKAN yang benar-benar bisa/.test(SKILLS), 'harus menawarkan yang bisa');
});

test('batas: melarang berpura-pura memutar', () => {
  assert.ok(/DILARANG berpura-pura memutar/.test(SKILLS), 'harus melarang pura-pura memutar');
  assert.ok(/DILARANG bilang "lagi diputar"/.test(SKILLS), 'harus melarang "lagi diputar"');
});
