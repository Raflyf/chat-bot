/**
 * TEST: bot Telegram di grup — panggil dengan `/namabot` (gaya Meta AI di X).
 *
 * PERMINTAAN PEMILIK PRODUK (16 Okt 2026):
 *   "saya juga ingin bot di tele bisa masuk grup dan memanggilnya itu kaya meta
 *    di x, jika ada yg mau nanya cukup tulis pertanyaan dan gunakan / nama bot
 *    untuk memanggil bot untuk menjawab pertanyaan user yg memanggil bot nya"
 *
 * Aturan yang dikunci test ini:
 *   1. `/namabot` dikenali di awal, tengah, maupun akhir pesan.
 *   2. Kata panggil DIBUANG dari pertanyaan sebelum dikirim ke AI.
 *   3. TIDAK salah tangkap username bot lain yang mirip (mis. /chatkita_bot2).
 *   4. Di grup, bot hanya menjawab bila dipanggil (tidak pernah menyahut sendiri).
 *   5. Data pribadi di grup dipisah per anggota (temuan audit P1-2).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { deteksiPanggilSlash } from '../src/telegram.js';

const TG = fs.readFileSync(new URL('../src/telegram.ts', import.meta.url), 'utf8');
const ENV_TS = fs.readFileSync(new URL('../src/env.ts', import.meta.url), 'utf8');
const ENV_EX = fs.readFileSync(new URL('../.env.example', import.meta.url), 'utf8');

const BOT = 'chatkita_bot';

test('panggil /namabot di AKHIR pesan — pertanyaan dibersihkan', () => {
  const r = deteksiPanggilSlash('harga emas hari ini berapa /chatkita_bot', BOT);
  assert.equal(r.dipanggil, true);
  assert.equal(r.bersih, 'harga emas hari ini berapa');
});

test('panggil /namabot di AWAL pesan — pertanyaan dibersihkan', () => {
  const r = deteksiPanggilSlash('/chatkita_bot harga emas hari ini berapa', BOT);
  assert.equal(r.dipanggil, true);
  assert.equal(r.bersih, 'harga emas hari ini berapa');
});

test('panggil /namabot di TENGAH pesan — pertanyaan dibersihkan', () => {
  const r = deteksiPanggilSlash('tolong /chatkita_bot jelaskan singkat', BOT);
  assert.equal(r.dipanggil, true);
  assert.equal(r.bersih, 'tolong jelaskan singkat');
});

test('huruf besar/kecil tidak masalah', () => {
  const r = deteksiPanggilSlash('apa itu AI /ChatKita_Bot', BOT);
  assert.equal(r.dipanggil, true);
  assert.equal(r.bersih, 'apa itu AI');
});

test('panggil TANPA pertanyaan — dipanggil true, bersih kosong', () => {
  const r = deteksiPanggilSlash('/chatkita_bot', BOT);
  assert.equal(r.dipanggil, true);
  assert.equal(r.bersih, '');
});

test('TIDAK salah tangkap username bot lain yang mirip', () => {
  // "/chatkita_bot2" dan "/chatkita_botx" bukan bot ini.
  assert.equal(deteksiPanggilSlash('halo /chatkita_bot2', BOT).dipanggil, false);
  assert.equal(deteksiPanggilSlash('halo /chatkita_botx', BOT).dipanggil, false);
  // Tanpa garis miring juga bukan panggilan.
  assert.equal(deteksiPanggilSlash('halo chatkita_bot', BOT).dipanggil, false);
});

test('pesan biasa tanpa panggilan tidak berubah', () => {
  const r = deteksiPanggilSlash('selamat pagi semua', BOT);
  assert.equal(r.dipanggil, false);
  assert.equal(r.bersih, 'selamat pagi semua');
});

test('panggil dua kali tetap bersih', () => {
  const r = deteksiPanggilSlash('/chatkita_bot cuaca besok /chatkita_bot', BOT);
  assert.equal(r.dipanggil, true);
  assert.equal(r.bersih, 'cuaca besok');
});

test('input kosong aman', () => {
  assert.deepEqual(deteksiPanggilSlash('', BOT), { dipanggil: false, bersih: '' });
});

test('handler grup: panggilan slash ikut memicu bot', () => {
  assert.match(TG, /hasSlashPanggil/, 'harus ada penanda panggilan slash');
  assert.match(TG, /isTargetedCommand \|\| hasMention \|\| hasEntityMention \|\| isReplyToBot \|\| hasSlashPanggil/);
  // Pesan grup yang BUKAN untuk bot harus diabaikan tanpa beban DB.
  assert.match(TG, /if \(isGroup && !isDirectedToBot\) \{[\s\S]{0,80}return;/);
});

test('daftar putih grup: konfigurasi ada & terdokumentasi', () => {
  assert.match(ENV_TS, /telegramGroupAllowlist: csv\('TELEGRAM_GROUP_ALLOWLIST'\)/);
  assert.match(TG, /config\.telegramGroupAllowlist\.includes\(chatKey\)/, 'allowlist harus ditegakkan');
  assert.match(ENV_EX, /TELEGRAM_GROUP_ALLOWLIST=/, '.env.example harus memuat variabelnya');
  assert.match(ENV_EX, /\/namabot|nama bot/i, '.env.example harus menjelaskan cara panggil');
});

test('privasi grup: data pribadi dipisah per anggota (audit P1-2)', () => {
  assert.match(TG, /const identityKey = isGroup && msg\.from\?\.id \? String\(msg\.from\.id\) : chatKey/);
  // Data pribadi memakai identityKey, BUKAN id grup.
  assert.match(TG, /tanganiPencatatan\(text, identityKey,/, 'catatan/tugas/keuangan harus per-anggota');
  assert.match(TG, /tangkapFaktaPersonal\(identityKey, text\)/, 'fakta personal harus per-anggota');
  assert.match(TG, /saveCorrection\(identityKey,/, 'koreksi harus per-anggota');
});

test('indikator menulis aktif saat memproses', () => {
  assert.match(TG, /sendChatAction\(chatId, 'typing'\)/);
});

test('identitas bot dikunci ke BOT_NAME, bukan perusahaan AI lain', () => {
  const SKILLS = fs.readFileSync(new URL('../src/skills.ts', import.meta.url), 'utf8');
  assert.match(SKILLS, /IDENTITAS: namamu \$\{config\.botName\}/);
  assert.match(SKILLS, /BUKAN produk OpenAI, Google, Anthropic/);
});
