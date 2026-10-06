/**
 * TEST OTOMATIS — empati saat user sakit (06 Okt 2026).
 *
 * KENAPA: dari screenshot nyata:
 *   USER: "Aku pilek" / "Aku sakit kaki" / "Aku pusing"
 *   BOT : "Duh, angetin badan dulu aja sana." lalu "Sakit gitu sih bub, gih bub."
 *   -> bot MENYURUH PERGI saat user sakit. Empati salah total.
 *
 * AKAR: pola sadRe hanya memuat emosi (sedih/capek), TIDAK memuat keluhan fisik.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const SK = fs.readFileSync(new URL('../src/skills.ts', import.meta.url), 'utf8');

test('sakit: keluhan fisik dikenali sebagai suasana rapuh', () => {
  for (const kata of ['pilek', 'flu', 'batuk', 'demam', 'meriang', 'pusing', 'mual', 'muntah', 'diare', 'pegal', 'nyeri', 'migrain']) {
    assert.ok(SK.includes(kata), `"${kata}" harus dikenali`);
  }
});

test('sakit: "sakit kaki/kepala/perut" dikenali', () => {
  assert.match(SK, /sakit\\s\*\(\?:kepala\|perut\|kaki/, 'harus kenali sakit <bagian tubuh>');
});

test('sakit: prompt melarang menyuruh pergi', () => {
  assert.ok(SK.includes('DILARANG menyuruh dia pergi ("sana", "gih", "bub"'), 'harus larang mengusir');
});

test('sakit: prompt melarang meremehkan keluhan', () => {
  assert.ok(SK.includes('DILARANG meremehkan keluhannya'), 'harus larang meremehkan');
});

test('sakit: prompt minta tanggapi SEMUA keluhan', () => {
  assert.ok(SK.includes('tanggapi SEMUANYA sebagai satu kesatuan'), 'harus tanggapi semua');
});

test('sakit: ada penegak kode anti-mengusir', () => {
  assert.match(SK, /diaSakitFisik/, 'harus ada penegak');
  assert.match(SK, /usirRe/, 'harus ada pola usir');
});

test('sakit: contoh nada yang benar ada di prompt', () => {
  assert.ok(SK.includes('pilek plus pusing tuh nyiksa banget'), 'harus beri contoh');
});
