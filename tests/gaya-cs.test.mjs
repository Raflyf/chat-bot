/**
 * TEST OTOMATIS — gaya customer service (08 Okt 2026).
 *
 * LAPORAN PEMILIK PRODUK: user memanggil bot dengan sayang —
 *   "makasii ya cinta" -> bot menjawab
 *   "Sama-sama! Semoga hari kamu makin sehat dan bahagia. 😊"
 * Itu gaya CS/kartu ucapan, bukan teman ngobrol.
 *
 * Prompt sudah melarang ("tanpa 'ada yang bisa dibantu', 'siap membantu'"),
 * tetapi model tidak selalu patuh — jadi ditegakkan di KODE.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeAssistantOutput } from '../src/skills.js';

const bersihkan = (bot, user = 'makasii ya cinta') =>
  sanitizeAssistantOutput(bot, user, [], false, false, false, null);

test('gaya CS: harapan generik dibuang', () => {
  for (const t of [
    'Sama-sama! Semoga hari kamu makin sehat dan bahagia. 😊',
    'Sama-sama, semoga harimu menyenangkan!',
    'Semoga sehat selalu ya!',
    'Semoga harimu indah dan cerah!',
  ]) {
    assert.equal(bersihkan(t).trim(), '', `"${t}" harus dikosongkan`);
  }
});

test('gaya CS: tawaran layanan dibuang', () => {
  for (const t of [
    'Senang bisa membantu!',
    'Siap membantu kapan saja ya!',
    'Jangan ragu untuk bertanya ya!',
    'Ada yang bisa saya bantu?',
  ]) {
    assert.equal(bersihkan(t).trim(), '', `"${t}" harus dikosongkan`);
  }
});

test('gaya CS: basa-basi kosong dibuang', () => {
  // CATATAN: "Oke sip!" BUKAN gaya CS — itu balasan teman yang wajar, dibiarkan.
  for (const t of ['Sama-sama! 😊', 'Sama-sama', 'Terima kasih!']) {
    assert.equal(bersihkan(t).trim(), '', `"${t}" harus dikosongkan`);
  }
});

test('balasan TEMAN dipertahankan', () => {
  for (const t of [
    'Sama-sama cinta, aku juga seneng kamu baik-baik aja',
    'Sama-sama dong, kamu tuh yang bikin aku semangat',
    'Sama-sama! Oh iya, pengingat vitaminmu jam 12.30 masih aktif ya',
  ]) {
    assert.equal(bersihkan(t).trim(), t, `"${t}" harus DIBIARKAN`);
  }
});
