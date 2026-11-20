/**
 * TEST OTOMATIS — pemisahan kanal & failover pengingat Baileys <-> Cloud API (20 Nov 2026).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  BAILEYS_REMINDER_MARKER,
  BAILEYS_FALLBACK_KE_CLOUD_MS,
  CLOUD_FALLBACK_KE_BAILEYS_MS,
  tandaiPengingatBaileys,
  adalahPengingatBaileys,
  bersihkanTeksPengingat,
  bolehProsesKanalPengingat,
} from '../src/remind.js';
import { kemiripanPesan } from '../src/reminder-dedup.js';

const baca = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');

test('marker Baileys: idempoten, terdeteksi, dan bisa dibersihkan bersih', () => {
  const m1 = tandaiPengingatBaileys('ON');
  assert.equal(adalahPengingatBaileys(m1), true);
  assert.equal(tandaiPengingatBaileys(m1), m1, 'tanda tidak boleh digandakan');
  assert.equal(bersihkanTeksPengingat(m1), 'ON');
  assert.equal(adalahPengingatBaileys('ON'), false);
  assert.ok(m1.includes(BAILEYS_REMINDER_MARKER));
});

test('dedup: kata pendek bertanda Baileys ("ON") tetap cocok 100% dengan polos ("ON")', () => {
  assert.equal(kemiripanPesan('ON', tandaiPengingatBaileys('ON')), 1);
  assert.equal(kemiripanPesan(tandaiPengingatBaileys('tes'), 'tes'), 1);
});

test('routing normal: pengingat Baileys tepat waktu hanya diproses Baileys, bukan Cloud', () => {
  const now = Date.UTC(2026, 10, 20, 6, 0, 10);
  const due = new Date(now - 5_000).toISOString();
  const item = { message: tandaiPengingatBaileys('tes'), due_at: due, platform: 'whatsapp' };

  assert.equal(bolehProsesKanalPengingat(item, { channelFilter: 'baileys_only', nowMs: now }), true);
  assert.equal(bolehProsesKanalPengingat(item, { channelFilter: 'cloud_only', nowMs: now }), false);
});

test('failover VPS mati: pengingat Baileys telat > 60 detik diambil alih Cloud API', () => {
  const now = Date.UTC(2026, 10, 20, 6, 2, 0);
  const due = new Date(now - (BAILEYS_FALLBACK_KE_CLOUD_MS + 1_000)).toISOString();
  const item = { message: tandaiPengingatBaileys('tes'), due_at: due, platform: 'whatsapp' };

  assert.equal(bolehProsesKanalPengingat(item, { channelFilter: 'cloud_only', nowMs: now }), true);
});

test('routing normal: pengingat Cloud API tidak dicuri Baileys saat baru jatuh tempo atau telat <= 180s', () => {
  const now = Date.UTC(2026, 10, 20, 6, 1, 0);
  const item5s = { message: 'bangun', due_at: new Date(now - 5_000).toISOString(), platform: 'whatsapp' };
  const item60s = { message: 'bangun', due_at: new Date(now - 60_000).toISOString(), platform: 'whatsapp' };

  assert.equal(bolehProsesKanalPengingat(item5s, { channelFilter: 'cloud_only', nowMs: now }), true);
  assert.equal(bolehProsesKanalPengingat(item5s, { channelFilter: 'baileys_only', nowMs: now }), false);
  assert.equal(bolehProsesKanalPengingat(item60s, { channelFilter: 'cloud_only', nowMs: now }), true);
  assert.equal(bolehProsesKanalPengingat(item60s, { channelFilter: 'baileys_only', nowMs: now }), false);
});

test('failover gangguan senyap: pengingat Cloud telat > 180 detik diambil alih Baileys', () => {
  const now = Date.UTC(2026, 10, 20, 6, 5, 0);
  const due = new Date(now - (CLOUD_FALLBACK_KE_BAILEYS_MS + 1_000)).toISOString();
  const item = { message: 'minum obat', due_at: due, platform: 'whatsapp' };

  assert.equal(bolehProsesKanalPengingat(item, { channelFilter: 'baileys_only', nowMs: now }), true);
});

test('failover maintenance Cloud API: Baileys langsung ambil semua WA, Cloud tunda WA tapi tetap proses Telegram', () => {
  const now = Date.UTC(2026, 10, 20, 6, 0, 5);
  const due = new Date(now - 2_000).toISOString();
  const itemWa = { message: 'rapat', due_at: due, platform: 'whatsapp' };
  const itemTg = { message: 'tidur', due_at: due, platform: 'telegram' };

  assert.equal(
    bolehProsesKanalPengingat(itemWa, { channelFilter: 'baileys_only', nowMs: now, cloudMaintenance: true }),
    true,
  );
  assert.equal(
    bolehProsesKanalPengingat(itemWa, { channelFilter: 'cloud_only', nowMs: now, cloudMaintenance: true }),
    false,
  );
  assert.equal(
    bolehProsesKanalPengingat(itemTg, { channelFilter: 'cloud_only', nowMs: now, cloudMaintenance: true }),
    true,
  );
  assert.equal(
    bolehProsesKanalPengingat(itemTg, { channelFilter: 'baileys_only', nowMs: now, cloudMaintenance: true }),
    false,
  );
});

test('wiring: Baileys, Cloud, Cron, dan Multi-Hari terpasang konsisten tanpa kebocoran', () => {
  const BAILEYS = baca('src/whatsapp_baileys.ts');
  const CLOUD = baca('src/whatsapp_cloud.ts');
  const CRON = baca('api/cron/reminders.ts');
  const NOTES = baca('src/notes.ts');

  assert.match(BAILEYS, /startBaileysReminderWorker/);
  assert.match(BAILEYS, /stopBaileysReminderWorker/);
  assert.match(BAILEYS, /channel:\s*'baileys'/);
  assert.match(BAILEYS, /tandaiPengingatBaileys\(/);
  assert.match(BAILEYS, /channelFilter:\s*'baileys_only'/);
  assert.ok(!BAILEYS.includes('sendWhatsAppCloudMessageSafe'), 'Baileys tidak boleh mengirim pengingat lewat Cloud API');

  assert.match(CLOUD, /channelFilter:\s*'cloud_only'/);
  assert.match(CRON, /channelFilter:\s*'cloud_only'/);
  assert.match(NOTES, /opts\.channel === 'baileys' \? tandaiPengingatBaileys\(item\.pesan\)/);
});
