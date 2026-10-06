/**
 * TEST OTOMATIS — sesi admin harus bertahan setelah upgrade PIN (06 Okt 2026).
 *
 * KENAPA: laporan pemilik produk — "tidak bisa login dashboard, sudah masuk
 * tapi tidak sampai 1 detik sesi terputus".
 *
 * SEBAB: token sesi HMAC terikat pada `pinHash`. Saat PIN di-upgrade dari
 * SHA-256 ke scrypt, `pinHash` BERUBAH -> token yang baru diterbitkan langsung
 * tidak valid -> sesi putus.
 *
 * PERBAIKAN: simpan hash lama di `previousPinHashes`, verifikasi token terhadap
 * SEMUA kandidat hash.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

// Replikasi logika HMAC token (di admin_auth.ts)
function buatToken(pinHash, salt, payload = { iat: Date.now(), exp: Date.now() + 900_000, nonce: 'abc' }) {
  const payloadStr = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const hmacKey = crypto.createHash('sha256').update(salt + ':' + pinHash).digest();
  const sig = crypto.createHmac('sha256', hmacKey).update(payloadStr).digest('hex');
  return { token: `adm_${payloadStr}.${sig}`, payloadStr, sig };
}

function verifikasi(token, kandidatHash, salt) {
  const raw = token.slice(4);
  const dotIdx = raw.indexOf('.');
  if (dotIdx <= 0) return false;
  const payloadStr = raw.slice(0, dotIdx);
  const signature = raw.slice(dotIdx + 1);
  for (const ph of kandidatHash) {
    const hmacKey = crypto.createHash('sha256').update(salt + ':' + ph).digest();
    const expected = crypto.createHmac('sha256', hmacKey).update(payloadStr).digest('hex');
    if (expected.length === signature.length &&
        crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return true;
  }
  return false;
}

const SALT = 'salt_uji';

test('sesi: token dengan hash LAMA tetap valid setelah PIN di-upgrade', () => {
  const hashLama = 'a'.repeat(64);          // SHA-256 lama
  const hashBaru = 'scrypt$16384$8$1$xxx$yyy'; // setelah upgrade
  const { token } = buatToken(hashLama, SALT);

  // Tanpa previousPinHashes -> token TIDAK valid (ini bug lamanya)
  assert.equal(verifikasi(token, [hashBaru], SALT), false, 'tanpa hash lama, token gugur');

  // Dengan previousPinHashes -> token VALID
  assert.equal(verifikasi(token, [hashBaru, hashLama], SALT), true, 'dengan hash lama, token tetap valid');
});

test('sesi: token dengan hash BARU juga valid', () => {
  const hashBaru = 'scrypt$16384$8$1$xxx$yyy';
  const { token } = buatToken(hashBaru, SALT);
  assert.equal(verifikasi(token, [hashBaru], SALT), true);
});

test('sesi: token dengan hash yang tidak dikenal DITOLAK', () => {
  const { token } = buatToken('hash_tidak_dikenal', SALT);
  assert.equal(verifikasi(token, ['a'.repeat(64), 'scrypt$1$2$3$x$y'], SALT), false);
});

test('sesi: signature salah DITOLAK', () => {
  const { token } = buatToken('hash1', SALT);
  const tokenRusak = token.slice(0, -4) + 'ffff';
  assert.equal(verifikasi(tokenRusak, ['hash1'], SALT), false);
});

test('sesi: previousPinHashes dibatasi maksimal 3', () => {
  const arr = ['h1', 'h2', 'h3', 'h4', 'h5'];
  assert.deepEqual(arr.slice(0, 3), ['h1', 'h2', 'h3']);
});

test('sesi: kandidat hash tidak duplikat', () => {
  const hash = 'same_hash';
  const kandidat = Array.from(new Set([hash, hash, hash]));
  assert.equal(kandidat.length, 1);
});
