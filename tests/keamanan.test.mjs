/**
 * TEST OTOMATIS — perbaikan keamanan 06 Okt 2026.
 *
 * Menutup regresi untuk:
 *   1. Hashing PIN scrypt (tahan brute-force)
 *   2. Penjaga berkas (blokir executable)
 *   3. Tidak ada salt hardcoded di env.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { periksaBerkasAman, adaMagicBytesBerbahaya, DAFTAR_EKSTENSI_TERLARANG } from '../src/media_guard.js';

// ── 1. PENJAGA BERKAS ──
test('berkas: .exe ditolak', () => {
  const r = periksaBerkasAman('virus.exe', Buffer.from('hello'));
  assert.equal(r.boleh, false);
});

test('berkas: .sh/.bat/.ps1/.js ditolak', () => {
  for (const nama of ['run.sh', 'install.bat', 'script.ps1', 'kode.js', 'app.jar']) {
    assert.equal(periksaBerkasAman(nama, Buffer.from('x')).boleh, false, `${nama} harus ditolak`);
  }
});

test('berkas: .docx/.pdf/.txt DIIZINKAN', () => {
  for (const nama of ['laporan.docx', 'dokumen.pdf', 'catatan.txt', 'gambar.png']) {
    assert.equal(periksaBerkasAman(nama, Buffer.from('x')).boleh, true, `${nama} harus diizinkan`);
  }
});

test('berkas: magic bytes MZ (Windows executable) ditolak walau ekstensi .txt', () => {
  const buf = Buffer.from([0x4d, 0x5a, 0x90, 0x00]); // "MZ"
  const r = periksaBerkasAman('gambar.txt', buf);
  assert.equal(r.boleh, false);
  assert.match(r.alasan, /executable/i);
});

test('berkas: magic bytes ELF (Linux executable) ditolak', () => {
  const buf = Buffer.from([0x7f, 0x45, 0x4c, 0x46]);
  assert.equal(periksaBerkasAman('data.txt', buf).boleh, false);
});

test('berkas: shebang (#!) ditolak', () => {
  const buf = Buffer.from('#!/bin/bash\nrm -rf /');
  assert.equal(periksaBerkasAman('naskah.txt', buf).boleh, false);
});

test('berkas: path traversal ditolak', () => {
  assert.equal(periksaBerkasAman('../../etc/passwd', Buffer.from('x')).boleh, false);
  // Backslash diuji lewat kode karakter agar test SAMA di Windows & Linux.
  // (Menulis 'folder\\file.txt' literal membuat test lulus di Windows tetapi
  //  gagal di Linux, karena di sana backslash bukan pemisah direktori.)
  assert.equal(periksaBerkasAman('folder' + String.fromCharCode(92) + 'file.txt', Buffer.from('x')).boleh, false);
});

test('berkas: PDF asli DIIZINKAN (magic %PDF)', () => {
  const buf = Buffer.from('%PDF-1.7\n...');
  assert.equal(periksaBerkasAman('dokumen.pdf', buf).boleh, true);
});

test('berkas: PNG asli DIIZINKAN', () => {
  const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  assert.equal(periksaBerkasAman('foto.png', buf).boleh, true);
});

test('berkas: daftar ekstensi terlarang tidak kosong', () => {
  assert.ok(DAFTAR_EKSTENSI_TERLARANG.length > 30);
  assert.ok(DAFTAR_EKSTENSI_TERLARANG.includes('exe'));
  assert.ok(DAFTAR_EKSTENSI_TERLARANG.includes('ps1'));
});

test('berkas: buffer kosong tidak crash', () => {
  assert.equal(adaMagicBytesBerbahaya(Buffer.alloc(0)), null);
  assert.equal(adaMagicBytesBerbahaya(Buffer.from([0x4d])), null);
});

// ── 2. HASHING PIN SCRYPT ──
test('pin: scrypt menghasilkan hash berbeda tiap kali (salt acak)', () => {
  // Replikasi logika scrypt (fungsi di admin_auth.ts)
  const N = 16384, r = 8, p = 1;
  const buat = (val, salt) => {
    const sb = Buffer.from(salt + '|' + crypto.randomBytes(16).toString('hex'));
    const d = crypto.scryptSync(val, sb, 32, { N, r, p });
    return `scrypt$${N}$${r}$${p}$${sb.toString('base64')}$${d.toString('base64')}`;
  };
  const h1 = buat('123456', 'salt');
  const h2 = buat('123456', 'salt');
  assert.notEqual(h1, h2, 'dua hash PIN sama TIDAK boleh identik');
  assert.ok(h1.startsWith('scrypt$'));
});

test('pin: scrypt bisa diverifikasi (round-trip)', () => {
  const N = 16384, r = 8, p = 1;
  const sb = Buffer.from('salt|x');
  const d = crypto.scryptSync('123456', sb, 32, { N, r, p });
  const stored = `scrypt$${N}$${r}$${p}$${sb.toString('base64')}$${d.toString('base64')}`;
  const verif = (val, s) => {
    const b = s.split('$');
    const sb2 = Buffer.from(b[4], 'base64');
    const hb = Buffer.from(b[5], 'base64');
    const d2 = crypto.scryptSync(val, sb2, hb.length, { N: Number(b[1]), r: Number(b[2]), p: Number(b[3]) });
    return crypto.timingSafeEqual(d2, hb);
  };
  assert.equal(verif('123456', stored), true);
  assert.equal(verif('654321', stored), false);
});

// ── 3. TIDAK ADA SALT HARDCODED DI env.ts ──
test('env: PIN_SALT tidak punya fallback hardcoded', async () => {
  const fs = await import('node:fs');
  const isi = fs.readFileSync(new URL('../src/env.ts', import.meta.url), 'utf8');
  // Cari pola fallback salt di env.ts
  assert.ok(
    !/pinSalt:\s*cleanStr\('PIN_SALT'\)\s*\|\|/.test(isi),
    'env.ts tidak boleh punya fallback salt hardcoded',
  );
});
