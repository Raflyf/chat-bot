// Pelacak kuota harian per key (hybrid in-memory + Supabase provider_quota).
// Reset otomatis tiap tanggal UTC baru. 429 ikut dihitung agar pool berhenti.

import crypto from 'crypto';
import { db } from './db.js';

type ProviderKind = 'xkiro' | 'groq' | 'gemini' | 'openrouter';

interface Counter {
  date: string;
  count: number;
}

const counters = new Map<string, Counter>();

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

/** True jika key masih boleh dipakai hari ini. */
export function keyAllowed(kind: ProviderKind, key: string, cap: number): boolean {
  return slot(kind, key).count < cap;
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
