import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';

process.env.DOTENV_CONFIG_PATH = 'NUL';
for (const key of Object.keys(process.env)) if (/^(SUPABASE_|DREAMPROMPTING_|CLOUDFLARE_|GROQ_|GEMINI_|OPENROUTER_|OPENCODE_)/.test(key)) delete process.env[key];
const actual = await import('../src/skills.ts');
const projectRequire = createRequire(new URL('../src/skills.ts', import.meta.url));
const source = fs.readFileSync(new URL('../src/skills.ts', import.meta.url), 'utf8');
function withChat(chat) {
  const mod = { exports: {} };
  const providers = { ...projectRequire('./providers.js'), chat };
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText, {
    module: mod, exports: mod.exports, require: name => name === './providers.js' ? providers : projectRequire(name),
    Buffer, console, process, URL, Date, setTimeout, clearTimeout,
  }, { filename: 'skills.ts' });
  return mod.exports;
}
const ctx = history => ({ history, corrections: [], summary: null, chatId: 'test-context' });

test('stiker: mood dari caption asli, bukan teks instruksi buatan sistem', async () => {
  let seen;
  const skills = withChat(async messages => { seen = messages; return { text: 'Wkwk masih disuruh cabut juga.', via: 'test/vision' }; });
  await skills.describeImage('fixture', 'image/png', 'becanda nih wkwk', ctx([]), true);
  assert.ok(seen[0].content.includes('PENGGUNA MENGIRIM STIKER') === false);
  assert.ok(!seen[0].content.includes('[SUASANA: dia lagi rapuh/sakit'));
  assert.ok(!seen[0].content.includes('ATURAN KERAS - SAAT DIA MENGELUH SAKIT'));
});

test('gaya: saling ledek tanpa kata tawa tidak otomatis kesal', () => {
  const prompt = actual.systemPrompt(ctx([{role:'user',content:'lu bot cupu'},{role:'assistant',content:'masih lu ajak ngobrol juga'},{role:'user',content:'dasar bolot lo'}]), null, 'garing lu jir');
  assert.ok(!prompt.includes('[SUASANA: temanmu sudah kesal beberapa pesan beruntun'));
  assert.ok(prompt.includes('[GAYA: kalian saling ledek & dia menikmatinya'));
});

test('gaya: keluhan lama tidak membekukan candaan baru', () => {
  const prompt = actual.systemPrompt(ctx([{role:'user',content:'ga nyambung jir'},{role:'assistant',content:'tadi meleset'},{role:'user',content:'kaku banget ga suka'}]), null, 'nenek lu jemping');
  assert.ok(!prompt.includes('[SUASANA: temanmu sudah kesal beberapa pesan beruntun'));
  assert.ok(prompt.includes('santai/gaul natural'));
  const ongoing = actual.systemPrompt(ctx([{role:'user',content:'dasar bolot lo'},{role:'assistant',content:'celetukan ringan'}]), null, 'nenek lu jemping');
  assert.ok(ongoing.includes('[GAYA: kalian saling ledek'));
});

test('gaya: sakit dan batas berhenti tetap dihormati', () => {
  const sick = actual.systemPrompt(ctx([]), null, 'aku pilek dan sakit kepala');
  assert.ok(sick.includes('[SUASANA: dia lagi rapuh/sakit'));
  const stop = actual.systemPrompt(ctx([{role:'user',content:'lu cupu wkwk'}]), null, 'jangan ngeledek aku, ini serius');
  assert.ok(stop.includes('[SUASANA: dia TIDAK mau di-ledek'));
});

test('regen stiker tetap membawa gambar dan mengganti atribusi model', async () => {
  const seen = [];
  const skills = withChat(async messages => {
    seen.push(messages);
    return seen.length === 1 ? {text:'Stiker ini berisi kucing.',via:'test/first'} : {text:'Wkwk masih disuruh cabut juga.',via:'test/second',tokens:{prompt:10,completion:5,total:15}};
  });
  const result = await skills.describeImage('fixture', 'image/png', 'becanda nih wkwk', ctx([]), true);
  assert.equal(seen.length, 2);
  assert.ok(seen[1].some(m => Array.isArray(m.content) && m.content.some(p => p.type === 'image_url')));
  assert.equal(result.via, 'test/second');
  assert.equal(result.tokens.total, 15);
  assert.match(result.reply, /Wkwk/i);
});

test('metadata stiker tidak tampil ke user atau menjadi reaksi user', async () => {
  const { stickerUserContent } = await import('../src/media.ts');
  const parsed = actual.extractStickerReadTag('Masih lu ajak ngobrol juga. [[sticker_read:LU PEGI DEH]]');
  assert.equal(parsed.text, 'Masih lu ajak ngobrol juga.');
  assert.equal(parsed.stickerText, 'LU PEGI DEH');
  const content = stickerUserContent('[Stiker Telegram]', 'becanda nih', parsed.stickerText);
  assert.ok(content.includes('LU PEGI DEH'));
  assert.ok(!content.includes('Masih lu ajak'));
  for (const name of ['telegram','whatsapp_cloud','whatsapp_baileys']) {
    const transport = fs.readFileSync(new URL('../src/' + name + '.ts', import.meta.url), 'utf8');
    assert.ok(!transport.includes('const deskripsiStiker ='));
    assert.ok(transport.includes("updateContextCache(chatKey, 'user', kontenStikerUser)"));
  }
});

test('cold start tetap memuat user via null dan batas cache sama', async () => {
  const memorySource = fs.readFileSync(new URL('../src/memory.ts', import.meta.url), 'utf8');
  const queries = [];
  const rows = [{role:'user',content:'nenek lu jemping',via:null,feedback:null},{role:'assistant',content:'celetukan lama',via:'opencode/fixture',feedback:null}];
  function query(table) {
    const q = { select(){return this;},eq(){return this;},not(){throw new Error('NULL user messages excluded');},or(value){queries.push(value);return this;},order(){return this;},limit(){return this;},maybeSingle(){return this;},then(resolve){return Promise.resolve({data:table==='messages'?rows:null,error:null}).then(resolve);} };
    return q;
  }
  const mod = { exports: {} };
  vm.runInNewContext(ts.transpileModule(memorySource, {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText, {module:mod,exports:mod.exports,require:name=>name==='./db.js'?{db:()=>({from:query})}:projectRequire(name),console,Date,process,setTimeout,clearTimeout});
  const context = await mod.exports.getContext('fixture-unique');
  assert.equal(context.history.filter(r=>r.role==='user').length,1);
  assert.ok(queries.includes('via.is.null,via.not.like.system/%'));
  assert.ok(memorySource.includes('cached.data.history.length > 40'));
});
