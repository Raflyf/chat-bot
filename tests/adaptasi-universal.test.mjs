/**
 * TEST OTOMATIS — adaptasi UNIVERSAL, bukan tambal sulam (09 Okt 2026).
 *
 * PERTANYAAN PEMILIK PRODUK: "itutuh perbaikan secara universal kan? bukan fokus
 * ke 2 poin yg saya suruh doang?"
 *
 * Temuan uji dengan CONTOH BARU (bukan yang disebut user): aturan prompt memang
 * universal, TETAPI deteksi berbasis regex TIDAK — mis. user frustrasi
 * ("dari tadi jawabanmu muter-muter, aku sudah tidak sabar") tidak tertangkap
 * karena pola hanya memuat hinaan (dongo/goblok/ngaco).
 *
 * DIPERBAIKI: (1) pola frustrasi diperluas; (2) instruksi agar model MEMBACA
 * SENDIRI suasana, tidak menunggu penanda sistem.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseWaktuAlami, deteksiNiatImplisit, deteksiPertanyaan } from '../src/notes.js';
import { deteksiFaktaPersonal } from '../src/user_facts.js';

const SK = fs.readFileSync(new URL('../src/skills.ts', import.meta.url), 'utf8');

test('universal: TANGGAL berbagai gaya (bukan hanya contoh user)', () => {
  const base = new Date('2026-10-09T01:00:00Z');
  const kasus = [
    ['1 november 2026 jam 9', '2026-11-01'],
    ['20 des 2026 pukul 14', '2026-12-20'],
    ['5 Januari 2027', '2027-01-05'],
    ['15 Feb 2026 jam 10.30', '2026-02-15'],
    ['28 maret 2027 pukul 8', '2027-03-28'],
  ];
  for (const [t, harap] of kasus) {
    const w = parseWaktuAlami(t, base);
    assert.ok(w, `"${t}" harus diparse`);
    const d = new Date(w).toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' });
    assert.equal(d, harap, `"${t}" -> ${d} (harap ${harap})`);
  }
});

test('universal: JADWAL kegiatan apa pun tersimpan (bukan hanya badminton)', () => {
  const base = new Date('2026-10-09T01:00:00Z');
  const kasus = [
    'ujian akhir semester 15 november 2026 jam 8 pagi di gedung A',
    'rapat koordinasi tim senin 12 oktober jam 10',
    'kontrol dokter gigi 20 nov 2026 pukul 15',
    'wawancara kerja 18 desember 2026 jam 9 pagi',
    'arisan keluarga 25 oktober jam 7 malam',
  ];
  for (const t of kasus) {
    const n = deteksiNiatImplisit(t);
    assert.ok(n, `"${t}" harus terdeteksi sebagai jadwal`);
    assert.ok(n.data.pengingat === true, `"${t}" harus jadi pengingat`);
  }
});

test('universal: TUGAS vs KEUANGAN konsisten', () => {
  assert.equal(deteksiPertanyaan('daftar tugas aku apa aja'), 'tugas');
  assert.equal(deteksiPertanyaan('lihat kegiatan aku'), 'tugas');
  assert.equal(deteksiPertanyaan('tampilkan todo list'), 'tugas');
  assert.equal(deteksiPertanyaan('rekap pengeluaran bulan ini'), 'keuangan');
  assert.equal(deteksiPertanyaan('berapa total uang aku'), 'keuangan');
});

test('universal: fakta sah gaya apa pun tersimpan', () => {
  const sah = [
    ['namaku Andi', 'nama'], ['panggil aku Rara', 'nama'],
    ['aku suka kopi hitam', 'kesukaan'], ['aku kerja di bank', 'pekerjaan'],
    ['aku kuliah di UI', 'pekerjaan'], ['aku biasa bangun jam 5 pagi', 'kebiasaan'],
  ];
  for (const [t, kat] of sah) {
    const f = deteksiFaktaPersonal(t);
    assert.ok(f, `"${t}" harus terdeteksi`);
    assert.equal(f.kategori, kat, `"${t}" kategori ${kat}`);
  }
});

test('universal: sampah gaya apa pun ditolak', () => {
  const tolak = [
    'aku suka buah apa', 'kamu tau ga aku suka apa', 'nama gue kan',
    'aku kerja biar ga pegel', 'aku biasa nya mau beli mereka semua',
    'aku suka kamu', 'sepertinya aku suka dia', 'aku dulu suka main bola',
  ];
  for (const t of tolak) {
    assert.equal(deteksiFaktaPersonal(t), null, `"${t}" jangan jadi fakta`);
  }
});

test('universal: pola FRUSTRASI diperluas (bukan hanya hinaan)', () => {
  // Temuan: "dari tadi jawabanmu muter-muter, aku sudah tidak sabar" tidak
  // tertangkap karena pola hanya memuat hinaan.
  assert.ok(SK.includes('muter'), 'pola harus memuat muter-muter');
  assert.ok(SK.includes('tidak') && SK.includes('sabar'), 'pola harus memuat tidak sabar');
  assert.ok(SK.includes('kesekian') || SK.includes('ketiga'), 'pola harus memuat keluhan berulang');
});

test('universal: instruksi BACA SUASANA SENDIRI ada', () => {
  // Aturan prompt berlaku universal; deteksi regex tidak mungkin lengkap.
  // Karena itu model WAJIB menilai suasana sendiri.
  assert.ok(SK.includes('BACA SUASANA SENDIRI'), 'harus ada instruksi baca suasana sendiri');
  assert.ok(SK.includes('jangan menunggu instruksi khusus'), 'harus tegaskan jangan menunggu penanda');
});
