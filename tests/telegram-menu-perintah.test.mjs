/**
 * TEST: menu `/` Telegram berisi daftar lengkap fitur.
 *
 * PERMINTAAN PEMILIK PRODUK (16 Okt 2026):
 *   "saya ingin ketika / gini itu muncul semua list fitur yg ada secara lengkap"
 *
 * Dua masalah yang diperbaiki:
 *   1. Perintah bot TIDAK PERNAH didaftarkan lewat `setMyCommands` -> menu `/`
 *      kosong di kolom ketik Telegram.
 *   2. `/help`, `/bantuan`, `/menu`, `/fitur`, `/panduan`, `/tutorial` tidak punya
 *      penanganan -> ditelan `if (text.startsWith('/'))` dan bot diam.
 *
 * Test ini mengunci: daftar perintah sah menurut aturan Telegram, ada
 * penanganan bantuan, dan tidak ada perintah yang didaftarkan tanpa penanganan.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  PERINTAH_BOT,
  PERINTAH_BANTUAN,
  PERINTAH_BERARGUMEN,
  PERINTAH_DIGABUNG,
  daftarPerintahTelegram,
  teksDaftarPerintah,
  konteksBantuanUntukAi,
  teksBantuan,
  petunjukPemakaian,
} from '../src/commands.js';

const TG = fs.readFileSync(new URL('../src/telegram.ts', import.meta.url), 'utf8');
const SCRIPT = fs.readFileSync(new URL('../scripts/set_perintah_telegram.ts', import.meta.url), 'utf8');

test('semua perintah sah menurut aturan Telegram (a-z, 0-9, garis bawah)', () => {
  const sah = /^[a-z0-9_]{1,32}$/;
  for (const p of daftarPerintahTelegram()) {
    assert.ok(sah.test(p.command), `"${p.command}" tidak sah untuk Telegram (tanda hubung dilarang)`);
  }
});

test('deskripsi memenuhi batas Telegram (3-256 karakter)', () => {
  for (const p of PERINTAH_BOT) {
    assert.ok(p.description.length >= 3, `deskripsi "${p.command}" terlalu pendek`);
    assert.ok(p.description.length <= 256, `deskripsi "${p.command}" terlalu panjang`);
  }
});

test('tidak lebih dari 100 perintah (batas Telegram)', () => {
  assert.ok(daftarPerintahTelegram().length <= 100);
});

test('fitur utama SEMUA terdaftar', () => {
  const ada = new Set(PERINTAH_BOT.map((p) => p.command));
  for (const wajib of [
    'start', 'help', 'reset',
    'tanya',
    'catat', 'catatan', 'cari',
    'tugas', 'list',
    'uang', 'masuk', 'rekap', 'hapusuang',
    'barang',
    'remind', 'salah',
  ]) {
    assert.ok(ada.has(wajib), `perintah /${wajib} harus terdaftar di menu`);
  }
});

test('HANYA ADA SATU perintah bantuan: /help', () => {
  // KOREKSI 16 Okt 2026: "knapa help, menu, bantuan, fitur, tutorial, panduan,
  // itu isi nya sama, kalo gitu cukup satukan saja jadi help saja".
  assert.deepEqual([...PERINTAH_BANTUAN], ['help'], 'hanya /help yang boleh jadi perintah bantuan');
  const bantuan = PERINTAH_BOT.filter((p) => PERINTAH_BANTUAN.has(p.command));
  assert.equal(bantuan.length, 1, 'tidak boleh ada perintah bantuan kedua');
});

test('ANTI-DUPLIKAT: tidak ada dua perintah dengan isi/deskripsi sama', () => {
  // Aturan pemilik produk: "jangan ada / yg isi nya sama".
  const deskripsi = PERINTAH_BOT.map((p) => p.description);
  const unik = new Set(deskripsi);
  assert.equal(unik.size, deskripsi.length, `ada deskripsi kembar: ${deskripsi.filter((d, i) => deskripsi.indexOf(d) !== i).join(', ')}`);
  // Nama perintah juga harus unik.
  const nama = PERINTAH_BOT.map((p) => p.command);
  assert.equal(new Set(nama).size, nama.length, 'ada nama perintah kembar');
});

test('perintah lama yang digabung diarahkan ke perintah utama', () => {
  // Alias lama tidak lagi dijalankan (supaya tidak ada isi kembar), tetapi
  // user tetap diberi arahan — bukan dibiarkan diam.
  for (const [lama, utama] of Object.entries(PERINTAH_DIGABUNG)) {
    assert.ok(PERINTAH_BOT.some((p) => p.command === utama), `perintah utama "/${utama}" harus terdaftar`);
    assert.ok(!PERINTAH_BOT.some((p) => p.command === lama), `perintah lama "/${lama}" tidak boleh masih terdaftar`);
  }
  assert.match(TG, /PERINTAH_DIGABUNG\[cmdLama\]/, 'handler harus mengarahkan perintah lama');
  // Yang digabung ke bantuan HARUS mengarah ke help.
  for (const a of ['bantuan', 'menu', 'fitur', 'panduan', 'tutorial']) {
    assert.equal(PERINTAH_DIGABUNG[a], 'help', `/${a} harus diarahkan ke /help`);
  }
});

test('konteks bantuan untuk AI memuat daftar perintah & contoh pemakaian', () => {
  const k = konteksBantuanUntukAi();
  assert.match(k, /DAFTAR PERINTAH YANG BENAR-BENAR ADA/);
  assert.match(k, /\/catat/);
  assert.match(k, /\/remind <menit> <pesan>/);
  // Daftar teks memuat setiap perintah.
  const teks = teksDaftarPerintah();
  for (const p of PERINTAH_BOT) assert.ok(teks.includes(`/${p.command} —`), `/${p.command} harus ada di teks`);
});

test('perintah berargumen punya contoh format', () => {
  for (const wajib of ['catat', 'tugas', 'uang', 'masuk', 'rekap', 'cari', 'remind', 'salah']) {
    assert.ok(PERINTAH_BERARGUMEN[wajib], `/${wajib} harus punya contoh format`);
  }
});

test('handler bantuan memakai SATU teks pasti (konsisten untuk semua alias)', () => {
  assert.match(TG, /PERINTAH_BANTUAN\.has\(/, 'handler harus memakai daftar bantuan');
  const blok = TG.slice(TG.indexOf('PERINTAH_BANTUAN.has('), TG.indexOf('// 2. Perintah /salah'));
  // KOREKSI 16 Okt 2026: sebelumnya digenerate AI -> isinya berbeda-beda untuk
  // 6 alias yang seharusnya sama, panjangnya terpotong, dan bertele-tele.
  assert.match(blok, /teksBantuan\(\)/, 'bantuan harus memakai satu teks pasti');
  assert.doesNotMatch(blok, /await autoReply\(/, 'bantuan TIDAK boleh digenerate AI lagi (tidak konsisten & kepanjangan)');
});

test('panduan: ringkas, muat satu pesan Telegram, dan lengkap', () => {
  const t = teksBantuan();
  // Batas satu pesan Telegram = 4096 karakter.
  assert.ok(t.length <= 4096, `panduan ${t.length} char melebihi batas Telegram 4096`);
  // Harus ringkas supaya mudah dibaca (laporan: "terlalu panjang dan pusing").
  assert.ok(t.length <= 1500, `panduan ${t.length} char terlalu panjang untuk dibaca`);
  // Setiap kelompok fitur utama harus ada.
  for (const bagian of ['Ngobrol', 'Catatan', 'Tugas', 'Keuangan', 'Belanja', 'Pengingat']) {
    assert.match(t, new RegExp(`\\*${bagian}\\*`), `bagian "${bagian}" harus ada di panduan`);
  }
  // Perintah penting harus disebut.
  for (const c of ['/catat', '/cari', '/tugas', '/list', '/uang', '/masuk', '/rekap', '/remind', '/salah', '/reset']) {
    assert.ok(t.includes(c), `${c} harus ada di panduan`);
  }
});

test('perintah berargumen punya petunjuk singkat saat diketik telanjang', () => {
  // Laporan pemilik produk: "ada / yg ga jalan" — contohnya /cari tanpa argumen,
  // bot DIAM karena ditelan `if (text.startsWith('/'))`.
  const NOTES = fs.readFileSync(new URL('../src/notes.ts', import.meta.url), 'utf8');
  assert.match(NOTES, /PERINTAH_BERARGUMEN\[mt\[1\]\]/, 'harus ada penanganan perintah tanpa argumen');
  assert.match(NOTES, /petunjukPemakaian\(mt\[1\]\)/);
  assert.match(NOTES, /jalur: 'perintah-tanpa-argumen'/);
  // Setiap alias berargumen harus punya contoh (termasuk alias yang dulu diam).
  for (const c of ['catat', 'tugas', 'uang', 'masuk', 'cari', 'rekap', 'hapusuang']) {
    assert.ok(PERINTAH_BERARGUMEN[c], `/${c} harus punya contoh pemakaian`);
    assert.ok(petunjukPemakaian(c).includes(`/${c}`), `petunjuk /${c} harus menyebut perintahnya`);
  }
});

test('skrip pendaftaran memakai setMyCommands + verifikasi getMyCommands', () => {
  assert.match(SCRIPT, /setMyCommands/);
  assert.match(SCRIPT, /getMyCommands/, 'harus memverifikasi hasil pendaftaran');
  assert.match(SCRIPT, /daftarPerintahTelegram\(\)/, 'harus memakai satu sumber kebenaran');
});

test('ANTI-TERSEMBUNYI: perintah yang DISEBUT di balasan wajib terdaftar di menu', () => {
  // Temuan 16 Okt 2026: `/ringkasan` sudah lama berfungsi dan disebut di balasan
  // lain ("Bisa juga pakai */ringkasan*..."), tetapi TIDAK pernah didaftarkan ->
  // tidak muncul di menu `/` dan tidak ada di panduan.
  const terdaftar = new Set(PERINTAH_BOT.map((p) => p.command));
  const disebut = new Set();
  for (const berkas of ['notes.ts', 'remind.ts', 'skills.ts', 'telegram.ts']) {
    const isi = fs.readFileSync(new URL(`../src/${berkas}`, import.meta.url), 'utf8');
    for (const m of isi.matchAll(/\*\/([a-z][a-z0-9_]{1,20})\*/g)) disebut.add(m[1]);
  }
  const tersembunyi = [...disebut].filter((c) => !terdaftar.has(c));
  assert.deepEqual(tersembunyi, [], `perintah ini disebut di balasan tapi tidak ada di menu: ${tersembunyi.join(', ')}`);
});

test('/ringkasan terdaftar & ada di panduan', () => {
  assert.ok(PERINTAH_BOT.some((p) => p.command === 'ringkasan'), '/ringkasan harus terdaftar di menu');
  assert.match(teksBantuan(), /\/ringkasan/, '/ringkasan harus ada di panduan');
});

test('ANTI-DUPLIKAT nyata: tiap perintah punya jalur penanganan sendiri', () => {
  // Menangkap kembar yang deskripsinya beda tapi perilakunya sama
  // (temuan nyata: /tugas tanpa isi == /list, /masuk tanpa isi == /uang).
  const NOTES = fs.readFileSync(new URL('../src/notes.ts', import.meta.url), 'utf8');
  // Daftar tugas HANYA lewat /list (tugas tidak lagi ikut).
  assert.ok(NOTES.includes('(?:list|tugas-saya)'), 'daftar tugas hanya boleh lewat /list');
  assert.ok(!NOTES.includes('(?:list|daftar|tugas|'), 'tugas tidak boleh lagi ikut daftar tugas');
  // Daftar keuangan HANYA lewat /uang (masuk tidak lagi ikut).
  assert.ok(NOTES.includes('(?:uang|duit|keuangan|'), 'daftar keuangan lewat /uang');
  assert.ok(!NOTES.includes('expenses?|keluar|masuk)'), 'masuk tidak boleh lagi menampilkan daftar keuangan');
  // Pesan error harus mengarahkan ke perintah yang benar-benar ada.
  assert.ok(!NOTES.includes('Ketik */tugas*'), 'pesan error tidak boleh menyuruh /tugas untuk lihat daftar');
  assert.ok(NOTES.includes('Ketik */list*'), 'pesan error harus mengarahkan ke /list');
});
