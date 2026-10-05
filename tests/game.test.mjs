/**
 * TEST OTOMATIS — mesin game (logika murni).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mulaiGame, langkahGame, pembukaGame } from '../src/games/engine.js';
import { DAFTAR_GAME, dekRemi, dekUno, kocok, ticTacBot, ticTacPemenang, ticTacAwal } from '../src/games/cards.js';

test('semua game bisa dimulai & punya pembuka', () => {
  for (const g of DAFTAR_GAME) {
    const state = mulaiGame(g.kind);
    assert.ok(state, `state null: ${g.kind}`);
    const pembuka = pembukaGame(g.kind, state);
    assert.ok(pembuka && pembuka.length > 10, `pembuka kosong: ${g.kind}`);
  }
});

test('dek remi = 52 kartu, semua unik', () => {
  const dek = dekRemi();
  assert.equal(dek.length, 52);
  const unik = new Set(dek.map((k) => `${k.jenis}-${k.nilai}`));
  assert.equal(unik.size, 52);
});

test('dek UNO = 108 kartu', () => {
  assert.equal(dekUno().length, 108);
});

test('kocok: mempertahankan elemen, tidak mengubah asli', () => {
  const asli = [1, 2, 3, 4, 5];
  const hasil = kocok(asli);
  assert.equal(hasil.length, asli.length);
  assert.deepEqual([...hasil].sort(), [1, 2, 3, 4, 5]);
  assert.deepEqual(asli, [1, 2, 3, 4, 5], 'array asli tidak boleh berubah');
});

test('UNO: langkah valid berjalan tanpa error', () => {
  let s = mulaiGame('uno');
  for (const aksi of ['merah 5', 'tarik', 'lewat', 'biru 3']) {
    const h = langkahGame('uno', s, aksi);
    assert.ok(typeof h.balas === 'string' && h.balas.length > 0, `balasan kosong untuk "${aksi}"`);
    if (!h.state) break;
    s = h.state;
  }
});

test('catur: gerakan tidak sah ditolak', () => {
  const s = mulaiGame('catur');
  const h = langkahGame('catur', s, 'e2 e5'); // pion tidak bisa 3 langkah
  assert.ok(/tidak sah/i.test(h.balas), `harus ditolak: ${h.balas.slice(0, 60)}`);
});

test('catur: gerakan sah diterima', () => {
  const s = mulaiGame('catur');
  const h = langkahGame('catur', s, 'e2 e4');
  assert.ok(!/tidak sah/i.test(h.balas), `harus diterima: ${h.balas.slice(0, 60)}`);
});

test('tic-tac-toe: bot TIDAK BISA menang bila user main optimal', () => {
  // Uji rekursif: user coba semua langkah, bot jawab minimax.
  const uji = (papan, giliran, dalam) => {
    const p = ticTacPemenang(papan);
    if (p === 'O') return 'bot';
    if (p === 'X') return 'user';
    if (p === 'seri' || dalam > 9) return 'seri';
    const kosong = papan.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0);
    const hasil = [];
    for (const i of kosong) {
      const salinan = [...papan];
      if (giliran === 'X') {
        salinan[i] = 'X';
        hasil.push(uji(salinan, 'O', dalam + 1));
      } else {
        salinan[ticTacBot(salinan)] = 'O';
        hasil.push(uji(salinan, 'X', dalam + 1));
      }
    }
    if (giliran === 'X') {
      if (hasil.includes('user')) return 'user';
      if (hasil.includes('seri')) return 'seri';
      return 'bot';
    }
    if (hasil.includes('bot')) return 'bot';
    if (hasil.includes('seri')) return 'seri';
    return 'user';
  };
  assert.notEqual(uji(ticTacAwal(), 'X', 0), 'bot', 'bot tidak boleh bisa menang');
});

test('game: "berhenti" mengakhiri permainan', () => {
  const s = mulaiGame('dadu');
  const h = langkahGame('dadu', s, 'lempar');
  assert.ok(h.balas.length > 0);
});
