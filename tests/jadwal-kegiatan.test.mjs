/**
 * TEST OTOMATIS — jadwal/kegiatan harus TERSIMPAN (09 Okt 2026).
 *
 * LAPORAN PEMILIK PRODUK (bug fatal): user 2166 kirim
 *   "ini jadwal aku. latihan badminton hari Selasa, 13 oct 2026 jam 16.00-19.00 WIB"
 * Bot jawab "Siap, aku catat jadwal latihan badmintonmu..." TETAPI DATABASE KOSONG.
 * Bot BERBOHONG — user sudah minta berkali-kali tapi tidak ada yang tercatat.
 *
 * AKAR (3 bug berlapis):
 *  1. parseWaktuAlami TIDAK punya parser tanggal+bulan+tahun. Pola "13 oct 2026 jam"
 *     justru ditangkap blok JEDA ("2026 jam" = 2026 JAM dari sekarang) sehingga
 *     menghasilkan 1 Januari 2027 — tanggal mustahil.
 *  2. deteksiNiatImplisit tidak menganggap jadwal/kegiatan sebagai sinyal permintaan.
 *  3. Meski sinyalMinta lolos, fungsi hanya punya cabang (a) PENGINGAT dan
 *     (b) KEUANGAN — tidak ada cabang JADWAL, sehingga return null.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseWaktuAlami, deteksiNiatImplisit, deteksiPertanyaan } from '../src/notes.js';

const WIB = 'Asia/Jakarta';
const tgl = (d) => new Date(d).toLocaleDateString('id-ID', { timeZone: WIB, day: 'numeric', month: 'numeric', year: 'numeric' });

test('waktu: tanggal lengkap diparse BENAR (bukan 1 Jan 2027)', () => {
  // Tahun 2026 tidak boleh dibaca sebagai "jam"
  for (const t of ['13 oct 2026 jam 16.00', '13 oktober 2026 jam 16.00', 'Selasa, 13 Oktober 2026 pukul 16.00']) {
    const w = parseWaktuAlami(t, new Date('2026-10-09T01:00:00Z'));
    assert.ok(w, `"${t}" harus diparse`);
    assert.equal(tgl(w), '13/10/2026', `"${t}" -> ${tgl(w)} (harus 13/10/2026)`);
  }
});

test('waktu: tahun 4 digit TIDAK dibaca sebagai jeda jam', () => {
  const w = parseWaktuAlami('rapat 13 oct 2026 jam 16.00', new Date('2026-10-09T01:00:00Z'));
  const tahun = new Date(w).getFullYear();
  assert.ok(tahun === 2026, `tahun harus 2026 (dapat ${tahun}) — "2026 jam" jangan jadi jeda`);
});

test('waktu: rentang tanpa kata "jam" didukung', () => {
  const w = parseWaktuAlami('16.00-19.00 WIB', new Date('2026-10-09T01:00:00Z'));
  assert.ok(w, '"16.00-19.00" harus diparse');
});

test('jadwal: pesan jadwal nyata TERSIMPAN sebagai pengingat', () => {
  const t = 'ini jadwal aku. latihan badminton hari Selasa, 13 oct 2026 jam 16.00-19.00 WIB ya, ditunggu kehadirannya di lapang';
  const n = deteksiNiatImplisit(t);
  assert.ok(n, 'jadwal harus terdeteksi');
  assert.ok(n.data.pengingat === true, 'harus berupa pengingat');
  assert.ok(String(n.data.due_at).startsWith('2026-10-13'), `due_at harus 13 Okt 2026 (dapat ${n.data.due_at})`);
});

test('jadwal: undangan sosialisasi TERSIMPAN', () => {
  const t = 'Assalamualaikum wrwb punten izin menyampaikan sosialisasi pedoman TA 2627: 2. Tingkat 2 senin 12 Oktober pukul 16';
  const n = deteksiNiatImplisit(t);
  assert.ok(n, 'undangan kegiatan harus terdeteksi');
  assert.ok(String(n.data.due_at).startsWith('2026-10-12'), `due_at harus 12 Okt 2026 (dapat ${n.data.due_at})`);
});

test('tanya: "rekap tugas aku" = TUGAS (bukan keuangan)', () => {
  assert.equal(deteksiPertanyaan('rekap tugas aku'), 'tugas');
  assert.equal(deteksiPertanyaan('tolong di rekap semua kegiatan dan tugas aku'), 'tugas');
  assert.equal(deteksiPertanyaan('rekap keuangan aku'), 'keuangan');
});

test('anti-bohong: prompt melarang mengaku mencatat tanpa bukti', () => {
  const sk = fs.readFileSync(new URL('../src/skills.ts', import.meta.url), 'utf8');
  assert.ok(sk.includes('DILARANG MENGAKU sudah mencatat'), 'harus ada larangan mengaku mencatat');
});
