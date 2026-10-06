/**
 * TEST OTOMATIS — parseWaktuAlami harus memakai ZONA USER, bukan zona server.
 *
 * KENAPA: bug nyata 06 Okt 2026 — "buatkan jadwal rutin tiap jam 6 pagi"
 * tersimpan 13:00 (06:00 UTC), bukan 06:00 WIB. Terjadi karena setHours()
 * memakai zona SERVER (Vercel = UTC). Di lokal (WIB) kebetulan benar sehingga
 * bug tidak terlihat saat diuji lokal.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWaktuAlami } from '../src/notes.js';

// Simulasi: sekarang 6 Okt 2026, 13:02 WIB (= 06:02 UTC)
const SEKARANG = new Date('2026-10-06T06:02:00Z');
const WIB = 'Asia/Jakarta';
const WITA = 'Asia/Makassar';

/** Jam:menit di zona tertentu. */
function jamDi(d, zona) {
  return d.toLocaleString('id-ID', { timeZone: zona, hour: '2-digit', minute: '2-digit', hour12: false })
    .replace('.', ':');
}

test('zona: "jam 6 pagi" -> 06:00 WIB (bukan 13:00)', () => {
  const d = parseWaktuAlami('ingatkan tiap hari jam 6 pagi bangun', SEKARANG, WIB);
  assert.ok(d, 'harus menghasilkan waktu');
  assert.equal(jamDi(d, WIB), '06:00');
});

test('zona: "buatkan jadwal rutin tiap jam 6 pagi" -> 06:00 WIB', () => {
  const d = parseWaktuAlami('buatkan jadwal rutin tiap jam 6 pagi untuk bangun', SEKARANG, WIB);
  assert.ok(d);
  assert.equal(jamDi(d, WIB), '06:00');
});

test('zona: "besok jam 9" -> 09:00 WIB', () => {
  const d = parseWaktuAlami('ingatkan besok jam 9 rapat', SEKARANG, WIB);
  assert.ok(d);
  assert.equal(jamDi(d, WIB), '09:00');
});

test('zona: "tiap Senin jam 9" -> 09:00 WIB', () => {
  const d = parseWaktuAlami('ingatkan tiap Senin jam 9 rapat', SEKARANG, WIB);
  assert.ok(d);
  assert.equal(jamDi(d, WIB), '09:00');
});

test('zona: "jam 8 malam" -> 20:00 WIB', () => {
  const d = parseWaktuAlami('ingatkan jam 8 malam', SEKARANG, WIB);
  assert.ok(d);
  assert.equal(jamDi(d, WIB), '20:00');
});

test('zona: "jam 5 subuh" -> 05:00 WIB', () => {
  const d = parseWaktuAlami('ingatkan tiap hari jam 5 subuh olahraga', SEKARANG, WIB);
  assert.ok(d);
  assert.equal(jamDi(d, WIB), '05:00');
});

test('zona: WITA berbeda dari WIB (jam lokal sama)', () => {
  const dWib = parseWaktuAlami('ingatkan tiap hari jam 6 pagi bangun', SEKARANG, WIB);
  const dWita = parseWaktuAlami('ingatkan tiap hari jam 6 pagi bangun', SEKARANG, WITA);
  assert.ok(dWib && dWita);
  // Keduanya menunjukkan 06:00 DI ZONA MASING-MASING (waktu absolutnya beda 1 jam)
  assert.equal(jamDi(dWib, WIB), '06:00');
  assert.equal(jamDi(dWita, WITA), '06:00');
  assert.equal(Math.abs(dWita.getTime() - dWib.getTime()), 3600_000, 'selisih WIB-WITA = 1 jam');
});

test('zona: tanpa zona (fallback) tetap menghasilkan waktu wajar', () => {
  const d = parseWaktuAlami('ingatkan besok jam 9 rapat', SEKARANG);
  assert.ok(d, 'harus tetap menghasilkan waktu');
});

test('zona: "tiap tanggal 1" -> jam 08:00 WIB', () => {
  const d = parseWaktuAlami('ingatkan tiap tanggal 1 bayar listrik', SEKARANG, WIB);
  assert.ok(d);
  assert.equal(jamDi(d, WIB), '08:00');
});

test('zona: "nanti malam" -> 19:00 WIB', () => {
  const d = parseWaktuAlami('ingatkan nanti malam', SEKARANG, WIB);
  assert.ok(d);
  assert.equal(jamDi(d, WIB), '19:00');
});

test('zona: hasil SELALU di masa depan', () => {
  for (const t of ['ingatkan jam 6 pagi bangun', 'ingatkan jam 8 malam', 'ingatkan besok jam 9']) {
    const d = parseWaktuAlami(t, SEKARANG, WIB);
    assert.ok(d && d.getTime() > SEKARANG.getTime(), `"${t}" harus di masa depan`);
  }
});
