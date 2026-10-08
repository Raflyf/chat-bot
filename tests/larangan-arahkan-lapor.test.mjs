/**
 * TEST OTOMATIS — bot DILARANG mengarahkan user ke form laporan (08 Okt 2026).
 *
 * PERMINTAAN PEMILIK PRODUK: "tidak usah membuat bot menyarankan atau
 * mengarahkan user".
 *
 * Jadi: form laporan tetap ADA di landing page + deskripsi profil bot, tetapi
 * BOT tidak boleh menyebutkannya dalam percakapan.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { sanitizeAssistantOutput } from '../src/skills.js';

const SK = fs.readFileSync(new URL('../src/skills.ts', import.meta.url), 'utf8');

const bersihkan = (bot) => sanitizeAssistantOutput(bot, 'bot kamu ngaco', [], false, false, false, null);

test('bot: ajakan melapor dibuang', () => {
  for (const t of [
    'Maaf ya, coba laporkan ke pengelola biar diperbaiki',
    'Kalau masih ngaco, buka free-chatbot-ai.vercel.app ya',
    'Silakan isi form laporan di halaman depan',
    'Coba tempel tangkapan layarnya di form ya',
  ]) {
    assert.equal(bersihkan(t).trim(), '', `"${t}" harus dikosongkan`);
  }
});

test('bot: balasan normal TIDAK terpengaruh', () => {
  for (const t of [
    'Waduh maaf, aku salah paham tadi. Coba jelasin lagi ya',
    'Haha iya, aku juga bingung tadi. Gimana ceritanya?',
  ]) {
    assert.ok(bersihkan(t).trim().length > 5, `"${t}" harus dibiarkan`);
  }
});

test('prompt: ada larangan eksplisit mengarahkan user', () => {
  assert.ok(SK.includes('DILARANG menyarankan atau mengarahkan user'), 'harus ada larangan di prompt');
});

test('prompt: TIDAK ada lagi instruksi menyebut landing page', () => {
  // Instruksi lama "JIKA ADA MASALAH PADA JAWABANMU ... arahkan user melaporkannya"
  // sudah dihapus.
  assert.ok(!SK.includes('lalu arahkan user melaporkannya'), 'instruksi lama harus dihapus');
});

test('penegak kode: ada penyaring ajakan lapor', () => {
  assert.ok(SK.includes('kataAjakLapor'), 'harus ada penanda ajakan');
  assert.ok(SK.includes('kataTempelSs'), 'harus ada penanda tempel screenshot');
});
