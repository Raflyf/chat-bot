/**
 * TEST OTOMATIS — nomor tugas per-user (06 Okt 2026).
 *
 * KENAPA: laporan pemilik produk — "kenapa baru menambahkan tugas satu tapi
 * sudah #13?"
 * SEBAB: kolom `id` adalah SERIAL global; tugas pertama user bisa ber-ID #13
 * karena tugas lain (yang sudah dihapus) menaikkan counter.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Replikasi logika pemberian nomor (di daftarTugas)
function beriNomor(rows) {
  return rows.map((t, i) => ({ ...t, nomor: i + 1 }));
}

test('nomor: tugas pertama selalu #1 (walau id global #13)', () => {
  const hasil = beriNomor([{ id: 13, task: 'upload jurnal' }]);
  assert.equal(hasil[0].nomor, 1);
  assert.equal(hasil[0].id, 13, 'id asli tetap disimpan untuk operasi DB');
});

test('nomor: urutan 1,2,3 meski id melompat', () => {
  const hasil = beriNomor([
    { id: 3, task: 'a' }, { id: 13, task: 'b' }, { id: 47, task: 'c' },
  ]);
  assert.deepEqual(hasil.map((x) => x.nomor), [1, 2, 3]);
  assert.deepEqual(hasil.map((x) => x.id), [3, 13, 47]);
});

test('nomor: stabil setelah tugas selesai (tidak renumber)', () => {
  // Semua tugas (termasuk yang selesai) ikut dihitung -> nomor tidak bergeser
  const semua = [
    { id: 3, task: 'a', status: 'done' },
    { id: 13, task: 'b', status: 'open' },
  ];
  const bernomor = beriNomor(semua);
  const tampil = bernomor.filter((t) => t.status === 'open');
  assert.equal(tampil[0].nomor, 2, 'tugas open tetap #2 walau #1 sudah selesai');
});

test('nomor: konversi nomor -> id asli benar', () => {
  const semua = [{ id: 3 }, { id: 13 }, { id: 47 }];
  const idDariNomor = (n) => (n >= 1 && n <= semua.length ? semua[n - 1].id : null);
  assert.equal(idDariNomor(1), 3);
  assert.equal(idDariNomor(2), 13);
  assert.equal(idDariNomor(3), 47);
  assert.equal(idDariNomor(4), null, 'nomor di luar rentang -> null');
  assert.equal(idDariNomor(0), null);
});

test('nomor: konversi id -> nomor benar', () => {
  const semua = [{ id: 3 }, { id: 13 }, { id: 47 }];
  const nomorDariId = (id) => {
    const idx = semua.findIndex((t) => t.id === id);
    return idx >= 0 ? idx + 1 : null;
  };
  assert.equal(nomorDariId(3), 1);
  assert.equal(nomorDariId(13), 2);
  assert.equal(nomorDariId(47), 3);
  assert.equal(nomorDariId(999), null);
});
