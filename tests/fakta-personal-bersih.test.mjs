/**
 * TEST OTOMATIS — fakta personal TIDAK menyimpan sampah (09 Okt 2026).
 *
 * LAPORAN PEMILIK PRODUK: bot menyimpan fakta ngaco ke database:
 *   "Suka buah apa"            <- PERTANYAAN disimpan sebagai kesukaan
 *   "Kerja di/sebagai biar ga pegel"   <- keterangan, bukan profesi
 *   "Kerja di/sebagai baru pulang"
 *   "Biasanya nya mau beli mereka semua"  <- kata terbelah
 *   "Namanya gue kan"          <- partikel, bukan nama
 * Selain itu: buah kesukaan user SALAH tercatat "mangga" padahal user bilang
 * "SEMANGKA!" (lihat riwayat chat 06 Okt 19:58).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deteksiFaktaPersonal } from '../src/user_facts.js';

test('fakta: PERTANYAAN tidak disimpan sebagai fakta', () => {
  for (const t of [
    'Salah, tuh kamu ga inget aku suka buah apa',
    'aku suka buah apa',
    'kamu tau ga aku suka apa',
  ]) {
    assert.equal(deteksiFaktaPersonal(t), null, `"${t}" jangan jadi fakta`);
  }
});

test('fakta: keterangan kabur bukan pekerjaan', () => {
  for (const t of ['aku kerja biar ga pegel', 'aku kerja baru pulang']) {
    assert.equal(deteksiFaktaPersonal(t), null, `"${t}" jangan jadi pekerjaan`);
  }
});

test('fakta: kebiasaan kabur tidak disimpan', () => {
  for (const t of ['aku biasa nya mau beli mereka semua']) {
    assert.equal(deteksiFaktaPersonal(t), null, `"${t}" jangan jadi kebiasaan`);
  }
});

test('fakta: partikel bukan nama', () => {
  for (const t of ['nama gue kan', 'nama gue itu huruf depan nya D']) {
    assert.equal(deteksiFaktaPersonal(t), null, `"${t}" jangan jadi nama`);
  }
});

test('fakta: fakta SAH tetap tersimpan', () => {
  const sah = [
    ['namaku Dhea', 'nama'],
    ['panggil aku bub', 'nama'],
    ['aku suka mangga', 'kesukaan'],
    ['aku suka romance', 'kesukaan'],
  ];
  for (const [t, kat] of sah) {
    const f = deteksiFaktaPersonal(t);
    assert.ok(f, `"${t}" harus terdeteksi`);
    assert.equal(f.kategori, kat, `"${t}" kategori harus ${kat}`);
  }
});

test('fakta: pekerjaan SAH tetap tersimpan', () => {
  const f = deteksiFaktaPersonal('aku kerja di toko');
  assert.ok(f, 'pekerjaan sah harus terdeteksi');
  assert.equal(f.kategori, 'pekerjaan');
});
