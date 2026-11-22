/**
 * TEST OTOMATIS — integrasi web Baileys Backup (/dashboard & /api/baileys-backup).
 *
 * Isolasi penuh: menonaktifkan env Supabase/InstaBox agar unit test
 * tidak menyentuh produksi.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

process.env.NODE_ENV = 'test';
process.env.DOTENV_CONFIG_PATH = '__nonexistent_env_for_test__';
process.env.SUPABASE_URL = '';
process.env.NEXT_PUBLIC_SUPABASE_URL = '';
process.env.SUPABASE_SERVICE_KEY = '';
process.env.SUPABASE_SERVICE_ROLE_KEY = '';
process.env.SUPABASE_SECRET_KEY = '';
process.env.INSTABOX_API_KEY = '';
process.env.INSTABOX_MACHINE_ID = '';

const {
  classifyVpsAvailability,
  chooseVpsActionEndpoint,
  shouldFallbackResumeToStart,
  parseInstaboxResumeError,
  computeAutoResumeBackoffSecs,
  defaultCloudState,
  triggerInstaboxResume,
  buildBaileysBackupView,
  runManualVpsResume,
  setAutoResumeMode,
  cobaAutoResumeDariCron,
  resetBaileysBackupWebUntukTest,
  DESKTOP_HEARTBEAT_TTL_SECS,
} = await import('../src/baileys_backup_web.js');

const { createBaileysBackupHandler } = await import('../api/baileys-backup.js');

const read = (rel) => fs.readFileSync(new URL('../' + rel, import.meta.url), 'utf8');

function createMockRes() {
  const headers = {};
  const out = {
    statusCode: 200,
    headers,
    body: null,
    ended: false,
    setHeader(k, v) {
      headers[String(k).toLowerCase()] = String(v);
    },
    status(code) {
      out.statusCode = code;
      return out;
    },
    json(data) {
      out.body = data;
      out.ended = true;
      return out;
    },
    end() {
      out.ended = true;
      return out;
    },
  };
  return out;
}

beforeEach(() => {
  resetBaileysBackupWebUntukTest();
});

test('1. Klasifikasi state, pilihan endpoint, fallback /start, & parser error InstaBox', () => {
  assert.equal(classifyVpsAvailability('running'), 'running');
  assert.equal(classifyVpsAvailability('SUSPENDED'), 'down');
  assert.equal(classifyVpsAvailability('paused'), 'down');
  assert.equal(classifyVpsAvailability('stopped'), 'down');
  assert.equal(classifyVpsAvailability('starting'), 'transient');
  assert.equal(classifyVpsAvailability('resuming'), 'transient');
  assert.equal(classifyVpsAvailability('weird'), 'unknown');

  assert.equal(chooseVpsActionEndpoint('suspended'), 'resume');
  assert.equal(chooseVpsActionEndpoint('paused'), 'resume');
  assert.equal(chooseVpsActionEndpoint('stopped'), 'start');
  assert.equal(chooseVpsActionEndpoint('OFF'), 'start');

  const cooldownBody = JSON.stringify({ error: { code: 'machine_cooldown', retryAfterSeconds: 420 } });
  assert.equal(shouldFallbackResumeToStart(409, cooldownBody), false);
  assert.equal(
    shouldFallbackResumeToStart(409, JSON.stringify({ error: { code: 'invalid_state' } })),
    true,
  );
  assert.equal(shouldFallbackResumeToStart(404, '{}'), true);
  assert.equal(shouldFallbackResumeToStart(403, '{}'), false);

  const parsedCooldown = parseInstaboxResumeError(409, cooldownBody);
  assert.equal(parsedCooldown.isCooldown, true);
  assert.equal(parsedCooldown.retryAfterSecs, 420);
  assert.equal(parsedCooldown.message, 'VPS sedang cooldown (coba lagi dalam ~7m)');
  assert.equal(computeAutoResumeBackoffSecs(parsedCooldown, 0), 430);

  const parsedForbidden = parseInstaboxResumeError(403, '{}');
  assert.equal(computeAutoResumeBackoffSecs(parsedForbidden, 0), 1800);
});

test('2. triggerInstaboxResume: sukses 202, fallback /resume -> /start pada 404, dan TIDAK fallback saat machine_cooldown', async () => {
  const calls1 = [];
  const resOk = await triggerInstaboxResume('suspended', {
    apiKey: 'ibx_secret_key',
    machineId: 'm_123456',
    apiBase: 'https://api.instabox.sh',
    nowMs: 1_732_200_000_000,
    fetchImpl: async (url, init) => {
      calls1.push({ url: String(url), method: init?.method, headers: init?.headers });
      return new Response('{"id":"op_1"}', { status: 202 });
    },
  });
  assert.equal(resOk.ok, true);
  if (resOk.ok) {
    assert.equal(resOk.actionUsed, 'resume');
    assert.equal(resOk.status, 202);
  }
  assert.equal(calls1.length, 1);
  assert.equal(calls1[0].url, 'https://api.instabox.sh/v1/machines/m_123456/resume');
  assert.equal(calls1[0].method, 'POST');
  assert.ok(calls1[0].headers['Idempotency-Key'].startsWith('baileys-backup-web-'));

  const calls2 = [];
  const resFallback = await triggerInstaboxResume('paused', {
    apiKey: 'ibx_secret_key',
    machineId: 'm_123456',
    apiBase: 'https://api.instabox.sh',
    fetchImpl: async (url) => {
      calls2.push(String(url));
      if (String(url).endsWith('/resume')) {
        return new Response('{"error":{"code":"invalid_state"}}', { status: 409 });
      }
      return new Response('{"id":"op_2"}', { status: 202 });
    },
  });
  assert.equal(resFallback.ok, true);
  if (resFallback.ok) assert.equal(resFallback.actionUsed, 'start');
  assert.equal(calls2.length, 2);
  assert.ok(calls2[1].endsWith('/start'));

  const calls3 = [];
  const resCooldown = await triggerInstaboxResume('suspended', {
    apiKey: 'ibx_secret_key',
    machineId: 'm_123456',
    apiBase: 'https://api.instabox.sh',
    fetchImpl: async (url) => {
      calls3.push(String(url));
      return new Response('{"error":{"code":"machine_cooldown","retryAfterSeconds":300}}', {
        status: 409,
      });
    },
  });
  assert.equal(resCooldown.ok, false);
  assert.equal(calls3.length, 1, 'machine_cooldown tidak boleh fallback ke /start');
});

test('3. buildBaileysBackupView: LWW autoResumeEnabled, TTL Laptop Online/Offline, clear cooldown saat running', () => {
  const nowMs = 1_732_200_100_000;
  const nowSecs = Math.floor(nowMs / 1000);

  const cloud = {
    ...defaultCloudState(),
    autoResumeEnabled: false,
    autoResumeUpdatedAt: nowMs - 60_000,
    autoResumeUpdatedBy: 'web',
    cooldownUntilEpoch: nowSecs + 300,
    recentEvents: [{ ts: nowSecs - 10, source: 'web', message: 'Event web' }],
  };

  const desktopNewer = {
    appVersion: '1.3.0',
    appPid: 8100,
    childNodePid: 4440,
    failoverActive: true,
    vpsState: 'suspended',
    appPrivateKb: 1120,
    appWorkingKb: 5200,
    nodePrivateKb: 70200,
    uptimeSecs: 14000,
    totalChecks: 454,
    failoverCount: 1,
    autoStartEnabled: true,
    trayRegistered: true,
    lastCheckEpoch: nowSecs - 13,
    heartbeatAt: nowSecs - 20,
    stopped: false,
    autoResumeEnabled: true,
    autoResumeUpdatedAt: nowMs - 10_000,
    recentEvents: ['Failover aktif di laptop (PID 4440)'],
  };

  const viewOnline = buildBaileysBackupView(cloud, desktopNewer, null, nowMs, {
    instaboxConfigured: true,
    machineId: 'm_agq7ntihvch5wkk7jz6xvjicji',
  });
  assert.equal(viewOnline.desktopOnline, true);
  assert.equal(viewOnline.autoResumeEnabled, true, 'harus memilih update desktop yang lebih baru');
  assert.equal(viewOnline.autoResumeUpdatedBy, 'desktop');
  assert.equal(viewOnline.cooldownRemainingSecs, 300);
  assert.equal(viewOnline.machineId, 'm_agq7...icji');
  assert.equal(viewOnline.recentEvents.length, 2);

  const desktopStale = {
    ...desktopNewer,
    heartbeatAt: nowSecs - (DESKTOP_HEARTBEAT_TTL_SECS + 15),
  };
  const viewOffline = buildBaileysBackupView(
    cloud,
    desktopStale,
    {
      id: 'm_agq7ntihvch5wkk7jz6xvjicji',
      name: 'freeaibot-wa',
      state: 'running',
      runStartedAt: new Date(nowMs - 60 * 60_000).toISOString(),
      maxRunMinutes: 120,
      cooldownUntil: null,
    },
    nowMs,
    { instaboxConfigured: true },
  );
  assert.equal(viewOffline.desktopOnline, false);
  assert.equal(viewOffline.vpsAvailability, 'running');
  assert.equal(viewOffline.cooldownUntilEpoch, null, 'cooldown harus dibersihkan saat running');
  assert.equal(viewOffline.cooldownRemainingSecs, 0);
  assert.equal(viewOffline.runtimeRemainingMinutes, 60);
});

test('4. setAutoResumeMode(true) memicu resume langsung bila VPS sedang down & di luar cooldown', async () => {
  const nowMs = 1_732_200_200_000;
  let storedCloud = defaultCloudState();
  const postUrls = [];

  const res = await setAutoResumeMode(true, {
    apiKey: 'ibx_key',
    machineId: 'm_test',
    apiBase: 'https://api.instabox.sh',
    nowMs,
    readCloudAndDesktop: async () => ({ cloud: storedCloud, desktop: null }),
    writeCloudState: async (st) => {
      storedCloud = st;
    },
    fetchImpl: async (url, init) => {
      if ((init?.method || 'GET') === 'GET') {
        return new Response(JSON.stringify({ id: 'm_test', state: 'suspended' }), { status: 200 });
      }
      postUrls.push(String(url));
      return new Response('{"id":"op_auto"}', { status: 202 });
    },
  });

  assert.equal(res.ok, true);
  assert.equal(res.autoTriggeredResume, true);
  assert.equal(postUrls.length, 1);
  assert.equal(storedCloud.autoResumeEnabled, true);
  assert.equal(storedCloud.autoResumeUpdatedBy, 'web');

  const resumeAlready = await runManualVpsResume({
    apiKey: 'ibx_key',
    machineId: 'm_test',
    apiBase: 'https://api.instabox.sh',
    nowMs: nowMs + 5000,
    readCloudAndDesktop: async () => ({ cloud: storedCloud, desktop: null }),
    writeCloudState: async (st) => {
      storedCloud = st;
    },
    fetchImpl: async () =>
      new Response(JSON.stringify({ id: 'm_test', state: 'running' }), { status: 200 }),
  });
  assert.equal(resumeAlready.ok, true);
  assert.equal(resumeAlready.status, 'already_running');
});

test('5. cobaAutoResumeDariCron menghormati mode MANUAL, state RUNNING, cooldown, & berjalan saat OTOMATIS+DOWN', async () => {
  const nowMs = 1_732_200_300_000;
  const nowSecs = Math.floor(nowMs / 1000);
  let storedCloud = defaultCloudState();

  const manualSkip = await cobaAutoResumeDariCron('suspended', {
    apiKey: 'k',
    machineId: 'm',
    nowMs,
    readCloudAndDesktop: async () => ({ cloud: storedCloud, desktop: null }),
    writeCloudState: async (st) => {
      storedCloud = st;
    },
  });
  assert.equal(manualSkip.attempted, false);
  assert.equal(manualSkip.reason, 'manual_mode');

  storedCloud = {
    ...storedCloud,
    autoResumeEnabled: true,
    cooldownUntilEpoch: nowSecs + 120,
  };
  const cooldownSkip = await cobaAutoResumeDariCron('suspended', {
    apiKey: 'k',
    machineId: 'm',
    nowMs,
    readCloudAndDesktop: async () => ({ cloud: storedCloud, desktop: null }),
    writeCloudState: async (st) => {
      storedCloud = st;
    },
  });
  assert.equal(cooldownSkip.attempted, false);
  assert.equal(cooldownSkip.reason, 'cooldown');

  storedCloud.cooldownUntilEpoch = null;
  const cronOk = await cobaAutoResumeDariCron('suspended', {
    apiKey: 'k',
    machineId: 'm_cron',
    apiBase: 'https://api.instabox.sh',
    nowMs,
    readCloudAndDesktop: async () => ({ cloud: storedCloud, desktop: null }),
    writeCloudState: async (st) => {
      storedCloud = st;
    },
    fetchImpl: async () => new Response('{"id":"op_cron"}', { status: 202 }),
  });
  assert.equal(cronOk.attempted, true);
  assert.equal(cronOk.ok, true);
  assert.equal(cronOk.actionUsed, 'resume');
  assert.equal(storedCloud.lastResumeSource, 'cron');
});

test('6. api/baileys-backup handler: fail-closed 401, 405, 400 validation, dan eksekusi 200 saat terautentikasi', async () => {
  const handler = createBaileysBackupHandler({
    extractToken: (req) => (req.headers['x-admin-token'] ? String(req.headers['x-admin-token']) : null),
    verifyToken: async (tok) => tok === 'valid_tok',
    getIp: () => '127.0.0.99',
    getSnapshot: async () => ({ ok: true, data: buildBaileysBackupView(defaultCloudState(), null, null, 1_732_200_000_000) }),
    manualCheck: async () => ({
      ok: true,
      message: 'Cek OK',
      data: buildBaileysBackupView(defaultCloudState(), null, null, 1_732_200_000_000),
    }),
    manualResume: async () => ({
      ok: true,
      httpStatus: 200,
      status: 'resuming',
      message: 'Resuming',
      data: buildBaileysBackupView(defaultCloudState(), null, null, 1_732_200_000_000),
    }),
    setAutoMode: async (enabled) => ({
      ok: true,
      autoTriggeredResume: false,
      message: enabled ? 'AUTO' : 'MANUAL',
      data: buildBaileysBackupView({ ...defaultCloudState(), autoResumeEnabled: enabled }, null, null, 1_732_200_000_000),
    }),
  });

  const resUnauth = createMockRes();
  await handler({ method: 'GET', headers: {} }, resUnauth);
  assert.equal(resUnauth.statusCode, 401);
  assert.equal(resUnauth.body?.authRequired, true);

  const resMethod = createMockRes();
  await handler({ method: 'DELETE', headers: { 'x-admin-token': 'valid_tok' } }, resMethod);
  assert.equal(resMethod.statusCode, 405);

  const resBadAction = createMockRes();
  await handler(
    { method: 'POST', headers: { 'x-admin-token': 'valid_tok' }, body: { action: 'drop_table' } },
    resBadAction,
  );
  assert.equal(resBadAction.statusCode, 400);

  const resBadBool = createMockRes();
  await handler(
    {
      method: 'POST',
      headers: { 'x-admin-token': 'valid_tok' },
      body: { action: 'set_mode', autoResumeEnabled: 'yes' },
    },
    resBadBool,
  );
  assert.equal(resBadBool.statusCode, 400);

  const resGet = createMockRes();
  await handler({ method: 'GET', headers: { 'x-admin-token': 'valid_tok' } }, resGet);
  assert.equal(resGet.statusCode, 200);
  assert.equal(resGet.body?.ok, true);

  const resSetMode = createMockRes();
  await handler(
    {
      method: 'POST',
      headers: { 'x-admin-token': 'valid_tok' },
      body: { action: 'set_mode', autoResumeEnabled: true },
    },
    resSetMode,
  );
  assert.equal(resSetMode.statusCode, 200);
  assert.equal(resSetMode.body?.data?.autoResumeEnabled, true);
});

test('7. Wiring, keamanan, batas fungsi Vercel, sintaks JS, & kepatuhan CSP dashboard', () => {
  const waSess = read('src/whatsapp_session.ts');
  assert.match(waSess, /__baileys_backup_state\.json/, 'clearSessionInSupabase wajib melindungi __baileys_backup_state.json');
  assert.match(waSess, /__baileys_backup_desktop\.json/, 'clearSessionInSupabase wajib melindungi __baileys_backup_desktop.json');

  const vercelJson = JSON.parse(read('vercel.json'));
  assert.ok(vercelJson.functions['api/baileys-backup.ts'], 'vercel.json harus mendaftarkan api/baileys-backup.ts');

  const apiRoot = path.resolve(new URL('../api', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
  let apiCount = 0;
  const walkApi = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.isDirectory()) walkApi(path.join(dir, ent.name));
      else if (ent.name.endsWith('.ts')) apiCount++;
    }
  };
  walkApi(apiRoot);
  assert.ok(apiCount <= 12, `Vercel Hobby max 12 Serverless Functions (saat ini ${apiCount})`);

  const reminders = read('api/cron/reminders.ts');
  assert.match(reminders, /cobaAutoResumeDariCron/, 'cron/reminders harus memanggil cobaAutoResumeDariCron');

  const dashHtml = read('public/dashboard.html');
  assert.match(dashHtml, /id="baileys-backup-section"/);
  assert.match(dashHtml, /src="\/js\/baileys-backup\.js"/);
  assert.ok(!/onclick=|onchange=/.test(dashHtml), 'dashboard.html tidak boleh memakai inline event handler');

  const jsPath = path.resolve(new URL('../public/js/baileys-backup.js', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
  assert.doesNotThrow(() => {
    execFileSync(process.execPath, ['--check', jsPath], { stdio: 'pipe' });
  }, 'public/js/baileys-backup.js harus lolos node --check');
});
