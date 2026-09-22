// Pelacak kuota harian per key (hybrid in-memory + Supabase provider_quota).
// Reset otomatis tiap tanggal UTC baru. 429 ikut dihitung agar pool berhenti.
// Sejak v0.27.13: juga melacak TOKEN harian (TPD) per key — limit Groq Free Tier
// (200K TPD) lebih cepat tercapai daripada RPD 1.000, jadi wajib dipantau agar
// pool tidak menabrak 429 sebelum RPD habis.

import crypto from 'crypto';
import { db } from './db.js';

export type ProviderKind = 'dahl' | 'groq' | 'gemini' | 'cloudflare' | 'openrouter' | 'xkiro';

interface Counter {
  date: string;
  count: number;
}

const counters = new Map<string, Counter>();

interface TokenCounter {
  date: string;
  tokens: number;
  /**
   * True bila `tokens` masih berupa ESTIMASI hidrasi (baris legacy yang calls-nya
   * tercatat sebelum pelacakan TPD aktif). Estimasi hanya menjaga sampai laporan
   * token riil pertama datang, lalu diganti angka riil — mencegah key sehat
   * ter-disable seharian karena estimasi berlebih (audit v19).
   */
  estimated?: boolean;
}

const tokenCounters = new Map<string, TokenCounter>();

/**
 * Estimasi konservatif token per panggilan untuk baris legacy yang calls-nya tercatat
 * sebelum pelacakan TPD aktif (tokens_used masih 0). Dipakai hanya saat hidrasi agar
 * guard TPD tetap efektif; nilai riil akan menimpa setelah panggilan berikutnya.
 */
const LEGACY_TOKENS_PER_CALL_ESTIMATE = 2500;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function keyHash(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 12);
}

function slot(kind: ProviderKind, key: string): Counter {
  // Prune tanggal usang jika map membesar
  if (counters.size > 200) {
    const t = today();
    for (const [k, v] of counters.entries()) {
      if (v.date !== t) counters.delete(k);
    }
  }

  const id = `${kind}:${keyHash(key)}`;
  const cur = counters.get(id);
  if (cur && cur.date === today()) return cur;
  const fresh: Counter = { date: today(), count: 0 };
  counters.set(id, fresh);
  return fresh;
}

function tokenSlot(kind: ProviderKind, key: string): TokenCounter {
  if (tokenCounters.size > 200) {
    const t = today();
    for (const [k, v] of tokenCounters.entries()) {
      if (v.date !== t) tokenCounters.delete(k);
    }
  }

  const id = `${kind}:${keyHash(key)}`;
  const cur = tokenCounters.get(id);
  if (cur && cur.date === today()) return cur;
  const fresh: TokenCounter = { date: today(), tokens: 0 };
  tokenCounters.set(id, fresh);
  return fresh;
}

/** Pemakaian token harian key (TPD) — untuk limit token per hari (mis. Groq 200K TPD). */
export function keyTokensUsedToday(kind: ProviderKind, key: string): number {
  return tokenSlot(kind, key).tokens;
}

/** Jumlah REQUEST harian key (RPD) — dipakai rotasi key agar beban merata antar key. */
export function keyRequestsUsedToday(kind: ProviderKind, key: string): number {
  return slot(kind, key).count;
}

const hydratedKeys = new Set<string>();
const pendingHydrations = new Map<string, Promise<void>>();

/** Prune tanda hidrasi hari lama (set tumbuh satu entri per key per hari). */
function pruneHydratedKeys(): void {
  if (hydratedKeys.size < 500) return;
  const t = today();
  for (const k of hydratedKeys) {
    // Format: kind:hash:YYYY-MM-DD
    if (!k.endsWith(t)) hydratedKeys.delete(k);
  }
}

/** Hydrate kuota pemakaian dari Supabase provider_quota saat instance baru aktif (C5 & P1-4) */
export async function hydrateKeyQuota(kind: ProviderKind, key: string): Promise<void> {
  const suffix = keyHash(key);
  const id = `${kind}:${suffix}`;
  const day = today();
  const cacheKey = `${id}:${day}`;
  pruneHydratedKeys();
  if (hydratedKeys.has(cacheKey)) return;

  if (pendingHydrations.has(cacheKey)) {
    return pendingHydrations.get(cacheKey)!;
  }

  const fetchPromise = (async () => {
    const c = db();
    if (!c) return;

    try {
      const { data, error } = await c
        .from('provider_quota')
        .select('used, tokens_used')
        .eq('kind', kind)
        .eq('key_suffix', suffix)
        .eq('day', day)
        .maybeSingle();

      if (!error) {
        if (data && typeof data.used === 'number') {
          const s = slot(kind, key);
          s.count = Math.max(s.count, data.used);
        }
        // Hydrate juga token harian (TPD) agar instance baru tahu pemakaian token sebelumnya.
        // Baris legacy (calls tercatat tapi tokens_used masih 0, dari sebelum pelacakan TPD aktif)
        // diberi estimasi konservatif SEMENTARA (estimated=true) agar guard TPD tetap efektif,
        // lalu diganti angka riil pada laporan token pertama (audit v19 — cegah disable keliru).
        if (data) {
          const rawTokens = Number((data as { tokens_used?: number }).tokens_used) || 0;
          const rawCalls = Number((data as { used?: number }).used) || 0;
          if (rawTokens > 0) {
            const ts = tokenSlot(kind, key);
            ts.tokens = Math.max(ts.tokens, rawTokens);
            ts.estimated = false;
          } else if (rawCalls > 0) {
            const ts = tokenSlot(kind, key);
            const estimate = rawCalls * LEGACY_TOKENS_PER_CALL_ESTIMATE;
            if (!ts.estimated || estimate > ts.tokens) {
              ts.tokens = Math.max(ts.tokens, estimate);
              ts.estimated = true;
            }
          }
        }
        // HANYA tandai hydrated setelah database query sukses (C5 & E8)
        hydratedKeys.add(cacheKey);
      }
    } catch {
      // best-effort, jika error jangan tandai hydrated agar bisa retry berikutnya
    } finally {
      pendingHydrations.delete(cacheKey);
    }
  })();

  pendingHydrations.set(cacheKey, fetchPromise);
  return fetchPromise;
}

/** Pastikan kuota key sudah terhidrasi sebelum dievaluasi (mencegah cold-start over-quota - C5 & E8). */
export async function ensureKeyQuotaHydrated(kind: ProviderKind, key: string): Promise<void> {
  const suffix = keyHash(key);
  const day = today();
  const cacheKey = `${kind}:${suffix}:${day}`;
  if (!hydratedKeys.has(cacheKey)) {
    await hydrateKeyQuota(kind, key);
  }
}

/**
 * Evaluasi izin pemakaian key secara async dengan jaminan hidrasi DB (C4).
 * Menghilangkan celah cold-start over-quota dan fire-and-forget race.
 * tokenCapPerDay > 0 mengaktifkan guard TPD (mis. Groq Free Tier 200K TPD).
 */
export async function isKeyAllowed(
  kind: ProviderKind,
  key: string,
  cap: number,
  tokenCapPerDay: number = 0,
): Promise<boolean> {
  await ensureKeyQuotaHydrated(kind, key);
  if (slot(kind, key).count >= cap) return false;
  if (tokenCapPerDay > 0 && tokenSlot(kind, key).tokens >= tokenCapPerDay) return false;
  return true;
}

/** Catat satu pemakaian sukses/gagal-terkirim (429 ikut dihitung agar pool berhenti). */
export function keyUsed(kind: ProviderKind, key: string): void {
  const s = slot(kind, key);
  s.count += 1;

  // Persistensi ke database Supabase (best-effort)
  const c = db();
  if (!c) return;
  const suffix = keyHash(key);
  const day = today();
  void (async () => {
    try {
      // Prioritas: Atomic RPC
      const { error } = await c.rpc('atomic_increment_provider_quota', {
        p_kind: kind,
        p_key_suffix: suffix,
        p_day: day,
        p_amount: 1,
      });
      if (!error) return;

      // Fallback: RMW upsert jika RPC belum di-deploy
      const { data } = await c
        .from('provider_quota')
        .select('used')
        .eq('kind', kind)
        .eq('key_suffix', suffix)
        .eq('day', day)
        .maybeSingle();

      const nextUsed = (data?.used ?? 0) + 1;
      await c.from('provider_quota').upsert(
        { kind, key_suffix: suffix, day, used: nextUsed },
        { onConflict: 'kind,key_suffix,day' },
      );
    } catch {
      // best-effort, abaikan
    }
  })();
}

/**
 * Catat pemakaian token harian (TPD) untuk key.
 * Dipakai provider dengan limit token per hari (mis. Groq Free Tier 200K TPD)
 * agar pool berhenti sebelum menabrak 429 upstream.
 */
export function keyTokensUsed(kind: ProviderKind, key: string, tokens: number): void {
  const amount = Math.max(0, Math.round(tokens));
  if (amount <= 0) return;
  const ts = tokenSlot(kind, key);
  // Laporan token riil pertama menggantikan estimasi hidrasi legacy (bukan ditambahkan
  // di atasnya) agar estimasi berlebih tidak ikut terakumulasi (audit v19).
  //
  // KOREKSI AUDIT v0.79 (temuan F4): penggantian ini TIDAK BOLEH MENURUNKAN penghitung.
  // Kasus nyata: hidrasi memberi estimasi 25.000 token, lalu laporan riil pertama hanya
  // 3.000 token -> penghitung turun dari 25.000 ke 3.000, sehingga pemakaian hari itu
  // under-count dan key bisa melewati DAILY_TOKEN_CAP_GROQ (200K) tanpa diblokir guard
  // -> 429 upstream yang seharusnya dicegah. Penghitung harian harus MONOTON NAIK.
  if (ts.estimated) {
    ts.tokens = Math.max(ts.tokens, amount);
    ts.estimated = false;
  } else {
    ts.tokens += amount;
  }

  const c = db();
  if (!c) return;
  const suffix = keyHash(key);
  const day = today();
  void (async () => {
    try {
      const { error } = await c.rpc('atomic_increment_provider_tokens', {
        p_kind: kind,
        p_key_suffix: suffix,
        p_day: day,
        p_amount: amount,
      });
      if (!error) return;

      // Fallback RMW jika RPC v18 belum di-deploy
      const { data } = await c
        .from('provider_quota')
        .select('tokens_used')
        .eq('kind', kind)
        .eq('key_suffix', suffix)
        .eq('day', day)
        .maybeSingle();

      const nextTokens = (Number((data as { tokens_used?: number } | null)?.tokens_used) || 0) + amount;
      await c.from('provider_quota').upsert(
        { kind, key_suffix: suffix, day, tokens_used: nextTokens },
        { onConflict: 'kind,key_suffix,day' },
      );
    } catch {
      // best-effort, abaikan
    }
  })();
}
