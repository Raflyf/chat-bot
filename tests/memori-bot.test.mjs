/**
 * TEST OTOMATIS — memori bot diperbesar (permintaan pemilik produk 06 Okt 2026):
 *   "tambahkan memory bot nya agar mengingat lebih banyak chat dan lebih pintar
 *    tidak ngaco jawabannya"
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const MEM = fs.readFileSync(new URL('../src/memory.ts', import.meta.url), 'utf8');
const SK = fs.readFileSync(new URL('../src/skills.ts', import.meta.url), 'utf8');

test('memori: riwayat dari DB diperbesar (40 pesan)', () => {
  assert.match(MEM, /limit\(40\)/, 'getContext harus ambil 40 pesan');
});

test('memori: fakta/koreksi diperbesar (15)', () => {
  assert.match(MEM, /limit\(15\)/, 'corrections harus ambil 15');
});

test('memori: riwayat di prompt diperbesar (30)', () => {
  assert.match(SK, /history\.slice\(-30\)/, 'prompt harus pakai 30 pesan');
});

test('memori: ringkasan otomatis tiap 6 pesan', () => {
  assert.match(MEM, /n % 6 !== 0/, 'ringkasan tiap 6 pesan');
});

test('memori: sumber ringkasan 60 pesan', () => {
  assert.match(MEM, /limit\(60\)/, 'ringkasan dari 60 pesan');
});

test('memori: ringkasan menangkap fakta personal', () => {
  assert.ok(MEM.includes('Kesukaan & hal yang TIDAK dia sukai'), 'harus tangkap kesukaan');
  assert.ok(MEM.includes('Pekerjaan/status/kegiatan'), 'harus tangkap pekerjaan');
  assert.ok(MEM.includes('Kebiasaan & rutinitas'), 'harus tangkap kebiasaan');
  assert.ok(MEM.includes('DILARANG menebak'), 'harus larang menebak');
});

test('memori: prompt pakai memori secara AKTIF', () => {
  assert.ok(SK.includes('MEMORI LATAR BELAKANG (REFERENSI AKTIF'), 'harus jadi aktif');
  assert.ok(SK.includes('JANGAN menanyakan hal yang SUDAH ADA di memori'), 'harus larang tanya ulang');
  assert.ok(SK.includes('DILARANG menyebut "memori"'), 'harus larang sebut memori');
});
