/**
 * TEST OTOMATIS — pengingat tidak boleh hilang saat kirim gagal (08 Okt 2026).
 *
 * LAPORAN PEMILIK PRODUK: "kenapa pengingat waktu bangun saya ko ga aktif ya
 * hari ini? padahal pada saat ringkasan itu masih ada".
 *
 * AKAR (3 bug berlapis):
 *  1. sendWhatsAppCloudMessageSafe() mengembalikan void -> pemanggil tidak tahu
 *     kirim berhasil atau gagal.
 *  2. api/cron/reminders.ts tidak mengembalikan status kirim.
 *  3. checkDueReminders() TIDAK memeriksa hasil -> pengingat yang GAGAL terkirim
 *     tetap menaikkan repeat_count & memajukan due_at (hilang permanen).
 *  4. Pesan pengingat TIDAK disimpan ke `messages` -> tidak ada jejak.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const WA = fs.readFileSync(new URL('../src/whatsapp_cloud.ts', import.meta.url), 'utf8');
const CRON = fs.readFileSync(new URL('../api/cron/reminders.ts', import.meta.url), 'utf8');
const REM = fs.readFileSync(new URL('../src/remind.ts', import.meta.url), 'utf8');

test('kirim WA: mengembalikan status (bukan void)', () => {
  assert.match(WA, /export async function sendWhatsAppCloudMessageSafe\([\s\S]*?\): Promise<boolean>/, 'harus Promise<boolean>');
  assert.ok(WA.includes('semuaBerhasil'), 'harus lacak keberhasilan');
  assert.match(WA, /return semuaBerhasil;/, 'harus return status');
});

test('kirim WA: gagal HTTP/network menandai gagal', () => {
  assert.match(WA, /console\.error\(`\[wa-cloud\] Gagal kirim pesan[\s\S]{0,80}semuaBerhasil = false/, 'HTTP gagal -> false');
  assert.match(WA, /Network error kirim pesan[\s\S]{0,60}semuaBerhasil = false/, 'network error -> false');
});

test('cron: callback mengembalikan status kirim', () => {
  assert.match(CRON, /return await sendWhatsAppCloudMessageSafe/, 'harus return hasil kirim WA');
  assert.ok(CRON.includes('return true;'), 'telegram sukses -> true');
  assert.ok(CRON.includes('return false;'), 'telegram gagal -> false');
});

test('remind: periksa hasil kirim sebelum majukan jadwal', () => {
  assert.match(REM, /const hasilKirim = await sendFn/, 'harus simpan hasil');
  assert.ok(REM.includes("hasilKirim === false"), 'harus cek false');
  assert.ok(REM.includes('PENGIRIMAN_GAGAL'), 'harus lempar error agar ditangani catch');
});

test('remind: pengingat terkirim DISIMPAN ke riwayat', () => {
  assert.ok(REM.includes("via: 'reminder'"), 'harus simpan dengan via reminder');
  assert.match(REM, /saveMessage/, 'harus pakai saveMessage');
});

test('remind: urutan benar (simpan riwayat SETELAH kirim sukses)', () => {
  const idxKirim = REM.indexOf('const hasilKirim = await sendFn');
  const idxSimpan = REM.indexOf("via: 'reminder'");
  assert.ok(idxKirim > 0 && idxSimpan > idxKirim, 'simpan harus setelah kirim sukses');
});
