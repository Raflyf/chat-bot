import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { sendWhatsAppMessageSafe } from '../src/whatsapp_baileys.js';

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
