/**
 * LOCAL AI VPS (VPS 2) CONTROL & LIVE ROUTING SERVICE
 *
 * Mengelola VPS InstaBox kedua khusus model AI lokal (`llama-server` / Ternary-Bonsai-2):
 *   - Status VPS live (GET /v1/machines/{id}) + health check `llama-server /health`
 *   - Auto-Resume OTOMATIS / MANUAL saat VPS 2 paused atau suspended (web & cron)
 *   - Auto-Ping anti idle-pause via activity lease (`bonsai-ai-vps-keepalive`)
 *   - Tombol ON / OFF "Model Lokal sebagai Model Utama" (`useAsPrimary`):
 *       ON  -> `localai` menjadi Tier 1 (model utama), failover otomatis ke cloud bila VPS mati
 *       OFF -> `localai` menjadi model backup terakhir (setelah semua provider cloud)
 *
 * Seluruh state disimpan persisten di tabel `whatsapp_sessions` Supabase agar
 * perubahan dari web dashboard langsung berlaku live lintas Vercel dan VPS Baileys.
 */
import { db } from './db.js';
import { config } from './env.js';
import type { InstaboxMachineSnapshot } from './vps_monitor.js';
import {
  defaultKeepaliveState,
  jalankanKeepaliveVps,
  releaseVpsActivityLease,
  setKeepaliveEnabled,
  type VpsKeepaliveState,
} from './vps_keepalive.js';
import {
  appendCloudEvent,
  buildKeepaliveView,
  classifyVpsAvailability,
  computeAutoResumeBackoffSecs,
  fetchLiveInstaboxMachine,
  triggerInstaboxResume,
  type BaileysBackupEvent,
  type BaileysKeepaliveView,
  type VpsAvailability,
} from './baileys_backup_web.js';

export const LOCAL_AI_VPS_STATE_FILENAME = '__local_ai_vps_state.json';
export const LOCAL_AI_KEEPALIVE_FILENAME = '__local_ai_keepalive_state.json';
export const LOCAL_AI_KEEPALIVE_LEASE_ID = 'bonsai-ai-vps-keepalive';

const PRIORITY_CACHE_TTL_MS = 15_000;
const MIN_CRON_RESUME_INTERVAL_SECS = 60;
const MAX_VIEW_EVENTS = 8;

export interface LocalAiVpsCloudState {
  /** true = model lokal jadi Tier 1 (utama); false = model backup terakhir. */
  useAsPrimary: boolean;
  useAsPrimaryUpdatedAt: number;
  useAsPrimaryUpdatedBy: 'web' | 'env';
  autoResumeEnabled: boolean;
  autoResumeUpdatedAt: number;
  autoResumeUpdatedBy: 'web' | 'cron';
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
  lastHealthOk: boolean | null;
  lastHealthLatencyMs: number | null;
  lastHealthCheckedAt: number | null;
  webChecksCount: number;
  recentEvents: BaileysBackupEvent[];
}

export interface LocalAiVpsView {
  instaboxConfigured: boolean;
  aiEndpointConfigured: boolean;
  liveFetchError: boolean;
  vpsState: string;
  vpsAvailability: VpsAvailability;
  machineName: string | null;
  machineId: string | null;
  runStartedAt: string | null;
  maxRunMinutes: number | null;
  autoSuspendAfterSeconds: number | null;
  runtimeRemainingMinutes: number | null;
  modelName: string;
  maxContextTokens: number;
  visionEnabled: boolean;
  useAsPrimary: boolean;
  useAsPrimaryUpdatedAt: number;
  aiHealthOk: boolean | null;
  aiHealthLatencyMs: number | null;
  aiHealthCheckedAt: number | null;
  autoResumeEnabled: boolean;
  autoResumeUpdatedAt: number;
  cooldownUntilEpoch: number | null;
  cooldownRemainingSecs: number;
  keepalive: BaileysKeepaliveView;
  lastCheckedAt: number | null;
  webChecksCount: number;
  lastResumeMessage: string | null;
  recentEvents: BaileysBackupEvent[];
  serverTimeEpoch: number;
}

export interface LocalAiVpsDeps {
  fetchImpl?: typeof fetch;
  nowMs?: number;
  apiKey?: string;
  machineId?: string;
  apiBase?: string;
  aiBaseUrl?: string;
  aiApiKey?: string;
  readState?: () => Promise<LocalAiVpsCloudState | null>;
  writeState?: (state: LocalAiVpsCloudState) => Promise<void>;
  readKeepalive?: () => Promise<VpsKeepaliveState | null>;
  writeKeepalive?: (state: VpsKeepaliveState) => Promise<void>;
}

let memState: LocalAiVpsCloudState | null = null;
let memKeepalive: VpsKeepaliveState | null = null;
let priorityCache: { value: 'primary' | 'fallback'; fetchedAtMs: number; fromDb: boolean } | null = null;
let priorityInFlight: Promise<'primary' | 'fallback'> | null = null;

export function resetLocalAiVpsCacheUntukTest(): void {
  memState = null;
  memKeepalive = null;
  priorityCache = null;
  priorityInFlight = null;
}

function asRecord(val: unknown): Record<string, unknown> | null {
  return val && typeof val === 'object' && !Array.isArray(val)
    ? (val as Record<string, unknown>)
    : null;
}

function numOrNull(val: unknown): number | null {
  if (val === null || val === undefined || val === '') return null;
  const n = Number(val);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

function maskMachineId(id: string | null): string | null {
  if (!id) return null;
  const clean = id.trim();
  if (clean.length <= 10) return clean;
  return `${clean.slice(0, 6)}...${clean.slice(-4)}`;
}

export function defaultLocalAiVpsState(): LocalAiVpsCloudState {
  return {
    useAsPrimary: config.localAiPriority === 'primary',
    useAsPrimaryUpdatedAt: 0,
    useAsPrimaryUpdatedBy: 'env',
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
    lastHealthOk: null,
    lastHealthLatencyMs: null,
    lastHealthCheckedAt: null,
    webChecksCount: 0,
    recentEvents: [],
  };
}

function normalizeLocalAiVpsState(raw: unknown): LocalAiVpsCloudState {
  const def = defaultLocalAiVpsState();
  const obj = asRecord(raw);
  if (!obj) return def;

  const events: BaileysBackupEvent[] = Array.isArray(obj.recentEvents)
    ? obj.recentEvents
        .map((item) => {
          const rec = asRecord(item);
          if (!rec) return null;
          const msg = String(rec.message ?? '').trim().slice(0, 180);
          if (!msg) return null;
          const srcRaw = String(rec.source ?? 'web');
          const source = srcRaw === 'cron' ? 'cron' : 'web';
          const ts = Number.isFinite(Number(rec.ts)) ? Math.max(0, Math.floor(Number(rec.ts))) : 0;
          return { ts, source, message: msg } as BaileysBackupEvent;
        })
        .filter((x): x is BaileysBackupEvent => x !== null)
        .slice(0, 12)
    : [];

  const availRaw = String(obj.lastVpsAvailability ?? 'unknown');
  const lastVpsAvailability: VpsAvailability =
    availRaw === 'running' || availRaw === 'down' || availRaw === 'transient' ? availRaw : 'unknown';

  return {
    useAsPrimary:
      typeof obj.useAsPrimary === 'boolean' ? obj.useAsPrimary : def.useAsPrimary,
    useAsPrimaryUpdatedAt: numOrNull(obj.useAsPrimaryUpdatedAt) ?? 0,
    useAsPrimaryUpdatedBy: obj.useAsPrimaryUpdatedBy === 'web' ? 'web' : 'env',
    autoResumeEnabled: Boolean(obj.autoResumeEnabled),
    autoResumeUpdatedAt: numOrNull(obj.autoResumeUpdatedAt) ?? 0,
    autoResumeUpdatedBy: obj.autoResumeUpdatedBy === 'cron' ? 'cron' : 'web',
    cooldownUntilEpoch: numOrNull(obj.cooldownUntilEpoch),
    consecutiveResumeFailures: numOrNull(obj.consecutiveResumeFailures) ?? 0,
    lastResumeAttemptAt: numOrNull(obj.lastResumeAttemptAt),
    lastResumeSource:
      obj.lastResumeSource === 'web' || obj.lastResumeSource === 'cron'
        ? obj.lastResumeSource
        : null,
    lastResumeMessage: typeof obj.lastResumeMessage === 'string' ? obj.lastResumeMessage.slice(0, 180) : null,
    lastCheckedAt: numOrNull(obj.lastCheckedAt),
    lastVpsState: typeof obj.lastVpsState === 'string' ? obj.lastVpsState : null,
    lastVpsAvailability,
    lastVpsName: typeof obj.lastVpsName === 'string' ? obj.lastVpsName : null,
    lastRunStartedAt: typeof obj.lastRunStartedAt === 'string' ? obj.lastRunStartedAt : null,
    lastMaxRunMinutes: numOrNull(obj.lastMaxRunMinutes),
    lastHealthOk: typeof obj.lastHealthOk === 'boolean' ? obj.lastHealthOk : null,
    lastHealthLatencyMs: numOrNull(obj.lastHealthLatencyMs),
    lastHealthCheckedAt: numOrNull(obj.lastHealthCheckedAt),
    webChecksCount: numOrNull(obj.webChecksCount) ?? 0,
    recentEvents: events,
  };
}

function updatePriorityCacheFromState(state: LocalAiVpsCloudState, nowMs = Date.now()): void {
  const value: 'primary' | 'fallback' = state.useAsPrimary ? 'primary' : 'fallback';
  priorityCache = { value, fetchedAtMs: nowMs, fromDb: true };
}

export function getEffectiveLocalAiPriority(): 'primary' | 'fallback' {
  if (priorityCache?.fromDb) return priorityCache.value;
  return config.localAiPriority;
}

export async function bacaLocalAiVpsState(): Promise<LocalAiVpsCloudState | null> {
  const c = db();
  if (!c) return memState;
  try {
    const { data, error } = await c
      .from('whatsapp_sessions')
      .select('data')
      .eq('filename', LOCAL_AI_VPS_STATE_FILENAME)
      .maybeSingle();
    if (!error && data && data.data) {
      const normalized = normalizeLocalAiVpsState(data.data);
      memState = normalized;
      updatePriorityCacheFromState(normalized);
      return normalized;
    }
  } catch (err) {
    console.warn('[local-ai-vps] gagal membaca state:', String((err as Error)?.message ?? err).slice(0, 120));
  }
  return memState;
}

export async function simpanLocalAiVpsState(state: LocalAiVpsCloudState): Promise<void> {
  memState = state;
  updatePriorityCacheFromState(state);
  const c = db();
  if (!c) return;
  try {
    const { error } = await c.from('whatsapp_sessions').upsert(
      {
        filename: LOCAL_AI_VPS_STATE_FILENAME,
        data: state,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'filename' },
    );
    if (error) {
      console.warn('[local-ai-vps] gagal menyimpan state:', error.message);
    }
  } catch (err) {
    console.warn('[local-ai-vps] error simpan state:', String((err as Error)?.message ?? err).slice(0, 120));
  }
}

export async function bacaLocalAiKeepaliveState(): Promise<VpsKeepaliveState | null> {
  const c = db();
  if (!c) return memKeepalive;
  try {
    const { data, error } = await c
      .from('whatsapp_sessions')
      .select('data')
      .eq('filename', LOCAL_AI_KEEPALIVE_FILENAME)
      .maybeSingle();
    if (!error && data && data.data && typeof data.data === 'object') {
      const merged: VpsKeepaliveState = {
        ...defaultKeepaliveState(),
        ...(data.data as Partial<VpsKeepaliveState>),
      };
      memKeepalive = merged;
      return merged;
    }
  } catch (err) {
    console.warn('[local-ai-vps] gagal baca keepalive:', String((err as Error)?.message ?? err).slice(0, 120));
  }
  return memKeepalive;
}

export async function simpanLocalAiKeepaliveState(state: VpsKeepaliveState): Promise<void> {
  memKeepalive = state;
  const c = db();
  if (!c) return;
  try {
    const { error } = await c.from('whatsapp_sessions').upsert(
      {
        filename: LOCAL_AI_KEEPALIVE_FILENAME,
        data: state,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'filename' },
    );
    if (error) {
      console.warn('[local-ai-vps] gagal simpan keepalive:', error.message);
    }
  } catch (err) {
    console.warn('[local-ai-vps] error simpan keepalive:', String((err as Error)?.message ?? err).slice(0, 120));
  }
}

/**
 * Segarkan flag prioritas model lokal (`primary` vs `fallback`) dari Supabase bila cache > 15 detik.
 * Dipakai `src/providers.ts` sehingga tombol ON/OFF di web dashboard berlaku live tanpa redeploy.
 */
export async function refreshLocalAiPriorityIfStale(nowMs = Date.now()): Promise<'primary' | 'fallback'> {
  if (priorityCache && nowMs - priorityCache.fetchedAtMs < PRIORITY_CACHE_TTL_MS) {
    return priorityCache.value;
  }
  if (!db()) {
    return getEffectiveLocalAiPriority();
  }
  if (priorityInFlight) return priorityInFlight;
  priorityInFlight = (async () => {
    try {
      const saved = await bacaLocalAiVpsState();
      if (saved) {
        updatePriorityCacheFromState(saved, nowMs);
        return saved.useAsPrimary ? 'primary' : 'fallback';
      }
      priorityCache = { value: config.localAiPriority, fetchedAtMs: nowMs, fromDb: false };
      return config.localAiPriority;
    } catch {
      return getEffectiveLocalAiPriority();
    } finally {
      priorityInFlight = null;
    }
  })();
  return priorityInFlight;
}

function resolveVps2Creds(deps: LocalAiVpsDeps) {
  const apiKey = (deps.apiKey ?? config.localAiInstaboxApiKey).trim();
  const machineId = (deps.machineId ?? config.localAiInstaboxMachineId).trim();
  const apiBase = (deps.apiBase ?? config.instaboxApiBase).replace(/\/+$/, '');
  const aiBaseUrl = (deps.aiBaseUrl ?? config.localAiUrl).replace(/\/+$/, '');
  const aiApiKey = (deps.aiApiKey ?? config.pools.localai[0] ?? '').trim();
  return { apiKey, machineId, apiBase, aiBaseUrl, aiApiKey };
}

async function checkLocalAiHealth(
  aiBaseUrl: string,
  fetchImpl: typeof fetch,
): Promise<{ ok: boolean; latencyMs: number } | null> {
  if (!aiBaseUrl) return null;
  const healthUrl = aiBaseUrl.replace(/\/v1$/i, '') + '/health';
  const startedAt = Date.now();
  try {
    const res = await fetchImpl(healthUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(4500),
    });
    return { ok: res.ok, latencyMs: Date.now() - startedAt };
  } catch {
    return { ok: false, latencyMs: Date.now() - startedAt };
  }
}

function computeRuntimeRemainingMinutes(
  runStartedAt: string | null,
  maxRunMinutes: number | null,
  nowMs: number,
): number | null {
  if (!runStartedAt || !maxRunMinutes || maxRunMinutes <= 0) return null;
  const startedMs = Date.parse(runStartedAt);
  if (!Number.isFinite(startedMs)) return null;
  const elapsedMin = (nowMs - startedMs) / 60_000;
  return Math.max(0, Math.round(maxRunMinutes - elapsedMin));
}

function buildLocalAiVpsView(params: {
  state: LocalAiVpsCloudState;
  keepaliveState: VpsKeepaliveState;
  machine: InstaboxMachineSnapshot | null;
  instaboxConfigured: boolean;
  aiEndpointConfigured: boolean;
  liveFetchError: boolean;
  machineId: string;
  nowMs: number;
}): LocalAiVpsView {
  const { state, keepaliveState, machine, instaboxConfigured, aiEndpointConfigured, liveFetchError, machineId, nowMs } = params;
  const nowSecs = Math.floor(nowMs / 1000);

  const vpsState = machine ? machine.state : state.lastVpsState || (instaboxConfigured ? 'unknown' : 'unconfigured');
  const vpsAvailability: VpsAvailability = machine
    ? classifyVpsAvailability(machine.state)
    : state.lastVpsAvailability;
  const runStartedAt = machine ? machine.runStartedAt : state.lastRunStartedAt;
  const maxRunMinutes = machine ? machine.maxRunMinutes : state.lastMaxRunMinutes;
  const runtimeRemainingMinutes =
    vpsAvailability === 'running'
      ? computeRuntimeRemainingMinutes(runStartedAt, maxRunMinutes, nowMs)
      : null;

  const cooldownUntilEpoch =
    state.cooldownUntilEpoch && state.cooldownUntilEpoch > nowSecs ? state.cooldownUntilEpoch : null;
  const cooldownRemainingSecs = cooldownUntilEpoch ? Math.max(0, cooldownUntilEpoch - nowSecs) : 0;

  const keepalive = buildKeepaliveView(keepaliveState, machine, nowMs, {
    fallbackRunning: vpsAvailability === 'running',
    fallbackRunStartedAt: runStartedAt,
  });

  return {
    instaboxConfigured,
    aiEndpointConfigured,
    liveFetchError,
    vpsState,
    vpsAvailability,
    machineName: machine?.name || state.lastVpsName || (instaboxConfigured ? 'bonsai-ai-server' : null),
    machineId: maskMachineId(machine?.id || machineId || null),
    runStartedAt,
    maxRunMinutes,
    autoSuspendAfterSeconds: machine?.autoSuspendAfterSeconds ?? null,
    runtimeRemainingMinutes,
    modelName: config.localAiModel,
    maxContextTokens: config.localAiMaxContextTokens,
    visionEnabled: config.localAiVision,
    useAsPrimary: state.useAsPrimary,
    useAsPrimaryUpdatedAt: state.useAsPrimaryUpdatedAt,
    aiHealthOk: state.lastHealthOk,
    aiHealthLatencyMs: state.lastHealthLatencyMs,
    aiHealthCheckedAt: state.lastHealthCheckedAt,
    autoResumeEnabled: state.autoResumeEnabled,
    autoResumeUpdatedAt: state.autoResumeUpdatedAt,
    cooldownUntilEpoch,
    cooldownRemainingSecs,
    keepalive,
    lastCheckedAt: state.lastCheckedAt,
    webChecksCount: state.webChecksCount,
    lastResumeMessage: state.lastResumeMessage,
    recentEvents: state.recentEvents.slice(0, MAX_VIEW_EVENTS),
    serverTimeEpoch: nowSecs,
  };
}

async function fetchSnapshotInternal(
  deps: LocalAiVpsDeps,
  opts: { incrementChecks?: boolean; logEvent?: string; source?: 'web' | 'cron' } = {},
): Promise<{
  view: LocalAiVpsView;
  state: LocalAiVpsCloudState;
  keepaliveState: VpsKeepaliveState;
  machine: InstaboxMachineSnapshot | null;
}> {
  const nowMs = deps.nowMs ?? Date.now();
  const nowSecs = Math.floor(nowMs / 1000);
  const fetchImpl = deps.fetchImpl ?? fetch;
  const creds = resolveVps2Creds(deps);
  const readStateFn = deps.readState ?? bacaLocalAiVpsState;
  const writeStateFn = deps.writeState ?? simpanLocalAiVpsState;
  const readKaFn = deps.readKeepalive ?? bacaLocalAiKeepaliveState;

  const [savedState, savedKa, liveMachine, healthRes] = await Promise.all([
    readStateFn(),
    readKaFn(),
    fetchLiveInstaboxMachine({
      apiKey: creds.apiKey,
      machineId: creds.machineId,
      apiBase: creds.apiBase,
      fetchImpl,
    }),
    checkLocalAiHealth(creds.aiBaseUrl, fetchImpl),
  ]);

  let nextState: LocalAiVpsCloudState = savedState ?? defaultLocalAiVpsState();
  const keepaliveState = savedKa ?? defaultKeepaliveState();
  let dirty = false;

  if (liveMachine.ok && liveMachine.machine) {
    const avail = classifyVpsAvailability(liveMachine.machine.state);
    nextState = {
      ...nextState,
      lastCheckedAt: nowSecs,
      lastVpsState: liveMachine.machine.state,
      lastVpsAvailability: avail,
      lastVpsName: liveMachine.machine.name ?? nextState.lastVpsName,
      lastRunStartedAt: liveMachine.machine.runStartedAt,
      lastMaxRunMinutes: liveMachine.machine.maxRunMinutes,
      ...(avail === 'running' ? { cooldownUntilEpoch: null, consecutiveResumeFailures: 0 } : {}),
    };
    dirty = true;
  }

  if (healthRes !== null) {
    nextState = {
      ...nextState,
      lastHealthOk: healthRes.ok,
      lastHealthLatencyMs: healthRes.latencyMs,
      lastHealthCheckedAt: nowSecs,
    };
    dirty = true;
  }

  if (opts.incrementChecks) {
    nextState = {
      ...nextState,
      webChecksCount: nextState.webChecksCount + 1,
    };
    dirty = true;
  }

  if (opts.logEvent) {
    nextState = {
      ...nextState,
      recentEvents: appendCloudEvent(nextState.recentEvents, opts.source ?? 'web', opts.logEvent, nowSecs),
    };
    dirty = true;
  }

  if (dirty) {
    await writeStateFn(nextState);
  }

  const view = buildLocalAiVpsView({
    state: nextState,
    keepaliveState,
    machine: liveMachine.machine,
    instaboxConfigured: liveMachine.configured,
    aiEndpointConfigured: Boolean(creds.aiBaseUrl && creds.aiApiKey),
    liveFetchError: liveMachine.configured && !liveMachine.ok,
    machineId: creds.machineId,
    nowMs,
  });

  return { view, state: nextState, keepaliveState, machine: liveMachine.machine };
}

export async function getLocalAiVpsSnapshot(deps: LocalAiVpsDeps = {}): Promise<{ ok: true; data: LocalAiVpsView }> {
  const { view } = await fetchSnapshotInternal(deps);
  return { ok: true, data: view };
}

export async function runManualLocalAiVpsCheck(deps: LocalAiVpsDeps = {}): Promise<{ ok: true; data: LocalAiVpsView }> {
  const { view, state } = await fetchSnapshotInternal(deps, { incrementChecks: true });
  const nowSecs = Math.floor((deps.nowMs ?? Date.now()) / 1000);
  const healthTag = view.aiHealthOk === true ? `AI OK (${view.aiHealthLatencyMs}ms)` : view.aiHealthOk === false ? 'AI offline' : 'AI belum diset';
  const nextState: LocalAiVpsCloudState = {
    ...state,
    recentEvents: appendCloudEvent(
      state.recentEvents,
      'web',
      `Cek VPS 2 manual: ${view.vpsState.toUpperCase()} · ${healthTag}.`,
      nowSecs,
    ),
  };
  await (deps.writeState ?? simpanLocalAiVpsState)(nextState);
  return { ok: true, data: { ...view, recentEvents: nextState.recentEvents.slice(0, MAX_VIEW_EVENTS) } };
}

export async function setLocalAiPrimaryMode(
  useAsPrimary: boolean,
  deps: LocalAiVpsDeps = {},
): Promise<{ ok: true; data: LocalAiVpsView; message: string }> {
  const nowMs = deps.nowMs ?? Date.now();
  const nowSecs = Math.floor(nowMs / 1000);
  const readStateFn = deps.readState ?? bacaLocalAiVpsState;
  const writeStateFn = deps.writeState ?? simpanLocalAiVpsState;
  const base = (await readStateFn()) ?? defaultLocalAiVpsState();
  const label = useAsPrimary
    ? 'Model Lokal dijadikan MODEL UTAMA (Tier 1; failover otomatis ke cloud bila VPS mati).'
    : 'Model Lokal dijadikan MODEL BACKUP TERAKHIR (cloud dipakai lebih dulu).';

  const updated: LocalAiVpsCloudState = {
    ...base,
    useAsPrimary,
    useAsPrimaryUpdatedAt: nowSecs,
    useAsPrimaryUpdatedBy: 'web',
    recentEvents: appendCloudEvent(base.recentEvents, 'web', label, nowSecs),
  };
  updatePriorityCacheFromState(updated, nowMs);
  await writeStateFn(updated);

  const { view } = await fetchSnapshotInternal({
    ...deps,
    readState: async () => updated,
  });
  return { ok: true, data: view, message: label };
}

export async function setLocalAiAutoResumeMode(
  enabled: boolean,
  deps: LocalAiVpsDeps = {},
): Promise<{ ok: true; data: LocalAiVpsView; message: string }> {
  const nowSecs = Math.floor((deps.nowMs ?? Date.now()) / 1000);
  const readStateFn = deps.readState ?? bacaLocalAiVpsState;
  const writeStateFn = deps.writeState ?? simpanLocalAiVpsState;
  const base = (await readStateFn()) ?? defaultLocalAiVpsState();
  const msg = enabled
    ? 'Auto-Resume VPS 2 diubah ke OTOMATIS (aktif via cloud cron).'
    : 'Auto-Resume VPS 2 diubah ke MANUAL.';
  const updated: LocalAiVpsCloudState = {
    ...base,
    autoResumeEnabled: enabled,
    autoResumeUpdatedAt: nowSecs,
    autoResumeUpdatedBy: 'web',
    recentEvents: appendCloudEvent(base.recentEvents, 'web', msg, nowSecs),
  };
  await writeStateFn(updated);
  const { view } = await fetchSnapshotInternal({ ...deps, readState: async () => updated });
  return { ok: true, data: view, message: msg };
}

export async function setLocalAiKeepaliveMode(
  enabled: boolean,
  deps: LocalAiVpsDeps = {},
): Promise<{ ok: true; data: LocalAiVpsView; message: string }> {
  const nowMs = deps.nowMs ?? Date.now();
  const nowSecs = Math.floor(nowMs / 1000);
  const creds = resolveVps2Creds(deps);
  const readStateFn = deps.readState ?? bacaLocalAiVpsState;
  const writeStateFn = deps.writeState ?? simpanLocalAiVpsState;
  const readKaFn = deps.readKeepalive ?? bacaLocalAiKeepaliveState;
  const writeKaFn = deps.writeKeepalive ?? simpanLocalAiKeepaliveState;

  const updatedKa = await setKeepaliveEnabled(enabled, 'web', {
    nowMs,
    readState: readKaFn,
    writeState: writeKaFn,
  });
  if (!enabled && creds.apiKey && creds.machineId) {
    await releaseVpsActivityLease({
      apiKey: creds.apiKey,
      machineId: creds.machineId,
      apiBase: creds.apiBase,
      leaseId: LOCAL_AI_KEEPALIVE_LEASE_ID,
      fetchImpl: deps.fetchImpl,
    }).catch(() => {});
  }

  const base = (await readStateFn()) ?? defaultLocalAiVpsState();
  const msg = enabled
    ? 'Auto-Ping VPS 2 diaktifkan (lease aktivitas anti idle-pause aktif).'
    : 'Auto-Ping VPS 2 dinonaktifkan dan lease dilepas.';
  const updated: LocalAiVpsCloudState = {
    ...base,
    recentEvents: appendCloudEvent(base.recentEvents, 'web', msg, nowSecs),
  };
  await writeStateFn(updated);
  const { view } = await fetchSnapshotInternal({
    ...deps,
    readState: async () => updated,
    readKeepalive: async () => updatedKa,
  });
  return { ok: true, data: view, message: msg };
}

export async function runManualLocalAiVpsKeepalive(
  deps: LocalAiVpsDeps = {},
  force = true,
): Promise<{
  ok: boolean;
  attempted: boolean;
  httpStatus: number;
  reason?: string;
  message: string;
  data: LocalAiVpsView;
}> {
  const nowMs = deps.nowMs ?? Date.now();
  const nowSecs = Math.floor(nowMs / 1000);
  const creds = resolveVps2Creds(deps);
  const readStateFn = deps.readState ?? bacaLocalAiVpsState;
  const writeStateFn = deps.writeState ?? simpanLocalAiVpsState;
  const readKaFn = deps.readKeepalive ?? bacaLocalAiKeepaliveState;
  const writeKaFn = deps.writeKeepalive ?? simpanLocalAiKeepaliveState;

  const live = await fetchLiveInstaboxMachine({
    apiKey: creds.apiKey,
    machineId: creds.machineId,
    apiBase: creds.apiBase,
    fetchImpl: deps.fetchImpl,
  });
  if (!live.configured) {
    const snap = await getLocalAiVpsSnapshot(deps);
    return {
      ok: false,
      attempted: false,
      httpStatus: 503,
      reason: 'not_configured',
      message: 'LOCAL_AI_INSTABOX_API_KEY atau LOCAL_AI_INSTABOX_MACHINE_ID belum dikonfigurasi.',
      data: snap.data,
    };
  }

  const kaRes = await jalankanKeepaliveVps({
    trigger: 'web',
    force,
    ignoreEnabled: force,
    observedState: live.machine?.state ?? null,
    autoSuspendSeconds: live.machine?.autoSuspendAfterSeconds ?? null,
    runStartedAt: live.machine?.runStartedAt ?? null,
    nowMs,
    apiKey: creds.apiKey,
    machineId: creds.machineId,
    apiBase: creds.apiBase,
    leaseId: LOCAL_AI_KEEPALIVE_LEASE_ID,
    fetchImpl: deps.fetchImpl,
    readState: readKaFn,
    writeState: writeKaFn,
  });

  const base = (await readStateFn()) ?? defaultLocalAiVpsState();
  const msg = kaRes.message || (kaRes.ok ? 'Ping VPS 2 terkirim.' : `Ping VPS 2 dilewati (${kaRes.reason ?? 'unknown'}).`);
  const updated: LocalAiVpsCloudState = {
    ...base,
    recentEvents: kaRes.attempted
      ? appendCloudEvent(base.recentEvents, 'web', `Auto-Ping VPS 2: ${msg}`, nowSecs)
      : base.recentEvents,
  };
  if (kaRes.attempted) await writeStateFn(updated);

  const { view } = await fetchSnapshotInternal({
    ...deps,
    readState: async () => updated,
    readKeepalive: async () => kaRes.state,
  });

  const ok = Boolean(kaRes.ok) || (!kaRes.attempted && kaRes.reason === 'interval');
  const httpStatus = ok ? 200 : kaRes.reason === 'not_running' ? 409 : kaRes.httpStatus === 429 ? 429 : 502;
  return { ok, attempted: kaRes.attempted, httpStatus, reason: kaRes.reason, message: msg, data: view };
}

export async function runManualLocalAiVpsResume(
  deps: LocalAiVpsDeps = {},
): Promise<{
  ok: boolean;
  status: 'accepted' | 'already_running' | 'transient' | 'cooldown' | 'not_configured' | 'error';
  httpStatus: number;
  retryAfterSecs?: number | null;
  message: string;
  data: LocalAiVpsView;
}> {
  const nowMs = deps.nowMs ?? Date.now();
  const nowSecs = Math.floor(nowMs / 1000);
  const creds = resolveVps2Creds(deps);
  const readStateFn = deps.readState ?? bacaLocalAiVpsState;
  const writeStateFn = deps.writeState ?? simpanLocalAiVpsState;

  const live = await fetchLiveInstaboxMachine({
    apiKey: creds.apiKey,
    machineId: creds.machineId,
    apiBase: creds.apiBase,
    fetchImpl: deps.fetchImpl,
  });
  if (!live.configured) {
    const snap = await getLocalAiVpsSnapshot(deps);
    return {
      ok: false,
      status: 'not_configured',
      httpStatus: 503,
      message: 'LOCAL_AI_INSTABOX_API_KEY atau LOCAL_AI_INSTABOX_MACHINE_ID belum dikonfigurasi.',
      data: snap.data,
    };
  }

  const rawState = live.machine?.state ?? 'paused';
  const avail = classifyVpsAvailability(rawState);
  if (avail === 'running') {
    const snap = await getLocalAiVpsSnapshot(deps);
    return {
      ok: true,
      status: 'already_running',
      httpStatus: 200,
      message: 'VPS 2 sudah dalam status RUNNING.',
      data: snap.data,
    };
  }
  if (avail === 'transient') {
    const snap = await getLocalAiVpsSnapshot(deps);
    return {
      ok: true,
      status: 'transient',
      httpStatus: 202,
      message: `VPS 2 sedang transisi (${rawState.toUpperCase()}). Tunggu sebentar.`,
      data: snap.data,
    };
  }

  const base = (await readStateFn()) ?? defaultLocalAiVpsState();
  const res = await triggerInstaboxResume(rawState, {
    apiKey: creds.apiKey,
    machineId: creds.machineId,
    apiBase: creds.apiBase,
    fetchImpl: deps.fetchImpl,
    nowMs,
  });

  if (res.ok) {
    const msg = `Resume VPS 2 diterima (${res.actionUsed}, HTTP ${res.status}). Menunggu aktif...`;
    const updated: LocalAiVpsCloudState = {
      ...base,
      cooldownUntilEpoch: null,
      consecutiveResumeFailures: 0,
      lastResumeAttemptAt: nowSecs,
      lastResumeSource: 'web',
      lastResumeMessage: msg,
      recentEvents: appendCloudEvent(base.recentEvents, 'web', msg, nowSecs),
    };
    await writeStateFn(updated);
    const { view } = await fetchSnapshotInternal({ ...deps, readState: async () => updated });
    return { ok: true, status: 'accepted', httpStatus: 200, message: msg, data: view };
  }

  const backoffSecs = computeAutoResumeBackoffSecs(res.err, base.consecutiveResumeFailures);
  const msg = res.err.isCooldown
    ? `VPS 2 sedang cooldown (${res.err.message}).`
    : `Gagal resume VPS 2: ${res.err.message}`;
  const updated: LocalAiVpsCloudState = {
    ...base,
    cooldownUntilEpoch: res.err.isCooldown ? nowSecs + backoffSecs : base.cooldownUntilEpoch,
    consecutiveResumeFailures: base.consecutiveResumeFailures + 1,
    lastResumeAttemptAt: nowSecs,
    lastResumeSource: 'web',
    lastResumeMessage: msg,
    recentEvents: appendCloudEvent(base.recentEvents, 'web', msg, nowSecs),
  };
  await writeStateFn(updated);
  const { view } = await fetchSnapshotInternal({ ...deps, readState: async () => updated });
  return {
    ok: false,
    status: res.err.isCooldown ? 'cooldown' : 'error',
    httpStatus: res.err.isCooldown ? 429 : 502,
    retryAfterSecs: res.err.retryAfterSecs ?? (res.err.isCooldown ? backoffSecs : null),
    message: msg,
    data: view,
  };
}

/**
 * Dipanggil cron `/api/cron/reminders` (setiap 5 menit) untuk VPS 2:
 * 1. Mengecek status VPS 2 live
 * 2. Menjalankan Auto-Ping lease jika running & enabled
 * 3. Menjalankan Auto-Resume jika paused/suspended & autoResumeEnabled=true (hormati cooldown)
 */
export async function cobaKeepaliveDanAutoResumeVps2DariCron(deps: LocalAiVpsDeps = {}): Promise<{
  configured: boolean;
  state: string | null;
  keepalive: { attempted: boolean; ok?: boolean; reason?: string; message?: string };
  autoResume: { attempted: boolean; ok?: boolean; reason?: string; message?: string };
}> {
  const nowMs = deps.nowMs ?? Date.now();
  const nowSecs = Math.floor(nowMs / 1000);
  const creds = resolveVps2Creds(deps);
  if (!creds.apiKey || !creds.machineId) {
    return {
      configured: false,
      state: null,
      keepalive: { attempted: false, reason: 'not_configured' },
      autoResume: { attempted: false, reason: 'not_configured' },
    };
  }

  const readStateFn = deps.readState ?? bacaLocalAiVpsState;
  const writeStateFn = deps.writeState ?? simpanLocalAiVpsState;
  const readKaFn = deps.readKeepalive ?? bacaLocalAiKeepaliveState;
  const writeKaFn = deps.writeKeepalive ?? simpanLocalAiKeepaliveState;

  const live = await fetchLiveInstaboxMachine({
    apiKey: creds.apiKey,
    machineId: creds.machineId,
    apiBase: creds.apiBase,
    fetchImpl: deps.fetchImpl,
  });
  if (!live.ok || !live.machine) {
    return {
      configured: true,
      state: null,
      keepalive: { attempted: false, reason: 'fetch_error' },
      autoResume: { attempted: false, reason: 'fetch_error' },
    };
  }

  const machine = live.machine;
  const avail = classifyVpsAvailability(machine.state);
  let state = (await readStateFn()) ?? defaultLocalAiVpsState();
  state = {
    ...state,
    lastCheckedAt: nowSecs,
    lastVpsState: machine.state,
    lastVpsAvailability: avail,
    lastVpsName: machine.name ?? state.lastVpsName,
    lastRunStartedAt: machine.runStartedAt,
    lastMaxRunMinutes: machine.maxRunMinutes,
    ...(avail === 'running' ? { cooldownUntilEpoch: null, consecutiveResumeFailures: 0 } : {}),
  };

  let kaSummary: { attempted: boolean; ok?: boolean; reason?: string; message?: string } = {
    attempted: false,
    reason: 'not_running',
  };
  if (avail === 'running') {
    const kaRes = await jalankanKeepaliveVps({
      trigger: 'cron',
      observedState: machine.state,
      autoSuspendSeconds: machine.autoSuspendAfterSeconds,
      runStartedAt: machine.runStartedAt,
      nowMs,
      apiKey: creds.apiKey,
      machineId: creds.machineId,
      apiBase: creds.apiBase,
      leaseId: LOCAL_AI_KEEPALIVE_LEASE_ID,
      fetchImpl: deps.fetchImpl,
      readState: readKaFn,
      writeState: writeKaFn,
    });
    kaSummary = {
      attempted: kaRes.attempted,
      ok: kaRes.ok,
      reason: kaRes.reason,
      message: kaRes.message,
    };
    if (kaRes.attempted && kaRes.message) {
      state = {
        ...state,
        recentEvents: appendCloudEvent(state.recentEvents, 'cron', `Auto-Ping VPS 2: ${kaRes.message}`, nowSecs),
      };
    }
    await writeStateFn(state);
    return {
      configured: true,
      state: machine.state,
      keepalive: kaSummary,
      autoResume: { attempted: false, reason: 'already_running' },
    };
  }

  if (!state.autoResumeEnabled) {
    await writeStateFn(state);
    return {
      configured: true,
      state: machine.state,
      keepalive: kaSummary,
      autoResume: { attempted: false, reason: 'manual_mode' },
    };
  }
  if (avail !== 'down') {
    await writeStateFn(state);
    return {
      configured: true,
      state: machine.state,
      keepalive: kaSummary,
      autoResume: { attempted: false, reason: 'transient' },
    };
  }
  if (state.cooldownUntilEpoch && state.cooldownUntilEpoch > nowSecs) {
    await writeStateFn(state);
    return {
      configured: true,
      state: machine.state,
      keepalive: kaSummary,
      autoResume: { attempted: false, reason: 'cooldown' },
    };
  }
  if (state.lastResumeAttemptAt && nowSecs - state.lastResumeAttemptAt < MIN_CRON_RESUME_INTERVAL_SECS) {
    await writeStateFn(state);
    return {
      configured: true,
      state: machine.state,
      keepalive: kaSummary,
      autoResume: { attempted: false, reason: 'rate_limited' },
    };
  }

  const res = await triggerInstaboxResume(machine.state, {
    apiKey: creds.apiKey,
    machineId: creds.machineId,
    apiBase: creds.apiBase,
    fetchImpl: deps.fetchImpl,
    nowMs,
  });

  if (res.ok) {
    const msg = `Auto-Resume VPS 2 (Cron) diterima (${res.actionUsed}, HTTP ${res.status}). Menunggu aktif...`;
    state = {
      ...state,
      cooldownUntilEpoch: null,
      consecutiveResumeFailures: 0,
      lastResumeAttemptAt: nowSecs,
      lastResumeSource: 'cron',
      lastResumeMessage: msg,
      recentEvents: appendCloudEvent(state.recentEvents, 'cron', msg, nowSecs),
    };
    await writeStateFn(state);
    return {
      configured: true,
      state: machine.state,
      keepalive: kaSummary,
      autoResume: { attempted: true, ok: true, message: msg },
    };
  }

  const backoffSecs = computeAutoResumeBackoffSecs(res.err, state.consecutiveResumeFailures);
  const msg = `Auto-Resume VPS 2 (Cron) gagal: ${res.err.message}`;
  state = {
    ...state,
    cooldownUntilEpoch: nowSecs + backoffSecs,
    consecutiveResumeFailures: state.consecutiveResumeFailures + 1,
    lastResumeAttemptAt: nowSecs,
    lastResumeSource: 'cron',
    lastResumeMessage: msg,
    recentEvents: appendCloudEvent(state.recentEvents, 'cron', msg, nowSecs),
  };
  await writeStateFn(state);
  return {
    configured: true,
    state: machine.state,
    keepalive: kaSummary,
    autoResume: {
      attempted: true,
      ok: false,
      reason: res.err.isCooldown ? 'cooldown' : 'error',
      message: msg,
    },
  };
}
