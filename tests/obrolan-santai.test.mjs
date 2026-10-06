/**
 * TEST OTOMATIS — perbaikan obrolan santai (06 Okt 2026).
 *
 * KENAPA: dari riwayat chat NYATA ditemukan:
 *   - Bot menyuruh user pergi saat kesal ("Pergi aja")
 *   - "gaul dimana" (retoris) memicu tanya lokasi
 *   - Bot nyolot/menyindir ke user
 *   - Bot terus mengeledek walau user marah
 *   - Bot mengarang konteks ("Baru sewa apa emang? Kok udah PAGI")
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { butuhLokasiAtauWaktu } from '../src/user-profile.js';

const SRC = fs.readFileSync(new URL('../src/notes.ts', import.meta.url), 'utf8');
const SK = fs.readFileSync(new URL('../src/skills.ts', import.meta.url), 'utf8');

// ── 1. "dimana" RETORIS TIDAK MEMICU TANYA LOKASI ──
test('lokasi: "gaul dimana" TIDAK memicu tanya lokasi', () => {
  for (const t of ['Emang kamu gaul dimana', 'kamu gaul dimana', 'lagi dimana', 'ini dimana', 'dimana rumahmu']) {
    assert.equal(butuhLokasiAtauWaktu(t), false, `"${t}" TIDAK boleh tanya lokasi`);
  }
});

test('lokasi: pertanyaan lokasi NYATA tetap memicu', () => {
  assert.equal(butuhLokasiAtauWaktu('kamu tinggal dimana'), true);
  assert.equal(butuhLokasiAtauWaktu('cuaca hari ini'), true);
  assert.equal(butuhLokasiAtauWaktu('ingatkan besok jam 9'), true);
});

// ── 2. ATURAN EMPATI SAAT USER KESAL ──
test('kesal: prompt melarang menyuruh user pergi', () => {
  assert.match(SK, /DILARANG menyuruh dia pergi/, 'harus ada larangan menyuruh pergi');
  assert.match(SK, /UNGKAPAN EMOSI, bukan permintaan izin/, 'harus jelaskan konteks emosi');
});

test('kesal: prompt melarang nyolot/menyindir', () => {
  assert.match(SK, /DILARANG NYOLOT/, 'harus ada larangan nyolot');
});

test('kesal: prompt melarang mengeledek saat diminta berhenti', () => {
  assert.match(SK, /DILARANG KERAS MENGELEDEK/, 'harus ada larangan mengeledek');
  assert.match(SK, /HENTIKAN semua ledekan PERMANEN/, 'harus ada aturan berhenti permanen');
});

test('kesal: prompt melarang mengulang hinaan user', () => {
  assert.match(SK, /DILARANG mengulang kata hinaan/, 'harus ada larangan mengulang hinaan');
});

// ── 3. ANTI-MENGARANG KONTEKS ──
test('konteks: prompt melarang mengarang dari satu kata', () => {
  assert.match(SK, /DILARANG MENGARANG KONTEKS BARU DARI SATU KATA/, 'harus ada larangan');
  assert.match(SK, /"PAGI!"/, 'harus sebutkan contoh nyata');
});

test('konteks: prompt atur saat user bilang "ulangi"', () => {
  assert.match(SK, /meminta "ulangi"/, 'harus ada aturan untuk "ulangi"');
});

// ── 4. PENEGAK KODE ANTI-LEDEK ──
test('kode: ada penegak anti-ledek saat user marah', () => {
  assert.match(SK, /userMintaStopLedek/, 'harus ada deteksi user minta stop ledek');
  assert.match(SK, /ledekRe/, 'harus ada pola ledekan');
});

// ── 5. TEBAKAN BUKAN PERTANYAAN PENGETAHUAN UMUM ──
test('tebakan: prompt melarang pertanyaan pengetahuan umum', () => {
  assert.match(SK, /WAJIB BERBENTUK TEKA-TEKI, BUKAN PERTANYAAN PENGETAHUAN UMUM/, 'harus ada aturan');
  assert.match(SK, /Kenapa wortel baik untuk mata/, 'harus sebutkan contoh salah');
});

test('tebakan: kode deteksi tebakan palsu', () => {
  assert.match(SK, /tebakanPalsu/, 'harus ada penegak tebakan palsu');
});

// ── 6. KELUAR MODE TEBAKAN SAAT USER MENOLAK ──
test('tebakan: user menolak -> keluar mode', () => {
  assert.match(SK, /userMenolakTebakan/, 'harus ada deteksi penolakan');
  assert.match(SK, /Gausa tebak tebakan/, 'harus sebutkan contoh nyata');
});

// ── 7. EMOJI DITUNDA, BUKAN DIHAPUS ──
test('emoji: ditunda berdasarkan suasana (bukan dihapus)', () => {
  assert.match(SK, /batasiEmojiLintasPesan/, 'harus ada fungsi pembatas emoji');
  assert.match(SK, /jangan di hilangkan, tapi di minimalisir berdasarkan suasana/, 'harus sesuai permintaan pemilik');
  // Balasan pendek tetap boleh 1 emoji
  assert.match(SK, /kataCount <= 8 && jumlahEmoji <= 1/, 'balasan pendek boleh 1 emoji');
});

// ── 8. TAWARAN LANJUTAN DIBUANG ──
test('tawaran: "Lanjut?" dan "kamu pilih" dibuang', () => {
  assert.match(SK, /Mau lanjut tebak-tebakan/, 'harus tangani tawaran lanjutan');
  assert.match(SK, /lanjut\|lanjutkan\|continue/, 'harus tangani "Lanjut?" berdiri sendiri');
});

// ── 9. PERMINTAAN LOKASI DISIMPAN KE DB ──
test('lokasi: permintaan tertunda disimpan ke database', () => {
  assert.match(SRC, /pending_confirmations/, 'harus pakai tabel DB (bukan hanya memori)');
  assert.match(SRC, /_tunggu_zona/, 'harus ada penanda');
});
