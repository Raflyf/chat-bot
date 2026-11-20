/**
 * TEST OTOMATIS — pengingat berulang.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deteksiPengulangan, berikutnya, labelUlang } from '../src/reminder-repeat.js';

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

test('deteksiPengulangan: interval sub-harian ("setiap 29 menit", "tiap 2 jam", "setiap jam")', () => {
  const m29 = deteksiPengulangan('ingatkan rutin setiap 29 menit ON');
  assert.deepEqual(m29, { kind: 'interval_minutes', value: '29', label: 'tiap 29 menit' });

  const j2 = deteksiPengulangan('ingatkan setiap 2 jam minum air');
  assert.deepEqual(j2, { kind: 'interval_minutes', value: '120', label: 'tiap 2 jam' });

  const j1 = deteksiPengulangan('ingatkan setiap jam peregangan');
  assert.deepEqual(j1, { kind: 'interval_minutes', value: '60', label: 'tiap 1 jam' });

  // JANGAN sampai salah mengira "tiap jam 6 pagi" sebagai interval per jam.
  assert.equal(deteksiPengulangan('buatkan jadwal rutin tiap jam 6 pagi harus bangun'), null);
});

test('berikutnya & labelUlang: interval_minutes', () => {
  const dasar = new Date('2026-11-20T05:02:00.000Z');
  const next = berikutnya(dasar, { repeat_kind: 'interval_minutes', repeat_value: '29', repeat_until: null, repeat_count: 0 });
  assert.ok(next);
  assert.equal(next.getTime() - dasar.getTime(), 29 * 60_000);

  assert.equal(
    labelUlang({ repeat_kind: 'interval_minutes', repeat_value: '29', repeat_until: null, repeat_count: 0 }),
    'tiap 29 menit',
  );
  assert.equal(
    labelUlang({ repeat_kind: 'interval_minutes', repeat_value: '120', repeat_until: null, repeat_count: 0 }),
    'tiap 2 jam',
  );
});
