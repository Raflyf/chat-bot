/**
 * TEST KEEPALIVE VPS (anti idle-pause InstaBox).
 *
 * Fokus: mekanisme resmi `PUT /v1/machines/{id}/activity-leases/{leaseID}`
 * dipanggil dengan URL/body benar, guard interval/cooldown bekerja, dan
 * lease TIDAK diperbarui saat mesin tidak RUNNING (agar tidak membangunkan
 * mesin yang di-pause sah).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  KEEPALIVE_LEASE_ID,
  defaultKeepaliveState,
  getKeepaliveConfig,
  jalankanKeepaliveVps,
  normalizeKeepaliveState,
  renewVpsActivityLease,
  setKeepaliveEnabled,
} from '../src/vps_keepalive.js';
import { buildKeepaliveView } from '../src/baileys_backup_web.js';

const NOW_MS = Date.parse('2026-11-22T15:00:00Z');
const NOW_SECS = Math.floor(NOW_MS / 1000);

function memStore(initial = null) {
  let state = initial;
  return {
    read: async () => (state ? { ...state } : null),
    write: async (next) => {
      state = { ...next };
    },
    get: () => state,
  };
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('1. normalizeKeepaliveState mengisi default & membersihkan error', () => {
  const def = normalizeKeepaliveState(null);
  assert.equal(def.ping_count, 0);
  assert.equal(def.enabled, defaultKeepaliveState().enabled);
  assert.equal(def.last_error, null);

  const cleaned = normalizeKeepaliveState({
    enabled: false,
    ping_count: '7',
    last_error: '  boom\nline\u0000  ',
    last_ping_source: 'cron',
    idle_window_source: 'live',
    idle_window_secs: 1800,
  });
  assert.equal(cleaned.enabled, false);
  assert.equal(cleaned.ping_count, 7);
  assert.equal(cleaned.last_error, 'boom line');
  assert.equal(cleaned.last_ping_source, 'cron');
  assert.equal(cleaned.idle_window_source, 'live');
  assert.equal(cleaned.idle_window_secs, 1800);
});

test('2. renewVpsActivityLease memanggil endpoint lease yang benar + parse expiresAt', async () => {
  const calls = [];
  const result = await renewVpsActivityLease({
    apiKey: 'ibk_test',
    machineId: 'm_test',
    apiBase: 'https://api.instabox.sh',
    intervalSecs: 600,
    leaseTtlSecs: 1200,
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return jsonResponse(200, {
        id: KEEPALIVE_LEASE_ID,
        machineId: 'm_test',
        expiresAt: '2026-11-22T15:20:26.783Z',
      });
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    `https://api.instabox.sh/v1/machines/m_test/activity-leases/${KEEPALIVE_LEASE_ID}`,
  );
  assert.equal(calls[0].init.method, 'PUT');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer ibk_test');
  assert.deepEqual(JSON.parse(calls[0].init.body), { ttlSeconds: 1200 });
  assert.equal(result.leaseExpiresAt, Math.floor(Date.parse('2026-11-22T15:20:26.783Z') / 1000));
});

test('3. sukses: ping_count naik, next_ping & lease_expires tersimpan', async () => {
  const store = memStore();
  const calls = [];
  const run = await jalankanKeepaliveVps({
    trigger: 'cron',
    nowMs: NOW_MS,
    apiKey: 'k',
    machineId: 'm',
    observedState: 'running',
    autoSuspendSeconds: 1800,
    readState: store.read,
    writeState: store.write,
    fetchImpl: async () => {
      calls.push(1);
      return jsonResponse(200, { expiresAt: '2026-11-22T15:20:00Z' });
    },
  });

  assert.equal(run.attempted, true);
  assert.equal(run.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(run.state.ping_count, 1);
  assert.equal(run.state.last_ping_at, NOW_SECS);
  assert.equal(run.state.last_ping_source, 'cron');
  assert.equal(run.state.next_ping_at, NOW_SECS + getKeepaliveConfig().intervalSecs);
  assert.equal(run.state.lease_expires_at, Math.floor(Date.parse('2026-11-22T15:20:00Z') / 1000));
  assert.equal(run.state.idle_window_secs, 1800);
  assert.equal(run.state.idle_window_source, 'live');
  assert.equal(store.get().ping_count, 1);
});

test('4. guard interval mencegah ping berulang; force menembus guard', async () => {
  const store = memStore({
    ...defaultKeepaliveState(),
    enabled: true,
    last_ping_at: NOW_SECS - 120,
  });
  let calls = 0;
  const base = {
    trigger: 'cron',
    nowMs: NOW_MS,
    apiKey: 'k',
    machineId: 'm',
    observedState: 'running',
    readState: store.read,
    writeState: store.write,
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse(200, { expiresAt: '2026-11-22T15:20:00Z' });
    },
  };

  const skipped = await jalankanKeepaliveVps(base);
  assert.equal(skipped.attempted, false);
  assert.equal(skipped.reason, 'interval');
  assert.equal(calls, 0);

  const forced = await jalankanKeepaliveVps({ ...base, force: true });
  assert.equal(forced.attempted, true);
  assert.equal(forced.ok, true);
  assert.equal(calls, 1);
});

test('5. disabled & mesin tidak RUNNING tidak pernah menembak endpoint', async () => {
  let calls = 0;
  const store = memStore({ ...defaultKeepaliveState(), enabled: false });
  const disabled = await jalankanKeepaliveVps({
    trigger: 'web',
    nowMs: NOW_MS,
    apiKey: 'k',
    machineId: 'm',
    observedState: 'running',
    readState: store.read,
    writeState: store.write,
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse(200, {});
    },
  });
  assert.equal(disabled.reason, 'disabled');
  assert.equal(calls, 0);

  const store2 = memStore({ ...defaultKeepaliveState(), enabled: true });
  const paused = await jalankanKeepaliveVps({
    trigger: 'cron',
    nowMs: NOW_MS,
    apiKey: 'k',
    machineId: 'm',
    observedState: 'paused',
    readState: store2.read,
    writeState: store2.write,
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse(200, {});
    },
  });
  assert.equal(paused.reason, 'not_running');
  assert.equal(calls, 0);
});

test('6. gagal: consecutive_failures naik, cooldown dipasang, guard cooldown bekerja', async () => {
  const store = memStore({ ...defaultKeepaliveState(), enabled: true });
  const base = {
    trigger: 'cron',
    nowMs: NOW_MS,
    apiKey: 'k',
    machineId: 'm',
    observedState: 'running',
    readState: store.read,
    writeState: store.write,
    force: true,
    fetchImpl: async () =>
      jsonResponse(500, { error: { message: 'server meledak' } }),
  };

  const first = await jalankanKeepaliveVps(base);
  assert.equal(first.attempted, true);
  assert.equal(first.ok, false);
  assert.equal(first.state.consecutive_failures, 1);
  assert.equal(first.state.fail_count, 1);
  assert.ok(first.state.cooldown_until > NOW_SECS);
  assert.match(String(first.state.last_error), /HTTP 500/);

  const guarded = await jalankanKeepaliveVps({ ...base, force: false });
  assert.equal(guarded.attempted, false);
  assert.equal(guarded.reason, 'cooldown');
});

test('7. setKeepaliveEnabled durable + mematikan cooldown saat OFF', async () => {
  const store = memStore({
    ...defaultKeepaliveState(),
    enabled: true,
    cooldown_until: NOW_SECS + 900,
    next_ping_at: NOW_SECS + 600,
  });
  const off = await setKeepaliveEnabled(false, 'web', {
    nowMs: NOW_MS,
    readState: store.read,
    writeState: store.write,
  });
  assert.equal(off.enabled, false);
  assert.equal(off.cooldown_until, null);
  assert.equal(off.next_ping_at, null);
  assert.equal(off.enabled_updated_by, 'web');

  const on = await setKeepaliveEnabled(true, 'cron', {
    nowMs: NOW_MS,
    readState: store.read,
    writeState: store.write,
  });
  assert.equal(on.enabled, true);
  assert.equal(on.enabled_updated_by, 'cron');
});

test('8. buildKeepaliveView memakai jendela idle LIVE dan menghitung pause dari lease', () => {
  const view = buildKeepaliveView(
    {
      ...defaultKeepaliveState(),
      enabled: true,
      last_ping_at: NOW_SECS - 60,
      next_ping_at: NOW_SECS + 540,
      lease_expires_at: NOW_SECS + 1140,
      ping_count: 3,
    },
    {
      id: 'm',
      state: 'running',
      runStartedAt: '2026-11-22T14:22:13Z',
      maxRunMinutes: 120,
      autoSuspendAfterSeconds: 1800,
      cooldownUntil: null,
    },
    NOW_MS,
  );

  assert.equal(view.idleWindowSecs, 1800);
  assert.equal(view.idleWindowSource, 'live');
  assert.equal(view.idleSecs, 60);
  assert.equal(view.nextPingInSecs, 540);
  assert.equal(view.leaseRemainingSecs, 1140);
  // Lease expiry + idle window = satu-satunya titik pause yang benar.
  assert.equal(view.pauseInSecs, 1140 + 1800);
  assert.equal(view.atRisk, false);
});

test('9. buildKeepaliveView fallback config saat API tidak melaporkan jendela idle', () => {  const view = buildKeepaliveView(
    {
      ...defaultKeepaliveState(),
      enabled: false,
      last_ping_at: NOW_SECS - 1200,
    },
    {
      id: 'm',
      state: 'running',
      runStartedAt: null,
      maxRunMinutes: 120,
      autoSuspendAfterSeconds: null,
      cooldownUntil: null,
    },
    NOW_MS,
  );

  assert.equal(view.idleWindowSource, 'config');
  assert.equal(view.idleWindowSecs, 1800);
  assert.equal(view.nextPingInSecs, null);
  // 1200s terpakai dari 1800s -> sisa 600s.
  assert.equal(view.pauseInSecs, 600);
  assert.equal(view.atRisk, false);
});

test('10. ping manual tetap bekerja saat auto-ping OFF (ignoreEnabled)', async () => {
  const store = memStore({ ...defaultKeepaliveState(), enabled: false });
  const run = await jalankanKeepaliveVps({
    trigger: 'web',
    force: true,
    ignoreEnabled: true,
    nowMs: NOW_MS,
    apiKey: 'k',
    machineId: 'm',
    observedState: 'running',
    readState: store.read,
    writeState: store.write,
    fetchImpl: async () => jsonResponse(200, { expiresAt: '2026-11-22T15:20:00Z' }),
  });

  assert.equal(run.attempted, true);
  assert.equal(run.ok, true);
  assert.equal(run.state.ping_count, 1);
  assert.equal(run.state.enabled, false);
});
