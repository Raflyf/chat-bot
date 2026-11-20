/**
 * TEST REGRESI — Audit Lengkap v36 (Memori Reset, Zona Waktu Grup/TG, Cooldown OpenCode,
 * Pengingat NOT NULL, Game/Backup Grup, Stiker Guard Grup/TG, dan Stealth Web Scraping).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { detectUserCountry } from '../src/timezone.js';
import { ekstrakPesanInti, sanitizeAssistantOutput } from '../src/skills.js';
import { isSafePublicUrl } from '../src/web.js';

const baca = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');

test('detectUserCountry mengabaikan grup & ID Telegram namun mengenali nomor WA asli +1 / +62', () => {
  assert.equal(detectUserCountry('wa_baileys_group_120363400112233@g.us'), null);
  assert.equal(detectUserCountry('wa_baileys_group_120363400112233'), null);
  assert.equal(detectUserCountry('wa_-1001234567890'), null);
  assert.equal(detectUserCountry('-1001234567890'), null);
  assert.equal(detectUserCountry('wa_1073504871'), null, 'ID Telegram 10 digit awalan 1 bukan nomor AS');

  const indo = detectUserCountry('wa_628123456789');
  assert.equal(indo?.country, 'Indonesia');
  assert.equal(indo?.zone, 'Asia/Jakarta');

  const us = detectUserCountry('wa_14155552671');
  assert.equal(us?.zone, 'America/New_York');
});

test('ekstrakPesanInti melepas wrapper grup pasif, membalas, dan penutur', () => {
  const wrapped =
    '[Konteks obrolan grup sebelumnya yang kamu dengar diam-diam:\n- Ani: bahas tugas]\n' +
    '[Membalas pesan KAMU (bot): "halo dunia"] [Pesan di Grup dari Budi]: halo';
  assert.equal(ekstrakPesanInti(wrapped), 'halo');

  const plainGroup = '[Pesan di Grup dari Siti]: jam berapa sekarang?';
  assert.equal(ekstrakPesanInti(plainGroup), 'jam berapa sekarang?');
});

test('guard stiker bekerja untuk label stiker grup WA, stiker animasi, dan stiker Telegram', () => {
  for (const label of [
    '[Stiker WhatsApp dari Budi]',
    '[Stiker Animasi WhatsApp]',
    '[Stiker Telegram: 😂]',
    '[Stiker Telegram dari Ani: 🔥]',
  ]) {
    assert.equal(sanitizeAssistantOutput('Iya tuh lucu banget', label), '', `harus buang generik untuk ${label}`);
    assert.equal(sanitizeAssistantOutput('Stikernya belum kelihatan, kirim ulang dong', label), '', `harus buang klaim buta untuk ${label}`);
  }
});

test('isSafePublicUrl menolak rentang CGNAT 100.64.0.0/10', () => {
  assert.equal(isSafePublicUrl('http://100.64.0.1/status'), false);
  assert.equal(isSafePublicUrl('https://100.127.255.254/'), false);
  assert.equal(isSafePublicUrl('https://100.128.0.1/'), true);
});

test('perbaikan struktural audit v36 terpasang lengkap di seluruh modul target', () => {
  const REMIND = baca('src/remind.ts');
  const NOTES = baca('src/notes.ts');
  const GAMES = baca('src/games/index.ts');
  const PROVIDERS = baca('src/providers.ts');
  const MEMORY = baca('src/memory.ts');
  const WEB = baca('src/web.ts');
  const TG = baca('src/telegram.ts');
  const BACKUP = baca('api/cron/backup.ts');

  assert.match(REMIND, /patch\.repeat_kind\s*=\s*'none'/);
  assert.doesNotMatch(REMIND, /patch\.repeat_kind\s*=\s*null/);

  assert.match(NOTES, /const normTodoChatId = normChatId\(chatId, opts\.platform\)/);
  assert.match(NOTES, /if \(r0\.created_at && Date\.now\(\) - new Date\(r0\.created_at\)\.getTime\(\) > KONFIRMASI_TTL_MS\)/);

  assert.match(GAMES, /resolveTableName\('messages', chatId\)/);

  assert.match(PROVIDERS, /getCooldownPersist\(`\$\{step\.kind\}:\$\{keyHash\(key\)\}`\)/);
  assert.match(PROVIDERS, /Authorization:\s*`Bearer \$\{authToken\}`/);

  assert.match(MEMORY, /via\.is\.null,via\.not\.like\.system\/%/);
  assert.match(MEMORY, /\.eq\('via', 'system\/reset'\)/);

  assert.match(WEB, /isAntiBotChallenge\(/);
  assert.match(WEB, /fetchStealthChromeSsrf/);
  assert.match(WEB, /merujukLinkSebelumnya/);

  assert.match(TG, /'ringkasan'/);
  assert.match(TG, /'catat'/);
  assert.match(TG, /markMessageProcessed\('telegram', msgId, chatKey\)/);

  assert.match(BACKUP, /group_messages/);
  assert.match(BACKUP, /group_settings/);
});
