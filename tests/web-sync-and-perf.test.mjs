/**
 * TEST: Sinkronisasi web & optimasi performa UI/scroll (dashboard + landing).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL('../' + rel, import.meta.url), 'utf8');

test('api/stats.ts: allTimeAssistantMsgs mengambil created_at & inisialisasi dreamprompting', () => {
  const src = read('api/stats.ts');
  assert.match(src, /\.select\('via, created_at'\)/, 'allTimeAssistantMsgs harus memilih via dan created_at');
  assert.match(src, /providerTokenStats[\s\S]{0,160}dreamprompting:/, 'dreamprompting harus diinisialisasi di providerTokenStats');
  assert.match(src, /wa_baileys_/, 'waMonthlyMsgs harus mengecualikan wa_baileys_ dari kuota sesi Meta Cloud');
});

test('api/dataset.ts & dashboard.js: mendukung prefix wa_baileys_', () => {
  const api = read('api/dataset.ts');
  const dash = read('public/js/dashboard.js');
  assert.match(api, /wa_baileys_\|wa_\|tg_/, 'api/dataset searchDigits harus menstrip wa_baileys_');
  assert.match(api, /wa_baileys_\|wa_/, 'api/dataset matchChat harus menstrip wa_baileys_');
  assert.match(dash, /wa_baileys_/, 'dashboard.js harus melabeli dan menstrip prefix wa_baileys_');
});

test('dashboard.js: bindingPct tersedia di cabang xkiro, _datasetTick di dalam interval, refreshDashboardI18n diekspos', () => {
  const dash = read('public/js/dashboard.js');
  assert.match(dash, /else if \(p\.kind === "xkiro"\)[\s\S]{0,350}const bindingPct =/, 'cabang xkiro harus mendefinisikan bindingPct');
  const autoFn = dash.match(/function pasangAutoRefresh\(\) \{[\s\S]*?\n    \}/);
  assert.ok(autoFn, 'pasangAutoRefresh harus ada');
  assert.match(autoFn[0], /document\.hidden/, 'auto-refresh harus pause saat tab tersembunyi');
  assert.match(autoFn[0], /_datasetTick/, '_datasetTick harus berjalan di dalam interval auto-refresh');
  assert.match(dash, /window\.refreshDashboardI18n\s*=/, 'window.refreshDashboardI18n harus diekspos');
});

test('i18n & dropdown: label dropdown disinkronkan saat bahasa diubah', () => {
  const i18n = read('public/js/i18n.js');
  const dd = read('public/js/glass-dropdown.js');
  assert.match(dd, /window\.syncGlassDropdownLabels\s*=/, 'glass-dropdown.js harus menyediakan syncGlassDropdownLabels');
  assert.match(i18n, /syncGlassDropdownLabels/, 'i18n.js harus memanggil syncGlassDropdownLabels');
  assert.match(i18n, /refreshDashboardI18n/, 'i18n.js harus memanggil refreshDashboardI18n');
});

test('public/privacy/index.html: bebas inline script sesuai CSP', () => {
  const html = read('public/privacy/index.html');
  assert.ok(!/<script(?:\s+[^>]*)?>[\s\S]*?<\/script>/i.test(html.replace(/<script\s+src="[^"]+"><\/script>/gi, '')),
    'privacy/index.html tidak boleh punya inline <script>');
  assert.match(html, /\/js\/theme-pre\.js/);
  assert.match(html, /\/js\/doc-theme\.js/);
});

test('performa scroll & animasi: tanpa nested backdrop-filter berlebih & animasi/motion tetap utuh', () => {
  const consoleCss = read('public/css/console.css');
  const landingCss = read('public/css/landing.css');
  const smoothJs = read('public/js/smooth-scroll.js');

  assert.match(consoleCss, /\.model-matrix-card\[data-provider="opencode"\]/, 'opencode harus punya warna card di console.css');
  assert.match(consoleCss, /contain:\s*strict/, 'layer background fixed console harus diisolasi dengan contain: strict');
  assert.match(landingCss, /contain:\s*strict/, 'layer background fixed landing harus diisolasi dengan contain: strict');
  assert.match(consoleCss, /\.reveal-init\.revealed/, 'animasi reveal console tetap aktif');
  assert.match(landingCss, /\.reveal-init\.revealed/, 'animasi reveal landing tetap aktif');
  assert.match(landingCss, /@keyframes heroReveal/, 'animasi heroReveal landing tetap aktif');
  assert.match(consoleCss, /@keyframes card-in/, 'animasi card-in dashboard tetap aktif');
  assert.match(smoothJs, /kickRaf/, 'smooth-scroll.js harus memakai RAF demand-driven');
  assert.match(smoothJs, /prevent:\s*function/, 'smooth-scroll.js harus mengizinkan native scroll di kontainer bersarang');

  // Pastikan key-row dan model-matrix-card tidak memakai backdrop-filter bersarang
  const keyRowBlock = consoleCss.match(/\.key-row\s*\{[\s\S]*?\}/);
  assert.ok(keyRowBlock && !/backdrop-filter/.test(keyRowBlock[0]), '.key-row tidak boleh menumpuk backdrop-filter');
  const matrixCardBlock = consoleCss.match(/\.model-matrix-card\s*\{[\s\S]*?\}/);
  assert.ok(matrixCardBlock && !/backdrop-filter/.test(matrixCardBlock[0]), '.model-matrix-card tidak boleh menumpuk backdrop-filter');
});
