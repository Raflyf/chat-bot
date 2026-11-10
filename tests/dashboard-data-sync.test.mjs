import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { config } from '../src/env.ts';
import { hitungNeuron, NEURON_HARIAN_GRATIS } from '../src/neuron.ts';

const root = new URL('../', import.meta.url);
const read = p => fs.readFileSync(new URL(p, root), 'utf8');
const source = read('api/stats.ts');
const dash = read('public/js/dashboard.js');
// Authorized, sanitized stats snapshot supplied by Lead; no chat content or credentials.
const before = JSON.parse(read('tests/fixtures/dashboard-quota-before.json'));
const now = '2026-11-10T17:30:00.000Z';
class Clock extends Date {
  constructor(...args) { super(...(args.length ? args : [now])); }
  static now() { return Date.parse(now); }
}
const pools = Object.fromEntries(before.pools.map(p => [p.kind, p.kind === 'opencode' ? ['public'] : p.keys.map((_, i) => 'test-' + p.kind + '-' + i)]));
const quotas = before.pools.flatMap(p => p.keys.map((k, i) => ({
  kind: p.kind, key_suffix: crypto.createHash('sha256').update(pools[p.kind][i]).digest('hex').slice(0, 12),
  day: '2026-11-10', used: k.dbUsed,
  // CF snapshot values are neurons, not source tokens; do not misrepresent them.
  tokens_used: p.kind === 'cloudflare' ? null : (k.dbUsed ? k.tokensUsed : 0),
})));
const messages = before.modelsBreakdown.flatMap(m => Array.from({length: m.count}, (_, i) => ({
  id: m.name + '-' + i, role: 'assistant', via: m.name, platform: 'telegram',
  created_at: '2026-11-10T16:00:00.000Z', total_tokens: 0, prompt_tokens: 0, completion_tokens: 0,
})));

function loadApi({oldRows = [], fail = false, authenticated = true} = {}) {
  class Query {
    constructor(table) { this.table = table; this.predicates = []; this.take = null; this.offset = 0; }
    select(_columns, options = {}) { this.head = options.head; return this; }
    eq(field, value) { this.predicates.push(r => r[field] === value); return this; }
    gte(field, value) { this.predicates.push(r => r[field] >= value); return this; }
    gt(field, value) { this.predicates.push(r => r[field] > value); return this; }
    order() { return this; }
    limit(n) { this.take = n; return this; }
    range(start, end) { this.offset = start; this.take = end - start + 1; return this; }
    then(resolve, reject) {
      let rows = this.table === 'provider_quota' ? [...quotas, ...oldRows] : this.table === 'messages' ? messages : [];
      rows = rows.filter(r => this.predicates.every(f => f(r)));
      const count = rows.length;
      rows = rows.slice(this.offset, this.take === null ? undefined : this.offset + this.take);
      return Promise.resolve({data: this.head ? null : rows, count, error: fail ? new Error('fixture DB unavailable') : null}).then(resolve, reject);
    }
  }
  const api = {};
  const modules = {
    '../src/env.js': { config: {...config, pools} },
    '../src/db.js': { db: () => ({from: table => new Query(table)}) },
    '../src/admin_auth.js': {extractSessionToken: () => 'test-session', verifySessionToken: async () => authenticated},
    '../src/limits.js': {fetchOpenRouterLimits: async () => new Map(), fetchDreamPromptingLimits: async () => new Map(), getCachedLimits: () => null},
    '../src/neuron.js': {hitungNeuron, NEURON_HARIAN_GRATIS},
    crypto, fs, path, url: {fileURLToPath},
  };
  const js = ts.transpileModule(source.replaceAll('import.meta.url', JSON.stringify(new URL('api/stats.ts', root).href)), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true},
  }).outputText;
  vm.runInNewContext(js, {exports: api, require: id => {assert.ok(id in modules, id); return modules[id];}, Date: Clock, console: {error() {}},
    fetch: () => {throw new Error('Unexpected network');}}, {filename: 'stats.ts'});
  return api;
}
async function request(api, range = 'today', platform = 'all') {
  let code, body;
  const headers = {};
  const response = {setHeader: (k,v) => {headers[k]=v;}, status(n) {code=n; return this;}, json(v) {body=v;}};
  await api.default({method: 'GET', query: {range, platform}}, response);
  return {code, body, headers};
}
function uiContext() {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {textContent:'', innerHTML:'', style:{}, classList:{add(){},remove(){},toggle(){}}, parentElement:{removeAttribute(){}}});
    return elements.get(id);
  };
  const context = vm.createContext({document:{hidden:false,getElementById:element,querySelectorAll:()=>[]}, console,
    currentProviderFilter:'all', currentKeyStatusFilter:'all',currentTimeRange:'today', window:{}, localStorage:{getItem:()=>null,setItem(){}},
    escapeHtml:s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),
    formatDateTime:s=>s, setHtmlIfChanged:(el,html)=>{el.innerHTML=html;}});
  const ast = ts.createSourceFile('dashboard.js',dash,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  assert.equal(ast.parseDiagnostics.length,0);
  const names = ['modelUsageId','metricNumber','keyStatus','keyUsageHtml','renderPoolMatrix','renderLiveUpstreamTable','renderWebSearchPanel','renderAiModelMatrix'];
  for (const node of ast.statements) if(ts.isFunctionDeclaration(node) && names.includes(node.name?.text)) vm.runInContext(node.getText(ast),context);
  return {context,element};
}

test('handler: live snapshot regression, today equals period, distinct replies and unknown tokens', async () => {
  const {code,body,headers}=await request(loadApi());
  assert.equal(code,200);
  assert.match(headers['Cache-Control'],/no-store/);
  assert.equal(before.pools[0].usedToday,0);
  const oc=body.pools.find(p=>p.kind==='opencode');
  assert.equal(oc.usedToday,11);
  assert.equal(oc.usedPeriod,11);
  assert.equal(oc.repliesPeriod,9);
  assert.equal(oc.keyCount,0);
  assert.equal(oc.keys[0].status,'unknown');
  assert.equal(oc.keys[0].remaining,null);
  assert.equal(body.summary.totalCallsToday,16);
  assert.equal(body.summary.totalCallsPeriod,16);
  assert.equal(body.summary.totalKeys,15);
  assert.equal(body.summary.totalTokensToday,null);
  assert.equal(body.pools.find(p=>p.kind==='cloudflare').rawTokensToday,null);
  assert.equal(body.webSearch.quotaApplicable,false);
  assert.equal(body.webSearch.usedToday,null);
  assert.equal(body.modelsBreakdown.find(m=>m.name==='reminder').count,2);
  const {context,element}=uiContext();
  for(const fn of ['renderPoolMatrix','renderLiveUpstreamTable','renderWebSearchPanel','renderAiModelMatrix']) context[fn](body);
  assert.equal((element('pool-grid').innerHTML.match(/class="provider-card"/g)||[]).length,6);
  assert.equal((element('live-upstream-tbody').innerHTML.match(/<tr /g)||[]).length,16);
  assert.match(element('pool-grid').innerHTML,/11 panggilan tercatat/);
  assert.match(element('live-upstream-tbody').innerHTML,/opencode.ai\/inference\/v1/);
  assert.doesNotMatch(element('live-upstream-tbody').innerHTML,/Dahl|Zen|OPTIMAL|Pemakaian upstream/);
  assert.equal(element('upstream-total-cap').textContent,'16 panggilan');
  assert.equal(element('upstream-total-used').textContent,'Belum lengkap');
  assert.equal(element('websearch-remaining').textContent,'Tidak berlaku');
  assert.equal(element('websearch-bar-fill').parentElement.hidden,true);
  assert.match(element('matrix-cards-grid').innerHTML,/Balasan tersimpan/);
});

test('handler: older periods never leak into today; platform leaves global quota explicit', async()=>{
  const api=loadApi({oldRows:[{...quotas[0],day:'2026-11-09',used:90,tokens_used:9000}]});
  const {body}=await request(api,'7d','whatsapp');
  assert.equal(body.summary.totalCallsToday,16);
  assert.equal(body.summary.totalCallsPeriod,106);
  assert.equal(body.pools[0].usedToday,11);
  assert.equal(body.pools[0].usedPeriod,101);
  assert.equal(body.summary.totalRepliesPeriod,0);
  assert.equal(body.quotaPlatform,'all');
  assert.equal(body.period.start,'2026-11-04T00:00:00.000Z');
});

test('handler: DB/auth failure never produces green empty data', async()=>{
  assert.equal((await request(loadApi({fail:true}))).code,500);
  assert.equal((await request(loadApi({authenticated:false}))).code,401);
});

test('render: compact badges, scrolling and visible-only guarded cadence',()=>{
  const css=read('public/css/console.css');
  assert.match(css,/\.badge-live-sync, \.badge-bot-sync \{ white-space: nowrap/);
  assert.match(css,/#live-upstream-section \.table-wrap \{[^}]*overflow-x: auto/);
  assert.ok(dash.includes('const REFRESH_MS = 5000'));
  assert.ok(dash.includes('if (!autoRefresh || document.hidden) return'));
  assert.ok(dash.includes('generation !== statsGeneration'));
  assert.ok(dash.includes('statsRequest?.cacheKey === cacheKey'));
  assert.ok(!source.includes('probeKunciCloudflare'));
  assert.ok(!source.includes('fetchGroqLimits('));
});
