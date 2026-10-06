/**
 * TEST OTOMATIS — batas Cloudflare adalah NEURON, bukan token (06 Okt 2026).
 *
 * KENAPA: "knapa model cloudflare tidak terpakai ya? langsung lompat ke opencode?
 * padahal di monitoring belum limit"
 *
 * AKAR: DAILY_TOKEN_CAP_CLOUDFLARE=10000 dibandingkan dengan TOKEN (15.841),
 * padahal Cloudflare membatasi NEURON. 15.841 token ≈ 1.440 neuron dari 10.000
 * (baru 14,4%) tetapi guard menganggapnya HABIS.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { hitungNeuron, NEURON_HARIAN_GRATIS } from '../src/neuron.js';

const PR = fs.readFileSync(new URL('../src/providers.ts', import.meta.url), 'utf8');

test('cloudflare: ada helper cekKeyBolehDipakai (satuan benar)', () => {
  assert.match(PR, /async function cekKeyBolehDipakai/, 'harus ada helper');
  assert.match(PR, /step\.kind === 'cloudflare' && keyTokenCap > 0/, 'harus cabang khusus cloudflare');
});

test('cloudflare: token dikonversi ke neuron sebelum dibandingkan', () => {
  assert.match(PR, /hitungNeuron\(/, 'harus pakai hitungNeuron');
  assert.match(PR, /neuronTerpakai >= keyTokenCap/, 'harus bandingkan neuron dengan cap');
});

test('cloudflare: DIPAKAI saat token jauh di bawah cap neuron', () => {
  const model = '@cf/qwen/qwen3.8-27b';
  const neuron = hitungNeuron(15841 * 0.8, 15841 * 0.2, model);
  assert.ok(neuron < NEURON_HARIAN_GRATIS, `1.440 neuron harus < 10.000 (dapat ${neuron})`);
});

test('cloudflare: dilewati HANYA bila neuron benar-benar habis', () => {
  const model = '@cf/qwen/qwen3.8-27b';
  const neuron = hitungNeuron(209738 * 0.8, 209738 * 0.2, model);
  assert.ok(neuron >= NEURON_HARIAN_GRATIS, `19.067 neuron harus >= 10.000 (dapat ${neuron})`);
});

test('cloudflare: kedua jalur (balapan + sekuensial) pakai helper', () => {
  const jumlah = (PR.match(/cekKeyBolehDipakai\(step, key, allowCoolingPass\)/g) || []).length;
  assert.ok(jumlah >= 2, `helper harus dipakai di >=2 jalur (dapat ${jumlah})`);
});
