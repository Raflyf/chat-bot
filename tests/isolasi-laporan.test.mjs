/**
 * TEST OTOMATIS — ISOLASI LAPORAN dari memori bot (08 Okt 2026).
 *
 * PERMINTAAN PEMILIK PRODUK:
 *   "apakah bot nya bisa melihat keluhan yg masuk di chat bot nya? dan memahami
 *    apa keluhannya?" + "tapi jangan sampai bot nya jadi tercemar gara gara
 *    memori keluhan itu"
 *
 * JAWABAN YANG DIKUNCI TEST INI:
 *  1. Bot TIDAK membaca tabel `laporan` di jalur percakapan (src/) — sehingga
 *     laporan TIDAK PERNAH masuk konteks model = mustahil tercemar.
 *  2. Keluhan yang DITULIS LANGSUNG DI CHAT tetap terbaca (lewat tabel
 *     `messages`) — itu wajar, karena memang percakapan.
 *  3. Pemahaman keluhan dilakukan TERPISAH: analisis AI di api/laporan.ts,
 *     hasilnya hanya ke kolom `analisis` + notifikasi pemilik.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = new URL('../', import.meta.url);
const SRC_DIR = new URL('../src/', import.meta.url);

/** Semua berkas .ts di src/ digabung. */
function semuaSrc() {
  const hasil = [];
  const walk = (dir) => {
    for (const nama of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, nama.name);
      if (nama.isDirectory()) walk(p);
      else if (nama.name.endsWith('.ts')) hasil.push(fs.readFileSync(p, 'utf8'));
    }
  };
  walk(SRC_DIR.pathname.replace(/^\//, '').replace(/\//g, path.sep));
  return hasil.join('\n');
}

test('ISOLASI: tidak ada kode di src/ yang membaca tabel laporan', () => {
  const gabung = semuaSrc();
  // Pola pembacaan Supabase: .from('laporan')
  const baca = /\.from\(\s*['"`]laporan['"`]\s*\)/g;
  const ketemu = gabung.match(baca) || [];
  assert.equal(
    ketemu.length,
    0,
    `src/ TIDAK boleh membaca tabel laporan (ditemukan ${ketemu.length}x) — ` +
      'laporan akan mencemari memori/persona bot.',
  );
});

test('ISOLASI: getContext hanya membaca messages, summaries, corrections', () => {
  const mem = fs.readFileSync(new URL('../src/memory.ts', import.meta.url), 'utf8');
  assert.ok(mem.includes("from('messages')"), 'harus baca messages');
  assert.ok(mem.includes("from('summaries')"), 'harus baca summaries');
  assert.ok(mem.includes("from('corrections')"), 'harus baca corrections');
  assert.ok(!/\.from\(\s*['"`]laporan['"`]/.test(mem), 'getContext TIDAK boleh baca laporan');
});

test('ISOLASI: ada peringatan eksplisit di memory.ts', () => {
  const mem = fs.readFileSync(new URL('../src/memory.ts', import.meta.url), 'utf8');
  assert.ok(mem.includes('ISOLASI MEMORI'), 'harus ada penanda ISOLASI MEMORI');
  assert.ok(mem.includes('tercemar'), 'harus jelaskan alasan (jangan tercemar)');
});

test('ANALISIS: api/laporan.ts menganalisis keluhan lewat AI', () => {
  const api = fs.readFileSync(new URL('../api/laporan.ts', import.meta.url), 'utf8');
  assert.ok(api.includes('analisisKeluhan'), 'harus ada fungsi analisisKeluhan');
  assert.ok(api.includes('dynamicNotice'), 'harus pakai model AI');
  assert.ok(api.includes('analisis'), 'hasil analisis harus disimpan');
});

test('ANALISIS: analisis TIDAK ditulis ke memori (messages/corrections)', () => {
  const api = fs.readFileSync(new URL('../api/laporan.ts', import.meta.url), 'utf8');
  // api/laporan.ts boleh menulis ke `laporan`, tapi TIDAK ke messages/corrections.
  assert.ok(!/\.from\(\s*['"`]corrections['"`]\s*\)\s*\.insert/.test(api), 'jangan tulis ke corrections');
  assert.ok(!/\.from\(\s*['"`]messages['"`]\s*\)\s*\.insert/.test(api), 'jangan tulis ke messages');
});

test('ISOLASI: jaminan tertulis di api/laporan.ts', () => {
  const api = fs.readFileSync(new URL('../api/laporan.ts', import.meta.url), 'utf8');
  assert.ok(api.includes('ISOLASI TOTAL'), 'harus ada jaminan ISOLASI TOTAL');
  assert.ok(api.includes('JANGAN pernah menambahkan kode yang membaca tabel'), 'harus ada aturan untuk pengembang');
});
