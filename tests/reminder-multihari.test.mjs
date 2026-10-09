/**
 * TEST OTOMATIS — pengingat multi-hari H-N (09 Okt 2026).
 *
 * PERMINTAAN PEMILIK PRODUK:
 *   "reminder setiap 3, 2, 1 hari senelummnya"
 *   "Reminder multi-hari — 'ingatkan 3, 2, 1 hari sebelum' → belum ada fiturnya"
 *
 * SEBELUMNYA: bot menjawab "Maaf, fitur pengingat otomatis belum tersedia di sini.
 * Kamu bisa set alarm manual di HP" — padahal bot SUDAH punya sistem pengingat.
 * Yang belum ada hanya varian "beberapa hari SEBELUM acara".
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { deteksiMultiHari, susunDaftarPengingat } from '../src/reminder-multihari.js';
import { parseWaktuAlami } from '../src/notes.js';

const BASE = new Date('2026-10-09T01:00:00Z');
const parse = (t, s) => parseWaktuAlami(t, s || BASE);
const tgl = (d) => new Date(d).toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' });

test('multi-hari: "3, 2, 1 hari sebelum" dideteksi', () => {
  const m = deteksiMultiHari('ingatkan 3, 2, 1 hari sebelum latihan badminton 13 oktober 2026 jam 16', BASE, parse);
  assert.ok(m, 'harus terdeteksi');
  assert.deepEqual(m.hariSebelum, [3, 2, 1], 'harus H-3, H-2, H-1');
  assert.equal(tgl(m.tanggalAcara), '2026-10-13');
  assert.match(m.namaAcara, /badminton/i);
});

test('multi-hari: notasi H-N didukung', () => {
  const m = deteksiMultiHari('ingetin aku H-3 dan H-1 sebelum ujian 15 november 2026 jam 8 pagi', BASE, parse);
  assert.ok(m, 'harus terdeteksi');
  assert.deepEqual(m.hariSebelum, [3, 1]);
  assert.equal(m.namaAcara, 'ujian');
});

test('multi-hari: "seminggu sebelum" = H-7', () => {
  const m = deteksiMultiHari('ingatkan seminggu sebelum pernikahan 20 desember 2026', BASE, parse);
  assert.ok(m);
  assert.deepEqual(m.hariSebelum, [7]);
});

test('multi-hari: kata angka ("tiga hari") didukung', () => {
  const m = deteksiMultiHari('ingatkan tiga hari sebelumnya kontrol dokter gigi 20 november 2026', BASE, parse);
  assert.ok(m);
  assert.deepEqual(m.hariSebelum, [3]);
});

test('multi-hari: susun pengingat termasuk hari-H', () => {
  const m = deteksiMultiHari('ingatkan 3, 2, 1 hari sebelum rapat 12 oktober 2026 jam 10', BASE, parse);
  const daftar = susunDaftarPengingat(m);
  assert.equal(daftar.length, 4, 'H-3, H-2, H-1 + hari-H');
  // Urut dari paling awal
  const tanggal = daftar.map((d) => tgl(d.due));
  assert.deepEqual(tanggal, ['2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12']);
  assert.match(daftar[3].pesan, /rapat/i, 'pengingat hari-H menyebut nama acara');
  assert.match(daftar[0].pesan, /3 hari lagi/);
  assert.match(daftar[2].pesan, /besok/);
});

test('multi-hari: BUKAN multi-hari ditolak', () => {
  for (const t of ['ingatkan besok jam 9', 'ingatkan aku minum obat', 'apa itu H-3?']) {
    assert.equal(deteksiMultiHari(t, BASE, parse), null, `"${t}" jangan terdeteksi multi-hari`);
  }
});

test('multi-hari: tidak menyentuh prompt/persona', () => {
  // Modul ini HANYA menambah data pengingat — tidak mengubah prompt.
  const modul = fs.readFileSync(new URL('../src/reminder-multihari.ts', import.meta.url), 'utf8');
  assert.ok(!modul.includes('systemPrompt'), 'tidak boleh menyentuh systemPrompt');
  assert.ok(!modul.includes('autoReply'), 'tidak boleh menyentuh autoReply');
});
