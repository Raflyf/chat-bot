/**
 * TEST OTOMATIS — permintaan tertunda karena lokasi (06 Okt 2026).
 *
 * KENAPA: permintaan pemilik produk —
 * "berlaku juga untuk semua, misal jika user baru menanyakan cuaca hari ini,
 *  lalu bot menanyakan posisi, nah setelah itu lanjut carikan cuaca, jangan
 *  malah tidak jadi dicarikan cuaca nya, dan itu berlaku ke semua pertanyaan
 *  yang berkaitan waktu, tempat dan lainnya"
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { butuhLokasiAtauWaktu, berkaitanDenganWaktu } from '../src/user-profile.js';

test('butuhLokasi: cuaca terdeteksi', () => {
  assert.equal(butuhLokasiAtauWaktu('cuaca hari ini gimana?'), true);
  assert.equal(butuhLokasiAtauWaktu('besok hujan nggak?'), true);
  assert.equal(butuhLokasiAtauWaktu('suhu di luar berapa'), true);
  assert.equal(butuhLokasiAtauWaktu('prakiraan cuaca minggu ini'), true);
});

test('butuhLokasi: waktu & pengingat tetap terdeteksi', () => {
  assert.equal(butuhLokasiAtauWaktu('jam berapa sekarang'), true);
  assert.equal(butuhLokasiAtauWaktu('ingatkan besok jam 9'), true);
  assert.equal(butuhLokasiAtauWaktu('hari ini tanggal berapa'), true);
});

test('butuhLokasi: kiblat, matahari, puasa terdeteksi', () => {
  assert.equal(butuhLokasiAtauWaktu('arah kiblat dari sini'), true);
  assert.equal(butuhLokasiAtauWaktu('matahari terbenam jam berapa'), true);
  assert.equal(butuhLokasiAtauWaktu('jadwal sahur hari ini'), true);
  assert.equal(butuhLokasiAtauWaktu('jam berbuka puasa'), true);
});

test('butuhLokasi: lokasi & perjalanan terdeteksi', () => {
  assert.equal(butuhLokasiAtauWaktu('jalan ke bandung macet nggak'), true);
  assert.equal(butuhLokasiAtauWaktu('jarak dari sini berapa km'), true);
  assert.equal(butuhLokasiAtauWaktu('arah kiblat ke mana'), true);
});

test('butuhLokasi: obrolan biasa TIDAK terdeteksi', () => {
  assert.equal(butuhLokasiAtauWaktu('halo apa kabar'), false);
  assert.equal(butuhLokasiAtauWaktu('apa itu fotosintesis'), false);
  assert.equal(butuhLokasiAtauWaktu('ceritakan lelucon dong'), false);
  assert.equal(butuhLokasiAtauWaktu('aku tadi makan enak banget'), false);
  assert.equal(butuhLokasiAtauWaktu('terima kasih ya'), false);
});

test('butuhLokasi: mencakup SEMUA yang berkaitanDenganWaktu', () => {
  const contohWaktu = [
    'jam berapa sekarang', 'ingatkan besok jam 9', 'hari ini tanggal berapa',
    'undur jadwal rapat', 'pengingat saya apa saja',
  ];
  for (const t of contohWaktu) {
    if (berkaitanDenganWaktu(t)) {
      assert.equal(butuhLokasiAtauWaktu(t), true, `"${t}" harus terdeteksi butuhLokasi`);
    }
  }
});

test('butuhLokasi: tidak ada false positive pada kalimat panjang', () => {
  // Kalimat obrolan panjang yang memuat kata umum tidak boleh memicu tanya lokasi
  assert.equal(butuhLokasiAtauWaktu('aku lagi belajar bahasa indonesia nih seru banget'), false);
  assert.equal(butuhLokasiAtauWaktu('kemarin aku nonton film bagus sekali'), false);
});
