/**
 * TEST OTOMATIS — anti-konfabulasi & anti-ngawur (10 Okt 2026).
 *
 * LAPORAN PEMILIK PRODUK: "lihat bot nya ngaco jawabannya, ditanya apa di balas
 * apa, tercemar karna memori sebelumnya jadi malah membalas percakapan topik
 * sebelumnya. kamu cek saja sendiri dataset hari ini, full audit, evaluasi,
 * tunning, perbaiki respon bot nya yg ngaco dan tidak nyambung."
 *
 * AUDIT DATASET (55 baris): 27 respon bermasalah (49%). Kategori:
 *   A. KONFABULASI KONTEKS — pesan pendek dikaitkan topik lama:
 *      "Iya" -> "kamu suka main ML"; "Oh" -> "udah kenal sama kamu";
 *      "yah" -> "belum ada info resmi"; "?" -> "liriknya nggak pas"
 *   B. BOCOR INSTRUKSI PROMPT — "Siap Cintia, aku jawab santai dan nyambung teruss."
 *   C. SALAH INFO FITUR — "bisa buat stiker" -> "cuma bisa chat teks doang"
 *   D. TIBA-TIBA MULAI GAME — "Iya" -> "Siap, kita main tebak-tebakan ya"
 *   E. FRASA NGAWUR — "Iya salah liat", "Monyet, udah nyangka kaget banget"
 *   F. TEMPLATE KOSONG — "Siap apa" -> "Siap bantu nanya, diskusi, atau curhat, loh."
 *
 * PERBAIKAN: penegakan DI KODE (bukan hanya prompt) di sanitizeAssistantOutput.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeAssistantOutput } from '../src/skills.js';

test('konfabulasi: pesan pendek + topik baru -> DIBUANG', () => {
  const kasus = [
    ['Iya', 'Oh iya, kamu suka main ML. Seru emang main bareng temen-temen, apalagi kalau timnya kompak.'],
    ['Oh', 'Iya, sini aja obrolan santai gak usah risih, aku kan udah kenal sama kamu.'],
    ['yah', 'Iya, memang belum ada info resmi soal itu.'],
    ['?', 'Maaf, sepertinya liriknya nggak pas. Mau aku coba lagi?'],
    ['Udah aku save kok', 'Mantapp, seneng bisa tersimpan di kontak kamu.'],
    ['keren bgt dia, berasal dri mna', 'Gak tau, dia gak pernah cerita.'],
  ];
  for (const [u, b] of kasus) {
    assert.equal(sanitizeAssistantOutput(b, u), '', `"${u}" -> harus dibuang`);
  }
});

test('bocor instruksi: balasan soal gaya sendiri -> DIBUANG', () => {
  assert.equal(sanitizeAssistantOutput('Siap Cintia, aku jawab santai dan nyambung teruss.', 'Kamu lagi ngapain ni'), '');
  assert.equal(sanitizeAssistantOutput('Oke, aku bakal jawab santai ya.', 'halo'), '');
});

test('salah info: bot mengaku tidak bisa stiker -> DIKOSONGKAN (regenerasi)', () => {
  // Aturan: "jangan menghardcode jawaban respon bot" -> kosongkan agar AI
  // meregenerasi dengan info BENAR (prompt sudah memuat kemampuan bot).
  const hasil = sanitizeAssistantOutput('Nggak bisa, aku cuma bisa chat teks doang.', 'bisa buat stiker');
  assert.equal(hasil, '', 'harus dikosongkan untuk regenerasi');
});

test('tiba-tiba game: ajakan main tanpa diminta -> DIBUANG', () => {
  const hasil = sanitizeAssistantOutput('Siap, kita main tebak-tebakan ya. Apa yang sama dari penjual sate dan soto?', 'Iya');
  assert.equal(hasil, '', 'jangan mulai game tanpa diminta');
});

test('frasa ngawur: "salah liat" / "monyet" -> DIBUANG', () => {
  assert.equal(sanitizeAssistantOutput('Monyet, udah nyangka kaget banget', '[Stiker WhatsApp]'), '');
  assert.equal(sanitizeAssistantOutput('Iya salah liat', '[Stiker WhatsApp]'), '');
});

test('template kosong: "siap bantu X" -> DIBUANG', () => {
  assert.equal(sanitizeAssistantOutput('Siap bantu nanya, diskusi, atau curhat, loh.', 'Siap apa'), '');
});

test('balasan NORMAL tidak boleh dirusak', () => {
  const jaga = [
    ['halo', 'Hai, apa kabar?'],
    ['Kamu main ml gk', 'Gak, aku cuma bisa ngobrol doang. Kamu main ML sering?'],
    ['ingatkan besok jam 9 rapat', 'Oke, pengingatnya sudah kupasang.'],
    ['saya mau curhat', 'Aku dengerin, cerita aja pelan-pelan.'],
    ['Iya, kita main sambung lagu', 'Siap, aku ikutan. Kamu mulai duluan ya.'],
    ['apa itu machine learning', 'Machine learning adalah cabang AI yang memungkinkan komputer belajar dari data.'],
  ];
  for (const [u, b] of jaga) {
    assert.equal(sanitizeAssistantOutput(b, u), b, `"${u}" JANGAN diubah`);
  }
});

test('stiker: balasan generik/ngawur -> DIBUANG', () => {
  // Semua ini dari dataset nyata 10 Okt.
  assert.equal(sanitizeAssistantOutput('Iya tuh lucu banget', '[Stiker WhatsApp]'), '');
  assert.equal(sanitizeAssistantOutput('Patrick lagi marah?', '[Stiker WhatsApp]'), '');
  assert.equal(sanitizeAssistantOutput('Iya salah liat, itu kucing yang nggak bisa nyanyi', '[Stiker WhatsApp]'), '');
});

test('lirik: klaim tahu lirik asli -> DIKOSONGKAN (regenerasi)', () => {
  // Bot DILARANG mengaku tahu lirik asli; JANGAN hardcode pengganti.
  const hasil = sanitizeAssistantOutput(
    'Maaf, liriknya memang beda. Ini baris yang sebenarnya: "Lagu teh hijau, teh hijau..."',
    'Kok kamu nyanyi GK bener sih salah mah lirik kamu');
  assert.equal(hasil, '', 'harus dikosongkan untuk regenerasi');
});

test('stiker: balasan yang BENAR tidak dirusak', () => {
  const jaga = [
    ['[Stiker WhatsApp]', 'Hayo ngapain, lu jago main stiker.'],
    ['Kamu ad stiker gk', 'Ada kok, tinggal bilang aja mau stiker yang gimana.'],
  ];
  for (const [u, b] of jaga) {
    assert.equal(sanitizeAssistantOutput(b, u), b, `"${u}" JANGAN diubah`);
  }
});
