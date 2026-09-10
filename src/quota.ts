// Pelacak kuota harian per key (in-memory). Sederhana dan cukup untuk P0:
// reset otomatis tiap tanggal UTC baru. 429 ikut dihitung agar pool berhenti.

// Kunci peta memakai 4 char terakhir + panjang (identitas tanpa bocor isi key).
type ProviderKind = 'openrouter' | 'groq' | 'gemini' | 'ollama';

interface Counter {
  date: string;
  count: number;
}

const counters = new Map<string, Counter>();

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function slot(kind: ProviderKind, key: string): Counter {
  const id = `${kind}:${key.slice(-4)}:${key.length}`;
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
  slot(kind, key).count += 1;
}
