import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  sendWhatsAppMessageSafe,
  isStandbyBackupMode,
  cekStateVpsUtama,
  evaluasiSiklusStandby,
} from '../src/whatsapp_baileys.js';
import { isRemoteFileNewer } from '../src/whatsapp_session.js';

const THIS_FILE = fileURLToPath(import.meta.url);
const SESSION_SRC = fs.readFileSync(new URL('../src/whatsapp_session.ts', import.meta.url), 'utf8');
const BAILEYS_SRC = fs.readFileSync(new URL('../src/whatsapp_baileys.ts', import.meta.url), 'utf8');

test('sendWhatsAppMessageSafe meneruskan quoted sebagai argumen ke-3 (options), bukan di dalam payload konten', async () => {
  const calls = [];
  const fakeSock = {
    async sendMessage(jid, content, options) {
      calls.push({ jid, content, options });
      return undefined;
    },
  };

  const quotedMsg = { key: { id: 'MSG123', remoteJid: '120363415563030836@g.us' } };
  const ok1 = await sendWhatsAppMessageSafe(fakeSock, '120363415563030836@g.us', 'halo grup', quotedMsg);
  assert.equal(ok1, true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].content, { text: 'halo grup' });
  assert.equal('quoted' in calls[0].content, false, 'quoted TIDAK boleh berada di dalam objek payload content');
  assert.deepEqual(calls[0].options, { quoted: quotedMsg });

  // Tanpa quotedMsg -> options undefined
  calls.length = 0;
  const ok2 = await sendWhatsAppMessageSafe(fakeSock, '120363415563030836@g.us', 'tanpa quote');
  assert.equal(ok2, true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].content, { text: 'tanpa quote' });
  assert.equal(calls[0].options, undefined);

  // Pesan multi-chunk -> hanya chunk pertama yang memakai quoted
  calls.length = 0;
  const longText = `${'a'.repeat(3900)} ${'b'.repeat(300)}`;
  const ok3 = await sendWhatsAppMessageSafe(fakeSock, '120363415563030836@g.us', longText, quotedMsg);
  assert.equal(ok3, true);
  assert.ok(calls.length >= 2, 'pesan panjang harus dipecah menjadi minimal 2 chunk');
  assert.deepEqual(calls[0].options, { quoted: quotedMsg });
  assert.equal(calls[1].options, undefined);
});

test('restoreSessionFromSupabase menjaga file lokal VPS dan sync dijalankan saat shutdown', () => {
  assert.match(SESSION_SRC, /const hasLocalCreds = fs\.existsSync\(path\.join\(sessionDir, 'creds\.json'\)\)/);
  assert.match(SESSION_SRC, /if \(hasLocalCreds && fs\.existsSync\(filePath\)\)/);
  assert.match(SESSION_SRC, /syncInFlight/);
  assert.match(BAILEYS_SRC, /sessionSyncTimer/);
  assert.match(BAILEYS_SRC, /syncSessionDirToSupabase\(sessionDir\)/);
});

test('isRemoteFileNewer membandingkan updated_at remote vs mtime lokal untuk sinkronisasi dua arah VPS <-> Laptop', () => {
  const localMtimeMs = fs.statSync(THIS_FILE).mtimeMs;
  const olderIso = new Date(localMtimeMs - 60_000).toISOString();
  const sameIso = new Date(localMtimeMs + 500).toISOString();
  const newerIso = new Date(localMtimeMs + 60_000).toISOString();

  // Remote lebih lama atau sama -> pertahankan lokal (false)
  assert.equal(isRemoteFileNewer(THIS_FILE, olderIso), false);
  assert.equal(isRemoteFileNewer(THIS_FILE, sameIso), false);

  // Remote lebih baru (>1 detik) -> perbarui dari remote (true)
  assert.equal(isRemoteFileNewer(THIS_FILE, newerIso), true);
  assert.equal(isRemoteFileNewer(THIS_FILE, null, true), true);
});

test('isStandbyBackupMode mendeteksi laptop standby vs primary VPS dengan tepat', () => {
  const envWithInstabox = {
    INSTABOX_API_KEY: 'ibx_key',
    INSTABOX_MACHINE_ID: 'm_123',
  };

  // Di Windows / localhost dengan kredensial InstaBox -> otomatis Standby Backup
  assert.equal(isStandbyBackupMode(['node', 'whatsapp_baileys.ts'], envWithInstabox, 'd:\\code\\project\\projek_no_name', 'win32'), true);

  // Di VPS InstaBox (/data/home/chat-bot) -> Primary (false)
  assert.equal(isStandbyBackupMode(['node', 'whatsapp_baileys.js'], envWithInstabox, '/data/home/chat-bot', 'linux'), false);

  // Flag eksplisit --standby atau --primary
  assert.equal(isStandbyBackupMode(['node', 'whatsapp_baileys.ts', '--standby'], {}, '/var/app', 'linux'), true);
  assert.equal(isStandbyBackupMode(['node', 'whatsapp_baileys.ts', '--primary'], envWithInstabox, 'd:\\code', 'win32'), false);
  assert.equal(isStandbyBackupMode(['node', 'whatsapp_baileys.ts'], { ...envWithInstabox, WA_STANDBY_BACKUP: 'false' }, 'd:\\code', 'win32'), false);
});

test('evaluasiSiklusStandby: standby saat VPS running, takeover saat VPS suspended/paused, dan yield saat VPS running kembali', async () => {
  let localActive = false;
  let startCount = 0;
  let stopReasons = [];
  let vpsState = 'running';

  const deps = {
    apiKey: 'ibx_dummy',
    machineId: 'm_test',
    apiBase: 'https://api.instabox.sh',
    isLocalActive: () => localActive,
    startLocal: async () => {
      startCount++;
      localActive = true;
    },
    stopLocal: async (reason) => {
      stopReasons.push(reason);
      localActive = false;
    },
    fetchImpl: async () =>
      new Response(JSON.stringify({ id: 'm_test', name: 'freeaibot-wa', state: vpsState }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
  };

  // 1. VPS running + lokal belum aktif -> tetap standby
  const r1 = await evaluasiSiklusStandby(deps);
  assert.equal(r1.availability, 'running');
  assert.equal(r1.action, 'stay_standby');
  assert.equal(localActive, false);
  assert.equal(startCount, 0);

  // 2. VPS suspended -> laptop otomatis takeover
  vpsState = 'suspended';
  const r2 = await evaluasiSiklusStandby(deps);
  assert.equal(r2.availability, 'down');
  assert.equal(r2.action, 'takeover_start');
  assert.equal(localActive, true);
  assert.equal(startCount, 1);

  // 3. VPS masih suspended -> tetap aktif di laptop tanpa restart ulang
  const r3 = await evaluasiSiklusStandby(deps);
  assert.equal(r3.action, 'keep_active');
  assert.equal(startCount, 1);

  // 4. VPS kembali running -> laptop otomatis sync & lepas koneksi (yield_to_vps)
  vpsState = 'running';
  const r4 = await evaluasiSiklusStandby(deps);
  assert.equal(r4.availability, 'running');
  assert.equal(r4.action, 'yield_to_vps');
  assert.equal(localActive, false);
  assert.equal(stopReasons.length, 1);

  // 5. Proteksi 440 connectionReplaced: tidak boleh reconnect loop atau hapus sesi Supabase
  assert.match(BAILEYS_SRC, /DisconnectReason\.connectionReplaced/);
  assert.match(BAILEYS_SRC, /if \(isReplaced \|\| standbyYieldInProgress\)/);
  assert.match(BAILEYS_SRC, /else if \(isLoggedOut\)/);
  void cekStateVpsUtama;
});
