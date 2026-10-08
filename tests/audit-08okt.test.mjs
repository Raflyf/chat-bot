/**
 * TEST OTOMATIS — audit dataset 08 Okt 2026.
 *
 * LAPORAN PEMILIK PRODUK: "liat logika nya jelek banget, malah bentrok dengan
 * fitur pemasukan dan pengeluaran jadi rusak".
 *
 * TEMUAN:
 *  1. "Aku pengen juga beli tas bentuk boneka... aku udh punya 1" -> "Pengeluaran Rp1"
 *  2. Pesan panjang multi-nominal -> hanya 1 item, 1 kind (BENTROK masuk/keluar)
 *  3. "Bores reset semua percakapan kita" -> TIDAK dikenali reset
 *  4. "hapus semua tugas" -> bot mengaku hapus padahal tidak
 *  5. Nominal salah ambil (tanggal "4" jadi Rp4, bukan 2.550.000)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deteksiNiat, deteksiNiatImplisit, parseNominal, pecahItemKeuangan } from '../src/notes.js';
import { isResetCommand } from '../src/memory.js';

test('Rp1: jumlah barang TIDAK jadi nominal', () => {
  const t = 'Aku pengen juga beli tas bentuk boneka lagi? Sebelumnya aku udh punya 1, anak gajah bentuknya';
  assert.equal(deteksiNiat(t) || deteksiNiatImplisit(t), null, 'tidak boleh dicatat');
});

test('nominal: ambil angka TERBESAR, bukan tanggal', () => {
  assert.equal(parseNominal('aku gajian tanggal 4 oktober sebesar 2.550.000'), 2550000, 'harus 2.550.000');
});

test('multi-item: pesan campuran -> pemasukan & pengeluaran TERPISAH', () => {
  // Teks asli dari dataset (memuat kata "bantu" yang menandakan permintaan catat).
  const panjang = 'Bores bantu aku ya untuk hitung pengeluaran aku. Jadi aku gajian tanggal 4 oktober sebesar 2.550.000, dapat tunjangan makan 550.000, dan profit jualan 1.000.000, uang nya sudah aku pakai untuk kosan 500 rb, aku tf ke ortu 600 rb';
  const n = deteksiNiatImplisit(panjang);
  assert.ok(n, 'harus terdeteksi');
  const items = n?.data?.items;
  assert.ok(items && items.length >= 4, `harus >=4 item (dapat ${items?.length})`);
  const masuk = items.filter((x) => x.kind === 'in');
  const keluar = items.filter((x) => x.kind === 'out');
  assert.ok(masuk.length >= 3, 'harus ada pemasukan (gaji/tunjangan/profit)');
  assert.ok(keluar.length >= 2, 'harus ada pengeluaran (kosan/tf ortu)');
});

test('multi-item: "tunjangan makan" = PEMASUKAN (bukan pengeluaran)', () => {
  const panjang = 'dapat tunjangan makan 550.000, kosan 500 rb';
  const n = deteksiNiatImplisit(panjang);
  const items = n?.data?.items;
  const tunjangan = items?.find((x) => x.amount === 550000);
  assert.equal(tunjangan?.kind, 'in', 'tunjangan = pemasukan');
});

test('pecah: pesan panjang terpecah per item', () => {
  const panjang = 'gajian 2.550.000, tunjangan makan 550.000, kosan 500 rb, tf ortu 600 rb, beli kuota 47 rb';
  const items = pecahItemKeuangan(panjang);
  assert.ok(items.length >= 5, `harus >=5 item (dapat ${items.length})`);
});

test('reset: bahasa alami dikenali', () => {
  assert.equal(isResetCommand('Bores reset semua percakapan kita. Mulai dari awal'), true);
  assert.equal(isResetCommand('reset semua percakapan kita'), true);
  assert.equal(isResetCommand('hapus riwayat chat'), true);
  assert.equal(isResetCommand('/reset'), true);
});

test('reset: obrolan biasa TIDAK memicu', () => {
  assert.equal(isResetCommand('aku capek hari ini'), false);
  assert.equal(isResetCommand('hapus tugas 1'), false);
  assert.equal(isResetCommand('reset password gimana'), false);
});
