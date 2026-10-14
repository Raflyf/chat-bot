/**
 * TEST OTOMATIS — katalog model dashboard WAJIB sinkron dengan config.
 *
 * LAPORAN PEMILIK PRODUK (12 Okt 2026): "update juga model AI distribusinya agar
 * singkron dengan semua model yg dipakai dan yg tidak dipakai nya hilangkan".
 *
 * TEMUAN NYATA pada katalog dashboard (public/js/dashboard.js):
 *   - "GPT-OSS 20B (CF)" masih tampil padahal SUDAH DIHAPUS dari config.
 *   - "Mistral Small 3.1 24B (CF)" masih tampil padahal sudah diganti.
 *   - Model baru "Llama 3.2 11B Vision (CF)" belum ada.
 *   - "Gemini 3.1 Flash Lite" salah nama (config: gemini-flash-lite-latest).
 *   - Model OpenCode tertulis "Tier 8" padahal Tier 3.
 *
 * Test ini memastikan: setiap model di config ADA di katalog, dan tidak ada entri
 * katalog yang modelnya sudah tidak dipakai lagi.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const ENV = fs.readFileSync(new URL('../src/env.ts', import.meta.url), 'utf8');
const DASH = fs.readFileSync(new URL('../public/js/dashboard.js', import.meta.url), 'utf8');

function modelConfig() {
  const blok = ENV.slice(ENV.indexOf('models: {'), ENV.indexOf('visionChain:'));
  const set = new Set();
  for (const m of blok.matchAll(/'([^']+)'/g)) {
    const v = m[1];
    if (v.includes('/') || v.startsWith('@cf/') || /^(mimo|muse|big-|gemini-)/.test(v)) set.add(v);
  }
  const vb = ENV.slice(ENV.indexOf('visionChain: ['), ENV.indexOf('] as Array', ENV.indexOf('visionChain: [')));
  for (const m of vb.matchAll(/model: '([^']+)'/g)) set.add(m[1]);
  return set;
}

function katalog() {
  const cat = DASH.slice(DASH.indexOf('      const catalog = ['), DASH.indexOf('      ];\n\n      // Urutan Model Berbasis MRU'));
  return [...cat.matchAll(/name:\s*"([^"]+)"[\s\S]*?matchKeys:\s*\[([^\]]+)\]/g)]
    .map((m) => ({ nama: m[1], keys: [...m[2].matchAll(/"([^"]+)"/g)].map((k) => k[1]) }));
}

const norm = (s) => s.toLowerCase().replace(/^[a-z]+\//, '');
const cocok = (a, b) => a === b || a.endsWith(b) || b.endsWith(a);

test('katalog model: setiap model di config ADA di katalog', () => {
  const cfg = modelConfig();
  const cat = katalog();
  const catKeys = cat.flatMap((e) => e.keys.map(norm));
  const hilang = [...cfg].filter((m) => !catKeys.some((k) => cocok(k, norm(m))));
  assert.deepEqual(hilang, [], `model config yang belum ada di katalog: ${hilang.join(', ')}`);
});

test('katalog model: tidak ada entri USANG (model sudah tidak dipakai)', () => {
  const cfg = [...modelConfig()].map(norm);
  const cat = katalog();
  // "Groq Whisper Turbo" = model transkripsi (dipakai di media.ts, bukan config.models).
  const pengecualian = ['groq whisper turbo'];
  const usang = cat
    .filter((e) => !pengecualian.includes(e.nama.toLowerCase()))
    .filter((e) => !e.keys.map(norm).some((k) => cfg.some((c) => cocok(k, c))))
    .map((e) => e.nama);
  assert.deepEqual(usang, [], `entri katalog usang: ${usang.join(', ')}`);
});

test('katalog model: mistral & gpt-oss-20b SUDAH TIDAK ADA', () => {
  const cat = katalog();
  const nama = cat.map((e) => e.nama.toLowerCase()).join(' | ');
  const keys = cat.flatMap((e) => e.keys).join(' ').toLowerCase();
  assert.ok(!/mistral/.test(nama + keys), 'mistral harus sudah dihapus dari katalog');
  assert.ok(!/gpt-oss-20b/.test(keys), 'gpt-oss-20b harus sudah dihapus dari katalog');
});

test('cooldown: "concurrency capacity" BUKAN limit harian (rpd)', () => {
  const PROV = fs.readFileSync(new URL('../src/providers.ts', import.meta.url), 'utf8');
  // Harus ada alasan 'concurrency' terpisah dari 'rpd'.
  assert.ok(/'concurrency'/.test(PROV), 'harus ada alasan cooldown "concurrency"');
  // Pola concurrency TIDAK boleh lagi berada di baris yang sama dengan insufficient_quota.
  const barisQuota = PROV.split('\n').find((l) => /insufficient_quota/.test(l) && /test\(msg\)/.test(l));
  assert.ok(barisQuota, 'harus ada baris pola kuota habis');
  assert.ok(!/concurrency capacity/.test(barisQuota), 'concurrency TIDAK boleh digabung dengan kuota habis');
  // Label dashboard untuk concurrency.
  assert.ok(/kapasitas penuh/.test(DASH), 'dashboard harus melabeli concurrency sebagai "kapasitas penuh"');
});
