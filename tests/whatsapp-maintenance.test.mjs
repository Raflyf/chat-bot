/**
 * TEST: Mode pemeliharaan WhatsApp (payment method Meta belum tertaut).
 *
 * LATAR: WhatsApp Cloud API memblokir pengiriman (error 141006) saat payment
 * method akun bisnis bermasalah, TETAPI API tetap membalas HTTP 200. Akibatnya
 * jawaban bot tercatat di dataset sementara pengguna tidak menerima apa pun.
 *
 * Test ini mengunci lima hal yang harus tetap ada:
 *   1. `WHATSAPP_MAINTENANCE_MODE` terdokumentasi & default NONAKTIF.
 *   2. Hasil kirim pemberitahuan pemeliharaan DIPERIKSA (bukan diabaikan).
 *   3. Landing page tidak mengklaim "Online 24/7" untuk WhatsApp saat pemeliharaan.
 *   4. Ada monitor kegagalan beruntun -> notifikasi pemilik.
 *   5. Dokumentasi memuat langkah payment method & cara mematikan mode.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const baca = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const ENV_TS = baca('src/env.ts');
const ENV_EX = baca('.env.example');
const CLOUD = baca('src/whatsapp_cloud.ts');
const BAILEYS = baca('src/whatsapp_baileys.ts');
const HEALTH = baca('api/health.ts');
const MONITOR = baca('src/wa_monitor.ts');
const README = baca('README.md');

test('1. WHATSAPP_MAINTENANCE_MODE: terdokumentasi & default NONAKTIF', () => {
  // Harus ada di .env.example dengan penjelasan cara mematikan.
  assert.match(ENV_EX, /WHATSAPP_MAINTENANCE_MODE=/, '.env.example harus memuat variabelnya');
  assert.match(ENV_EX, /payment method/i, 'komentar harus menjelaskan penyebab (payment method)');
  assert.match(ENV_EX, /false/, 'nilai contoh harus nonaktif (false)');

  // Default harus eksplisit NONAKTIF: pola lama `!== 'false'` membuat env yang
  // tidak diset berarti AKTIF (status tidak jelas).
  assert.ok(
    !/whatsappMaintenanceMode:\s*process\.env\.WHATSAPP_MAINTENANCE_MODE\s*!==\s*'false'/.test(ENV_TS),
    'JANGAN pakai pola `!== \'false\'` (default jadi aktif tanpa sengaja)',
  );
  assert.match(ENV_TS, /whatsappMaintenanceMode/, 'field harus ada');
  assert.match(ENV_TS, /'true'[\s\S]{0,40}'1'/, 'harus menerima nilai eksplisit untuk mengaktifkan');
});

test('2. Hasil kirim pemberitahuan pemeliharaan DIPERIKSA (tidak diabaikan)', () => {
  for (const [nama, src] of [['cloud', CLOUD], ['baileys', BAILEYS]]) {
    const i = src.indexOf('whatsappMaintenanceMode');
    assert.notEqual(i, -1, `${nama}: blok pemeliharaan harus ada`);
    const blok = src.slice(i, i + 2200);
    assert.match(
      blok,
      /const terkirim = await sendWhatsApp/,
      `${nama}: hasil kirim harus disimpan untuk diperiksa`,
    );
    assert.match(blok, /if \(terkirim\)/, `${nama}: harus ada cabang sukses`);
    assert.match(blok, /else \{/, `${nama}: harus ada cabang gagal`);
    assert.match(
      blok,
      /GAGAL terkirim[\s\S]{0,200}TIDAK ditandai selesai/,
      `${nama}: kegagalan harus dilog eksplisit (bukan ditandai selesai diam-diam)`,
    );
    // Penyimpanan ke dataset hanya pada cabang sukses.
    const idxSimpan = blok.indexOf('void saveMessage(');
    const idxElse = blok.indexOf('} else {');
    assert.ok(idxSimpan > -1 && idxElse > -1 && idxSimpan < idxElse, `${nama}: simpan hanya bila terkirim`);
  }
});

test('3. Landing page tidak mengklaim "Online 24/7" untuk WhatsApp saat pemeliharaan', () => {
  const HTML = baca('public/index.html');
  const STATUS = baca('public/js/status-wa.js');
  assert.match(HTML, /status-wa\.js/, 'landing harus memuat penanda status');
  assert.match(STATUS, /whatsapp_maintenance/, 'penanda harus membaca status dari /api/health');
  assert.match(STATUS, /WhatsApp Maintenance/, 'harus menampilkan label pemeliharaan');
  assert.match(STATUS, /status-pill--warn/, 'harus memberi gaya peringatan');
  // Gaya peringatan harus ada di CSS.
  assert.match(baca('public/css/landing.css'), /\.status-pill--warn/);
  // Health harus melaporkan statusnya.
  assert.match(HEALTH, /whatsapp_maintenance/, 'health harus melaporkan whatsapp_maintenance');
  assert.match(HEALTH, /whatsappMaintenanceMode/, 'health membaca mode dari config');
});

test('4. Monitor kegagalan beruntun -> notifikasi pemilik', () => {
  assert.match(MONITOR, /export async function catatHasilKirimWa/, 'harus ada pencatat hasil kirim');
  assert.match(MONITOR, /AMBANG_GAGAL_BERUNTUN/, 'harus ada ambang kegagalan beruntun');
  assert.match(MONITOR, /kirimNotifPemilik|ownerChatId/, 'harus memberi tahu pemilik');
  assert.match(MONITOR, /JEDA_NOTIF_MS/, 'harus membatasi frekuensi notifikasi');
  // Dipanggil dari kedua transport.
  assert.match(CLOUD, /catatHasilKirimWa\(/, 'cloud harus memanggil monitor');
  assert.match(BAILEYS, /catatHasilKirimWa\(/, 'baileys harus memanggil monitor');
  // Baileys kini mengembalikan status (dulu void -> kegagalan tak terdeteksi).
  assert.match(BAILEYS, /\): Promise<boolean> \{[\s\S]{0,120}splitMessageSmart/, 'Baileys harus mengembalikan status');
  // Statistik harus bisa dibaca monitoring (dipakai /api/health).
  assert.match(MONITOR, /export function statistikKirimWa/, 'harus mengekspor statistik kirim');
  assert.match(HEALTH, /statistikKirimWa/, 'health harus membaca statistik kirim');
  assert.match(HEALTH, /whatsapp_kirim/, 'health harus melaporkan statistik kirim WhatsApp');
});

test('5. Dokumentasi: langkah payment method + cara mematikan mode', () => {
  const PANDUAN = baca('sql/CARA_MAINTENANCE_WHATSAPP.md');
  assert.match(README, /Mode Pemeliharaan WhatsApp/, 'README harus punya bagian pemeliharaan');
  assert.match(README, /WHATSAPP_MAINTENANCE_MODE/, 'README harus menyebut variabelnya');
  assert.match(README, /payment method/i, 'README harus menyebut payment method');
  assert.match(README, /141006/, 'README harus menyebut kode error Meta');
  // Tidak boleh lagi mengklaim WhatsApp "Online 24/7".
  assert.ok(
    !/WhatsApp-Online%2024%2F7/.test(README),
    'badge WhatsApp tidak boleh mengklaim Online 24/7',
  );
  assert.match(PANDUAN, /Billing & payments/i, 'panduan harus menyebut menu pembayaran');
  assert.match(PANDUAN, /WHATSAPP_MAINTENANCE_MODE=false/, 'panduan harus memuat cara mematikan');
  assert.match(PANDUAN, /can_send_message/, 'panduan harus memuat cara cek status akun');
});
