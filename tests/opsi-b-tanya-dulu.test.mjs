/**
 * TEST OTOMATIS — OPSI B: tanya dulu sebelum catat keuangan (08 Okt 2026).
 *
 * PERMINTAAN PEMILIK PRODUK: "opsi B saja untuk memastikan tanya dulu oleh AI".
 *
 * ATURAN:
 *  1. Keuangan TANPA kata perintah -> bot TANYA dulu (belum disimpan).
 *  2. User balas "iya" -> baru disimpan.
 *  3. User balas "tidak" -> tidak disimpan.
 *  4. Ada kata "catat" -> langsung disimpan (tidak perlu tanya).
 *  5. Info pendapatan tanpa header -> lolos ke AI (tidak dicatat).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const NOTE = fs.readFileSync(new URL('../src/notes.ts', import.meta.url), 'utf8');

test('Opsi B: jalur "tanya-catat-keuangan" ada', () => {
  assert.ok(NOTE.includes('tanya-catat-keuangan'), 'harus ada jalur tanya');
  assert.ok(NOTE.includes('tanyaKonfirmasiKeuangan'), 'harus ada perangkai pertanyaan');
});

test('Opsi B: pertanyaan dihasilkan AI, BUKAN template statis', () => {
  // Permintaan pemilik produk: "untuk yg tanya dulu itu respon AI atau template?"
  // + aturan lama: "jangan hardcode respon bot yg membuat nya jadi template & statis".
  assert.ok(NOTE.includes('dynamicNotice'), 'harus pakai dynamicNotice (AI)');
  assert.ok(NOTE.includes('Tanyakan dengan bahasa MU SENDIRI'), 'instruksi ke AI');
  assert.ok(!/^\s*return\s+`Aku lihat ada catatan keuangan nih/m.test(NOTE), 'jangan template statis');
});

test('Opsi B: cek perintah eksplisit sebelum tanya', () => {
  assert.ok(NOTE.includes('adaPerintahCatatEksplisit'), 'harus cek perintah eksplisit');
  assert.ok(NOTE.includes('adaPerintahCatatImpl'), 'harus cek di jalur implisit juga');
  assert.match(NOTE, /catat\|catet\|dicatat\|tercatat\|simpan\|masukin\|input\|tulis/, 'daftar perintah');
});

test('Opsi B: hanya KEUANGAN yang ditanya (catatan/tugas tetap langsung)', () => {
  assert.match(NOTE, /niat\.kind === 'expense' && !adaPerintahCatatEksplisit/, 'kondisi expense');
  assert.match(NOTE, /niatImplisit\.kind === 'expense' && !adaPerintahCatatImpl/, 'kondisi expense implisit');
});

test('Opsi B: konfirmasi tertunda dipakai (bukan state baru)', () => {
  assert.match(NOTE, /simpanKonfirmasi\(chatId, niat,/, 'pakai simpanKonfirmasi');
  assert.match(NOTE, /simpanKonfirmasi\(chatId, niatImplisit,/, 'pakai simpanKonfirmasi implisit');
});

test('Opsi B: daftar item dilampirkan (data presisi, bukan dari model)', () => {
  assert.ok(NOTE.includes('daftarItem'), 'harus ada daftar item');
  assert.ok(NOTE.includes('rangkaiDataKeuangan'), 'harus ada perangkai data');
});

test('Opsi B: ctx hanya dipakai bila valid (cegah gangguan koneksi)', () => {
  assert.ok(NOTE.includes('ctxValid'), 'harus cek validitas ctx');
  assert.ok(NOTE.includes("hasil.includes('gangguan koneksi')"), 'harus deteksi fallback gagal');
});
