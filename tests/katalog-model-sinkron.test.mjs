import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { config } from '../src/env.ts';
import { getModelCatalog } from '../api/stats.ts';

const DASH = fs.readFileSync(new URL('../public/js/dashboard.js', import.meta.url), 'utf8');
const STATS = fs.readFileSync(new URL('../api/stats.ts', import.meta.url), 'utf8');
const helper = DASH.slice(DASH.indexOf('function modelUsageId('), DASH.indexOf('const SESSION_TOKEN_KEY'));
const modelUsageId = vm.runInNewContext(helper + '; modelUsageId');
const catalog = getModelCatalog();
const m = config.models;
const text = [
  ['opencode', [m.opencodePrimary, ...m.opencodeBackup]],
  ['cloudflare', [m.cfPrimary, ...m.cfBackup]],
  ['groq', [m.groqPrimary, ...m.groqBackup]],
  ['dreamprompting', [m.dpPrimary, ...m.dpBackup]],
  ['openrouter', [m.orPrimary, ...m.orBackup]],
  ['gemini', [m.geminiPrimary, ...m.geminiBackup]],
];

test('katalog API mencakup semua model runtime tepat sekali per provider', () => {
  const expected = new Set(text.flatMap(([p, models]) => models.map(model => p + '/' + model)));
  for (const v of m.visionChain) expected.add(v.kind + '/' + v.model);
  for (const model of m.geminiVision) expected.add('gemini/' + model);
  for (const model of [m.groqWhisperPrimary, m.groqWhisperBackup]) expected.add('groq/' + model);
  expected.add('cloudflare/' + m.cfWhisper);
  assert.deepEqual(new Set(catalog.map(c => c.id)), expected);
  assert.equal(catalog.length, expected.size);
  assert.deepEqual([...new Set(catalog.map(c => c.provider))], text.map(([p]) => p));
  for (const [index, [p, models]] of text.entries()) {
    for (const model of models) assert.equal(catalog.find(c => c.id === p + '/' + model)?.tier, index + 1);
  }
  assert.ok(catalog.every(c => !['dahl', 'nvidia'].includes(c.provider)));
  assert.ok(DASH.includes('data.modelCatalog'));
});

test('model qualified dan prefiks media cocok tepat satu kartu, tanpa silang gateway', () => {
  for (const card of catalog) {
    for (const via of [card.id, 'local-parser/' + card.id + '#t=12,3,15']) {
      assert.equal(catalog.filter(c => c.id.toLowerCase() === modelUsageId(via)).length, 1, via);
    }
  }
  assert.notEqual(modelUsageId('groq/qwen/qwen3.8-27b'), modelUsageId('dreamprompting/groq/qwen/qwen3.8-27b'));
  assert.notEqual(modelUsageId('openrouter/nvidia/nemotron-3.5-super-vl:free'), modelUsageId('nvidia/nemotron-3.5-super-vl:free'));
  assert.equal(modelUsageId('qwen3.8'), '');
});

test('penghitungan menjumlahkan prefiks media tanpa mengambil hit pertama saja', () => {
  const match = DASH.match(/function getCount\(matchKeys\) \{[\s\S]*?\n      \}/);
  assert.ok(match);
  const count = vm.runInNewContext(helper + '\n' + match[0] + '; getCount', {
    modelsBreakdown: [
      { name: 'groq/qwen/qwen3.8-27b', count: 2 },
      { name: 'local-parser/groq/qwen/qwen3.8-27b#t=1,2,3', count: 3 },
      { name: 'dreamprompting/groq/qwen/qwen3.8-27b', count: 7 },
    ],
  });
  assert.equal(count(['groq/qwen/qwen3.8-27b']), 5);
  assert.equal(count(['dreamprompting/groq/qwen/qwen3.8-27b']), 7);
  assert.ok(!STATS.includes('&& isModelActive(model) &&'), 'histori tidak boleh disaring dengan katalog aktif');
  assert.ok(!DASH.includes('keyLower.includes(kl)'), 'MRU tidak boleh cocok substring');
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
