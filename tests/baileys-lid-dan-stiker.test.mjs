/**
 * TEST REGRESI — Resolusi LID Baileys ke Nomor Telepon & Anti-Bisu Balasan Stiker.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractPnDigits,
  hasPairedWhatsAppAccount,
  isIncompletePairingCreds,
  resolveBaileysSenderNumber,
  shouldRequestPairingCode,
} from '../src/whatsapp_baileys.js';
import { sanitizeAssistantOutput, systemPrompt } from '../src/skills.js';

test('extractPnDigits hanya menerima JID nomor telepon dan menolak LID/grup', () => {
  assert.equal(extractPnDigits('628991333323@s.whatsapp.net'), '628991333323');
  assert.equal(extractPnDigits('628991333323:0@s.whatsapp.net'), '628991333323');
  assert.equal(extractPnDigits('628991333323@hosted'), '628991333323');
  assert.equal(extractPnDigits('72533458051196@lid'), null);
  assert.equal(extractPnDigits('72533458051196@hosted.lid'), null);
  assert.equal(extractPnDigits('120363012345678901@g.us'), null);
});

test('resolveBaileysSenderNumber meresolusi @lid lewat remoteJidAlt', async () => {
  const nomor = await resolveBaileysSenderNumber(null, {
    remoteJid: '72533458051196@lid',
    remoteJidAlt: '628991333323@s.whatsapp.net',
  });
  assert.equal(nomor, '628991333323');
});

test('resolveBaileysSenderNumber meresolusi @lid lewat lidMapping.getPNForLID', async () => {
  const mockSock = {
    signalRepository: {
      lidMapping: {
        async getPNForLID(lid) {
          assert.equal(lid, '72533458051196@lid');
          return '6287789587654:0@s.whatsapp.net';
        },
      },
    },
  };
  const nomor = await resolveBaileysSenderNumber(mockSock, {
    remoteJid: '72533458051196@lid',
  });
  assert.equal(nomor, '6287789587654');
});

test('resolveBaileysSenderNumber fallback aman saat mapping belum ada + jaga JID normal & grup', async () => {
  const mockSock = {
    signalRepository: {
      lidMapping: {
        async getPNForLID() {
          return null;
        },
      },
    },
  };
  assert.equal(
    await resolveBaileysSenderNumber(mockSock, { remoteJid: '72533458051196@lid' }),
    '72533458051196',
  );
  assert.equal(
    await resolveBaileysSenderNumber(null, { remoteJid: '628991333323@s.whatsapp.net' }),
    '628991333323',
  );
  assert.equal(
    await resolveBaileysSenderNumber(null, { remoteJid: '120363012345678901@g.us' }),
    '120363012345678901',
  );
});

test('stiker kucing tidak dikosongkan oleh anti-konfabulasi atau filter generik', () => {
  const balasanSah = [
    'Haha tatapan kucing orennya serem amat sih',
    'Kucing kecil itu lagi duduk santai di kasur',
    'Kucing yang natap tajam banget nih',
  ];
  for (const b of balasanSah) {
    assert.equal(sanitizeAssistantOutput(b, '[Stiker WhatsApp]', [], true), b, `"${b}" tidak boleh hilang`);
  }
});

test('konfabulasi teks & balasan stiker ngawur tetap dibuang', () => {
  assert.equal(sanitizeAssistantOutput('Oh iya, kamu suka main ML.', 'Iya'), '');
  assert.equal(sanitizeAssistantOutput('Patrick lagi marah?', '[Stiker WhatsApp]', [], true), '');
  assert.equal(
    sanitizeAssistantOutput('Iya salah liat, itu kucing yang nggak bisa nyanyi', '[Stiker WhatsApp]', [], true),
    '',
  );
});

test('systemPrompt tidak mengaktifkan ENERGI RENDAH dan memakai register gaul pada slang santai', () => {
  const history = [
    { role: 'user', content: 'tes' },
    { role: 'assistant', content: 'Halo.' },
  ];
  for (const msg of ['kaku bet jir', 'bales woyy', 'loh malah ilang']) {
    const prompt = systemPrompt({ history, corrections: [], summary: null, chatId: 'wa_628991333323' }, null, msg);
    assert.ok(!prompt.includes('[ENERGI RENDAH'), `"${msg}" tidak boleh dianggap energi rendah`);
    assert.ok(prompt.includes('santai/gaul natural'), `"${msg}" harus memicu gaya santai/gaul natural`);
  }
});

test('buangBocorInstruksi membersihkan janji meta kaku ala bot CS', () => {
  const robotik = [
    ['Waduh, maaf ya. Aku coba lebih santai dari sini, biar ngobrolnya nggak kaku lagi.', 'kaku bet jir'],
    ['Oke, siap. Aku coba lebih santai dan nggak kaku lagi.', 'jangan minta maaf mulu deh bott'],
    ['Iya, aku coba lebih rileks dan natural dari sini.', 'santai dulu gk sih'],
  ];
  for (const [balasan, pesanUser] of robotik) {
    assert.equal(sanitizeAssistantOutput(balasan, pesanUser), '', `"${balasan}" harus dibuang`);
  }
  assert.equal(sanitizeAssistantOutput('Siap, gue lepas mode sopan santunnya.', 'jangan minta maaf mulu deh bott'), '');
  assert.equal(sanitizeAssistantOutput('Santai aja, gue juga lagi mode hemat energi nih.', 'santai dulu gk sih'), '');
  assert.equal(sanitizeAssistantOutput('Halo, aku di sini.', 'tes'), '');
  const tanpaKoma = sanitizeAssistantOutput('Yaa maap, tadi kebawa formal. Santai aja deh, mau ngobrolin apa?', 'kaku bet jir');
  assert.ok(tanpaKoma && !/[,;:]$/.test(tanpaKoma), `tidak boleh menyisakan koma menggantung: ${tanpaKoma}`);
});

test('shouldRequestPairingCode tidak memicu pairing ulang saat fase restart 515 (account terisi walau registered false)', () => {
  // Kredensial bersih tanpa akun & nomor tersedia -> boleh minta kode pairing
  assert.equal(shouldRequestPairingCode({ registered: false }, '6287789587654'), true);
  assert.equal(hasPairedWhatsAppAccount({ registered: false }), false);

  // Fase 515 tepat setelah pair-success: registered masih false, tapi account & me (:device) sudah terisi -> WAJIB false
  const fase515Creds = {
    registered: false,
    account: { details: 'mock' },
    me: { id: '6287789587654:12@s.whatsapp.net' },
  };
  assert.equal(hasPairedWhatsAppAccount(fase515Creds), true);
  assert.equal(shouldRequestPairingCode(fase515Creds, '6287789587654'), false);

  // Hanya punya me.id dengan companion device :device -> sudah terpairing
  assert.equal(
    shouldRequestPairingCode({ registered: false, me: { id: '6287789587654:4@s.whatsapp.net' } }, '6287789587654'),
    false,
  );

  // Sudah registered penuh -> false
  assert.equal(shouldRequestPairingCode({ registered: true }, '6287789587654'), false);

  // Tidak ada nomor telepon -> false
  assert.equal(shouldRequestPairingCode({ registered: false }, ''), false);
});

test('isIncompletePairingCreds mendeteksi sisa requestPairingCode yang gagal tanpa menandai akun valid', () => {
  assert.equal(isIncompletePairingCreds({ registered: false, pairingCode: 'PM796NL3', me: { id: '6287789587654@s.whatsapp.net' } }), true);
  assert.equal(isIncompletePairingCreds({ registered: false, me: { id: '6287789587654@s.whatsapp.net' } }), true);
  assert.equal(isIncompletePairingCreds({ registered: false }), false);
  assert.equal(
    isIncompletePairingCreds({
      registered: false,
      pairingCode: 'PM796NL3',
      account: { details: 'ok' },
      me: { id: '6287789587654:12@s.whatsapp.net' },
    }),
    false,
  );
  assert.equal(isIncompletePairingCreds({ registered: true, me: { id: '6287789587654:12@s.whatsapp.net' } }), false);
});
