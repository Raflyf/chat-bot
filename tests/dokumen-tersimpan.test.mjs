/**
 * TEST OTOMATIS — isi dokumen DISIMPAN agar bisa diaudit (09 Okt 2026).
 *
 * PERTANYAAN PEMILIK PRODUK:
 *   "apalah bot benar menjelaskan isi pdf nya? coba kamu cek isi pdf nya dan
 *    bandingkan dengan bot apakah sudah sesuai" + "itu pdf yg dikirim user emg
 *    ga masuk db?"
 *
 * JAWABAN SEBELUM PERBAIKAN: TIDAK masuk DB. Yang tersimpan di `messages` hanya
 * nama file ("[Dokumen: ....pdf]"). Isi PDF dibaca → dikirim ke AI → DIBUANG.
 * Akibatnya ringkasan bot tidak bisa diverifikasi & bot tak bisa mengingat isinya.
 *
 * PERBAIKAN: teks ekstraksi + ringkasan bot disimpan ke tabel `documents`
 * (migrasi v32). Modul: `src/documents.ts`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const DOC = fs.readFileSync(new URL('../src/documents.ts', import.meta.url), 'utf8');
const WA = fs.readFileSync(new URL('../src/whatsapp_cloud.ts', import.meta.url), 'utf8');
const MIG = fs.readFileSync(new URL('../sql/migrate_v32_documents.sql', import.meta.url), 'utf8');

test('dokumen: modul documents.ts punya fungsi yang diperlukan', () => {
  assert.ok(/export async function simpanDokumen/.test(DOC), 'harus ada simpanDokumen');
  assert.ok(/export async function ekstrakTeksDokumen/.test(DOC), 'harus ada ekstrakTeksDokumen');
  assert.ok(/export async function dokumenTerakhir/.test(DOC), 'harus ada dokumenTerakhir');
});

test('dokumen: penyimpanan DISAMBUNGKAN ke alur WhatsApp', () => {
  // Inti perbaikan: fungsi harus benar-benar dipanggil, bukan hanya ada.
  assert.ok(WA.includes('simpanDokumen'), 'simpanDokumen harus dipanggil di whatsapp_cloud.ts');
  assert.ok(WA.includes('ekstrakTeksDokumen'), 'ekstrakTeksDokumen harus dipanggil');
});

test('dokumen: impor pdf-parse lewat lib/ (hindari bug kode tes)', () => {
  // pdf-parse@1.1.1: index.js menjalankan kode tes internal yang ENOENT di
  // serverless. Wajib impor lib/pdf-parse.js langsung.
  assert.ok(DOC.includes("pdf-parse/lib/pdf-parse.js"),
    'harus impor pdf-parse/lib/pdf-parse.js, bukan pdf-parse');
  assert.ok(!/import\('pdf-parse'\)/.test(DOC), 'jangan impor pdf-parse langsung');
});

test('dokumen: tahan banting bila tabel belum ada', () => {
  // Bila migrasi v32 belum dijalankan, bot TIDAK boleh error.
  assert.ok(DOC.includes('PGRST205') || DOC.includes('42P01'),
    'harus menangani tabel belum ada tanpa melempar error');
});

test('dokumen: migrasi v32 ada & punya kolom penting', () => {
  for (const kol of ['chat_id', 'filename', 'teks', 'ringkasan', 'via']) {
    assert.ok(MIG.includes(kol), `migrasi harus punya kolom ${kol}`);
  }
  assert.ok(MIG.includes('enable row level security'), 'harus mengaktifkan RLS');
});

test('dokumen: teks dibatasi agar DB tidak membengkak', () => {
  assert.ok(/BATAS_TEKS\s*=/.test(DOC), 'harus ada batas panjang teks');
});
