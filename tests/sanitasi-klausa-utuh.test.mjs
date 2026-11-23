/**
 * TEST OTOMATIS — sanitasi klausa penawaran harus utuh (tanpa potong tengah kalimat).
 *
 * Regression test untuk bug produksi "okeh" -> "Sipp, kalau.":
 * penghapusan klausa penawaran seperti ", kalau ada yang mau dibahas lagi tinggal bilang aja."
 * sebelumnya tidak mengonsumsi pengantar kondisional (", kalau") dan berhenti sebelum ".",
 * sehingga menyisakan fragmen rusak "Sipp, kalau.".
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeAssistantOutput, bersihkanKlausaMenggantung } from '../src/skills.js';

const bersihkan = (bot, user = 'okeh') =>
  sanitizeAssistantOutput(bot, user, [], false, false, false, null);

test('bug produksi: penghapusan klausa penawaran tidak menyisakan fragmen "Sipp, kalau."', () => {
  const kasusUtuh = [
    ['Sipp, kalau ada yang mau dibahas lagi tinggal bilang aja.', 'Sipp'],
    ['Sipp, kalau ada yang mau diobrolin nanti kabarin aja.', 'Sipp'],
    ['Sipp, kalau mau ngobrolin apa-apa panggil aja.', 'Sipp'],
    ['Sipp, kalau mau bahas apa-apa bilang aja.', 'Sipp'],
    ['Sipp, kalau ada yang bisa ditanyakan kabari ya.', 'Sipp'],
    ['Sipp, kalau ada yang bisa dibantu bilang aja.', 'Sipp'],
    ['Sipp, kalau ada yang mau diceritain lagi bilang aja.', 'Sipp'],
    ['Sipp, nanti kalau kamu ada yang mau dibahas kabarin ya!', 'Sipp'],
    ['Boleh banget, kalau kamu mau lanjut tebak-tebakan nanti bilang aja.', 'Boleh banget'],
    [
      'Pengingat jam 7 malam udah aku catat. Kalau ada yang mau dibahas lagi tinggal bilang aja.',
      'Pengingat jam 7 malam udah aku catat.',
    ],
  ];

  for (const [masukan, harapan] of kasusUtuh) {
    const hasil = bersihkan(masukan);
    assert.equal(hasil, harapan, `"${masukan}" harus menjadi "${harapan}", bukan "${hasil}"`);
    assert.ok(!/,\s*(?:kalau|kalo|jika|tapi)\.?$/i.test(hasil), `tidak boleh menyisakan klausa menggantung: "${hasil}"`);
  }

  // "Oke, kalau kamu mau lanjut tebak-tebakan..." dibersihkan menjadi "Oke" di step 6b
  // lalu dikosongkan oleh step 11c agar diregenerasi — tidak pernah menjadi "Oke, kalau kamu.".
  const okeLanjut = bersihkan('Oke, kalau kamu mau lanjut tebak-tebakan nanti bilang aja.');
  assert.equal(okeLanjut, '', `standalone "Oke" setelah hapus tawaran harus kosong untuk regenerasi, dapat: "${okeLanjut}"`);
});

test('tanda baca & filler penutup tidak menyisakan titik tunggal atau potongan kata', () => {
  assert.equal(bersihkan('Santai aja bro!'), '');
  assert.equal(bersihkan('Oke bro! Tetap semangat ya!'), 'Oke bro!');
  assert.equal(
    bersihkan('Oke sip, aku standby terus di sini ya, kalau ada yang bisa aku bantu bilang aja.'),
    'Oke sip, aku standby terus di sini ya',
  );
});

test('bersihkanKlausaMenggantung membersihkan ujung kalimat menggantung & tanda baca rusak', () => {
  assert.equal(bersihkanKlausaMenggantung('Sipp, kalau.'), 'Sipp');
  assert.equal(bersihkanKlausaMenggantung('Sipp, kalau kamu.'), 'Sipp');
  assert.equal(bersihkanKlausaMenggantung('Oke, jika ada.'), 'Oke');
  assert.equal(bersihkanKlausaMenggantung('Sipp, tapi.'), 'Sipp');
  assert.equal(bersihkanKlausaMenggantung('Kalau.'), '');
});

test('kalimat wajar & empati valid tidak ikut terpotong (anti false-positive)', () => {
  const harusUtuh = [
    'Di catatanmu ada yang mau dibahas soal laporan Q3 jam 10 besok.',
    'Bisa sih, tapi...',
    'Pengingat udah diset, kalau ada perubahan tinggal bilang aja.',
    'Yaudah kamu istirahat dulu ya.',
    'Kalau capek rebahan dulu aja.',
    'Sama-sama dong, kamu tuh yang bikin aku semangat',
  ];

  for (const teks of harusUtuh) {
    assert.equal(bersihkan(teks, 'makasii ya cinta'), teks, `"${teks}" harus dipertahankan utuh`);
  }
});
