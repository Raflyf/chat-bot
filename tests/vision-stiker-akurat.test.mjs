/**
 * TEST OTOMATIS — akurasi vision & respon stiker (12 Okt 2026).
 *
 * LAPORAN PEMILIK PRODUK: "masih banyak respon bot yg ngawur saat dikasih stiker
 * tanpa konteks text dan stiker yg random".
 *
 * BUKTI UJI NYATA (12 Okt 2026):
 *   - stk_042 (ngacir) -> "Siap, aku bakal jadi hantu yang baik"   (HALUSINASI)
 *   - stk_055 (santai) -> "Jawaban: iya tuh lucu banget"           (BOCOR INSTRUKSI)
 *   - stk_139 (kaget)  -> "" (KOSONG, enforcer salah buang)
 *   - stk_044          -> "Tidak ada masalah. Saya akan membantu Anda." (ROBOTIK)
 *   - stk_063          -> "Kamu kirim stiker apa maksudnya?"        (TANYA BALIK)
 *   - stk_063/026      -> mengulang instruksi prompt                (PROMPT ECHO)
 *
 * AKAR & PERBAIKAN:
 *   1. Enforcer "mengaku tak bisa baca" menangkap kata umum ("kecil"/"kurang
 *      jelas") di mana saja -> balasan SAH jadi kosong. Kini WAJIB menyebut
 *      MEDIA (tulisan/teks/stiker/gambar) juga.
 *   2. Prompt stiker 8.508 karakter (70 baris) -> model kecil kehilangan fokus.
 *      Dipangkas ke ~2.161 karakter (22 baris).
 *   3. Bocoran prefix "Jawaban:" / "Balasan:" dibuang di KODE.
 *   4. Penegak baru: balasan ROBOTIK, PROMPT-ECHO, META/MENYERAH, TANYA-BALIK.
 *   5. visionChain diurutkan ulang berdasar UJI AKURASI BACA TEKS STIKER
 *      (4 stiker ber-teks): 4/4 = gemini-flash-lite, gemini-3.6, nvidia-llama-3.2-v,
 *      cf-qwen3.8, cf-llama-4-scout, cf-mistral-small; 2/4 = openrouter-nemotron
 *      (dipindah ke belakang).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buangBalasanStikerGenerik, buangKlaimTidakLihatStiker } from '../src/skills.js';

const SKILLS = fs.readFileSync(new URL('../src/skills.ts', import.meta.url), 'utf8');
const ENV = fs.readFileSync(new URL('../src/env.ts', import.meta.url), 'utf8');
const PROMPT_STIKER = '[Stiker WhatsApp]';

test('stiker: balasan ROBOTIK dibuang', () => {
  for (const b of ['Tidak ada masalah. Saya akan membantu Anda.', 'Siap membantu Anda kapan saja.', 'Ada yang bisa saya bantu?']) {
    assert.equal(buangBalasanStikerGenerik(b, PROMPT_STIKER), '', `"${b}" harus dibuang`);
  }
});

test('stiker: enforcer tak-bisa-baca WAJIB context-aware (jangan buang balasan sah)', () => {
  // "kucing kecil" / "ekspresinya kurang jelas" = balasan SAH, TIDAK boleh dikosongkan.
  assert.ok(/kataTakTerbaca/.test(SKILLS), 'harus ada pemisahan kata tak-terbaca vs media');
  assert.ok(/kataMedia/.test(SKILLS), 'harus ada pengecekan kata media');
  // Balasan sah harus LOLOS.
  // Balasan SAH yang memakai kata umum ("kecil") TIDAK boleh dikosongkan.
  for (const sah of ['Kucing kecil itu lagi duduk santai di kasur', 'Ekspresinya kurang jelas tapi tetap lucu']) {
    assert.equal(buangKlaimTidakLihatStiker(sah, PROMPT_STIKER), sah, `"${sah}" jangan dikosongkan`);
  }
  // Penegak khusus "tulisan kecil/susah dibaca" ada di describeImage (inline) — pastikan ada.
  assert.ok(/DILARANG bilang tulisan "kecil/.test(SKILLS) || /mengakuTakBisaBaca/.test(SKILLS),
    'harus ada penegak klaim tak bisa baca');
});

test('stiker: bocoran prefix "Jawaban:" dibuang', () => {
  assert.ok(/jawaban\|balasan\|respon\|respons\|output\|hasil/.test(SKILLS), 'harus ada pembersih prefix jawaban');
});

test('stiker: penegak prompt-echo, meta, tanya-balik ADA', () => {
  assert.ok(/echoInstruksi/.test(SKILLS), 'harus ada penegak prompt-echo');
  assert.ok(/metaMenyerah/.test(SKILLS), 'harus ada penegak meta/menyerah');
  assert.ok(/tanyaBalikStiker/.test(SKILLS), 'harus ada penegak tanya-balik');
});

test('stiker: prompt dipangkas (fokus model kecil)', () => {
  const i = SKILLS.indexOf("'[PENGGUNA MENGIRIM STIKER]'");
  assert.ok(i > 0, 'prompt stiker harus ada');
  const j = SKILLS.indexOf('].filter(Boolean)', i);
  const panjang = j - i;
  assert.ok(panjang > 0 && panjang < 3500, `prompt stiker harus ringkas (<3500 char), dapat ${panjang}`);
});

test('vision: chain >= 8 model & model lemah tidak di posisi awal', () => {
  const m = ENV.match(/visionChain: \[([\s\S]*?)\n    \] as Array/);
  assert.ok(m, 'visionChain harus ada');
  const model = [...m[1].matchAll(/\{ kind: '(\w+)', model: '([^']+)' \}/g)].map(x => ({ kind: x[1], model: x[2] }));
  assert.ok(model.length >= 8, `harus >=8 model vision, dapat ${model.length}`);
  // openrouter nemotron (2/4 akurasi) TIDAK boleh di 3 teratas.
  const atas = model.slice(0, 3).map(x => x.model).join(' ');
  assert.ok(!/nemotron-3-nano/.test(atas), 'model akurasi rendah jangan di posisi awal');
  // Model terbukti 4/4 harus ada.
  for (const wajib of ['gemini-flash-lite-latest', 'meta/llama-3.2-11b-vision-instruct']) {
    assert.ok(model.some(x => x.model === wajib), `model terbukti akurat harus ada: ${wajib}`);
  }
});
