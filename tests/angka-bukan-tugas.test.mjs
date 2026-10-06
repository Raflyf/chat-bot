/**
 * TEST OTOMATIS — angka dalam obrolan JANGAN jadi nomor tugas (06 Okt 2026).
 *
 * KENAPA: "Nenek gua ma walao udah 1021 tahun emang masih jaya"
 *   -> bot: "Tugas #1021 tidak ditemukan" (NGACO!)
 *
 * AKAR: pola lama menerima "sudah"/"udah" sebagai penanda selesai,
 * sehingga "udah 1021 tahun" dianggap "tugas 1021 selesai".
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const SRC = fs.readFileSync(new URL('../src/notes.ts', import.meta.url), 'utf8');

test('angka: guard "bukan tentang tugas" ada', () => {
  assert.match(SRC, /bukanTentangTugas/, 'harus ada guard');
  assert.ok(SRC.includes('tahun|bulan|hari|kali|orang|kucing|anak|ekor'), 'harus kenali satuan');
});

test('angka: "udah" tidak lagi langsung diikuti angka', () => {
  // Pola lama: /(?:selesai|sudah|udah|done|beres)\s+(?:\d+)/
  // Pola baru: "sudah/udah" HARUS diikuti kata selesai dulu.
  assert.ok(!SRC.includes('(?:selesai|selesaikan|sudah|udah|done|beres)\\s+'), 'pola lama harus hilang');
  assert.match(SRC, /\(\?:sudah\|udah\)\\s\+\(\?:selesai\|kelar\|beres\|done\|tuntas\)/, 'pola baru harus ada');
});

test('angka: pola "tandai N selesai" ditambahkan', () => {
  assert.match(SRC, /tandai\\s\+\(\?:tugas\\s\+\)\?/, 'harus kenali "tandai"');
});

test('angka: pola selesai-tugas yang BENAR tetap ada', () => {
  assert.match(SRC, /selesai\|selesaikan\|done\|beres\|kelar\|tuntas/, 'pola utama tetap');
  assert.match(SRC, /tugas\\s\+\(\?:nomor\\s\+\|no\\s\+\|#\)\?\(\\d\+\)/, 'pola "tugas N selesai" tetap');
});
