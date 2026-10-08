/**
 * TEST OTOMATIS — audit lanjutan 08 Okt 2026.
 *
 * PERTANYAAN PEMILIK PRODUK: "apakah bot AI bisa tau pesan auto reply yg terkirim
 * ke user sehingga bot bisa ngerti masalah nya atau malah tidak tahu?"
 *   -> YA, auto-reply disimpan ke `messages` dengan via `notes/<jalur>`, jadi
 *      masuk konteks AI. Test di bawah mengunci perilaku ini.
 *
 * TEMUAN LAIN:
 *  1. Pesan user diproses 2x (msg_id berbeda) -> data keuangan DUPLIKAT
 *  2. "Jadi pendapatan dan pengeluaran berapa" TIDAK ter-trigger rekap
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { deteksiPertanyaan } from '../src/notes.js';

const DB = fs.readFileSync(new URL('../src/db.ts', import.meta.url), 'utf8');
const WA = fs.readFileSync(new URL('../src/whatsapp_cloud.ts', import.meta.url), 'utf8');
const TG = fs.readFileSync(new URL('../src/telegram.ts', import.meta.url), 'utf8');
const BL = fs.readFileSync(new URL('../src/whatsapp_baileys.ts', import.meta.url), 'utf8');

test('auto-reply DISIMPAN ke riwayat di 3 platform (AI tahu)', () => {
  assert.match(WA, /via: `notes\/\$\{hasil\.jalur\}`/, 'WA Cloud harus simpan via notes/');
  assert.match(TG, /via: `notes\/\$\{hasilCatat\.jalur\}`/, 'Telegram harus simpan via notes/');
  // Baileys: cek menyimpan balasan notes
  assert.match(BL, /notes\/\$\{/, 'Baileys harus simpan via notes/');
});

test('dedup: berbasis KONTEN (bukan hanya msg_id)', () => {
  assert.ok(DB.includes('DEDUP BERBASIS KONTEN'), 'harus ada dedup konten');
  assert.match(DB, /eq\('content', content\.slice/, 'harus bandingkan konten');
  assert.ok(DB.includes('JENDELA_MS'), 'harus ada jendela waktu');
  assert.ok(DB.includes("neq('msg_id', msgId)"), 'harus msg_id berbeda');
});

test('pertanyaan keuangan: ter-trigger untuk kalimat nyata', () => {
  for (const t of [
    'Jadi pendapatan dan pengeluaran berapa',
    'Di kurangi sama pengeluaran aku jadi berapa',
    'hitung pendapatan dan pengeluaran aku',
    'rekap keuangan aku',
    'berapa pengeluaranku',
  ]) {
    assert.equal(deteksiPertanyaan(t), 'keuangan', `"${t}" harus keuangan`);
  }
});

test('pertanyaan keuangan: obrolan biasa TIDAK ter-trigger', () => {
  for (const t of ['aku capek hari ini', 'kamu lagi apa', 'aku sayang kamu', 'haha lucu']) {
    assert.equal(deteksiPertanyaan(t), null, `"${t}" jangan ter-trigger`);
  }
});
