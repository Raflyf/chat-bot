/**
 * NORMALISASI chat_id — SATU SUMBER untuk SELURUH APLIKASI.
 *
 * MASALAH YANG DIPERBAIKI (temuan pemilik produk 09 Okt 2026):
 *   chat_id TIDAK KONSISTEN antar tabel:
 *     messages   : "wa_628991333323"  (dengan prefix)
 *     reminders  : "628991333323"     (tanpa prefix)
 *     notes      : "6282116656810"    (tanpa prefix)
 *     todos      : "628991333323"     (tanpa prefix)
 *     expenses   : "62895392942433"   (tanpa prefix)
 *     corrections: campur (3 prefix, 3 telanjang, 61 lain)
 *     user_profiles: campur (7 prefix, 5 telanjang)
 *
 *   AKIBAT NYATA: bot TIDAK BISA MELIHAT datanya sendiri. Contoh yang dilaporkan:
 *   user me-reply pesan pengingat bot lalu bertanya "ini apa", tetapi bot menjawab
 *   ngawur karena pengingat tersimpan di chat_id yang berbeda dari percakapan.
 *
 * ATURAN (ditetapkan di sini agar TIDAK terulang):
 *   - WhatsApp : SELALU berawalan "wa_"  -> "wa_628991333323"
 *   - Telegram : angka apa adanya (konsisten dengan String(chat.id)) -> "1073504871"
 *   - Kunci non-nomor (mis. "tz_b865", fixture test) dibiarkan apa adanya.
 *
 * PENTING: normalisasi HANYA untuk PENYIMPANAN. Saat MENGIRIM ke Meta WhatsApp,
 * prefix "wa_" harus dibuang — pakai `nomorWhatsApp()`.
 */

/** True bila chat_id tampak seperti nomor telepon telanjang (tanpa prefix). */
function nomorTelanjang(id: string): boolean {
  return /^\+?\d{6,}$/.test(id.replace(/[\s-]/g, ''));
}

/**
 * Normalisasi chat_id agar konsisten di SELURUH tabel.
 * @param chatId  chat_id mentah dari platform
 * @param platform 'whatsapp' | 'telegram' | lainnya
 */
export function normChatId(chatId: string, platform?: string): string {
  const id = String(chatId ?? '').trim();
  if (!id) return id;

  // Sudah punya prefix -> biarkan (idempoten).
  if (id.startsWith('wa_') || id.startsWith('tg_')) return id;

  const plat = String(platform ?? '').toLowerCase();

  // Telegram: biarkan angka apa adanya.
  if (plat === 'telegram') return id;

  // WhatsApp: nomor telanjang -> beri prefix "wa_".
  if (plat === 'whatsapp' && nomorTelanjang(id)) {
    return `wa_${id.replace(/^\+/, '')}`;
  }

  // Platform tidak diketahui: nomor telanjang -> anggap WhatsApp (mayoritas).
  if (!plat && nomorTelanjang(id)) return `wa_${id.replace(/^\+/, '')}`;

  return id;
}

/**
 * Ubah chat_id menjadi NOMOR TELANJANG untuk WhatsApp Cloud API (Meta).
 * WAJIB dipakai sebelum mengirim — Meta MENOLAK nomor berprefix.
 */
export function nomorWhatsApp(chatId: string): string {
  return String(chatId ?? '')
    .replace(/^wa_/, '')
    .replace(/^tg_/, '')
    .replace(/@.*$/, '')
    .replace(/:\d+$/, '')
    .replace(/^\+/, '')
    .replace(/\D/g, '');
}
