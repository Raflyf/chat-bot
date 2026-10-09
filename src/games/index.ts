/**
 * MESIN GAME — lapisan integrasi (DB + deteksi + alur percakapan).
 *
 * Modul ini yang dipanggil `tanganiPencatatan()`: mendeteksi apakah user minta
 * bermain, memulai permainan, memproses langkah, dan menyimpan state ke DB.
 *
 * STATE DISIMPAN DI DATABASE (tabel game_sessions, migrasi v24) — bukan memori
 * proses — supaya bertahan lintas instance Vercel serverless. Ini yang membuat
 * permainan terasa NYATA: kartu/papan tidak berubah-ubah tiap balasan.
 */
import { db } from '../db.js';
import { normChatId } from '../chat_id.js';
import { mulaiGame, langkahGame, pembukaGame, type HasilGame } from './engine.js';
import { cariGame, mintaBerhenti, DAFTAR_GAME } from './cards.js';

export { DAFTAR_GAME, cariGame, mintaBerhenti };

export interface HasilTanganiGame {
  ditangani: boolean;
  reply: string;
  jalur: string;
}

// ============================================================================
// AKSES STATE
// ============================================================================

/** Ambil permainan aktif untuk chat ini (null bila tidak ada). */
export async function ambilGame(chatId: string): Promise<{ kind: string; state: Record<string, unknown> } | null> {
  chatId = normChatId(chatId);   // konsistensi chat_id (satu sumber)
  const c = db();
  if (!c) return null;

  // 1. Coba RPC (tabel v24). Periksa { error } eksplisit — PostgREST tidak
  //    melempar exception saat fungsi/RPC tidak ada.
  try {
    const { data, error } = await c.rpc('get_game_state', { p_chat_id: chatId });
    const row = Array.isArray(data) ? data[0] : data;
    if (!error && row && row.kind) {
      // Auto-expire: permainan yang menggantung >2 jam dianggap ditinggalkan.
      // Tanpa ini, permainan lama terus menelan pesan baru (bug ditemukan uji
      // regresi 05 Okt 2026: "halo apa kabar" dijawab "Nggak ada kartu itu").
      const diperbarui = row.updated_at ? new Date(String(row.updated_at)).getTime() : 0;
      const umurJam = diperbarui ? (Date.now() - diperbarui) / 3_600_000 : 0;
      if (umurJam > 2) {
        await akhiriGame(chatId);
        return null;
      }
      return { kind: String(row.kind), state: (row.state ?? {}) as Record<string, unknown> };
    }
  } catch {
    // lanjut ke fallback
  }

  // 2. Fallback: baca dari tabel `messages` (via khusus).
  try {
    const { data: rows } = await c.from('messages')
      .select('content')
      .eq('chat_id', chatId)
      .eq('via', 'system/game-state')
      .order('created_at', { ascending: false })
      .limit(1);
    const r0 = (rows ?? [])[0] as { content?: string } | undefined;
    if (!r0?.content) return null;
    const parsed = JSON.parse(r0.content) as { kind?: string; state?: Record<string, unknown> };
    if (!parsed.kind) return null;
    return { kind: parsed.kind, state: parsed.state ?? {} };
  } catch {
    return null;
  }
}

/** Simpan state permainan. */
export async function simpanGame(
  chatId: string,
  platform: string,
  kind: string,
  state: Record<string, unknown> | null,
  selesai = false,
): Promise<void> {
  chatId = normChatId(chatId);   // konsistensi chat_id (satu sumber)
  const c = db();
  if (!c) return;

  // Selesai / tanpa state -> akhiri permainan.
  if (state === null || selesai) {
    await akhiriGame(chatId);
    return;
  }

  // 1. Coba RPC (tabel v24). PostgREST TIDAK melempar exception saat RPC tidak
  //    ada — ia mengembalikan { error }, jadi error harus diperiksa eksplisit.
  //    (BUG YANG DIPERBAIKI 05 Okt 2026: sebelumnya hanya pakai try/catch,
  //     sehingga kegagalan RPC tidak terdeteksi dan state TIDAK PERNAH tersimpan
  //     ketika migrasi v24 belum dijalankan.)
  let rpcOk = false;
  try {
    const { error } = await c.rpc('set_game_state', {
      p_chat_id: chatId,
      p_platform: platform,
      p_kind: kind,
      p_state: state as unknown as Record<string, unknown>,
      p_status: 'active',
    });
    rpcOk = !error;
  } catch {
    rpcOk = false;
  }
  if (rpcOk) return;

  // 2. Fallback: simpan di tabel `messages` dengan via khusus.
  try {
    await c.from('messages').delete().eq('chat_id', chatId).eq('via', 'system/game-state');
    await c.from('messages').insert({
      platform,
      chat_id: chatId,
      role: 'user',
      content: JSON.stringify({ kind, state }),
      via: 'system/game-state',
    });
  } catch {
    // best-effort
  }
}

/** Akhiri permainan aktif (tanpa syarat). */
export async function akhiriGame(chatId: string): Promise<void> {
  chatId = normChatId(chatId);   // konsistensi chat_id (satu sumber)
  const c = db();
  if (!c) return;
  try {
    await c.rpc('end_game', { p_chat_id: chatId });
  } catch {
    // RPC tidak ada -> andalkan pembersihan tabel `messages` di bawah
  }
  try {
    await c.from('messages').delete().eq('chat_id', chatId).eq('via', 'system/game-state');
  } catch {
    // best-effort
  }
}

// ============================================================================
// DETEKSI
// ============================================================================

/** Apakah teks minta MELIHAT daftar game? */
function mintaDaftarGame(teks: string): boolean {
  return /\b(?:game|permainan)\s*(?:apa\s*(?:aja|saja)?|apa\s*yang|tersedia|bisa\s*(?:dimainkan|main)|list|daftar)\b/i.test(teks)
    || /\b(?:bisa|boleh|dapat)\s*main\s*apa\b/i.test(teks)
    || /\bmain\s*apa\s*(?:aja|saja|nih|dong)\b/i.test(teks);
}

/** Daftar game sebagai teks. */
export function daftarGameTeks(): string {
  const kartu = DAFTAR_GAME.filter((g) => ['uno', 'capsa', 'remi', 'cangkulan', 'gaple', 'qiuqiu'].includes(g.kind)).map((g) => g.nama);
  const papan = DAFTAR_GAME.filter((g) => ['catur', 'halma', 'tictactoe', 'monopoli'].includes(g.kind)).map((g) => g.nama);
  const cepat = DAFTAR_GAME.filter((g) => ['tebakangka', 'dadu', 'batu', 'suitjawa', 'hangman', 'kuis'].includes(g.kind)).map((g) => g.nama);
  return [
    '🎮 *Game yang bisa kita mainkan:*',
    '',
    `🃏 *Kartu:* ${kartu.join(', ')}`,
    `♟️ *Papan:* ${papan.join(', ')}`,
    `⚡ *Cepat:* ${cepat.join(', ')}`,
    '',
    'Ketik misalnya *main uno*, *main catur*, atau *main tebak angka*.',
    'Semua permainan punya aturan nyata dan kartu/papan tersimpan — bukan karangan.',
  ].join('\n');
}

// ============================================================================
// ALUR UTAMA
// ============================================================================

/**
 * Tangani permintaan bermain. Mengembalikan `ditangani: false` bila teks ini
 * bukan soal permainan (biar diteruskan ke modul lain / AI).
 */
/**
 * Apakah teks ini TERLIHAT seperti langkah permainan? (WHITELIST)
 *
 * KENAPA WHITELIST, BUKAN BLACKLIST (temuan pemilik produk 09 Okt 2026):
 *   LAPORAN: user sedang main UNO lalu mengirim "Jadiin stiker" (minta fitur lain)
 *   tetapi bot MENJAWAB "Nggak ada kartu itu di tanganmu..." — pesan itu dicegat
 *   mesin game hanya karena TIDAK cocok daftar "bukan langkah" (blacklist).
 *   Blacklist selalu bocor: apa pun yang tidak terdaftar dianggap langkah game.
 *
 *   SEKARANG: pesan hanya diproses sebagai langkah permainan bila BENTUKNYA
 *   memang khas langkah game (kartu, koordinat, angka, kata kunci permainan).
 *   Semua pesan lain otomatis mengakhiri permainan dan diteruskan ke AI.
 *
 * @param kind jenis permainan aktif
 * @param teks pesan user (sudah lowercase)
 */
function terlihatLangkahGame(kind: string, teks: string): boolean {
  const t = teks.trim();
  if (!t) return false;

  // Kata kunci langkah yang berlaku untuk SEMUA permainan.
  const kataUmum = /^(?:tarik|ambil|draw|lewat|pass|skip|banting|susun|buang|selesai|buka|lempar|lihat|papan|bantu|nyerah|menyerah|undo)\b/i;
  if (kataUmum.test(t)) return true;

  // Nama warna/angka (UNO, Remi, Cangkulan) — mis. "merah 5", "kuning skip".
  const warnaKartu = /\b(?:merah|kuning|hijau|biru|red|yellow|green|blue)\b/i;
  const nilaiKartu = /\b(?:skip|balik|reverse|wild|liar|tarik\s*dua|\+2|\+4|[0-9]|satu|dua|tiga|empat|lima|enam|tujuh|delapan|sembilan|kosong)\b/i;
  if (warnaKartu.test(t) || (nilaiKartu.test(t) && t.split(/\s+/).length <= 3)) return true;

  switch (kind) {
    case 'catur':
    case 'halma':
      // Koordinat papan: "e2 e4", "d7 d6".
      return /^[a-h][1-8](?:\s+[a-h][1-8])?$/i.test(t) || /^[a-h][1-8]\s*[-x]\s*[a-h][1-8]$/i.test(t);
    case 'tictactoe':
      return /^[1-9]$/.test(t) || /^(?:atas|tengah|bawah|kiri|kanan|tengah)\b/i.test(t);
    case 'tebakangka':
      return /^\d{1,3}$/.test(t);
    case 'kuis':
      return /^[1-4]$/.test(t) || /^[a-d]$/i.test(t);
    case 'hangman':
      // Satu huruf ATAU satu kata tebakan (huruf saja).
      return /^[a-z]$/i.test(t) || /^[a-z]{2,20}$/i.test(t);
    case 'gaple':
    case 'qiuqiu':
      // Pasangan angka domino: "3 5".
      return /^\d{1,2}\s*[-|\s]\s*\d{1,2}$/.test(t) || /^\d{1,2}$/.test(t);
    case 'dadu':
      return /\b(?:lempar|kocok|gulir|roll)\b/i.test(t);
    case 'batu':
      return /^(?:batu|gunting|kertas|rock|paper|scissors)$/i.test(t);
    case 'suitjawa':
      return /^(?:gajah|orang|semut)$/i.test(t);
    case 'monopoli':
      return /\b(?:lempar|beli|sewa|lewat|bangun|kocok|dadu)\b/i.test(t);
    case 'uno':
    case 'capsa':
    case 'remi':
    case 'cangkulan':
      // Kartu: warna+angka sudah ditangani di atas. Nama kartu spesifik:
      return /\b(?:kartu|as|king|queen|jack|joker|sekop|hati|keriting|wajik)\b/i.test(t);
    default:
      return false;
  }
}

export async function tanganiGame(
  teks: string,
  chatId: string,
  platform: string,
): Promise<HasilTanganiGame> {
  chatId = normChatId(chatId);   // konsistensi chat_id (satu sumber)
  const low = teks.trim().toLowerCase();

  // 1. Minta daftar game
  if (mintaDaftarGame(low)) {
    return { ditangani: true, reply: daftarGameTeks(), jalur: 'game-daftar' };
  }

  // 2. Ada permainan AKTIF? -> proses langkahnya lebih dulu
  const aktif = await ambilGame(chatId);
  if (aktif) {
    // ── WHITELIST, BUKAN BLACKLIST (perbaikan 09 Okt 2026) ──
    // LAPORAN PEMILIK PRODUK: user sedang main UNO lalu mengirim "Jadiin stiker"
    // (minta fitur lain), tetapi bot MENJAWAB "Nggak ada kartu itu di tanganmu...".
    // AKAR: pendekatan lama adalah BLACKLIST — pesan dianggap langkah permainan
    // KECUALI cocok daftar "bukan langkah" (sapaan/kata tanya/panjang >80 char).
    // Blacklist selalu bocor: "Jadiin stiker" (13 char, bukan sapaan) lolos.
    //
    // SEKARANG: pesan hanya diproses sebagai langkah permainan bila BENTUKNYA
    // memang khas langkah game (whitelist). Semua pesan lain otomatis
    // MENGAKHIRI permainan dan diteruskan ke AI — user bebas pindah topik.
    //
    // ATURAN PEMILIK PRODUK: "kecuali user minta lanjut, kalo user sudah keluar
    // dari topik game maka tidak usah di singgung lagi".
    if (!terlihatLangkahGame(aktif.kind, low)) {
      await akhiriGame(chatId);
      // Diteruskan ke modul lain (bukan ditangani di sini).
      return { ditangani: false, reply: '', jalur: '' };
    }

    // Minta berhenti / ganti game
    if (mintaBerhenti(low)) {
      await akhiriGame(chatId);
      // DILARANG menawarkan main lagi (temuan pemilik produk 09 Okt 2026:
      // "kalo user sudah keluar dari topik game maka tidak usah di singgung lagi").
      return {
        ditangani: true,
        reply: 'Oke, permainan dihentikan. 👍',
        jalur: 'game-berhenti',
      };
    }
    // Minta game LAIN -> akhiri yang lama, mulai yang baru
    const gameBaru = cariGame(low);
    if (gameBaru && gameBaru.kind !== aktif.kind && /\b(?:main|mulai|ganti|ayo|yuk)\b/i.test(low)) {
      await akhiriGame(chatId);
      return mulaiGameBaru(gameBaru.kind, gameBaru.nama, chatId, platform);
    }
    // Lanjutkan permainan
    const hasil: HasilGame = langkahGame(aktif.kind, aktif.state, teks);
    await simpanGame(chatId, platform, aktif.kind, hasil.state, hasil.selesai);
    return { ditangani: true, reply: hasil.balas, jalur: `game-${aktif.kind}` };
  }

  // 3. Belum ada permainan -> cek apakah user minta mulai
  const game = cariGame(low);
  if (game && /\b(?:main|mulai|ayo|yuk|mari|gas|ajak|bisa|boleh|ada|mau)\b/i.test(low)) {
    return mulaiGameBaru(game.kind, game.nama, chatId, platform);
  }

  return { ditangani: false, reply: '', jalur: '' };
}

async function mulaiGameBaru(
  kind: string, nama: string, chatId: string, platform: string,
): Promise<HasilTanganiGame> {
  const state = mulaiGame(kind);
  if (!state) return { ditangani: false, reply: '', jalur: '' };
  const pembuka = pembukaGame(kind, state);
  await simpanGame(chatId, platform, kind, state, false);
  return { ditangani: true, reply: pembuka, jalur: `game-mulai-${kind}` };
}

/**
 * Buang ajakan MENARIK USER KEMBALI ke permainan/topik lama dari balasan bot.
 *
 * KENAPA (temuan pemilik produk 09 Okt 2026): user keluar dari topik game
 * (kirim gambar + "Jadiin stiker"), tetapi bot MENJAWAB "...Mau lanjut main UNO
 * atau ganti topik?". ATURAN: "kecuali user minta lanjut, kalo user sudah keluar
 * dari topik game maka tidak usah di singgung lagi".
 *
 * Fungsi ini DITEGAKKAN DI KODE (bukan hanya prompt) karena aturan kritis tidak
 * bisa diandalkan pada kepatuhan model.
 */
export function buangAjakanGameLama(reply: string): string {
  if (!reply) return reply;
  // Pola kalimat ajakan kembali ke permainan/topik lama.
  const pola = /(?:^|(?<=[.!?\n]))\s*(?:[^.!?\n]{0,40}?)(?:mau\s+lanjut\s+(?:main|permainan|game)|lanjut\s+main|mau\s+main\s+lagi|mau\s+ganti\s+topik\s+atau\s+main|balik\s+ke\s+(?:permainan|game)|kembali\s+ke\s+(?:permainan|game)|main\s+lagi\s*(?:yuk|dong|gak|nggak|ga)?)[^.!?\n]*[.!?]?/gi;
  let hasil = reply.replace(pola, '').replace(/\n{3,}/g, '\n\n').trim();
  // Bila seluruh balasan habis (hanya ajakan), kembalikan apa adanya agar tidak kosong.
  if (!hasil) return reply;
  return hasil;
}
