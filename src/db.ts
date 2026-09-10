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
}): Promise<void> {
  const c = db();
  if (!c) return;
  try {
    await c.from('messages').insert({
      platform: row.platform,
      chat_id: row.chat_id,
      role: row.role,
      content: row.content.slice(0, 4000),
      via: row.via ?? null,
    });
  } catch {
    // best-effort, abaikan
  }
}
