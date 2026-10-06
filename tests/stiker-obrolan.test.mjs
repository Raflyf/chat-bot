/**
 * TEST OTOMATIS — perbaikan stiker & obrolan gaul (06 Okt 2026).
 *
 * KENAPA: dari screenshot nyata:
 *   - "Lu harus paksa gue baru gue mau jawab" salah dicatat jadi TUGAS
 *   - Stiker bertulisan "SATIR / SAYANG PADAMU TIADA AKHIR" dijawab
 *     "tulisan kecil susah kebaca" -> user kesal "Mata lu mines ya"
 *   - Stiker kucing pegang mawar (ekspresi datar) dijawab "kucingnya sampe kaget"
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { deteksiNiat, deteksiNiatImplisit } from '../src/notes.js';

const SRC = fs.readFileSync(new URL('../src/notes.ts', import.meta.url), 'utf8');
const SK = fs.readFileSync(new URL('../src/skills.ts', import.meta.url), 'utf8');

test('obrolan: "Lu harus paksa gue..." TIDAK jadi tugas', () => {
  for (const t of [
    'Lu harus paksa gue baru gue mau jawab',
    'Gue ga mau jawab',
    'kamu harus tau personality aku',
    'lu harus gitu dong',
    'kamu harus bisa',
  ]) {
    const n = deteksiNiat(t) || deteksiNiatImplisit(t);
    assert.equal(n, null, `"${t}" TIDAK boleh jadi tugas`);
  }
});

test('obrolan: tugas SUNGGUHAN tetap terdeteksi', () => {
  for (const t of ['tambah tugas beli susu', 'harus beli galon', 'aku perlu bayar pajak']) {
    const n = deteksiNiat(t) || deteksiNiatImplisit(t);
    assert.ok(n, `"${t}" harus tetap terdeteksi sebagai tugas`);
  }
});

test('stiker: ada penegak anti-"mengaku tak bisa baca"', () => {
  assert.match(SK, /mengakuTakBisaBaca/, 'harus ada penegak');
  assert.ok(SK.includes('susah\\s+(?:dibaca|kebaca)'), 'harus tangkap "susah dibaca"');
});

test('stiker: prompt melarang bilang tulisan kecil/tidak kebaca', () => {
  assert.ok(SK.includes('DILARANG KERAS bilang tulisan stiker "kecil"'), 'harus ada larangan');
});

test('stiker: prompt melarang menebak ekspresi yang tidak terlihat', () => {
  assert.ok(SK.includes('DILARANG MENEBAK EKSPRESI/EMOSI YANG TIDAK TERLIHAT'), 'harus ada larangan');
  assert.ok(SK.includes('mata datar = datar/santai, bukan kaget'), 'harus beri contoh');
});

test('stiker: batas panjang balasan 120 -> 200', () => {
  assert.ok(SK.includes('reply.length > 200'), 'batas harus 200');
  assert.ok(!SK.includes('reply.length > 120'), 'batas lama 120 harus hilang');
});

test('stiker: tidak lagi memotong ke 1 kalimat saja', () => {
  assert.ok(SK.includes('sentences.slice(0, 2)'), 'harus 2 kalimat');
});
