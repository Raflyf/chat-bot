/**
 * TEST OTOMATIS — bot membalas stiker dengan stiker, SEIMBANG (10 Okt 2026).
 *
 * LAPORAN PEMILIK PRODUK: "saat saya mengirim stiker, si bot nya masih tidak
 * pernah mengirim stiker balik" lalu dikoreksi: "jarang, bukan tidak pernah".
 * Lalu: "tapi jangan terlalu longgar juga, yg sekarang juga sudah lumayan".
 *
 * AKAR: saat user mengirim STIKER, `userText` = '[Stiker WhatsApp]' — TIDAK ADA
 * kata suasana, sehingga `stickerFitsMood` jatuh ke DEFAULT yang hanya mengizinkan
 * mood 'netral'/'sopan'/'lucu'. Akibatnya 12 dari 32 emoji SELALU ditolak
 * (kesal/sindir/sedih/hangat) -> bot jarang membalas stiker.
 *
 * PERBAIKAN SEIMBANG (bukan longgar):
 *   - Saat STIKER masuk: filter suasana tidak berlaku (stiker menyatakan
 *     suasananya sendiri), TETAPI tetap TOLAK mood 'kesal' & 'sedih'.
 *   - Emoji EDGY (🖕/🤬) tetap ditolak terpisah oleh isEdgyStickerEmoji.
 *   - Fallback emoji HANYA memilih yang lolos filter (agar benar-benar terkirim).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { stickerFitsMood, stickerMood, hasStickerForEmoji } from '../src/stickers.js';
import { emojiStikerDariMakna } from '../src/skills.js';

const SKILLS = fs.readFileSync(new URL('../src/skills.ts', import.meta.url), 'utf8');

test('stiker: stiker normal BOLEH dibalas stiker (tidak diblokir suasana)', () => {
  // Semua ini dulu DITOLAK karena mood-nya bukan netral/sopan/lucu.
  for (const e of ['🤔', '😏', '😳', '🥰', '🤨', '🙄']) {
    assert.ok(stickerFitsMood(e, '[Stiker WhatsApp]'),
      `${e} (${stickerMood(e)}) harus BOLEH dibalas stiker`);
  }
});

test('stiker: tetap TOLAK mood kesal & sedih (jangan terlalu longgar)', () => {
  for (const e of ['😤', '😠', '😡', '😭', '🥺', '😢']) {
    assert.equal(stickerFitsMood(e, '[Stiker WhatsApp]'), false,
      `${e} (${stickerMood(e)}) harus tetap DITOLAK`);
  }
});

test('stiker: konteks TEKS tetap dihormati (perilaku lama tidak rusak)', () => {
  // Saat ada TEKS, filter suasana tetap berlaku seperti semula.
  assert.equal(stickerFitsMood('😂', 'aku sedih banget hari ini'), false,
    'jangan kirim stiker lucu saat user sedih');
  assert.equal(stickerFitsMood('😹', 'wkwkwk lucu banget'), true,
    'stiker lucu boleh saat user bercanda');
});

test('stiker: fallback emoji HANYA yang lolos filter', () => {
  // Setiap emoji hasil fallback WAJIB bisa benar-benar terkirim.
  const makna = ['wkwkwk lucu', 'kaget banget', 'malu nih', 'sayang kamu', 'capek', 'senang', 'oke sip', 'bingung', 'kabur', 'main game'];
  for (const m of makna) {
    const e = emojiStikerDariMakna(m);
    if (e) {
      assert.ok(hasStickerForEmoji(e), `"${m}" -> ${e} harus ada di manifest`);
      assert.ok(stickerFitsMood(e, '[Stiker WhatsApp]'), `"${m}" -> ${e} harus lolos filter`);
    }
  }
});

test('bocor: "aku jawab singkat / tetap nyambung" DIBUANG', () => {
  assert.ok(/singkat/.test(SKILLS), 'penegak harus menangkap "jawab singkat"');
  assert.ok(/nyambung\\s\+teru\?ss\?/.test(SKILLS), 'penegak harus menangkap "nyambung terus"');
});
