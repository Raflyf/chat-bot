#!/usr/bin/env tsx
/**
 * Generator peta kodebase: docs/codebase-index.json + CODEBASE_MAP.md
 *
 * KENAPA: agen yang mengaudit satu berkas tidak perlu memindai seluruh repo.
 * Jalankan `npm run map:codebase` setelah menambah/memindahkan modul.
 * Read-only: tidak mengubah kode aplikasi, hanya membaca AST TypeScript.
 */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root = process.cwd();
const AREAS = ['src', 'api', 'public', 'tests', 'sql', 'scripts'];
const SKIP = /node_modules|[\\/]\.git[\\/]|public[\\/]stickers|scratch[\\/]|dist[\\/]/;

function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (SKIP.test(p)) continue;
    if (e.isDirectory()) walk(p, acc);
    else if (/\.(ts|mjs|js|sql|py|html|css)$/.test(e.name)) acc.push(p);
  }
  return acc;
}

function importTarget(fromRel, spec) {
  if (!spec.startsWith('.')) return null;
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), spec));
  const cands = [base + '.ts', base + '.mjs', base + '.js', base + '/index.ts', base.replace(/\.js$/, '.ts'), base.replace(/\.mjs$/, '.ts')];
  for (const c of cands) if (fs.existsSync(path.join(root, c))) return c;
  return null;
}

function docOf(rel) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) return '';
  const out = [];
  let block = false;
  for (const raw of fs.readFileSync(abs, 'utf8').split('\n').slice(0, 40)) {
    const l = raw.trim();
    if (block) { if (l.includes('*/')) { block = false; continue; } out.push(l.replace(/^\*\s?/, '')); continue; }
    if (l.startsWith('/**')) { block = true; continue; }
    if (l.startsWith('//')) { out.push(l.replace(/^\/\/\s?/, '')); continue; }
    if (l === '' || l.startsWith('/*')) continue;
    break;
  }
  return out.filter((l) => l && !/^=+$/.test(l)).slice(0, 3).join(' ').replace(/\s+/g, ' ').trim().slice(0, 180);
}

const files = AREAS.flatMap((d) => walk(path.join(root, d)));
const records = [];

for (const f of files) {
  const rel = path.relative(root, f).replaceAll('\\', '/');
  const text = fs.readFileSync(f, 'utf8');
  const rec = { path: rel, lines: text.split('\n').length, kind: rel.split('/')[0], exports: [], imports: [], tests: [] };
  if (/\.(ts|mjs|js)$/.test(rel)) {
    const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, rel.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS);
    const add = (arr, v) => { if (v && !arr.includes(v)) arr.push(v); };
    const visit = (node) => {
      const mods = ts.canHaveModifiers(node) ? ts.getModifiers(node) || [] : [];
      const exported = mods.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) add(rec.imports, node.moduleSpecifier.text);
      if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) add(rec.imports, node.moduleSpecifier.text);
      if (exported && ts.isFunctionDeclaration(node) && node.name) add(rec.exports, 'fn ' + node.name.text);
      if (exported && ts.isClassDeclaration(node) && node.name) add(rec.exports, 'class ' + node.name.text);
      if (exported && ts.isInterfaceDeclaration(node)) add(rec.exports, 'iface ' + node.name.text);
      if (exported && ts.isTypeAliasDeclaration(node)) add(rec.exports, 'type ' + node.name.text);
      if (exported && ts.isVariableStatement(node)) {
        for (const d of node.declarationList.declarations) if (ts.isIdentifier(d.name)) add(rec.exports, 'const ' + d.name.text);
      }
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && ['test', 'describe', 'it'].includes(node.expression.text)) {
        const a = node.arguments[0];
        if (a && ts.isStringLiteral(a)) add(rec.tests, a.text);
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  if (rel.endsWith('.sql')) {
    for (const m of text.matchAll(/create\s+(?:or\s+replace\s+)?(?:table|view|function|index)\s+(?:if\s+not\s+exists\s+)?([a-z0-9_.]+)/gi)) {
      const obj = 'sql ' + m[1];
      if (!rec.exports.includes(obj)) rec.exports.push(obj);
    }
  }
  records.push(rec);
}
records.sort((a, b) => a.path.localeCompare(b.path));

const deps = new Map();
const rev = new Map();
for (const r of records) {
  const set = new Set();
  for (const spec of r.imports) { const t = importTarget(r.path, spec); if (t && t !== r.path) set.add(t); }
  deps.set(r.path, set);
  for (const t of set) { if (!rev.has(t)) rev.set(t, new Set()); rev.get(t).add(r.path); }
}

fs.mkdirSync('docs', { recursive: true });
fs.writeFileSync('docs/codebase-index.json', JSON.stringify(records, null, 1));

const L = [];
const P = (s) => L.push(s);
P('# CODEBASE MAP — FreeAIBot');
P('');
P('Peta navigasi read-only. Agen yang mengaudit atau mengubah satu berkas bisa langsung menuju sasaran tanpa memindai seluruh repo.');
P('');
P('Dihasilkan oleh `npm run map:codebase` dari AST repo lokal. Tidak ada kode aplikasi yang diubah.');
P('');
P('## Cara pakai');
P('');
P('1. Cari topik di **Peta cepat: topik ke file**.');
P('2. Sebelum mengubah berkas bersama, baca **Dampak perubahan**.');
P('3. Detail simbol per berkas: `docs/codebase-index.json` (exports, imports, kasus tes).');
P('4. Jangan membaca `CLAUDE.md`/`DOCUMENTATION.md` utuh; pakai `grep` lalu baca rentang kecil.');
P('5. `graphify-out/` (jika ada) adalah graf lama dan tidak memuat semua berkas terbaru; verifikasi dengan peta ini.');
P('');
P('## Ringkasan');
P('');
P('| Area | File | Baris |');
P('| --- | --- | --- |');
const kinds = {};
for (const r of records) { kinds[r.kind] = kinds[r.kind] || { files: 0, lines: 0 }; kinds[r.kind].files++; kinds[r.kind].lines += r.lines; }
for (const [k, v] of Object.entries(kinds)) P('| ' + k + ' | ' + v.files + ' | ' + v.lines + ' |');
P('| **total** | **' + records.length + '** | **' + records.reduce((n, r) => n + r.lines, 0) + '** |');
P('');
P('## Titik masuk');
P('');
const byPath = new Set(records.map((r) => r.path));
for (const e of [
  ['api/webhook.ts', 'Webhook Telegram (serverless).'],
  ['api/whatsapp.ts', 'Webhook WhatsApp Cloud + verifikasi signature.'],
  ['api/health.ts', 'Health check produksi: versi, database, provider.'],
  ['api/stats.ts', 'Metrik dashboard: kuota, kunci, model, pool.'],
  ['api/dataset.ts', 'Ekspor riwayat percakapan (CSV/JSON).'],
  ['api/admin-otp.ts', 'Auth admin: PIN, OTP, sesi, purge data.'],
  ['src/index.ts', 'Runner lokal: Telegram polling + Baileys.'],
  ['src/telegram.ts', 'Handler seluruh pesan Telegram.'],
  ['src/whatsapp_cloud.ts', 'Handler pesan WhatsApp Cloud.'],
  ['src/whatsapp_baileys.ts', 'Handler pesan WhatsApp Baileys.'],
  ['src/skills.ts', 'Persona, prompt, sanitasi, autoReply.'],
  ['src/providers.ts', 'Urutan tier, race, failover provider.'],
]) if (byPath.has(e[0])) P('- `' + e[0] + '` — ' + e[1]);
P('');
P('## Peta cepat: topik ke file');
P('');
const topics = {
  'Persona, prompt, sanitasi balasan': ['src/skills.ts'],
  'Routing provider, failover, race': ['src/providers.ts', 'src/limits.ts', 'src/quota.ts', 'src/neuron.ts', 'src/cooldown.ts'],
  'Kontrak env dan daftar model': ['src/env.ts'],
  'Riwayat dan cache konteks': ['src/memory.ts', 'src/db.ts', 'src/chat_id.ts'],
  'Telegram': ['src/telegram.ts', 'api/webhook.ts'],
  'WhatsApp Cloud': ['src/whatsapp_cloud.ts', 'api/whatsapp.ts'],
  'WhatsApp Baileys': ['src/whatsapp_baileys.ts', 'src/baileys_brain.ts', 'src/whatsapp_session.ts'],
  'Media: gambar, stiker, audio, dokumen, video': ['src/media.ts', 'src/media_guard.ts'],
  'Stiker: aset, label, cooldown': ['src/stickers.ts', 'src/sticker-manifest.ts'],
  'Pencarian web dan scraping': ['src/web.ts', 'src/knowledge.ts', 'src/bot_growth.ts'],
  'Tebak-tebakan, gombalan, game': ['src/riddles.ts', 'src/bot_memory.ts', 'src/games/engine.ts', 'src/games/index.ts', 'src/games/cards.ts'],
  'Catatan, tugas, keuangan, kebiasaan': ['src/notes.ts'],
  'Pengingat': ['src/remind.ts', 'src/reminder-repeat.ts', 'src/reminder-dedup.ts', 'src/reminder-ubah.ts', 'src/reminder-multihari.ts'],
  'Zona waktu dan profil user': ['src/timezone.ts', 'src/user-profile.ts', 'src/user_facts.ts'],
  'Keamanan admin': ['src/admin_auth.ts', 'src/rate_limit.ts', 'api/admin-otp.ts'],
  'Dashboard metrik': ['api/stats.ts', 'public/js/dashboard.js', 'public/dashboard.html', 'public/css/console.css', 'public/js/i18n.js'],
  'Landing dan UI publik': ['public/index.html', 'public/privacy.html'],
  'Mode grup': ['src/group_mode.ts', 'src/group_db.ts'],
  'Monitor pengiriman dan VPS': ['src/wa_monitor.ts', 'src/vps_monitor.ts'],
  'Perintah bot (satu sumber)': ['src/commands.ts'],
  'Logger dan observabilitas': ['src/logger.ts'],
};
for (const [t, fs_] of Object.entries(topics)) {
  const real = fs_.filter((f) => byPath.has(f));
  if (real.length) P('- **' + t + '**: ' + real.map((f) => '`' + f + '`').join(', '));
}
P('');
P('## Modul inti (src/ dan api/)');
P('');
P('| File | Baris | Tujuan | Ekspor utama |');
P('| --- | --- | --- | --- |');
for (const r of records.filter((r) => (r.kind === 'src' || r.kind === 'api') && r.lines >= 40).sort((a, b) => b.lines - a.lines)) {
  const ex = r.exports.filter((e) => !e.startsWith('sql')).slice(0, 5).join(', ');
  P('| `' + r.path + '` | ' + r.lines + ' | ' + (docOf(r.path) || '-').replaceAll('|', '/') + ' | ' + (ex || '-').replaceAll('|', '/') + ' |');
}
P('');
P('## Dampak perubahan (siapa meng-import berkas ini)');
P('');
P('| File | Peng-import | Contoh |');
P('| --- | --- | --- |');
for (const [f, set] of [...rev.entries()].sort((a, b) => b[1].size - a[1].size).slice(0, 30)) {
  const arr = [...set].sort();
  P('| `' + f + '` | ' + arr.length + ' | ' + arr.slice(0, 4).map((x) => '`' + x + '`').join(', ') + (arr.length > 4 ? ', ...' : '') + ' |');
}
P('');
P('## Impor internal per modul besar');
P('');
P('| File | Import internal |');
P('| --- | --- |');
for (const r of records.filter((r) => r.kind === 'src' || r.kind === 'api').sort((a, b) => b.lines - a.lines).slice(0, 24)) {
  const set = [...(deps.get(r.path) || [])].sort();
  if (set.length) P('| `' + r.path + '` | ' + set.slice(0, 8).map((x) => '`' + x + '`').join(', ') + (set.length > 8 ? ', ...' : '') + ' |');
}
P('');
P('## API HTTP');
P('');
P('| Route | File | Baris |');
P('| --- | --- | --- |');
for (const r of records.filter((r) => r.kind === 'api').sort((a, b) => a.path.localeCompare(b.path))) {
  P('| `/api/' + path.basename(r.path).replace(/\.ts$/, '') + '` | `' + r.path + '` | ' + r.lines + ' |');
}
P('');
P('## Skema database (sql/)');
P('');
P('| File | Objek |');
P('| --- | --- |');
for (const r of records.filter((r) => r.kind === 'sql').sort((a, b) => a.path.localeCompare(b.path))) {
  const objs = r.exports.filter((e) => e.startsWith('sql ')).map((e) => e.slice(4));
  P('| `' + r.path + '` | ' + (objs.slice(0, 8).join(', ') || '-') + (objs.length > 8 ? ', ...' : '') + ' |');
}
P('');
P('## Tes (tests/)');
P('');
P('Semua tes offline: `npm test`, atau satu berkas `node --import tsx --test tests/<nama>.test.mjs`.');
P('');
P('| Berkas tes | Kasus utama |');
P('| --- | --- |');
for (const r of records.filter((r) => r.kind === 'tests' && r.tests.length).sort((a, b) => a.path.localeCompare(b.path))) {
  P('| `' + r.path + '` | ' + r.tests.slice(0, 3).join(' / ').replaceAll('|', '/').slice(0, 140) + ' |');
}
P('');
P('## Berkas besar (baca bertahap: grep, lalu read offset/limit)');
P('');
P('| File | Baris |');
P('| --- | --- |');
for (const r of [...records].sort((a, b) => b.lines - a.lines).slice(0, 12)) P('| `' + r.path + '` | ' + r.lines + ' |');
P('');
P('## Berkas yang tidak boleh diubah tanpa alasan kuat');
P('');
P('- `src/env.ts` — kontrak env dan daftar model.');
P('- `src/providers.ts` — urutan tier, race, propagasi abort.');
P('- `src/quota.ts`, `src/limits.ts`, `src/neuron.ts` — pencatatan kuota; kesalahan di sini merusak metrik.');
P('- `api/stats.ts` + `public/js/dashboard.js` — kontrak berpasangan, ubah bersamaan.');
P('- `.env`, `.env.local` — rahasia; jangan pernah dicetak.');
P('');
fs.writeFileSync('CODEBASE_MAP.md', L.join('\n'));
console.log('CODEBASE_MAP.md: ' + L.length + ' baris · docs/codebase-index.json: ' + records.length + ' berkas');