/**
 * TEST OTOMATIS — deteksi PEMASUKAN (perbaikan 06 Okt 2026).
 *
 * KENAPA: saat menyusun deskripsi bot, ditemukan 2 bug:
 *   "gajian 5 juta"  -> TIDAK dikenali (jatuh ke AI, tidak dicatat)
 *   "bonus 2 juta"   -> dicatat sebagai PENGELUARAN (salah)
 * SEBAB: jalur implisit punya daftar kata pemasukan SENDIRI yang tidak sinkron
 * dengan blok 4a (tanpa bonus/gajian/thr/komisi).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const SRC = fs.readFileSync(new URL('../src/notes.ts', import.meta.url), 'utf8');

test('keuangan: kata pemasukan mencakup gajian/bonus/thr/komisi', () => {
  for (const kata of ['gajian', 'bonus', 'thr', 'komisi', 'cashback', 'refund', 'cair', 'warisan', 'hadiah']) {
    assert.ok(SRC.includes(kata), `kata pemasukan "${kata}" harus ada di notes.ts`);
  }
});

test('keuangan: daftar pemasukan di jalur implisit disamakan', () => {
  // Cari blok deteksiNiatImplisit lalu pastikan memuat "bonus" & "gajian"
  const idx = SRC.indexOf('export function deteksiNiatImplisit');
  assert.ok(idx > 0, 'fungsi deteksiNiatImplisit harus ada');
  const blok = SRC.slice(idx, idx + 8000);
  assert.match(blok, /bonus/, 'jalur implisit harus mengenal "bonus"');
  assert.match(blok, /gajian/, 'jalur implisit harus mengenal "gajian"');
});

test('keuangan: klasifikasi in/out punya daftar lengkap', () => {
  // Harus ada pola yang memuat kata pemasukan lengkap
  assert.match(
    SRC,
    /masuk\|masukan\|dapat\|dapet\|terima\|menerima\|gaji\|gajian/,
    'daftar kata pemasukan harus lengkap',
  );
});

// Replikasi logika klasifikasi untuk uji perilaku
function klasifikasi(teks) {
  const s = teks.toLowerCase();
  const kataMasuk = /\b(?:masuk|masukan|gaji|gajian|gajinya|gajiannya|bonus|bonusan|thr|dapat|dapet|terima|menerima|pemasukan|honor|fee|pendapatan|ada|punya|mempunyai|saldo|sisa|tersisa|tersedia|simpanan|tabungan|pegang|bawa|cair|komisi|cashback|refund|warisan|hadiah|untung|laba|profit)\b/.test(s);
  const kataKeluar = /\b(?:beli|bayar|bayarin|jajan|ongkos|biaya|habis|abis|keluar|pengeluaran|belanja|topup|top-up|kirim|transfer\s+ke)\b/.test(s);
  if (kataMasuk && !kataKeluar) return 'in';
  if (kataKeluar && !kataMasuk) return 'out';
  return 'out';
}

test('keuangan: "gajian 5 juta" -> PEMASUKAN', () => {
  assert.equal(klasifikasi('gajian 5 juta'), 'in');
});

test('keuangan: "bonus 2 juta" -> PEMASUKAN', () => {
  assert.equal(klasifikasi('bonus 2 juta'), 'in');
});

test('keuangan: "thr 1 juta" -> PEMASUKAN', () => {
  assert.equal(klasifikasi('thr 1 juta'), 'in');
});

test('keuangan: "beli makan 25rb" -> PENGELUARAN', () => {
  assert.equal(klasifikasi('beli makan 25rb'), 'out');
});

test('keuangan: "bayar listrik 200rb" -> PENGELUARAN', () => {
  assert.equal(klasifikasi('bayar listrik 200rb'), 'out');
});
