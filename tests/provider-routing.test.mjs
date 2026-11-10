import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import crypto from 'node:crypto';
import { config } from '../src/env.ts';

const source = fs.readFileSync(new URL('../src/providers.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('providers.ts', source, ts.ScriptTarget.Latest, true);
function load(name, context) {
  const fn = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
  assert.ok(fn, name);
  const js = ts.transpile(fn.getText(ast), { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None });
  return vm.runInNewContext(js + '; ' + name, context);
}

test('runtime tier mengikuti kontrak tanpa Dahl/NIM', () => {
  const steps = load('steps', { config });
  const routes = steps();
  assert.equal(routes.map(s => s.kind).join(','), 'opencode,cloudflare,groq,dreamprompting,openrouter,gemini');
  assert.equal(routes[0].models.join(','), 'deepseek-v4.1-flash-free,glm-5.3-flash-free');
  assert.equal(routes[3].models.join(','), 'groq/qwen/qwen3.8-27b');
  assert.ok(config.models.visionChain.every(v => routes.some(s => s.kind === v.kind)));
});

test('race memilih hasil pertama dan membatalkan request yang kalah', async () => {
  let cancelled = false;
  const failures = [];
  const race = load('balapanModelDalamTier', {
    config: { ...config, raceStaggerMs: 1 }, AbortController, setTimeout, Date,
    getOrderedKeys: (_, keys) => keys, cekKeyBolehDipakai: async () => true,
    isModelCoolingDown: () => false, recordKeySuccess() {}, recordModelLatency() {},
    keyUsed() {}, keyTokensUsed() {}, recordKeyFailure: (...args) => failures.push(args),
  });
  const step = { kind: 'opencode', keys: ['public'], run: (_, model, __, ___, signal) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve({ text: model }), model === 'primary' ? 20 : 500);
    signal.addEventListener('abort', () => { clearTimeout(timer); if (model === 'backup') cancelled = true; reject(new Error('aborted')); }, { once: true });
  }) };
  const result = await race(step, ['primary', 'backup'], [], Date.now() + 2000, false);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(result.model, 'primary');
  assert.equal(cancelled, true);
  assert.equal(failures.length, 0);
});

test('OpenCode menjaga input multimodal dan sesi stabil', async () => {
  const session = load('opencodeSession', { crypto, Date, opencodeSessionCache: undefined });
  const requests = [];
  const call = load('opencodeChat', {
    config, opencodeSession: session, process: { cwd: () => '/app', platform: 'linux' },
    join: (...parts) => parts.join('/'), tmpdir: () => '/tmp', OPENCODE_BASE: 'https://opencode.ai/inference/v1',
    messagesContainImage: () => true, openAiDelta() {}, openAiUsage() {}, opencodeFetch() {},
    streamSse: async (...args) => { requests.push(args); return { text: 'ok' }; },
  });
  const input = [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,fixture' } }] }];
  await call('public', config.models.opencodePrimary, input, 1000);
  await call('public', config.models.opencodeBackup[0], input, 1000);
  assert.equal(requests[0][0], 'https://opencode.ai/inference/v1/chat/completions');
  assert.match(requests[0][1]['x-opencode-session'], /^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/);
  assert.equal(requests[0][1]['x-opencode-session'], requests[1][1]['x-opencode-session']);
  assert.equal(requests[0][2].messages.at(-1).content, input[0].content);
  assert.equal(input.length, 1);
  assert.equal(requests[0][2].tools.map(t => t.function.name).join(','), 'read,shell');
});

test('neuron habis hanya membekukan key terkait', () => {
  const updates = [];
  const failure = load('recordKeyFailure', { config, Date, keyHash: key => key, msUntilDailyResetUtc: () => 1000, setCooldownPersist: (...args) => updates.push(args) });
  failure('cloudflare', 'capped-key', new Error('daily free allocation of neurons'));
  assert.equal(updates.length, 1);
  assert.equal(updates[0][0], 'cloudflare:capped-key');
  assert.equal(updates[0][2], 'neuron');
});
