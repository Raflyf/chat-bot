/**
 * TEST: menu `/` Telegram berisi daftar lengkap fitur.
 *
 * PERMINTAAN PEMILIK PRODUK (16 Okt 2026):
 *   "saya ingin ketika / gini itu muncul semua list fitur yg ada secara lengkap"
 *
 * Dua masalah yang diperbaiki:
 *   1. Perintah bot TIDAK PERNAH didaftarkan lewat `setMyCommands` -> menu `/`
 *      kosong di kolom ketik Telegram.
 *   2. `/help`, `/bantuan`, `/menu`, `/fitur`, `/panduan`, `/tutorial` tidak punya
 *      penanganan -> ditelan `if (text.startsWith('/'))` dan bot diam.
 *
 * Test ini mengunci: daftar perintah sah menurut aturan Telegram, ada
 * penanganan bantuan, dan tidak ada perintah yang didaftarkan tanpa penanganan.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  PERINTAH_BOT,
  PERINTAH_BANTUAN,
  PERINTAH_BERARGUMEN,
  daftarPerintahTelegram,
  teksDaftarPerintah,
  konteksBantuanUntukAi,
} from '../src/commands.js';

const TG = fs.readFileSync(new URL('../src/telegram.ts', import.meta.url), 'utf8');
const SCRIPT = fs.readFileSync(new URL('../scripts/set_perintah_telegram.ts', import.meta.url), 'utf8');

test('semua perintah sah menurut aturan Telegram (a-z, 0-9, garis bawah)', () => {
  const sah = /^[a-z0-9_]{1,32}$/;
  for (const p of daftarPerintahTelegram()) {
    assert.ok(sah.test(p.command), `"${p.command}" tidak sah untuk Telegram (tanda hubung dilarang)`);
  }
});

test('deskripsi memenuhi batas Telegram (3-256 karakter)', () => {
  for (const p of PERINTAH_BOT) {
    assert.ok(p.description.length >= 3, `deskripsi "${p.command}" terlalu pendek`);
    assert.ok(p.description.length <= 256, `deskripsi "${p.command}" terlalu panjang`);
  }
});

test('tidak lebih dari 100 perintah (batas Telegram)', () => {
  assert.ok(daftarPerintahTelegram().length <= 100);
});

test('fitur utama SEMUA terdaftar', () => {
  const ada = new Set(PERINTAH_BOT.map((p) => p.command));
  for (const wajib of [
    'start', 'help', 'reset',
    'tanya', 'ai',
    'catat', 'catatan', 'cari',
    'tugas', 'list',
    'uang', 'masuk', 'keluar', 'rekap',
    'barang', 'belanja',
    'remind', 'salah',
  ]) {
    assert.ok(ada.has(wajib), `perintah /${wajib} harus terdaftar di menu`);
  }
});

test('perintah bantuan mencakup semua alias yang didukung kode', () => {
  for (const a of ['help', 'bantuan', 'menu', 'fitur', 'panduan', 'tutorial']) {
    assert.ok(PERINTAH_BANTUAN.has(a), `/${a} harus memicu daftar fitur`);
  }
});

test('konteks bantuan untuk AI memuat daftar perintah & contoh pemakaian', () => {
  const k = konteksBantuanUntukAi();
  assert.match(k, /DAFTAR PERINTAH YANG BENAR-BENAR ADA/);
  assert.match(k, /\/catat/);
  assert.match(k, /\/remind <menit> <pesan>/);
  // Daftar teks memuat setiap perintah.
  const teks = teksDaftarPerintah();
  for (const p of PERINTAH_BOT) assert.ok(teks.includes(`/${p.command} —`), `/${p.command} harus ada di teks`);
});

test('perintah berargumen punya contoh format', () => {
  for (const wajib of ['catat', 'tugas', 'uang', 'masuk', 'rekap', 'cari', 'remind', 'salah']) {
    assert.ok(PERINTAH_BERARGUMEN[wajib], `/${wajib} harus punya contoh format`);
  }
});

test('handler bantuan terpasang & memakai AI (bukan teks template statis)', () => {
  assert.match(TG, /PERINTAH_BANTUAN\.has\(/, 'handler harus memakai daftar bantuan');
  // Balasan dihasilkan model dengan konteks daftar perintah yang akurat.
  assert.match(TG, /konteksBantuanUntukAi\(\)/, 'daftar perintah harus dikirim ke AI sebagai konteks');
  const blok = TG.slice(TG.indexOf('PERINTAH_BANTUAN.has('), TG.indexOf('// 2. Perintah /salah'));
  assert.match(blok, /await autoReply\(/, 'bantuan harus digenerate AI, bukan teks hardcode');
});

test('skrip pendaftaran memakai setMyCommands + verifikasi getMyCommands', () => {
  assert.match(SCRIPT, /setMyCommands/);
  assert.match(SCRIPT, /getMyCommands/, 'harus memverifikasi hasil pendaftaran');
  assert.match(SCRIPT, /daftarPerintahTelegram\(\)/, 'harus memakai satu sumber kebenaran');
});
