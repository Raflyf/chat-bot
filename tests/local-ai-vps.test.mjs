import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  LOCAL_AI_KEEPALIVE_LEASE_ID,
  cobaKeepaliveDanAutoResumeVps2DariCron,
  defaultLocalAiVpsState,
  getEffectiveLocalAiPriority,
  getLocalAiVpsSnapshot,
  resetLocalAiVpsCacheUntukTest,
  runManualLocalAiVpsKeepalive,
  runManualLocalAiVpsResume,
  setLocalAiAutoResumeMode,
  setLocalAiKeepaliveMode,
  setLocalAiPrimaryMode,
} from '../src/local_ai_vps.ts';
import { defaultKeepaliveState } from '../src/vps_keepalive.ts';
import { createBaileysBackupHandler } from '../api/baileys-backup.ts';

function createMockRes() {
  const out = { statusCode: 200, headers: {}, body: null };
  return {
    out,
    setHeader(k, v) { out.headers[k] = v; },
    status(code) { out.statusCode = code; return this; },
    json(payload) { out.body = payload; return this; },
  };
}

test('setLocalAiPrimaryMode mengubah prioritas live antara primary (ON) dan fallback (OFF)', async () => {
  resetLocalAiVpsCacheUntukTest();
  let stored = defaultLocalAiVpsState();
  let storedKa = defaultKeepaliveState();
  const mockFetch = async (url) => {
    if (String(url).includes('/v1/machines/')) {
      return new Response(
        JSON.stringify({
          id: 'm_test_ai2',
          name: 'bonsai-ai-server',
          state: 'running',
          runStartedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
          maxRunMinutes: 120,
          autoSuspendAfterSeconds: 1800,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
  };
  const deps = {
    apiKey: 'ibk_test2',
    machineId: 'm_test_ai2',
    aiBaseUrl: 'https://ai2.example.test/v1',
    aiApiKey: 'bsk_test2',
    fetchImpl: mockFetch,
    readState: async () => stored,
    writeState: async (s) => { stored = s; },
    readKeepalive: async () => storedKa,
    writeKeepalive: async (k) => { storedKa = k; },
  };

  const resOn = await setLocalAiPrimaryMode(true, deps);
  assert.equal(resOn.ok, true);
  assert.equal(resOn.data.useAsPrimary, true);
  assert.equal(resOn.data.aiHealthOk, true);
  assert.equal(getEffectiveLocalAiPriority(), 'primary');

  const resOff = await setLocalAiPrimaryMode(false, deps);
  assert.equal(resOff.ok, true);
  assert.equal(resOff.data.useAsPrimary, false);
  assert.equal(getEffectiveLocalAiPriority(), 'fallback');
  resetLocalAiVpsCacheUntukTest();
});

test('endpoint /api/baileys-backup target=ai mendukung GET snapshot, set_primary, set_mode, set_keepalive, keepalive, resume, dan fail-closed 401', async () => {
  resetLocalAiVpsCacheUntukTest();
  let stored = defaultLocalAiVpsState();
  let storedKa = defaultKeepaliveState();
  const calls = [];
  const mockFetch = async (url, init) => {
    calls.push({ url: String(url), method: init?.method || 'GET' });
    if (String(url).includes('/activity-leases/')) {
      return new Response(JSON.stringify({ expiresAt: new Date(Date.now() + 3600_000).toISOString() }), { status: 200 });
    }
    if (String(url).endsWith('/resume')) {
      return new Response(JSON.stringify({ id: 'op_1' }), { status: 202 });
    }
    if (String(url).includes('/v1/machines/')) {
      return new Response(
        JSON.stringify({
          id: 'm_test_ai2',
          name: 'bonsai-ai-server',
          state: 'running',
          runStartedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
          maxRunMinutes: 120,
          autoSuspendAfterSeconds: 1800,
        }),
        { status: 200 },
      );
    }
    return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
  };

  const handler = createBaileysBackupHandler({
    verifyToken: async (tok) => tok === 'valid-pin-token',
    extractToken: (req) => req.headers?.authorization?.replace(/^Bearer\s+/i, '') || null,
    getIp: () => '127.0.0.1',
    rateLimit: () => ({ boleh: true, sisa: 50, resetDalamDetik: 60 }),
    aiServiceDeps: {
      apiKey: 'ibk_test2',
      machineId: 'm_test_ai2',
      aiBaseUrl: 'https://ai2.example.test/v1',
      aiApiKey: 'bsk_test2',
      fetchImpl: mockFetch,
      readState: async () => stored,
      writeState: async (s) => { stored = s; },
      readKeepalive: async () => storedKa,
      writeKeepalive: async (k) => { storedKa = k; },
    },
  });

  // Fail-closed tanpa token
  const unauthRes = createMockRes();
  await handler({ method: 'GET', query: { target: 'ai' }, headers: {} }, unauthRes);
  assert.equal(unauthRes.out.statusCode, 401);

  // GET ?target=ai
  const getRes = createMockRes();
  await handler({ method: 'GET', query: { target: 'ai' }, headers: { authorization: 'Bearer valid-pin-token' } }, getRes);
  assert.equal(getRes.out.statusCode, 200);
  assert.equal(getRes.out.body.ok, true);
  assert.equal(getRes.out.body.data.vpsAvailability, 'running');

  // POST set_primary = true
  const primRes = createMockRes();
  await handler(
    {
      method: 'POST',
      query: {},
      headers: { authorization: 'Bearer valid-pin-token' },
      body: { target: 'ai', action: 'set_primary', useAsPrimary: true },
    },
    primRes,
  );
  assert.equal(primRes.out.statusCode, 200);
  assert.equal(primRes.out.body.data.useAsPrimary, true);

  // POST keepalive harus memakai lease ID khusus VPS 2
  const pingRes = createMockRes();
  await handler(
    {
      method: 'POST',
      query: {},
      headers: { authorization: 'Bearer valid-pin-token' },
      body: { target: 'ai', action: 'keepalive' },
    },
    pingRes,
  );
  assert.equal(pingRes.out.statusCode, 200);
  assert.equal(pingRes.out.body.ok, true);
  assert.ok(calls.some((c) => c.url.includes(`/activity-leases/${LOCAL_AI_KEEPALIVE_LEASE_ID}`) && c.method === 'PUT'));

  // POST set_mode & set_keepalive
  const modeRes = createMockRes();
  await handler(
    {
      method: 'POST',
      query: {},
      headers: { authorization: 'Bearer valid-pin-token' },
      body: { target: 'ai', action: 'set_mode', autoResumeEnabled: true },
    },
    modeRes,
  );
  assert.equal(modeRes.out.statusCode, 200);
  assert.equal(modeRes.out.body.data.autoResumeEnabled, true);

  const kaOffRes = createMockRes();
  await handler(
    {
      method: 'POST',
      query: {},
      headers: { authorization: 'Bearer valid-pin-token' },
      body: { target: 'ai', action: 'set_keepalive', keepaliveEnabled: false },
    },
    kaOffRes,
  );
  assert.equal(kaOffRes.out.statusCode, 200);
  assert.equal(kaOffRes.out.body.data.keepalive.enabled, false);
  assert.ok(calls.some((c) => c.url.includes(`/activity-leases/${LOCAL_AI_KEEPALIVE_LEASE_ID}`) && c.method === 'DELETE'));
  resetLocalAiVpsCacheUntukTest();
});

test('cron VPS 2 melakukan auto-resume saat paused dan autoResumeEnabled=true', async () => {
  resetLocalAiVpsCacheUntukTest();
  let stored = { ...defaultLocalAiVpsState(), autoResumeEnabled: true };
  let storedKa = defaultKeepaliveState();
  let resumed = false;
  const mockFetch = async (url, init) => {
    if (String(url).endsWith('/resume') && init?.method === 'POST') {
      resumed = true;
      return new Response(JSON.stringify({ id: 'op_resume_ai2' }), { status: 202 });
    }
    return new Response(
      JSON.stringify({ id: 'm_test_ai2', name: 'bonsai-ai-server', state: 'paused' }),
      { status: 200 },
    );
  };
  const result = await cobaKeepaliveDanAutoResumeVps2DariCron({
    apiKey: 'ibk_test2',
    machineId: 'm_test_ai2',
    fetchImpl: mockFetch,
    readState: async () => stored,
    writeState: async (s) => { stored = s; },
    readKeepalive: async () => storedKa,
    writeKeepalive: async (k) => { storedKa = k; },
  });
  assert.equal(result.configured, true);
  assert.equal(result.autoResume.attempted, true);
  assert.equal(result.autoResume.ok, true);
  assert.equal(resumed, true);
  resetLocalAiVpsCacheUntukTest();
});

test('UI dashboard memuat panel VPS 2, tombol ON/OFF Model Utama, dan wiring script', () => {
  const html = fs.readFileSync(new URL('../public/dashboard.html', import.meta.url), 'utf8');
  const js = fs.readFileSync(new URL('../public/js/local-ai-vps.js', import.meta.url), 'utf8');
  const dash = fs.readFileSync(new URL('../public/js/dashboard.js', import.meta.url), 'utf8');

  assert.ok(html.includes('id="local-ai-vps-section"'));
  assert.ok(html.includes('id="ai2-btn-primary"'));
  assert.ok(html.includes('id="ai2-btn-auto-resume"'));
  assert.ok(html.includes('id="ai2-btn-keepalive"'));
  assert.ok(html.includes('id="ai2-btn-ping"'));
  assert.ok(html.includes('id="ai2-btn-resume"'));
  assert.ok(html.includes('id="ai2-btn-check"'));
  assert.ok(html.includes('<script src="/js/local-ai-vps.js"></script>'));
  assert.ok(js.includes('action: "set_primary"'));
  assert.ok(js.includes('/api/baileys-backup?target=ai'));
  assert.ok(dash.includes('window.LocalAiVpsPanel'));
});
