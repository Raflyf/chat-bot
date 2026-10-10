/**
 * TEST OTOMATIS — stiker dibaca & dibalas dengan stiker (10 Okt 2026).
 *
 * LAPORAN PEMILIK PRODUK: "ga nyambung anjir klo dikasih stiker, kaya yg gabisa
 * lihat itu stiker apaan, kaya yg asal jawab aja. kan harusnya di jawab sesuai
 * dengan expresi dan isi dari stiker nya" + "kalo bisa jika ada user membalas
 * dengan stiker maka bot juga diperbolehkan membalas dengan stiker juga".
 *
 * AKAR (3 bug, dibuktikan uji nyata):
 *  1. Stiker WebP TRANSPARAN (alpha) tidak sanggup dibaca model vision ->
 *     bot menjawab "stikernya belum kelihatan, kirim ulang dong" (buta).
 *  2. Tag [[sticker:emoji]] diambil SETELAH sanitize, padahal sanitize MEMBUANG
 *     tag itu -> bot tidak pernah membalas stiker dengan stiker.
 *  3. Jalur stiker WhatsApp/Telegram/Baileys mengirim balasan MENTAH tanpa
 *     sanitizeAssistantOutput -> "iya salah liat" / "iya tuh lucu banget" lolos.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { sanitizeAssistantOutput, emojiStikerDariMakna } from '../src/skills.js';

const MEDIA = fs.readFileSync(new URL('../src/media.ts', import.meta.url), 'utf8');
const SKILLS = fs.readFileSync(new URL('../src/skills.ts', import.meta.url), 'utf8');
const CLOUD = fs.readFileSync(new URL('../src/whatsapp_cloud.ts', import.meta.url), 'utf8');

test('stiker: WebP transparan DIKONVERSI ke PNG putih sebelum vision', () => {
  // Model vision tidak sanggup baca WebP transparan -> "stikernya belum kelihatan".
  assert.ok(/flatten\(\{\s*background/.test(MEDIA), 'harus flatten (buang alpha)');
  assert.ok(/\.png\(\)/.test(MEDIA), 'harus konversi ke PNG');
  assert.ok(/mimeFinal = 'image\/png'/.test(MEDIA), 'mime harus jadi image/png');
});

test('stiker: paksaStiker diteruskan (PNG hasil konversi tetap dianggap stiker)', () => {
  assert.ok(/paksaStiker = false/.test(SKILLS), 'describeImage harus punya param paksaStiker');
  assert.ok(/const isSticker = paksaStiker \|\| mime\.includes\('webp'\)/.test(SKILLS),
    'isSticker harus hormati paksaStiker');
  assert.ok(/stickerCaption, ctx, true\)/.test(MEDIA), 'media.ts harus kirim paksaStiker=true');
});

test('stiker: tag stiker diambil SEBELUM sanitize', () => {
  // sanitize MEMBUANG tag -> kalau diambil sesudah, tag hilang.
  const iTag = SKILLS.indexOf('const stickerDariModel = extractStickerTag');
  const iSan = SKILLS.indexOf('let reply = ekstraksiTsv');
  assert.ok(iTag > 0, 'harus ada stickerDariModel');
  assert.ok(iTag < iSan, 'tag harus diambil SEBELUM sanitize');
});

test('stiker: fallback emoji bila model tidak menulis tag', () => {
  assert.ok(/emojiStikerDariMakna/.test(SKILLS), 'harus ada emojiStikerDariMakna');
  // Fungsi harus memilih emoji yang ADA di manifest.
  // DIPERBARUI 10 Okt 2026: fallback HARUS memilih emoji yang LOLOS filter mood
  // (agar stiker benar-benar terkirim). 😂 dikecualikan karena stikernya berisi
  // ejekan "LU DONGO" (mood 'kesal'), 😤 juga ditolak (bisa menyinggung).
  assert.equal(emojiStikerDariMakna('wkwkwk lucu banget'), '😹');
  assert.equal(emojiStikerDariMakna('kaget banget'), '😱');
  assert.equal(emojiStikerDariMakna('malu nih'), '😳');
  // Mood kesal/sedih TIDAK dihasilkan (ditolak filter).
  assert.equal(emojiStikerDariMakna('kesal nih'), null);
});

test('stiker: balasan "tidak lihat stiker" DIBUANG', () => {
  // Dikosongkan -> diregenerasi AI (bukan diganti teks statis).
  const buta = [
    'Eh stikernya belum kelihatan nih, kirim ulang dong',
    'Stikernya belum masuk sini, kirim ulang',
    'Maaf aku nggak lihat stikernya',
  ];
  for (const b of buta) {
    assert.equal(sanitizeAssistantOutput(b, '[Stiker WhatsApp]'), '', `"${b}" harus dibuang`);
  }
});

test('stiker: balasan generik/ngawur DIBUANG', () => {
  assert.equal(sanitizeAssistantOutput('Iya tuh lucu banget', '[Stiker WhatsApp]'), '');
  assert.equal(sanitizeAssistantOutput('Iya salah liat', '[Stiker WhatsApp]'), '');
});

test('stiker: jalur kirim WAJIB sanitize + kirim stiker balasan', () => {
  // WhatsApp Cloud
  assert.ok(/sanitizeAssistantOutput\(replyStikerMentah/.test(CLOUD), 'cloud harus sanitize');
  assert.ok(/sendWhatsAppCloudStickerSafe\(from, stickerBalasan\)/.test(CLOUD), 'cloud harus kirim stiker');
  // Telegram & Baileys
  const TELE = fs.readFileSync(new URL('../src/telegram.ts', import.meta.url), 'utf8');
  const BAIL = fs.readFileSync(new URL('../src/whatsapp_baileys.ts', import.meta.url), 'utf8');
  assert.ok(/sanitizeAssistantOutput\(replyStiker/.test(TELE), 'telegram harus sanitize');
  assert.ok(/sendTelegramStickerSafe\(bot, chatId, stickerBalasan\)/.test(TELE), 'telegram harus kirim stiker');
  assert.ok(/sanitizeAssistantOutput\(replyStiker/.test(BAIL), 'baileys harus sanitize');
  assert.ok(/sendWhatsAppStickerSafe\(sock, remoteJid, stickerBalasan\)/.test(BAIL), 'baileys harus kirim stiker');
});

test('stiker: prompt minta balas dengan stiker', () => {
  assert.ok(/BALAS DENGAN STIKER/.test(SKILLS), 'prompt harus mengizinkan balas stiker');
  assert.ok(/\[\[sticker:<emoji>\]\]/.test(SKILLS), 'prompt harus sebut format tag');
});

test('stiker: TIDAK BOLEH ada hardcode teks jawaban', () => {
  // Aturan pemilik produk: "jangan menghardcode jawaban respon bot".
  // Balasan yang dianggap salah HARUS dikosongkan agar diregenerasi AI,
  // BUKAN diganti teks statis.
  const hardcode = [
    'Stiker apa tuh? Aku kurang paham maksudnya',
    'Bisa dong, aku bisa kirim stiker. Tinggal bilang aja',
    'Waduh, maaf ya — aku nggak hafal lirik aslinya',
  ];
  const berkas = [
    fs.readFileSync(new URL('../src/skills.ts', import.meta.url), 'utf8'),
    fs.readFileSync(new URL('../src/whatsapp_cloud.ts', import.meta.url), 'utf8'),
    fs.readFileSync(new URL('../src/telegram.ts', import.meta.url), 'utf8'),
    fs.readFileSync(new URL('../src/whatsapp_baileys.ts', import.meta.url), 'utf8'),
  ];
  for (const h of hardcode) {
    for (const b of berkas) {
      assert.ok(!b.includes(h), `hardcode tidak boleh ada: "${h.slice(0, 40)}..."`);
    }
  }
});

test('vision: rantai fallback punya >=4 tier provider', () => {
  const ENV = fs.readFileSync(new URL('../src/env.ts', import.meta.url), 'utf8');
  const chain = ENV.match(/visionChain: \[([\s\S]*?)\n    \]/);
  assert.ok(chain, 'visionChain harus ada');
  const kinds = new Set([...chain[1].matchAll(/kind: '(\w+)'/g)].map(m => m[1]));
  // Hasil uji nyata 10 Okt: groq, nvidia, gemini, openrouter, opencode, cloudflare
  assert.ok(kinds.size >= 4, `harus >=4 provider berbeda, dapat: ${[...kinds].join(',')}`);
  for (const k of ['groq', 'nvidia', 'gemini', 'openrouter']) {
    assert.ok(kinds.has(k), `provider terbukti benar harus ada: ${k}`);
  }
});
