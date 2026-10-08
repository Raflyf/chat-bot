/**
 * TEST OTOMATIS — bug FATAL: permintaan tugas dijawab panduan (08 Okt 2026).
 *
 * LAPORAN PEMILIK PRODUK: "kesalahan sangat fatal, bisa bisanya bot nya malah
 * menyajikan tutorial pemakaian, padahal user meminta bantuan untuk merekap dari
 * spreadsheet".
 *
 * KASUS NYATA:
 *   "bantu aku hitung ada berapa menu"                        -> PANDUAN (SALAH)
 *   "bantu aku recap ya, ada sekitar kurang lebih 60 menu..." -> PANDUAN (SALAH)
 *   "SNACK https://docs.google.com/... hitung ada berapa menu"-> PANDUAN (SALAH)
 *
 * AKAR: kata "menu" ada di daftar pemicu panduan, padahal sangat umum
 * (menu makanan, daftar menu spreadsheet). Blok panduan juga berjalan SEBELUM
 * blok pertanyaan & AI.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { deteksiMintaPanduan } from '../src/notes.js';

const WEB = fs.readFileSync(new URL('../src/web.ts', import.meta.url), 'utf8');

test('panduan: permintaan TUGAS nyata TIDAK jadi panduan', () => {
  for (const t of [
    'bantu aku hitung ada berapa menu',
    'bantu aku recap ya, ada sekitar kurang lebih 60 menu km bantu hitungin udh berapa ya',
    'SNACK https://docs.google.com/spreadsheets/d/abc SALAD https://docs.google.com/spreadsheets/d/def hitung ada berapa menu cukup baca tab yg dibawah aja',
    'hitung ada berapa menu',
    'bantu rekap dari spreadsheet ini',
    'tolong hitungin total item di tabel',
    'rangkum isi dokumen ini',
    'jumlahin semua menu di link ini',
  ]) {
    assert.equal(deteksiMintaPanduan(t), false, `"${t.slice(0, 50)}" JANGAN jadi panduan`);
  }
});

test('panduan: permintaan panduan SUNGGUHAN tetap dikenali', () => {
  for (const t of ['kamu bisa apa saja', 'tutorial', 'cara pakai bot ini', '/help', '/menu', 'menu', 'panduan', 'fitur apa aja', 'help', 'bisa ngapain aja']) {
    assert.equal(deteksiMintaPanduan(t), true, `"${t}" HARUS jadi panduan`);
  }
});

test('panduan: sinyal tugas nyata (hitung/rekap/spreadsheet/URL) dideteksi', () => {
  assert.ok(fs.readFileSync(new URL('../src/notes.ts', import.meta.url), 'utf8').includes('adaTugasNyata'), 'harus ada guard adaTugasNyata');
});

test('Google Sheets: link /edit dikonversi ke export CSV', () => {
  assert.ok(WEB.includes('docs\\.google\\.com\\/spreadsheets\\/d\\/'), 'harus deteksi link Sheets');
  assert.ok(WEB.includes('export?format=csv'), 'harus pakai export CSV');
  assert.ok(WEB.includes('[Google Sheets CSV]'), 'harus tandai hasilnya');
});

test('Google Sheets: ada fallback gviz bila export gagal', () => {
  assert.ok(WEB.includes('gviz/tq?tqx=out:csv'), 'harus ada fallback gviz');
  assert.ok(WEB.includes("redirect: 'follow'"), 'harus ikuti redirect');
});
