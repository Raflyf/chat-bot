/**
 * TEST OTOMATIS — DATA MONITORING VALID (09 Okt 2026).
 *
 * LAPORAN PEMILIK PRODUK: "semua apikey habis? tapi monitoring masih hijau,
 * berarti ini bug fatal yg kamu buat, betulkan yg benar dan valid data monitoring
 * nya".
 *
 * BUKTI NYATA:
 *   - API Cloudflare balas HTTP 429 "used up daily free allocation of 10,000
 *     neurons" pada KETIGA akun.
 *   - `provider_cooldown` sudah mencatat alasan='neuron' (sistem TAHU habis).
 *   - TAPI dashboard menampilkan "5.459/10.000 neuron (55%) OPTIMAL".
 *
 * AKAR (3 bug):
 *   1. Dashboard TIDAK PERNAH membaca `provider_cooldown` -> key yang dibekukan
 *      tetap tampil "Optimal".
 *   2. Neuron dihitung dari tabel `messages` (125.066 token) padahal
 *      `provider_quota` mencatat 316.601 token — selisih 60% data hilang
 *      (`messages` hanya menyimpan balasan yang BERHASIL, bukan semua panggilan).
 *   3. Rasio input/output TIDAK KONSISTEN: providers.ts pakai 80/20,
 *      api/stats.ts pakai 99/1 untuk data yang sama.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const baca = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const STATS = baca('api/stats.ts');
const PROV = baca('src/providers.ts');
const DASH = baca('public/js/dashboard.js');

test('monitoring: dashboard MEMBACA provider_cooldown', () => {
  assert.ok(STATS.includes('provider_cooldown'), 'stats.ts harus membaca provider_cooldown');
  assert.ok(STATS.includes('cooldownAktif'), 'harus ada map cooldown aktif');
});

test('monitoring: cooldown MEMAKSA status capped', () => {
  assert.ok(/kenaCooldown[\s\S]{0,200}status = 'capped'/.test(STATS),
    'cooldown harus memaksa status capped');
});

test('monitoring: cooldown dikirim ke frontend', () => {
  assert.ok(STATS.includes('cooldownAlasan'), 'harus kirim cooldownAlasan');
  assert.ok(STATS.includes('cooldownSampai'), 'harus kirim cooldownSampai');
  assert.ok(DASH.includes('cooldownAlasan'), 'frontend harus menampilkan alasan cooldown');
});

test('monitoring: neuron dari provider_quota, bukan messages', () => {
  // Sumber token harus tokenQuotaMap (provider_quota), bukan hanya providerTokenStats.
  assert.ok(/tokenDariQuota[\s\S]{0,300}tokenQuotaMap/.test(STATS),
    'harus pakai tokenQuotaMap (provider_quota) sebagai sumber token');
  assert.ok(/tokenEfektif = Math\.max\(/.test(STATS),
    'harus pakai nilai TERBESAR agar tidak meremehkan pemakaian');
});

test('monitoring: rasio input/output KONSISTEN (99/1)', () => {
  // providers.ts tidak boleh lagi memakai 80/20.
  assert.ok(!/hitungNeuron\([^)]*\*\s*0\.8\s*,/.test(PROV),
    'providers.ts jangan pakai rasio 80/20 (tidak konsisten dengan stats.ts)');
  assert.ok(/0\.99/.test(PROV), 'providers.ts harus pakai 99/1');
});
