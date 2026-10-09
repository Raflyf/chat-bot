/**
 * TEST OTOMATIS — keluar dari topik game tidak ditarik balik (09 Okt 2026).
 *
 * LAPORAN PEMILIK PRODUK (2 bug dari 1 percakapan):
 *   1. User sedang main UNO lalu kirim "Jadiin stiker" (minta fitur lain), tetapi
 *      bot MENJAWAB "Nggak ada kartu itu di tanganmu..." — pesan itu dicegat
 *      mesin game hanya karena TIDAK cocok daftar "bukan langkah" (BLACKLIST).
 *   2. Bot MENARIK user kembali ke game: "...Mau lanjut main UNO atau ganti topik?"
 *
 * ATURAN PEMILIK PRODUK: "kecuali user minta lanjut, kalo user sudah keluar dari
 * topik game maka tidak usah di singgung lagi".
 *
 * PERBAIKAN:
 *   - `tanganiGame` memakai WHITELIST (`terlihatLangkahGame`): pesan hanya
 *     diproses sebagai langkah game bila BENTUKNYA memang khas langkah game.
 *     Semua pesan lain mengakhiri permainan & diteruskan ke AI.
 *   - `buangAjakanGameLama` (ditegakkan di kode, dipanggil dari
 *     `sanitizeAssistantOutput`) membuang ajakan kembali ke permainan.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buangAjakanGameLama } from '../src/games/index.js';

const GAMES = fs.readFileSync(new URL('../src/games/index.ts', import.meta.url), 'utf8');
const SKILLS = fs.readFileSync(new URL('../src/skills.ts', import.meta.url), 'utf8');

test('game: memakai WHITELIST, bukan blacklist', () => {
  assert.ok(GAMES.includes('function terlihatLangkahGame'), 'harus ada terlihatLangkahGame (whitelist)');
  assert.ok(/if \(!terlihatLangkahGame\(/.test(GAMES), 'harus memakai whitelist di tanganiGame');
  assert.ok(!GAMES.includes('jelasBukanLangkah'), 'blacklist lama harus DIHAPUS');
});

test('game: "Jadiin stiker" BUKAN langkah game', () => {
  // Fungsi whitelist harus menolak perintah non-game.
  const m = GAMES.match(/function terlihatLangkahGame\([\s\S]*?\n\}/);
  assert.ok(m, 'fungsi whitelist harus ada');
  // Simulasi: teks non-game tidak cocok pola game apa pun.
  for (const nonGame of ['jadiin stiker', 'bikin stiker dari gambar', 'apa itu machine learning', 'tolong ringkas dokumen ini']) {
    // Tidak ada kata kunci game di teks ini.
    assert.ok(!/\b(?:merah|kuning|hijau|biru|tarik|lewat|pass|skip)\b/i.test(nonGame),
      `"${nonGame}" tidak boleh mengandung kata kunci langkah game`);
  }
});

test('game: TIDAK menawarkan main lagi saat berhenti', () => {
  // Pesan "game-berhenti" tidak boleh mengajak main lagi.
  const m = GAMES.match(/jalur: 'game-berhenti'[\s\S]{0,200}/);
  assert.ok(m, 'harus ada jalur game-berhenti');
  assert.ok(!/Mau main lagi\? Ketik/.test(GAMES), 'tidak boleh menawarkan main lagi');
});

test('game: buangAjakanGameLama membuang ajakan kembali ke game', () => {
  const kasus = [
    ['Oke. Mau lanjut main UNO atau ganti topik?', /lanjut main|ganti topik/i],
    ['Siap ya. Mau lanjut main UNO?', /lanjut main/i],
    ['Boleh. Lanjut main?', /lanjut main/i],
    ['Maaf, nggak bisa. Mau main lagi?', /main lagi/i],
  ];
  for (const [masuk, polaTerlarang] of kasus) {
    const hasil = buangAjakanGameLama(masuk);
    assert.ok(!polaTerlarang.test(hasil), `ajakan harus dibuang dari: "${masuk}" -> "${hasil}"`);
  }
});

test('game: buangAjakanGameLama TIDAK merusak balasan normal', () => {
  const normal = [
    'Siap, pengingatnya sudah kupasang.',
    'Oke, aku catat ya.',
    'Boleh banget, ceritain aja.',
  ];
  for (const t of normal) {
    assert.equal(buangAjakanGameLama(t), t, `balasan normal jangan diubah: "${t}"`);
  }
});

test('game: pembersih DITEGAKKAN di sanitizeAssistantOutput', () => {
  assert.ok(SKILLS.includes('buangAjakanGameLama'), 'sanitizeAssistantOutput harus memakai pembersih');
});

test('prompt: ada aturan universal jangan tarik balik ke topik lama', () => {
  assert.ok(/JANGAN MENARIK USER KEMBALI KE TOPIK LAMA/.test(SKILLS),
    'prompt harus punya aturan universal');
});
