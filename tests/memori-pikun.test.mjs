/**
 * TEST OTOMATIS — memori anti-pikun (perbaikan 06 Okt 2026).
 *
 * KENAPA: "bot nya masih terasa pikun, lupa apa yang sudah dia bilang sebelumnya,
 * tapi emang sudah aga lama percakapannya".
 *
 * AKAR 1: ringkasan lama DITIMPA ringkasan baru (hanya 60 pesan terakhir)
 *         -> percakapan panjang kehilangan ingatan awalnya.
 * AKAR 2: counter ringkasan ada di MEMORI -> tidak pernah mencapai 6 di Vercel.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const MEM = fs.readFileSync(new URL('../src/memory.ts', import.meta.url), 'utf8');

test('pikun: ringkasan AKUMULATIF (gabung lama + baru)', () => {
  assert.ok(MEM.includes('CATATAN LAMA'), 'harus ambil ringkasan lama');
  assert.ok(MEM.includes('GABUNGKAN catatan lama dengan informasi baru'), 'harus gabung');
  assert.ok(MEM.includes('JANGAN membuang fakta lama'), 'harus larang buang fakta lama');
});

test('pikun: ringkasan lama dibaca sebelum diperbarui', () => {
  assert.ok(MEM.includes('ringkasanLama'), 'harus ada variabel ringkasanLama');
  assert.match(MEM, /from\('summaries'\)\s*\.select\('summary'\)/, 'harus baca summaries dulu');
});

test('pikun: counter berbasis DB (bukan hanya memori)', () => {
  assert.ok(MEM.includes("count: 'exact'"), 'harus hitung jumlah pesan di DB');
  assert.ok(MEM.includes('count < 8'), 'harus cek minimal 8 pesan');
});

test('pikun: ringkasan dibatasi 1500 karakter', () => {
  assert.ok(MEM.includes('Maksimal 1500 karakter'), 'harus batasi panjang');
});

test('pikun: instruksi perbarui bila bertentangan', () => {
  assert.ok(MEM.includes('PAKAI yang baru'), 'harus pakai info terbaru bila bertentangan');
});
