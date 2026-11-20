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
 *   - SEMUA id numerik (WhatsApp MAUPUN Telegram) -> berawalan "wa_"
 *     WhatsApp : "wa_628991333323"
 *     Telegram : "wa_1073504871"
 *   - Kunci non-nomor (mis. "tz_b865", fixture test) dibiarkan apa adanya.
 *
 * KOREKSI 14 Okt 2026 (audit menyeluruh):
 *   Sebelumnya Telegram dibiarkan TELANJANG ("1073504871"). Itu BERTENTANGAN
 *   dengan kenyataan data produksi: seluruh tabel menyimpan Telegram sebagai
 *   "wa_1073504871" (dihasilkan jalur tanpa-platform, mis. getContext di
 *   memory.ts:80, lalu diteruskan saveMessage). Akibatnya jalur TULIS yang
 *   menyertakan platform='telegram' (simpanUang/simpanCatatan/simpanTugas di
 *   notes.ts) menulis chat_id BERBEDA dari yang dicari jalur BACA tanpa
 *   platform -> data tersimpan tetapi tidak pernah ditemukan.
 *   Dibuktikan dengan uji langsung + query DB (messages platform=telegram
 *   tersimpan "wa_1073504871", 0 baris telanjang di seluruh tabel).
 *   Prefix "wa_" kini dipakai untuk SEMUA id numerik supaya TULIS == BACA.
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

  // WhatsApp & Telegram: id numerik -> prefix "wa_" (SAMA dengan jalur tanpa
  // platform, supaya TULIS dan BACA selalu menemukan chat_id yang identik).
  if (plat === 'whatsapp' || plat === 'telegram') {
    if (nomorTelanjang(id)) return `wa_${id.replace(/^\+/, '')}`;
    return id;
  }

  // Platform tidak diketahui: nomor telanjang -> prefix "wa_" (mayoritas).
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

/** Prefix kunci riwayat obrolan khusus WhatsApp Baileys (terpisah dari Cloud API). */
export const BAILEYS_CHAT_PREFIX = 'wa_baileys_';

/** Prefix kunci ruang grup WhatsApp Baileys — anti tabrakan dengan ID/nomor privat. */
export const BAILEYS_GROUP_PREFIX = 'wa_baileys_group_';

/** Bangun kunci chat khusus grup WhatsApp Baileys (`wa_baileys_group_<groupId>`). */
export function baileysGroupChatKey(groupIdOrJid: string): string {
  const raw = String(groupIdOrJid ?? '').trim();
  if (!raw) return '';
  if (raw.startsWith(BAILEYS_GROUP_PREFIX)) return raw;
  const clean = raw
    .replace(/^wa_baileys_/, '')
    .replace(/@.*$/, '')
    .replace(/:\d+$/, '')
    .trim();
  return clean ? `${BAILEYS_GROUP_PREFIX}${clean}` : '';
}

/** True bila chat_id menunjuk ke ruang grup (WhatsApp `@g.us`/`wa_baileys_group_*` atau grup Telegram ID negatif). */
export function isGroupChatKey(chatId?: string | null): boolean {
  const raw = String(chatId ?? '').trim();
  if (!raw) return false;
  if (raw.startsWith(BAILEYS_GROUP_PREFIX) || raw.endsWith('@g.us')) return true;
  return /^(?:wa_|tg_)?-\d+$/.test(raw);
}

/** Kunci riwayat obrolan khusus Baileys (`wa_baileys_<nomor>` atau `wa_baileys_group_<id>`), terpisah dari Cloud API (`wa_<nomor>`). */
export function baileysChatKey(nomor: string): string {
  const raw = String(nomor ?? '').trim();
  if (!raw) return '';
  if (raw.startsWith(BAILEYS_GROUP_PREFIX)) return raw;
  if (raw.endsWith('@g.us')) return baileysGroupChatKey(raw);
  if (raw.startsWith(BAILEYS_CHAT_PREFIX)) return raw;
  const clean = nomorWhatsApp(raw) || raw;
  return clean ? `${BAILEYS_CHAT_PREFIX}${clean}` : '';
}

export function isBaileysChatKey(chatId?: string | null): boolean {
  return String(chatId ?? '').startsWith(BAILEYS_CHAT_PREFIX);
}

/** Petakan kunci Baileys ke kunci data bersama (`wa_<nomor>`) untuk fakta, pengingat, catatan, dan timezone. */
export function sharedChatKeyDari(chatId: string): string {
  const raw = String(chatId ?? '').trim();
  if (isGroupChatKey(raw)) return raw;
  if (isBaileysChatKey(raw)) {
    const rest = raw.slice(BAILEYS_CHAT_PREFIX.length);
    return normChatId(rest, 'whatsapp');
  }
  return normChatId(raw);
}
