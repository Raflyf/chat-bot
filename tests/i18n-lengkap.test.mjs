/**
 * TEST OTOMATIS — i18n LENGKAP (08 Okt 2026).
 *
 * LAPORAN PEMILIK PRODUK: "lihat ini bahasa inggris nya masih belum berfungsi,
 * cek lagi semua baik landing page maupun dashboard itu apakah sudah benar semua
 * ketika diubah ke bahasa inggris".
 *
 * TEMUAN:
 *  1. Form laporan (9 kunci lapor.*) TIDAK ada di kamus EN -> tombol EN tidak
 *     mengubahnya sama sekali.
 *  2. Dashboard hampir TIDAK punya i18n: hanya 1 dari ~113 elemen ditandai.
 *  3. i18n.js punya ERROR SINTAKS (koma hilang) -> seluruh file gagal dieksekusi,
 *     sehingga tombol bahasa tidak berpengaruh APA PUN.
 *  4. <option> tidak ikut diterjemahkan (perlu penanganan eksplisit).
 *  5. dashboard.js merender ~47 teks dinamis -> perlu helper t().
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const BACA = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');

test('i18n.js: sintaks valid (koma lengkap)', () => {
  // Error sintaks membuat SELURUH i18n mati — ini akar "EN tidak berfungsi".
  assert.doesNotThrow(() => {
    execFileSync(process.execPath, ['--check', new URL('../public/js/i18n.js', import.meta.url).pathname.replace(/^\//, '')], { stdio: 'pipe' });
  }, 'i18n.js harus lolos node --check');
});

test('i18n.js: dashboard.js juga sintaks valid', () => {
  assert.doesNotThrow(() => {
    execFileSync(process.execPath, ['--check', new URL('../public/js/dashboard.js', import.meta.url).pathname.replace(/^\//, '')], { stdio: 'pipe' });
  }, 'dashboard.js harus lolos node --check');
});

test('landing: SEMUA data-i18n ada di kamus EN', () => {
  const html = BACA('public/index.html');
  const i18n = BACA('public/js/i18n.js');
  const keys = [...html.matchAll(/data-i18n(?:-placeholder)?="([^"]+)"/g)].map((m) => m[1]);
  const hilang = keys.filter((k) => !new RegExp(`"${k.replace(/[.]/g, '\\.')}"`).test(i18n));
  assert.deepEqual(hilang, [], `kunci landing tanpa terjemahan: ${hilang.join(', ')}`);
});

test('dashboard: SEMUA data-i18n ada di kamus EN', () => {
  const html = BACA('public/dashboard.html');
  const i18n = BACA('public/js/i18n.js');
  const keys = [...html.matchAll(/data-i18n(?:-placeholder)?="([^"]+)"/g)].map((m) => m[1]);
  const hilang = keys.filter((k) => !new RegExp(`"${k.replace(/[.]/g, '\\.')}"`).test(i18n));
  assert.deepEqual(hilang, [], `kunci dashboard tanpa terjemahan: ${hilang.join(', ')}`);
});

test('form laporan: 9 kunci lapor.* ada di kamus', () => {
  const i18n = BACA('public/js/i18n.js');
  for (const k of ['lapor.heading', 'lapor.subheading', 'lapor.label', 'lapor.placeholder',
                   'lapor.label.file', 'lapor.hintfile', 'lapor.hapusfile', 'lapor.kirim', 'lapor.note']) {
    assert.ok(i18n.includes(`"${k}"`), `${k} harus ada di kamus EN`);
  }
});

test('dashboard: minimal 100 elemen ditandai data-i18n', () => {
  const html = BACA('public/dashboard.html');
  const n = (html.match(/data-i18n=/g) || []).length;
  assert.ok(n >= 100, `dashboard harus punya >=100 data-i18n (dapat ${n})`);
});

test('i18n.js: <option> ditangani eksplisit', () => {
  const i18n = BACA('public/js/i18n.js');
  assert.ok(i18n.includes('option[data-i18n]'), 'harus ada penanganan option eksplisit');
});

test('i18n.js: helper t() tersedia untuk teks dinamis', () => {
  const i18n = BACA('public/js/i18n.js');
  assert.ok(i18n.includes('window.t = function'), 'harus ada helper window.t');
});

test('HTML: tidak ada sisipan rusak "> data-i18n="', () => {
  for (const f of ['public/index.html', 'public/dashboard.html']) {
    const html = BACA(f);
    assert.ok(!/> data-i18n="/.test(html), `${f} tidak boleh punya sisipan rusak`);
  }
});

test('HTML: tag <select> seimbang', () => {
  const html = BACA('public/dashboard.html');
  const buka = (html.match(/<select/g) || []).length;
  const tutup = (html.match(/<\/select>/g) || []).length;
  assert.equal(buka, tutup, `<select> tidak seimbang (${buka} vs ${tutup})`);
});
