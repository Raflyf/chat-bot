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

test('performa scroll & animasi: single-pass blur ringan, tanpa zero-delta lockup, & reveal aman tanpa kotak kosong', () => {
  const consoleCss = read('public/css/console.css');
  const landingCss = read('public/css/landing.css');
  const smoothJs = read('public/js/smooth-scroll.js');
  const homeJs = read('public/js/home.js');
  const dashJs = read('public/js/dashboard.js');

  assert.match(consoleCss, /\.model-matrix-card\[data-provider="opencode"\]/, 'opencode harus punya warna card di console.css');
  assert.match(consoleCss, /contain:\s*strict/, 'layer background fixed console harus diisolasi dengan contain: strict');
  assert.match(landingCss, /contain:\s*strict/, 'layer background fixed landing harus diisolasi dengan contain: strict');
  assert.match(landingCss, /overflow-x:\s*clip/, 'landing body harus memakai overflow-x: clip');
  assert.match(consoleCss, /overflow-x:\s*clip/, 'console body harus memakai overflow-x: clip');

  // Pastikan body::after tidak memakai mask-image yang memberatkan Firefox WebRender
  const landingAfter = landingCss.match(/body::after\s*\{[\s\S]*?\}/);
  const consoleAfter = consoleCss.match(/body::after\s*\{[\s\S]*?\}/);
  assert.ok(landingAfter && !/mask-image/.test(landingAfter[0]), 'landing body::after tidak boleh memakai mask-image');
  assert.ok(consoleAfter && !/mask-image/.test(consoleAfter[0]), 'console body::after tidak boleh memakai mask-image');

  // Pastikan tidak ada jebakan .reveal-init > * { opacity: 0 } yang menghasilkan kotak kosong
  assert.ok(!/\.reveal-init\s*>\s*\*/.test(landingCss), 'landing.css tidak boleh menyembunyikan anak via .reveal-init > *');
  assert.ok(!/\.reveal-init\s*>\s*\*/.test(consoleCss), 'console.css tidak boleh menyembunyikan anak via .reveal-init > *');

  assert.match(consoleCss, /\.reveal-init\.revealed/, 'animasi reveal console tetap aktif');
  assert.match(landingCss, /\.reveal-init\.revealed/, 'animasi reveal landing tetap aktif');
  assert.match(landingCss, /@keyframes heroReveal/, 'animasi heroReveal landing tetap aktif');
  assert.match(consoleCss, /@keyframes card-in/, 'animasi card-in dashboard tetap aktif');
  assert.match(homeJs, /unobserve/, 'home.js harus unobserve setelah reveal');
  assert.match(homeJs, /addEventListener\("scroll"[\s\S]{0,60}passive:\s*true/, 'home.js harus punya jaring pengaman scroll pasif');
  assert.match(dashJs, /unobserve/, 'dashboard.js harus unobserve setelah reveal');
  assert.match(dashJs, /addEventListener\("scroll"[\s\S]{0,60}passive:\s*true/, 'dashboard.js harus punya jaring pengaman scroll pasif');

  // Pastikan Lenis pakai lerp 0.13, kompensasi deltaMode === 1 Firefox, dan TIDAK pernah mereset lenis.time di listener scroll
  assert.match(smoothJs, /lerp:\s*0\.13/, 'smooth-scroll.js harus memakai lerp ringan 0.13');
  assert.match(smoothJs, /wheelMultiplier:\s*1\.15/, 'smooth-scroll.js harus memakai wheelMultiplier 1.15');
  assert.match(smoothJs, /deltaMode\s*===\s*1/, 'smooth-scroll.js harus mengkompensasi DOM_DELTA_LINE Firefox Windows');
  assert.ok(!/lenis\.on\s*\(/.test(smoothJs), 'smooth-scroll.js tidak boleh memasang lenis.on("scroll"/"virtual-scroll") yang bisa memicu loop lenis.time = 0');

  // Pastikan kartu/section utama tetap pakai single-pass backdrop-filter blur(8px) tanpa saturate(), sementara elemen anak bebas blur
  for (const sel of ['.kpi-card', '.provider-card', '.live-upstream-card, .token-matrix-section, .matrix-section, .activity-card']) {
    const escaped = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const block = consoleCss.match(new RegExp(escaped + '\\s*\\{[\\s\\S]*?\\}'));
    assert.ok(block && /backdrop-filter:\s*blur\(8px\)/.test(block[0]), `${sel} harus memakai single-pass backdrop-filter: blur(8px)`);
    assert.ok(block && !/saturate\(/.test(block[0]), `${sel} tidak boleh memakai multi-pass saturate()`);
  }
  for (const sel of ['.feature-card', '.lapor-card', '.dashboard-teaser']) {
    const escaped = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const block = landingCss.match(new RegExp(escaped + '\\s*\\{[\\s\\S]*?\\}'));
    assert.ok(block && /backdrop-filter:\s*blur\(8px\)/.test(block[0]), `${sel} harus memakai single-pass backdrop-filter: blur(8px)`);
    assert.ok(block && !/saturate\(/.test(block[0]), `${sel} tidak boleh memakai multi-pass saturate()`);
  }
  for (const sel of ['.key-row', '.model-matrix-card', '.upstream-stat', '.table-wrap']) {
    const escaped = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const block = consoleCss.match(new RegExp(escaped + '\\s*\\{[\\s\\S]*?\\}'));
    assert.ok(block && !/backdrop-filter/.test(block[0]), `${sel} tidak boleh menumpuk nested backdrop-filter`);
  }
});
