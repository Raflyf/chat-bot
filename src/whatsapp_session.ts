import fs from 'fs';
import path from 'path';
import { db } from './db.js';

/**
 * Memulihkan file sesi WhatsApp dari tabel Supabase `whatsapp_sessions` ke folder lokal.
 * Menghindari keharusan scan ulang QR saat container cloud (Render/Koyeb) restart.
 */
export async function restoreSessionFromSupabase(sessionDir: string): Promise<boolean> {
  const c = db();
  if (!c) {
    console.log('[wa-session] Supabase client tidak tersedia, menggunakan sesi lokal.');
    return fs.existsSync(path.join(sessionDir, 'creds.json'));
  }

  try {
    const { data, error } = await c
      .from('whatsapp_sessions')
      .select('filename, content');

    if (error) {
      console.warn('[wa-session] Gagal membaca whatsapp_sessions dari Supabase:', error.message);
      return fs.existsSync(path.join(sessionDir, 'creds.json'));
    }

    if (!data || data.length === 0) {
      console.log('[wa-session] Belum ada sesi WhatsApp tersimpan di Supabase.');
      return fs.existsSync(path.join(sessionDir, 'creds.json'));
    }

    if (!fs.existsSync(sessionDir)) {
      fs.mkdirSync(sessionDir, { recursive: true });
    }

    let restoredCount = 0;
    const baseDirResolved = path.resolve(sessionDir);
    for (const row of data as Array<{ filename: string; content: string }>) {
      if (!row.filename || typeof row.filename !== 'string') continue;
      // Tolak traversal atau berkas internal config
      const safeFilename = path.basename(row.filename.replace(/\\/g, '/'));
      if (!safeFilename || safeFilename === '.' || safeFilename === '..' || safeFilename.startsWith('__')) {
        continue;
      }
      const filePath = path.resolve(sessionDir, safeFilename);
      if (!filePath.startsWith(baseDirResolved + path.sep) && filePath !== baseDirResolved) {
        continue;
      }
      fs.writeFileSync(filePath, row.content, 'utf8');
      restoredCount++;
    }

    const hasCreds = fs.existsSync(path.join(sessionDir, 'creds.json'));
    console.log(`[wa-session] Berhasil memulihkan ${restoredCount} file sesi dari Supabase (creds: ${hasCreds}).`);
    return hasCreds;
  } catch (err) {
    console.error('[wa-session] Error saat memulihkan sesi dari Supabase:', err);
    return fs.existsSync(path.join(sessionDir, 'creds.json'));
  }
}

/**
 * Menyimpan seluruh file sesi yang ada di folder lokal ke Supabase secara berkala.
 */
export async function syncSessionDirToSupabase(sessionDir: string): Promise<void> {
  const c = db();
  if (!c || !fs.existsSync(sessionDir)) return;

  try {
    const files = fs.readdirSync(sessionDir);
    const updates: Array<{ filename: string; content: string; updated_at: string }> = [];

    for (const file of files) {
      const filePath = path.join(sessionDir, file);
      const stat = fs.statSync(filePath);
      if (stat.isFile()) {
        const content = fs.readFileSync(filePath, 'utf8');
        updates.push({
          filename: file,
          content,
          updated_at: new Date().toISOString(),
        });
      }
    }

    if (updates.length > 0) {
      const { error } = await c.from('whatsapp_sessions').upsert(updates);
      if (error) {
        console.warn('[wa-session] Gagal menyinkronkan sesi ke Supabase:', error.message);
      } else {
        console.log(`[wa-session] Berhasil menyinkronkan ${updates.length} file sesi ke Supabase.`);
      }
    }
  } catch (err) {
    console.error('[wa-session] Error saat sinkronisasi sesi ke Supabase:', err);
  }
}

/**
 * Menghapus sesi di Supabase saat pengguna logout / sesi ditutup permanen.
 */
export async function clearSessionInSupabase(): Promise<void> {
  const c = db();
  if (!c) return;
  try {
    await c
      .from('whatsapp_sessions')
      .delete()
      .neq('filename', '')
      .neq('filename', '__admin_auth_config.json');
    console.log('[wa-session] Sesi WhatsApp di Supabase telah dibersihkan.');
  } catch (err) {
    console.error('[wa-session] Gagal membersihkan sesi di Supabase:', err);
  }
}
