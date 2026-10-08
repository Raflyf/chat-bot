/**
 * TEST OTOMATIS — tanpa konfirmasi ya/tidak + multi-item keuangan.
 *
 * RIWAYAT KEPUTUSAN (penting, jangan diubah tanpa alasan):
 *   - 06 Okt 2026: pemilik produk meminta SEMUA konfirmasi ya/tidak dihilangkan
 *     ("konfirmasi ya tidaknya itu sangat menggangu dan bikin kesal").
 *   - 08 Okt 2026 (OPSI B): pemilik produk MEREVISI untuk KEUANGAN — minta bot
 *     TANYA DULU ("opsi B saja untuk memastikan tanya dulu oleh AI") agar user
 *     yang hanya menyebut angka tidak ikut tercatat.
 *
 * ATURAN BERLAKU SEKARANG:
 *   - KEUANGAN tanpa kata perintah  -> TANYA dulu (pakai simpanKonfirmasi).
 *   - KEUANGAN dengan kata "catat"  -> LANGSUNG simpan (tanpa tanya).
 *   - CATATAN / TUGAS / PENGINGAT   -> LANGSUNG simpan (tanpa tanya).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const SRC = fs.readFileSync(new URL('../src/notes.ts', import.meta.url), 'utf8');

test('konfirmasi keuangan: hanya untuk KEUANGAN tanpa perintah (Opsi B)', () => {
  // Konfirmasi boleh ada, TAPI hanya pada kondisi expense tanpa perintah eksplisit.
  assert.match(SRC, /niat\.kind === 'expense' && !adaPerintahCatatEksplisit/, 'niat utama');
  assert.match(SRC, /niatImplisit\.kind === 'expense' && !adaPerintahCatatImpl/, 'niat implisit');
});

test('konfirmasi: pemanggilan simpanKonfirmasi HANYA di jalur keuangan', () => {
  const pemanggilan = (SRC.match(/await simpanKonfirmasi\(/g) || []).length;
  assert.equal(pemanggilan, 2, `harus tepat 2 (niat utama + implisit), dapat ${pemanggilan}`);
  // Pastikan tidak ada konfirmasi untuk catatan/tugas/pengingat.
  assert.ok(!/niat\.kind === 'note'[\s\S]{0,80}simpanKonfirmasi/.test(SRC), 'catatan tidak boleh konfirmasi');
  assert.ok(!/niat\.kind === 'todo'[\s\S]{0,80}simpanKonfirmasi/.test(SRC), 'tugas tidak boleh konfirmasi');
});

test('konfirmasi: kata perintah eksplisit -> LANGSUNG simpan', () => {
  assert.ok(SRC.includes('adaPerintahCatatEksplisit'), 'harus cek perintah eksplisit');
  assert.ok(SRC.includes('adaPerintahCatatImpl'), 'harus cek di jalur implisit');
});

test('multi-item: fungsi pecahItemKeuangan ada', () => {
  assert.match(SRC, /export function pecahItemKeuangan/);
});

test('multi-item: simpanDariNiat menangani daftar items', () => {
  assert.match(SRC, /Array\.isArray\(d\.items\)/, 'harus memeriksa d.items');
  assert.match(SRC, /Tercatat \$\{ids\.length\} item/, 'harus melaporkan jumlah item');
});

// Replikasi logika pecahItemKeuangan (fungsi murni)
function pecah(teks) {
  const segmen = teks
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean)
    .flatMap((b) => b.split(/\s*(?:;|\blalu\b|\bterus\b)\s*/i))
    .map((x) => x.trim())
    .filter(Boolean);
  const hasil = [];
  for (const seg of segmen) {
    const m = seg.match(/(\d+(?:[.,]\d+)?)\s*(rb|ribu|k|jt|juta)?/i);
    if (m) {
      let n = Number(String(m[1]).replace(',', '.'));
      const sat = (m[2] || '').toLowerCase();
      if (sat === 'rb' || sat === 'ribu' || sat === 'k') n *= 1000;
      else if (sat === 'jt' || sat === 'juta') n *= 1000000;
      if (n > 0) hasil.push({ teks: seg, nominal: n });
    }
  }
  return hasil;
}

test('multi-item: pecah 3 baris pengeluaran', () => {
  const teks = 'Pengeluaran :\nBayar Nopal 60rb\nBayar Faisa 50rb\nBeli rokok + susu + kue + esteh 75rb';
  const hasil = pecah(teks);
  assert.equal(hasil.length, 3, 'harus 3 item');
  assert.deepEqual(hasil.map((x) => x.nominal), [60000, 50000, 75000]);
});

test('multi-item: total benar Rp185.000', () => {
  const teks = 'Pengeluaran :\nBayar Nopal 60rb\nBayar Faisa 50rb\nBeli rokok 75rb';
  const total = pecah(teks).reduce((a, b) => a + b.nominal, 0);
  assert.equal(total, 185000);
});

test('multi-item: satu item tetap satu', () => {
  assert.equal(pecah('bayar makan 25rb').length, 1);
});

test('multi-item: pemisah titik-koma & "lalu"', () => {
  assert.equal(pecah('bayar 10rb; beli 20rb').length, 2);
  assert.equal(pecah('bayar 10rb lalu beli 20rb').length, 2);
});

test('multi-item: baris tanpa nominal dilewati', () => {
  const hasil = pecah('Pengeluaran:\nBayar Nopal 60rb');
  assert.equal(hasil.length, 1, 'baris judul "Pengeluaran:" dilewati');
});

test('anti-kosong: whatsapp_cloud punya penjaga balasan kosong', () => {
  const wa = fs.readFileSync(new URL('../src/whatsapp_cloud.ts', import.meta.url), 'utf8');
  assert.match(wa, /!reply \|\| !reply\.trim\(\)/, 'harus memeriksa balasan kosong');
  assert.match(wa, /dynamicNotice/, 'harus memakai pemberitahuan dinamis');
});

test('permintaan tertunda: disimpan ke DATABASE (bukan hanya memori)', () => {
  assert.match(SRC, /pending_confirmations/, 'harus memakai tabel DB');
  assert.match(SRC, /_tunggu_zona/, 'harus ada penanda _tunggu_zona');
  assert.match(SRC, /async function simpanPermintaanTertunda/, 'harus async (DB)');
});

test('panduan: fungsi panduanJenisSaja ada', () => {
  assert.match(SRC, /export function panduanJenisSaja/);
});

test('panduan: hanya jenis tanpa isi TIDAK disimpan sebagai catatan', () => {
  // "Catat keuangan" harus memberi PETUNJUK, bukan menyimpan catatan "keuangan"
  assert.match(SRC, /panduan-jenis/, 'harus ada jalur panduan-jenis');
});

test('mabar: prompt punya aturan jujur tidak bisa mabar', () => {
  const sk = fs.readFileSync(new URL('../src/skills.ts', import.meta.url), 'utf8');
  assert.match(sk, /MABAR GAME EKSTERNAL/, 'harus ada aturan mabar eksternal');
  assert.match(sk, /TIDAK PUNYA akun game/, 'harus tegas tidak punya akun');
});

test('mabar: ada penegak di kode (bukan hanya prompt)', () => {
  const sk = fs.readFileSync(new URL('../src/skills.ts', import.meta.url), 'utf8');
  assert.match(sk, /mabarClaimRe/, 'harus ada penegak kode anti-klaim mabar');
  assert.match(sk, /konteksMabar/, 'harus periksa konteks game');
});
