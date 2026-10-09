/**
 * TEST OTOMATIS — PENOMORAN PER-USER di SEMUA fitur (09 Okt 2026).
 *
 * PERTANYAAN PEMILIK PRODUK: "saya hanya nanya knapa penomorannya #28.
 * bukannya #1?" + "perbaiki semua penomoran di semua fitur".
 *
 * AKAR: nomor yang ditampilkan ke user memakai ID SERIAL GLOBAL database
 * (notes.id, todos.id, expenses.id) — sehingga catatan pertama seorang user
 * bisa tampil #28 karena 27 catatan user LAIN sudah dibuat sebelumnya.
 *
 * ATURAN: nomor yang ditampilkan SELALU nomor urut PER-USER (1, 2, 3, ...)
 * berdasarkan urutan dibuat. Berlaku untuk SEMUA fitur: catatan, tugas,
 * keuangan, dan pesan konfirmasi simpan.
 *
 * BAHAYA YANG JUGA DIPERBAIKI: `/hapus <nomor>` dulu memakai nomor urut
 * sebagai ID DATABASE -> bisa menghapus baris yang SALAH.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  nomorUrutCatatan, idDariNomorCatatan,
  nomorUrutTugas, idDariNomorTugas,
  nomorUrutUang, idDariNomorUang,
} from '../src/notes.js';

// Buang KOMENTAR dulu — regex tidak boleh cocok dengan contoh di komentar.
const NOTES_RAW = fs.readFileSync(new URL('../src/notes.ts', import.meta.url), 'utf8');
const NOTES = NOTES_RAW
  .replace(/\/\*[\s\S]*?\*\//g, '')   // blok komentar
  .replace(/\/\/[^\n]*/g, '');          // komentar baris

test('penomoran: keenam fungsi nomor-urut ada (catatan/tugas/uang)', () => {
  for (const n of ['nomorUrutCatatan','idDariNomorCatatan','nomorUrutTugas','idDariNomorTugas','nomorUrutUang','idDariNomorUang']) {
    assert.ok(new RegExp(`export async function ${n}\\b`).test(NOTES), `${n} harus ada`);
  }
});

test('penomoran: TIDAK ada yang menampilkan ID global di pesan simpan', () => {
  // Pesan konfirmasi harus memakai nomor urut, bukan `#${id}` mentah.
  assert.ok(/Catatan disimpan \(#\$\{nomorCatatan/.test(NOTES),
    'catatan harus pakai nomorCatatan');
  assert.ok(/Tugas dicatat \(#\$\{nomorTugas/.test(NOTES),
    'tugas harus pakai nomorTugas');
  assert.ok(/Tercatat \(#\$\{nomorUang/.test(NOTES),
    'keuangan harus pakai nomorUang');
});

test('penomoran: daftar memakai nomor urut per-user', () => {
  assert.ok(/r\.nomor \?\? i \+ 1/.test(NOTES), 'formatDaftarCatatan harus pakai r.nomor');
  assert.ok(/r\.nomor \?\? r\.id/.test(NOTES), 'formatDaftarUang/Tugas harus pakai r.nomor');
});

test('penomoran: /hapus mengkonversi NOMOR -> ID (bukan pakai nomor sebagai ID)', () => {
  // ⚠️ BUG FATAL: dulu `hapusCatatan(chatId, nomor)` memakai nomor urut sebagai ID.
  assert.ok(!/hapusCatatan\(chatId,\s*nomor\)/.test(NOTES),
    'JANGAN hapusCatatan(chatId, nomor) langsung — bisa hapus baris salah');
  assert.ok(!/hapusUang\(chatId,\s*nomor\)/.test(NOTES),
    'JANGAN hapusUang(chatId, nomor) langsung');
  assert.ok(/idDariNomorCatatan\(chatId, nomor\)/.test(NOTES), 'harus konversi lewat idDariNomorCatatan');
  assert.ok(/idDariNomorUang\(chatId, nomor\)/.test(NOTES), 'harus konversi lewat idDariNomorUang');
});

test('penomoran: normalisasi chat_id dipakai di fungsi nomor urut', () => {
  for (const n of ['nomorUrutCatatan','nomorUrutUang','nomorUrutTugas','idDariNomorCatatan','idDariNomorUang','idDariNomorTugas']) {
    const i = NOTES.indexOf(`export async function ${n}(`);
    const badan = NOTES.slice(i, i + 600);
    assert.ok(badan.includes('normChatId'), `${n} harus normalisasi chat_id`);
  }
});
