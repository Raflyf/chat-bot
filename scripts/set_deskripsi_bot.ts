/**
 * SET DESKRIPSI PROFIL BOT (Telegram BotFather API)
 *
 * KENAPA (permintaan pemilik produk, 08 Okt 2026):
 *   "pada deskripsi bot nya tambahkan jika ada keluhan atau bot nya menjawab tidak
 *    nyambung bisa langsung laporkan kesini masukan link landing page bot nya"
 *   + koreksi lanjutan: "tidak usah membuat bot menyarankan atau mengarahkan user"
 *
 * Jadi: info laporan TIDAK disampaikan bot dalam percakapan (sudah dilarang di
 * prompt + ditegakkan di kode). Info itu diletakkan di DESKRIPSI PROFIL BOT,
 * yang dibaca user sendiri saat membuka profil bot — bukan bot yang mengarahkan.
 *
 * CARA PAKAI:
 *   1. Isi TELEGRAM_BOT_TOKEN di .env (sudah ada untuk produksi).
 *   2. Jalankan:  npx tsx scripts/set_deskripsi_bot.ts
 *
 * Aman dijalankan berulang (idempoten).
 */

import { config } from '../src/env.js';

const LINK = 'https://free-chatbot-ai.vercel.app';

/** Deskripsi panjang (maks 512 karakter menurut Telegram). */
const DESKRIPSI =
  'Asisten AI pribadi 24/7 untuk WhatsApp & Telegram: teman ngobrol, pengingat, ' +
  'pencatatan (catatan/tugas/keuangan), riset web, dan baca dokumen/gambar/suara.\n\n' +
  `🐞 Ada keluhan, atau jawabannya terasa tidak nyambung / ngaco? Laporkan di ${LINK} — ` +
  'bagian paling bawah halaman tersedia form laporan (bisa tempel percakapan atau ' +
  'lampirkan tangkapan layar).';

/** Deskripsi singkat (maks 120 karakter). */
const DESKRIPSI_SINGKAT =
  `Teman ngobrol AI 24/7: pengingat, catatan, riset. Ada keluhan? ${LINK}`;

/** Teks "Tentang" yang tampil di halaman profil. */
const TENTANG =
  'FreeAIBot — asisten AI serbabisa untuk WhatsApp & Telegram.\n' +
  'Pengingat, catatan & tugas, keuangan, riset web, baca dokumen/gambar/suara.\n\n' +
  `Keluhan atau jawaban yang tidak nyambung bisa dilaporkan lewat form di ${LINK} ` +
  '(bagian bawah halaman).';

async function panggil(method: string, body: Record<string, unknown>): Promise<void> {
  if (!config.telegramToken) {
    console.error('❌ TELEGRAM_BOT_TOKEN belum diset di .env');
    process.exit(1);
  }
  const res = await fetch(`https://api.telegram.org/bot${config.telegramToken}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  const data = (await res.json()) as { ok?: boolean; description?: string };
  if (!res.ok || !data.ok) {
    console.error(`❌ ${method} gagal:`, data.description || res.status);
    return;
  }
  console.log(`✅ ${method} berhasil`);
}

async function main(): Promise<void> {
  console.log('Menyetel deskripsi profil bot Telegram...\n');

  await panggil('setMyDescription', { description: DESKRIPSI.slice(0, 512) });
  await panggil('setMyShortDescription', { short_description: DESKRIPSI_SINGKAT.slice(0, 120) });

  // Nama & teks "about" (opsional, hanya bila bot punya halaman profil).
  await panggil('setMyName', { name: 'FreeAIBot' });

  console.log('\nSelesai. Buka profil bot di Telegram untuk memeriksa.');
  console.log('\nCatatan: untuk WhatsApp, deskripsi profil diatur di Meta Business Manager');
  console.log('(WhatsApp Manager → Profil Bisnis → Deskripsi), bukan lewat skrip ini.');
  console.log(`\nTeks yang dipakai:\n${TENTANG}`);
}

main().catch((e) => {
  console.error('Error:', e);
  process.exit(1);
});
