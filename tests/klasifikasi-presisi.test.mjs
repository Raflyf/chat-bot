/**
 * TEST OTOMATIS — presisi klasifikasi (permintaan pemilik produk 07 Okt 2026):
 *
 *   "jangan sampai ada percakapan biasa malah salah klasifikasi jadi fitur yg ada
 *    dan malah mentrigger fitur nya padahal sedang chat biasa, dan ketika ingin
 *    mentrigger fitur nya malah tidak ter trigger"
 *
 * DUA SISI YANG DIUJI:
 *   A. CURHAT/OBROLAN biasa -> JANGAN trigger fitur (anti false-positive)
 *   B. PERMINTAAN fitur     -> HARUS trigger (anti false-negative)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deteksiNiat, deteksiNiatImplisit } from '../src/notes.js';

// ── A. CURHAT: jangan dicatat ──
const CURHAT = [
  'aku baru gajian dapet 5 juta, lumayan buat bayar utang',
  'akhirnya gajian juga, 5 juta masuk rekening',
  'alhamdulillah gajian 5 juta nih',
  'baru aja dapet gaji 5 juta, seneng banget',
  'gajian 5 juta kemarin buat bayar utang',
  'duit aku tinggal 100rb nih sedih',
  'aku dapet bonus 2 juta, mau beliin ibu',
  'aku habis 50rb buat makan tadi',
  'tadi aku bayar parkir',
  'aku capek banget hari ini',
  'nanti aku kabarin ya',
  'kamu lagi apa',
  'aku sayang kamu',
  'kamu suka aku ga',
  'aku bukan AI',
  'aku gatel ih kenapa ya',
  'kita break dulu bisa kan',
  'aku masih perlu perbaiki hati aku',
  'aku tadi selesai makan',
  'udah 1021 tahun nenek gua masih jaya',
  'dia bilang aku harus sabar',
  'kamu harus tau perasaanku',
  'perlu aku bilang apa lagi',
  'umurku 25 tahun',
  'aku punya 3 kucing',
];

test('presisi: CURHAT tidak boleh dicatat sebagai fitur', () => {
  for (const t of CURHAT) {
    const n = deteksiNiat(t) || deteksiNiatImplisit(t);
    assert.equal(n, null, `"${t}" TIDAK boleh dicatat (dapat ${n?.kind})`);
  }
});

// ── B. PERMINTAAN: harus dicatat ──
const PERMINTAAN = [
  ['catat pengeluaran 50rb buat makan', 'expense'],
  ['catat gajian 5 juta', 'expense'],
  ['catat pemasukan 5 juta', 'expense'],
  ['beli kopi 15rb', 'expense'],
  ['bayar listrik 200rb', 'expense'],
  ['gajian 5 juta', 'expense'],
  ['bonus 2 juta', 'expense'],
  ['thr 1 juta', 'expense'],
  ['catat nomor polisi B 1234 XYZ', 'note'],
  ['tambah tugas upload jurnal', 'todo'],
  ['todo beli galon', 'todo'],
  ['ingatkan aku minum obat jam 8', 'note'],
  ['ingetin aku bayar listrik jam 9', 'note'],
  ['ingatkan aku 5 menit lagi login', 'note'],
  ['tiap hari ingetin minum vitamin jam 7 pagi', 'note'],
  ['oh iya ingetin aku setiap hari buat minum vitamin ya', 'note'],
  ['oke deh ingetin aku bayar listrik jam 9', 'note'],
  ['catat barang beras lima kilo', 'note'],
];

test('presisi: PERMINTAAN fitur HARUS terdeteksi', () => {
  for (const [t, kind] of PERMINTAAN) {
    const n = deteksiNiat(t);
    assert.ok(n, `"${t}" HARUS terdeteksi`);
    assert.equal(n?.kind, kind, `"${t}" harus kind=${kind}`);
  }
});

// ── C. "aku habis 50rb buat makan" tanpa "tadi" = boleh dicatat ──
test('presisi: "aku habis 50rb buat makan" (tanpa tadi) boleh dicatat', () => {
  const n = deteksiNiat('habis 50rb buat makan') || deteksiNiatImplisit('habis 50rb buat makan');
  assert.ok(n, 'harus terdeteksi (bukan curhat)');
});
