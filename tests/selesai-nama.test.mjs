/**
 * TEST OTOMATIS — selesaikan tugas lewat BAHASA ALAMI (06 Okt 2026).
 *
 * KENAPA: laporan pemilik produk — "tugas upload jurnal selesai" malah
 * DITAWARI MENCATAT TUGAS BARU, bukan menyelesaikan.
 * SEBAB: deteksi selesai hanya mengenali pola "<kata selesai> <angka>".
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Replikasi pola deteksi (di notes.ts)
function deteksiSelesaiNama(low) {
  const ceritaLampau = /\b(tadi|kemarin|barusan|baru\s+aja|td|tadi\s+kan|sudah\s+aku)\b/.test(low);
  if (ceritaLampau) return null;
  const m = low.match(/^(?:tugas\s+)?(.+?)\s+(?:sudah\s+|udah\s+)?(?:selesai|kelar|beres|done|tuntas|selesaikan)\s*[.!]*$/i)
    || low.match(/^(?:selesai(?:kan)?|tandai\s+selesai|sudah\s+selesai|udah\s+selesai)\s+(?:tugas\s+)?(.+?)\s*[.!]*$/i);
  if (!m) return null;
  const mentah = m[1].trim().replace(/^tugas\s+/i, '').replace(/\s+tugas$/i, '').trim();
  const tanpaKataKerja = mentah
    .replace(/^(?:beli|buat|bikin|kerjakan|mengerjakan|mengurus|urus|kirim|bayar|hubungi|telepon|telpon|baca|tulis)\s+/i, '')
    .trim();
  const kandidat = Array.from(new Set([mentah, tanpaKataKerja])).filter((n) => n.length >= 2 && !/^\d+$/.test(n));
  return kandidat.length ? kandidat : null;
}

/** Cocokkan kandidat nama dengan daftar tugas (sama persis dulu, lalu mengandung). */
function cocokkan(kandidat, tugas) {
  if (!kandidat) return null;
  for (const nama of kandidat) {
    const b = nama.toLowerCase();
    const exact = tugas.find((t) => t.toLowerCase() === b);
    if (exact) return exact;
  }
  for (const nama of kandidat) {
    const b = nama.toLowerCase();
    const sub = tugas.find((t) => t.toLowerCase().includes(b) || b.includes(t.toLowerCase()));
    if (sub) return sub;
  }
  return null;
}

test('selesai: "tugas upload jurnal selesai" cocok tugas "upload jurnal"', () => {
  assert.equal(cocokkan(deteksiSelesaiNama('tugas upload jurnal selesai'), ['upload jurnal']), 'upload jurnal');
});

test('selesai: "upload jurnal selesai" cocok tugas "upload jurnal"', () => {
  assert.equal(cocokkan(deteksiSelesaiNama('upload jurnal selesai'), ['upload jurnal']), 'upload jurnal');
});

test('selesai: "selesai tugas upload jurnal" cocok tugas "upload jurnal"', () => {
  assert.equal(cocokkan(deteksiSelesaiNama('selesai tugas upload jurnal'), ['upload jurnal']), 'upload jurnal');
});

test('selesai: "selesaikan rapat" cocok tugas "rapat"', () => {
  assert.equal(cocokkan(deteksiSelesaiNama('selesaikan rapat'), ['rapat']), 'rapat');
});

test('selesai: "beli susu selesai" cocok tugas "susu"', () => {
  assert.equal(cocokkan(deteksiSelesaiNama('beli susu selesai'), ['susu']), 'susu');
});

test('selesai: "udah selesai beli susu" cocok tugas "susu"', () => {
  assert.equal(cocokkan(deteksiSelesaiNama('udah selesai beli susu'), ['susu']), 'susu');
});

test('selesai: nama yang tidak ada di daftar -> tidak cocok', () => {
  assert.equal(cocokkan(deteksiSelesaiNama('tugas upload jurnal selesai'), ['beli susu', 'rapat']), null);
});

test('selesai: CERITA LAMPAU tidak ditangkap', () => {
  assert.equal(deteksiSelesaiNama('aku tadi selesai makan'), null);
  assert.equal(deteksiSelesaiNama('kemarin aku selesai rapat'), null);
  assert.equal(deteksiSelesaiNama('barusan selesai mandi'), null);
});

test('selesai: kalimat tanpa kata selesai tidak ditangkap', () => {
  assert.equal(deteksiSelesaiNama('tambah tugas upload jurnal'), null);
  assert.equal(deteksiSelesaiNama('tugas baru upload jurnal'), null);
  assert.equal(deteksiSelesaiNama('halo apa kabar'), null);
});

test('selesai: angka saja tidak jadi nama', () => {
  assert.equal(deteksiSelesaiNama('selesai 1'), null, 'ditangani jalur angka, bukan nama');
});
