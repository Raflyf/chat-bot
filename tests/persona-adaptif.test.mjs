/**
 * TEST OTOMATIS — persona adaptif (09 Okt 2026).
 *
 * PERMINTAAN PEMILIK PRODUK:
 *   "tambahkan, jadi jika user sedang serius maka bot juga serius, jika user sudah
 *    selesai serius nya maka bot juga selesai, dan jika user ngeledek, ngata ngatain
 *    dan lainnya maka bot nya juga adaptasi, tapi jawaban bot nya harus tetep
 *    nyambung dan ga ngawur"
 *
 * EMPAT MEKANISME:
 *  1. REGISTER bahasa — formal (saya/anda/mohon) vs gaul (gue/lu/wkwk)
 *  2. SUASANA BANTER — saling ledek DIPERBOLEHKAN bila user menikmatinya,
 *     TAPI dilarang kata kasar/kotor, dilarang mengulang hinaan, dan berhenti
 *     total begitu user minta berhenti.
 *  3. TRANSISI — keluar dari mode serius bila 2 pesan terakhir sudah santai.
 *  4. NYAMBUNG — substansi jawaban tetap benar walau sedang banter.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const SK = fs.readFileSync(new URL('../src/skills.ts', import.meta.url), 'utf8');

test('persona: register formal dideteksi', () => {
  assert.ok(SK.includes('rapi & sopan'), 'harus ada instruksi register formal');
  assert.ok(SK.includes('registerFormal'), 'harus ada pola registerFormal');
});

test('persona: register gaul dideteksi', () => {
  assert.ok(SK.includes('santai/gaul natural'), 'harus ada instruksi register gaul');
  assert.ok(SK.includes('registerGaul'), 'harus ada pola registerGaul');
});

test('persona: PRIORITAS menjawab ISI pesan (anti-ngawur)', () => {
  assert.ok(SK.includes('PRIORITAS UTAMA SEBELUM GAYA'), 'harus ada prioritas jawab isi');
  assert.ok(SK.includes('DILARANG MUTLAK membicarakan dirimu sendiri'), 'harus larang meta tentang diri');
});

test('persona: banter diperbolehkan dengan batas aman', () => {
  assert.ok(SK.includes('saling ledek & dia menikmatinya'), 'harus ada blok banter');
  assert.ok(SK.includes('Dilarang kata kasar/kotor'), 'harus larang kata kotor');
  assert.ok(SK.includes('dilarang mengulang hinaannya'), 'harus larang ulang hinaan');
  assert.ok(SK.includes('NYAMBUNG ke isi pesannya'), 'harus wajib nyambung');
});

test('persona: banter berhenti bila user minta berhenti', () => {
  assert.ok(SK.includes('mintaStopLedek'), 'harus deteksi permintaan berhenti');
  assert.ok(SK.includes('berhenti total'), 'harus berhenti total');
});

test('persona: transisi keluar dari mode serius', () => {
  assert.ok(SK.includes('topik serius sudah selesai'), 'harus ada blok transisi');
  assert.ok(SK.includes('masihSerius') && SK.includes('sudahSantai'), 'harus hitung transisi');
});

test('persona: dihitung dari RIWAYAT (bukan hanya pesan terakhir)', () => {
  // Model berganti tiap pesan pada rantai failover — register & suasana harus
  // dibaca dari beberapa pesan terakhir, bukan hanya yang terakhir.
  assert.ok(SK.includes('riwayatUser'), 'harus ada riwayatUser');
  assert.ok(SK.includes('gabungRiwayat'), 'harus ada gabungRiwayat');
});
