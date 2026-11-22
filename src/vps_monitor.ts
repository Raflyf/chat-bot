/**
 * MONITOR LIFECYCLE VPS BAILEYS (PASSIVE & COMPLIANT)
 *
 * Memantau batas runtime maksimum (mis. 120 menit pada InstaBox Free Plan) dan
 * perubahan status VPS (paused/stopped/pulih). Modul ini SENDIRI tidak pernah
 * mengirim aktivitas ke dalam VM — anti auto-pause ditangani modul terpisah
 * `src/vps_keepalive.ts` lewat lease aktivitas di control plane (bukan terminal
 * I/O palsu ke dalam sandbox).
 *
 * Dua jalur kerja:
 *   1. Monitor eksternal pasif (dipanggil cron /api/cron/reminders via GitHub Actions):
 *      memanggil endpoint kontrol read-only GET /v1/machines/{id}, mengevaluasi
 *      sisa waktu sebelum batas runtime (default 5 menit sebelumnya) dan transisi
 *      status running <-> paused/stopped, lalu mengirim notifikasi ke Telegram
 *      pemilik dengan deduplikasi state di Supabase (`whatsapp_sessions`).
 *   2. Sinyal proses lokal (src/whatsapp_baileys.ts):
 *      - Hook SIGINT/SIGTERM (`laporShutdownVps`) agar penghentian terencana tetap
 *        terlaporkan cepat sebelum proses keluar.
 *      - Satu timer one-shot pasif (`mulaiTimerPeringatanLokalVps`) sebagai fallback
 *        bila INSTABOX_API_KEY tidak dipasang di Vercel.
 */
import { db } from './db.js';
import { config } from './env.js';

export const STATE_FILENAME = '__vps_monitor_state.json';

const STATE_DOWN = new Set([
  'paused',
  'stopped',
  'suspended',
  'off',
  'terminated',
  'error',
  'failed',
]);

const EXTERNAL_MONITOR_FRESH_MS = 15 * 60 * 1000;
const SHUTDOWN_REPORT_TIMEOUT_MS = 4000;

export interface InstaboxMachineSnapshot {
  id: string;
  name?: string;
  state: string;
  runStartedAt: string | null;
  maxRunMinutes: number | null;
  /** Jendela idle sebelum auto-suspend (detik). Free plan: 1800 = 30 menit. */
  autoSuspendAfterSeconds: number | null;
  cooldownUntil: string | null;
  free?: boolean;
}

export interface VpsMonitorState {
  last_state: string | null;
  last_run_started_at: string | null;
  warned_run_started_at: string | null;
  down_notified_at: string | null;
  last_checked_at: string | null;
  last_shutdown_at: string | null;
}

export interface VpsMonitorEvent {
  tipe: 'peringatan_limit' | 'vps_mati' | 'vps_pulih';
  pesanHtml: string;
  pesanPolos: string;
  sisaMenit?: number;
}

export interface CekLifecycleDeps {
  fetchImpl?: typeof fetch;
  nowMs?: number;
  sendTelegram?: (pesanHtml: string) => Promise<boolean>;
  sendWaCloud?: (pesanPolos: string) => Promise<boolean>;
  readState?: () => Promise<VpsMonitorState | null>;
  writeState?: (state: VpsMonitorState) => Promise<void>;
  apiKey?: string;
  machineId?: string;
  apiBase?: string;
  warnBeforeMinutes?: number;
  /** Callback opsional: snapshot mesin hasil GET, dipakai keepalive cron. */
  onMachine?: (machine: InstaboxMachineSnapshot) => void;
}

export interface CekLifecycleResult {
  checked: boolean;
  state: string | null;
  events: Array<VpsMonitorEvent['tipe']>;
  skipped?: 'not_configured' | 'fetch_error' | 'invalid_payload';
}

let memState: VpsMonitorState | null = null;

/** Reset cache in-memory untuk isolasi unit test. */
export function resetVpsMonitorUntukTest(): void {
  memState = null;
}

export function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function formatWaktuWib(msOrIso: number | string): string {
  const ms = typeof msOrIso === 'number' ? msOrIso : Date.parse(msOrIso);
  if (!Number.isFinite(ms)) return String(msOrIso);
  try {
    const parts = new Intl.DateTimeFormat('id-ID', {
      timeZone: 'Asia/Jakarta',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(new Date(ms));
    const map: Record<string, string> = {};
    for (const p of parts) map[p.type] = p.value;
    const hh = (map.hour || '00').padStart(2, '0');
    const mm = (map.minute || '00').padStart(2, '0');
    const dd = map.day || '';
    const mon = map.month || '';
    const yyyy = map.year || '';
    return `${hh}:${mm} WIB, ${dd} ${mon} ${yyyy}`.replace(/\s+/g, ' ').trim();
  } catch {
    return new Date(ms).toISOString();
  }
}

function asRecord(val: unknown): Record<string, unknown> | null {
  return val && typeof val === 'object' && !Array.isArray(val)
    ? (val as Record<string, unknown>)
    : null;
}

function cleanFieldStr(val: unknown): string {
  return typeof val === 'string' ? val.trim() : '';
}

function cleanNullableStr(val: unknown): string | null {
  if (typeof val !== 'string') return null;
  const trimmed = val.trim();
  return trimmed ? trimmed : null;
}

function cleanNullableNum(val: unknown): number | null {
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  if (typeof val === 'string' && val.trim() !== '') {
    const parsed = Number(val.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

/**
 * Normalisasi payload JSON dari GET /v1/machines/{id} (camelCase maupun snake_case).
 */
export function parseInstaboxMachine(
  raw: unknown,
  fallbackId = '',
): InstaboxMachineSnapshot | null {
  const root = asRecord(raw);
  if (!root) return null;
  const obj = asRecord(root.machine) ?? asRecord(root.data) ?? root;
  const state = cleanFieldStr(obj.state ?? obj.status);
  if (!state) return null;

  const id = cleanFieldStr(obj.id ?? obj.machine_id ?? obj.machineId) || fallbackId;
  const name = cleanFieldStr(obj.name) || undefined;

  return {
    id,
    ...(name ? { name } : {}),
    state,
    runStartedAt: cleanNullableStr(obj.runStartedAt ?? obj.run_started_at),
    maxRunMinutes: cleanNullableNum(obj.maxRunMinutes ?? obj.max_run_minutes),
    autoSuspendAfterSeconds: cleanNullableNum(
      obj.autoSuspendAfterSeconds ?? obj.auto_suspend_after_seconds,
    ),
    cooldownUntil: cleanNullableStr(obj.cooldownUntil ?? obj.cooldown_until),
    ...(typeof obj.free === 'boolean' ? { free: obj.free } : {}),
  };
}

function defaultState(): VpsMonitorState {
  return {
    last_state: null,
    last_run_started_at: null,
    warned_run_started_at: null,
    down_notified_at: null,
    last_checked_at: null,
    last_shutdown_at: null,
  };
}

function labelMesin(machine: InstaboxMachineSnapshot): { html: string; polos: string } {
  const polos =
    machine.name && machine.id
      ? `${machine.name} (${machine.id})`
      : machine.name || machine.id || 'freeaibot-wa';
  const html =
    machine.name && machine.id
      ? `<b>${escapeHtml(machine.name)}</b> (<code>${escapeHtml(machine.id)}</code>)`
      : `<code>${escapeHtml(polos)}</code>`;
  return { html, polos };
}

function alasanVpsMati(machine: InstaboxMachineSnapshot, nowMs: number): string {
  if (machine.cooldownUntil) {
    const maxMenit = machine.maxRunMinutes && machine.maxRunMinutes > 0 ? machine.maxRunMinutes : 120;
    return `mencapai batas runtime ${maxMenit} menit (cooldown sampai ${formatWaktuWib(machine.cooldownUntil)})`;
  }
  if (machine.runStartedAt && machine.maxRunMinutes && machine.maxRunMinutes > 0) {
    const startedMs = Date.parse(machine.runStartedAt);
    if (Number.isFinite(startedMs) && nowMs - startedMs >= Math.max(0, machine.maxRunMinutes - 5) * 60_000) {
      return `kemungkinan mencapai batas runtime ${machine.maxRunMinutes} menit`;
    }
  }
  return 'kemungkinan auto-suspend idle 30 menit tanpa aktivitas atau dihentikan manual';
}

/**
 * Fungsi murni untuk mengevaluasi transisi status VPS dan peringatan batas runtime.
 */
export function evaluasiStatusVps(
  machine: InstaboxMachineSnapshot,
  prevState: VpsMonitorState | null,
  nowMs = Date.now(),
  warnBeforeMinutes = 5,
): { events: VpsMonitorEvent[]; nextState: VpsMonitorState } {
  const prev = prevState ? { ...prevState } : defaultState();
  const state = machine.state.trim().toLowerCase();
  const nextState: VpsMonitorState = {
    ...prev,
    last_state: state || prev.last_state,
    last_run_started_at: machine.runStartedAt ?? prev.last_run_started_at,
    last_checked_at: new Date(nowMs).toISOString(),
  };

  const events: VpsMonitorEvent[] = [];
  const label = labelMesin(machine);
  const waktuSekarang = formatWaktuWib(nowMs);

  if (state === 'running') {
    if (prev.down_notified_at) {
      nextState.down_notified_at = null;
      const pesanPolos = `[VPS PULIH] ${label.polos} kembali aktif (running) pada ${waktuSekarang}. Layanan WA Baileys akan tersambung ulang otomatis.`;
      const pesanHtml =
        `<b>[VPS PULIH]</b>\n` +
        `Mesin: ${label.html}\n` +
        `Status: <code>running</code> pada ${escapeHtml(waktuSekarang)}\n` +
        `Layanan WhatsApp Baileys kembali aktif.`;
      events.push({ tipe: 'vps_pulih', pesanHtml, pesanPolos });
    }

    if (machine.maxRunMinutes !== null && machine.maxRunMinutes > 0 && machine.runStartedAt) {
      const startedMs = Date.parse(machine.runStartedAt);
      if (Number.isFinite(startedMs) && prev.warned_run_started_at !== machine.runStartedAt) {
        const limitMs = startedMs + machine.maxRunMinutes * 60_000;
        const sisaMs = limitMs - nowMs;
        if (sisaMs <= warnBeforeMinutes * 60_000) {
          nextState.warned_run_started_at = machine.runStartedAt;
          const sisaMenit = sisaMs > 0 ? Math.max(1, Math.ceil(sisaMs / 60_000)) : 0;
          const estimasiWib = formatWaktuWib(limitMs);

          const pesanPolos =
            sisaMenit > 0
              ? `[PERINGATAN LIMIT VPS] ${label.polos} tersisa sekitar ${sisaMenit} menit sebelum batas runtime ${machine.maxRunMinutes} menit (estimasi ${estimasiWib}). InstaBox dapat memperpanjang bila sedang aktif atau masuk mode pause dengan cooldown.`
              : `[PERINGATAN LIMIT VPS] ${label.polos} telah mencapai batas runtime ${machine.maxRunMinutes} menit (sejak ${estimasiWib}). VPS dapat masuk mode pause sewaktu-waktu dengan cooldown.`;

          const pesanHtml =
            sisaMenit > 0
              ? `<b>[PERINGATAN LIMIT VPS]</b>\n` +
                `Mesin: ${label.html}\n` +
                `Sisa waktu: ~${sisaMenit} menit sebelum batas runtime ${machine.maxRunMinutes} menit\n` +
                `Estimasi limit: ${escapeHtml(estimasiWib)}\n` +
                `Catatan: InstaBox dapat memperpanjang sesi bila aktif atau mem-pause sementara dengan cooldown.`
              : `<b>[PERINGATAN LIMIT VPS]</b>\n` +
                `Mesin: ${label.html}\n` +
                `Batas runtime ${machine.maxRunMinutes} menit telah tercapai (${escapeHtml(estimasiWib)}).\n` +
                `VPS dapat masuk mode pause sewaktu-waktu dengan cooldown.`;

          events.push({ tipe: 'peringatan_limit', pesanHtml, pesanPolos, sisaMenit });
        }
      }
    }
    return { events, nextState };
  }

  if (STATE_DOWN.has(state)) {
    if (!prev.down_notified_at) {
      nextState.down_notified_at = new Date(nowMs).toISOString();
      const penyebab = alasanVpsMati(machine, nowMs);
      const pesanPolos = `[VPS MATI] ${label.polos} berstatus ${state} pada ${waktuSekarang}. Penyebab: ${penyebab}.`;
      const pesanHtml =
        `<b>[VPS MATI]</b>\n` +
        `Mesin: ${label.html}\n` +
        `Status: <code>${escapeHtml(state)}</code> pada ${escapeHtml(waktuSekarang)}\n` +
        `Kemungkinan penyebab: ${escapeHtml(penyebab)}.`;
      events.push({ tipe: 'vps_mati', pesanHtml, pesanPolos });
    }
    return { events, nextState };
  }

  // Status transien (starting, resuming, creating, dsb.): pertahankan state terakhir tanpa notif duplikat.
  return { events, nextState };
}

export async function bacaStateMonitorVps(): Promise<VpsMonitorState | null> {
  const c = db();
  if (!c) return memState ? { ...memState } : null;
  try {
    const { data, error } = await c
      .from('whatsapp_sessions')
      .select('content')
      .eq('filename', STATE_FILENAME)
      .maybeSingle();

    if (error || !data?.content) {
      return memState ? { ...memState } : null;
    }
    const parsed = JSON.parse(String(data.content)) as Partial<VpsMonitorState>;
    const hydrated: VpsMonitorState = {
      ...defaultState(),
      ...parsed,
    };
    memState = hydrated;
    return { ...hydrated };
  } catch {
    return memState ? { ...memState } : null;
  }
}

export async function simpanStateMonitorVps(state: VpsMonitorState): Promise<void> {
  memState = { ...state };
  const c = db();
  if (!c) return;
  try {
    const { error } = await c.from('whatsapp_sessions').upsert({
      filename: STATE_FILENAME,
      content: JSON.stringify(state),
      updated_at: new Date().toISOString(),
    });
    if (error) {
      console.warn('[vps-monitor] Gagal simpan state ke Supabase:', error.message);
    }
  } catch (err) {
    console.warn('[vps-monitor] Exception simpan state:', String((err as Error)?.message ?? err).slice(0, 120));
  }
}

export async function kirimNotifTelegramPemilik(pesanHtml: string): Promise<boolean> {
  if (!config.telegramToken || !config.ownerChatId) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${config.telegramToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: config.ownerChatId,
        text: pesanHtml,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      console.warn(`[vps-monitor] Telegram API membalas HTTP ${res.status}.`);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[vps-monitor] Gagal kirim Telegram:', String((err as Error)?.message ?? err).slice(0, 120));
    return false;
  }
}

export async function kirimNotifWaCloudPemilik(pesanPolos: string): Promise<boolean> {
  if (config.whatsappMaintenanceMode) return false;
  let to = String(config.ownerWaNumber ?? '').trim().replace(/^\+/, '').replace(/\D/g, '');
  if (to.startsWith('0')) to = `62${to.slice(1)}`;
  if (!to || !config.whatsappToken || !config.whatsappPhoneNumberId) return false;

  try {
    const res = await fetch(
      `https://graph.facebook.com/v21.0/${config.whatsappPhoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.whatsappToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to,
          type: 'text',
          text: { preview_url: false, body: pesanPolos.slice(0, 4000) },
        }),
        signal: AbortSignal.timeout(8000),
      },
    );
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.warn(`[vps-monitor] WA Cloud API membalas HTTP ${res.status}: ${errText.slice(0, 120)}`);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[vps-monitor] Gagal kirim WA Cloud:', String((err as Error)?.message ?? err).slice(0, 120));
    return false;
  }
}

/**
 * Polling eksternal read-only ke InstaBox API (`GET /v1/machines/{id}`).
 * Tidak pernah memanggil `/exec`, `/activity-leases`, atau endpoint pengubah state.
 */
export async function cekLifecycleVps(deps: CekLifecycleDeps = {}): Promise<CekLifecycleResult> {
  const apiKey = (deps.apiKey ?? config.instaboxApiKey).trim();
  const machineId = (deps.machineId ?? config.instaboxMachineId).trim();
  if (!apiKey || !machineId) {
    return { checked: false, state: null, events: [], skipped: 'not_configured' };
  }

  const fetchImpl = deps.fetchImpl ?? fetch;
  const nowMs = deps.nowMs ?? Date.now();
  const sendTelegram = deps.sendTelegram ?? kirimNotifTelegramPemilik;
  const sendWaCloud = deps.sendWaCloud ?? (deps.sendTelegram ? async () => false : kirimNotifWaCloudPemilik);
  const readState = deps.readState ?? bacaStateMonitorVps;
  const writeState = deps.writeState ?? simpanStateMonitorVps;
  const apiBase = (deps.apiBase ?? config.instaboxApiBase).trim().replace(/\/+$/, '');
  const warnBeforeMinutes = deps.warnBeforeMinutes ?? config.vpsWarnBeforeMinutes;

  try {
    const url = `${apiBase}/v1/machines/${encodeURIComponent(machineId)}`;
    const res = await fetchImpl(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      console.warn(`[vps-monitor] GET /v1/machines membalas HTTP ${res.status}.`);
      return { checked: false, state: null, events: [], skipped: 'fetch_error' };
    }

    const raw = await res.json().catch(() => null);
    const machine = parseInstaboxMachine(raw, machineId);
    if (!machine) {
      console.warn('[vps-monitor] Payload status mesin InstaBox tidak valid.');
      return { checked: false, state: null, events: [], skipped: 'invalid_payload' };
    }

    try {
      deps.onMachine?.(machine);
    } catch {
      // callback tidak boleh mengganggu monitor lifecycle
    }

    const prevState = await readState();
    const { events, nextState } = evaluasiStatusVps(machine, prevState, nowMs, warnBeforeMinutes);

    for (const ev of events) {
      await Promise.allSettled([sendTelegram(ev.pesanHtml), sendWaCloud(ev.pesanPolos)]);
    }

    await writeState(nextState);
    return {
      checked: true,
      state: machine.state.trim().toLowerCase(),
      events: events.map((e) => e.tipe),
    };
  } catch (err) {
    console.warn('[vps-monitor] cekLifecycleVps error:', String((err as Error)?.message ?? err).slice(0, 120));
    return { checked: false, state: null, events: [], skipped: 'fetch_error' };
  }
}

/**
 * Laporan cepat saat proses WA Baileys menerima SIGINT / SIGTERM.
 * Dibatasi maksimal 4 detik agar systemd shutdown tidak tertahan.
 */
export async function laporShutdownVps(alasan: string): Promise<void> {
  const kerja = (async () => {
    try {
      const nowMs = Date.now();
      const nowIso = new Date(nowMs).toISOString();
      const prev = await bacaStateMonitorVps();
      if (!prev?.down_notified_at) {
        const waktuWib = formatWaktuWib(nowMs);
        const mesinId = config.instaboxMachineId || 'freeaibot-wa';
        const pesanHtml =
          `<b>[VPS MATI]</b>\n` +
          `Mesin: <code>${escapeHtml(mesinId)}</code>\n` +
          `Layanan WA Baileys dihentikan (<code>${escapeHtml(alasan)}</code>) pada ${escapeHtml(waktuWib)}.`;
        const pesanPolos = `[VPS MATI] ${mesinId} — Layanan WA Baileys dihentikan (${alasan}) pada ${waktuWib}.`;
        await Promise.allSettled([
          kirimNotifTelegramPemilik(pesanHtml),
          kirimNotifWaCloudPemilik(pesanPolos),
        ]);
      }

      const next: VpsMonitorState = {
        ...(prev ?? defaultState()),
        last_state: 'stopped',
        down_notified_at: prev?.down_notified_at ?? nowIso,
        last_shutdown_at: nowIso,
      };
      await simpanStateMonitorVps(next);
    } catch (err) {
      console.warn('[vps-monitor] Gagal lapor shutdown:', String((err as Error)?.message ?? err).slice(0, 120));
    }
  })();

  const batas = new Promise<void>((resolve) => {
    const t = setTimeout(resolve, SHUTDOWN_REPORT_TIMEOUT_MS);
    t.unref?.();
  });

  await Promise.race([kerja, batas]);
}

/**
 * Satu timer one-shot pasif di proses WA Baileys (TIDAK memakai setInterval/ping).
 * Berfungsi sebagai fallback peringatan 5 menit sebelum batas runtime bila monitor
 * eksternal InstaBox API belum dikonfigurasi.
 */
export function mulaiTimerPeringatanLokalVps(opts?: {
  kirimWaOwner?: (teks: string) => Promise<boolean>;
  maxRunMinutes?: number;
  warnBeforeMinutes?: number;
}): () => void {
  const maxRunMinutes = opts?.maxRunMinutes ?? config.vpsMaxRunMinutes;
  const warnBeforeMinutes = opts?.warnBeforeMinutes ?? config.vpsWarnBeforeMinutes;
  if (!Number.isFinite(maxRunMinutes) || maxRunMinutes <= 0 || maxRunMinutes <= warnBeforeMinutes) {
    return () => {};
  }

  const delayMs = (maxRunMinutes - warnBeforeMinutes) * 60_000;
  const runStartedIso = new Date().toISOString();

  const timer = setTimeout(() => {
    void (async () => {
      try {
        const nowMs = Date.now();
        const prev = await bacaStateMonitorVps();
        if (prev?.last_checked_at) {
          const ageMs = nowMs - Date.parse(prev.last_checked_at);
          if (Number.isFinite(ageMs) && ageMs >= 0 && ageMs < EXTERNAL_MONITOR_FRESH_MS) {
            return;
          }
        }

        const mesinId = config.instaboxMachineId || 'freeaibot-wa';
        const estimasiWib = formatWaktuWib(nowMs + warnBeforeMinutes * 60_000);
        const pesanPolos =
          `[PERINGATAN LIMIT VPS] ${mesinId} mendekati batas runtime ${maxRunMinutes} menit ` +
          `(tersisa sekitar ${warnBeforeMinutes} menit, estimasi ${estimasiWib}).`;
        const pesanHtml =
          `<b>[PERINGATAN LIMIT VPS]</b>\n` +
          `Mesin: <code>${escapeHtml(mesinId)}</code>\n` +
          `Sisa waktu: ~${warnBeforeMinutes} menit sebelum batas runtime ${maxRunMinutes} menit\n` +
          `Estimasi limit: ${escapeHtml(estimasiWib)}\n` +
          `Sumber: timer lokal proses Baileys.`;

        await Promise.allSettled([
          kirimNotifTelegramPemilik(pesanHtml),
          kirimNotifWaCloudPemilik(pesanPolos),
          ...(opts?.kirimWaOwner ? [opts.kirimWaOwner(pesanPolos)] : []),
        ]);

        const next: VpsMonitorState = {
          ...(prev ?? defaultState()),
          last_state: 'running',
          warned_run_started_at: prev?.warned_run_started_at ?? runStartedIso,
        };
        await simpanStateMonitorVps(next);
      } catch (err) {
        console.warn('[vps-monitor] Timer lokal error:', String((err as Error)?.message ?? err).slice(0, 120));
      }
    })();
  }, delayMs);

  timer.unref?.();
  return () => clearTimeout(timer);
}
