/**
 * TEST OTOMATIS — kebiasaan disimpan OTOMATIS sebagai referensi (09 Okt 2026).
 *
 * KOREKSI PEMILIK PRODUK: "untuk yg kebiasaan itu cukup langsung simpan di DB,
 * tidak usah ada interaksi apa apa, cukup jadi bahan referensi bot untuk
 * kebiasaan user, jadi tidak usah ada streak atau fitur hook nya"
 * + "biar ga bentrok dengan fitur remind".
 *
 * DESAIN AKHIR:
 *   - Kebiasaan DIDETEKSI OTOMATIS dari percakapan (deteksiFaktaPersonal).
 *   - Disimpan ke tabel `corrections` dengan penanda [FAKTA] kategori kebiasaan.
 *   - Otomatis jadi bahan referensi bot lewat ctx.corrections (getContext).
 *   - TIDAK ada perintah /kebiasaan, TIDAK ada streak, TIDAK ada hook.
 *   - TIDAK bentrok dengan fitur remind (pengingat) — keduanya terpisah.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { deteksiFaktaPersonal } from '../src/user_facts.js';
import { deteksiNiat, deteksiNiatImplisit } from '../src/notes.js';

const NOTES = fs.readFileSync(new URL('../src/notes.ts', import.meta.url), 'utf8');

test('kebiasaan: tersimpan OTOMATIS tanpa perintah', () => {
  const kasus = [
    ['aku biasanya bangun jam 5 pagi', /bangun jam 5/i],
    ['aku selalu minum kopi tiap pagi', /minum kopi/i],
    ['tiap hari aku olahraga pagi', /olahraga pagi/i],
    ['aku biasa nya main game malam', /main game malam/i],
  ];
  for (const [t, harap] of kasus) {
    const f = deteksiFaktaPersonal(t);
    assert.ok(f, `"${t}" harus terdeteksi`);
    assert.equal(f.kategori, 'kebiasaan', `"${t}" kategori harus kebiasaan`);
    assert.match(f.fakta, harap, `"${t}" isi fakta harus memuat ${harap}`);
  }
});

test('kebiasaan: TIDAK ada perintah /kebiasaan (desain baru)', () => {
  assert.ok(!NOTES.includes('perintah-kebiasaan'), 'jalur perintah-kebiasaan harus dihapus');
  assert.ok(!/export (async )?function simpanKebiasaan/.test(NOTES), 'simpanKebiasaan harus dihapus');
  assert.ok(!/export (async )?function centangKebiasaan/.test(NOTES), 'centangKebiasaan harus dihapus');
  assert.ok(!/export (async )?function daftarKebiasaan/.test(NOTES), 'daftarKebiasaan harus dihapus');
});

test('kebiasaan: TIDAK bentrok dengan fitur REMIND', () => {
  // Pesan pengingat TIDAK boleh ikut tersimpan sebagai fakta kebiasaan.
  const remind = [
    'ingatkan aku besok jam 9 rapat',
    'ingatkan 3, 2, 1 hari sebelum ujian 15 november 2026',
    'ingatkan aku minum vitamin jam 7 pagi',
  ];
  for (const t of remind) {
    const niat = deteksiNiat(t) || deteksiNiatImplisit(t);
    assert.ok(niat, `"${t}" harus ditangani sebagai pengingat`);
    assert.equal(deteksiFaktaPersonal(t), null, `"${t}" JANGAN jadi fakta kebiasaan (bentrok remind)`);
  }
});

test('kebiasaan: dipakai sebagai REFERENSI bot (via corrections)', () => {
  // Fakta personal disimpan ke tabel corrections → terbaca getContext → prompt.
  const uf = fs.readFileSync(new URL('../src/user_facts.ts', import.meta.url), 'utf8');
  assert.ok(uf.includes("from('corrections')"), 'harus disimpan ke corrections');
  assert.ok(uf.includes('PENANDA_FAKTA'), 'harus pakai penanda [FAKTA]');
  const mem = fs.readFileSync(new URL('../src/memory.ts', import.meta.url), 'utf8');
  assert.ok(mem.includes("from('corrections')"), 'getContext harus membaca corrections');
});
