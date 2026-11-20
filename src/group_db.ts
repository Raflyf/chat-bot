/**
 * ROUTER TABEL GRUP vs PRIVAT — pemisahan database fisik & logis.
 *
 * Saat `sql/migrate_v35_group_database.sql` sudah dijalankan di Supabase,
 * seluruh chat grup otomatis memakai tabel `group_*` (`group_messages`,
 * `group_reminders`, `group_notes`, `group_todos`, `group_expenses`,
 * `group_corrections`, `group_summaries`, `group_documents`, `group_settings`).
 *
 * Jika migrasi belum dijalankan, fungsi otomatis fallback ke tabel standar
 * (yang sudah terisolasi secara logis lewat `wa_baileys_group_*` / ID negatif
 * Telegram) tanpa mengganggu layanan. Deteksi ulang berjalan setiap 60 detik
 * sehingga migrasi aktif otomatis tanpa restart.
 */
import { db } from './db.js';
import { isGroupChatKey } from './chat_id.js';

export type GroupTableBase =
  | 'messages'
  | 'reminders'
  | 'notes'
  | 'todos'
  | 'expenses'
  | 'corrections'
  | 'summaries'
  | 'documents';

const PRESENT_TTL_MS = 10 * 60 * 1000;
const ABSENT_TTL_MS = 60 * 1000;

let cachedAvailable: boolean | null = null;
let cachedAtMs = 0;
let probingPromise: Promise<boolean> | null = null;

/** True bila error Supabase/PostgREST menandakan tabel belum dibuat. */
export function isTableMissingError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: unknown; message?: unknown; details?: unknown };
  const code = String(e.code ?? '').trim().toUpperCase();
  if (code === 'PGRST205' || code === '42P01') return true;
  const msg = `${String(e.message ?? '')} ${String(e.details ?? '')}`;
  return /could not find the table|does not exist|relation .* does not exist/i.test(msg);
}

/** Cek apakah 9 tabel khusus grup (`group_*`) sudah tersedia di Supabase. */
export async function hasDedicatedGroupTables(forceRefresh = false): Promise<boolean> {
  const c = db();
  if (!c) return false;

  const now = Date.now();
  const ttl = cachedAvailable ? PRESENT_TTL_MS : ABSENT_TTL_MS;
  if (!forceRefresh && cachedAvailable !== null && now - cachedAtMs < ttl) {
    return cachedAvailable;
  }
  if (probingPromise && !forceRefresh) return probingPromise;

  probingPromise = (async () => {
    try {
      const checks = await Promise.all([
        c.from('group_messages').select('*').limit(0),
        c.from('group_reminders').select('*').limit(0),
        c.from('group_notes').select('*').limit(0),
        c.from('group_todos').select('*').limit(0),
        c.from('group_expenses').select('*').limit(0),
        c.from('group_corrections').select('*').limit(0),
        c.from('group_summaries').select('*').limit(0),
        c.from('group_documents').select('*').limit(0),
        c.from('group_settings').select('*').limit(0),
      ]);
      const ok = checks.every((r) => !r.error && !isTableMissingError(r.error) && Array.isArray(r.data));
      cachedAvailable = ok;
      cachedAtMs = Date.now();
      return ok;
    } catch {
      cachedAvailable = false;
      cachedAtMs = Date.now();
      return false;
    } finally {
      probingPromise = null;
    }
  })();

  return probingPromise;
}

/** Petakan nama tabel berdasarkan apakah `chatId` berasal dari grup atau chat privat. */
export async function resolveTableName(
  base: GroupTableBase,
  chatId?: string | null,
): Promise<string> {
  if (!isGroupChatKey(chatId)) return base;
  return (await hasDedicatedGroupTables()) ? `group_${base}` : base;
}

/** Reset status ketersediaan jika terjadi error tabel tidak ditemukan saat runtime. */
export function markGroupTablesUnavailable(): void {
  cachedAvailable = false;
  cachedAtMs = Date.now();
}

export function resetGroupDbCacheUntukTest(): void {
  cachedAvailable = null;
  cachedAtMs = 0;
  probingPromise = null;
}
