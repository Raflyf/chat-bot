/**
 * TEST: caption stiker harus dibaca sampai ke vision.
 *
 * KENAPA ADA TEST INI
 * -------------------
 * Laporan pemilik produk: "bot nya baca caption nya dulu ga? knapa respon nya
 * tuh kaya ga baca caption dari stiker nya?"
 *
 * Akar masalah yang ditemukan: caption TIDAK PERNAH sampai ke vision.
 *   1. media.ts menyusun `stickerCaption` HANYA dari emoji stiker, sehingga
 *      parameter `caption` di describeImage selalu kosong.
 *   2. telegram.ts bahkan tidak meneruskan msg.caption ke processIncomingSticker.
 *   3. wa_baileys.ts & wa_cloud.ts sama, caption tidak diteruskan.
 *
 * Test ini mengunci perbaikan itu supaya tidak mundur lagi. Yang diperiksa
 * adalah BENTUK PEMANGGILAN di kode sumber (bukan perilaku runtime), karena
 * bagian yang rapuh justru "apakah nilainya diteruskan atau tidak".
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const AKAR = path.resolve(import.meta.dirname, '..');

function baca(relatif) {
  return fs.readFileSync(path.join(AKAR, relatif), 'utf8');
}

test('media.ts: processIncomingSticker menerima parameter caption', () => {
  const src = baca('src/media.ts');
  const ttd = /export async function processIncomingSticker\(([\s\S]*?)\): Promise/.exec(src);
  assert.ok(ttd, 'fungsi processIncomingSticker tidak ditemukan');
  assert.match(ttd[1], /caption\?/, 'parameter caption HARUS ada di tanda tangan fungsi');
});

test('media.ts: caption pengirim dipakai, bukan hanya emoji', () => {
  const src = baca('src/media.ts');

  // Periksa langsung baris yang MENUGASKAN stickerCaption (abaikan komentar).
  // Memakai pemeriksaan baris, bukan regex seluruh berkas, karena komentar
  // penjelasan di berkas ini sengaja memuat teks lama sebagai catatan sejarah
  // dan mengandung karakter yang membuat pencocokan seluruh berkas keliru.
  const baris = src.split('\n').map((b) => b.trim());
  const penugasan = baris.filter((b) => b.startsWith('const stickerCaption ='));

  assert.equal(penugasan.length, 1, 'harus ada tepat satu penugasan stickerCaption');
  assert.doesNotMatch(
    penugasan[0],
    /^const stickerCaption = emoji \?/,
    'kode masih memakai versi lama yang mengabaikan caption pengirim',
  );
  assert.match(penugasan[0], /bagianCaption/, 'penugasan harus memakai bagianCaption (caption + emoji)');

  assert.match(src, /if \(caption && caption\.trim\(\)\) bagianCaption\.push/, 'caption pengirim tidak dibaca');
});

test('telegram.ts: caption stiker diteruskan ke processIncomingSticker', () => {
  const src = baca('src/telegram.ts');
  const panggilan = /processIncomingSticker\(([^)]*)\)/.exec(src);
  assert.ok(panggilan, 'panggilan processIncomingSticker tidak ditemukan di telegram.ts');
  assert.match(
    panggilan[1],
    /rawCaption/,
    'caption (rawCaption) HARUS diteruskan — ini akar laporan pengguna',
  );
});

test('wa_baileys.ts: caption stiker diteruskan', () => {
  const src = baca('src/whatsapp_baileys.ts');
  const panggilan = /processIncomingSticker\(([^)]*)\)/.exec(src);
  assert.ok(panggilan, 'panggilan tidak ditemukan');
  assert.match(panggilan[1], /text/, 'teks/caption harus diteruskan');
});

test('wa_cloud.ts: caption stiker diteruskan', () => {
  const src = baca('src/whatsapp_cloud.ts');
  const panggilan = /processIncomingSticker\(([\s\S]{0,200}?)\);/.exec(src);
  assert.ok(panggilan, 'panggilan tidak ditemukan');
  assert.match(panggilan[1], /captionStiker/, 'captionStiker harus diteruskan');
});

test('describeImage: caption membuat baris "Emoji/catatan stiker" terisi', () => {
  const src = baca('src/skills.ts');
  // Baris ini hanya terisi bila caption tidak kosong. Perbaikan di media.ts
  // memastikan caption memang berisi (caption pengirim + emoji), bukan selalu
  // string kosong seperti sebelumnya.
  assert.match(
    src,
    /caption && caption\.trim\(\) \? `Emoji\/catatan stiker: \$\{caption\.trim\(\)\}` : ''/,
    'baris pemakaian caption di prompt stiker berubah bentuk — periksa ulang',
  );
});
