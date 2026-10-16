/**
 * TEST: penjaga anti-echo pesan user + aturan perspektif orang.
 *
 * LATAR (temuan produksi 16 Okt 2026):
 *   1. Telegram #4517 — user kirim stiker + caption "Gaya terbangmu itu level
 *      dewa ya?" lalu bot membalas PERSIS kalimat itu (echo).
 *   2. Telegram #4523 — user tulis "nenek lu jemping" (nenek MILIK USER), bot
 *      menjawab "Nenek gue jemping juga katanya!" (mengklaim nenek itu miliknya).
 *
 * Keduanya membuat balasan terasa tidak nyambung. Test ini mengunci perbaikannya
 * supaya TIDAK terulang di platform mana pun (Telegram, WhatsApp Cloud, Baileys).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { adalahEchoPesanUser } from '../src/skills.js';

const SKILLS = fs.readFileSync(new URL('../src/skills.ts', import.meta.url), 'utf8');

test('echo: balasan PERSIS sama dengan pesan user terdeteksi', () => {
  assert.equal(adalahEchoPesanUser('Gaya terbangmu itu level dewa ya?', 'Gaya terbangmu itu level dewa ya?'), true);
});

test('echo: balasan sangat mirip (kata berbeda) terdeteksi', () => {
  assert.equal(
    adalahEchoPesanUser(
      'Gaya terbangmu itu level dewa ya keren sekali',
      'Gaya terbangmu itu level dewa ya keren banget',
    ),
    true,
  );
});

test('echo: sapaan pendek TIDAK dianggap echo (wajar diulang)', () => {
  for (const pendek of ['woy', 'oi', 'tes', 'halo', 'p', 'ping']) {
    assert.equal(adalahEchoPesanUser(pendek, pendek), false, `"${pendek}" tidak boleh dianggap echo`);
  }
});

test('echo: balasan yang benar-benar berbeda TIDAK dianggap echo', () => {
  assert.equal(adalahEchoPesanUser('Wah gayanya kayak superhero, keren! 😂', 'Gaya terbangmu itu level dewa ya?'), false);
  assert.equal(adalahEchoPesanUser('Iya, aku juga suka film itu', 'kamu suka film apa'), false);
});

test('echo: input kosong aman (tidak melempar)', () => {
  assert.equal(adalahEchoPesanUser('', ''), false);
  assert.equal(adalahEchoPesanUser('ada balasan', ''), false);
  assert.equal(adalahEchoPesanUser('', 'ada pesan user yang panjang sekali'), false);
});

test('echo: guard terpasang di autoReply (berlaku semua platform)', () => {
  // autoReply dipakai Telegram + WhatsApp Cloud + Baileys, jadi guard di sini
  // otomatis berlaku di ketiga platform.
  assert.match(SKILLS, /export function adalahEchoPesanUser/);
  assert.match(SKILLS, /if \(adalahEchoPesanUser\(reply, clean\)\)/);
  // Bila percobaan kedua masih mengulang, TIDAK boleh ada teks template statis.
  assert.match(SKILLS, /!adalahEchoPesanUser\(echoReply, clean\)/);
});

test('echo: banter yang DISUKAI pemilik produk TIDAK boleh diblokir', () => {
  // Contoh nyata yang disukai pemilik produk (Telegram #4523). Balasan ini HARUS
  // lolos — jangan sampai penjaga anti-echo ikut memblokir gaya banter ini.
  assert.equal(
    adalahEchoPesanUser('Hahaha, wkwkwk! Nenek gue jemping juga katanya!', 'nenek lu jemping'),
    false,
    'banter "nenek gue" harus lolos',
  );
});

test('perspektif: prompt melarang MEMBELOKKAN topik & MENGARANG klaim orang lain', () => {
  assert.match(SKILLS, /JAWAB LANGSUNG PESAN TERAKHIRNYA/);
  assert.match(SKILLS, /jangan membelokkan ke orang\/topik lain/);
  assert.match(SKILLS, /DILARANG menambah klaim baru tentang orang lain/);
  // Larangan lama yang SALAH tidak boleh kembali: "nenek gue" adalah banter yang disukai.
  assert.doesNotMatch(SKILLS, /PERSPEKTIF ORANG \(ATURAN KERAS\)/);
  assert.doesNotMatch(SKILLS, /DILARANG menjawab dengan "nenek gue"/);
});

test('perspektif stiker: prompt stiker melarang menulis dari sudut pandang user', () => {
  assert.match(SKILLS, /SUDUT PANDANG: kamu yang MEMBALAS/);
  assert.match(SKILLS, /DILARANG menulis kalimat yang ditujukan KEPADA kamu/);
  // TIDAK boleh ada contoh balasan siap pakai — model akan menyalinnya (template).
  assert.doesNotMatch(SKILLS, /Contoh BENAR: "Gayanya kayak superhero/);
});

test('tidak ada balasan hardcode: perbaikan ini hanya instruksi + regenerasi', () => {
  // Aturan pemilik produk: JANGAN menghardcode jawaban bot. Semua penanganan harus
  // berupa instruksi ke model (yang lalu MENGGENERASI ulang), bukan teks siap kirim.
  const blokEcho = SKILLS.slice(
    SKILLS.indexOf('GUARD ANTI-ECHO PESAN USER'),
    SKILLS.indexOf('GUARD ANTI-AMNESIA'),
  );
  // Harus memanggil model lagi, bukan menyuntikkan kalimat tetap.
  assert.match(blokEcho, /await chatRetry\(/);
  assert.match(blokEcho, /role: 'user'/);
  // Bila regenerasi gagal, balasan LAMA (dari model) dibiarkan — bukan diganti template.
  assert.match(blokEcho, /Fallback graceful: bila retry gagal, balasan lama dibiarkan/);
});
