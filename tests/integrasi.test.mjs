/**
 * TEST INTEGRASI — alur lengkap tanganiPencatatan (butuh DATABASE).
 *
 * DILEWATI otomatis bila database tidak tersedia (mis. di CI tanpa kredensial),
 * sehingga test ini tidak membuat CI gagal.
 *
 * Jalankan lokal: npx tsx --test tests/integrasi.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Deteksi ketersediaan database
let dbTersedia = false;
try {
  const { db } = await import('../src/db.js');
  const c = db();
  if (c) {
    const { error } = await c.from('messages').select('id', { head: true, count: 'exact' }).limit(1);
    dbTersedia = !error;
  }
} catch {
  dbTersedia = false;
}

const LEWATI = !dbTersedia;
const pesanLewati = 'dilewati: database tidak tersedia (normal di CI)';

// Chat uji yang tidak mengganggu data nyata
const CHAT = 'wa_0000000000test';
const TABEL = ['notes', 'todos', 'expenses', 'reminders', 'messages', 'corrections'];

async function bersihkan(c) {
  for (const t of TABEL) {
    try { await c.from(t).delete().eq('chat_id', CHAT); } catch { /* abaikan */ }
  }
  try { await c.from('user_profiles').delete().eq('chat_id', CHAT); } catch { /* abaikan */ }
}

test('integrasi: alur pencatatan & klasifikasi', { skip: LEWATI && pesanLewati }, async () => {
  const { db } = await import('../src/db.js');
  const { tanganiPencatatan } = await import('../src/notes.js');
  const c = db();
  await bersihkan(c);

  // Set zona dulu agar tidak ditanya
  await tanganiPencatatan('aku di cianjur', CHAT, {}, { platform: 'whatsapp' });

  // 1. Pengingat langsung simpan (tanpa konfirmasi)
  const r1 = await tanganiPencatatan('ingatkan besok jam 9 ada rapat', CHAT, {}, { platform: 'whatsapp' });
  assert.equal(r1.ditangani, true, 'pengingat harus ditangani');
  assert.match(r1.reply, /Pengingat disimpan/i, 'pengingat harus langsung tersimpan');

  // 2. Pengeluaran LANGSUNG tersimpan (tanpa konfirmasi ya/tidak).
  //    Perbaikan 06 Okt 2026: konfirmasi dihilangkan atas permintaan pemilik
  //    produk (user merasa terganggu oleh tanya "Balas iya untuk simpan").
  const r2 = await tanganiPencatatan('catat pengeluaran lima puluh ribu buat makan', CHAT, {}, { platform: 'whatsapp' });
  assert.equal(r2.ditangani, true);
  assert.match(r2.reply, /Tercatat/i, 'keuangan harus LANGSUNG tersimpan');
  assert.ok(!/Balas \*iya\*/i.test(r2.reply), 'tidak boleh ada konfirmasi ya/tidak');

  // 3. Obrolan biasa TIDAK ditangani (lolos ke AI)
  const r4 = await tanganiPencatatan('halo apa kabar', CHAT, {}, { platform: 'whatsapp' });
  assert.equal(r4.ditangani, false, 'obrolan biasa harus lolos ke AI');

  // 4. Ringkasan bekerja
  const r5 = await tanganiPencatatan('/ringkasan', CHAT, {}, { platform: 'whatsapp' });
  assert.equal(r5.jalur, 'ringkasan');
  assert.match(r5.reply, /Keuangan/i);

  await bersihkan(c);
});

test('integrasi: pengingat berulang tersimpan dengan kolom benar', { skip: LEWATI && pesanLewati }, async () => {
  const { db } = await import('../src/db.js');
  const { tanganiPencatatan } = await import('../src/notes.js');
  const c = db();
  await bersihkan(c);
  await tanganiPencatatan('aku di cianjur', CHAT, {}, { platform: 'whatsapp' });

  await tanganiPencatatan('ingatkan tiap hari jam 7 minum obat', CHAT, {}, { platform: 'whatsapp' });
  const { data } = await c.from('reminders').select('message,repeat_kind').eq('chat_id', CHAT);
  assert.ok(data && data.length > 0, 'pengingat harus tersimpan');
  assert.equal(data[0].repeat_kind, 'daily', 'repeat_kind harus daily');

  await bersihkan(c);
});

test('integrasi: zona waktu per-user tersimpan', { skip: LEWATI && pesanLewati }, async () => {
  const { db } = await import('../src/db.js');
  const { tanganiPencatatan } = await import('../src/notes.js');
  const { ambilProfilWaktu } = await import('../src/user-profile.js');
  const c = db();
  await bersihkan(c);

  // User baru minta pengingat -> harus DITANYA dulu
  const r1 = await tanganiPencatatan('ingatkan besok jam 9 rapat', CHAT, {}, { platform: 'whatsapp' });
  assert.equal(r1.jalur, 'tanya-zona-waktu', 'user baru harus ditanya zona');

  // User sebut lokasi -> tersimpan
  await tanganiPencatatan('aku di makassar', CHAT, {}, { platform: 'whatsapp' });
  const p = await ambilProfilWaktu(CHAT);
  assert.equal(p?.timezone, 'Asia/Makassar', 'zona harus WITA');

  // Pengingat berikutnya TIDAK ditanya lagi
  const r2 = await tanganiPencatatan('ingatkan besok jam 9 rapat', CHAT, {}, { platform: 'whatsapp' });
  assert.notEqual(r2.jalur, 'tanya-zona-waktu', 'tidak boleh ditanya lagi');

  await bersihkan(c);
});
