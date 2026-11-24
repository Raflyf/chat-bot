/**
 * TEST OTOMATIS — Sistem Balasan Voice Note (VN) & Nyanyi Acapella.
 *
 * Menguji:
 * 1. Deteksi permintaan nyanyi acapella, permintaan VN eksplisit, dan opt-out teks.
 * 2. Cadence spontan ~5:1 berbasis penanda durable `[VN terkirim: ...]` di riwayat.
 * 3. Penjaga suasana ketat: pertanyaan rumit, koding, formal, sedih, link/kode/daftar,
 *    hasil pencarian web, dan output sistem TIDAK pernah memicu VN spontan.
 * 4. Pembersih teks TTS bahasa Indonesia (buang markdown/emoji/stage direction, ekspansi singkatan).
 * 5. Encoder WAV/PCM -> Ogg Opus (WASM) dan remuxer WebM Opus -> Ogg Opus (tanpa ffmpeg).
 * 6. Integrasi jalur kirim WA Baileys, WA Cloud API, Telegram, prompt `skills.ts`, dan perbaikan stiker.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  decideVoiceReply,
  detectSingRequest,
  detectExplicitVnRequest,
  detectTextOnlyPreference,
  detectVnRetryMode,
  isReplySpeakable,
  prepareTextForTts,
  encodeWavOrPcmToOggOpus,
  remuxWebmOpusToOgg,
} from '../src/voice.js';
import {
  encodeMarkers,
  appendDurableMarkers,
  stripVnMarker,
  isVnMarker,
  assistantTurnsSinceLastVn,
} from '../src/markers.js';
import { systemPrompt, sanitizeAssistantOutput } from '../src/skills.js';

function makeCasualHistory(assistantTurnsAfterVn, includePriorVn = true) {
  const hist = [];
  if (includePriorVn) {
    hist.push({ role: 'user', content: 'halo bro' });
    hist.push({ role: 'assistant', content: 'Haloo juga nih!\n[VN terkirim: chat]' });
  }
  for (let i = 0; i < assistantTurnsAfterVn; i++) {
    hist.push({ role: 'user', content: `chat santai ke-${i + 1}` });
    hist.push({ role: 'assistant', content: `Iyaa santai aja bro, aman kok pesan ke-${i + 1}.` });
  }
  return hist;
}

test('voice intent: deteksi permintaan nyanyi acapella dan tolak negatif/meta', () => {
  for (const s of [
    'coba kamu nyanyikan lagu balonku dong',
    'nyanyiin lagu pop bentar',
    'nyanyi dong buat seru-seruan',
    'tolong nyanyikan satu bait lagu',
    'coba nyanyi acapella',
  ]) {
    assert.equal(detectSingRequest(s), true, `harus terdeteksi nyanyi: "${s}"`);
  }

  for (const s of [
    'jangan nyanyi ya',
    'siapa penyanyi lagu Sial?',
    '.play wali',
    'putar lagu mahalini',
    'arti lirik lagu ini apa?',
  ]) {
    assert.equal(detectSingRequest(s), false, `TIDAK boleh terdeteksi nyanyi: "${s}"`);
  }
});

test('voice intent: deteksi permintaan VN eksplisit dan opt-out teks', () => {
  for (const s of [
    'kirim vn dong',
    'balas pakai vn ya',
    'coba jawab pake suara',
    'mau denger suaramu dong',
    'vn dong biar ga bosen',
  ]) {
    assert.equal(detectExplicitVnRequest(s), true, `harus terdeteksi VN eksplisit: "${s}"`);
  }

  for (const s of ['jangan vn ya', 'teks aja', 'ketik aja ga usah vn', 'tulis aja']) {
    assert.equal(detectTextOnlyPreference(s), true, `harus terdeteksi opt-out teks: "${s}"`);
    assert.equal(detectExplicitVnRequest(s), false);
    assert.equal(detectSingRequest(s), false);
  }
});

test('voice cadence: rasio ~5:1 durable dan cooldown bekerja akurat', () => {
  const casualUser = 'wkwk bener juga sih, santai dulu lah kita';
  const casualReply = 'Haha iya dong, santai dulu aja mumpung hari ini masih panjang!';

  // Baru 2 balasan teks sejak VN terakhir -> masih cooldown
  const d2 = decideVoiceReply({
    userText: casualUser,
    reply: casualReply,
    history: makeCasualHistory(2),
    enabled: true,
    rng: () => 0.0,
  });
  assert.equal(d2.sendVn, false);
  assert.equal(d2.reason, 'cooldown');

  // Sudah 5 balasan teks sejak VN terakhir (rasio 5:1) -> kirim VN spontan
  const d5 = decideVoiceReply({
    userText: casualUser,
    reply: casualReply,
    history: makeCasualHistory(5),
    enabled: true,
    rng: () => 0.5,
  });
  assert.equal(d5.sendVn, true);
  assert.equal(d5.mode, 'chat');
  assert.equal(d5.reason, 'spontaneous_vn');

  // >= 6 balasan teks sejak VN terakhir -> pasti kirim (prob = 1.0) walau rng tinggi
  const d6 = decideVoiceReply({
    userText: 'lagi ngapain nih?',
    reply: 'Lagi santai aja nih sambil nemenin kamu ngobrol hari ini.',
    history: makeCasualHistory(6),
    enabled: true,
    rng: () => 0.99,
  });
  assert.equal(d6.sendVn, true);
  assert.equal(d6.reason, 'spontaneous_vn');

  // User baru kirim VN -> boleh balas VN lebih awal (>= 2 balasan teks)
  const dFromVn = decideVoiceReply({
    userText: 'halo bro lagi santai gak',
    reply: 'Santai banget nih, ada cerita seru apa hari ini?',
    history: makeCasualHistory(2),
    fromUserVoiceNote: true,
    enabled: true,
    rng: () => 0.1,
  });
  assert.equal(dFromVn.sendVn, true);
  assert.equal(dFromVn.reason, 'spontaneous_vn');
});

test('voice guard: DILARANG kirim VN spontan saat serius, rumit, sedih, koding, web, atau jawaban panjang', () => {
  const readyHist = makeCasualHistory(8);

  const blockedCases = [
    ['jelaskan cara kerja indexing PostgreSQL', 'Indexing PostgreSQL memakai B-Tree untuk mempercepat pencarian baris.'],
    ['tolong bantu debug error TypeScript ini', 'Cek dulu tipe return fungsimu, biasanya ada properti yang undefined.'],
    ['aku lagi sedih banget hari ini baru putus', 'Pelan-pelan ya, nggak apa-apa banget kok kalau lagi butuh waktu sendiri.'],
    ['buatkan surat resmi untuk klien perusahaan', 'Baik, ini draf singkat surat resmi untuk klien perusahaanmu.'],
    ['wkwk santai aja', 'Cek langsung di https://example.com ya biar jelas infonya.'],
    ['wkwk santai aja', 'Ini contohnya:\n```ts\nconst x = 1;\n```'],
    ['wkwk santai aja', 'Ada beberapa hal:\n1. Pertama tidur cukup\n2. Kedua minum air putih'],
    ['wkwk santai aja', 'Oke.'],
    ['wkwk santai aja', 'A '.repeat(150)],
  ];

  for (const [u, r] of blockedCases) {
    const res = decideVoiceReply({
      userText: u,
      reply: r,
      history: readyHist,
      enabled: true,
      rng: () => 0.0,
    });
    assert.equal(res.sendVn, false, `TIDAK boleh VN spontan untuk "${u}" / "${r.slice(0, 40)}"`);
  }

  // Pencarian web faktual -> tetap teks
  const webRes = decideVoiceReply({
    userText: 'harga emas hari ini',
    reply: 'Hari ini harga emas Antam berada di kisaran satu juta lima ratus ribu per gram.',
    history: readyHist,
    hasWebResults: true,
    enabled: true,
    rng: () => 0.0,
  });
  assert.equal(webRes.sendVn, false);

  // Explicit opt-out tetap menang meski sudah lewat 8 turn
  const optOut = decideVoiceReply({
    userText: 'jangan vn ya, teks aja santai kok',
    reply: 'Siapp aman, aku balas pakai teks aja ya!',
    history: readyHist,
    enabled: true,
    rng: () => 0.0,
  });
  assert.equal(optOut.sendVn, false);
  assert.equal(optOut.reason, 'text_only_requested');
});

test('voice explicit: permintaan nyanyi & VN langsung lolos ke mode tepat', () => {
  const singRes = decideVoiceReply({
    userText: 'coba kamu nyanyikan lagu balonku dong',
    reply: 'Balonku ada lima, rupa-rupa warnanya, hijau kuning kelabu, merah muda dan biru!',
    history: makeCasualHistory(0),
    enabled: true,
  });
  assert.equal(singRes.sendVn, true);
  assert.equal(singRes.mode, 'sing');
  assert.equal(singRes.reason, 'explicit_sing');

  const vnRes = decideVoiceReply({
    userText: 'balas pakai vn dong',
    reply: 'Haloo, ini aku kirim voice note ya biar obrolannya makin seru!',
    history: makeCasualHistory(0),
    enabled: true,
  });
  assert.equal(vnRes.sendVn, true);
  assert.equal(vnRes.mode, 'chat');
  assert.equal(vnRes.reason, 'explicit_vn');
});

test('voice text prep: buang markdown/emoji/stage-direction dan ekspansi singkatan Indonesia', () => {
  const raw = '*berdehem* Wkwkwk iyaa bgt bro yg dgn itu blm kelar [[sticker:😹]] 😂';
  const cleaned = prepareTextForTts(raw, 'chat');
  assert.ok(!cleaned.includes('*'), 'markdown * harus hilang');
  assert.ok(!cleaned.includes('[[sticker'), 'tag stiker harus hilang');
  assert.ok(!cleaned.includes('😂'), 'emoji harus hilang');
  assert.ok(!/berdehem/i.test(cleaned), 'stage direction *berdehem* harus hilang');
  assert.ok(cleaned.includes('haha'), 'wkwk diubah ke haha');
  assert.ok(cleaned.includes('banget'), 'bgt diubah ke banget');
  assert.ok(cleaned.includes('yang'), 'yg diubah ke yang');
  assert.ok(cleaned.includes('dengan'), 'dgn diubah ke dengan');
  assert.ok(cleaned.includes('belum'), 'blm diubah ke belum');
  assert.equal(isReplySpeakable('```js\nconsole.log(1)\n```', true), false);
});

test('markers: durable VN marker roundtrip & hitungan giliran', () => {
  const encoded = encodeMarkers({ sticker: '😹', vn: 'chat', riddle: 'Apel' });
  assert.equal(encoded, 'sticker:😹|riddle:Apel|vn:chat');

  const combined = appendDurableMarkers('Haloo bro!', { vn: 'sing' });
  assert.equal(isVnMarker(combined), true);
  assert.equal(stripVnMarker(combined), 'Haloo bro!');

  const turns = assistantTurnsSinceLastVn(makeCasualHistory(5));
  assert.equal(turns, 5);
});

test('audio encoder: WAV 24kHz mono PCM -> Ogg Opus WASM menghasilkan OggS + OpusHead valid', async () => {
  // Buat WAV RIFF PCM 16-bit mono 24kHz berdurasi 1 detik (gelombang sinus 440Hz)
  const sr = 24000;
  const numSamples = sr;
  const dataSize = numSamples * 2;
  const wav = Buffer.alloc(44 + dataSize);
  wav.write('RIFF', 0, 'ascii');
  wav.writeUInt32LE(36 + dataSize, 4);
  wav.write('WAVE', 8, 'ascii');
  wav.write('fmt ', 12, 'ascii');
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); // PCM
  wav.writeUInt16LE(1, 22); // mono
  wav.writeUInt32LE(sr, 24);
  wav.writeUInt32LE(sr * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36, 'ascii');
  wav.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < numSamples; i++) {
    const sample = Math.round(Math.sin((2 * Math.PI * 440 * i) / sr) * 8000);
    wav.writeInt16LE(sample, 44 + i * 2);
  }

  const res = await encodeWavOrPcmToOggOpus(wav, 'audio/wav', 'voip', 24);
  assert.equal(res.ogg.subarray(0, 4).toString('ascii'), 'OggS');
  assert.ok(res.ogg.includes(Buffer.from('OpusHead')), 'harus ada OpusHead');
  assert.ok(res.ogg.includes(Buffer.from('OpusTags')), 'harus ada OpusTags');
  assert.ok(res.ogg.length > 500, 'ukuran Ogg Opus harus berisi frame audio');
  assert.equal(res.durationSec, 1);
  assert.equal(res.waveform.length, 64);
});

test('audio remuxer: WebM Opus sintetis -> Ogg Opus lossless valid', () => {
  // Buat stream EBML minimal: Segment -> Tracks/TrackEntry/CodecPrivate(OpusHead) + Cluster/SimpleBlock
  const opusHead = Buffer.alloc(19);
  opusHead.write('OpusHead', 0, 'ascii');
  opusHead[8] = 1;
  opusHead[9] = 1;
  opusHead.writeUInt16LE(312, 10);
  opusHead.writeUInt32LE(24000, 12);
  opusHead.writeInt16LE(0, 16);
  opusHead[18] = 0;

  // CodecPrivate element: ID 0x63A2, size 19 (0x80 | 19 = 0x93)
  const codecPrivateEl = Buffer.concat([Buffer.from([0x63, 0xa2, 0x93]), opusHead]);
  // TrackEntry: ID 0xAE, size = codecPrivateEl.length (0x80 | len)
  const trackEntryEl = Buffer.concat([Buffer.from([0xae, 0x80 | codecPrivateEl.length]), codecPrivateEl]);
  // Tracks: ID 0x1654AE6B, size = trackEntryEl.length
  const tracksEl = Buffer.concat([Buffer.from([0x16, 0x54, 0xae, 0x6b, 0x80 | trackEntryEl.length]), trackEntryEl]);

  // 50 SimpleBlocks @ 20ms SILK (TOC 0x08 -> config 1, 20ms = 960 samples @ 48kHz -> total 1 detik)
  const blocks = [];
  for (let i = 0; i < 50; i++) {
    // SimpleBlock payload: track VINT (0x81 = track 1), timecode (2 bytes), flags (0x80 = keyframe, no lacing), Opus packet
    const pkt = Buffer.from([0x08, 0xaa, 0xbb, 0xcc, 0xdd, 0xee]);
    const body = Buffer.concat([Buffer.from([0x81, 0x00, i * 20 > 255 ? 0 : i * 20, 0x80]), pkt]);
    blocks.push(Buffer.concat([Buffer.from([0xa3, 0x80 | body.length]), body]));
  }
  const clusterBody = Buffer.concat(blocks);
  // Cluster: ID 0x1F43B675, unknown size (0x01FFFFFFFFFFFFFF)
  const clusterEl = Buffer.concat([
    Buffer.from([0x1f, 0x43, 0xb6, 0x75, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]),
    clusterBody,
  ]);
  // Segment: ID 0x18538067, unknown size
  const webm = Buffer.concat([
    Buffer.from([0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]),
    tracksEl,
    clusterEl,
  ]);

  const res = remuxWebmOpusToOgg(webm);
  assert.equal(res.ogg.subarray(0, 4).toString('ascii'), 'OggS');
  assert.ok(res.ogg.includes(Buffer.from('OpusHead')));
  assert.ok(res.ogg.includes(Buffer.from('OpusTags')));
  assert.equal(res.durationSec, 1);
  assert.equal(res.waveform.length, 64);
});

test('wiring: semua kanal & prompt terhubung dengan benar tanpa membuka .play', () => {
  const baileys = fs.readFileSync(new URL('../src/whatsapp_baileys.ts', import.meta.url), 'utf8');
  const cloud = fs.readFileSync(new URL('../src/whatsapp_cloud.ts', import.meta.url), 'utf8');
  const tg = fs.readFileSync(new URL('../src/telegram.ts', import.meta.url), 'utf8');
  const mem = fs.readFileSync(new URL('../src/memory.ts', import.meta.url), 'utf8');
  const skills = fs.readFileSync(new URL('../src/skills.ts', import.meta.url), 'utf8');

  assert.ok(baileys.includes('sendWhatsAppVoiceNoteSafe') && baileys.includes('ptt: true'));
  assert.ok(cloud.includes('sendWhatsAppCloudVoiceNoteSafe') && cloud.includes('voice: true'));
  assert.ok(tg.includes('sendTelegramVoiceNoteSafe') && tg.includes('bot.sendVoice'));
  assert.ok(mem.includes("else if (key === 'vn')"));

  // Prompt nyanyi aktif saat user minta nyanyi, tidak aktif di chat biasa
  const singPrompt = systemPrompt(undefined, null, 'coba nyanyikan lagu balonku dong');
  assert.ok(singPrompt.includes('MODE NYANYI ACAPELLA VIA VN'));
  const normalPrompt = systemPrompt(undefined, null, 'halo lagi ngapain');
  assert.ok(!normalPrompt.includes('MODE NYANYI ACAPELLA VIA VN'));
  assert.ok(!normalPrompt.includes('MODE KIRIM VN'));

  // Perbaikan stiker: contoh & panduan tawa di prompt aktif tidak lagi mengarahkan ke 😂 (yang bermood kesal)
  assert.ok(!normalPrompt.includes('[[sticker:😂]]'), 'contoh prompt stiker tidak boleh memakai 😂 (ditolak mood filter)');
  assert.ok(skills.includes('-> 🤣/😹'), 'panduan tawa stiker harus memakai 🤣/😹');

  // Rantai TTS natural: chat VN memprioritaskan Gemini TTS (bukan Edge-TTS robotik) dengan 3 bucket model
  const voiceSrc = fs.readFileSync(new URL('../src/voice.ts', import.meta.url), 'utf8');
  assert.ok(voiceSrc.includes('config.geminiTtsBackupModel'), 'harus mendukung bucket cadangan gemini-2.5-flash-preview-tts');
  assert.ok(voiceSrc.includes('if (!config.voiceEdgeFallback)'), 'Edge-TTS hanya aktif jika VOICE_EDGE_FALLBACK=1');
  assert.match(skills, /stripVnMarker\(\s*h\.content\.replace/, 'buildMessages wajib membuang [VN terkirim: ...] dari history sebelum dikirim ke model');
});

test('regression screenshot: [VN terkirim: sing] tidak boleh bocor ke user & "ulangii"/"ulangg" mengulang VN', () => {
  // 1. Jika model nekat menulis [VN terkirim: sing], sanitizeAssistantOutput wajib membuangnya
  const sanitized = sanitizeAssistantOutput(
    'If the world was ending, I wanna be next to you\n\n[VN terkirim: sing]',
    'ulangii',
  );
  assert.ok(!sanitized.includes('[VN terkirim'), 'marker [VN terkirim] tidak boleh pernah lolos ke output user');

  // 2. "ulangii" / "ulangg" setelah VN sing terakhir harus mengulang mode sing sebagai VN
  const recentSingHistory = [
    { role: 'user', content: 'coba nyanyikan die with a smile' },
    { role: 'assistant', content: 'If the world was ending...\n[VN terkirim: sing]' },
    { role: 'user', content: 'ga bener nadanya' },
    { role: 'assistant', content: 'Waduh iya deh nadanya meleset ya.' },
  ];
  assert.equal(detectVnRetryMode('ulangii', recentSingHistory), 'sing');
  assert.equal(detectVnRetryMode('ulangg', recentSingHistory), 'sing');
  assert.equal(detectVnRetryMode('coba lagi', recentSingHistory), 'sing');

  const retryDecision = decideVoiceReply({
    userText: 'ulangii',
    reply: 'If the world was ending, I wanna be next to you, hold you for just a while.',
    history: recentSingHistory,
    enabled: true,
  });
  assert.equal(retryDecision.sendVn, true);
  assert.equal(retryDecision.mode, 'sing');
  assert.equal(retryDecision.reason, 'explicit_sing');

  // Prompt saat "ulangii" ikut mengaktifkan MODE NYANYI ACAPELLA VIA VN
  const retryPrompt = systemPrompt({ history: recentSingHistory }, null, 'ulangii');
  assert.ok(retryPrompt.includes('MODE NYANYI ACAPELLA VIA VN'));

  // 3. "ulangii" tanpa riwayat VN baru TIDAK boleh memicu VN
  assert.equal(detectVnRetryMode('ulangii', [{ role: 'assistant', content: 'Halo biasa aja' }]), null);
});
