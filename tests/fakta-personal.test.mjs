/**
 * TEST OTOMATIS — penangkap fakta personal (permintaan pemilik produk 06 Okt 2026):
 *   "buat agar bot bisa menangkap personality, kesukaan, dan lainnya dari user,
 *    simpan di database"
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { deteksiFaktaPersonal, PENANDA_FAKTA } from '../src/user_facts.js';

test('fakta: NAMA ditangkap', () => {
  assert.equal(deteksiFaktaPersonal('namaku Andi')?.kategori, 'nama');
  assert.equal(deteksiFaktaPersonal('nama saya Budi Santoso')?.kategori, 'nama');
});

test('fakta: KESUKAAN ditangkap', () => {
  for (const t of ['aku suka kopi pahit', 'gue doyan nasi padang', 'favoritku warna biru', 'aku gak suka durian']) {
    assert.equal(deteksiFaktaPersonal(t)?.kategori, 'kesukaan', `"${t}" harus kesukaan`);
  }
});

test('fakta: PEKERJAAN ditangkap', () => {
  assert.equal(deteksiFaktaPersonal('aku kerja di bank bca')?.kategori, 'pekerjaan');
  assert.equal(deteksiFaktaPersonal('aku mahasiswa')?.kategori, 'pekerjaan');
  assert.equal(deteksiFaktaPersonal('aku kuliah di UI')?.kategori, 'pekerjaan');
});

test('fakta: HOBI ditangkap', () => {
  assert.equal(deteksiFaktaPersonal('hobiku main game')?.kategori, 'hobi');
});

test('fakta: KULINER ditangkap', () => {
  assert.equal(deteksiFaktaPersonal('makanan favoritku sate ayam')?.kategori, 'kuliner');
});

test('fakta: KEBIASAAN ditangkap', () => {
  assert.equal(deteksiFaktaPersonal('aku biasanya bangun jam 5')?.kategori, 'kebiasaan');
});

test('fakta: TIDAK salah tangkap obrolan biasa', () => {
  for (const t of [
    'aku suka kamu', 'aku lagi makan kopi', 'kamu suka apa?', 'apa itu kopi',
    'aku tinggal di Bandung', 'halo apa kabar', 'berapa harga kopi', 'aku tadi makan enak',
  ]) {
    assert.equal(deteksiFaktaPersonal(t), null, `"${t}" TIDAK boleh dianggap fakta`);
  }
});

test('fakta: penanda [FAKTA] ada', () => {
  assert.equal(PENANDA_FAKTA, '[FAKTA]');
});

test('fakta: prompt memakai fakta personal secara natural', () => {
  // Aturan pemakaian harus ada di prompt
  const SK = fs.readFileSync(new URL('../src/skills.ts', import.meta.url), 'utf8');
  assert.ok(SK.includes('PROFIL & PREFERENSI TEMAN BICARAMU'), 'blok profil harus ada');
  assert.ok(SK.includes('JANGAN menanyakan hal yang SUDAH ADA'), 'harus larang tanya ulang');
  assert.ok(SK.includes('DILARANG menyebut "catatan"'), 'harus larang sebut catatan');
});

test('fakta: tersambung di semua platform', () => {
  
  for (const f of ['whatsapp_cloud.ts', 'telegram.ts', 'whatsapp_baileys.ts']) {
    const src = fs.readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
    assert.ok(src.includes('tangkapFaktaPersonal'), `${f} harus memanggil tangkapFaktaPersonal`);
  }
});
