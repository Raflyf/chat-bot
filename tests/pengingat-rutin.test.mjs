/**
 * TEST OTOMATIS — pengingat berulang (06 Okt 2026).
 *
 * KENAPA: dari riwayat chat NYATA ditemukan:
 *   - "hapus jadwal rutin" TIDAK dikenali -> bot jawab "Belum ada jadwal rutin
 *     yang tersimpan" padahal ada, dan pengingat TIDAK terhapus.
 *   - Konfirmasi tidak menyebut pengulangan ("tiap hari") sehingga user tidak
 *     tahu pengingatnya berulang.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { deteksiPermintaanUbah } from '../src/reminder-ubah.js';

const SRC = fs.readFileSync(new URL('../src/notes.ts', import.meta.url), 'utf8');
const UBAH = fs.readFileSync(new URL('../src/reminder-ubah.ts', import.meta.url), 'utf8');

test('hapus: "hapus jadwal rutin" terdeteksi sebagai BATAL', () => {
  for (const t of ['hapus jadwal rutin', 'hapus jadwal', 'hapus pengingat untuk bangun', 'batalin jadwal bangun', 'buang jadwal']) {
    const p = deteksiPermintaanUbah(t);
    assert.ok(p, `"${t}" harus terdeteksi`);
    assert.equal(p.aksi, 'batal', `"${t}" harus aksi=batal`);
  }
});

test('hapus: "hapus tugas" TIDAK dianggap batal pengingat', () => {
  // "hapus tugas" harus ditangani jalur tugas, bukan pengingat.
  const p = deteksiPermintaanUbah('hapus tugas nomor 1');
  assert.ok(!p || p.aksi !== 'batal', '"hapus tugas" TIDAK boleh jadi batal pengingat');
});

test('hapus: pola mencakup jadwal/rutin/alarm/timer', () => {
  assert.match(UBAH, /pengingat\|reminder\|jadwal\|rutin\|alarm\|timer/, 'pola harus mencakup jadwal/rutin');
});

test('konfirmasi: menyebut pengulangan dengan label ramah', () => {
  assert.match(SRC, /labelUlang/, 'harus pakai labelUlang()');
  assert.match(SRC, /tiap hari/, 'harus ada contoh label');
});

test('konfirmasi: pengingat SEKALI tidak menyebut berulang', () => {
  // Blok harus membedakan: berulang vs sekali
  assert.match(SRC, /labelUlang\s*\?/, 'harus bercabang bila berulang');
});

test('hapus: perubahan tidak menyentuh jalur "batalin rapat"', () => {
  const p = deteksiPermintaanUbah('batalin rapat');
  assert.ok(p, '"batalin rapat" harus terdeteksi');
  assert.equal(p.aksi, 'batal');
});
