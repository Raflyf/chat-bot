/**
 * TEST OTOMATIS — stiker dibalas sebagai ucapan percakapan, bukan reaksi visual (20 Nov 2026).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { adalahReaksiVisualStiker, stripMediaNarration } from '../src/skills.js';

const baca = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');

test('adalahReaksiVisualStiker menangkap komentar hewan/tokoh/gesture/ekspresi stiker', () => {
  const visual = [
    'Wah, kucingnya ngacungin jempol, pasti setuju sama obrolan kita.',
    'Anjingnya ngasih jempol nih, mantap!',
    'Wkwk kucingnya ketawa ngakak banget',
    'Wah stikernya lagi marah ya?',
    'Ekspresi kucingnya serem amat sih',
    'Si anjing kelihatan kesel banget',
    'Muka kucingnya kocak banget',
  ];
  for (const v of visual) {
    assert.equal(adalahReaksiVisualStiker(v), true, `"${v}" harus terdeteksi sebagai reaksi visual`);
  }
});

test('adalahReaksiVisualStiker tidak menangkap balasan chat natural', () => {
  const natural = [
    'Oke sip!',
    'Oke baik, lanjut ya.',
    'Sip, mantap!',
    'Haha kenapa ketawa nih?',
    'Lah kenapa marah? Cerita dong.',
    'Sabar ya, lagi kesel kenapa?',
    'Hayo ngapain, lu jago main stiker.',
  ];
  for (const n of natural) {
    assert.equal(adalahReaksiVisualStiker(n), false, `"${n}" harus lolos sebagai balasan natural`);
  }
});

test('stripMediaNarration membersihkan kalimat reaksi gesture jempol', () => {
  const out = stripMediaNarration('Wah, kucingnya ngacungin jempol, pasti setuju sama obrolan kita.');
  assert.equal(out, '');
});

test('prompt & regenerasi stiker: perlakukan sebagai pesan/ucapan + regenerate korektif', () => {
  const SKILLS = baca('src/skills.ts');
  assert.ok(SKILLS.includes('PESAN/UCAPAN'), 'prompt harus memperlakukan stiker sebagai pesan/ucapan');
  assert.ok(SKILLS.includes('DILARANG mengomentari'), 'prompt harus melarang mengomentari wujud/tokoh/gesture stiker');
  assert.match(SKILLS, /adalahReaksiVisualStiker\(reply\)/, 'describeImage harus mengecek reaksi visual untuk regenerasi');
  assert.match(SKILLS, /chatRetry\(retryMessages,/, 'harus memakai regenerasi AI korektif (tanpa hardcode)');

  for (const f of ['src/whatsapp_baileys.ts', 'src/whatsapp_cloud.ts', 'src/telegram.ts']) {
    const src = baca(f);
    assert.ok(!src.includes('Beri reaksi singkat'), `${f}: instruksi lama harus diganti`);
    assert.ok(src.includes('Balas langsung secara natural 1 kalimat pendek'), `${f}: harus pakai instruksi balas langsung`);
  }
});
