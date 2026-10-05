/**
 * TEST OTOMATIS — konversi neuron Cloudflare.
 *
 * KENAPA: bug nyata 06 Okt 2026 — dashboard menyamakan neuron dengan token,
 * sehingga 14.000 token dianggap "habis" dari kuota 10.000 neuron.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hitungNeuron, neuronPerBalasanKhas, sisaBalasan, NEURON_HARIAN_GRATIS, tarifModel } from '../src/neuron.js';

test('tarifModel: model dikenal mengembalikan tarif resmi', () => {
  const t = tarifModel('@cf/qwen/qwen3.8-27b');
  assert.equal(t.inputPerJuta, 40909);
  assert.equal(t.outputPerJuta, 290909);
});

test('tarifModel: model tak dikenal pakai tarif konservatif', () => {
  const t = tarifModel('@cf/model-tidak-ada');
  assert.ok(t.inputPerJuta > 0);
  assert.ok(t.outputPerJuta > 0);
});

test('hitungNeuron: 14.000 token BUKAN 14.000 neuron (inti bug)', () => {
  const neuron = hitungNeuron(11200, 2800, '@cf/qwen/qwen3.8-27b');
  assert.ok(neuron < 10000, `neuron harus < 10.000, dapat ${neuron}`);
  assert.ok(neuron > 0);
  // Harus jauh lebih kecil dari jumlah token
  assert.ok(neuron < 14000, 'neuron tidak boleh sama dengan token');
});

test('hitungNeuron: token 0 -> neuron 0', () => {
  assert.equal(hitungNeuron(0, 0, '@cf/qwen/qwen3.8-27b'), 0);
});

test('hitungNeuron: model murah lebih hemat dari model mahal', () => {
  const murah = hitungNeuron(10000, 1000, '@cf/meta/llama-3.2-3b-instruct');
  const mahal = hitungNeuron(10000, 1000, '@cf/qwen/qwen3.8-27b');
  assert.ok(murah < mahal, `model murah (${murah}) harus < mahal (${mahal})`);
});

test('neuronPerBalasanKhas: masuk akal (< kuota harian)', () => {
  const per = neuronPerBalasanKhas('@cf/qwen/qwen3.8-27b');
  assert.ok(per > 0);
  assert.ok(per < NEURON_HARIAN_GRATIS, `satu balasan tidak boleh melebihi kuota harian (${per})`);
});

test('sisaBalasan: kuota penuh -> puluhan balasan', () => {
  const n = sisaBalasan(NEURON_HARIAN_GRATIS, '@cf/qwen/qwen3.8-27b');
  assert.ok(n >= 10, `harusnya >= 10 balasan, dapat ${n}`);
});

test('sisaBalasan: kuota nol -> 0', () => {
  assert.equal(sisaBalasan(0, '@cf/qwen/qwen3.8-27b'), 0);
});

test('hitungNeuron: output lebih mahal dari input', () => {
  const input = hitungNeuron(1000, 0, '@cf/qwen/qwen3.8-27b');
  const output = hitungNeuron(0, 1000, '@cf/qwen/qwen3.8-27b');
  assert.ok(output > input, 'output harus lebih mahal (290909 > 40909 per juta)');
});
