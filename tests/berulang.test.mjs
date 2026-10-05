/**
 * TEST OTOMATIS — pengingat berulang.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deteksiPengulangan, berikutnya } from '../src/reminder-repeat.js';

test('deteksiPengulangan: tiap hari', () => {
  for (const t of ['ingatkan tiap hari jam 7 minum obat', 'setiap hari jam 6 olahraga', 'harian jam 8']) {
    const h = deteksiPengulangan(t);
    assert.ok(h, `gagal: ${t}`);
    assert.equal(h.kind, 'daily', t);
  }
});

test('deteksiPengulangan: nama hari', () => {
  const h = deteksiPengulangan('ingatkan tiap Senin jam 9 rapat');
  assert.ok(h);
  assert.equal(h.kind, 'weekly');
  assert.equal(h.value, '1'); // Senin = 1
});

test('deteksiPengulangan: hari kerja', () => {
  const h = deteksiPengulangan('ingatkan tiap hari kerja jam 8');
  assert.ok(h);
  assert.equal(h.kind, 'weekday');
});

test('deteksiPengulangan: tanggal', () => {
  const h = deteksiPengulangan('ingatkan tiap tanggal 1 bayar listrik');
  assert.ok(h);
  assert.equal(h.kind, 'monthly');
  assert.equal(h.value, '1');
});

test('deteksiPengulangan: bukan berulang -> null', () => {
  assert.equal(deteksiPengulangan('ingatkan besok jam 9 rapat'), null);
  assert.equal(deteksiPengulangan('halo apa kabar'), null);
});

test('berikutnya: daily -> +1 hari, jam sama', () => {
  const dasar = new Date('2026-10-05T07:00:00+07:00');
  const next = berikutnya(dasar, { repeat_kind: 'daily', repeat_value: null, repeat_until: null, repeat_count: 0 });
  assert.ok(next);
  assert.equal(next.getTime() - dasar.getTime(), 24 * 3600 * 1000);
});

test('berikutnya: weekly Senin -> 7 hari lagi', () => {
  const senin = new Date('2026-10-05T09:00:00+07:00'); // 5 Okt 2026 = Senin
  const next = berikutnya(senin, { repeat_kind: 'weekly', repeat_value: '1', repeat_until: null, repeat_count: 0 });
  assert.ok(next);
  assert.equal(Math.round((next.getTime() - senin.getTime()) / 86400000), 7);
});

test('berikutnya: lewat batas akhir -> null', () => {
  const dasar = new Date('2026-10-05T07:00:00+07:00');
  const next = berikutnya(dasar, {
    repeat_kind: 'daily', repeat_value: null,
    repeat_until: '2026-10-01T00:00:00Z', repeat_count: 0,
  });
  assert.equal(next, null);
});

test('berikutnya: none -> null', () => {
  assert.equal(berikutnya(new Date(), { repeat_kind: 'none', repeat_value: null, repeat_until: null, repeat_count: 0 }), null);
});
