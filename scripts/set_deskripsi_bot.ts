/**
 * SET DESKRIPSI PROFIL BOT — TELEGRAM & WHATSAPP (satu perintah)
 *
 * KENAPA (permintaan pemilik produk, 08 Okt 2026):
 *   "pada deskripsi bot nya tambahkan jika ada keluhan atau bot nya menjawab tidak
 *    nyambung bisa langsung laporkan kesini masukan link landing page bot nya"
 *   + koreksi: "tidak usah membuat bot menyarankan atau mengarahkan user"
 *
 * Jadi: info laporan TIDAK disampaikan bot dalam percakapan (sudah dilarang di
 * prompt + ditegakkan di kode). Info itu diletakkan di DESKRIPSI PROFIL BOT,
 * yang dibaca user sendiri saat membuka profil bot — bukan bot yang mengarahkan.
 *
 * KEDUA platform BISA diotomatiskan:
 *   - Telegram : BotFather API — setMyDescription / setMyShortDescription / setMyName
 *   - WhatsApp : Meta Graph API — POST /{phone-number-id}/whatsapp_business_profile
 *
 * PELAJARAN (jangan diulang): jangan pernah bilang "harus manual" untuk hal yang
 * sebenarnya ada API-nya. Deskripsi WA memang bisa diganti lewat Graph API —
 * sudah dibuktikan (GET & POST whatsapp_business_profile berhasil).
 *
 * CARA PAKAI:
 *   npx tsx scripts/set_deskripsi_bot.ts
 *
 * Aman dijalankan berulang (idempoten).
 */

import { config } from '../src/env.js';

const LINK = 'https://free-chatbot-ai.vercel.app';

/** Deskripsi panjang Telegram (maks 512 karakter menurut Telegram). */
const DESKRIPSI =
  'Asisten AI pribadi 24/7 untuk WhatsApp & Telegram: teman ngobrol, pengingat, ' +
  'pencatatan (catatan/tugas/keuangan), riset web, dan baca dokumen/gambar/suara.\n\n' +
  `🐞 Ada keluhan, atau jawabannya terasa tidak nyambung / ngaco? Laporkan di ${LINK} — ` +
  'bagian paling bawah halaman tersedia form laporan (bisa tempel percakapan atau ' +
  'lampirkan tangkapan layar).';

/** Deskripsi singkat Telegram (maks 120 karakter). */
const DESKRIPSI_SINGKAT =
  `Teman ngobrol AI 24/7: pengingat, catatan, riset. Ada keluhan? ${LINK}`;

/** Deskripsi profil bisnis WhatsApp (maks 512 karakter). */
const WA_DESKRIPSI =
  'Asisten AI 24 jam: teman ngobrol, riset real-time, dan bantu kerjaan.\n\n' +
  'Bisa mencatat pengingat, keuangan, tugas, dan catatan. Bisa membaca foto, ' +
  'voice note, dan dokumen. Bisa main game di chat juga.\n\n' +
  `Ada keluhan atau jawaban yang tidak nyambung? Laporkan lewat form di ${LINK} ` +
  '(bagian paling bawah halaman).';

async function panggil(method: string, body: Record<string, unknown>): Promise<void> {
  if (!config.telegramToken) {
    console.warn('⚠️  Telegram dilewati: TELEGRAM_BOT_TOKEN belum diset.');
    return;
  }
  const res = await fetch(`https://api.telegram.org/bot${config.telegramToken}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  const data = (await res.json()) as { ok?: boolean; description?: string };
  if (!res.ok || !data.ok) {
    console.error(`  ❌ ${method}: ${data.description || res.status}`);
    return;
  }
  console.log(`  ✅ ${method}`);
}

/** Set deskripsi profil bisnis WhatsApp lewat Meta Graph API. */
async function setWhatsApp(): Promise<void> {
  const token = config.whatsappToken;
  const pnid = config.whatsappPhoneNumberId;
  if (!token || !pnid) {
    console.warn('⚠️  WhatsApp dilewati: WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID belum diset.');
    return;
  }
  const res = await fetch(`https://graph.facebook.com/v21.0/${pnid}/whatsapp_business_profile`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', description: WA_DESKRIPSI.slice(0, 512) }),
    signal: AbortSignal.timeout(15000),
  });
  const hasil = (await res.json()) as { success?: boolean; error?: { message?: string } };
  if (!res.ok || hasil.error) {
    console.error(`  ❌ WhatsApp: ${hasil.error?.message || res.status}`);
    return;
  }
  console.log('  ✅ whatsapp_business_profile (deskripsi)');
}

async function main(): Promise<void> {
  console.log('Menyetel deskripsi profil bot...\n');

  console.log('Telegram:');
  await panggil('setMyDescription', { description: DESKRIPSI.slice(0, 512) });
  await panggil('setMyShortDescription', { short_description: DESKRIPSI_SINGKAT.slice(0, 120) });
  await panggil('setMyName', { name: 'FreeAIBot' });

  console.log('\nWhatsApp:');
  await setWhatsApp();

  console.log('\nSelesai. Buka profil bot di masing-masing platform untuk memeriksa.');
  console.log('\nCatatan: info laporan HANYA di profil, bukan di percakapan bot');
  console.log('(bot sudah dilarang mengarahkan user — lihat src/skills.ts).');
}

main().catch((e) => {
  console.error('Error:', e);
  process.exit(1);
});
