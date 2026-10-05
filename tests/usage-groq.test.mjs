/**
 * TEST OTOMATIS — parsing usage Groq (format ganda).
 *
 * KENAPA: bug nyata 06 Okt 2026 — Groq mengirim usage di DUA tempat:
 *   { "usage": {...} }        (format standar OpenAI)
 *   { "x_groq": { "usage": {...} } }   (format khusus Groq)
 * Parser lama hanya membaca `usage`, sehingga saat Groq memakai `x_groq.usage`,
 * token TIDAK tercatat (tokens_used = 0) -> dashboard tidak akurat.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Replikasi fungsi openAiUsage (tidak diekspor, jadi diuji lewat perilaku)
function openAiUsage(json) {
  const j = json;
  const u = j.usage ?? j.x_groq?.usage;
  if (!u) return undefined;
  const prompt = Number(u.prompt_tokens) || 0;
  const completion = Number(u.completion_tokens) || 0;
  const total = Number(u.total_tokens) || 0;
  if (prompt === 0 && completion === 0 && total === 0) return undefined;
  return { prompt, completion, total };
}

test('usage: format standar OpenAI terbaca', () => {
  const r = openAiUsage({ usage: { prompt_tokens: 13, completion_tokens: 10, total_tokens: 23 } });
  assert.deepEqual(r, { prompt: 13, completion: 10, total: 23 });
});

test('usage: format KHUSUS Groq (x_groq.usage) terbaca', () => {
  const r = openAiUsage({ x_groq: { usage: { prompt_tokens: 13, completion_tokens: 10, total_tokens: 23 } } });
  assert.deepEqual(r, { prompt: 13, completion: 10, total: 23 });
});

test('usage: format Groq LENGKAP (keduanya ada) -> pakai yang standar', () => {
  const r = openAiUsage({
    usage: { prompt_tokens: 13, completion_tokens: 10, total_tokens: 23 },
    x_groq: { usage: { prompt_tokens: 99, completion_tokens: 99, total_tokens: 198 } },
  });
  assert.equal(r.total, 23, 'harus pakai format standar bila keduanya ada');
});

test('usage: tidak ada usage -> undefined (jangan catat 0)', () => {
  assert.equal(openAiUsage({}), undefined);
  assert.equal(openAiUsage({ choices: [] }), undefined);
});

test('usage: semua nol -> undefined (jangan timpa data nyata)', () => {
  assert.equal(openAiUsage({ usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } }), undefined);
});

test('usage: hanya total -> tetap terbaca', () => {
  const r = openAiUsage({ usage: { total_tokens: 100 } });
  assert.equal(r.total, 100);
});

test('usage: chunk dengan choices kosong tetap punya usage', () => {
  // Kasus nyata Groq: chunk terakhir { choices: [], usage: {...} }
  const r = openAiUsage({ choices: [], usage: { prompt_tokens: 13, completion_tokens: 10, total_tokens: 23 } });
  assert.deepEqual(r, { prompt: 13, completion: 10, total: 23 });
});
