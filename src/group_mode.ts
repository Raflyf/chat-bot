/**
 * ENGINE MODE GRUP BERSAMA — WhatsApp Baileys & Telegram.
 *
 * Mengelola 3 mode per-grup:
 *   - 'mention' (default): balas saat @mention, reply pesan bot, kata panggil natural, atau follow-up 75 detik.
 *   - 'nimbrung'          : ikut nimbrung obrolan bermakna (skip 1 kata kosong & @orang lain, jeda anti-spam 5s),
 *                           dan otomatis kembali ke 'mention' bila grup sepi 30 menit.
 *   - 'diam'              : senyap total di grup (dikunci oleh admin grup atau owner bot).
 *
 * Juga menyediakan passive listening buffer (15 pesan / TTL 30 menit per grup) agar bot nyambung saat dipanggil.
 */
import { db } from './db.js';

export type GroupMode = 'mention' | 'nimbrung' | 'diam';

export interface GroupModeRecord {
  mode: GroupMode;
  lockedByAdmin: boolean;
  updatedAt: number;
  updatedBy?: string;
  lastGroupActivityAt: number;
  lastBotReplyAt: number;
}

export type GroupCommandKind = 'nimbrung' | 'mention' | 'diam' | 'status';

export interface GroupEvaluationInput {
  mode: GroupMode;
  text: string;
  actorId?: string;
  isMentioned: boolean;
  isReplyToBot: boolean;
  isTargetedCommand: boolean;
  isSlashPanggil?: boolean;
  hasWakeWord: boolean;
  wakeCleanedText?: string;
  hasMedia?: boolean;
  hasSticker?: boolean;
  mentionsOtherOnly?: boolean;
  inFollowUpWindow?: boolean;
  botUsername?: string;
  nowMs?: number;
  lastBotReplyAt?: number;
}

export interface GroupEvaluationResult {
  action: 'mode_command' | 'reply' | 'passive_ignore' | 'silent_ignore';
  command?: GroupCommandKind;
  reason?: string;
  cleanedText: string;
  shouldSetFollowUp: boolean;
}

export const GROUP_MODE_STATE_FILENAME = '__group_mode_state.json';
export const NIMBRUNG_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
export const NIMBRUNG_COOLDOWN_MS = 5_000;
export const FOLLOW_UP_WINDOW_MS = 75_000;
export const PASSIVE_BUFFER_MAX = 15;
export const PASSIVE_BUFFER_TTL_MS = 30 * 60 * 1000;

const STATE_SYNC_TTL_MS = 15_000;
const ACTIVITY_PERSIST_INTERVAL_MS = 2 * 60 * 1000;
const MAX_PASSIVE_GROUPS = 200;

interface PassiveMsg {
  sender: string;
  text: string;
  at: number;
}

const modeCache = new Map<string, GroupModeRecord>();
const followUpMap = new Map<string, number>();
const passiveBuffers = new Map<string, PassiveMsg[]>();

let hydratedAtMs = 0;
let hydratingPromise: Promise<void> | null = null;
let persistingPromise: Promise<void> | null = null;
let lastActivityPersistMs = 0;

function defaultRecord(nowMs: number): GroupModeRecord {
  return {
    mode: 'mention',
    lockedByAdmin: false,
    updatedAt: nowMs,
    lastGroupActivityAt: nowMs,
    lastBotReplyAt: 0,
  };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function followUpKey(groupKey: string, actorId: string): string {
  return `${groupKey}::${actorId}`;
}

export function resetGroupModeUntukTest(): void {
  modeCache.clear();
  followUpMap.clear();
  passiveBuffers.clear();
  hydratedAtMs = 0;
  hydratingPromise = null;
  persistingPromise = null;
  lastActivityPersistMs = 0;
}

async function hydrateFromDbIfNeeded(nowMs = Date.now()): Promise<void> {
  if (nowMs - hydratedAtMs < STATE_SYNC_TTL_MS) return;
  if (hydratingPromise) return hydratingPromise;
  const c = db();
  if (!c) {
    hydratedAtMs = nowMs;
    return;
  }
  hydratingPromise = (async () => {
    try {
      const { data, error } = await c
        .from('whatsapp_sessions')
        .select('content')
        .eq('filename', GROUP_MODE_STATE_FILENAME)
        .maybeSingle();
      if (!error && data?.content) {
        const parsed = JSON.parse(String(data.content)) as Record<string, Partial<GroupModeRecord>>;
        if (parsed && typeof parsed === 'object') {
          for (const [k, raw] of Object.entries(parsed)) {
            if (!raw || typeof raw !== 'object') continue;
            const mode: GroupMode =
              raw.mode === 'nimbrung' || raw.mode === 'diam' || raw.mode === 'mention'
                ? raw.mode
                : 'mention';
            const local = modeCache.get(k);
            const remoteUpdated = Number(raw.updatedAt || 0);
            if (!local || remoteUpdated >= local.updatedAt) {
              modeCache.set(k, {
                mode,
                lockedByAdmin: Boolean(raw.lockedByAdmin),
                updatedAt: remoteUpdated || nowMs,
                updatedBy: typeof raw.updatedBy === 'string' ? raw.updatedBy : undefined,
                lastGroupActivityAt: Number(raw.lastGroupActivityAt || remoteUpdated || nowMs),
                lastBotReplyAt: Number(raw.lastBotReplyAt || 0),
              });
            }
          }
        }
      }
      hydratedAtMs = Date.now();
    } catch {
      hydratedAtMs = Date.now();
    } finally {
      hydratingPromise = null;
    }
  })();
  return hydratingPromise;
}

async function persistModeStateToDb(): Promise<void> {
  const c = db();
  if (!c) return;
  if (persistingPromise) await persistingPromise.catch(() => undefined);
  const snapshot: Record<string, GroupModeRecord> = {};
  const entries = Array.from(modeCache.entries()).slice(-300);
  for (const [k, v] of entries) {
    snapshot[k] = v;
  }
  persistingPromise = (async () => {
    try {
      await c.from('whatsapp_sessions').upsert({
        filename: GROUP_MODE_STATE_FILENAME,
        content: JSON.stringify(snapshot),
        updated_at: new Date().toISOString(),
      });
    } catch (err) {
      console.warn('[group-mode] Gagal simpan state grup ke DB:', String((err as Error)?.message ?? err).slice(0, 120));
    } finally {
      persistingPromise = null;
    }
  })();
  await persistingPromise;
}

export async function getGroupModeRecord(
  groupKey: string,
  nowMs = Date.now(),
): Promise<{ record: GroupModeRecord; autoReverted: boolean }> {
  await hydrateFromDbIfNeeded(nowMs);
  let rec = modeCache.get(groupKey);
  if (!rec) {
    rec = defaultRecord(nowMs);
    modeCache.set(groupKey, rec);
  }
  let autoReverted = false;
  if (
    rec.mode === 'nimbrung' &&
    rec.lastGroupActivityAt > 0 &&
    nowMs - rec.lastGroupActivityAt >= NIMBRUNG_IDLE_TIMEOUT_MS
  ) {
    rec = {
      ...rec,
      mode: 'mention',
      lockedByAdmin: false,
      updatedAt: nowMs,
      updatedBy: 'auto_idle_timeout',
    };
    modeCache.set(groupKey, rec);
    autoReverted = true;
    void persistModeStateToDb();
  }
  return { record: { ...rec }, autoReverted };
}

export async function setGroupMode(
  groupKey: string,
  nextMode: GroupMode,
  opts: {
    actorId?: string;
    actorName?: string;
    isAdminOrOwner?: boolean;
    nowMs?: number;
  } = {},
): Promise<{ ok: boolean; reason?: 'admin_only' | 'locked_by_admin'; record: GroupModeRecord }> {
  const nowMs = opts.nowMs ?? Date.now();
  const { record: current } = await getGroupModeRecord(groupKey, nowMs);

  if (nextMode === 'diam' && !opts.isAdminOrOwner) {
    return { ok: false, reason: 'admin_only', record: current };
  }
  if (current.mode === 'diam' && current.lockedByAdmin && nextMode !== 'diam' && !opts.isAdminOrOwner) {
    return { ok: false, reason: 'locked_by_admin', record: current };
  }

  const updated: GroupModeRecord = {
    ...current,
    mode: nextMode,
    lockedByAdmin: nextMode === 'diam',
    updatedAt: nowMs,
    updatedBy: opts.actorName || opts.actorId || current.updatedBy,
    lastGroupActivityAt: nowMs,
  };
  modeCache.set(groupKey, updated);

  if (nextMode === 'diam') {
    for (const k of Array.from(followUpMap.keys())) {
      if (k.startsWith(`${groupKey}::`)) followUpMap.delete(k);
    }
  }
  await persistModeStateToDb();
  return { ok: true, record: { ...updated } };
}

export function touchGroupActivity(groupKey: string, nowMs = Date.now()): void {
  const rec = modeCache.get(groupKey) ?? defaultRecord(nowMs);
  rec.lastGroupActivityAt = nowMs;
  modeCache.set(groupKey, rec);
  if (nowMs - lastActivityPersistMs >= ACTIVITY_PERSIST_INTERVAL_MS) {
    lastActivityPersistMs = nowMs;
    void persistModeStateToDb();
  }
}

export function markGroupBotReply(
  groupKey: string,
  actorId?: string,
  nowMs = Date.now(),
  setFollowUp = true,
): void {
  const rec = modeCache.get(groupKey) ?? defaultRecord(nowMs);
  rec.lastBotReplyAt = nowMs;
  rec.lastGroupActivityAt = nowMs;
  modeCache.set(groupKey, rec);
  if (setFollowUp && actorId) {
    followUpMap.set(followUpKey(groupKey, actorId), nowMs + FOLLOW_UP_WINDOW_MS);
    if (followUpMap.size > 500) {
      for (const [k, exp] of followUpMap.entries()) {
        if (exp <= nowMs) followUpMap.delete(k);
      }
    }
  }
}

export function isInFollowUpWindow(
  groupKey: string,
  actorId?: string,
  nowMs = Date.now(),
): boolean {
  if (!actorId) return false;
  const k = followUpKey(groupKey, actorId);
  const exp = followUpMap.get(k);
  if (!exp) return false;
  if (nowMs >= exp) {
    followUpMap.delete(k);
    return false;
  }
  return true;
}

export function clearFollowUpWindow(groupKey: string, actorId?: string): void {
  if (!actorId) return;
  followUpMap.delete(followUpKey(groupKey, actorId));
}

export function recordPassiveGroupMessage(
  groupKey: string,
  senderName: string,
  text: string,
  nowMs = Date.now(),
): void {
  const cleanText = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!cleanText) return;
  const cleanSender = String(senderName ?? 'Anggota').replace(/\s+/g, ' ').trim().slice(0, 40) || 'Anggota';

  let buf = passiveBuffers.get(groupKey) ?? [];
  buf = buf.filter((item) => nowMs - item.at <= PASSIVE_BUFFER_TTL_MS);
  buf.push({
    sender: cleanSender,
    text: cleanText.slice(0, 280),
    at: nowMs,
  });
  if (buf.length > PASSIVE_BUFFER_MAX) {
    buf = buf.slice(-PASSIVE_BUFFER_MAX);
  }
  passiveBuffers.set(groupKey, buf);

  if (passiveBuffers.size > MAX_PASSIVE_GROUPS) {
    const oldestKey = passiveBuffers.keys().next().value;
    if (oldestKey) passiveBuffers.delete(oldestKey);
  }
}

export function peekPassiveGroupContext(groupKey: string, nowMs = Date.now()): string {
  const buf = (passiveBuffers.get(groupKey) ?? []).filter((item) => nowMs - item.at <= PASSIVE_BUFFER_TTL_MS);
  if (buf.length === 0) return '';
  const lines = buf.map((item) => `- ${item.sender}: ${item.text}`);
  return `[Konteks obrolan grup sebelumnya yang kamu dengar diam-diam:\n${lines.join('\n')}]`;
}

export function consumePassiveGroupContext(groupKey: string, nowMs = Date.now()): string {
  const ctxText = peekPassiveGroupContext(groupKey, nowMs);
  passiveBuffers.delete(groupKey);
  return ctxText;
}

/**
 * Deteksi kata panggil natural di awal pesan (mis. "bot ...", "oi bot ...", "freeaibot ...")
 * atau slash/bang (/ai, /tanya, !bot, !ai) serta sapaan di akhir (", bot?").
 */
export function deteksiPanggilanNatural(
  text: string,
  extraNames: string[] = [],
): { dipanggil: boolean; bersih: string } {
  const raw = String(text ?? '').trim();
  if (!raw) return { dipanggil: false, bersih: '' };

  const names = ['bot', 'freeaibot\\s*2', 'freeaibot', 'ai', ...extraNames.filter(Boolean).map(escapeRegExp)];
  const nameAlt = names.join('|');

  // 1. Prefix eksplisit !bot / !ai / /ai / /tanya
  const slashBang = raw.match(new RegExp(`^(?:\\/(?:ai|tanya)(?:@\\w+)?|!(?:${nameAlt}))(?:[,:!?\\s-]+([\\s\\S]*))?$`, 'i'));
  if (slashBang) {
    return { dipanggil: true, bersih: String(slashBang[1] ?? '').trim() };
  }

  // 2. Kata panggil natural di awal pesan: "(oi/eh/hai/...) bot ..." atau "FreeAIBot ..."
  const leadPrefix = new RegExp(
    `^(?:(?:oi|woi|woy|eh|hey|hei|hai|halo|helo|bang|bro|min|cuy|tolong|coba)\\s+)?(?:${nameAlt})\\b(?:[,:!?\\s-]+([\\s\\S]*))?$`,
    'i',
  );
  const mLead = raw.match(leadPrefix);
  if (mLead) {
    const rest = String(mLead[1] ?? '').trim();
    // Hindari menangkap kalimat bahasa Inggris "ai ..." yang tidak punya pemisah koma/tanda baca atau bukan panggilan?
    // "ai" atau "bot" diikuti tanya/perintah biasanya memang ditujukan ke AI; tetap cek jika "ai" berdiri sebagai kata kerja ("bot" aman).
    return { dipanggil: true, bersih: rest };
  }

  // 3. Panggilan di akhir kalimat: "harga emas sekarang berapa, bot?" (minimal 2 kata sebelum koma/spasi + nama)
  const tailRe = new RegExp(`^([\\s\\S]+?)[,\\s]+(?:${nameAlt})[?.!]*$`, 'i');
  const mTail = raw.match(tailRe);
  if (mTail) {
    const before = String(mTail[1] ?? '').trim();
    const wordsBefore = before.split(/\s+/).filter(Boolean);
    if (wordsBefore.length >= 2) {
      return { dipanggil: true, bersih: before };
    }
  }

  return { dipanggil: false, bersih: raw };
}

/**
 * Deteksi perintah pergantian/cek mode grup baik lewat slash command (/nimbrung, /mention, /diam, /statusgrup)
 * maupun frasa natural (hanya bila ditujukan ke bot atau bot sedang dalam mode nimbrung).
 */
export function deteksiPerintahModeGrup(
  text: string,
  opts: {
    isDirected: boolean;
    currentMode: GroupMode;
    botUsername?: string;
  },
): GroupCommandKind | null {
  const raw = String(text ?? '').trim();
  if (!raw) return null;

  // 1. Slash / bang commands (selalu aktif)
  const mCmd = raw.match(/^[\/!](nimbrung|mention|stopnimbrung|stop|diam|mute|statusgrup)(?:@([a-zA-Z0-9_]+))?(?:\s|$)/i);
  if (mCmd) {
    const cmd = mCmd[1].toLowerCase();
    const targetBot = mCmd[2]?.toLowerCase();
    if (targetBot && opts.botUsername && targetBot !== opts.botUsername.toLowerCase()) {
      return null;
    }
    if (cmd === 'nimbrung') return 'nimbrung';
    if (cmd === 'mention' || cmd === 'stopnimbrung' || cmd === 'stop') return 'mention';
    if (cmd === 'diam' || cmd === 'mute') return 'diam';
    if (cmd === 'statusgrup') return 'status';
  }

  // 2. Bahasa natural: hanya aktif jika pesan ditujukan ke bot ATAU bot sedang mode nimbrung
  if (!opts.isDirected && opts.currentMode !== 'nimbrung') {
    return null;
  }

  const lower = raw.toLowerCase().replace(/\s+/g, ' ').trim();
  // Guard negasi umum ("jangan berhenti nimbrung", "gak usah diam")
  const hasNegasi = /\b(?:jangan|jgn|gak\s+usah|ga\s+usah|tidak\s+usah|tdk\s+usah)\b/.test(lower);
  if (hasNegasi) return null;

  // Cek "berhenti nimbrung" / "stop nimbrung" / "balas pas ditag" SEBELUM "nimbrung"
  if (
    /\b(?:berhenti|stop|udah|sudah|cukup|matikan|nonaktifkan|selesai)\s+(?:nimbrung|nyambung|ngobrol|ikutan)\b/.test(lower) ||
    /\bbalas\s+(?:pas|kalau|klo|jika|saat)\s+(?:di\s*)?(?:tag|mention|reply)\s*(?:aja|saja)?\b/.test(lower) ||
    /\bmode\s+mention\b/.test(lower) ||
    /\b(?:tunggu|nunggu)\s+(?:di\s*)?(?:tag|mention)\b/.test(lower)
  ) {
    return 'mention';
  }

  if (
    /\bmode\s+diam\b/.test(lower) ||
    /\b(?:bot\s+)?(?:diam|diem|hening|senyap|mute)\s+(?:total|dulu|sekarang|ya|dong|deh|saja|aja)?\b/.test(lower) &&
      !/\b(?:jangan|kenapa|kok)\b/.test(lower) &&
      lower.split(/\s+/).length <= 5
  ) {
    return 'diam';
  }

  if (
    /\b(?:ikut(?:an)?\s+nimbrung|nimbrung\s+(?:terus|aja|saja|dong|yuk|ya)|gabung\s+nimbrung|mode\s+nimbrung|terus\s+(?:nimbrung|membalas|balas)\s+di\s+grup|nyalakan\s+nimbrung|aktif(?:kan)?\s+nimbrung)\b/.test(lower)
  ) {
    return 'nimbrung';
  }

  if (/^(?:status\s+grup|mode\s+grup|cek\s+mode(?:\s+grup)?)\??$/.test(lower)) {
    return 'status';
  }

  return null;
}

const FILLER_REGEX = /^(?:p+|o+k+|o+k+e+y*|o+k+e+h+|y+|y+a+|i+y+a+|y+a+p+|y+e+p+|s+i+p+|s+i+a+p+|w+k+(?:w+k+)*|k+w+(?:k+w+)*|h+(?:a+h+a+|e+h+e+|i+h+i+|u+h+u+)+|l+o+l+|l+m+a+o+|a+n+j+i+r+|n+j+i+r+|b+j+i+r+|j+i+r+|g+a+s+|g+a+s+k+e+u+n+|m+a+n+t+a+p+|n+i+c+e+|m+a+k+a+s+i+h+|t+h+a+n+k+s+|t+h+x+|t+y+|t+q+|h+m+|e+h+|o+h+|n+a+h+|l+a+h+|d+e+h+|s+i+h+|d+o+n+e+|n+o+t+e+d+|h+a+d+i+r+|t+e+s+|t+e+s+t+|c+e+k+)$/i;

export function adalahPesanBasaBasiPenutup(text: string): boolean {
  const s = String(text ?? '').trim();
  if (!s) return true;
  // Hanya emoji / tanda baca / angka pendek
  const stripped = s.replace(/[\p{P}\p{S}\s]+/gu, '');
  if (!stripped) return true;
  if (FILLER_REGEX.test(stripped)) return true;
  // Dua kata basa-basi super umum (mis. "ok sip", "makasih banyak", "sip deh")
  if (/^(?:ok|oke|sip|siap|makasih|thanks|thx|mantap|iya|ya)\s+(?:sip|deh|banget|banyak|yah?|min|bro|bot|mas|kak)[!.?]*$/i.test(s)) {
    return true;
  }
  return false;
}

export function adalahPesanLayakNimbrung(
  text: string,
  opts: { mentionsOtherOnly?: boolean } = {},
): boolean {
  if (opts.mentionsOtherOnly) return false;
  const clean = String(text ?? '').trim();
  if (!clean) return false;
  if (adalahPesanBasaBasiPenutup(clean)) return false;
  if (clean.includes('?')) return true;
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length >= 2) return true;
  return clean.length >= 10;
}

export function evaluasiResponGrup(input: GroupEvaluationInput): GroupEvaluationResult {
  const nowMs = input.nowMs ?? Date.now();
  const raw = String(input.text ?? '').trim();
  const baseCleaned = String(input.wakeCleanedText ?? raw).trim();
  const isExplicitDirect = Boolean(
    input.isMentioned ||
    input.isReplyToBot ||
    input.isTargetedCommand ||
    input.isSlashPanggil ||
    input.hasWakeWord,
  );

  // 1. Cek perintah mode grup (/nimbrung, /mention, /diam, /statusgrup, atau natural)
  const modeCmd = deteksiPerintahModeGrup(baseCleaned || raw, {
    isDirected: isExplicitDirect,
    currentMode: input.mode,
    botUsername: input.botUsername,
  });
  if (!modeCmd && raw !== baseCleaned) {
    const modeCmdRaw = deteksiPerintahModeGrup(raw, {
      isDirected: isExplicitDirect,
      currentMode: input.mode,
      botUsername: input.botUsername,
    });
    if (modeCmdRaw) {
      return {
        action: 'mode_command',
        command: modeCmdRaw,
        cleanedText: baseCleaned,
        shouldSetFollowUp: false,
      };
    }
  }
  if (modeCmd) {
    return {
      action: 'mode_command',
      command: modeCmd,
      cleanedText: baseCleaned,
      shouldSetFollowUp: false,
    };
  }

  // 2. Mode 'diam': selalu senyap & tidak merekam passive context
  if (input.mode === 'diam') {
    return {
      action: 'silent_ignore',
      reason: 'mode_diam',
      cleanedText: baseCleaned,
      shouldSetFollowUp: false,
    };
  }

  // 3. Mode 'mention'
  if (input.mode === 'mention') {
    if (isExplicitDirect) {
      return {
        action: 'reply',
        reason: 'direct_invocation',
        cleanedText: baseCleaned,
        shouldSetFollowUp: true,
      };
    }
    if (input.inFollowUpWindow) {
      if (input.mentionsOtherOnly || (raw && adalahPesanBasaBasiPenutup(raw)) || input.hasSticker) {
        return {
          action: 'passive_ignore',
          reason: 'followup_ended_by_filler_or_other',
          cleanedText: baseCleaned,
          shouldSetFollowUp: false,
        };
      }
      if (raw || input.hasMedia) {
        return {
          action: 'reply',
          reason: 'follow_up_window',
          cleanedText: baseCleaned,
          shouldSetFollowUp: true,
        };
      }
    }
    return {
      action: 'passive_ignore',
      reason: 'awaiting_mention',
      cleanedText: baseCleaned,
      shouldSetFollowUp: false,
    };
  }

  // 4. Mode 'nimbrung' (smart)
  if (isExplicitDirect) {
    return {
      action: 'reply',
      reason: 'direct_in_nimbrung',
      cleanedText: baseCleaned,
      shouldSetFollowUp: true,
    };
  }

  // Stiker acak di grup saat nimbrung dilewati kecuali me-reply bot langsung
  if (input.hasSticker && !raw) {
    return {
      action: 'passive_ignore',
      reason: 'nimbrung_skip_random_sticker',
      cleanedText: baseCleaned,
      shouldSetFollowUp: false,
    };
  }

  if (input.mentionsOtherOnly) {
    return {
      action: 'passive_ignore',
      reason: 'nimbrung_mentions_other',
      cleanedText: baseCleaned,
      shouldSetFollowUp: false,
    };
  }

  if (raw && !adalahPesanLayakNimbrung(raw, { mentionsOtherOnly: input.mentionsOtherOnly })) {
    return {
      action: 'passive_ignore',
      reason: 'nimbrung_skip_filler',
      cleanedText: baseCleaned,
      shouldSetFollowUp: false,
    };
  }

  if (!raw && !input.hasMedia) {
    return {
      action: 'passive_ignore',
      reason: 'empty',
      cleanedText: baseCleaned,
      shouldSetFollowUp: false,
    };
  }

  const lastReplyAt = input.lastBotReplyAt ?? 0;
  if (lastReplyAt > 0 && nowMs - lastReplyAt < NIMBRUNG_COOLDOWN_MS) {
    return {
      action: 'passive_ignore',
      reason: 'nimbrung_cooldown',
      cleanedText: baseCleaned,
      shouldSetFollowUp: false,
    };
  }

  return {
    action: 'reply',
    reason: 'nimbrung_active',
    cleanedText: baseCleaned,
    shouldSetFollowUp: false,
  };
}

export function formatStatusModeGrup(record: GroupModeRecord, nowMs = Date.now()): string {
  const label =
    record.mode === 'nimbrung'
      ? '*NIMBRUNG AKTIF* (ikut ngobrol otomatis, auto-reset ke mention bila grup sepi 30 menit)'
      : record.mode === 'diam'
        ? '*DIAM* (senyap total — terkunci admin/owner)'
        : '*MENTION* (membalas saat di-tag, reply, panggil "bot ...", atau follow-up 75 detik)';

  const extra: string[] = [];
  if (record.mode === 'nimbrung' && record.lastGroupActivityAt > 0) {
    const sisaMin = Math.max(0, Math.ceil((NIMBRUNG_IDLE_TIMEOUT_MS - (nowMs - record.lastGroupActivityAt)) / 60_000));
    extra.push(`Sisa idle auto-mention: ~${sisaMin} menit`);
  }
  if (record.updatedBy && record.updatedBy !== 'auto_idle_timeout') {
    extra.push(`Diubah oleh: ${record.updatedBy}`);
  }
  return [
    `Status mode grup: ${label}`,
    ...extra,
    '',
    'Perintah: `/nimbrung` | `/mention` | `/diam` (admin/owner) | `/statusgrup`',
  ].join('\n');
}
