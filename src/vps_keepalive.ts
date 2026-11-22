/**
 * AUTO-PING / ACTIVITY LEASE VPS BAILEYS (ANTI AUTO-PAUSE)
 *
 * InstaBox mem-pause sandbox yang idle selama `autoSuspendAfterSeconds`
 * (free plan: 1800 detik = 30 menit). Endpoint resmi untuk menandai bahwa masih
 * ada agen yang bekerja adalah:
 *
 *   PUT /v1/machines/{id}/activity-leases/{leaseID}  { "ttlSeconds": 3600 }
 *
 * Selama lease aktif mesin TIDAK dihitung idle ("Expiry starts a full idle
 * period"). Lease diperbarui sebelum kedaluwarsa, lalu pause otomatis tidak
 * pernah tercapai karena idle.
 *
 * Modul ini SENGAJA tidak mengirim terminal I/O palsu ke dalam VM. Satu lease
 * stabil (`baileys-bot-keepalive`) diperbarui dari control plane, yaitu:
 *   - cron /api/cron/reminders (setiap 5 menit, sumber utama), dan
 *   - tombol "Ping VPS Sekarang" di dashboard (sumber manual).
 *
 * Yang TIDAK dilakukan modul ini: memperpanjang batas runtime (`maxRunMinutes`)
 * atau mengaktifkan VPS yang sedang paused/stopped. Bila mesin tidak berjalan,
 * ping dilewati agar tidak melawan pause yang sah (mis. batas runtime habis).
 */
import { db } from './db.js';
import { config } from './env.js';

export const KEEPALIVE_STATE_FILENAME = '__vps_keepalive_state.json';
/** Satu lease stabil: renewing lease ID yang sama tidak menumpuk lease baru. */
export const KEEPALIVE_LEASE_ID = 'baileys-bot-keepalive';
export const MIN_KEEPALIVE_INTERVAL_SECS = 60;
export const MAX_KEEPALIVE_LEASE_TTL_SECS = 3600;
const LEASE_TTL_MIN_SECS = 30;
const ERROR_MAX_LEN = 160;

const RUNNABLE_STATES = new Set([
  'running',
  'starting',
  'resuming',
  'creating',
  'booting',
  'provisioning',
]);

export type KeepaliveSource = 'web' | 'cron' | 'vps';

export interface VpsKeepaliveState {
  enabled: boolean;
  enabled_updated_at: number | null;
  enabled_updated_by: KeepaliveSource | null;
  /** Epoch detik ping SUKSES terakhir. */
  last_ping_at: number | null;
  /** Epoch detik percobaan terakhir (sukses maupun gagal). */
  last_attempt_at: number | null;
  last_ping_ok: boolean;
  last_ping_latency_ms: number | null;
  last_ping_source: KeepaliveSource | null;
  /** Jumlah ping SUKSES. */
  ping_count: number;
  fail_count: number;
  consecutive_failures: number;
  last_error: string | null;
  next_ping_at: number | null;
  cooldown_until: number | null;
  lease_expires_at: number | null;
  idle_window_secs: number | null;
  idle_window_source: 'live' | 'config' | 'unknown';
  updated_at: number | null;
}

export interface KeepaliveDeps {
  fetchImpl?: typeof fetch;
  nowMs?: number;
  apiKey?: string;
  machineId?: string;
  apiBase?: string;
  intervalSecs?: number;
  leaseTtlSecs?: number;
  readState?: () => Promise<VpsKeepaliveState | null>;
  writeState?: (state: VpsKeepaliveState) => Promise<void>;
}

export interface KeepaliveRunOptions extends KeepaliveDeps {
  trigger: KeepaliveSource;
  /** Abaikan guard interval & cooldown (tombol dashboard). */
  force?: boolean;
  /** Tetap kirim ping walau auto-ping dimatikan (ping manual satu kali). */
  ignoreEnabled?: boolean;
  observedState?: string | null;
  /** Nilai `autoSuspendAfterSeconds` dari GET mesin, bila sudah diketahui. */
  autoSuspendSeconds?: number | null;
}

export interface KeepaliveRunResult {
  attempted: boolean;
  ok?: boolean;
  reason?: 'not_configured' | 'disabled' | 'interval' | 'cooldown' | 'not_running' | 'error';
  message?: string;
  httpStatus?: number;
  state: VpsKeepaliveState;
}

let memState: VpsKeepaliveState | null = null;

/** Reset cache in-memory untuk isolasi unit test. */
export function resetVpsKeepaliveUntukTest(): void {
  memState = null;
}

function asRecord(val: unknown): Record<string, unknown> | null {
  return val && typeof val === 'object' && !Array.isArray(val)
    ? (val as Record<string, unknown>)
    : null;
}

function toEpochOrNull(val: unknown): number | null {
  if (val === null || val === undefined || val === '') return null;
  const n = Number(val);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

function toCount(val: unknown): number {
  const n = Number(val);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function clampInt(val: number, min: number, max: number): number {
  if (!Number.isFinite(val)) return min;
  return Math.max(min, Math.min(max, Math.floor(val)));
}

export function getKeepaliveConfig(overrides: {
  intervalSecs?: number;
  leaseTtlSecs?: number;
} = {}): { intervalSecs: number; leaseTtlSecs: number } {
  const intervalSecs = clampInt(
    overrides.intervalSecs ?? config.vpsKeepaliveIntervalSeconds,
    MIN_KEEPALIVE_INTERVAL_SECS,
    MAX_KEEPALIVE_LEASE_TTL_SECS,
  );
  // Lease harus bertahan minimal 2x interval agar selalu ada cadangan bila satu
  // siklus cron terlewat (GitHub Actions bisa tertunda beberapa menit).
  const minTtl = Math.min(MAX_KEEPALIVE_LEASE_TTL_SECS, intervalSecs * 2);
  const leaseTtlSecs = clampInt(
    overrides.leaseTtlSecs ?? config.vpsKeepaliveLeaseTtlSeconds,
    Math.max(LEASE_TTL_MIN_SECS, minTtl),
    MAX_KEEPALIVE_LEASE_TTL_SECS,
  );
  return { intervalSecs, leaseTtlSecs };
}

export function defaultKeepaliveState(): VpsKeepaliveState {
  return {
    enabled: config.vpsKeepaliveEnabled,
    enabled_updated_at: null,
    enabled_updated_by: null,
    last_ping_at: null,
    last_attempt_at: null,
    last_ping_ok: false,
    last_ping_latency_ms: null,
    last_ping_source: null,
    ping_count: 0,
    fail_count: 0,
    consecutive_failures: 0,
    last_error: null,
    next_ping_at: null,
    cooldown_until: null,
    lease_expires_at: null,
    idle_window_secs: null,
    idle_window_source: 'unknown',
    updated_at: null,
  };
}

export function normalizeKeepaliveState(raw: unknown): VpsKeepaliveState {
  const def = defaultKeepaliveState();
  const obj = asRecord(raw);
  if (!obj) return def;
  const sourceRaw = String(obj.enabled_updated_by ?? obj.last_ping_source ?? '');
  const source: KeepaliveSource | null =
    sourceRaw === 'web' || sourceRaw === 'cron' || sourceRaw === 'vps' ? sourceRaw : null;
  const pingSourceRaw = String(obj.last_ping_source ?? '');
  const pingSource: KeepaliveSource | null =
    pingSourceRaw === 'web' || pingSourceRaw === 'cron' || pingSourceRaw === 'vps'
      ? pingSourceRaw
      : null;
  const windowSrcRaw = String(obj.idle_window_source ?? '');
  const windowSource: VpsKeepaliveState['idle_window_source'] =
    windowSrcRaw === 'live' || windowSrcRaw === 'config' ? windowSrcRaw : 'unknown';
  const errorText =
    typeof obj.last_error === 'string'
      ? obj.last_error
          .replace(/[\x00-\x1f\x7f]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
      : '';
  const cleanError = errorText ? errorText.slice(0, ERROR_MAX_LEN) : null;
  return {
    enabled: typeof obj.enabled === 'boolean' ? obj.enabled : def.enabled,
    enabled_updated_at: toEpochOrNull(obj.enabled_updated_at),
    enabled_updated_by: source,
    last_ping_at: toEpochOrNull(obj.last_ping_at),
    last_attempt_at: toEpochOrNull(obj.last_attempt_at),
    last_ping_ok: Boolean(obj.last_ping_ok),
    last_ping_latency_ms: toCount(obj.last_ping_latency_ms),
    last_ping_source: pingSource,
    ping_count: toCount(obj.ping_count),
    fail_count: toCount(obj.fail_count),
    consecutive_failures: toCount(obj.consecutive_failures),
    last_error: cleanError,
    next_ping_at: toEpochOrNull(obj.next_ping_at),
    cooldown_until: toEpochOrNull(obj.cooldown_until),
    lease_expires_at: toEpochOrNull(obj.lease_expires_at),
    idle_window_secs: toCount(obj.idle_window_secs) || null,
    idle_window_source: windowSource,
    updated_at: toEpochOrNull(obj.updated_at),
  };
}

export async function bacaKeepaliveState(): Promise<VpsKeepaliveState | null> {
  const c = db();
  if (!c) return memState ? { ...memState } : null;
  try {
    const { data, error } = await c
      .from('whatsapp_sessions')
      .select('content')
      .eq('filename', KEEPALIVE_STATE_FILENAME)
      .maybeSingle();
    if (error || !data?.content) {
      return memState ? { ...memState } : null;
    }
    const parsed = normalizeKeepaliveState(JSON.parse(String(data.content)));
    memState = parsed;
    return { ...parsed };
  } catch {
    return memState ? { ...memState } : null;
  }
}

export async function simpanKeepaliveState(state: VpsKeepaliveState): Promise<void> {
  memState = { ...state };
  const c = db();
  if (!c) return;
  try {
    const { error } = await c.from('whatsapp_sessions').upsert({
      filename: KEEPALIVE_STATE_FILENAME,
      content: JSON.stringify(state),
      updated_at: new Date().toISOString(),
    });
    if (error) {
      console.warn('[vps-keepalive] Gagal simpan state ke Supabase:', error.message);
    }
  } catch (err) {
    console.warn(
      '[vps-keepalive] Exception simpan state:',
      String((err as Error)?.message ?? err).slice(0, 120),
    );
  }
}

export async function setKeepaliveEnabled(
  enabled: boolean,
  source: KeepaliveSource = 'web',
  deps: Pick<KeepaliveDeps, 'nowMs' | 'readState' | 'writeState'> = {},
): Promise<VpsKeepaliveState> {
  const nowSecs = Math.floor((deps.nowMs ?? Date.now()) / 1000);
  const readFn = deps.readState ?? bacaKeepaliveState;
  const writeFn = deps.writeState ?? simpanKeepaliveState;
  const current = (await readFn()) ?? defaultKeepaliveState();
  const next: VpsKeepaliveState = {
    ...current,
    enabled,
    enabled_updated_at: nowSecs,
    enabled_updated_by: source,
    // Saat dimatikan, jangan biarkan cooldown/next_ping basi menahan ping manual
    // pertama ketika nanti diaktifkan lagi.
    cooldown_until: enabled ? current.cooldown_until : null,
    next_ping_at: enabled ? current.next_ping_at : null,
    updated_at: nowSecs,
  };
  await writeFn(next);
  return next;
}

function resolveCreds(deps: KeepaliveDeps) {
  const apiKey = (deps.apiKey ?? config.instaboxApiKey).trim();
  const machineId = (deps.machineId ?? config.instaboxMachineId).trim();
  const apiBase = (deps.apiBase ?? config.instaboxApiBase).trim().replace(/\/+$/, '');
  return { apiKey, machineId, apiBase };
}

function sanitizeError(text: string, status: number): string {
  const body = String(text || '');
  let message = '';
  try {
    const parsed = asRecord(JSON.parse(body));
    const errObj = asRecord(parsed?.error);
    const candidate = errObj?.message ?? parsed?.message ?? (typeof parsed?.error === 'string' ? parsed.error : '');
    if (typeof candidate === 'string') message = candidate;
  } catch {
    // body bukan JSON
  }
  if (!message) message = body;
  const clean = message.replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim();
  const prefix = status > 0 ? `HTTP ${status}` : 'Jaringan gagal';
  return (clean ? `${prefix}: ${clean}` : prefix).slice(0, ERROR_MAX_LEN);
}

function parseLeaseExpiresAt(body: string): number | null {
  try {
    const parsed = asRecord(JSON.parse(body));
    const iso = typeof parsed?.expiresAt === 'string' ? parsed.expiresAt : '';
    if (!iso) return null;
    const ms = Date.parse(iso);
    return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
  } catch {
    return null;
  }
}

export async function renewVpsActivityLease(
  deps: KeepaliveDeps = {},
): Promise<
  | { ok: true; status: number; latencyMs: number; leaseExpiresAt: number | null }
  | { ok: false; status: number; latencyMs: number; message: string }
> {
  const { apiKey, machineId, apiBase } = resolveCreds(deps);
  if (!apiKey || !machineId) {
    return {
      ok: false,
      status: 0,
      latencyMs: 0,
      message: 'INSTABOX_API_KEY atau INSTABOX_MACHINE_ID belum dikonfigurasi di server',
    };
  }
  const fetchImpl = deps.fetchImpl ?? fetch;
  const { leaseTtlSecs } = getKeepaliveConfig(deps);
  const url = `${apiBase}/v1/machines/${encodeURIComponent(machineId)}/activity-leases/${encodeURIComponent(
    KEEPALIVE_LEASE_ID,
  )}`;
  const startedAt = Date.now();
  try {
    const res = await fetchImpl(url, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ttlSeconds: leaseTtlSecs }),
      signal: AbortSignal.timeout(12000),
    });
    const latencyMs = Date.now() - startedAt;
    const body = await res.text().catch(() => '');
    if (res.ok) {
      return {
        ok: true,
        status: res.status,
        latencyMs,
        leaseExpiresAt: parseLeaseExpiresAt(body),
      };
    }
    return {
      ok: false,
      status: res.status,
      latencyMs,
      message: sanitizeError(body, res.status),
    };
  } catch (err) {
    const latencyMs = Date.now() - startedAt;
    const detail = String((err as Error)?.message ?? err).slice(0, 120);
    return { ok: false, status: 0, latencyMs, message: sanitizeError(detail, 0) };
  }
}

function backoffSecsForFailure(status: number, consecutiveFailures: number): number {
  if (status === 401 || status === 403) return 1800;
  if (status === 429) return 900;
  const steps = [300, 600, 1200, 1800];
  const idx = Math.max(0, Math.min(steps.length - 1, consecutiveFailures));
  return steps[idx];
}

export async function jalankanKeepaliveVps(
  opts: KeepaliveRunOptions,
): Promise<KeepaliveRunResult> {
  const nowSecs = Math.floor((opts.nowMs ?? Date.now()) / 1000);
  const readFn = opts.readState ?? bacaKeepaliveState;
  const writeFn = opts.writeState ?? simpanKeepaliveState;
  const { intervalSecs, leaseTtlSecs } = getKeepaliveConfig(opts);
  const base = (await readFn()) ?? defaultKeepaliveState();

  const liveWindow =
    typeof opts.autoSuspendSeconds === 'number' &&
    Number.isFinite(opts.autoSuspendSeconds) &&
    opts.autoSuspendSeconds > 0
      ? Math.floor(opts.autoSuspendSeconds)
      : null;
  const withWindow: VpsKeepaliveState = liveWindow
    ? {
        ...base,
        idle_window_secs: liveWindow,
        idle_window_source: 'live',
      }
    : base;

  if (!withWindow.enabled && !opts.ignoreEnabled) {
    return { attempted: false, reason: 'disabled', state: withWindow };
  }
  const { apiKey, machineId } = resolveCreds(opts);
  if (!apiKey || !machineId) {
    return { attempted: false, reason: 'not_configured', state: withWindow };
  }
  const observed = String(opts.observedState ?? '').trim().toLowerCase();
  if (observed && !RUNNABLE_STATES.has(observed)) {
    return {
      attempted: false,
      reason: 'not_running',
      message: `VPS berstatus ${observed.toUpperCase()} — ping dilewati agar tidak melawan pause yang sah.`,
      state: withWindow,
    };
  }
  if (!opts.force) {
    if (withWindow.cooldown_until && withWindow.cooldown_until > nowSecs) {
      return { attempted: false, reason: 'cooldown', state: withWindow };
    }
    if (withWindow.last_ping_at && nowSecs - withWindow.last_ping_at < intervalSecs) {
      return { attempted: false, reason: 'interval', state: withWindow };
    }
  }

  const result = await renewVpsActivityLease(opts);
  if (result.ok) {
    const next: VpsKeepaliveState = {
      ...withWindow,
      last_ping_at: nowSecs,
      last_attempt_at: nowSecs,
      last_ping_ok: true,
      last_ping_latency_ms: result.latencyMs,
      last_ping_source: opts.trigger,
      ping_count: withWindow.ping_count + 1,
      consecutive_failures: 0,
      last_error: null,
      next_ping_at: nowSecs + intervalSecs,
      cooldown_until: null,
      lease_expires_at: result.leaseExpiresAt ?? nowSecs + leaseTtlSecs,
      updated_at: nowSecs,
    };
    await writeFn(next);
    return {
      attempted: true,
      ok: true,
      httpStatus: result.status,
      message: `Ping VPS terkirim (HTTP ${result.status}, ${result.latencyMs} ms).`,
      state: next,
    };
  }

  const failures = withWindow.consecutive_failures + 1;
  const backoff = backoffSecsForFailure(result.status, withWindow.consecutive_failures);
  const next: VpsKeepaliveState = {
    ...withWindow,
    last_attempt_at: nowSecs,
    last_ping_ok: false,
    last_ping_latency_ms: result.latencyMs,
    last_ping_source: opts.trigger,
    fail_count: withWindow.fail_count + 1,
    consecutive_failures: failures,
    last_error: result.message,
    next_ping_at: nowSecs + backoff,
    cooldown_until: nowSecs + backoff,
    updated_at: nowSecs,
  };
  await writeFn(next);
  return {
    attempted: true,
    ok: false,
    reason: 'error',
    httpStatus: result.status,
    message: `Ping VPS gagal: ${result.message}`,
    state: next,
  };
}
