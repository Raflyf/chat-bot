/**
 * BAILEYS BACKUP WEB & CLOUD SYNC SERVICE
 *
 * Menyediakan kontrol web penuh untuk Baileys Backup (status VPS InstaBox,
 * telemetri failover laptop Windows, Resume/Start VPS, dan sinkronisasi mode
 * Auto-Resume OTOMATIS/MANUAL) melalui Supabase (`whatsapp_sessions`).
 *
 * Desain penyimpanan bebas-race:
 *   - `__baileys_backup_state.json`: hanya ditulis oleh Vercel Web API / Cron.
 *   - `__baileys_backup_desktop.json`: hanya ditulis oleh BaileysBackup.exe di Windows.
 */
import crypto from 'crypto';
import { db } from './db.js';
import { config } from './env.js';
import { parseInstaboxMachine, type InstaboxMachineSnapshot } from './vps_monitor.js';
import {
  bacaKeepaliveState,
  defaultKeepaliveState,
  getKeepaliveConfig,
  jalankanKeepaliveVps,
  releaseVpsActivityLease,
  setKeepaliveEnabled,
  type KeepaliveSource,
  type VpsKeepaliveState,
} from './vps_keepalive.js';

export const BAILEYS_BACKUP_CLOUD_FILENAME = '__baileys_backup_state.json';
export const BAILEYS_BACKUP_DESKTOP_FILENAME = '__baileys_backup_desktop.json';
export const DESKTOP_HEARTBEAT_TTL_SECS = 95;
export const BAILEYS_BACKUP_RELEASE_URL =
  'https://github.com/Raflyf/chat-bot/releases/tag/baileys-backup-latest';

const MAX_CLOUD_EVENTS = 12;
const MAX_VIEW_EVENTS = 8;
const MIN_CRON_RESUME_INTERVAL_SECS = 60;

export type VpsAvailability = 'running' | 'down' | 'transient' | 'unknown';
export type BaileysBackupEventSource = 'web' | 'cron' | 'desktop';

export interface BaileysBackupEvent {
  ts: number;
  source: BaileysBackupEventSource;
  message: string;
}

export interface BaileysBackupCloudState {
  autoResumeEnabled: boolean;
  autoResumeUpdatedAt: number;
  autoResumeUpdatedBy: BaileysBackupEventSource;
  cooldownUntilEpoch: number | null;
  consecutiveResumeFailures: number;
  lastResumeAttemptAt: number | null;
  lastResumeSource: 'web' | 'cron' | null;
  lastResumeMessage: string | null;
  lastCheckedAt: number | null;
  lastVpsState: string | null;
  lastVpsAvailability: VpsAvailability;
  lastVpsName: string | null;
  lastRunStartedAt: string | null;
  lastMaxRunMinutes: number | null;
  webChecksCount: number;
  recentEvents: BaileysBackupEvent[];
}

export interface BaileysBackupDesktopState {
  appVersion?: string;
  appPid?: number;
  childNodePid?: number;
  failoverActive?: boolean;
  vpsState?: string;
  vpsAvailability?: VpsAvailability;
  appPrivateKb?: number;
  appWorkingKb?: number;
  nodePrivateKb?: number;
  uptimeSecs?: number;
  totalChecks?: number;
  failoverCount?: number;
  autoStartEnabled?: boolean;
  trayRegistered?: boolean;
  lastCheckEpoch?: number;
  heartbeatAt?: number;
  stopped?: boolean;
  autoResumeEnabled?: boolean;
  autoResumeUpdatedAt?: number;
  cooldownUntilEpoch?: number | null;
  recentEvents?: Array<string | { ts?: number; message?: string; source?: string }>;
}

export interface InstaboxResumeError {
  status: number;
  isCooldown: boolean;
  retryAfterSecs: number | null;
  message: string;
}

export interface BaileysBackupDesktopView {
  appVersion: string;
  appPid: number;
  childNodePid: number;
  failoverActive: boolean;
  vpsState: string;
  vpsAvailability: VpsAvailability;
  appPrivateKb: number;
  appWorkingKb: number;
  nodePrivateKb: number;
  uptimeSecs: number;
  totalChecks: number;
  failoverCount: number;
  autoStartEnabled: boolean;
  trayRegistered: boolean;
  lastCheckEpoch: number | null;
  heartbeatAt: number | null;
  heartbeatAgeSecs: number | null;
}

export interface BaileysKeepaliveView {
  enabled: boolean;
  enabledUpdatedAt: number | null;
  enabledUpdatedBy: KeepaliveSource | null;
  lastPingAt: number | null;
  lastPingOk: boolean;
  lastPingLatencyMs: number | null;
  lastPingSource: KeepaliveSource | null;
  pingCount: number;
  failCount: number;
  consecutiveFailures: number;
  lastError: string | null;
  intervalSecs: number;
  leaseTtlSecs: number;
  leaseExpiresAt: number | null;
  leaseRemainingSecs: number | null;
  /** Detik sejak ping sukses terakhir (null = belum pernah). */
  idleSecs: number | null;
  /** Detik sampai pause otomatis bila tidak ada ping lagi (null = tak terlacak). */
  pauseInSecs: number | null;
  /** Detik sampai ping berikutnya (null bila nonaktif). */
  nextPingInSecs: number | null;
  idleWindowSecs: number;
  idleWindowSource: 'live' | 'config';
  /** true bila pause diperkirakan terjadi sebelum ping berikutnya. */
  atRisk: boolean;
}

export interface BaileysBackupView {
  instaboxConfigured: boolean;
  liveFetchError: boolean;
  vpsState: string;
  vpsAvailability: VpsAvailability;
  machineName: string | null;
  machineId: string | null;
  runStartedAt: string | null;
  maxRunMinutes: number | null;
  autoSuspendAfterSeconds: number | null;
  runtimeRemainingMinutes: number | null;
  autoResumeEnabled: boolean;
  autoResumeUpdatedAt: number;
  autoResumeUpdatedBy: BaileysBackupEventSource;
  cooldownUntilEpoch: number | null;
  cooldownRemainingSecs: number;
  keepalive: BaileysKeepaliveView;
  desktopOnline: boolean;
  desktop: BaileysBackupDesktopView | null;
  lastCheckedAt: number | null;
  webChecksCount: number;
  lastResumeMessage: string | null;
  lastResumeSource: 'web' | 'cron' | null;
  lastResumeAttemptAt: number | null;
  recentEvents: BaileysBackupEvent[];
  installerReleaseUrl: string;
  serverTimeEpoch: number;
}

export interface BaileysBackupDeps {
  fetchImpl?: typeof fetch;
  nowMs?: number;
  apiKey?: string;
  machineId?: string;
  apiBase?: string;
  installerReleaseUrl?: string;
  readCloudAndDesktop?: () => Promise<{
    cloud: BaileysBackupCloudState;
    desktop: BaileysBackupDesktopState | null;
  }>;
  writeCloudState?: (state: BaileysBackupCloudState) => Promise<void>;
  /** Injeksi untuk unit test; default membaca `__vps_keepalive_state.json`. */
  readKeepaliveState?: () => Promise<VpsKeepaliveState | null>;
  writeKeepaliveState?: (state: VpsKeepaliveState) => Promise<void>;
}

let memCloudState: BaileysBackupCloudState | null = null;
let memDesktopState: BaileysBackupDesktopState | null = null;

/** Reset cache in-memory untuk isolasi unit test. */
export function resetBaileysBackupWebUntukTest(): void {
  memCloudState = null;
  memDesktopState = null;
}

export function classifyVpsAvailability(rawState: string): VpsAvailability {
  switch (String(rawState || '').trim().toLowerCase()) {
    case 'running':
      return 'running';
    case 'paused':
    case 'stopped':
    case 'suspended':
    case 'off':
    case 'terminated':
    case 'error':
    case 'failed':
      return 'down';
    case 'starting':
    case 'resuming':
    case 'creating':
    case 'booting':
    case 'provisioning':
      return 'transient';
    default:
      return 'unknown';
  }
}

export function chooseVpsActionEndpoint(rawState: string): 'resume' | 'start' {
  const s = String(rawState || '').trim().toLowerCase();
  return s === 'stopped' || s === 'off' ? 'start' : 'resume';
}

function asRecord(val: unknown): Record<string, unknown> | null {
  return val && typeof val === 'object' && !Array.isArray(val)
    ? (val as Record<string, unknown>)
    : null;
}

function tryParseJson(body: string): Record<string, unknown> | null {
  if (!body || typeof body !== 'string') return null;
  try {
    return asRecord(JSON.parse(body));
  } catch {
    return null;
  }
}

export function isCooldownPayload(body: string): boolean {
  const root = tryParseJson(body);
  if (root) {
    const errObj = asRecord(root.error);
    const code = String(errObj?.code ?? root.code ?? '').trim().toLowerCase();
    if (code === 'machine_cooldown') return true;
  }
  return String(body || '').toLowerCase().includes('machine_cooldown');
}

export function extractRetryAfterSeconds(body: string): number | null {
  const root = tryParseJson(body);
  if (root) {
    const errObj = asRecord(root.error);
    const rawVal =
      errObj?.retryAfterSeconds ??
      errObj?.retry_after_seconds ??
      root.retryAfterSeconds ??
      root.retry_after_seconds;
    const n = Number(rawVal);
    if (Number.isFinite(n) && n >= 0) return Math.round(n);
  }
  const m = String(body || '').match(/"retry_?[aA]fter_?[sS]econds"\s*:\s*(\d+)/);
  if (m) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return null;
}

export function shouldFallbackResumeToStart(status: number, body: string): boolean {
  if (status === 400 || status === 404 || status === 405 || status === 422) {
    return true;
  }
  if (status === 409) {
    return !isCooldownPayload(body);
  }
  return false;
}

function extractApiErrorMessage(body: string): string | null {
  const root = tryParseJson(body);
  if (!root) return null;
  const errObj = asRecord(root.error);
  const candidate = errObj?.message ?? root.message ?? (typeof root.error === 'string' ? root.error : '');
  if (typeof candidate !== 'string') return null;
  const clean = candidate.replace(/[\r\n\t\x00-\x1f]/g, ' ').trim();
  return clean ? clean.slice(0, 120) : null;
}

export function parseInstaboxResumeError(status: number, body: string): InstaboxResumeError {
  const cooldown = status === 409 && isCooldownPayload(body);
  const retryAfterSecs = extractRetryAfterSeconds(body);

  let message: string;
  if (cooldown) {
    if (retryAfterSecs !== null) {
      if (retryAfterSecs >= 60) {
        message = `VPS sedang cooldown (coba lagi dalam ~${Math.ceil(retryAfterSecs / 60)}m)`;
      } else {
        message = `VPS sedang cooldown (coba lagi dalam ~${retryAfterSecs}d)`;
      }
    } else {
      message = 'VPS sedang cooldown, coba lagi nanti';
    }
  } else if (status === 401 || status === 403) {
    message = `API key ditolak / butuh izin machines:write (HTTP ${status})`;
  } else if (status === 429) {
    message = 'Terlalu banyak permintaan ke InstaBox (HTTP 429)';
  } else if (status === 0) {
    message = 'Gagal menghubungi API InstaBox';
  } else {
    const apiMsg = extractApiErrorMessage(body);
    message = apiMsg ? `HTTP ${status}: ${apiMsg}` : `HTTP ${status}`;
  }

  return {
    status,
    isCooldown: cooldown,
    retryAfterSecs,
    message,
  };
}

export function computeAutoResumeBackoffSecs(
  err: Pick<InstaboxResumeError, 'status' | 'isCooldown' | 'retryAfterSecs'>,
  consecutiveFailures: number,
): number {
  const clamp = (val: number, min: number, max: number) => Math.max(min, Math.min(max, val));
  if (err.isCooldown) {
    return clamp(err.retryAfterSecs ?? 300, 60, 3600) + 10;
  }
  if (err.status === 401 || err.status === 403) {
    return 1800;
  }
  if (err.status === 429) {
    return clamp(err.retryAfterSecs ?? 180, 60, 1800) + 10;
  }
  const steps = [120, 300, 600];
  const idx = Math.max(0, Math.min(2, Math.floor(consecutiveFailures)));
  return steps[idx];
}

export function defaultCloudState(): BaileysBackupCloudState {
  return {
    autoResumeEnabled: false,
    autoResumeUpdatedAt: 0,
    autoResumeUpdatedBy: 'web',
    cooldownUntilEpoch: null,
    consecutiveResumeFailures: 0,
    lastResumeAttemptAt: null,
    lastResumeSource: null,
    lastResumeMessage: null,
    lastCheckedAt: null,
    lastVpsState: null,
    lastVpsAvailability: 'unknown',
    lastVpsName: null,
    lastRunStartedAt: null,
    lastMaxRunMinutes: null,
    webChecksCount: 0,
    recentEvents: [],
  };
}

function sanitizeEventMessage(msg: string): string {
  return String(msg || '')
    .replace(/[\x00-\x1f\x7f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
}

export function appendCloudEvent(
  events: BaileysBackupEvent[],
  source: BaileysBackupEventSource,
  message: string,
  tsSecs: number,
): BaileysBackupEvent[] {
  const clean = sanitizeEventMessage(message);
  if (!clean) return events.slice(0, MAX_CLOUD_EVENTS);
  const next: BaileysBackupEvent = { ts: Math.max(0, Math.floor(tsSecs)), source, message: clean };
  return [next, ...events].slice(0, MAX_CLOUD_EVENTS);
}

function normalizeCloudState(raw: unknown): BaileysBackupCloudState {
  const def = defaultCloudState();
  const obj = asRecord(raw);
  if (!obj) return def;

  const events: BaileysBackupEvent[] = Array.isArray(obj.recentEvents)
    ? obj.recentEvents
        .map((item) => {
          const rec = asRecord(item);
          if (!rec) return null;
          const msg = sanitizeEventMessage(String(rec.message ?? ''));
          if (!msg) return null;
          const srcRaw = String(rec.source ?? 'web');
          const source: BaileysBackupEventSource =
            srcRaw === 'cron' || srcRaw === 'desktop' ? srcRaw : 'web';
          const ts = Number.isFinite(Number(rec.ts)) ? Math.max(0, Math.floor(Number(rec.ts))) : 0;
          return { ts, source, message: msg };
        })
        .filter((x): x is BaileysBackupEvent => x !== null)
        .slice(0, MAX_CLOUD_EVENTS)
    : [];

  const updatedByRaw = String(obj.autoResumeUpdatedBy ?? 'web');
  const updatedBy: BaileysBackupEventSource =
    updatedByRaw === 'cron' || updatedByRaw === 'desktop' ? updatedByRaw : 'web';
  const resumeSrcRaw = obj.lastResumeSource;
  const lastResumeSource: 'web' | 'cron' | null =
    resumeSrcRaw === 'web' || resumeSrcRaw === 'cron' ? resumeSrcRaw : null;

  const numOrNull = (v: unknown): number | null => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
  };

  return {
    autoResumeEnabled: Boolean(obj.autoResumeEnabled),
    autoResumeUpdatedAt: Number.isFinite(Number(obj.autoResumeUpdatedAt))
      ? Math.max(0, Math.floor(Number(obj.autoResumeUpdatedAt)))
      : 0,
    autoResumeUpdatedBy: updatedBy,
    cooldownUntilEpoch: numOrNull(obj.cooldownUntilEpoch),
    consecutiveResumeFailures: Number.isFinite(Number(obj.consecutiveResumeFailures))
      ? Math.max(0, Math.floor(Number(obj.consecutiveResumeFailures)))
      : 0,
    lastResumeAttemptAt: numOrNull(obj.lastResumeAttemptAt),
    lastResumeSource,
    lastResumeMessage:
      typeof obj.lastResumeMessage === 'string' && obj.lastResumeMessage.trim()
        ? sanitizeEventMessage(obj.lastResumeMessage)
        : null,
    lastCheckedAt: numOrNull(obj.lastCheckedAt),
    lastVpsState:
      typeof obj.lastVpsState === 'string' && obj.lastVpsState.trim()
        ? obj.lastVpsState.trim().toLowerCase()
        : null,
    lastVpsAvailability: classifyVpsAvailability(String(obj.lastVpsState ?? obj.lastVpsAvailability ?? '')),
    lastVpsName:
      typeof obj.lastVpsName === 'string' && obj.lastVpsName.trim() ? obj.lastVpsName.trim() : null,
    lastRunStartedAt:
      typeof obj.lastRunStartedAt === 'string' && obj.lastRunStartedAt.trim()
        ? obj.lastRunStartedAt.trim()
        : null,
    lastMaxRunMinutes:
      typeof obj.lastMaxRunMinutes === 'number' && Number.isFinite(obj.lastMaxRunMinutes)
        ? obj.lastMaxRunMinutes
        : null,
    webChecksCount: Number.isFinite(Number(obj.webChecksCount))
      ? Math.max(0, Math.floor(Number(obj.webChecksCount)))
      : 0,
    recentEvents: events,
  };
}

function normalizeDesktopState(raw: unknown): BaileysBackupDesktopState | null {
  const obj = asRecord(raw);
  if (!obj) return null;

  const nonNegInt = (v: unknown, fallback = 0): number => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
  };
  const posIntOrNull = (v: unknown): number | null => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
  };

  const vpsState = typeof obj.vpsState === 'string' && obj.vpsState.trim() ? obj.vpsState.trim() : 'unknown';

  return {
    appVersion: typeof obj.appVersion === 'string' && obj.appVersion.trim() ? obj.appVersion.trim() : '1.4.0',
    appPid: nonNegInt(obj.appPid),
    childNodePid: nonNegInt(obj.childNodePid),
    failoverActive: Boolean(obj.failoverActive) || nonNegInt(obj.childNodePid) > 0,
    vpsState,
    vpsAvailability: classifyVpsAvailability(String(obj.vpsAvailability ?? vpsState)),
    appPrivateKb: nonNegInt(obj.appPrivateKb),
    appWorkingKb: nonNegInt(obj.appWorkingKb),
    nodePrivateKb: nonNegInt(obj.nodePrivateKb),
    uptimeSecs: nonNegInt(obj.uptimeSecs),
    totalChecks: nonNegInt(obj.totalChecks),
    failoverCount: nonNegInt(obj.failoverCount),
    autoStartEnabled: Boolean(obj.autoStartEnabled),
    trayRegistered: Boolean(obj.trayRegistered),
    lastCheckEpoch: nonNegInt(obj.lastCheckEpoch),
    heartbeatAt: nonNegInt(obj.heartbeatAt),
    stopped: Boolean(obj.stopped),
    autoResumeEnabled: typeof obj.autoResumeEnabled === 'boolean' ? obj.autoResumeEnabled : undefined,
    autoResumeUpdatedAt: Number.isFinite(Number(obj.autoResumeUpdatedAt))
      ? Math.max(0, Math.floor(Number(obj.autoResumeUpdatedAt)))
      : 0,
    cooldownUntilEpoch: posIntOrNull(obj.cooldownUntilEpoch),
    recentEvents: Array.isArray(obj.recentEvents) ? obj.recentEvents.slice(0, 12) : [],
  };
}

export async function bacaCloudDanDesktopState(): Promise<{
  cloud: BaileysBackupCloudState;
  desktop: BaileysBackupDesktopState | null;
}> {
  const c = db();
  if (!c) {
    return {
      cloud: memCloudState ? { ...memCloudState, recentEvents: [...memCloudState.recentEvents] } : defaultCloudState(),
      desktop: memDesktopState ? { ...memDesktopState } : null,
    };
  }

  try {
    const { data, error } = await c
      .from('whatsapp_sessions')
      .select('filename, content')
      .in('filename', [BAILEYS_BACKUP_CLOUD_FILENAME, BAILEYS_BACKUP_DESKTOP_FILENAME]);

    if (error || !Array.isArray(data)) {
      return {
        cloud: memCloudState ? { ...memCloudState, recentEvents: [...memCloudState.recentEvents] } : defaultCloudState(),
        desktop: memDesktopState ? { ...memDesktopState } : null,
      };
    }

    let cloud = memCloudState ? { ...memCloudState, recentEvents: [...memCloudState.recentEvents] } : defaultCloudState();
    let desktop: BaileysBackupDesktopState | null = memDesktopState ? { ...memDesktopState } : null;

    for (const row of data as Array<{ filename: string; content: string }>) {
      if (!row?.content) continue;
      if (row.filename === BAILEYS_BACKUP_CLOUD_FILENAME) {
        try {
          cloud = normalizeCloudState(JSON.parse(String(row.content)));
          memCloudState = cloud;
        } catch {
          // ignore corrupt json
        }
      } else if (row.filename === BAILEYS_BACKUP_DESKTOP_FILENAME) {
        try {
          desktop = normalizeDesktopState(JSON.parse(String(row.content)));
          memDesktopState = desktop;
        } catch {
          // ignore corrupt json
        }
      }
    }

    return { cloud, desktop };
  } catch {
    return {
      cloud: memCloudState ? { ...memCloudState, recentEvents: [...memCloudState.recentEvents] } : defaultCloudState(),
      desktop: memDesktopState ? { ...memDesktopState } : null,
    };
  }
}

export async function simpanCloudState(state: BaileysBackupCloudState): Promise<void> {
  memCloudState = { ...state, recentEvents: [...state.recentEvents] };
  const c = db();
  if (!c) return;
  try {
    const { error } = await c.from('whatsapp_sessions').upsert({
      filename: BAILEYS_BACKUP_CLOUD_FILENAME,
      content: JSON.stringify(state),
      updated_at: new Date().toISOString(),
    });
    if (error) {
      console.warn('[baileys-backup] Gagal simpan state ke Supabase:', error.message);
    }
  } catch (err) {
    console.warn(
      '[baileys-backup] Exception simpan state:',
      String((err as Error)?.message ?? err).slice(0, 120),
    );
  }
}

function resolveCreds(deps: BaileysBackupDeps = {}) {
  const apiKey = (deps.apiKey ?? config.instaboxApiKey).trim();
  const machineId = (deps.machineId ?? config.instaboxMachineId).trim();
  const apiBase = (deps.apiBase ?? config.instaboxApiBase).trim().replace(/\/+$/, '');
  return { apiKey, machineId, apiBase };
}

function maskMachineId(id: string): string | null {
  const clean = String(id || '').trim();
  if (!clean) return null;
  if (clean.length <= 10) return clean;
  return `${clean.slice(0, 6)}...${clean.slice(-4)}`;
}

export async function fetchLiveInstaboxMachine(
  deps: BaileysBackupDeps = {},
): Promise<{
  configured: boolean;
  ok: boolean;
  machine: InstaboxMachineSnapshot | null;
}> {
  const { apiKey, machineId, apiBase } = resolveCreds(deps);
  if (!apiKey || !machineId) {
    return { configured: false, ok: false, machine: null };
  }

  const fetchImpl = deps.fetchImpl ?? fetch;
  try {
    const url = `${apiBase}/v1/machines/${encodeURIComponent(machineId)}`;
    const res = await fetchImpl(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(7000),
    });

    if (!res.ok) {
      console.warn(`[baileys-backup] GET /v1/machines membalas HTTP ${res.status}.`);
      return { configured: true, ok: false, machine: null };
    }

    const raw = await res.json().catch(() => null);
    const machine = parseInstaboxMachine(raw, machineId);
    if (!machine) {
      return { configured: true, ok: false, machine: null };
    }
    return { configured: true, ok: true, machine };
  } catch (err) {
    console.warn(
      '[baileys-backup] fetchLiveInstaboxMachine error:',
      String((err as Error)?.message ?? err).slice(0, 120),
    );
    return { configured: true, ok: false, machine: null };
  }
}

async function postInstaboxAction(
  apiBase: string,
  apiKey: string,
  machineId: string,
  action: 'resume' | 'start',
  fetchImpl: typeof fetch,
  nowMs: number,
): Promise<{ ok: true; status: number } | { ok: false; err: InstaboxResumeError }> {
  const url = `${apiBase}/v1/machines/${encodeURIComponent(machineId)}/${action}`;
  const idempKey = `baileys-backup-web-${Math.floor(nowMs / 1000)}-${crypto.randomBytes(6).toString('hex')}`;

  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'Idempotency-Key': idempKey,
      },
      body: '{}',
      signal: AbortSignal.timeout(12000),
    });

    const body = await res.text().catch(() => '');
    if (res.ok) {
      return { ok: true, status: res.status };
    }
    return { ok: false, err: parseInstaboxResumeError(res.status, body) };
  } catch {
    return { ok: false, err: parseInstaboxResumeError(0, '') };
  }
}

export async function triggerInstaboxResume(
  currentRawState: string,
  deps: BaileysBackupDeps = {},
): Promise<
  | { ok: true; actionUsed: 'resume' | 'start'; status: number }
  | { ok: false; err: InstaboxResumeError }
> {
  const { apiKey, machineId, apiBase } = resolveCreds(deps);
  if (!apiKey || !machineId) {
    return {
      ok: false,
      err: {
        status: 0,
        isCooldown: false,
        retryAfterSecs: null,
        message: 'INSTABOX_API_KEY atau INSTABOX_MACHINE_ID belum dikonfigurasi di server',
      },
    };
  }

  const fetchImpl = deps.fetchImpl ?? fetch;
  const nowMs = deps.nowMs ?? Date.now();
  const primary = chooseVpsActionEndpoint(currentRawState);

  const first = await postInstaboxAction(apiBase, apiKey, machineId, primary, fetchImpl, nowMs);
  if (first.ok) {
    return { ok: true, actionUsed: primary, status: first.status };
  }

  if (primary === 'resume') {
    const urlFallback = `${apiBase}/v1/machines/${encodeURIComponent(machineId)}/start`;
    // Re-evaluate fallback condition using status and cooldown marker
    const fallbackEligible =
      first.err.status === 400 ||
      first.err.status === 404 ||
      first.err.status === 405 ||
      first.err.status === 422 ||
      (first.err.status === 409 && !first.err.isCooldown);

    if (fallbackEligible && urlFallback) {
      const second = await postInstaboxAction(apiBase, apiKey, machineId, 'start', fetchImpl, nowMs);
      if (second.ok) {
        return { ok: true, actionUsed: 'start', status: second.status };
      }
      return second;
    }
  }

  return first;
}

function parseIsoEpochSecs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) && ms > 0 ? Math.ceil(ms / 1000) : null;
}

function resolveEffectiveAutoResume(
  cloud: BaileysBackupCloudState,
  desktop: BaileysBackupDesktopState | null,
): { enabled: boolean; updatedAt: number; updatedBy: BaileysBackupEventSource } {
  const desktopUpdatedAt = desktop?.autoResumeUpdatedAt ?? 0;
  if (
    desktop &&
    typeof desktop.autoResumeEnabled === 'boolean' &&
    desktopUpdatedAt > cloud.autoResumeUpdatedAt
  ) {
    return {
      enabled: desktop.autoResumeEnabled,
      updatedAt: desktopUpdatedAt,
      updatedBy: 'desktop',
    };
  }
  return {
    enabled: cloud.autoResumeEnabled,
    updatedAt: cloud.autoResumeUpdatedAt,
    updatedBy: cloud.autoResumeUpdatedBy,
  };
}

function mergeEvents(
  cloudEvents: BaileysBackupEvent[],
  desktop: BaileysBackupDesktopState | null,
  desktopOnline: boolean,
): BaileysBackupEvent[] {
  const combined: BaileysBackupEvent[] = [...cloudEvents];

  if (desktop?.recentEvents && Array.isArray(desktop.recentEvents)) {
    const baseTs = desktop.heartbeatAt ?? desktop.lastCheckEpoch ?? 0;
    desktop.recentEvents.forEach((ev, idx) => {
      if (typeof ev === 'string') {
        const msg = sanitizeEventMessage(ev);
        if (!msg) return;
        combined.push({
          ts: desktopOnline ? Math.max(0, baseTs - idx) : Math.max(0, baseTs - idx),
          source: 'desktop',
          message: msg,
        });
      } else if (ev && typeof ev === 'object' && typeof ev.message === 'string') {
        const msg = sanitizeEventMessage(ev.message);
        if (!msg) return;
        const ts = Number.isFinite(Number(ev.ts))
          ? Math.max(0, Math.floor(Number(ev.ts)))
          : Math.max(0, baseTs - idx);
        combined.push({ ts, source: 'desktop', message: msg });
      }
    });
  }

  combined.sort((a, b) => b.ts - a.ts);

  const deduped: BaileysBackupEvent[] = [];
  const seen = new Set<string>();
  for (const ev of combined) {
    const key = `${ev.source}:${ev.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(ev);
    if (deduped.length >= MAX_VIEW_EVENTS) break;
  }
  return deduped;
}

/**
 * Baca state keepalive untuk ditampilkan. Kegagalan baca tidak boleh
 * menjatuhkan panel VPS — jatuh ke default (nonaktif/menunggu ping).
 */
async function readKeepaliveStateForView(
  deps: BaileysBackupDeps = {},
): Promise<VpsKeepaliveState> {
  const readFn = deps.readKeepaliveState ?? bacaKeepaliveState;
  try {
    return (await readFn()) ?? defaultKeepaliveState();
  } catch {
    return defaultKeepaliveState();
  }
}

/**
 * Susun tampilan keepalive dari state durable + data mesin live.
 * Angka pause dihitung dari jendela idle yang DILAPORKAN API
 * (`autoSuspendAfterSeconds`), bukan asumsi lokal.
 */
export function buildKeepaliveView(
  state: VpsKeepaliveState,
  machine: InstaboxMachineSnapshot | null,
  nowMs = Date.now(),
  fallbackOpts: {
    fallbackRunning?: boolean;
    fallbackRunStartedAt?: string | null;
  } = {},
): BaileysKeepaliveView {
  const nowSecs = Math.floor(nowMs / 1000);
  const { intervalSecs, leaseTtlSecs } = getKeepaliveConfig();
  const liveWindow =
    typeof machine?.autoSuspendAfterSeconds === 'number' &&
    Number.isFinite(machine.autoSuspendAfterSeconds) &&
    machine.autoSuspendAfterSeconds > 0
      ? Math.floor(machine.autoSuspendAfterSeconds)
      : null;
  const cachedWindow =
    typeof state.idle_window_secs === 'number' &&
    Number.isFinite(state.idle_window_secs) &&
    state.idle_window_secs > 0
      ? Math.floor(state.idle_window_secs)
      : null;
  const idleWindowSecs =
    liveWindow ?? cachedWindow ?? Math.max(60, Math.floor(config.vpsIdlePauseMinutes * 60));
  const idleWindowSource: 'live' | 'config' =
    liveWindow !== null
      ? 'live'
      : cachedWindow !== null && state.idle_window_source === 'live'
        ? 'live'
        : 'config';

  const running = machine
    ? classifyVpsAvailability(machine.state) === 'running'
    : Boolean(fallbackOpts.fallbackRunning);

  const runStartedIso = machine?.runStartedAt ?? fallbackOpts.fallbackRunStartedAt ?? null;
  const runStartedMs = runStartedIso ? Date.parse(runStartedIso) : Number.NaN;
  const runStartedEpoch =
    Number.isFinite(runStartedMs) && runStartedMs > 0 ? Math.floor(runStartedMs / 1000) : null;

  const pingFromCurrentRun = Boolean(
    state.last_ping_at && (!runStartedEpoch || state.last_ping_at >= runStartedEpoch),
  );
  const effectiveLeaseExpiresAt =
    pingFromCurrentRun && state.lease_expires_at && state.lease_expires_at > 0
      ? state.lease_expires_at
      : null;
  const leaseRemainingSecs =
    effectiveLeaseExpiresAt !== null ? Math.max(0, effectiveLeaseExpiresAt - nowSecs) : null;

  const idleSecs =
    pingFromCurrentRun && state.last_ping_at ? Math.max(0, nowSecs - state.last_ping_at) : null;

  const assumedNextPingAt = !state.enabled
    ? null
    : running && !pingFromCurrentRun && (!state.cooldown_until || state.cooldown_until <= nowSecs)
      ? nowSecs
      : (state.next_ping_at ?? nowSecs + intervalSecs);
  const nextPingInSecs =
    assumedNextPingAt !== null ? Math.max(0, assumedNextPingAt - nowSecs) : null;

  // Dokumentasi InstaBox: "Expiry starts a full idle period" — tetap hitung
  // dari `effectiveLeaseExpiresAt` walau lease baru saja kedaluwarsa agar tidak
  // melompat mundur ke `last_ping_at`. Bila belum pernah lease di sesi ini,
  // jatuh ke `last_ping_at` sesi aktif atau `runStartedEpoch`.
  const idleCountFrom =
    effectiveLeaseExpiresAt !== null
      ? effectiveLeaseExpiresAt
      : pingFromCurrentRun && state.last_ping_at
        ? state.last_ping_at
        : running && runStartedEpoch
          ? runStartedEpoch
          : null;
  const pauseAt = idleCountFrom ? idleCountFrom + idleWindowSecs : null;
  const pauseInSecs = running && pauseAt !== null ? Math.max(0, pauseAt - nowSecs) : null;

  const atRisk =
    running && pauseInSecs !== null
      ? state.enabled
        ? pauseInSecs <= 300 || (assumedNextPingAt !== null && pauseAt! <= assumedNextPingAt)
        : pauseInSecs <= 300
      : false;

  return {
    enabled: state.enabled,
    enabledUpdatedAt: state.enabled_updated_at,
    enabledUpdatedBy: state.enabled_updated_by,
    lastPingAt: state.last_ping_at,
    lastPingOk: state.last_ping_ok,
    lastPingLatencyMs: state.last_ping_latency_ms,
    lastPingSource: state.last_ping_source,
    pingCount: state.ping_count,
    failCount: state.fail_count,
    consecutiveFailures: state.consecutive_failures,
    lastError: state.last_error,
    intervalSecs,
    leaseTtlSecs,
    leaseExpiresAt: effectiveLeaseExpiresAt,
    leaseRemainingSecs,
    idleSecs,
    pauseInSecs,
    nextPingInSecs,
    idleWindowSecs,
    idleWindowSource,
    atRisk,
  };
}

export function buildBaileysBackupView(
  cloud: BaileysBackupCloudState,
  desktop: BaileysBackupDesktopState | null,
  liveMachine: InstaboxMachineSnapshot | null,
  nowMs = Date.now(),
  opts: {
    instaboxConfigured?: boolean;
    liveFetchError?: boolean;
    machineId?: string;
    installerReleaseUrl?: string;
    keepaliveState?: VpsKeepaliveState | null;
  } = {},
): BaileysBackupView {
  const nowSecs = Math.floor(nowMs / 1000);
  const instaboxConfigured =
    opts.instaboxConfigured ?? Boolean(config.instaboxApiKey && config.instaboxMachineId);

  const hbAt = desktop?.heartbeatAt ?? null;
  const hbAgeSecs = hbAt !== null && hbAt > 0 ? Math.max(0, nowSecs - hbAt) : null;
  const desktopOnline = Boolean(
    desktop && !desktop.stopped && hbAgeSecs !== null && hbAgeSecs <= DESKTOP_HEARTBEAT_TTL_SECS,
  );

  const desktopFreshForState =
    desktopOnline && desktop?.vpsState && desktop.vpsState !== 'unknown' && desktop.vpsState !== 'mengecek...';

  const vpsState =
    liveMachine?.state?.trim().toLowerCase() ||
    (desktopFreshForState ? desktop!.vpsState!.trim().toLowerCase() : '') ||
    cloud.lastVpsState ||
    desktop?.vpsState?.trim().toLowerCase() ||
    'unknown';

  const vpsAvailability = classifyVpsAvailability(vpsState);
  const machineName = liveMachine?.name ?? cloud.lastVpsName ?? null;
  const rawMachineId = liveMachine?.id ?? opts.machineId ?? config.instaboxMachineId ?? '';
  const runStartedAt = liveMachine?.runStartedAt ?? cloud.lastRunStartedAt ?? null;
  const maxRunMinutes = liveMachine?.maxRunMinutes ?? cloud.lastMaxRunMinutes ?? null;
  const autoSuspendAfterSeconds = liveMachine?.autoSuspendAfterSeconds ?? null;
  const keepaliveState = opts.keepaliveState ?? defaultKeepaliveState();

  let runtimeRemainingMinutes: number | null = null;
  if (vpsAvailability === 'running' && runStartedAt && maxRunMinutes && maxRunMinutes > 0) {
    const startedMs = Date.parse(runStartedAt);
    if (Number.isFinite(startedMs)) {
      const remMs = startedMs + maxRunMinutes * 60_000 - nowMs;
      runtimeRemainingMinutes = Math.max(0, Math.ceil(remMs / 60_000));
    }
  }

  const autoRes = resolveEffectiveAutoResume(cloud, desktop);

  let cooldownUntilEpoch: number | null = null;
  if (vpsAvailability !== 'running') {
    const candidates = [
      cloud.cooldownUntilEpoch ?? 0,
      desktopOnline ? (desktop?.cooldownUntilEpoch ?? 0) : 0,
      parseIsoEpochSecs(liveMachine?.cooldownUntil) ?? 0,
    ];
    const maxCooldown = Math.max(...candidates);
    if (maxCooldown > nowSecs) {
      cooldownUntilEpoch = maxCooldown;
    }
  }
  const cooldownRemainingSecs = cooldownUntilEpoch ? Math.max(0, cooldownUntilEpoch - nowSecs) : 0;

  const lastCheckedAt =
    liveMachine !== null
      ? nowSecs
      : Math.max(cloud.lastCheckedAt ?? 0, desktopOnline ? (desktop?.lastCheckEpoch ?? 0) : 0) || null;

  const desktopView: BaileysBackupDesktopView | null = desktop
    ? {
        appVersion: desktop.appVersion || '1.4.0',
        appPid: desktop.appPid || 0,
        childNodePid: desktopOnline ? (desktop.childNodePid || 0) : 0,
        failoverActive: desktopOnline ? Boolean(desktop.failoverActive) : false,
        vpsState: desktop.vpsState || 'unknown',
        vpsAvailability: desktop.vpsAvailability || classifyVpsAvailability(desktop.vpsState || ''),
        appPrivateKb: desktop.appPrivateKb || 0,
        appWorkingKb: desktop.appWorkingKb || 0,
        nodePrivateKb: desktopOnline ? (desktop.nodePrivateKb || 0) : 0,
        uptimeSecs: desktop.uptimeSecs || 0,
        totalChecks: desktop.totalChecks || 0,
        failoverCount: desktop.failoverCount || 0,
        autoStartEnabled: Boolean(desktop.autoStartEnabled),
        trayRegistered: Boolean(desktop.trayRegistered),
        lastCheckEpoch: desktop.lastCheckEpoch || null,
        heartbeatAt: hbAt,
        heartbeatAgeSecs: hbAgeSecs,
      }
    : null;

  return {
    instaboxConfigured,
    liveFetchError: Boolean(opts.liveFetchError),
    vpsState,
    vpsAvailability,
    machineName,
    machineId: maskMachineId(rawMachineId),
    runStartedAt,
    maxRunMinutes,
    autoSuspendAfterSeconds,
    runtimeRemainingMinutes,
    autoResumeEnabled: autoRes.enabled,
    autoResumeUpdatedAt: autoRes.updatedAt,
    autoResumeUpdatedBy: autoRes.updatedBy,
    cooldownUntilEpoch,
    cooldownRemainingSecs,
    keepalive: buildKeepaliveView(keepaliveState, liveMachine, nowMs, {
      fallbackRunning: vpsAvailability === 'running',
      fallbackRunStartedAt: runStartedAt,
    }),
    desktopOnline,
    desktop: desktopView,
    lastCheckedAt,
    webChecksCount: cloud.webChecksCount,
    lastResumeMessage: cloud.lastResumeMessage,
    lastResumeSource: cloud.lastResumeSource,
    lastResumeAttemptAt: cloud.lastResumeAttemptAt,
    recentEvents: mergeEvents(cloud.recentEvents, desktop, desktopOnline),
    installerReleaseUrl: opts.installerReleaseUrl ?? BAILEYS_BACKUP_RELEASE_URL,
    serverTimeEpoch: nowSecs,
  };
}

function applyLiveMachineToCloudState(
  cloud: BaileysBackupCloudState,
  machine: InstaboxMachineSnapshot,
  nowSecs: number,
): { next: BaileysBackupCloudState; changed: boolean } {
  const rawState = machine.state.trim().toLowerCase();
  const avail = classifyVpsAvailability(rawState);
  const prevState = cloud.lastVpsState;
  const changed = prevState !== null && prevState !== rawState;

  let nextEvents = cloud.recentEvents;
  if (changed) {
    nextEvents = appendCloudEvent(
      nextEvents,
      'web',
      `VPS: ${prevState.toUpperCase()} -> ${rawState.toUpperCase()}`,
      nowSecs,
    );
  }

  let cooldownUntilEpoch = cloud.cooldownUntilEpoch;
  let consecutiveResumeFailures = cloud.consecutiveResumeFailures;
  if (avail === 'running') {
    cooldownUntilEpoch = null;
    consecutiveResumeFailures = 0;
  } else {
    const liveCooldown = parseIsoEpochSecs(machine.cooldownUntil);
    if (liveCooldown && liveCooldown > nowSecs && (!cooldownUntilEpoch || liveCooldown > cooldownUntilEpoch)) {
      cooldownUntilEpoch = liveCooldown;
    }
  }

  const next: BaileysBackupCloudState = {
    ...cloud,
    lastCheckedAt: nowSecs,
    lastVpsState: rawState,
    lastVpsAvailability: avail,
    lastVpsName: machine.name ?? cloud.lastVpsName,
    lastRunStartedAt: machine.runStartedAt,
    lastMaxRunMinutes: machine.maxRunMinutes,
    cooldownUntilEpoch,
    consecutiveResumeFailures,
    recentEvents: nextEvents,
  };
  return { next, changed };
}

export async function getBaileysBackupSnapshot(deps: BaileysBackupDeps = {}): Promise<{
  ok: true;
  data: BaileysBackupView;
}> {
  const nowMs = deps.nowMs ?? Date.now();
  const nowSecs = Math.floor(nowMs / 1000);
  const readFn = deps.readCloudAndDesktop ?? bacaCloudDanDesktopState;
  const writeFn = deps.writeCloudState ?? simpanCloudState;

  const [{ cloud, desktop }, live, keepaliveState] = await Promise.all([
    readFn(),
    fetchLiveInstaboxMachine(deps),
    readKeepaliveStateForView(deps),
  ]);

  let workingCloud = cloud;
  if (live.ok && live.machine) {
    const applied = applyLiveMachineToCloudState(workingCloud, live.machine, nowSecs);
    workingCloud = applied.next;
    await writeFn(workingCloud);
  }

  const view = buildBaileysBackupView(workingCloud, desktop, live.machine, nowMs, {
    instaboxConfigured: live.configured,
    liveFetchError: live.configured && !live.ok,
    machineId: deps.machineId ?? config.instaboxMachineId,
    installerReleaseUrl: deps.installerReleaseUrl,
    keepaliveState,
  });

  return { ok: true, data: view };
}

export async function runManualVpsCheck(deps: BaileysBackupDeps = {}): Promise<{
  ok: boolean;
  message: string;
  data: BaileysBackupView;
}> {
  const nowMs = deps.nowMs ?? Date.now();
  const nowSecs = Math.floor(nowMs / 1000);
  const readFn = deps.readCloudAndDesktop ?? bacaCloudDanDesktopState;
  const writeFn = deps.writeCloudState ?? simpanCloudState;

  const [{ cloud, desktop }, live, keepaliveState] = await Promise.all([
    readFn(),
    fetchLiveInstaboxMachine(deps),
    readKeepaliveStateForView(deps),
  ]);

  let workingCloud: BaileysBackupCloudState = {
    ...cloud,
    webChecksCount: cloud.webChecksCount + 1,
  };

  let message: string;
  if (!live.configured) {
    message = 'INSTABOX_API_KEY atau INSTABOX_MACHINE_ID belum dikonfigurasi di server.';
    workingCloud = {
      ...workingCloud,
      lastCheckedAt: nowSecs,
      recentEvents: appendCloudEvent(workingCloud.recentEvents, 'web', message, nowSecs),
    };
  } else if (live.ok && live.machine) {
    const applied = applyLiveMachineToCloudState(workingCloud, live.machine, nowSecs);
    workingCloud = applied.next;
    const stateUpper = workingCloud.lastVpsState?.toUpperCase() || 'UNKNOWN';
    const desktopOnline = Boolean(
      desktop &&
        !desktop.stopped &&
        desktop.heartbeatAt &&
        nowSecs - desktop.heartbeatAt <= DESKTOP_HEARTBEAT_TTL_SECS,
    );
    const botStatus =
      desktopOnline && desktop?.failoverActive && (desktop.childNodePid ?? 0) > 0
        ? `Backup AKTIF (PID ${desktop.childNodePid})`
        : desktopOnline
          ? 'Standby Pasif'
          : 'Laptop Offline (Mode Cloud)';
    message = `Cek manual (Web): VPS ${stateUpper}, ${botStatus}`;
    workingCloud = {
      ...workingCloud,
      recentEvents: appendCloudEvent(workingCloud.recentEvents, 'web', message, nowSecs),
    };
  } else {
    message = 'Cek manual (Web): gagal menghubungi API InstaBox, coba lagi.';
    workingCloud = {
      ...workingCloud,
      lastCheckedAt: nowSecs,
      recentEvents: appendCloudEvent(workingCloud.recentEvents, 'web', message, nowSecs),
    };
  }

  await writeFn(workingCloud);

  const view = buildBaileysBackupView(workingCloud, desktop, live.machine, nowMs, {
    instaboxConfigured: live.configured,
    liveFetchError: live.configured && !live.ok,
    machineId: deps.machineId ?? config.instaboxMachineId,
    installerReleaseUrl: deps.installerReleaseUrl,
    keepaliveState,
  });

  return { ok: !live.configured || live.ok, message, data: view };
}

async function performResumeAttempt(
  source: 'web' | 'cron',
  cloud: BaileysBackupCloudState,
  desktop: BaileysBackupDesktopState | null,
  liveMachine: InstaboxMachineSnapshot | null,
  observedRawState: string,
  deps: BaileysBackupDeps,
): Promise<{
  ok: boolean;
  httpStatus: number;
  status: 'resuming' | 'already_running' | 'cooldown' | 'error';
  actionUsed?: 'resume' | 'start';
  httpCode?: number;
  retryAfterSecs?: number | null;
  message: string;
  nextCloud: BaileysBackupCloudState;
}> {
  const nowMs = deps.nowMs ?? Date.now();
  const nowSecs = Math.floor(nowMs / 1000);
  const avail = classifyVpsAvailability(observedRawState);

  if (avail === 'running') {
    const msg = 'VPS utama sudah aktif (RUNNING)';
    const nextCloud: BaileysBackupCloudState = {
      ...cloud,
      cooldownUntilEpoch: null,
      consecutiveResumeFailures: 0,
      lastResumeMessage: msg,
      recentEvents: appendCloudEvent(cloud.recentEvents, source, msg, nowSecs),
    };
    return {
      ok: true,
      httpStatus: 200,
      status: 'already_running',
      message: msg,
      nextCloud,
    };
  }

  const maxCooldown = Math.max(
    cloud.cooldownUntilEpoch ?? 0,
    desktop?.cooldownUntilEpoch ?? 0,
    parseIsoEpochSecs(liveMachine?.cooldownUntil) ?? 0,
  );
  if (maxCooldown > nowSecs) {
    const rem = maxCooldown - nowSecs;
    const msg =
      rem >= 60
        ? `VPS sedang cooldown (coba lagi dalam ~${Math.ceil(rem / 60)}m)`
        : `VPS sedang cooldown (coba lagi dalam ~${rem}d)`;
    return {
      ok: false,
      httpStatus: 409,
      status: 'cooldown',
      retryAfterSecs: rem,
      message: msg,
      nextCloud: cloud,
    };
  }

  const res = await triggerInstaboxResume(observedRawState, deps);
  if (res.ok) {
    const msg =
      source === 'cron'
        ? `Auto-Resume VPS (Cloud) diterima (${res.actionUsed}, HTTP ${res.status}). Menunggu aktif...`
        : `Permintaan ${res.actionUsed} VPS (Web) diterima (HTTP ${res.status}). Menunggu aktif...`;
    const nextCloud: BaileysBackupCloudState = {
      ...cloud,
      cooldownUntilEpoch: null,
      consecutiveResumeFailures: 0,
      lastResumeAttemptAt: nowSecs,
      lastResumeSource: source,
      lastResumeMessage: msg,
      recentEvents: appendCloudEvent(cloud.recentEvents, source, msg, nowSecs),
    };
    return {
      ok: true,
      httpStatus: 200,
      status: 'resuming',
      actionUsed: res.actionUsed,
      httpCode: res.status,
      message: msg,
      nextCloud,
    };
  }

  const err = res.err;
  const shouldSetCooldown = err.isCooldown || err.status === 429 || source === 'cron';
  const nextFailures = cloud.consecutiveResumeFailures + 1;
  const backoff = shouldSetCooldown
    ? computeAutoResumeBackoffSecs(err, cloud.consecutiveResumeFailures)
    : 0;
  const nextCooldownUntil =
    shouldSetCooldown && backoff > 0 ? nowSecs + backoff : cloud.cooldownUntilEpoch;

  const prefix = source === 'cron' ? 'Auto-Resume VPS (Cloud) gagal' : 'Gagal aktifkan VPS (Web)';
  const msg = `${prefix}: ${err.message}`;

  const nextCloud: BaileysBackupCloudState = {
    ...cloud,
    cooldownUntilEpoch: nextCooldownUntil,
    consecutiveResumeFailures: nextFailures,
    lastResumeAttemptAt: nowSecs,
    lastResumeSource: source,
    lastResumeMessage: msg,
    recentEvents: appendCloudEvent(cloud.recentEvents, source, msg, nowSecs),
  };

  return {
    ok: false,
    httpStatus: err.isCooldown ? 409 : err.status === 429 ? 429 : 502,
    status: err.isCooldown ? 'cooldown' : 'error',
    retryAfterSecs: err.retryAfterSecs ?? (backoff > 0 ? backoff : null),
    message: msg,
    nextCloud,
  };
}

export async function runManualVpsResume(deps: BaileysBackupDeps = {}): Promise<{
  ok: boolean;
  httpStatus: number;
  status: 'resuming' | 'already_running' | 'cooldown' | 'error';
  message: string;
  retryAfterSecs?: number | null;
  data: BaileysBackupView;
}> {
  const nowMs = deps.nowMs ?? Date.now();
  const nowSecs = Math.floor(nowMs / 1000);
  const readFn = deps.readCloudAndDesktop ?? bacaCloudDanDesktopState;
  const writeFn = deps.writeCloudState ?? simpanCloudState;

  const [{ cloud, desktop }, live, keepaliveState] = await Promise.all([
    readFn(),
    fetchLiveInstaboxMachine(deps),
    readKeepaliveStateForView(deps),
  ]);

  if (!live.configured) {
    const message = 'INSTABOX_API_KEY atau INSTABOX_MACHINE_ID belum dikonfigurasi di server.';
    const view = buildBaileysBackupView(cloud, desktop, null, nowMs, {
      instaboxConfigured: false,
      liveFetchError: false,
      machineId: deps.machineId ?? config.instaboxMachineId,
      installerReleaseUrl: deps.installerReleaseUrl,
      keepaliveState,
    });
    return { ok: false, httpStatus: 502, status: 'error', message, data: view };
  }

  let workingCloud = cloud;
  if (live.ok && live.machine) {
    workingCloud = applyLiveMachineToCloudState(workingCloud, live.machine, nowSecs).next;
  }

  const observedState =
    live.machine?.state?.trim().toLowerCase() || workingCloud.lastVpsState || desktop?.vpsState || 'paused';

  const attempt = await performResumeAttempt(
    'web',
    workingCloud,
    desktop,
    live.machine,
    observedState,
    deps,
  );
  await writeFn(attempt.nextCloud);

  const view = buildBaileysBackupView(attempt.nextCloud, desktop, live.machine, nowMs, {
    instaboxConfigured: live.configured,
    liveFetchError: !live.ok,
    machineId: deps.machineId ?? config.instaboxMachineId,
    installerReleaseUrl: deps.installerReleaseUrl,
    keepaliveState,
  });

  return {
    ok: attempt.ok,
    httpStatus: attempt.httpStatus,
    status: attempt.status,
    message: attempt.message,
    retryAfterSecs: attempt.retryAfterSecs ?? null,
    data: view,
  };
}

export async function setAutoResumeMode(
  enabled: boolean,
  deps: BaileysBackupDeps = {},
): Promise<{
  ok: true;
  autoTriggeredResume: boolean;
  message: string;
  data: BaileysBackupView;
}> {
  const nowMs = deps.nowMs ?? Date.now();
  const nowSecs = Math.floor(nowMs / 1000);
  const readFn = deps.readCloudAndDesktop ?? bacaCloudDanDesktopState;
  const writeFn = deps.writeCloudState ?? simpanCloudState;

  const { cloud, desktop } = await readFn();
  const modeText = enabled ? 'Mode Resume VPS (Web): OTOMATIS' : 'Mode Resume VPS (Web): MANUAL';

  let workingCloud: BaileysBackupCloudState = {
    ...cloud,
    autoResumeEnabled: enabled,
    autoResumeUpdatedAt: nowMs,
    autoResumeUpdatedBy: 'web',
    cooldownUntilEpoch: enabled ? cloud.cooldownUntilEpoch : null,
    consecutiveResumeFailures: enabled ? cloud.consecutiveResumeFailures : 0,
    recentEvents: appendCloudEvent(cloud.recentEvents, 'web', modeText, nowSecs),
  };

  const live = await fetchLiveInstaboxMachine(deps);
  if (live.ok && live.machine) {
    workingCloud = applyLiveMachineToCloudState(workingCloud, live.machine, nowSecs).next;
  }

  let autoTriggeredResume = false;
  let finalMessage = modeText;

  if (enabled && live.configured) {
    const currentState =
      live.machine?.state?.trim().toLowerCase() || workingCloud.lastVpsState || desktop?.vpsState || '';
    if (classifyVpsAvailability(currentState) === 'down') {
      const attempt = await performResumeAttempt(
        'web',
        workingCloud,
        desktop,
        live.machine,
        currentState,
        deps,
      );
      workingCloud = attempt.nextCloud;
      autoTriggeredResume = attempt.ok && attempt.status === 'resuming';
      if (attempt.ok || attempt.status === 'cooldown') {
        finalMessage = `${modeText} · ${attempt.message}`;
      }
    }
  }

  await writeFn(workingCloud);

  const keepaliveState = await readKeepaliveStateForView(deps);
  const view = buildBaileysBackupView(workingCloud, desktop, live.machine, nowMs, {
    instaboxConfigured: live.configured,
    liveFetchError: live.configured && !live.ok,
    machineId: deps.machineId ?? config.instaboxMachineId,
    installerReleaseUrl: deps.installerReleaseUrl,
    keepaliveState,
  });

  return {
    ok: true,
    autoTriggeredResume,
    message: finalMessage,
    data: view,
  };
}

/**
 * Tombol "Ping VPS Sekarang": renew lease sekali, mengabaikan guard interval
 * & cooldown. Tetap menolak berjalan bila status mesin tidak terbaca atau
 * mesin tidak RUNNING, agar tidak membangunkan mesin yang di-pause sah.
 */
export async function runManualVpsKeepalive(
  deps: BaileysBackupDeps = {},
  force = true,
): Promise<{
  ok: boolean;
  httpStatus: number;
  attempted: boolean;
  reason?: string;
  message: string;
  data: BaileysBackupView;
}> {
  const nowMs = deps.nowMs ?? Date.now();
  const nowSecs = Math.floor(nowMs / 1000);
  const readFn = deps.readCloudAndDesktop ?? bacaCloudDanDesktopState;
  const writeCloudFn = deps.writeCloudState ?? simpanCloudState;

  const { cloud, desktop } = await readFn();
  const live = await fetchLiveInstaboxMachine(deps);
  const viewOpts = {
    instaboxConfigured: live.configured,
    liveFetchError: live.configured && !live.ok,
    machineId: deps.machineId ?? config.instaboxMachineId,
    installerReleaseUrl: deps.installerReleaseUrl,
  };

  if (!live.configured) {
    const message = 'INSTABOX_API_KEY atau INSTABOX_MACHINE_ID belum dikonfigurasi di server.';
    return {
      ok: false,
      httpStatus: 502,
      attempted: false,
      reason: 'not_configured',
      message,
      data: buildBaileysBackupView(cloud, desktop, null, nowMs, {
        ...viewOpts,
        instaboxConfigured: false,
        liveFetchError: false,
        keepaliveState: await readKeepaliveStateForView(deps),
      }),
    };
  }

  if (!live.ok || !live.machine) {
    const message =
      'Status VPS tidak dapat dibaca — ping dibatalkan agar tidak membangunkan mesin yang sengaja di-pause.';
    return {
      ok: false,
      httpStatus: 502,
      attempted: false,
      reason: 'status_unknown',
      message,
      data: buildBaileysBackupView(cloud, desktop, null, nowMs, {
        ...viewOpts,
        keepaliveState: await readKeepaliveStateForView(deps),
      }),
    };
  }

  const applied = applyLiveMachineToCloudState(cloud, live.machine, nowSecs);
  let workingCloud = applied.next;
  const run = await jalankanKeepaliveVps({
    trigger: 'web',
    force,
    // Hanya tombol manual (`force=true`) yang boleh mem-ping saat Auto-Ping OFF;
    // auto-ping pasif dari tab dashboard tetap tunduk pada sakelar server.
    ignoreEnabled: force,
    observedState: live.machine.state,
    autoSuspendSeconds: live.machine.autoSuspendAfterSeconds,
    runStartedAt: live.machine.runStartedAt,
    nowMs,
    apiKey: deps.apiKey,
    machineId: deps.machineId,
    apiBase: deps.apiBase,
    fetchImpl: deps.fetchImpl,
    readState: deps.readKeepaliveState,
    writeState: deps.writeKeepaliveState,
  });

  if (force && run.message) {
    workingCloud = {
      ...workingCloud,
      recentEvents: appendCloudEvent(
        workingCloud.recentEvents,
        'web',
        `Ping VPS manual: ${run.message}`,
        nowSecs,
      ),
    };
    await writeCloudFn(workingCloud);
  } else if (applied.changed || (run.attempted && run.ok)) {
    if (run.attempted && run.ok) {
      workingCloud = {
        ...workingCloud,
        recentEvents: appendCloudEvent(
          workingCloud.recentEvents,
          'web',
          `Auto-Ping VPS (Web): ${run.message ?? 'lease diperbarui.'}`,
          nowSecs,
        ),
      };
    }
    await writeCloudFn(workingCloud);
  }

  const view = buildBaileysBackupView(workingCloud, desktop, live.machine, nowMs, {
    ...viewOpts,
    keepaliveState: run.state,
  });

  const httpStatus =
    run.ok === true
      ? 200
      : run.reason === 'not_running'
        ? 409
        : run.reason === 'disabled' || run.reason === 'interval' || run.reason === 'cooldown'
          ? 200
          : 502;

  const skipMessage =
    run.reason === 'disabled'
      ? 'Auto-Ping VPS sedang nonaktif.'
      : run.reason === 'interval'
        ? 'Ping belum jatuh tempo — lease masih aktif.'
        : run.reason === 'cooldown'
          ? 'Ping ditunda karena cooldown kegagalan sebelumnya.'
          : run.attempted
            ? 'Ping VPS selesai.'
            : 'Ping VPS tidak dijalankan.';

  return {
    ok: run.ok === true,
    httpStatus,
    attempted: run.attempted,
    ...(run.reason ? { reason: run.reason } : {}),
    message: run.message ?? skipMessage,
    data: view,
  };
}

/** Sakelar Auto-Ping dari dashboard (durable di `__vps_keepalive_state.json`). */
export async function setKeepaliveMode(
  enabled: boolean,
  deps: BaileysBackupDeps = {},
): Promise<{
  ok: true;
  enabled: boolean;
  message: string;
  data: BaileysBackupView;
}> {
  const nowMs = deps.nowMs ?? Date.now();
  const nowSecs = Math.floor(nowMs / 1000);
  const readFn = deps.readCloudAndDesktop ?? bacaCloudDanDesktopState;
  const writeCloudFn = deps.writeCloudState ?? simpanCloudState;

  const [{ cloud, desktop }, live, updatedState] = await Promise.all([
    readFn(),
    fetchLiveInstaboxMachine(deps),
    setKeepaliveEnabled(enabled, 'web', {
      nowMs,
      readState: deps.readKeepaliveState,
      writeState: deps.writeKeepaliveState,
    }),
  ]);

  let finalState = updatedState;
  let workingCloud =
    live.ok && live.machine ? applyLiveMachineToCloudState(cloud, live.machine, nowSecs).next : cloud;

  const modeLabel = enabled ? 'Auto-Ping VPS (Web): AKTIF' : 'Auto-Ping VPS (Web): NONAKTIF';
  workingCloud = {
    ...workingCloud,
    recentEvents: appendCloudEvent(workingCloud.recentEvents, 'web', modeLabel, nowSecs),
  };

  const { intervalSecs, leaseTtlSecs } = getKeepaliveConfig();
  let message = enabled
    ? `Auto-Ping VPS: AKTIF (setiap ${Math.max(1, Math.round(intervalSecs / 60))} menit, lease ${Math.max(
        1,
        Math.round(leaseTtlSecs / 60),
      )} menit).`
    : 'Auto-Ping VPS: NONAKTIF — VPS akan idle-pause setelah jendela idle habis.';

  const machineRunning =
    live.configured &&
    live.ok &&
    live.machine &&
    classifyVpsAvailability(live.machine.state) === 'running';

  if (!enabled && machineRunning) {
    await releaseVpsActivityLease(deps);
  } else if (enabled && machineRunning && live.machine) {
    const immediate = await jalankanKeepaliveVps({
      trigger: 'web',
      force: false,
      ignoreEnabled: false,
      observedState: live.machine.state,
      autoSuspendSeconds: live.machine.autoSuspendAfterSeconds,
      runStartedAt: live.machine.runStartedAt,
      nowMs,
      apiKey: deps.apiKey,
      machineId: deps.machineId,
      apiBase: deps.apiBase,
      fetchImpl: deps.fetchImpl,
      readState: async () => finalState,
      writeState: deps.writeKeepaliveState,
    });
    finalState = immediate.state;
    if (immediate.attempted && immediate.ok) {
      message = `${message} Lease langsung diperbarui.`;
      workingCloud = {
        ...workingCloud,
        recentEvents: appendCloudEvent(
          workingCloud.recentEvents,
          'web',
          `Auto-Ping VPS (Web): ${immediate.message ?? 'lease diperbarui.'}`,
          nowSecs,
        ),
      };
    }
  }

  await writeCloudFn(workingCloud);

  const view = buildBaileysBackupView(workingCloud, desktop, live.machine, nowMs, {
    instaboxConfigured: live.configured,
    liveFetchError: live.configured && !live.ok,
    machineId: deps.machineId ?? config.instaboxMachineId,
    installerReleaseUrl: deps.installerReleaseUrl,
    keepaliveState: finalState,
  });

  return { ok: true, enabled, message, data: view };
}

export async function cobaAutoResumeDariCron(
  observedState: string | null,
  deps: BaileysBackupDeps = {},
): Promise<{
  attempted: boolean;
  ok?: boolean;
  reason?: 'not_configured' | 'manual_mode' | 'already_running' | 'not_down' | 'cooldown';
  actionUsed?: 'resume' | 'start';
  retryAfterSecs?: number;
  message?: string;
}> {
  const { apiKey, machineId } = resolveCreds(deps);
  if (!apiKey || !machineId) {
    return { attempted: false, reason: 'not_configured' };
  }

  const nowMs = deps.nowMs ?? Date.now();
  const nowSecs = Math.floor(nowMs / 1000);
  const readFn = deps.readCloudAndDesktop ?? bacaCloudDanDesktopState;
  const writeFn = deps.writeCloudState ?? simpanCloudState;

  const { cloud, desktop } = await readFn();
  const effectiveAutoResume = resolveEffectiveAutoResume(cloud, desktop);

  if (!effectiveAutoResume.enabled) {
    return { attempted: false, reason: 'manual_mode' };
  }

  const normalizedState = String(observedState ?? '').trim().toLowerCase();
  const avail = classifyVpsAvailability(normalizedState);

  if (avail === 'running') {
    if (cloud.cooldownUntilEpoch !== null || cloud.consecutiveResumeFailures > 0 || cloud.lastVpsState !== 'running') {
      await writeFn({
        ...cloud,
        lastVpsState: 'running',
        lastVpsAvailability: 'running',
        lastCheckedAt: nowSecs,
        cooldownUntilEpoch: null,
        consecutiveResumeFailures: 0,
      });
    }
    return { attempted: false, reason: 'already_running' };
  }

  if (avail !== 'down') {
    return { attempted: false, reason: 'not_down' };
  }

  const minNextByAttempt =
    cloud.lastResumeAttemptAt !== null ? cloud.lastResumeAttemptAt + MIN_CRON_RESUME_INTERVAL_SECS : 0;
  const effectiveCooldownUntil = Math.max(
    cloud.cooldownUntilEpoch ?? 0,
    desktop?.cooldownUntilEpoch ?? 0,
    minNextByAttempt,
  );

  if (effectiveCooldownUntil > nowSecs) {
    return {
      attempted: false,
      reason: 'cooldown',
      retryAfterSecs: effectiveCooldownUntil - nowSecs,
    };
  }

  const updatedCloud: BaileysBackupCloudState = {
    ...cloud,
    lastVpsState: normalizedState,
    lastVpsAvailability: avail,
    lastCheckedAt: nowSecs,
  };

  const attempt = await performResumeAttempt(
    'cron',
    updatedCloud,
    desktop,
    null,
    normalizedState,
    deps,
  );
  await writeFn(attempt.nextCloud);

  return {
    attempted: true,
    ok: attempt.ok,
    actionUsed: attempt.actionUsed,
    retryAfterSecs: attempt.retryAfterSecs ?? undefined,
    message: attempt.message,
  };
}
