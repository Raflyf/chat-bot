import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from './env.js';

let client: SupabaseClient | null = null;

export function db(): SupabaseClient | null {
  if (!config.supabaseUrl || !config.supabaseKey) return null;
  if (!client) client = createClient(config.supabaseUrl, config.supabaseKey);
  return client;
}

/** Simpan pesan best-effort: gagal DB tidak boleh menggagalkan balasan chat. */
export async function saveMessage(row: {
  platform: string;
  chat_id: string;
  role: string;
  content: string;
  via?: string;
  tokens?: { prompt: number; completion: number; total: number };
  msg_id?: string;
  latency_ms?: number;
  needs_search?: boolean;
  split_count?: number;
  prompt_version?: string;
  feedback?: string;
}): Promise<void> {
  const c = db();
  if (!c) return;
  try {
    let viaStr = row.via ?? null;
    if (viaStr && row.tokens && (row.tokens.prompt > 0 || row.tokens.total > 0)) {
      if (!viaStr.includes('#t=')) {
        viaStr = `${viaStr}#t=${row.tokens.prompt},${row.tokens.completion},${row.tokens.total}`;
      }
    }
    const insertPayload: Record<string, any> = {
      platform: row.platform,
      chat_id: row.chat_id,
      role: row.role,
      content: row.content.slice(0, 32000),
      via: viaStr,
      msg_id: row.msg_id || null,
    };
    if (row.tokens) {
      if (typeof row.tokens.prompt === 'number') insertPayload.prompt_tokens = row.tokens.prompt;
      if (typeof row.tokens.completion === 'number') insertPayload.completion_tokens = row.tokens.completion;
      if (typeof row.tokens.total === 'number') insertPayload.total_tokens = row.tokens.total;
    }
    // Kolom instrumentasi dataset (opsional, hanya disertakan bila terisi)
    if (row.latency_ms !== undefined) insertPayload.latency_ms = row.latency_ms;
    if (row.needs_search !== undefined) insertPayload.needs_search = row.needs_search;
    if (row.split_count !== undefined) insertPayload.split_count = row.split_count;
    if (row.prompt_version !== undefined) insertPayload.prompt_version = row.prompt_version;
    if (row.feedback !== undefined) insertPayload.feedback = row.feedback;
    if (row.msg_id) {
      await c.from('messages').upsert(insertPayload, { onConflict: 'platform,msg_id' });
    } else {
      await c.from('messages').insert(insertPayload);
    }
  } catch (err: any) {
    if (err?.code !== '23505') {
      console.warn('[db] saveMessage error:', err?.message || err);
    }
  }
}

/**
 * Cek apakah pesan dengan platform dan msg_id sudah pernah diproses di database.
 */
export async function isMessageProcessed(platform: string, msgId: string): Promise<boolean> {
  if (!msgId) return false;
  const c = db();
  if (!c) return false;
  try {
    const { data, error } = await c
      .from('messages')
      .select('id')
      .eq('platform', platform)
      .eq('msg_id', msgId)
      .limit(1)
      .maybeSingle();

    return !error && !!data;
  } catch {
    return false;
  }
}

/**
 * Tandai pesan masuk telah selesai diproses oleh asisten (durability & anti-lockout).
 */
export async function markMessageProcessed(platform: string, msgId: string): Promise<void> {
  if (!msgId) return;
  const c = db();
  if (!c) return;
  try {
    await c
      .from('messages')
      .update({ processed_at: new Date().toISOString() })
      .eq('platform', platform)
      .eq('msg_id', msgId);
  } catch {
    // best-effort
  }
}

/**
 * Klaim pesan masuk secara atomik via INSERT ke tabel messages.
 * Fail-closed: jika DB error, return false untuk memicu retry platform yang aman.
 * Anti-lockout: jika worker sebelumnya crash (>45 detik tanpa processed_at), izinkan re-claim.
 */
export async function claimIncomingMessage(
  platform: string,
  msgId: string,
  chatId: string,
  content: string = '[incoming]'
): Promise<boolean> {
  if (!msgId) return true;
  const c = db();
  if (!c) return false; // fail-closed jika DB tidak terhubung

  try {
    const { error } = await c
      .from('messages')
      .insert({
        platform,
        chat_id: chatId,
        role: 'user',
        content: content.slice(0, 32000),
        msg_id: msgId,
      });

    if (!error) {
      return true;
    }

    // Jika duplicate key (pesan sudah ada di database)
    if (
      error.code === '23505' ||
      error.message?.includes('duplicate key') ||
      error.message?.includes('idx_messages_platform_msg_id')
    ) {
      try {
        const { data: existing } = await c
          .from('messages')
          .select('processed_at, created_at')
          .eq('platform', platform)
          .eq('msg_id', msgId)
          .maybeSingle();

        if (existing) {
          // Jika pesan ini sudah sukses diproses, tolak duplikat secara permanen
          if (existing.processed_at) {
            console.warn(`[db] Pesan duplikat (sudah selesai diproses) diblokir: platform=${platform}, msg_id=${msgId}`);
            return false;
          }

          // Durability check: jika worker sebelumnya crash (>45 detik tanpa processed_at):
          const ageMs = Date.now() - new Date(existing.created_at).getTime();
          if (ageMs > 45_000) {
            console.warn(`[db] Re-claiming stuck/crashed message: platform=${platform}, msg_id=${msgId}, age=${ageMs}ms`);
            return true;
          }
        }
      } catch {
        // Fallback to duplicate rejection
      }

      console.warn(`[db] Pesan duplikat terdeteksi & diblokir secara atomik: platform=${platform}, msg_id=${msgId}`);
      return false;
    }

    // Error DB non-duplikat: fail-closed agar tidak memproses tanpa jejak audit dan memicu retry platform
    console.error(`[db] claimIncomingMessage DB failure (${error.code || 'unknown'}): ${error.message} - failing closed`);
    return false;
  } catch (err: any) {
    console.error('[db] claimIncomingMessage exception:', err?.message || err);
    return false;
  }
}
