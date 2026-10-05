/**
 * TEST OTOMATIS — format angka dashboard (jangan bulatkan angka kecil).
 *
 * KENAPA: bug nyata 06 Okt 2026 — "4K neuron padahal belum sampai 4k".
 * `maximumFractionDigits: 0` membulatkan 3.803 -> "4K" (menyesatkan).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Replikasi formatTokens (fungsi di public/js/dashboard.js)
function formatTokens(num, satuan) {
  const u = satuan || 'Token';
  const n = Number(num);
  if (!n || isNaN(n) || n <= 0) return `0 ${u}`;
  if (n < 100000) return `${n.toLocaleString('id-ID')} ${u}`;
  if (n < 1000000) {
    const val = (n / 1000).toLocaleString('id-ID', { maximumFractionDigits: 1 });
    return `${val}K ${u}`;
  }
  const val = (n / 1000000).toLocaleString('id-ID', { maximumFractionDigits: 1 });
  return `${val}M ${u}`;
}

test('format: 3.803 TIDAK dibulatkan jadi 4K', () => {
  const hasil = formatTokens(3803, 'neuron');
  assert.equal(hasil, '3.803 neuron');
  assert.ok(!hasil.includes('4K'), 'tidak boleh membulatkan ke 4K');
});

test('format: angka kecil tampil utuh', () => {
  assert.equal(formatTokens(2849, 'neuron'), '2.849 neuron');
  assert.equal(formatTokens(1, 'neuron'), '1 neuron');
  assert.equal(formatTokens(999, 'neuron'), '999 neuron');
  assert.equal(formatTokens(99999, 'neuron'), '99.999 neuron');
});

test('format: 100.000+ baru disingkat (1 desimal)', () => {
  assert.equal(formatTokens(100000, 'Token'), '100K Token');
  assert.equal(formatTokens(123456, 'Token'), '123,5K Token');
});

test('format: juta dengan 1 desimal', () => {
  assert.equal(formatTokens(1200000, 'Token'), '1,2M Token');
});

test('format: nol dan negatif', () => {
  assert.equal(formatTokens(0, 'neuron'), '0 neuron');
  assert.equal(formatTokens(-5, 'neuron'), '0 neuron');
  assert.equal(formatTokens(null, 'neuron'), '0 neuron');
});

test('format: satuan default "Token" bila tidak diberi', () => {
  assert.equal(formatTokens(5000), '5.000 Token');
});

test('format: satuan neuron dihormati', () => {
  assert.ok(formatTokens(5000, 'neuron').includes('neuron'));
});
