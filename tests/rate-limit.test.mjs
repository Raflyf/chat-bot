/**
 * TEST OTOMATIS — rate limiter.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cekRateLimit } from '../src/rate_limit.js';

test('rate limit: mengizinkan sampai batas, lalu menolak', () => {
  const kunci = `uji-${Date.now()}`;
  for (let i = 0; i < 5; i++) {
    const r = cekRateLimit(kunci, 5, 60_000);
    assert.ok(r.boleh, `permintaan ke-${i + 1} harus boleh`);
  }
  const r6 = cekRateLimit(kunci, 5, 60_000);
  assert.equal(r6.boleh, false, 'permintaan ke-6 harus ditolak');
  assert.ok(r6.resetDalamDetik > 0);
});

test('rate limit: jendela berbeda tidak saling ganggu', () => {
  const a = cekRateLimit(`a-${Date.now()}`, 1, 60_000);
  const b = cekRateLimit(`b-${Date.now()}`, 1, 60_000);
  assert.ok(a.boleh && b.boleh);
});
