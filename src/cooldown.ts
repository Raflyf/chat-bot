/**
 * COOLDOWN PROVIDER PERSISTEN.
 *
 * KENAPA MODUL INI ADA (audit 05 Okt 2026):
 * Cooldown key provider sebelumnya hanya di MEMORI (`keyCooldownMap`). Pada
 * Vercel serverless, memori hilang setiap cold start, sehingga provider yang
 * sudah kena rate-limit dicoba lagi -> boros kuota & memperlambat respons.
 *
 * DESAIN: LAPISAN GANDA (memori dulu, database menyusul).
 * - Baca  : memori (cepat) -> kalau kosong, muat dari DB sekali (lazy hydrate).
 * - Tulis : memori SEGERA (tanpa menunggu) + DB di belakang (fire-and-forget).
 * Jadi tidak ada penundaan pada jalur panas, tapi data tetap bertahan.
 *
 * Aman tanpa migrasi: bila tabel v26 belum ada, semua operasi DB gagal senyap
 * dan sistem tetap bekerja seperti sebelumnya (memori saja).
 */
import { db } from './db.js';

// ── Memori (jalur cepat) ──
const cooldownMem = new Map<string, number>(); // `${kind}:${keyHash}:${model}` -> until(ms)
let sudahHidrasi = false;
let hidrasiSedang = false;

/** Kunci kanonik. */
function kunci(kind: string, keyHash: string, model = ''): string {
  return `${kind}:${keyHash}:${model}`;
}

/** Ambil cooldown dari memori (0 = tidak cooling). */
export function cooldownMemori(kind: string, keyHash: string, model = ''): number {
  return cooldownMem.get(kunci(kind, keyHash, model)) || 0;
}

/** Set cooldown di memori (langsung) + DB (belakang). */
export function setCooldown(
  kind: string,
  keyHash: string,
  untilMs: number,
  model = '',
  alasan = '',
): void {
  const k = kunci(kind, keyHash, model);
  if (untilMs <= Date.now()) {
    cooldownMem.delete(k);
  } else {
    cooldownMem.set(k, untilMs);
  }
  // Tulis ke DB tanpa menunggu (fire-and-forget). Kegagalan diabaikan.
  void simpanKeDb(kind, keyHash, model, untilMs, alasan);
}

/** Hapus cooldown (mis. setelah key sukses). */
export function hapusCooldown(kind: string, keyHash: string, model = ''): void {
  const k = kunci(kind, keyHash, model);
  cooldownMem.delete(k);
  void hapusDiDb(kind, keyHash, model);
}

/** Muat cooldown dari DB sekali (lazy). Aman bila tabel belum ada. */
export async function hidrasiCooldown(): Promise<void> {
  if (sudahHidrasi || hidrasiSedang) return;
  hidrasiSedang = true;
  const c = db();
  if (!c) { hidrasiSedang = false; sudahHidrasi = true; return; }
  try {
    const { data, error } = await c.rpc('get_provider_cooldowns');
    if (!error && Array.isArray(data)) {
      const now = Date.now();
      for (const row of data as Array<{ kind: string; key_hash: string; model: string; until_at: string }>) {
        const until = new Date(row.until_at).getTime();
        if (until > now) {
          cooldownMem.set(kunci(row.kind, row.key_hash, row.model || ''), until);
        }
      }
      sudahHidrasi = true;
    }
  } catch {
    // tabel v26 belum ada -> biarkan memori saja
  }
  hidrasiSedang = false;
}

/** Panggil sekali saat startup (opsional). */
export function mulaiHidrasiLatar(): void {
  void hidrasiCooldown();
}

async function simpanKeDb(kind: string, keyHash: string, model: string, untilMs: number, alasan: string): Promise<void> {
  const c = db();
  if (!c) return;
  try {
    await c.rpc('set_provider_cooldown', {
      p_kind: kind,
      p_key_hash: keyHash,
      p_model: model,
      p_until: new Date(untilMs).toISOString(),
      p_alasan: alasan,
    });
  } catch {
    // senyap
  }
}

async function hapusDiDb(kind: string, keyHash: string, model: string): Promise<void> {
  const c = db();
  if (!c) return;
  try {
    await c.from('provider_cooldown').delete()
      .eq('kind', kind).eq('key_hash', keyHash).eq('model', model);
  } catch {
    // senyap
  }
}

/** Bersihkan cooldown kedaluwarsa di memori (dipanggil berkala). */
export function bersihkanMemoriCooldown(): void {
  const now = Date.now();
  for (const [k, until] of cooldownMem) {
    if (until <= now) cooldownMem.delete(k);
  }
}
