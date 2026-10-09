/**
 * TEST OTOMATIS — fitur KEBIASAAN dihidupkan & disambungkan (09 Okt 2026).
 *
 * LATAR: 4 fungsi (simpanKebiasaan, centangKebiasaan, daftarKebiasaan,
 * formatDaftarKebiasaan) + cariCatatan sudah ada sejak lama, tabel `habits` juga
 * ada di DB — TETAPI tidak pernah dipanggil dari mana pun. Fitur dirancang lalu
 * LUPA DIHUBUNGKAN, sehingga user tak pernah bisa memakainya.
 *
 * SEKARANG tersambung ke jalur perintah:
 *   /kebiasaan                    -> daftar + streak
 *   /kebiasaan tambah <nama>      -> mulai lacak
 *   /kebiasaan <nama>             -> centang hari ini
 *   /kebiasaan hapus <nomor>      -> berhenti lacak
 *   /cari <kata>                  -> cari catatan
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const NOTES = fs.readFileSync(new URL('../src/notes.ts', import.meta.url), 'utf8');

test('kebiasaan: fungsi tersedia (dipulihkan)', () => {
  for (const n of ['simpanKebiasaan', 'centangKebiasaan', 'daftarKebiasaan', 'formatDaftarKebiasaan', 'hapusKebiasaan']) {
    assert.ok(new RegExp(`export (async )?function ${n}\\b`).test(NOTES), `${n} harus ada`);
  }
});

test('kebiasaan: TERSAMBUNG ke jalur perintah (bukan kode mati lagi)', () => {
  // Ini inti perbaikan: fungsi harus benar-benar DIPANGGIL dari tanganiPencatatan.
  assert.ok(/\/\^\(\?:kebiasaan\|habit\|habits\)/.test(NOTES) || NOTES.includes('kebiasaan|habit|habits'),
    'harus ada pemicu perintah /kebiasaan');
  assert.ok(/await simpanKebiasaan\(/.test(NOTES), 'simpanKebiasaan harus DIPANGGIL');
  assert.ok(/await centangKebiasaan\(/.test(NOTES), 'centangKebiasaan harus DIPANGGIL');
  assert.ok(/await daftarKebiasaan\(/.test(NOTES), 'daftarKebiasaan harus DIPANGGIL');
  assert.ok(/await hapusKebiasaan\(/.test(NOTES), 'hapusKebiasaan harus DIPANGGIL');
});

test('cariCatatan: TERSAMBUNG ke perintah /cari', () => {
  assert.ok(/await cariCatatan\(/.test(NOTES), 'cariCatatan harus DIPANGGIL');
  assert.ok(NOTES.includes('perintah-cari'), 'harus ada jalur perintah-cari');
});

test('withContext: TERSAMBUNG ke webhook (correlation id)', () => {
  const webhook = fs.readFileSync(new URL('../api/webhook.ts', import.meta.url), 'utf8');
  assert.ok(webhook.includes('withContext'), 'withContext harus dipakai di webhook');
  assert.ok(webhook.includes('requestId'), 'harus membuat requestId dari update_id');
});

test('keyUsedAbsolute: dipertahankan dengan penanda jujur', () => {
  const quota = fs.readFileSync(new URL('../src/quota.ts', import.meta.url), 'utf8');
  assert.ok(quota.includes('keyUsedAbsolute'), 'fungsi harus ada');
  assert.ok(quota.includes('BELUM ADA PEMANGGIL'), 'harus jujur menyatakan belum ada pemanggil');
});
