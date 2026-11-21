/**
 * TEST OTOMATIS — Perapian & Pelestarian Format Respon Bot (21 Nov 2026).
 *
 * Memastikan:
 *  1. Daftar poin (- / •), langkah bernomor (1. 2. 3.), judul bagian (*Judul:*),
 *     jeda paragraf (\n\n), kutipan (>), sub-poin, blok kode (```...```), dan
 *     tabel GFM tidak diratakan menjadi satu paragraf oleh sanitizer.
 *  2. Keluhan nyata produksi (resep nasgor pada group_messages #168 yang tergabung
 *     menjadi 1 blok panjang) terurai otomatis dengan judul bagian, poin, dan
 *     langkah bernomor yang terpisah rapi tanpa merusak kata ulang ("abang-abang",
 *     "orak-arik", "bener-bener") atau rasio ("2:1").
 *  3. Obrolan pendek 1 kalimat, kata ber-strip, rentang angka/hari, desimal, dan
 *     ekstraksi TSV tetap aman tanpa pecah baris palsu.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeAssistantOutput,
  rapikanFormatPesan,
  buangBocorInstruksi,
  cleanMathAndNoise,
  extractStickerTag,
  extractRiddleTag,
  systemPrompt,
} from '../src/skills.js';

const NASGOR_PRODUCTION_FLATTENED =
  'Wah, langsung gas nanya resep! Nih, resep nasi goreng ala abang-abang yang gurihnya nendang: ' +
  '*Bahan Utama:* - Nasi putih dingin (wajib biar nggak lembek) - Telur (orak-arik dulu atau ceplok) ' +
  '- Ayam suwir atau bakso/sosis sesuai selera - Daun bawang, iris tipis ' +
  '*Bumbu Halus (Kunci Enaknya):* - Bawang merah & bawang putih (perbandingan 2:1) - Cabai merah/rawit ' +
  '- Terasi bakar sedikit biar wangi - Kemiri sangrai ' +
  '*Bumbu Tambahan:* - Kecap manis secukupnya - Saus tiram & kecap asin - Garam, kaldu jamur, & merica ' +
  '*Cara Masak:* 1. Tumis bumbu halus sampai bener-bener matang dan harum (biar nggak bau langu). ' +
  '2. Masukin telur, ayam, atau topping lainnya. 3. Masukin nasi, aduk rata sama bumbu. ' +
  '4. Tambahin kecap manis, saus tiram, garam, dan kaldu. Aduk dengan api besar biar ada aroma *smoky* ala wajan besi. ' +
  '5. Terakhir, taburin daun bawang, aduk bentar, angkat. Sikat! Jangan lupa pake kerupuk biar makin mantap.';

test('format: reproduksi resep nasgor tergencet -> terurai rapi dengan judul, poin, dan langkah terpisah', () => {
  const hasil = sanitizeAssistantOutput(
    NASGOR_PRODUCTION_FLATTENED,
    '[Rflyyyf]: oyy bott minta resep nasgor paling enak',
  );

  // Setiap judul bagian berada di baris tersendiri dengan jeda baris kosong sebelumnya
  assert.ok(hasil.includes('\n\n*Bahan Utama:*\n- Nasi putih dingin'), `Bahan Utama harus rapi:\n${hasil}`);
  assert.ok(hasil.includes('\n\n*Bumbu Halus (Kunci Enaknya):*\n- Bawang merah'), `Bumbu Halus harus rapi:\n${hasil}`);
  assert.ok(hasil.includes('\n\n*Bumbu Tambahan:*\n- Kecap manis'), `Bumbu Tambahan harus rapi:\n${hasil}`);
  assert.ok(hasil.includes('\n\n*Cara Masak:*\n1. Tumis bumbu halus'), `Cara Masak harus rapi:\n${hasil}`);

  // Setiap butir dan setiap langkah berdiri di barisnya masing-masing
  const lines = hasil.split('\n');
  assert.ok(lines.includes('- Telur (orak-arik dulu atau ceplok)'), 'sub-butir telur harus di baris sendiri');
  assert.ok(lines.includes('- Ayam suwir atau bakso/sosis sesuai selera'), 'sub-butir ayam harus di baris sendiri');
  assert.ok(lines.includes('- Kemiri sangrai'), 'sub-butir kemiri harus di baris sendiri');
  assert.ok(lines.some((l) => l.startsWith('2. Masukin telur')), 'langkah 2 harus di baris baru');
  assert.ok(lines.some((l) => l.startsWith('3. Masukin nasi')), 'langkah 3 harus di baris baru');
  assert.ok(lines.some((l) => l.startsWith('4. Tambahin kecap manis')), 'langkah 4 harus di baris baru');
  assert.ok(lines.some((l) => l.startsWith('5. Terakhir, taburin daun bawang')), 'langkah 5 harus di baris baru');

  // Penutup di luar daftar diberi jeda paragraf? Opsional atau ikut kalimat penutup;
  // kata ulang Indonesia & penekanan *smoky* tetap utuh!
  assert.ok(hasil.includes('abang-abang'), 'kata ulang abang-abang jangan dipotong');
  assert.ok(hasil.includes('orak-arik'), 'kata ulang orak-arik jangan dipotong');
  assert.ok(hasil.includes('bener-bener'), 'kata ulang bener-bener jangan dipotong');
  assert.ok(hasil.includes('2:1'), 'rasio 2:1 harus tetap utuh');
  assert.ok(hasil.includes('*smoky*'), 'penekanan *smoky* tidak boleh hilang');
});

test('format: balasan sudah rapi multi-bagian & multi-paragraf TIDAK diratakan oleh sanitizeAssistantOutput', () => {
  const inputRapi = [
    'Oke, ini ringkasan langkah setup project-nya ya:',
    '',
    '*Persiapan Awal:*',
    '- Install Node.js versi 22',
    '- Pastikan Git sudah terkonfigurasi',
    '  - Set nama & email global',
    '',
    '*Langkah Eksekusi:*',
    '1. Clone repositori ke folder lokal.',
    '2. Salin file konfigurasi dan isi variabel lingkungan.',
    '3. Jalankan perintah build dan unit test.',
    '',
    '> Catatan: pastikan semua test lulus sebelum deploy.',
    '',
    'Kalau masih ada kendala di langkah pertama, kabari aja nanti kita cek bareng.',
  ].join('\n');

  const hasil = sanitizeAssistantOutput(inputRapi, 'minta panduan setup project dong');
  assert.equal(hasil, inputRapi, 'struktur multi-baris rapi harus dipertahankan persis');
});

test('format: mode profesional tetap menjaga baris baru dan penomoran', () => {
  const sop = [
    'Berikut prosedur audit invoice bulanan:',
    '',
    '*Checklist Pemeriksaan:*',
    '1. Cocokkan nomor PO dengan invoice vendor.',
    '2. Verifikasi nominal PPN dan total tagihan.',
    '3. Simpan bukti persetujuan ke arsip keuangan.',
  ].join('\n');

  const hasil = sanitizeAssistantOutput(
    `${sop}\n\nSiap kerja gasss! 🚀`,
    'tolong buatkan prosedur audit invoice perusahaan untuk laporan',
    [],
    false,
    true,
  );
  assert.ok(hasil.includes('*Checklist Pemeriksaan:*\n1. Cocokkan nomor PO'), 'header + nomor SOP harus utuh');
  assert.ok(hasil.includes('\n2. Verifikasi nominal'), 'langkah 2 harus tetap terpisah');
  assert.ok(hasil.includes('\n3. Simpan bukti'), 'langkah 3 harus tetap terpisah');
  assert.ok(!hasil.includes('🚀') && !/gasss/i.test(hasil), 'emoji dan slang tetap bersih di mode profesional');
});

test('format: blok kode berindentasi & inline code tetap utuh 100%', () => {
  const kode = [
    'Ini contoh fungsi sederhana di TypeScript:',
    '',
    '```ts',
    'export function tambah(a: number, b: number): number {',
    '  const items = [1, 2, 3];',
    '',
    '  return items[0] + a + b;',
    '}',
    '```',
    '',
    'Panggil saja memakai `tambah(2, 3)` di file utama.',
  ].join('\n');

  const hasil = sanitizeAssistantOutput(kode, 'tolong buatkan contoh kode fungsi typescript');
  assert.ok(hasil.includes("  const items = [1, 2, 3];\n\n  return items[0] + a + b;"), `indentasi dan baris kosong dalam blok kode wajib utuh:\n${hasil}`);
  assert.ok(hasil.includes('`tambah(2, 3)`'), 'inline code wajib utuh');
});

test('format: URL valid dipertahankan barisnya, URL fiktif dibersihkan tanpa meratakan paragraf', () => {
  const teks = [
    '*Sumber Belajar:*',
    '- Dokumentasi resmi ada di https://github.com/nodejs/node',
    '- Kamu juga bisa cek referensi lain di https://situs-karangan-tidak-ada.example/artikel/999 agar makin paham.',
    '',
    'Semoga membantu buat belajar.',
  ].join('\n');

  const hasil = sanitizeAssistantOutput(teks, 'minta sumber belajar nodejs', [], false, false, false, null);
  assert.ok(hasil.includes('*Sumber Belajar:*\n- Dokumentasi resmi ada di https://github.com/nodejs/node'), `baris URL valid wajib utuh:\n${hasil}`);
  assert.ok(!hasil.includes('situs-karangan-tidak-ada.example'), 'URL karangan harus hilang');
  assert.ok(hasil.includes('\n\nSemoga membantu buat belajar.'), 'jeda paragraf penutup harus tetap ada');
});

test('format: tabel GFM 2 kolom & 3 kolom dikonversi ke poin ramah HP, TSV Excel tidak tersentuh', () => {
  const tabel2 = [
    'Perbandingan singkat:',
    '',
    '| Paket | Harga |',
    '| --- | --- |',
    '| Gratis | Rp0 |',
    '| Pro | Rp99.000 |',
  ].join('\n');
  const hasil2 = rapikanFormatPesan(tabel2);
  assert.ok(hasil2.includes('- *Gratis*: Rp0\n- *Pro*: Rp99.000'), `tabel 2 kolom jadi poin rapi:\n${hasil2}`);

  const tabel3 = [
    '| Opsi | Kecepatan | Biaya |',
    '| --- | --- | --- |',
    '| Lokal | Sangat cepat | Gratis |',
    '| Cloud | Stabil | Berbayar |',
  ].join('\n');
  const hasil3 = rapikanFormatPesan(tabel3);
  assert.ok(hasil3.includes('*Lokal*\n- Kecepatan: Sangat cepat\n- Biaya: Gratis'), `tabel 3 kolom jadi kartu poin:\n${hasil3}`);

  const tsv = 'Budi\t1000\t2000\nAni\t3000\t4000\nCici\t5000\t6000';
  assert.equal(sanitizeAssistantOutput(tsv, 'extract untuk excel'), tsv, 'TSV tidak boleh diubah');
});

test('format: heading markdown, strikethrough, garis pemisah ---, dan buangBocorInstruksi aman', () => {
  const md = [
    '### **Ringkasan Poin**',
    '---',
    '• Poin pertama ~~lama~~ baru',
    '* Poin kedua',
  ].join('\n');
  const hasilMd = cleanMathAndNoise(md);
  assert.ok(hasilMd.includes('*Ringkasan Poin*'), 'heading markdown jadi bold');
  assert.ok(!hasilMd.includes('---'), 'garis --- dibuang');
  assert.ok(hasilMd.includes('- Poin pertama ~lama~ baru\n- Poin kedua'), `bullet & strikethrough rapi:\n${hasilMd}`);

  const denganBocor = 'Oke, aku coba lebih santai dari sini.\n\n*Bahan:*\n- Telur 2 butir\n- Garam sejumput';
  const hasilBocor = buangBocorInstruksi(denganBocor);
  assert.equal(hasilBocor, '*Bahan:*\n- Telur 2 butir\n- Garam sejumput', 'buangBocorInstruksi tidak boleh meratakan baris sisa');
});

test('format: kasus negatif — obrolan pendek, kata ulang, rentang angka/hari, desimal tetap utuh', () => {
  const aman = [
    'Hai, apa kabar?',
    'Hati-hati di jalan, masing-masing bawa payung biar nggak kehujanan.',
    'Toko buka Senin - Jumat jam 08.00 - 17.00 WIB.',
    'Suhu naik dari 1.5 ke 2.0 derajat kemarin.',
    'Hasil pengurangan 10 - 3 = 7 ya.',
  ];
  for (const s of aman) {
    assert.equal(rapikanFormatPesan(s), s, `"${s}" tidak boleh dipecah baris`);
    assert.equal(sanitizeAssistantOutput(s, 'tanya info'), s, `"${s}" melalui sanitize harus tetap sama`);
  }
});

test('format: systemPrompt memuat aturan format terstruktur untuk berbagai jenis respon', () => {
  const prompt = systemPrompt({ chatId: '120363415563030836@g.us', history: [], corrections: [], summary: null }, null, 'minta resep nasgor');
  assert.ok(prompt.includes('FORMAT & KERAPIAN TAMPILAN PESAN'), 'systemPrompt harus memuat blok aturan format');
  assert.ok(prompt.includes('*Judul Bagian:*'), 'systemPrompt harus menjelaskan format judul bagian');
  assert.ok(prompt.includes('satu baris satu butir'), 'systemPrompt harus mewajibkan 1 baris 1 butir/langkah');
  assert.ok(!prompt.includes('[MODE PROFESIONAL AKTIF]'), 'resep masakan tidak boleh memicu MODE PROFESIONAL');

  const promptMedis = systemPrompt({ chatId: 'wa_6281234567890', history: [], corrections: [], summary: null }, null, 'tolong jelaskan resep dokter dan dosis obat');
  assert.ok(promptMedis.includes('[MODE PROFESIONAL AKTIF]'), 'resep dokter/medis tetap memicu MODE PROFESIONAL');
});

test('format: extractStickerTag & extractRiddleTag menjaga indentasi blok kode dan sub-bullet', () => {
  const denganKode = [
    '*Contoh:*',
    '- Utama',
    '  - Sub-poin tetap menjorok [[sticker:👍]]',
    '',
    '```js',
    'function halo() {',
    '  return 42;',
    '}',
    '```',
  ].join('\n');
  const st = extractStickerTag(denganKode);
  assert.equal(st.sticker, '👍');
  assert.ok(st.text.includes('  - Sub-poin tetap menjorok'), 'indentasi sub-bullet harus utuh');
  assert.ok(st.text.includes('  return 42;'), 'indentasi kode 2 spasi harus utuh');

  const tanpaSticker = extractStickerTag(denganKode.replace(' [[sticker:👍]]', ''));
  assert.equal(tanpaSticker.sticker, null);
  assert.ok(tanpaSticker.text.includes('  - Sub-poin tetap menjorok'));

  const rd = extractRiddleTag('*Tebakan*\n  - Petunjuk\nSiapa dia? [[jawab:Bayangan]]');
  assert.equal(rd.answer, 'Bayangan');
  assert.ok(rd.text.includes('  - Petunjuk'), 'indentasi setelah extractRiddleTag harus utuh');
});
