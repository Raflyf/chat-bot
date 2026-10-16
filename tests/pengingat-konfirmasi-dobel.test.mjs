/**
 * TEST: pengingat tidak boleh jadi DOBEL karena pertanyaan konfirmasi.
 *
 * TEMUAN NYATA (16 Okt 2026, Telegram) — user menerima DUA pengingat:
 *   user : "Ingatkan saya rutin tiap jam 6 pagi untuk bangun"  -> #924 "bangun" (zona Amerika)
 *   bot  : "✅ Pengingat disimpan..."
 *   user : "aku di Cianjur"                                    -> zona diperbaiki ke WIB
 *   user : "jadi pengingat rutin bangun jam 6 pagi itu WIB ya" <- PERTANYAAN KONFIRMASI
 *   bot  : "✅ Pengingat disimpan, "bangun itu WIB"..."        -> #925 pengingat KEDUA
 *
 * Dua baris `pending` sekaligus = user dapat dua pengingat, dan judulnya kotor
 * ("bangun itu WIB") karena teks pertanyaan ikut jadi judul.
 *
 * Test ini mengunci perbaikannya: pertanyaan konfirmasi TIDAK dianggap perintah
 * pengingat baru.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { adalahPertanyaanKonfirmasiPengingat } from '../src/notes.js';

const NOTES = fs.readFileSync(new URL('../src/notes.ts', import.meta.url), 'utf8');

test('kasus nyata: "jadi pengingat rutin ... itu WIB ya" terdeteksi konfirmasi', () => {
  assert.equal(
    adalahPertanyaanKonfirmasiPengingat('jadi pengingat rutin bangun jam 6 pagi itu WIB ya'),
    true,
  );
});

test('konfirmasi dengan tanda tanya juga terdeteksi', () => {
  assert.equal(adalahPertanyaanKonfirmasiPengingat('pengingat bangun jam 6 itu WIB ya?'), true);
  assert.equal(adalahPertanyaanKonfirmasiPengingat('jadwal rutinnya tetap tiap hari kan?'), true);
  assert.equal(adalahPertanyaanKonfirmasiPengingat('berarti pengingatnya tiap hari ya'), true);
});

test('PERINTAH pengingat baru TIDAK dianggap konfirmasi', () => {
  // Ini perintah asli — harus tetap diproses sebagai pengingat baru.
  assert.equal(adalahPertanyaanKonfirmasiPengingat('ingatkan saya tiap jam 6 pagi untuk bangun'), false);
  assert.equal(adalahPertanyaanKonfirmasiPengingat('buatkan pengingat rutin minum obat tiap hari jam 8'), false);
  assert.equal(adalahPertanyaanKonfirmasiPengingat('ingatkan besok jam 9 rapat'), false);
});

test('obrolan biasa yang kebetulan berakhiran "ya" tidak dianggap konfirmasi', () => {
  // Tidak menyebut hal seputar pengingat -> bukan konfirmasi pengingat.
  assert.equal(adalahPertanyaanKonfirmasiPengingat('kamu sudah makan ya'), false);
  assert.equal(adalahPertanyaanKonfirmasiPengingat('bagus ya'), false);
  assert.equal(adalahPertanyaanKonfirmasiPengingat('oke ya'), false);
});

test('input kosong aman', () => {
  assert.equal(adalahPertanyaanKonfirmasiPengingat(''), false);
  assert.equal(adalahPertanyaanKonfirmasiPengingat('   '), false);
});

test('guard terpasang di jalur pengingat & memakai kemiripan subjek', () => {
  assert.match(NOTES, /export function adalahPertanyaanKonfirmasiPengingat/);
  assert.match(NOTES, /async function pertanyaanKonfirmasiPengingat/);
  // Dipanggil SEBELUM menyimpan pengingat.
  const idxGuard = NOTES.indexOf('await pertanyaanKonfirmasiPengingat(asli, chatId');
  const idxSimpan = NOTES.indexOf('const r = await simpanDariNiat(chatId, niat, { actor: opts.actor, platform: opts.platform, teksAsli: asli });', idxGuard);
  assert.notEqual(idxGuard, -1, 'guard harus dipanggil di jalur pengingat');
  assert.ok(idxSimpan > idxGuard, 'guard harus berjalan SEBELUM penyimpanan');
  // Bila terdeteksi konfirmasi -> diserahkan ke AI (bukan teks template).
  assert.match(NOTES, /ditangani: false, reply: '', jalur: 'konfirmasi-pengingat'/);
  // Pemeriksaan kemiripan memakai helper dedup yang sudah ada.
  assert.match(NOTES, /kemiripanPesan\(subjek/);
});
