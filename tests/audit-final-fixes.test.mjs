/**
 * TEST REGRESI — Full Audit Fixes (20 Nov 2026).
 *
 * Memverifikasi seluruh temuan audit produksi:
 *  1. Key-specific 401/403/Cloudflare-4006 mencoba key berikutnya tanpa membekukan model 15 menit.
 *  2. OpenCode 429 FreeUsageLimitError & generic 429 tersimpan ke cooldown persisten (rpd/tpm).
 *  3. ringkasUntukGroqTeks memangkas lampiran sekunder agar full systemPrompt masuk budget 7.000 ITPM Groq dengan persona utuh.
 *  4. ringkasUntukGroqVision menjaga persona/memori/alur inti, bukan header waktu.
 *  5. buangKonfabulasiKonteks menjaga balasan nyambung saat topik ada di riwayat/intro, dan tetap memblokir konfabulasi liar.
 *  6. buangBocorInstruksi menangkap bocoran permintaan maaf amnesia ("kayak baru mulai chat lagi").
 *  7. systemPrompt menyaring pesan otomatis sistem (Ringkasan/Pengingat) dan menyertakan [ALUR & SUASANA OBROLAN TERKINI].
 *  8. adalahTestChatId memblokir ID test (tz_*, test_*, __*__) di saveCorrection, simpanFaktaPersonal, simpanProfilWaktu.
 *  9. notes.ts meneruskan channel ke pending confirmations/tertunda dan memakai AsyncLocalStorage zona waktu.
 * 10. Paritas kanal Baileys / WhatsApp Cloud / Telegram (tanganiPencatatan sebelum fakta, VN Baileys, teruskanKeAi, simpanDokumen, updateContextCache, anti-kosong Baileys).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { config } from '../src/env.ts';
import { ringkasUntukGroqTeks, ringkasUntukGroqVision } from '../src/providers.js';
import { systemPrompt, sanitizeAssistantOutput, buangKonfabulasiKonteks, buangBocorInstruksi, adalahPesanSistemOtomatis } from '../src/skills.js';
import { adalahTestChatId, saveCorrection } from '../src/memory.js';

const provSource = fs.readFileSync(new URL('../src/providers.ts', import.meta.url), 'utf8');
const provAst = ts.createSourceFile('providers.ts', provSource, ts.ScriptTarget.Latest, true);
function loadProv(name, context) {
  const fn = provAst.statements.find((n) => ts.isFunctionDeclaration(n) && n.name?.text === name);
  assert.ok(fn, name);
  const js = ts.transpile(fn.getText(provAst), { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None });
  return vm.runInNewContext(js + '; ' + name, context);
}

test('audit #2: 401/403 & Cloudflare neuron 400 lanjut ke key berikutnya tanpa model cooldown', async () => {
  const modelFailures = [];
  const keyFailures = [];
  const race = loadProv('balapanModelDalamTier', {
    config: { ...config, raceStaggerMs: 1, timeoutMs: 2000 },
    AbortController,
    setTimeout,
    Date,
    getOrderedKeys: (_, keys) => keys,
    cekKeyBolehDipakai: async () => true,
    isModelCoolingDown: () => false,
    recordKeySuccess() {},
    recordModelLatency() {},
    keyUsed() {},
    keyTokensUsed() {},
    recordKeyFailure: (...args) => keyFailures.push(args),
    recordModelFailure: (...args) => modelFailures.push(args),
    ERR_NO_FIRST_TOKEN: 'NO_FIRST_TOKEN',
    ERR_STREAM_IDLE: 'STREAM_IDLE_TIMEOUT',
    setCooldownPersist() {},
    keyHash: (k) => k,
  });

  const step = {
    kind: 'cloudflare',
    keys: ['key-habis', 'key-sehat'],
    run: async (key, model) => {
      if (key === 'key-habis') {
        const err = new Error('PROVIDER_400:you have used up your daily free allocation of 10,000 neurons (4006)');
        err.fullBody = 'AiError: daily free allocation of 10,000 neurons';
        throw err;
      }
      return { text: `ok-${key}-${model}` };
    },
  };

  const winner = await race(step, ['@cf/qwen/qwen3.8-27b'], [{ role: 'user', content: 'hai' }], Date.now() + 3000, false);
  assert.equal(winner.text, 'ok-key-sehat-@cf/qwen/qwen3.8-27b');
  assert.equal(modelFailures.length, 0, 'neuron habis di 1 key TIDAK boleh membekukan model 15 menit');
  assert.equal(keyFailures.length, 1);
});

test('audit #3: OpenCode 429 FreeUsageLimitError (fullBody) tersimpan persisten', () => {
  const persists = [];
  const failure = loadProv('recordKeyFailure', {
    config,
    Date,
    keyHash: (k) => k,
    msUntilDailyResetUtc: () => 50_000,
    setCooldownPersist: (...args) => persists.push(args),
    keyCooldownMap: new Map(),
  });
  const err = new Error('RATE_LIMITED:{"type":"error"');
  err.code = 'RATE_LIMITED';
  err.fullBody = '{"type":"error","error":{"type":"FreeUsageLimitError","message":"Free usage limit reached"}}';
  failure('opencode', 'public', err);
  assert.equal(persists.length, 1);
  assert.equal(persists[0][0], 'opencode:public');
  assert.equal(persists[0][2], 'rpd');
});

test('audit #1: ringkasUntukGroqTeks menurunkan systemPrompt full ke bawah 7.000 token tanpa hilangkan persona', () => {
  const fullSys = systemPrompt(
    {
      history: [
        { role: 'user', content: 'woy' },
        { role: 'assistant', content: 'Apaan woy, gue di sini nih' },
      ],
      summary: '- Nama/panggilan USER: Andi\n- Suka ngopi pahit',
      corrections: ['[FAKTA] hobi: main futsal'],
      chatId: 'wa_baileys_628991333323',
    },
    null,
    'lu lagi ngapain sih',
  );
  const compacted = ringkasUntukGroqTeks(
    [
      { role: 'system', content: fullSys },
      { role: 'user', content: 'lu lagi ngapain sih' },
    ],
    7000,
  );
  const sysOut = String(compacted[0].content);
  const estTokensGroq = Math.ceil((sysOut.length + 'lu lagi ngapain sih'.length) / 3.1);
  assert.ok(estTokensGroq <= 7000, `estimasi token masih ${estTokensGroq} > 7000`);
  assert.ok(sysOut.includes('IDENTITAS:'), 'harus menjaga IDENTITAS');
  assert.ok(sysOut.includes('Kamu adalah sahabat karib'), 'harus menjaga persona sahabat');
  assert.ok(sysOut.includes('[NAFAS PERCAKAPAN]'), 'harus menjaga nafas percakapan');
  assert.ok(sysOut.includes('Andi'), 'harus menjaga memori user');
  assert.ok(!sysOut.includes('TEKS DI STIKER'), 'kamus stiker besar harus dipangkas saat over budget');
});

test('audit #8a: ringkasUntukGroqVision mempertahankan persona & konteks, bukan header jam', () => {
  const sys = systemPrompt({ history: [], summary: '- Hobi ngoding TS', corrections: [], chatId: 'wa_628991333323' }, null, 'cek foto');
  const out = ringkasUntukGroqVision([
    { role: 'system', content: sys },
    { role: 'user', content: 'cek foto' },
  ]);
  const content = String(out[0].content);
  assert.ok(!content.startsWith('[WAKTU & KALENDER SISTEM'), 'jangan potong header waktu di awal');
  assert.ok(content.includes('IDENTITAS:'), 'harus membawa identitas inti');
  assert.ok(content.includes('Hobi ngoding TS'), 'harus membawa memori aktif');
  assert.ok(content.includes('senyum-senyum sendiri'), 'harus melarang halusinasi aksi fisik');
});

test('audit #6 & #7: buangKonfabulasiKonteks sadar riwayat + buangBocorInstruksi tangkap maaf amnesia', () => {
  // Konteks ada di riwayat -> balasan sah TIDAK dibuang
  assert.equal(
    buangKonfabulasiKonteks('Lucu banget emang kucingnya pas lagi tidur.', 'terus gimana?', 'tadi liat kucing oren'),
    'Lucu banget emang kucingnya pas lagi tidur.',
  );
  assert.equal(
    buangKonfabulasiKonteks('Halo Budi, salam kenal!', 'halo aku Budi'),
    'Halo Budi, salam kenal!',
  );
  // Tanpa riwayat -> konfabulasi liar tetap dibuang
  assert.equal(buangKonfabulasiKonteks('Oh iya, kamu suka main ML.', 'Iya'), '');

  // Bocoran maaf amnesia pada pesan pertama harus langsung ditangkap
  assert.equal(
    buangBocorInstruksi('Waduh, iya juga ya, sori banget tadi malah jadi kayak baru mulai chat lagi.'),
    '',
  );
  assert.equal(
    sanitizeAssistantOutput('Waduh, iya juga ya, sori banget tadi malah jadi kayak baru mulai chat lagi.', 'woy'),
    '',
  );
});

test('audit #9: systemPrompt saring pesan otomatis sistem & deteksi alur obrolan', () => {
  assert.equal(adalahPesanSistemOtomatis('📊 *Ringkasan (30 hari terakhir)*\nKosong'), true);
  assert.equal(adalahPesanSistemOtomatis('⏰ *Pengingat:* ON'), true);
  assert.equal(adalahPesanSistemOtomatis('Apaan sih, wkwk'), false);

  const p = systemPrompt(
    {
      history: [
        { role: 'user', content: 'lu ngerti kan' },
        { role: 'assistant', content: 'Ngerti dong, emang kenapa' },
        { role: 'user', content: 'ringkasan' },
        { role: 'assistant', content: '📊 *Ringkasan (30 hari terakhir)*\nBelum ada catatan' },
      ],
      summary: null,
      corrections: [],
      chatId: 'wa_baileys_628991333323',
    },
    null,
    'okeh',
  );
  assert.ok(p.includes('[ALUR & SUASANA OBROLAN TERKINI]'), 'harus menyuntikkan blok alur obrolan');
  assert.ok(p.includes('notifikasi/ringkasan otomatis sistem'), 'harus cegah pengulangan ringkasan/pengingat');
  assert.ok(p.includes('gaya "gue/lu"'), 'harus kunci konsistensi kata ganti antar failover');
});

test('audit #14: adalahTestChatId & saveCorrection menolak id test agar DB produksi bersih', async () => {
  assert.equal(adalahTestChatId('tz_b1_123'), true);
  assert.equal(adalahTestChatId('test_abc'), true);
  assert.equal(adalahTestChatId('__verify_v32__'), true);
  assert.equal(adalahTestChatId('wa_628991333323'), false);
  const res = await saveCorrection('tz_b1_999', 'test');
  assert.equal(res, false);
});

test('audit #12 & #13: notes.ts + kanal Baileys/Cloud/Telegram paritas & urutan aman', () => {
  const NOTES = fs.readFileSync(new URL('../src/notes.ts', import.meta.url), 'utf8');
  const BAIL = fs.readFileSync(new URL('../src/whatsapp_baileys.ts', import.meta.url), 'utf8');
  const CLOUD = fs.readFileSync(new URL('../src/whatsapp_cloud.ts', import.meta.url), 'utf8');
  const TELE = fs.readFileSync(new URL('../src/telegram.ts', import.meta.url), 'utf8');

  assert.ok(NOTES.includes('AsyncLocalStorage'), 'notes.ts harus memakai AsyncLocalStorage');
  assert.ok(!/let\s+zonaAktif\s*=/.test(NOTES), 'tidak boleh memakai global mutable zonaAktif');
  assert.ok(NOTES.includes('channel: tertunda.channel ?? opts.channel'), 'konfirmasi/zona harus meneruskan channel');

  // Baileys: VN melewati tanganiPencatatan, text menangani teruskanKeAi, tanganiPencatatan sebelum tangkapFaktaPersonal, simpanDokumen & anti-kosong
  assert.ok(/hasilCatatVn\s*=\s*await\s+tanganiPencatatan\(/.test(BAIL), 'Baileys VN harus cek tanganiPencatatan');
  assert.ok(BAIL.includes('hasil.teruskanKeAi'), 'Baileys harus tangani teruskanKeAi');
  assert.ok(BAIL.includes('simpanDokumen'), 'Baileys harus panggil simpanDokumen');
  assert.ok(BAIL.includes('baileysDynamicNotice') && BAIL.includes('Balasan tetap kosong'), 'Baileys harus punya guard anti-kosong');

  const idxVnNotes = BAIL.indexOf('hasilCatatVn = await tanganiPencatatan(');
  const idxVnFakta = BAIL.indexOf('tangkapFaktaPersonal(nomorBaileys, transcription)');
  assert.ok(idxVnNotes > 0 && idxVnFakta > idxVnNotes, 'baileys VN: tanganiPencatatan harus sebelum tangkapFaktaPersonal');

  for (const [nama, src] of [['baileys', BAIL], ['cloud', CLOUD], ['telegram', TELE]]) {
    const idxNotes = src.indexOf('tanganiPencatatan(text');
    const idxFakta = src.indexOf('tangkapFaktaPersonal(', idxNotes);
    assert.ok(idxNotes > 0 && idxFakta > idxNotes, `${nama}: tanganiPencatatan teks harus dijalankan sebelum tangkapFaktaPersonal`);
    assert.ok(src.includes('simpanDokumen'), `${nama}: harus memanggil simpanDokumen`);
  }
});
