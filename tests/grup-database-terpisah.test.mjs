/**
 * TEST OTOMATIS — Pemisahan Database Grup (Migrasi v35) & Isolasi Data Grup vs Privat
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  hasDedicatedGroupTables,
  isTableMissingError,
  resolveTableName,
  resetGroupDbCacheUntukTest,
} from '../src/group_db.js';
import { bolehProsesKanalPengingat } from '../src/remind.js';

const baca = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');

const EXPECTED_GROUP_TABLES = [
  'group_messages',
  'group_reminders',
  'group_notes',
  'group_todos',
  'group_expenses',
  'group_corrections',
  'group_summaries',
  'group_documents',
  'group_settings',
];

test('sql/migrate_v35_group_database.sql mendeklarasikan 9 tabel grup aman dengan RLS & tanpa DELETE/DROP', () => {
  const sql = baca('sql/migrate_v35_group_database.sql');
  const sqlTanpaKomentar = sql.replace(/--[^\r\n]*/g, '');
  assert.doesNotMatch(sqlTanpaKomentar, /\bDROP\s+TABLE\b/i, 'migrasi tidak boleh menghapus tabel');
  assert.doesNotMatch(sqlTanpaKomentar, /\bDELETE\s+FROM\b/i, 'migrasi tidak boleh menghapus baris');

  for (const tbl of EXPECTED_GROUP_TABLES) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${tbl}\\b`), `harus membuat ${tbl}`);
    assert.match(sql, new RegExp(`ALTER TABLE(?: IF EXISTS)? public\\.${tbl}\\s+ENABLE ROW LEVEL SECURITY`), `${tbl} wajib ENABLE RLS`);
    assert.match(sql, new RegExp(`ALTER TABLE(?: IF EXISTS)? public\\.${tbl}\\s+FORCE ROW LEVEL SECURITY`), `${tbl} wajib FORCE RLS`);
    assert.match(sql, new RegExp(`REVOKE ALL ON TABLE[\\s\\S]*public\\.${tbl}\\b[\\s\\S]*FROM anon, authenticated, PUBLIC`), `${tbl} wajib REVOKE akses publik`);
    assert.match(sql, new RegExp(`GRANT ALL ON TABLE[\\s\\S]*public\\.${tbl}\\b[\\s\\S]*TO service_role`), `${tbl} wajib GRANT ke service_role`);
    assert.match(sql, new RegExp(`'${tbl}'`), `${tbl} wajib terdaftar di blok CREATE POLICY`);
  }
  assert.match(sql, /CREATE POLICY %I ON public\.%I FOR ALL TO service_role/, 'harus membuat policy service_role');
});

test('isTableMissingError dan resolveTableName aman untuk DB belum termigrasi', async () => {
  assert.equal(isTableMissingError({ code: '42P01', message: 'relation "group_messages" does not exist' }), true);
  assert.equal(isTableMissingError({ code: 'PGRST205', message: 'Could not find the table in schema cache' }), true);
  assert.equal(isTableMissingError({ message: 'Could not find the table public.group_notes' }), true);
  assert.equal(isTableMissingError({ code: '23505', message: 'duplicate key value' }), false);
  assert.equal(isTableMissingError(null), false);

  resetGroupDbCacheUntukTest();
  // Chat privat selalu memakai tabel dasar.
  const privTbl = await resolveTableName('messages', 'wa_baileys_628123456');
  assert.equal(privTbl, 'messages');
  // Chat grup mengikuti ketersediaan tabel grup: bila belum termigrasi -> tabel
  // dasar, bila sudah ada -> group_*. Hasil uji tidak boleh bergantung pada env
  // lokal yang mungkin terhubung ke Supabase produksi.
  const groupTablesLive = await hasDedicatedGroupTables(true);
  const remTbl = await resolveTableName('reminders', 'wa_baileys_group_120363000000');
  assert.equal(remTbl, groupTablesLive ? 'group_reminders' : 'reminders');
});

test('bolehProsesKanalPengingat memaksa pengingat grup WA lewat baileys_only dan menolak cloud_only', () => {
  assert.equal(
    bolehProsesKanalPengingat({ platform: 'whatsapp', chat_id: 'wa_baileys_group_120363000000@g.us' }, { channelFilter: 'baileys_only' }),
    true,
  );
  assert.equal(
    bolehProsesKanalPengingat({ platform: 'whatsapp', chat_id: 'wa_baileys_group_120363000000' }, { channelFilter: 'cloud_only' }),
    false,
  );
  assert.equal(
    bolehProsesKanalPengingat({ platform: 'whatsapp', chat_id: 'wa_baileys_group_120363000000' }, { channelFilter: 'all' }),
    true,
  );
});

test('ringkasan.ts membedakan header Ringkasan Grup vs privat', () => {
  const ringkasanSrc = baca('src/ringkasan.ts');
  assert.match(ringkasanSrc, /isGroupChatKey\(chatId\)/);
  assert.match(ringkasanSrc, /Ringkasan Grup/);
});

test('isolasi kunci grup & wiring group_messages pada whatsapp_baileys, telegram, dataset, dan stats', () => {
  const BAIL = baca('src/whatsapp_baileys.ts');
  const TG = baca('src/telegram.ts');
  const DATASET = baca('api/dataset.ts');
  const STATS = baca('api/stats.ts');

  assert.match(BAIL, /const personalOwnerId = isGroup \? chatKey : nomorBaileys;/);
  assert.match(BAIL, /const sharedDataKey = isGroup \? chatKey : normChatId\(personalOwnerId, 'whatsapp'\);/);
  assert.match(BAIL, /tandaiPengingatBaileysEksklusif\(/);

  assert.match(TG, /const identityKey = chatKey;/);
  assert.match(TG, /markMessageProcessed\('telegram', .*chatKey\)/);

  assert.match(DATASET, /from\(tableName\)/);
  assert.match(DATASET, /'group_messages'/);
  assert.match(STATS, /from\('group_messages'\)/);
});
