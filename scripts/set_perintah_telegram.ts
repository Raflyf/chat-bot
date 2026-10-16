/**
 * DAFTARKAN MENU PERINTAH (`/`) KE TELEGRAM — setMyCommands
 *
 * KENAPA PERLU (permintaan pemilik produk 16 Okt 2026):
 *   "saya ingin ketika / gini itu muncul semua list fitur yg ada secara lengkap"
 *
 * Di Telegram, menu `/` di kolom ketik TIDAK muncul otomatis — harus didaftarkan
 * lewat Bot API `setMyCommands`. Bot ini belum pernah melakukannya, sehingga menu
 * `/` kosong dan user tidak tahu bot bisa apa saja.
 *
 * CARA PAKAI:
 *   npx tsx scripts/set_perintah_telegram.ts
 *
 * Aman dijalankan berulang (idempoten — menimpa daftar lama dengan yang baru).
 *
 * CATATAN: daftar perintah diambil dari `src/commands.ts` (satu sumber kebenaran),
 * jadi menambah perintah cukup di file itu lalu jalankan ulang skrip ini.
 */
import { config } from '../src/env.js';
import { daftarPerintahTelegram } from '../src/commands.js';

/** Scope default (semua obrolan) + versi bahasa Indonesia bila tersedia. */
const SCOPE_DEFAULT = { type: 'default' } as const;

async function panggil(method: string, body: Record<string, unknown>): Promise<boolean> {
  const res = await fetch(`https://api.telegram.org/bot${config.telegramToken}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const data = (await res.json()) as { ok?: boolean; description?: string; result?: unknown };
  if (!res.ok || !data.ok) {
    console.error(`  ❌ ${method}: ${data.description || res.status}`);
    return false;
  }
  return true;
}

async function main(): Promise<void> {
  if (!config.telegramToken) {
    console.error('❌ TELEGRAM_BOT_TOKEN belum diset. Tidak bisa mendaftarkan perintah.');
    process.exit(1);
  }

  const perintah = daftarPerintahTelegram();
  console.log(`Mendaftarkan ${perintah.length} perintah ke menu "/" Telegram...\n`);

  // 1. Daftar utama (semua obrolan: chat pribadi, grup, kanal).
  const okUtama = await panggil('setMyCommands', { commands: perintah, scope: SCOPE_DEFAULT });
  if (okUtama) {
    console.log('  ✅ setMyCommands (default)');
    for (const p of perintah) console.log(`     /${p.command} — ${p.description}`);
  }

  // 2. Scope bahasa Indonesia — agar deskripsi Indonesia dipakai saat klien
  //    Telegram berbahasa Indonesia. Sebagian klien lama tidak mendukung ini,
  //    jadi kegagalan di sini TIDAK menggagalkan seluruh proses.
  const okId = await panggil('setMyCommands', {
    commands: perintah,
    scope: SCOPE_DEFAULT,
    language_code: 'id',
  });
  console.log(okId ? '  ✅ setMyCommands (language_code=id)' : '  ⚠️  setMyCommands (id) dilewati — tidak fatal');

  // 3. Verifikasi: baca ulang apa yang tersimpan di server Telegram.
  const res = await fetch(`https://api.telegram.org/bot${config.telegramToken}/getMyCommands`, {
    signal: AbortSignal.timeout(15000),
  });
  const data = (await res.json()) as { ok?: boolean; result?: Array<{ command: string }> };
  const tersimpan = data.result?.length ?? 0;
  console.log(`\nVerifikasi getMyCommands: ${tersimpan} perintah tersimpan di server Telegram.`);

  if (tersimpan === 0) {
    console.error('❌ Menu masih kosong — periksa token/izin bot.');
    process.exit(1);
  }
  console.log('\nSelesai. Buka Telegram, ketik "/" di kolom pesan untuk melihat menunya.');
}

main().catch((e) => {
  console.error('Error:', e);
  process.exit(1);
});
