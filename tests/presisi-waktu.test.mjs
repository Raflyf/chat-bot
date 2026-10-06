/**
 * TEST OTOMATIS — presisi waktu pengingat (06 Okt 2026).
 *
 * KENAPA: laporan pemilik produk — "set pengingat 12.48 tapi bot mengingatkan
 * 12.49, ngaret 1 menit".
 *
 * SEBAB: due_at punya detik (12:48:57), sedangkan cron berjalan pada detik :00.
 * Jadi 12:48:00 BELUM melewati due_at -> terkirim 12:49:00.
 *
 * PERBAIKAN: bulatkan ke BAWAH ke awal menit, lalu -5 detik (12:47:55).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWaktuAlami } from '../src/notes.js';

/** Replikasi cara cron memilih waktu kirim: menit pertama >= due_at. */
function waktuKirim(due) {
  const k = new Date(due);
  if (k.getSeconds() > 0) k.setMinutes(k.getMinutes() + 1);
  k.setSeconds(0, 0);
  return k;
}

/**
 * Menit yang DIJANJIKAN bot == menit due_at itu sendiri.
 *
 * CATATAN (perbaikan 06 Okt 2026): dulu ada -5 detik yang membuat due_at
 * mundur ke menit sebelumnya (13:25:55), sehingga tampilan "13.25" berbeda
 * dari pengiriman 13.26. Sekarang due_at tepat di :00 -> tampilan == pengiriman.
 */
function menitDijanjikan(due) {
  return `${due.getHours()}:${String(due.getMinutes()).padStart(2, '0')}`;
}

function menitKirim(due) {
  const k = waktuKirim(due);
  return `${k.getHours()}:${String(k.getMinutes()).padStart(2, '0')}`;
}

test('presisi: "2 menit lagi" pada :57 -> janji == kirim (tidak ngaret)', () => {
  const now = new Date(2026, 9, 6, 12, 46, 57);
  const due = parseWaktuAlami('ingatkan 2 menit lagi makan', now);
  assert.equal(due.getSeconds(), 0, 'detik due harus 0 (tepat di awal menit)');
  assert.equal(menitDijanjikan(due), menitKirim(due), 'menit janji harus sama dengan menit kirim');
});

test('presisi: berbagai detik permintaan tetap tepat', () => {
  for (const detik of [0, 1, 30, 57, 59]) {
    const now = new Date(2026, 9, 6, 12, 46, detik);
    const due = parseWaktuAlami('ingatkan 2 menit lagi tes', now);
    assert.equal(
      menitDijanjikan(due), menitKirim(due),
      `detik ${detik}: janji ${menitDijanjikan(due)} != kirim ${menitKirim(due)}`,
    );
  }
});

test('presisi: melewati tengah malam dengan benar', () => {
  const now = new Date(2026, 9, 6, 23, 58, 30);
  const due = parseWaktuAlami('ingatkan 2 menit lagi tes', now);
  assert.equal(menitDijanjikan(due), menitKirim(due));
});

test('presisi: "5 menit lagi" juga tepat', () => {
  const now = new Date(2026, 9, 6, 14, 20, 33);
  const due = parseWaktuAlami('ingatkan 5 menit lagi minum', now);
  assert.equal(due.getSeconds(), 0);
  assert.equal(menitDijanjikan(due), menitKirim(due));
});

test('presisi: due_at selalu pada detik 0 (tepat awal menit)', () => {
  for (const [m, d] of [[1, 0], [2, 59], [10, 30], [60, 45]]) {
    const now = new Date(2026, 9, 6, 10, 0, d);
    const due = parseWaktuAlami(`ingatkan ${m} menit lagi tes`, now);
    assert.equal(due.getSeconds(), 0, `${m} menit dari detik ${d} harus berakhir detik 0`);
  }
});
