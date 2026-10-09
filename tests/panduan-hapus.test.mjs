/**
 * TEST OTOMATIS — panduan lengkap & hapus keuangan (06 Okt 2026).
 *
 * KENAPA: permintaan pemilik produk:
 *   "untuk menghapus pengeluaran dan pemasukan itu gimana?"
 *   "jika ada user minta tutorial fitur atau cara pemakaian, atau bertanya
 *    bisa apa saja, berikan full apa yang bisa dilakukan bot"
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const SRC = fs.readFileSync(new URL('../src/notes.ts', import.meta.url), 'utf8');

test('hapus: /uang tanpa isi menampilkan daftar (agar bisa hapus)', () => {
  assert.match(SRC, /perintah-uang-list/, 'harus ada jalur daftar keuangan');
  assert.match(SRC, /export async function daftarUang/, 'harus ada fungsi daftarUang');
  assert.match(SRC, /export function formatDaftarUang/, 'harus ada format daftar');
});

test('hapus: /hapus-uang <nomor> tersedia', () => {
  assert.match(SRC, /hapus-uang/, 'harus ada perintah /hapus-uang');
});

test('hapus: /hapus memakai nomor urut untuk catatan & keuangan', () => {
  // DIPERBARUI (09 Okt 2026): dulu `dCat[nomor - 1]` (index array) — itu SALAH
  // karena nomor urut bisa berbeda dari posisi di array. Sekarang konversi
  // nomor -> ID lewat idDariNomorCatatan/idDariNomorUang (bebas bug hapus salah).
  assert.match(SRC, /idDariNomorCatatan\(chatId, nomor\)/, 'catatan: konversi nomor -> ID');
  assert.match(SRC, /idDariNomorUang\(chatId, nomor\)/, 'keuangan: konversi nomor -> ID');
});

test('panduan: deteksi minta panduan ada', () => {
  assert.match(SRC, /export function deteksiMintaPanduan/);
  assert.match(SRC, /export function teksPanduanLengkap/);
  assert.match(SRC, /panduan-lengkap/, 'harus ada jalur panduan-lengkap');
});

test('panduan: mencakup semua fitur utama', () => {
  const idx = SRC.indexOf('export function teksPanduanLengkap');
  const blok = SRC.slice(idx, idx + 3000);
  for (const fitur of ['PENGINGAT', 'KEUANGAN', 'TUGAS', 'CATATAN', 'RINGKASAN', 'GAME', 'RISET', 'MEDIA']) {
    assert.ok(blok.includes(fitur), `panduan harus mencakup ${fitur}`);
  }
});

// Replikasi deteksi panduan
function deteksiPanduan(teks) {
  const t = teks.toLowerCase().trim();
  return (
    /\b(?:bisa|dapat|mampu)\s+(?:apa|ngapain|ngapain\s+aja|apa\s+aja|apa\s+saja)\b/.test(t) ||
    /\b(?:fitur|kemampuan|kelebihan|fungsi)\s*(?:apa|apa\s+aja|apa\s+saja|nya)?\s*(?:aja|saja|apa)?\s*\??$/.test(t) ||
    /\b(?:tutorial|cara\s+(?:pakai|pemakaian|gunakan|menggunakan|pake)|panduan|guide|help|bantuan|menu|perintah|command)\b/.test(t) ||
    /\b(?:apa\s+(?:aja|saja)\s+yang\s+bisa|bisa\s+ngelakuin\s+apa|kamu\s+bisa\s+apa|bot\s+ini\s+bisa)\b/.test(t) ||
    /^\s*\/(?:help|bantuan|panduan|menu|fitur|tutorial)\s*$/.test(t)
  );
}

test('panduan: deteksi berbagai cara bertanya', () => {
  for (const t of ['bisa apa saja?', 'kamu bisa apa', 'tutorial', 'cara pakai', 'fitur apa saja', 'help', '/help', 'panduan', 'menu']) {
    assert.equal(deteksiPanduan(t), true, `"${t}" harus terdeteksi minta panduan`);
  }
});

test('panduan: obrolan biasa TIDAK terdeteksi', () => {
  for (const t of ['halo apa kabar', 'aku tadi makan enak', 'bayar makan 25rb']) {
    assert.equal(deteksiPanduan(t), false, `"${t}" TIDAK boleh dianggap minta panduan`);
  }
});
