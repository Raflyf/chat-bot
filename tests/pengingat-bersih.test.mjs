/**
 * TEST OTOMATIS — pengingat: kalimat bersih + prioritas atas keuangan (06 Okt 2026).
 *
 * KENAPA:
 *   - "Iyah Ingetin aku minum air putih coba di jam 21.25"
 *     -> tersimpan "Iyah aku minum air putih coba di" (NGACO)
 *   - "oke ingatkan aku bayar listrik jam 9"
 *     -> dicatat PENGELUARAN Rp9 (karena "bayar" + "9")
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deteksiNiat, deteksiNiatImplisit } from '../src/notes.js';

test('pengingat: kalimat bersih dari pengantar & frasa gaul', () => {
  const kasus = [
    ['Iyah Ingetin aku minum air putih coba di jam 21.25', 'minum air putih'],
    ['ingatkan aku minum air putih jam 9', 'minum air putih'],
    ['ingatkan saya makan obat nanti jam 8 malam', 'makan obat'],
    ['ingetin aku buat telepon ibu jam 7', 'buat telepon ibu'],
    ['oke ingatkan aku bayar listrik jam 9', 'bayar listrik'],
    ['ingatkan 2 menit lagi login', 'login'],
  ];
  for (const [t, harus] of kasus) {
    const n = deteksiNiat(t);
    assert.equal(n?.data?.message, harus, `"${t}" harus jadi "${harus}"`);
  }
});

test('pengingat: menang atas keuangan saat ada kata bayar/beli', () => {
  for (const t of [
    'ingatkan aku bayar listrik jam 9',
    'ingetin aku beli susu nanti jam 8',
    'ingatkan saya bayar utang besok jam 10',
  ]) {
    const n = deteksiNiat(t);
    assert.equal(n?.kind, 'note', `"${t}" harus pengingat, bukan keuangan`);
    assert.equal(n?.data?.pengingat, true, `"${t}" harus bertanda pengingat`);
  }
});

test('keuangan: TIDAK terpengaruh gerbang pengingat', () => {
  // CATATAN (08 Okt 2026): pemasukan tanpa kata "catat" kini = INFORMASI (tidak dicatat).
  for (const t of ['bayar makan 25rb', 'beli kopi 15rb', 'catat gajian 5 juta', 'catat pemasukan 500rb']) {
    const n = deteksiNiat(t) || deteksiNiatImplisit(t);
    assert.equal(n?.kind, 'expense', `"${t}" harus tetap keuangan`);
  }
});
