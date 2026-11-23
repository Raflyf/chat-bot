import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { config } from '../src/env.ts';
import { siapkanPromptUntukLocalAi } from '../src/providers.ts';
import { systemPrompt } from '../src/skills.ts';

const source = fs.readFileSync(new URL('../src/providers.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('providers.ts', source, ts.ScriptTarget.Latest, true);
function load(name, context) {
  const fn = ast.statements.find((n) => ts.isFunctionDeclaration(n) && n.name?.text === name);
  assert.ok(fn, name);
  const js = ts.transpile(fn.getText(ast), { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None });
  return vm.runInNewContext(js + '; ' + name, context);
}

test('siapkanPromptUntukLocalAi menghasilkan prefix statis 100% identik lintas user, cooldown stiker, energi rendah, dan grup', () => {
  const ownerPing = siapkanPromptUntukLocalAi([
    { role: 'system', content: systemPrompt({ chatId: 'wa_628991333323', history: [] }, null, 'p bot oyy') },
    { role: 'user', content: 'p bot oyy' },
  ]);
  const nonOwnerLowEnergy = siapkanPromptUntukLocalAi([
    {
      role: 'system',
      content: systemPrompt(
        {
          chatId: 'wa_628111111111',
          history: [
            { role: 'user', content: 'halo' },
            { role: 'assistant', content: 'haloo [Stiker terkirim: 😊]' },
          ],
        },
        null,
        'okeh',
      ),
    },
    { role: 'user', content: 'okeh' },
  ]);
  const groupTurn = siapkanPromptUntukLocalAi([
    {
      role: 'system',
      content: systemPrompt({ chatId: 'wa_120363000000001@g.us', history: [] }, null, '[Pesan di Grup dari Budi]: tes'),
    },
    { role: 'user', content: '[Pesan di Grup dari Budi]: tes' },
  ]);

  assert.equal(ownerPing[0].content, nonOwnerLowEnergy[0].content, 'prefix statis owner vs non-owner harus 100% identik');
  assert.equal(ownerPing[0].content, groupTurn[0].content, 'prefix statis private vs grup harus 100% identik');
  assert.ok(String(ownerPing[0].content).includes('IDENTITAS:'), 'identitas bot tetap utuh di prefix statis');
  assert.ok(String(ownerPing[0].content).includes('PRINSIP 1:'), 'aturan persona inti tetap utuh');
  assert.ok(String(ownerPing[1].content).includes('[STATUS LAWAN BICARA: TERVERIFIKASI RAFLY'), 'status owner terbawa di konteks aktif');
  assert.ok(String(nonOwnerLowEnergy[1].content).includes('[STATUS LAWAN BICARA: TEMAN BIASA'), 'status teman biasa terbawa di konteks aktif');
  assert.ok(String(nonOwnerLowEnergy[1].content).includes('[STIKER_BALASAN: NONAKTIF'), 'cooldown stiker terbawa di konteks aktif');
  assert.ok(String(ownerPing[1].content).includes('[WAKTU & KALENDER'), 'konteks waktu tetap terbawa di konteks aktif');
  assert.ok(String(ownerPing[1].content).endsWith('p bot oyy'), 'pesan asli pengguna tetap utuh di akhir');
});

test('siapkanPromptUntukLocalAi menjaga payload multimodal gambar utuh', () => {
  const sys = systemPrompt({ chatId: 'wa_628991333323', history: [] }, null, 'cek foto ini');
  const out = siapkanPromptUntukLocalAi([
    { role: 'system', content: sys },
    {
      role: 'user',
      content: [
        { type: 'text', text: 'cek foto ini' },
        { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,abc123' } },
      ],
    },
  ]);
  assert.ok(Array.isArray(out[1].content));
  assert.equal(out[1].content.some((p) => p.type === 'image_url' && p.image_url.url === 'data:image/jpeg;base64,abc123'), true);
});

test('siapkanPromptUntukLocalAi menjaga maks 6 pesan riwayat terbaru agar prefill CPU tidak timeout', () => {
  const sys = systemPrompt({ chatId: 'wa_628991333323', history: [] }, null, 'pesan terbaru');
  const longHistory = [];
  for (let i = 1; i <= 10; i++) {
    longHistory.push({ role: 'user', content: `lama user ${i}` });
    longHistory.push({ role: 'assistant', content: `lama bot ${i}` });
  }
  const out = siapkanPromptUntukLocalAi([
    { role: 'system', content: sys },
    ...longHistory,
    { role: 'user', content: 'pesan terbaru' },
  ]);
  // 1 system + 6 history terbaru + 1 user terbaru = 8 pesan
  assert.equal(out.length, 8);
  assert.equal(out[1].content, 'lama user 8');
  assert.ok(String(out.at(-1).content).endsWith('pesan terbaru'));
});

test('routing localai opsional: fail-closed tanpa key, primary/fallback sesuai prioritas, dan skip WebP', () => {
  const mkCfg = (overrides) => ({
    ...config,
    pools: { ...config.pools, localai: overrides.keys ?? [] },
    localAiUrl: overrides.url ?? '',
    localAiModel: overrides.model ?? 'ternary-bonsai-2-9b',
    localAiPriority: overrides.priority ?? 'fallback',
    localAiVision: overrides.vision ?? true,
  });

  // 1. Fail-closed bila URL ada tapi API key kosong
  const stepsNoKey = load('steps', { config: mkCfg({ url: 'https://example.test/v1', keys: [] }) });
  assert.equal(stepsNoKey().some((s) => s.kind === 'localai'), false);

  // 2. Fallback: berada di akhir setelah gemini
  const cfgFallback = mkCfg({ url: 'https://example.test/v1', keys: ['bsk_test'], priority: 'fallback' });
  const routesFallback = load('steps', { config: cfgFallback })();
  assert.equal(routesFallback.at(-1).kind, 'localai');
  assert.equal(routesFallback.at(-1).models[0], 'ternary-bonsai-2-9b');

  // 3. Primary: berada di urutan pertama (teks & vision JPEG), namun dilewati untuk stiker WebP
  const cfgPrimary = mkCfg({ url: 'https://example.test/v1', keys: ['bsk_test'], priority: 'primary' });
  const routesPrimary = load('steps', { config: cfgPrimary })();
  assert.equal(routesPrimary[0].kind, 'localai');

  const visionSteps = load('visionSteps', { config: cfgPrimary });
  const jpegMsg = [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AA==' } }] }];
  const webpMsg = [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/webp;base64,AA==' } }] }];
  assert.equal(visionSteps(routesPrimary, jpegMsg)[0].kind, 'localai');
  assert.equal(visionSteps(routesPrimary, webpMsg).some((s) => s.kind === 'localai'), false);
});
