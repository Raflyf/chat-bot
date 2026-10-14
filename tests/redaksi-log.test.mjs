/**
 * TEST: Redaksi kredensial di log — anti-regresi.
 *
 * TEMUAN AUDIT 14 Okt 2026:
 *   Gemini menaruh API key di QUERY STRING. `console.warn` di providers.ts
 *   mencetak URL upstream UTUH saat error non-429 -> API key bocor ke log
 *   Vercel. Selain itu ada log yang mencetak `key.slice(0, 10)`.
 *
 * ATURAN: setiap URL / pesan error dari upstream WAJIB lewat redactUrl()
 * sebelum dicetak. Test ini mengunci aturan itu.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { redactUrl, redactSecret } from '../src/logger.js';

const baca = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');

test('redactUrl: key di query string dibuang', () => {
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini:streamGenerateContent?alt=sse&key=AIzaSyFAKE1234567890abcdef';
  const hasil = redactUrl(url);
  assert.ok(!hasil.includes('AIzaSyFAKE'), 'key TIDAK boleh ikut tercetak');
  assert.ok(hasil.includes('key=[REDACTED]'), 'key harus diganti [REDACTED]');
  assert.ok(hasil.includes('alt=sse'), 'parameter lain harus tetap ada');
});

test('redactUrl: berbagai nama parameter kredensial', () => {
  for (const p of ['key', 'api_key', 'apikey', 'access_token', 'token', 'secret', 'password', 'signature']) {
    const hasil = redactUrl(`https://x.test/v1?a=1&${p}=RAHASIA123456`);
    assert.ok(!hasil.includes('RAHASIA123456'), `parameter ${p} harus diredaksi`);
  }
});

test('redactUrl: Authorization Bearer dibuang', () => {
  const hasil = redactUrl('Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig');
  assert.ok(!hasil.includes('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'), 'token Bearer harus diredaksi');
});

test('redactUrl: bentuk key lazim (sk-/gsk_/AIza) dibuang walau tanpa ?key=', () => {
  for (const k of ['sk-abcdef1234567890', 'gsk_abcdef1234567890', 'AIzaSyABCDEFGHIJKLMNOP']) {
    const hasil = redactUrl(`pesan error memuat ${k} di dalamnya`);
    assert.ok(!hasil.includes(k), `${k} harus diredaksi walau bukan di query string`);
  }
});

test('redactUrl: URL tanpa kredensial TIDAK diubah (tidak over-redact)', () => {
  const bersih = 'https://api.groq.com/openai/v1/chat/completions';
  assert.equal(redactUrl(bersih), bersih);
});

test('redactSecret: hanya 4 karakter terakhir yang tampak', () => {
  assert.equal(redactSecret('sk-abcdef1234567890'), '…7890');
  assert.equal(redactSecret('abc'), '[REDACTED]', 'nilai pendek harus disembunyikan total');
  assert.equal(redactSecret(''), '');
});

test('providers.ts: TIDAK ada log yang mencetak url/key mentah', () => {
  const p = baca('src/providers.ts');
  // Setiap console.* yang menyentuh `url` atau `key` WAJIB memakai redactUrl/redactSecret.
  const baris = p.split('\n');
  const pelanggar = [];
  baris.forEach((l, i) => {
    if (!l.includes('console.')) return;
    const menyentuhRahasia = /\$\{\s*(url|key)\b/.test(l) || /\$\{[^}]*\.slice\(0,\s*10\)/.test(l);
    const diredaksi = l.includes('redactUrl') || l.includes('redactSecret');
    if (menyentuhRahasia && !diredaksi) pelanggar.push(`${i + 1}: ${l.trim().slice(0, 100)}`);
  });
  assert.deepEqual(pelanggar, [], `log bocor di providers.ts:\n${pelanggar.join('\n')}`);
});

test('providers.ts: URL Gemini memuat key -> pemakaian WAJIB diredaksi saat dicetak', () => {
  const p = baca('src/providers.ts');
  assert.ok(p.includes('redactUrl'), 'providers.ts harus mengimpor & memakai redactUrl');
  assert.ok(!/key\.slice\(0,\s*10\)/.test(p), 'jangan cetak 10 karakter pertama key');
});
