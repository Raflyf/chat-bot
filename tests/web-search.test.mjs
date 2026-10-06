/**
 * TEST OTOMATIS — web search & scrape (perbaikan 06 Okt 2026).
 *
 * KENAPA: saat mengaudit fitur scrapping, ditemukan 2 bug + 4 celah:
 *   BUG 1: kata "release" ditambahkan ke SEMUA query
 *          "harga bitcoin hari ini" -> "harga bitcoin hari release 2026"
 *   BUG 2: "hari ini" jadi "hari" (kata "ini" terbuang sebagai stop word)
 *   CELAH: "apa itu X", "cara X", "siapa itu X", "perbedaan" tidak memicu search
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { needsSearch, formulateSmartSearchQueries, isSafePublicUrl, keywords } from '../src/web.js';

// ── 1. DETEKSI PERLU SEARCH ──
test('search: pertanyaan faktual & terkini memicu penelusuran', () => {
  for (const t of [
    'siapa presiden indonesia sekarang',
    'harga bitcoin hari ini',
    'berita terbaru ai',
    'cuaca jakarta besok',
    'kurs dollar hari ini',
    'hasil pertandingan liga champions',
    'kapan iphone 17 rilis',
  ]) {
    assert.equal(needsSearch(t), true, `"${t}" harus memicu search`);
  }
});

test('search: "apa itu X" & "cara X" memicu penelusuran', () => {
  for (const t of ['apa itu quantum computing', 'apa itu RAG', 'cara install nodejs', 'siapa itu elon musk']) {
    assert.equal(needsSearch(t), true, `"${t}" harus memicu search`);
  }
});

test('search: obrolan biasa TIDAK memicu penelusuran', () => {
  for (const t of ['halo apa kabar', 'aku tadi makan enak', '1+1 berapa', 'ceritakan lelucon', 'buatkan puisi pendek', 'aku sedih hari ini']) {
    assert.equal(needsSearch(t), false, `"${t}" TIDAK boleh memicu search`);
  }
});

// ── 2. PEMBENTUKAN QUERY ──
test('query: TIDAK ada kata "release" untuk topik non-teknologi', () => {
  const q = formulateSmartSearchQueries('harga bitcoin hari ini');
  assert.ok(q.length > 0, 'harus menghasilkan query');
  for (const x of q) {
    assert.ok(!/\brelease\b/i.test(x), `query "${x}" TIDAK boleh memuat "release"`);
  }
});

test('query: frasa waktu "hari ini" tetap utuh', () => {
  const q = formulateSmartSearchQueries('harga bitcoin hari ini');
  assert.ok(q.some((x) => /hari ini/i.test(x)), 'harus ada query dengan "hari ini"');
  for (const x of q) {
    assert.ok(!/\bhari\s+\d{4}\b/.test(x) || /hari ini/.test(x), `query "${x}" tidak boleh memotong frasa waktu`);
  }
});

test('query: tidak ada kata berulang berdekatan', () => {
  for (const t of ['harga bitcoin hari ini', 'cuaca jakarta besok', 'siapa presiden indonesia sekarang']) {
    for (const x of formulateSmartSearchQueries(t)) {
      assert.ok(!/\b(\w+)\s+\1\b/i.test(x), `query "${x}" punya kata berulang`);
    }
  }
});

test('query: topik teknologi tetap dapat query rilis', () => {
  const q = formulateSmartSearchQueries('kapan iphone 17 rilis');
  assert.ok(q.length > 0);
  assert.ok(q.some((x) => /iphone/i.test(x)), 'harus ada query tentang iphone');
});

test('query: selalu menghasilkan minimal 1 query', () => {
  for (const t of ['apa itu RAG', 'cara install nodejs', 'harga bitcoin hari ini']) {
    assert.ok(formulateSmartSearchQueries(t).length >= 1, `"${t}" harus menghasilkan query`);
  }
});

// ── 3. KEAMANAN URL (SSRF) ──
test('ssrf: URL publik diizinkan', () => {
  assert.equal(isSafePublicUrl('https://example.com'), true);
  assert.equal(isSafePublicUrl('https://id.wikipedia.org/wiki/Indonesia'), true);
});

test('ssrf: URL internal/lokal DITOLAK', () => {
  for (const u of [
    'http://localhost:3000',
    'http://127.0.0.1',
    'http://192.168.1.1',
    'http://169.254.169.254/latest/meta-data',
    'http://10.0.0.1',
    'http://172.16.0.1',
  ]) {
    assert.equal(isSafePublicUrl(u), false, `${u} harus DITOLAK`);
  }
});

test('ssrf: protokol non-http DITOLAK', () => {
  assert.equal(isSafePublicUrl('file:///etc/passwd'), false);
  assert.equal(isSafePublicUrl('javascript:alert(1)'), false);
  assert.equal(isSafePublicUrl('ftp://example.com'), false);
});

// ── 4. KEYWORDS KOMPATIBILITAS ──
test('keywords: mengembalikan string tidak kosong', () => {
  const k = keywords('berapa harga tiket konser coldplay jakarta');
  assert.ok(typeof k === 'string' && k.length > 0);
});
