/**
 * TEST OTOMATIS — pemasukan hanya dicatat bila DIMINTA (08 Okt 2026).
 *
 * LAPORAN PEMILIK PRODUK:
 *  - "jangan sampai user hanya sedang memberikan informasi pendapatan nya saja
 *     malah di masukan ke dalam pemasukan, kan itu malah merusak nanti nya"
 *  - "saat user hanya memberitahu pendapatan sedangkan bot mencatat, lalu saat
 *     user mau menyuruh mencatat pendapatan itu nanti malah jadi double"
 *
 * ATURAN:
 *  A. INFORMASI pendapatan (tanpa minta catat) -> JANGAN dicatat
 *  B. PERMINTAAN catat pemasukan -> HARUS dicatat
 *  C. PENGELUARAN -> tetap otomatis (perilaku lama)
 *  D. Dedup data keuangan (cegah double)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { deteksiNiat, deteksiNiatImplisit } from '../src/notes.js';

const NOTE = fs.readFileSync(new URL('../src/notes.ts', import.meta.url), 'utf8');

// ── A. INFORMASI pendapatan: jangan dicatat ──
const INFORMASI = [
  'gaji saya 5 juta',
  'pendapatan aku bulan ini 3 juta',
  'aku gajian 2.550.000',
  'tunjangan makan 550.000',
  'profit jualan 1.000.000',
  'bonus 2 juta',
  'dapat gaji 5 juta',
  'kemarin aku dapat 250rb',
  'aku baru gajian dapet 5 juta, lumayan',
];

test('pemasukan: INFORMASI pendapatan TIDAK dicatat', () => {
  for (const t of INFORMASI) {
    const n = deteksiNiat(t) || deteksiNiatImplisit(t);
    assert.equal(n, null, `"${t}" TIDAK boleh dicatat (dapat ${n?.kind})`);
  }
});

// ── B. PERMINTAAN catat pemasukan: harus dicatat ──
const PERMINTAAN = [
  'catat gajian 5 juta',
  'catat pemasukan 5 juta',
  'tolong catat pendapatan 3 juta',
  'simpan gaji 2.550.000',
  'catat bonus 2 juta',
];

test('pemasukan: PERMINTAAN catat HARUS tercatat', () => {
  for (const t of PERMINTAAN) {
    const n = deteksiNiat(t) || deteksiNiatImplisit(t);
    assert.ok(n, `"${t}" HARUS tercatat`);
    assert.equal(n?.kind, 'expense');
  }
});

// ── C. Pengeluaran tetap otomatis ──
test('pengeluaran: tetap dicatat otomatis', () => {
  for (const t of ['beli kopi 15rb', 'bayar listrik 200rb', 'aku beli kuota 47 rb']) {
    const n = deteksiNiat(t) || deteksiNiatImplisit(t);
    assert.ok(n, `"${t}" HARUS tercatat`);
  }
});

// ── D. Dedup level data ──
test('dedup: simpanUang menolak duplikat 10 menit', () => {
  assert.ok(NOTE.includes('DEDUP DATA KEUANGAN'), 'harus ada dedup data');
  assert.ok(NOTE.includes('JENDELA_DEDUP_MS'), 'harus ada jendela dedup');
  assert.match(NOTE, /\.eq\('amount', amount\)/, 'harus bandingkan amount');
  assert.match(NOTE, /\.eq\('kind', kind\)/, 'harus bandingkan kind');
  // AUDIT 14 Okt 2026: dedup memakai `catatanDedup` (note yang sudah di-trim)
  // dan HANYA dijalankan bila catatan tidak kosong — agar dua transaksi berbeda
  // bernominal sama tanpa catatan tidak saling menelan.
  assert.match(NOTE, /\.eq\('note', catatanDedup\)/, 'harus bandingkan catatan');
  assert.ok(NOTE.includes('catatanDedup.length >= 3'), 'dedup hanya bila catatan ada isinya');
});

test('simpanUang: menolak nominal tidak masuk akal (audit 14 Okt 2026)', () => {
  // Nominal negatif / nol / NaN / terlalu besar harus DITOLAK sebelum insert,
  // karena bisa merusak rekap (total berkurang, selisih salah).
  assert.ok(NOTE.includes('TOLAK simpan keuangan: nominal tidak valid'), 'harus ada guard nominal');
  assert.match(NOTE, /amount\s*<=\s*0/, 'harus menolak <= 0');
  assert.ok(NOTE.includes('Number.isFinite(amount)'), 'harus menolak NaN/Infinity');
});

test('rekapUang: memakai paginasi eksplisit (audit 14 Okt 2026)', () => {
  // Tanpa `range`, PostgREST memotong di 1000 baris -> rekap diam-diam kurang.
  assert.ok(NOTE.includes('.range(offset, offset + BATCH - 1)'), 'harus pakai range()');
  assert.ok(NOTE.includes('const BATCH = 1000'), 'harus ada ukuran batch');
});

test('guard pemasukan ada di KEDUA jalur (deteksiNiat + implisit)', () => {
  const jumlah = (NOTE.match(/hanyaPemasukan/g) || []).length;
  assert.ok(jumlah >= 2, `guard harus ada di >=2 jalur (dapat ${jumlah})`);
  assert.ok(NOTE.includes('adaPermintaanCatatEksplisit'), 'harus cek permintaan eksplisit');
});
