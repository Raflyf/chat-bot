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

/**
 * PEMBERITAHUAN PEMELIHARAAN (14 Okt 2026).
 *
 * KENAPA: pengiriman WhatsApp Cloud API sedang diblokir Meta (payment method
 * belum beres -> error 141006), sehingga balasan bot TIDAK sampai ke pengguna.
 * Karena bot tidak bisa memberi tahu lewat percakapan, pemberitahuan
 * diletakkan di DESKRIPSI PROFIL yang dibaca user sendiri saat membuka profil.
 *
 * ATURAN: TAMBAHKAN baris baru di depan, JANGAN hapus baris yang sudah ada
 * (terutama "Tanya bisa apa saja" — cara user menemukan daftar fitur).
 * Cabut baris ⚠️ ini setelah pengiriman WhatsApp kembali normal.
 */
const NOTA_PEMELIHARAAN_TG =
  '⚠️ WhatsApp sedang PEMELIHARAAN. Telegram aktif normal — lanjut di sini ya.';

const NOTA_PEMELIHARAAN_WA =
  '⚠️ WhatsApp sedang PEMELIHARAAN: balasan belum bisa terkirim. Gunakan Telegram ' +
  'kami yang aktif normal: https://t.me/chatkita_bot';

/** Deskripsi panjang Telegram (maks 512 karakter menurut Telegram). */
const DESKRIPSI =
  NOTA_PEMELIHARAAN_TG + '\n\n' +
  'Asisten AI pribadi 24/7 untuk WhatsApp & Telegram: teman ngobrol, pengingat, ' +
  'pencatatan (catatan/tugas/keuangan), riset web, dan baca dokumen/gambar/suara.\n\n' +
  // Baris "bisa apa saja" JANGAN DIHAPUS — cara user menemukan daftar fitur.
  'Tanya "bisa apa saja" untuk panduan lengkap fitur.\n\n' +
  `🐞 Ada keluhan, atau jawabannya terasa tidak nyambung / ngaco? Laporkan di ${LINK} — ` +
  'bagian bawah halaman ada form laporan (bisa tempel percakapan atau tangkapan layar).';

/** Deskripsi singkat Telegram (maks 120 karakter). */
const DESKRIPSI_SINGKAT =
  `⚠️ WhatsApp pemeliharaan sementara. Telegram aktif 24/7. Keluhan: ${LINK}`;

/** Field `about` WhatsApp (maks 139 karakter) — paling terlihat di profil. */
const WA_ABOUT =
  '⚠️ WhatsApp sedang PEMELIHARAAN. Sementara ini gunakan Telegram kami: ' +
  'https://t.me/chatkita_bot';

/** Deskripsi profil bisnis WhatsApp (maks 512 karakter). */
const WA_DESKRIPSI =
  NOTA_PEMELIHARAAN_WA + '\n\n' +
  'Asisten AI 24 jam: teman ngobrol, riset real-time, dan bantu kerjaan.\n\n' +
  'Bisa mencatat pengingat, keuangan, tugas, dan catatan. Bisa membaca foto, ' +
  'voice note, dan dokumen. Bisa main game di chat juga.\n\n' +
  // PENTING (koreksi pemilik produk 09 Okt 2026): baris "Tanya bisa apa saja"
  // JANGAN DIHAPUS — itu cara user menemukan daftar fitur. Saat menambahkan info
  // laporan, TAMBAHKAN baris baru; jangan menimpa baris yang sudah ada.
  'Tanya "bisa apa saja" untuk panduan lengkap fitur.\n\n' +
  `Ada keluhan atau jawaban ngaco? Laporkan lewat form di ${LINK}.`;

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

  // ── FIELD `websites`: SATU-SATUNYA tempat link BISA DIKLIK di profil WA ──
  // Permintaan pemilik produk (08 Okt 2026): "masukan link landingpage nya sebelum
  // link github, karna klo di deskripsi link nya tidak bisa di klik tidak ada
  // hyperlink". Jadi landing page diletakkan PERTAMA agar paling menonjol.
  const websites = [
    LINK,                                    // landing page (form laporan di bawah)
    'https://github.com/Raflyf/chat-bot',    // repositori
  ];

  const res = await fetch(`https://graph.facebook.com/v21.0/${pnid}/whatsapp_business_profile`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      // `about` (maks 139) = teks paling terlihat, tepat di bawah nama bot.
      about: WA_ABOUT.slice(0, 139),
      // `description` (maks 512) = teks lengkap di bagian "Info" profil.
      description: WA_DESKRIPSI.slice(0, 512),
      websites,
    }),
    signal: AbortSignal.timeout(15000),
  });
  const hasil = (await res.json()) as { success?: boolean; error?: { message?: string } };
  if (!res.ok || hasil.error) {
    console.error(`  ❌ WhatsApp: ${hasil.error?.message || res.status}`);
    return;
  }
  console.log('  ✅ whatsapp_business_profile (deskripsi + websites)');
  console.log(`     websites: ${websites.join(', ')}`);
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
