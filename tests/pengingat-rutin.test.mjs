/**
 * TEST OTOMATIS — pengingat berulang (06 Okt 2026).
 *
 * KENAPA: dari riwayat chat NYATA ditemukan:
 *   - "hapus jadwal rutin" TIDAK dikenali -> bot jawab "Belum ada jadwal rutin
 *     yang tersimpan" padahal ada, dan pengingat TIDAK terhapus.
 *   - Konfirmasi tidak menyebut pengulangan ("tiap hari") sehingga user tidak
 *     tahu pengingatnya berulang.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { deteksiPermintaanUbah } from '../src/reminder-ubah.js';

const SRC = fs.readFileSync(new URL('../src/notes.ts', import.meta.url), 'utf8');
const UBAH = fs.readFileSync(new URL('../src/reminder-ubah.ts', import.meta.url), 'utf8');

test('hapus: "hapus jadwal rutin" terdeteksi sebagai BATAL', () => {
  for (const t of ['hapus jadwal rutin', 'hapus jadwal', 'hapus pengingat untuk bangun', 'batalin jadwal bangun', 'buang jadwal']) {
    const p = deteksiPermintaanUbah(t);
    assert.ok(p, `"${t}" harus terdeteksi`);
    assert.equal(p.aksi, 'batal', `"${t}" harus aksi=batal`);
  }
});

test('hapus: "hapus tugas" TIDAK dianggap batal pengingat', () => {
  // "hapus tugas" harus ditangani jalur tugas, bukan pengingat.
  const p = deteksiPermintaanUbah('hapus tugas nomor 1');
  assert.ok(!p || p.aksi !== 'batal', '"hapus tugas" TIDAK boleh jadi batal pengingat');
});

test('hapus: pola mencakup jadwal/rutin/alarm/timer', () => {
  assert.match(UBAH, /pengingat\|reminder\|jadwal\|rutin\|alarm\|timer/, 'pola harus mencakup jadwal/rutin');
});

test('konfirmasi: menyebut pengulangan dengan label ramah', () => {
  assert.match(SRC, /labelUlang/, 'harus pakai labelUlang()');
  assert.match(SRC, /tiap hari/, 'harus ada contoh label');
});

test('konfirmasi: pengingat SEKALI tidak menyebut berulang', () => {
  // Blok harus membedakan: berulang vs sekali
  assert.match(SRC, /labelUlang\s*\?/, 'harus bercabang bila berulang');
});

test('hapus: perubahan tidak menyentuh jalur "batalin rapat"', () => {
  const p = deteksiPermintaanUbah('batalin rapat');
  assert.ok(p, '"batalin rapat" harus terdeteksi');
  assert.equal(p.aksi, 'batal');
});

test('pilihTarget batal: target spesifik ("menit ON") tepat sasaran dan tidak salah hapus "bangun"', async () => {
  const { pilihTarget } = await import('../src/reminder-ubah.js');
  const daftar = [
    { id: 1, message: 'bangun', due_at: '2026-11-21T06:00:00Z', status: 'pending' },
    { id: 2, message: 'menit ON', due_at: '2026-11-21T12:02:00Z', status: 'pending' },
  ];
  const p = deteksiPermintaanUbah('hapus pengingat menit ON');
  assert.ok(p);
  const target = pilihTarget(p, daftar);
  assert.equal(target?.id, 2, 'target harus menit ON (#2), TIDAK boleh bangun (#1)');

  // Keamanan anti-salah-hapus: bila nama tidak cocok, JANGAN menebak
  const pAsal = deteksiPermintaanUbah('hapus pengingat seminar');
  assert.ok(pAsal);
  const targetAsal = pilihTarget(pAsal, daftar);
  assert.equal(targetAsal, null, 'bila nama tidak cocok, harus tanya user (tidak boleh hapus sembarang)');
});

test('delivery: format pengingat lugas tanpa basa-basi AI (cukup "⏰ Pengingat: <pesan>")', async () => {
  const fs = await import('fs');
  const code = fs.readFileSync('src/remind.ts', 'utf8');
  // Memastikan susunTeksPengingat tidak memanggil autoReply untuk mengarang basa-basi
  assert.ok(!code.includes('TUGAS: Kamu sedang MENGIRIM PENGINGAT'), 'prompt LLM pengingat harus dihapus');
  assert.match(code, /⏰ Pengingat: \$\{p\}/);
});

test('hapus: sinonim "peringatan" dan kata kerja "matikan" terdeteksi sebagai batal dengan target tepat', () => {
  for (const t of ['hapus peringatan ON', 'matikan pengingat ON']) {
    const p = deteksiPermintaanUbah(t);
    assert.ok(p, `"${t}" harus terdeteksi`);
    assert.equal(p.aksi, 'batal', `"${t}" harus aksi=batal`);
    assert.equal(p.kataKunci, 'on', `"${t}" kataKunci harus 'on'`);
  }
});

test('pilihSemuaTargetBatal menghapus seluruh pengingat duplikat bernama sama sekaligus dan mendukung "hapus semua pengingat"', async () => {
  const { pilihSemuaTargetBatal } = await import('../src/reminder-ubah.js');
  const daftar = [
    { id: 101, message: 'ON\u200B', due_at: '2026-11-21T03:26:00Z', status: 'pending' },
    { id: 102, message: 'ON\u200B', due_at: '2026-11-21T03:39:00Z', status: 'pending' },
    { id: 103, message: 'bangun', due_at: '2026-11-21T23:00:00Z', status: 'pending' },
  ];

  const pOn = deteksiPermintaanUbah('hapus peringatan ON');
  assert.ok(pOn);
  const targetsOn = pilihSemuaTargetBatal(pOn, daftar);
  assert.deepEqual(targetsOn.map((x) => x.id), [101, 102], 'kedua pengingat ON harus terhapus tanpa menyentuh bangun');

  const pAll = deteksiPermintaanUbah('hapus semua pengingat');
  assert.ok(pAll);
  const targetsAll = pilihSemuaTargetBatal(pAll, daftar);
  assert.deepEqual(targetsAll.map((x) => x.id), [101, 102, 103], '"hapus semua pengingat" harus mengembalikan seluruh daftar');
});

test('pengingat grup terlewat >30 menit dilewati dan langsung dilompat ke jadwal berikutnya tanpa kirim telat', async () => {
  const { GROUP_REMINDER_MAX_LATE_MS, adalahPengingatGrupKadaluarsa } = await import('../src/remind.js');
  const fs = await import('fs');
  const code = fs.readFileSync('src/remind.ts', 'utf8');

  assert.equal(GROUP_REMINDER_MAX_LATE_MS, 30 * 60 * 1000, 'batas toleransi telat grup harus 30 menit');

  const due0500 = Date.parse('2026-11-21T22:00:00Z'); // 05:00 WIB
  assert.equal(
    adalahPengingatGrupKadaluarsa(
      { chat_id: 'wa_baileys_group_120363415563030836', due_at: new Date(due0500).toISOString() },
      due0500 + 10 * 60_000,
    ),
    false,
    'pengingat grup telat 10 menit masih boleh dikirim',
  );
  assert.equal(
    adalahPengingatGrupKadaluarsa(
      { chat_id: 'wa_baileys_group_120363415563030836', due_at: new Date(due0500).toISOString() },
      due0500 + 31 * 60_000,
    ),
    true,
    'pengingat grup telat 31 menit harus dilewati/dilompat',
  );
  assert.equal(
    adalahPengingatGrupKadaluarsa(
      { chat_id: 'wa_628991333323', due_at: new Date(due0500).toISOString() },
      due0500 + 180 * 60_000,
    ),
    false,
    'pengingat chat privat tidak boleh dianggap kadaluarsa grup',
  );

  const idxCheck = code.indexOf('adalahPengingatGrupKadaluarsa(item)');
  const idxSend = code.indexOf('await sendFn(item.chat_id');
  assert.ok(idxCheck > 0 && idxSend > idxCheck, 'cek kadaluarsa grup wajib berjalan sebelum sendFn dipanggil');
});
