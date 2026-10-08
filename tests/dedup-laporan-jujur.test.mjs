/**
 * TEST OTOMATIS — laporan JUJUR saat data duplikat (08 Okt 2026).
 *
 * PERTANYAAN PEMILIK PRODUK: "apakah percakapan seperti ini emang ditangani oleh
 * fitur langsung dimasukan ke catatan? bukannya itu hanya percakapan biasa tanya
 * jawab dan informasi user?"
 *
 * DESAIN YANG DISEPAKATI:
 *  - Header JENIS eksplisit ("Pengeluaran:", "Pendapatan") + daftar nominal
 *    = user MENDAFTARKAN -> CATAT (bukan sekadar info).
 *  - Info pendapatan TANPA header/permintaan ("gaji saya 5 juta") -> JANGAN catat.
 *  - Data yang sudah ada -> JANGAN dobel, dan bot harus LAPOR JUJUR.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { deteksiNiat, deteksiNiatImplisit } from '../src/notes.js';

const NOTE = fs.readFileSync(new URL('../src/notes.ts', import.meta.url), 'utf8');

test('header jenis + daftar -> tercatat', () => {
  for (const t of [
    'Pengeluaran:\nKosan 500.000\nTf orangtua 600.000',
    'Pendapatan\nGaji 2.550.000\nTunjangan makan 550.000',
  ]) {
    const n = deteksiNiat(t) || deteksiNiatImplisit(t);
    assert.ok(n, `"${t.split('\n')[0]}" harus tercatat`);
  }
});

test('info pendapatan tanpa header -> TIDAK tercatat', () => {
  for (const t of ['gaji saya 5 juta', 'bonus 2 juta', 'pendapatan aku 3 juta', 'aku gajian 2.550.000']) {
    const n = deteksiNiat(t) || deteksiNiatImplisit(t);
    assert.equal(n, null, `"${t}" jangan tercatat`);
  }
});

test('tanpa header & tanpa kata kerja -> TIDAK tercatat', () => {
  assert.equal(deteksiNiat('Kosan 500.000') || deteksiNiatImplisit('Kosan 500.000'), null);
});

test('laporan JUJUR saat duplikat (tidak bilang "Tercatat")', () => {
  assert.ok(NOTE.includes('sudah pernah kecatat sebelumnya'), 'harus ada pesan jujur');
  assert.ok(NOTE.includes('jmlBaru === 0'), 'harus deteksi 0 item baru');
  assert.ok(NOTE.includes('biar tidak dobel'), 'harus jelaskan alasan');
});
