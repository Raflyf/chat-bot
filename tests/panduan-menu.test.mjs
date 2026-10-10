/**
 * TEST OTOMATIS — deteksi permintaan PANDUAN/MENU (10 Okt 2026).
 *
 * LAPORAN PEMILIK PRODUK: user kirim "Kirim menu" lalu "Kalau begitu buat menu
 * dong", tetapi bot MENJAWAB "Gak bisa, aku bukan aplikasi yang punya fitur menu.
 * Kita ngobrol aja ya." — PADAHAL bot punya daftar fitur lengkap!
 *
 * AKAR: pola deteksi panduan hanya menangkap kata "menu" SENDIRIAN. Begitu ada
 * kata lain ("kirim menu", "buat menu dong", "minta menu"), tidak cocok -> jatuh
 * ke AI -> AI (tidak tahu fitur) menjawab "tidak ada menu".
 *
 * PERBAIKAN: pola diperluas — kata kunci panduan boleh disertai kata permintaan
 * (kirim/tampilkan/lihat/minta/buat/kasih/beri) selama pesan PENDEK dan TIDAK ada
 * sinyal tugas nyata (catat/hitung/makanan).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deteksiMintaPanduan } from '../src/notes.js';

test('panduan: permintaan menu dengan kata kerja DITERIMA', () => {
  const kasus = [
    'menu', '/menu', 'menu dong', 'menu nya', 'apa menu nya', 'menu apa aja',
    'kirim menu', 'kirimkan menu', 'tampilkan menu', 'lihat menu', 'liat menu',
    'minta menu', 'buat menu', 'buatkan menu', 'kasih menu', 'beri menu',
    'kalau begitu buat menu dong', 'coba kirim menu', 'aku mau lihat menu',
  ];
  for (const t of kasus) {
    assert.ok(deteksiMintaPanduan(t), `"${t}" harus dianggap permintaan panduan`);
  }
});

test('panduan: permintaan fitur/perintah/tutorial DITERIMA', () => {
  const kasus = [
    'perintah apa aja', 'command apa saja', 'daftar perintah', 'list perintah',
    'panduan', 'guide', 'tutorial', 'cara pakai', 'cara pake', 'cara menggunakan',
    'help', '/help', 'bantuan', '/bantuan', '/fitur', '/tutorial', '/panduan',
    'bisa apa saja', 'bisa ngapain', 'kamu bisa apa', 'bot ini bisa apa',
    'fitur apa', 'fitur apa aja', 'kemampuan kamu apa', 'apa saja yang bisa',
  ];
  for (const t of kasus) {
    assert.ok(deteksiMintaPanduan(t), `"${t}" harus dianggap permintaan panduan`);
  }
});

test('panduan: TUGAS NYATA tidak dianggap panduan', () => {
  // Ini bug lama yang pernah diperbaiki (08 Okt): user minta HITUNG menu dari
  // spreadsheet malah diberi tutorial.
  const tolak = [
    'bantu aku hitung ada berapa menu',
    'recap 60 menu dari spreadsheet',
    'menu restoran di jakarta',
    'buatkan aku menu makan siang',
    'menu makanan sehat untuk diet',
    'harga menu cafe',
    'catat: beli menu',
    'ingatkan besok jam 9',
    'berapa sisa uang saya',
  ];
  for (const t of tolak) {
    assert.equal(deteksiMintaPanduan(t), false, `"${t}" JANGAN dianggap panduan`);
  }
});
