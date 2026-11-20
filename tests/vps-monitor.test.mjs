/**
 * TEST OTOMATIS — monitor lifecycle VPS (peringatan sebelum limit 120 menit & notif VPS mati/pulih).
 *
 * Isolasi penuh: menonaktifkan env Supabase, Telegram, dan InstaBox agar unit test
 * tidak pernah menyentuh database produksi atau mengirim pesan nyata.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

process.env.NODE_ENV = 'test';
process.env.DOTENV_CONFIG_PATH = '__nonexistent_env_for_test__';
process.env.SUPABASE_URL = '';
process.env.NEXT_PUBLIC_SUPABASE_URL = '';
process.env.SUPABASE_SERVICE_KEY = '';
process.env.SUPABASE_SERVICE_ROLE_KEY = '';
process.env.SUPABASE_SECRET_KEY = '';
process.env.TELEGRAM_BOT_TOKEN = '';
process.env.OWNER_CHAT_ID = '';
process.env.INSTABOX_API_KEY = '';
process.env.INSTABOX_MACHINE_ID = '';

const {
  parseInstaboxMachine,
  evaluasiStatusVps,
  cekLifecycleVps,
  resetVpsMonitorUntukTest,
} = await import('../src/vps_monitor.js');

const baca = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');

beforeEach(() => {
  resetVpsMonitorUntukTest();
});

test('1. parseInstaboxMachine mendukung flat camelCase, wrapper { machine }, snake_case, dan menolak invalid', () => {
  const flat = parseInstaboxMachine({
    id: 'm_abc123',
    name: 'freeaibot-wa',
    state: 'running',
    runStartedAt: '2026-11-20T02:33:14Z',
    maxRunMinutes: 120,
    cooldownUntil: null,
    free: true,
  });
  assert.deepEqual(flat, {
    id: 'm_abc123',
    name: 'freeaibot-wa',
    state: 'running',
    runStartedAt: '2026-11-20T02:33:14Z',
    maxRunMinutes: 120,
    cooldownUntil: null,
    free: true,
  });

  const wrapped = parseInstaboxMachine({
    machine: {
      machine_id: 'm_xyz',
      state: 'paused',
      run_started_at: '2026-11-20T02:00:00Z',
      max_run_minutes: '120',
      cooldown_until: '2026-11-20T04:06:00Z',
    },
  });
  assert.deepEqual(wrapped, {
    id: 'm_xyz',
    state: 'paused',
    runStartedAt: '2026-11-20T02:00:00Z',
    maxRunMinutes: 120,
    cooldownUntil: '2026-11-20T04:06:00Z',
  });

  assert.equal(parseInstaboxMachine(null), null);
  assert.equal(parseInstaboxMachine({ id: 'm_no_state' }), null);
  assert.equal(parseInstaboxMachine('invalid'), null);
});

test('2. evaluasiStatusVps TIDAK mengirim peringatan bila sisa waktu > 5 menit (menit ke-114 dari 120)', () => {
  const startIso = '2026-11-20T02:00:00.000Z';
  const startMs = Date.parse(startIso);
  const machine = {
    id: 'm_agq7ntihvch5wkk7jz6xvjicji',
    name: 'freeaibot-wa',
    state: 'running',
    runStartedAt: startIso,
    maxRunMinutes: 120,
    cooldownUntil: null,
  };

  const { events, nextState } = evaluasiStatusVps(machine, null, startMs + 114 * 60_000, 5);
  assert.equal(events.length, 0);
  assert.equal(nextState.warned_run_started_at, null);
});

test('3. evaluasiStatusVps mengirim peringatan_limit SEKALI pada menit ke-115 (sisa 5 menit) dan tidak spam di menit 117/121', () => {
  const startIso = '2026-11-20T02:00:00.000Z';
  const startMs = Date.parse(startIso);
  const machine = {
    id: 'm_agq7ntihvch5wkk7jz6xvjicji',
    name: 'freeaibot-wa',
    state: 'running',
    runStartedAt: startIso,
    maxRunMinutes: 120,
    cooldownUntil: null,
  };

  const r1 = evaluasiStatusVps(machine, null, startMs + 115 * 60_000, 5);
  assert.equal(r1.events.length, 1);
  assert.equal(r1.events[0].tipe, 'peringatan_limit');
  assert.equal(r1.events[0].sisaMenit, 5);
  assert.match(r1.events[0].pesanHtml, /<b>\[PERINGATAN LIMIT VPS\]<\/b>/);
  assert.equal(r1.nextState.warned_run_started_at, startIso);

  const r2 = evaluasiStatusVps(machine, r1.nextState, startMs + 117 * 60_000, 5);
  assert.equal(r2.events.length, 0, 'tidak boleh spam pada menit ke-117');

  const r3 = evaluasiStatusVps(machine, r2.nextState, startMs + 121 * 60_000, 5);
  assert.equal(r3.events.length, 0, 'tidak boleh spam pada menit ke-121 untuk runStartedAt yang sama');
});

test('4. evaluasiStatusVps mengaktifkan ulang peringatan_limit saat runStartedAt baru muncul setelah restart', () => {
  const run1 = '2026-11-20T02:00:00.000Z';
  const run2 = '2026-11-20T05:00:00.000Z';
  const prev = {
    last_state: 'running',
    last_run_started_at: run1,
    warned_run_started_at: run1,
    down_notified_at: null,
    last_checked_at: '2026-11-20T03:56:00.000Z',
    last_shutdown_at: null,
  };
  const machine = {
    id: 'm_agq7',
    name: 'freeaibot-wa',
    state: 'running',
    runStartedAt: run2,
    maxRunMinutes: 120,
    cooldownUntil: null,
  };

  const { events, nextState } = evaluasiStatusVps(machine, prev, Date.parse(run2) + 116 * 60_000, 5);
  assert.equal(events.length, 1);
  assert.equal(events[0].tipe, 'peringatan_limit');
  assert.equal(nextState.warned_run_started_at, run2);
});

test('5. evaluasiStatusVps tidak mengirim peringatan bila maxRunMinutes <= 0 (paket unlimited)', () => {
  const startIso = '2026-11-20T02:00:00.000Z';
  const machine = {
    id: 'm_paid',
    name: 'freeaibot-wa',
    state: 'running',
    runStartedAt: startIso,
    maxRunMinutes: -1,
    cooldownUntil: null,
  };

  const { events } = evaluasiStatusVps(machine, null, Date.parse(startIso) + 500 * 60_000, 5);
  assert.equal(events.length, 0);
});

test('6. evaluasiStatusVps mengirim vps_mati SEKALI saat paused/stopped dan vps_pulih SEKALI saat kembali running', () => {
  const startIso = '2026-11-20T02:00:00.000Z';
  const pausedMachine = {
    id: 'm_agq7_test',
    name: 'freeaibot-wa',
    state: 'paused',
    runStartedAt: startIso,
    maxRunMinutes: 120,
    cooldownUntil: '2026-11-20T04:06:00.000Z',
  };

  const r1 = evaluasiStatusVps(pausedMachine, null, Date.parse('2026-11-20T04:00:10.000Z'), 5);
  assert.equal(r1.events.length, 1);
  assert.equal(r1.events[0].tipe, 'vps_mati');
  assert.ok(r1.nextState.down_notified_at);
  assert.match(r1.events[0].pesanHtml, /cooldown/i);

  // Poll ulang saat masih paused -> TIDAK boleh kirim ulang
  const r2 = evaluasiStatusVps(pausedMachine, r1.nextState, Date.parse('2026-11-20T04:02:10.000Z'), 5);
  assert.equal(r2.events.length, 0);

  // Kembali running -> kirim vps_pulih dan bersihkan down_notified_at
  const runNew = '2026-11-20T04:07:00.000Z';
  const r3 = evaluasiStatusVps(
    {
      id: 'm_agq7_test',
      name: 'freeaibot-wa',
      state: 'running',
      runStartedAt: runNew,
      maxRunMinutes: 120,
      cooldownUntil: null,
    },
    r2.nextState,
    Date.parse(runNew) + 60_000,
    5,
  );
  assert.equal(r3.events.length, 1);
  assert.equal(r3.events[0].tipe, 'vps_pulih');
  assert.equal(r3.nextState.down_notified_at, null);
});

test('7. evaluasiStatusVps tidak menduplikasi vps_mati jika down_notified_at sudah dicatat hook SIGTERM', () => {
  const prev = {
    last_state: 'stopped',
    last_run_started_at: '2026-11-20T02:00:00.000Z',
    warned_run_started_at: null,
    down_notified_at: '2026-11-20T03:30:00.000Z',
    last_checked_at: null,
    last_shutdown_at: '2026-11-20T03:30:00.000Z',
  };
  const { events } = evaluasiStatusVps(
    {
      id: 'm_agq7',
      name: 'freeaibot-wa',
      state: 'stopped',
      runStartedAt: '2026-11-20T02:00:00.000Z',
      maxRunMinutes: 120,
      cooldownUntil: null,
    },
    prev,
    Date.parse('2026-11-20T03:31:00.000Z'),
    5,
  );
  assert.equal(events.length, 0);
});

test('8. cekLifecycleVps skip saat env kosong dan hanya memanggil GET /v1/machines/{id} dengan Bearer auth', async () => {
  const skipped = await cekLifecycleVps();
  assert.deepEqual(skipped, {
    checked: false,
    state: null,
    events: [],
    skipped: 'not_configured',
  });

  const calls = [];
  const telegramSent = [];
  let savedState = null;
  const startIso = '2026-11-20T02:00:00.000Z';

  const res = await cekLifecycleVps({
    apiKey: 'dummy_key_for_test',
    machineId: 'm_test_123',
    apiBase: 'https://api.instabox.sh/',
    nowMs: Date.parse(startIso) + 115 * 60_000,
    warnBeforeMinutes: 5,
    readState: async () => null,
    writeState: async (st) => {
      savedState = st;
    },
    sendTelegram: async (msg) => {
      telegramSent.push(msg);
      return true;
    },
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), method: init?.method, auth: init?.headers });
      return new Response(
        JSON.stringify({
          id: 'm_test_123',
          name: 'freeaibot-wa',
          state: 'running',
          runStartedAt: startIso,
          maxRunMinutes: 120,
          cooldownUntil: null,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    },
  });

  assert.equal(res.checked, true);
  assert.equal(res.state, 'running');
  assert.deepEqual(res.events, ['peringatan_limit']);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.instabox.sh/v1/machines/m_test_123');
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[0].auth.Authorization, 'Bearer dummy_key_for_test');
  assert.equal(telegramSent.length, 1);
  assert.equal(savedState?.warned_run_started_at, startIso);
});

test('9. Kepatuhan pasif & wiring: tidak ada /exec, /activity-leases, setInterval, dan cron/baileys terhubung benar', () => {
  const VPS_MON = baca('src/vps_monitor.ts')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
  const WA_SESS = baca('src/whatsapp_session.ts');
  const CRON = baca('api/cron/reminders.ts');
  const BAILEYS = baca('src/whatsapp_baileys.ts');

  assert.ok(!/\/exec\b/.test(VPS_MON), 'vps_monitor.ts tidak boleh memanggil /exec');
  assert.ok(!/activity-leases/i.test(VPS_MON), 'vps_monitor.ts tidak boleh memperpanjang activity-leases');
  assert.ok(!/\bsetInterval\b/.test(VPS_MON), 'vps_monitor.ts tidak boleh memakai setInterval');
  assert.match(WA_SESS, /__vps_monitor_state\.json/, 'clearSessionInSupabase wajib melindungi __vps_monitor_state.json');
  assert.match(CRON, /cekLifecycleVps\(/, 'api/cron/reminders.ts harus memanggil cekLifecycleVps()');
  assert.match(BAILEYS, /laporShutdownVps\(/, 'whatsapp_baileys.ts harus memanggil laporShutdownVps()');
  assert.match(BAILEYS, /mulaiTimerPeringatanLokalVps\(/, 'whatsapp_baileys.ts harus memanggil mulaiTimerPeringatanLokalVps()');
});
