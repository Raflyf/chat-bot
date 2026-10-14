/**
 * TEST: Kelengkapan kamus i18n — anti-regresi.
 *
 * TEMUAN AUDIT 14 Okt 2026:
 *   `public/js/i18n.js` memakai `DICTIONARY.en` + `ID_STORAGE` (teks Indonesia
 *   asli ditangkap dari HTML saat pertama dimuat). Bila ada `data-i18n="kunci"`
 *   di HTML yang TIDAK ada di `DICTIONARY.en`, maka saat pengguna beralih ke
 *   bahasa Inggris elemen itu DIAM-DIAM tetap berbahasa Indonesia — tidak ada
 *   error, tidak ada peringatan.
 *
 *   Hasil pemeriksaan saat audit: 157 kunci dipakai, 229 kunci di kamus,
 *   0 kunci hilang. Test ini mengunci kondisi itu supaya tidak rusak nanti.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Akar proyek = naik satu tingkat dari folder tests/.
const AKAR = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const I18N = fs.readFileSync(new URL('../public/js/i18n.js', import.meta.url), 'utf8');

/** Ekstrak kunci dari blok `en: { ... }`. */
function kunciKamus() {
  const i = I18N.indexOf('en: {');
  assert.ok(i >= 0, 'blok "en:" harus ada di i18n.js');
  const j = I18N.indexOf('{', i);
  let depth = 0;
  let k = j;
  while (k < I18N.length) {
    if (I18N[k] === '{') depth++;
    else if (I18N[k] === '}') {
      depth--;
      if (depth === 0) break;
    }
    k++;
  }
  const isi = I18N.slice(j + 1, k);
  return new Set([...isi.matchAll(/"([^"]+)"\s*:/g)].map((m) => m[1]));
}

/** Kumpulkan semua kunci yang dirujuk HTML/JS (data-i18n* dan t('...')). */
function kunciDipakai() {
  const hasil = new Set();
  const lewati = new Set(['node_modules', '.git', 'dist']);
  const telusuri = (dir) => {
    for (const entri of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entri.isDirectory()) {
        if (!lewati.has(entri.name)) telusuri(path.join(dir, entri.name));
        continue;
      }
      if (!/\.(?:html|js|ts)$/.test(entri.name)) continue;
      if (entri.name === 'i18n.js') continue;
      const teks = fs.readFileSync(path.join(dir, entri.name), 'utf8');
      for (const m of teks.matchAll(/data-i18n(?:-placeholder|-title|-aria)?="([^"]+)"/g)) hasil.add(m[1]);
      for (const m of teks.matchAll(/\bt\(\s*['"]([^'"]+)['"]/g)) hasil.add(m[1]);
    }
  };
  telusuri(AKAR);
  return hasil;
}

test('i18n: kamus EN tidak kosong', () => {
  const kamus = kunciKamus();
  assert.ok(kamus.size > 100, `kamus EN harus berisi banyak kunci (dapat ${kamus.size})`);
});

test('i18n: SETIAP kunci yang dipakai ADA di kamus EN', () => {
  const kamus = kunciKamus();
  const dipakai = kunciDipakai();
  const hilang = [...dipakai].filter((k) => !kamus.has(k)).sort();
  assert.deepEqual(
    hilang,
    [],
    `kunci ini dipakai di HTML/JS tetapi tidak ada di kamus EN -> elemen tetap berbahasa Indonesia saat mode EN:\n${hilang.join('\n')}`,
  );
});

test('i18n: kunci dinamis dash.* & dyn.* tersedia', () => {
  const kamus = kunciKamus();
  // dashboard.js merender teks secara dinamis lewat window.t(key, fallback).
  const dinamis = [...kamus].filter((k) => k.startsWith('dash.') || k.startsWith('dyn.'));
  assert.ok(dinamis.length > 20, `kunci dash.*/dyn.* harus tersedia (dapat ${dinamis.length})`);
});

test('i18n: helper t() mengembalikan fallback, bukan kunci mentah', () => {
  // Bila kunci tidak ada di kamus EN dan fallback diberikan, hasilnya fallback.
  assert.match(I18N, /return fallback !== undefined \? fallback : key;/, 't() harus punya fallback aman');
});
