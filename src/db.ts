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
 * Klaim pesan masuk secara atomik via INSERT ke tabel messages (C3 & F2).
 * Jika platform + msg_id sudah ada, unique index idx_messages_platform_msg_id
 * menolak insert (code 23505), mengembalikan false seketika (Zero TOCTOU).
 */
export async function claimIncomingMessage(
  platform: string,
  msgId: string,
  chatId: string,
  content: string = '[incoming]'
): Promise<boolean> {
  if (!msgId) return true;
  const c = db();
  if (!c) return true;

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

    if (error) {
      if (
        error.code === '23505' ||
        error.message?.includes('duplicate key') ||
        error.message?.includes('idx_messages_platform_msg_id')
      ) {
        console.warn(`[db] Pesan duplikat terdeteksi & diblokir secara atomik: platform=${platform}, msg_id=${msgId}`);
        return false;
      }
      console.warn(`[db] claimIncomingMessage warning (${error.code || 'unknown'}): ${error.message}`);
      return true;
    }

    return true;
  } catch (err: any) {
    console.warn('[db] claimIncomingMessage exception:', err?.message || err);
    return true;
  }
}
