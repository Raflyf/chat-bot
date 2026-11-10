import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const read = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const STATS = read('api/stats.ts');
const DASH = read('public/js/dashboard.js');
const ast = ts.createSourceFile('dashboard.js', DASH, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
function fn(name, context = {}) {
  const node = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
  assert.ok(node, name);
  return vm.runInNewContext(node.getText(ast) + '; ' + name, context);
}

test('monitoring: no metered probes; cache-only Groq/Cloudflare', () => {
  assert.ok(!STATS.includes('probeKunciCloudflare'));
  assert.ok(!STATS.includes('fetchGroqLimits('));
  assert.ok(!STATS.includes('fetchCloudflareLimits('));
  assert.ok(STATS.includes('getCachedLimits(cacheKeys.groq)'));
  assert.ok(STATS.includes('getCachedLimits(cacheKeys.cloudflare)'));
});

test('monitoring: UTC today reuses current quota rows, never period tokens', () => {
  assert.ok(STATS.includes("todayQuotasData = range === 'today' ? quotasData"));
  assert.ok(STATS.includes('quotaUsage(todayQuotasData, p.kind, hashes)'));
  assert.ok(STATS.includes('rawTokensToday: day.tokens'));
  assert.ok(STATS.includes('rawTokensPeriod: period.tokens'));
  assert.ok(STATS.includes("quotaTimeZone: 'UTC', quotaPlatform: 'all'"));
});

test('monitoring: cooldown and missing evidence are separate from healthy', () => {
  assert.ok(STATS.includes(".from('provider_cooldown')"));
  assert.ok(STATS.includes('cooldownAvailable = false'));
  const status = fn('keyStatus', {formatDateTime: value => value});
  assert.equal(status({status:'unknown'}).label, 'Belum diketahui');
  assert.equal(status({status:'capped'}).label, 'Dibatasi');
  const cd = status({cooldownAlasan:'concurrency', cooldownSampai:'2026-11-11T00:00:00Z'});
  assert.equal(cd.label,'Cooldown');
  assert.match(cd.detail,/kapasitas penuh/);
});

test('monitoring: card and table reuse same units and status, unknown bars absent', () => {
  const number = fn('metricNumber');
  const usage = fn('keyUsageHtml', {metricNumber:number,escapeHtml:String});
  assert.equal(number(null),'–');
  assert.equal(number(0),'0');
  const html = usage({used:4,tokensUsed:null,bindingPercent:null});
  assert.match(html,/4 panggilan tercatat hari ini/);
  assert.match(html,/Token belum terukur/);
  assert.doesNotMatch(html,/progress-bar-fill/);
  assert.ok(DASH.includes('keyUsageHtml(k)'));
  assert.ok(!DASH.includes('const tpdCap = 200000'));
  assert.ok(!DASH.includes('"Uncapped"'));
});
