/**
 * TEST OTOMATIS — audit dataset 07 Okt 2026 (lanjutan).
 *
 * TEMUAN DARI DATABASE:
 *  1. "Salah, tuh kamu ga inget aku suka buah apa" -> salah jadi fakta "Suka buah apa"
 *  2. "Nama kamu Dhea, sesuai petunjuk hurufnya" -> tidak tersimpan
 *  3. Pengingat vitamin: bot tanya jam, user jawab jam -> tidak diproses
 *  4. Kontaminasi "putri manis" diulang-ulang dari riwayat
 *  5. Balasan kosong (via '-')
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { deteksiFaktaPersonal } from '../src/user_facts.js';

const SK = fs.readFileSync(new URL('../src/skills.ts', import.meta.url), 'utf8');
const NOTE = fs.readFileSync(new URL('../src/notes.ts', import.meta.url), 'utf8');

test('fakta: pertanyaan "suka buah apa" TIDAK jadi fakta', () => {
  assert.equal(deteksiFaktaPersonal('Salah, tuh kamu ga inget aku suka buah apa'), null, 'harus null');
  assert.equal(deteksiFaktaPersonal('kamu inget aku suka apa?'), null, 'harus null');
});

test('fakta: kesukaan SUNGGUHAN tetap tersimpan', () => {
  assert.equal(deteksiFaktaPersonal('aku suka kopi pahit')?.kategori, 'kesukaan');
});

test('fakta: "Nama kamu X" dikenali', () => {
  assert.equal(deteksiFaktaPersonal('Nama kamu Dhea, sesuai petunjuk hurufnya')?.fakta, 'Namanya Dhea');
});

test('pengingat: alur tanya-jam ada', () => {
  assert.ok(NOTE.includes('tanya-jam-pengingat'), 'harus ada jalur tanya jam');
  assert.ok(NOTE.includes('lanjut-pengingat-jam'), 'harus ada jalur lanjut jam');
  assert.ok(NOTE.includes("jenis?: 'zona' | 'jam'"), 'harus ada jenis penantian');
});

test('kontaminasi: "putri manis" disaring dari riwayat', () => {
  assert.ok(SK.includes('/putri manis/i.test(content)'), 'harus saring putri manis');
  assert.ok(SK.includes('satu-satunya\\s+AI'), 'harus saring klaim AI');
});
