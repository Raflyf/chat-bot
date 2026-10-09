/**
 * TEST OTOMATIS — noise catatan dibersihkan (09 Okt 2026).
 *
 * LAPORAN PEMILIK PRODUK: user menulis
 *   "masukin ke watchlist movie ku, documentary: in the name of god"
 * tetapi yang TERSIMPAN:
 *   "ke watchlist movie ku, documentary: in the name of god"
 * NOISE frasa tujuan ("ke watchlist movie ku") ikut terbawa — padahal user hanya
 * ingin JUDUL FILM-nya dicatat.
 *
 * AKAR (3 tempat):
 *  1. Cabang (d) di `deteksiNiatImplisit` mengambil isi MENTAH tanpa
 *     `bersihkanIsi()` — padahal cabang lain sudah memakainya.
 *  2. `bersihkanIsi()` hanya membuang KATA PERINTAH ("masukin"), bukan FRASA
 *     TUJUAN ("ke watchlist movie ku", "ke daftar belanja", "ke notes").
 *  3. "masukin" (bahasa gaul) tidak ada di `KATA_PERINTAH` — hanya "masukkan".
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deteksiNiat, deteksiNiatImplisit } from '../src/notes.js';

const isi = (t) => {
  const n = deteksiNiat(t) || deteksiNiatImplisit(t);
  return n ? String(n.data.content ?? n.data.message ?? '') : null;
};

test('noise: frasa tujuan "ke watchlist movie ku" dibuang', () => {
  const hasil = isi('masukin ke watchlist movie ku, documentary: in the name of god');
  assert.ok(hasil, 'harus tersimpan sebagai catatan');
  assert.ok(!/watchlist/i.test(hasil), `"ke watchlist" jangan terbawa (dapat: "${hasil}")`);
  assert.match(hasil, /in the name of god/i, 'judul film harus tetap ada');
});

test('noise: "ke daftar belanja:" dibuang', () => {
  const hasil = isi('catat ke daftar belanja: sabun, sampo');
  assert.ok(hasil, 'harus tersimpan');
  assert.ok(!/^ke\s/i.test(hasil), `"ke ..." jangan terbawa (dapat: "${hasil}")`);
  assert.match(hasil, /sabun/i, 'isi belanja harus tetap ada');
});

test('noise: "ke notes:" dibuang', () => {
  const hasil = isi('simpan ke notes: resep rendang');
  assert.ok(hasil, 'harus tersimpan');
  assert.equal(hasil, 'resep rendang');
});

test('noise: isi normal TIDAK rusak', () => {
  // Pastikan pembersihan tidak membuang isi yang memang penting.
  // CATATAN: "catat: beli susu" sengaja TIDAK dipakai di sini — kata "beli"
  // membuatnya dikenali sebagai KEUANGAN (perilaku benar), bukan catatan.
  const kasus = [
    ['catat: jadwal rapat mingguan', /rapat mingguan/i],
    ['simpan: ide konten video', /ide konten video/i],
  ];
  for (const [t, harap] of kasus) {
    const hasil = isi(t);
    assert.ok(hasil, `"${t}" harus tersimpan`);
    assert.match(hasil, harap, `"${t}" isi harus utuh`);
  }
});

test('noise: varian gaul "masukin" dikenali', () => {
  // Sebelumnya hanya "masukkan" (baku) yang ada di KATA_PERINTAH.
  const n = deteksiNiat('masukin ke catatan: beli galon');
  assert.ok(n || deteksiNiatImplisit('masukin ke catatan: beli galon'), '"masukin" harus dikenali');
});
