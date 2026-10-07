/**
 * TEST OTOMATIS — evaluasi dataset 07 Okt 2026.
 *
 * KENAPA (laporan pemilik produk):
 *  1. "oh iya ingetin aku setiap hari buat minum vitamin ya" -> pengingat TIDAK tersimpan
 *  2. Curhat salinan chat ("...nanti aku chat kamu kalo aku udah siap") -> bot tanya lokasi
 *  3. "nama saya Dhea" -> tersimpan "Namanya saya Dhea" (kotor)
 *  4. "Tapi aku gasuka di panggil dhea ya" -> tersimpan sebagai nama (padahal GASUKA)
 *  5. "ingetin ... jam 7.30 dan 12.30" -> pesan kotor "minum vitamin dan 12.30"
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deteksiNiat } from '../src/notes.js';
import { butuhLokasiAtauWaktu } from '../src/user-profile.js';
import { deteksiFaktaPersonal } from '../src/user_facts.js';

test('pengingat: "oh iya ingetin ... setiap hari" TERSIMPAN', () => {
  const n = deteksiNiat('oh iya ingetin aku setiap hari buat minum vitamin ya');
  assert.ok(n, 'harus terdeteksi');
  assert.equal(n?.data?.pengingat, true, 'harus pengingat');
  assert.equal(n?.data?.repeat_kind, 'daily', 'harus harian');
});

test('pengingat: pesan bersih dari jam kedua & kata sambung', () => {
  const n = deteksiNiat('ingetin aku setiap hari minum vitamin jam 7.30 pagi dan 12.30 siang');
  assert.equal(n?.data?.message, 'minum vitamin', 'pesan harus bersih');
});

test('pengingat: pengantar 2 kata (oh iya) didukung', () => {
  for (const t of [
    'oh iya ingetin aku minum vitamin jam 7',
    'eh iya ingetin aku makan obat jam 8',
    'oke deh ingetin aku bayar listrik jam 9',
  ]) {
    assert.ok(deteksiNiat(t)?.data?.pengingat, `"${t}" harus pengingat`);
  }
});

test('curhat: salinan chat TIDAK memicu tanya-zona', () => {
  const curhat = `[06/10, 4:24 pm] 🐈‍⬛: we done?
[06/10, 4:25 pm] +62 858-0834-4561: ini siapa?
[06/10, 4:39 pm] kita break dulu, bisa kan?
[06/10, 4:39 pm] nanti aku chat kamu kalo aku udah siap buat perbaiki hati aku`;
  assert.equal(butuhLokasiAtauWaktu(curhat), false, 'curhat TIDAK boleh tanya lokasi');
});

test('curhat: pertanyaan waktu SUNGGUHAN tetap memicu', () => {
  for (const t of ['jam berapa sekarang', 'cuaca hari ini gimana', 'ingatkan aku jam 8']) {
    assert.equal(butuhLokasiAtauWaktu(t), true, `"${t}" harus memicu`);
  }
});

test('nama: "nama saya Dhea" -> bersih tanpa kata ganti', () => {
  const f = deteksiFaktaPersonal('nama saya Dhea');
  assert.equal(f?.fakta, 'Namanya Dhea', 'kata "saya" harus dibuang');
});

test('nama: kalimat GASUKA dipanggil TIDAK disimpan sebagai nama', () => {
  assert.equal(deteksiFaktaPersonal('Tapi aku gasuka di panggil dhea ya'), null, 'harus null');
});

test('nama: kalimat tebak huruf TIDAK disimpan sebagai nama', () => {
  assert.equal(deteksiFaktaPersonal('Jadiii nama gue itu huruf depan nya D, huruf belakangnya A'), null, 'harus null');
  assert.equal(deteksiFaktaPersonal('Huruf kedua nya H'), null, 'harus null');
});

test('nama: "panggil aku bub" TETAP tersimpan', () => {
  const f = deteksiFaktaPersonal('Panggil aku bub');
  assert.equal(f?.fakta, 'Dipanggil bub', 'harus tersimpan');
});
