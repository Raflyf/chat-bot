/**
 * PENANGKAP FAKTA PERSONAL USER (permintaan pemilik produk 06 Okt 2026):
 *   "buat agar bot bisa menangkap personality, kesukaan, dan lainnya dari user,
 *    simpan di database"
 *
 * KENAPA PERLU: bot perlu MENGENAL teman bicaranya dari waktu ke waktu —
 * nama, kesukaan, kebiasaan, pekerjaan, makanan favorit, hobi, dll — supaya
 * obrolan terasa personal dan tidak mengulang pertanyaan yang sama.
 *
 * CARA KERJA:
 *   1. Setiap pesan user diperiksa pola kalimat yang menyatakan FAKTA DIRI
 *      ("aku suka kopi", "namaku Andi", "aku kerja di bank", "hobiku main game").
 *   2. Fakta disimpan ke tabel `corrections` dengan penanda `[FAKTA]` sehingga
 *      TIDAK perlu migrasi tabel baru, dan langsung terbaca oleh getContext().
 *   3. Fakta disuntikkan ke prompt sebagai konteks personal (lihat skills.ts).
 *
 * PENTING (agar tidak mengganggu obrolan):
 *   - Penyimpanan DIAM-DIAM (tidak ada balasan "oke sudah kucatat").
 *   - Hanya fakta yang JELAS dinyatakan user (bukan tebakan).
 *   - Dibatasi panjang & jumlahnya agar prompt tidak membengkak.
 */
import { db } from './db.js';

/** Penanda agar fakta personal bisa dibedakan dari koreksi /salah biasa. */
export const PENANDA_FAKTA = '[FAKTA]';

export interface FaktaPersonal {
  kategori: 'nama' | 'kesukaan' | 'kebiasaan' | 'pekerjaan' | 'hobi' | 'kuliner' | 'lainnya';
  fakta: string;
}

/**
 * Deteksi FAKTA PERSONAL dari pesan user.
 *
 * KONSERVATIF: hanya menangkap kalimat yang JELAS menyatakan fakta diri.
 * Contoh yang ditangkap:
 *   "namaku Andi"                 -> nama: Andi
 *   "aku suka kopi pahit"         -> kesukaan: kopi pahit
 *   "aku kerja di bank bca"       -> pekerjaan: bank bca
 *   "hobiku main game"            -> hobi: main game
 *   "aku mahasiswa"               -> pekerjaan: mahasiswa
 *   "makanan favoritku nasi padang" -> kuliner: nasi padang
 *   "aku tinggal di Bandung"      -> (ditangani modul zona waktu, dilewati)
 *
 * Yang TIDAK ditangkap (agar tidak salah):
 *   "aku suka kamu" (bukan preferensi benda)
 *   "aku lagi makan kopi" (aktivitas sesaat, bukan kesukaan)
 */
export function deteksiFaktaPersonal(teks: string): FaktaPersonal | null {
  if (!teks || typeof teks !== 'string') return null;
  const asli = teks.trim();
  // Batasi panjang: kalimat sangat panjang biasanya bukan pernyataan fakta diri.
  if (asli.length < 4 || asli.length > 220) return null;
  const s = asli.toLowerCase();

  // Lewati pertanyaan (bukan pernyataan fakta).
  if (/\?\s*$/.test(asli)) return null;
  // Lewati lokasi/domisili (ditangani modul zona waktu — jangan dobel).
  if (/\b(?:tinggal|domisili|asal|berada|lagi di|sedang di)\s+di\s+\w+/i.test(s)) return null;

  const bersih = (x: string) =>
    x
      .replace(/[.!?,;:]+$/, '')
      .replace(/\s+/g, ' ')
      .trim();

  // ── 1. NAMA ──
  // "namaku X", "nama saya X", "aku X" (perkenalan), "panggil aja X"
  // ── DIPERBAIKI (temuan nyata 07 Okt 2026) ──
  // BUG: "nama saya Dhea" -> "Namanya saya Dhea" (kata "saya" ikut terbawa).
  //      "nama gue itu huruf depan nya D..." -> "Namanya gue itu huruf depan nya D"
  //      (sampah, bukan nama).
  //      "aku gasuka di panggil dhea ya" -> "Dipanggil dhea ya" (padahal GASUKA!)
  //
  // SEKARANG: kata ganti di ANTARA "nama" dan nama harus dibuang; hanya SATU kata
  // nama yang diambil; kalimat berisi "tidak/gasuka/jangan" TIDAK dianggap nama.
  // Kalimat yang menyebut huruf/tebak-tebakan juga dilewati.
  if (/\b(?:huruf|tebak|kira\s*-?\s*kira|jumlah\s+nama)\b/i.test(asli)) return null;
  if (/\b(?:ga\s*suka|gak\s*suka|nggak\s*suka|tidak\s*suka|jangan|bukan)\b[^.!?\n]{0,20}\bpanggil/i.test(asli)) return null;

  // Nama boleh 1-3 kata ("Andi", "Budi Santoso", "Rafly Firmansyah"), tetapi
  // kata ganti di antaranya ("nama SAYA X") dibuang lebih dulu.
  const KATA_GANTI_NAMA = '(?:(?:ku|saya|aku|gue|gw|kamu|kau)\\s+)?';
  const NAMA_KATA = "[A-Za-z][A-Za-z'-]*(?:\\s+[A-Za-z][A-Za-z'-]*){0,2}";
  let m = asli.match(
    new RegExp(`\\bnam(?:a|aku)\\s+${KATA_GANTI_NAMA}(?:itu\\s+)?(?:adalah\\s+|si\\s+)?(${NAMA_KATA})\\s*[.!?]?\\s*$`, 'i'),
  );
  if (m) {
    const v = bersih(m[1]);
    if (v && v.length >= 2 && !/^(?:apa|siapa|kamu|aku|saya|gue|gw|dia|nya|itu|ini)$/i.test(v)) {
      return { kategori: 'nama', fakta: `Namanya ${v}` };
    }
  }
  // ── "Nama kamu X" / "namamu X" (temuan 07 Okt 2026) ──
  // User MENYEBUTKAN nama dirinya sambil mengoreksi bot ("Nama kamu Dhea, sesuai
  // petunjuk hurufnya"). Ini tetap informasi nama yang berharga.
  // "nama kamu X" / "namamu X" -> buang kata "kamu" di antara.
  m = asli.match(new RegExp(`\\bnam(?:a|amu|a)\\s+(?:kamu\\s+|kau\\s+)?(?:itu\\s+)?(?:adalah\\s+)?(${NAMA_KATA})\\s*[,.]?`, 'i'));
  if (m) {
    const v = bersih(m[1]);
    if (v && v.length >= 2 && !/^(?:apa|siapa|kamu|aku|saya|gue|gw|dia|nya|itu|ini|freeaibot|bot)$/i.test(v)) {
      return { kategori: 'nama', fakta: `Namanya ${v}` };
    }
  }

  // "panggil aku X" — hanya bila TIDAK ada kata menolak.
  m = asli.match(/\b(?:panggil(?:an)?|dipanggil)\s+(?:aku\s+|saya\s+|gue\s+|gw\s+)?(?:aja\s+|saja\s+|dengan\s+)?([A-Za-z][A-Za-z'-]{1,24})\s*[.!?]?\s*$/i);
  if (m) {
    const v = bersih(m[1]);
    if (v && v.length >= 2 && !/^(?:apa|siapa|dong|ya|deh|sih|aja|saja)$/i.test(v)) {
      return { kategori: 'nama', fakta: `Dipanggil ${v}` };
    }
  }

  // ── 1b. KULINER (diperiksa LEBIH DULU dari kesukaan umum) ──
  // "makanan favoritku sate ayam" harus masuk kategori 'kuliner', bukan 'kesukaan'.
  m = asli.match(/\b(?:makanan|minuman|masakan|jajanan)\s+(?:favorit(?:ku|saya)?|kesukaan(?:ku)?|andalan(?:ku)?)\s+(?:adalah\s+)?([^.!?]{2,50})/i);
  if (m) {
    const v = bersih(m[1]);
    if (v.length >= 2) return { kategori: 'kuliner', fakta: `Favorit ${v}` };
  }

  // ── 2. KESUKAAN ──
  // "aku suka X", "gue doyan X", "aku demen X", "favoritku X"
  // DILARANG menangkap "aku suka kamu/lo/lu/dia" (bukan preferensi benda).
  m = asli.match(/\b(?:aku|saya|gue|gw)\s+(?:suka|sukaa|doyan|demen|seneng|senang|gemar|hobi)\s+(?:banget\s+|sih\s+|sama\s+|sama\s+banget\s+)?([^.!?]{2,60})/i);
  if (m) {
    const v = bersih(m[1]);
    // ── GUARD (temuan nyata 07 Okt 2026) ──
    // "Salah, tuh kamu ga inget aku suka buah apa" -> SALAH ditangkap sebagai
    // "Suka buah apa". Itu PERTANYAAN (atau keluhan), bukan fakta kesukaan.
    const ituPertanyaan = /\b(?:apa|apakah|apaan|berapa|siapa|kapan|dimana|gimana|bagaimana|kenapa|mengapa|kah)\b/i.test(v) || /\?/.test(asli);
    if (v.length >= 2 && !ituPertanyaan && !/^(?:kamu|kau|lu|loe|elo|dia|nya|sama kamu|sama lo)$/i.test(v)) {
      return { kategori: 'kesukaan', fakta: `Suka ${v}` };
    }
  }
  m = asli.match(/\b(?:favorit(?:ku|saya|gue)?|fav(?:ku)?|kesukaan(?:ku|saya)?)\s+(?:adalah\s+)?([^.!?]{2,60})/i);
  if (m) {
    const v = bersih(m[1]);
    if (v.length >= 2) return { kategori: 'kesukaan', fakta: `Favoritnya ${v}` };
  }

  // ── 3. TIDAK SUKA ──
  m = asli.match(/\b(?:aku|saya|gue|gw)\s+(?:gak|ga|nggak|tidak|gamau)\s+(?:suka|doyan|demen)\s+([^.!?]{2,60})/i);
  if (m) {
    const v = bersih(m[1]);
    if (v.length >= 2 && !/^(?:kamu|kau|lu|loe|dia)$/i.test(v)) {
      return { kategori: 'kesukaan', fakta: `Tidak suka ${v}` };
    }
  }

  // ── 4. PEKERJAAN / STATUS ──
  m = asli.match(/\b(?:aku|saya|gue|gw)\s+(?:kerja|bekerja|kerjaan(?:ku)?|profesiku|jabatanku)\s+(?:di\s+|sebagai\s+|jadi\s+)?([^.!?]{2,60})/i);
  if (m) {
    const v = bersih(m[1]);
    if (v.length >= 2) return { kategori: 'pekerjaan', fakta: `Kerja di/sebagai ${v}` };
  }
  m = asli.match(/\b(?:aku|saya|gue|gw)\s+(?:seorang\s+|seorang\s+)?(mahasiswa|mahasiswi|pelajar|siswa|siswi|dosen|guru|dokter|perawat|polisi|tentara|programmer|developer|desainer|wirausaha|pengusaha|karyawan|pegawai|buruh|petani|nelayan|pedagang|ojek|driver|kurir|barista|koki|penulis|gitaris|musisi)\b/i);
  if (m) {
    return { kategori: 'pekerjaan', fakta: `Dia ${m[1].toLowerCase()}` };
  }
  m = asli.match(/\b(?:aku|saya|gue|gw)\s+(?:kuliah|sekolah)\s+(?:di\s+)?([^.!?]{2,50})/i);
  if (m) {
    const v = bersih(m[1]);
    if (v.length >= 2) return { kategori: 'pekerjaan', fakta: `Kuliah/sekolah di ${v}` };
  }

  // ── 5. HOBI ──
  m = asli.match(/\b(?:hobi(?:ku|saya|gue)?|hobiku)\s+(?:adalah\s+)?([^.!?]{2,60})/i);
  if (m) {
    const v = bersih(m[1]);
    if (v.length >= 2) return { kategori: 'hobi', fakta: `Hobinya ${v}` };
  }

  // ── 7. KEBIASAAN ──
  // "aku biasa X", "aku selalu X", "tiap hari aku X"
  m = asli.match(/\b(?:aku|saya|gue|gw)\s+(?:biasanya|biasa|selalu|tiap hari|setiap hari)\s+([^.!?]{3,60})/i);
  if (m) {
    const v = bersih(m[1]);
    if (v.length >= 3) return { kategori: 'kebiasaan', fakta: `Biasanya ${v}` };
  }

  return null;
}

/**
 * Simpan fakta personal ke database (DIAM-DIAM, tanpa balasan ke user).
 *
 * Memakai tabel `corrections` yang sudah ada dengan penanda `[FAKTA]` sehingga
 * tidak perlu migrasi tabel baru, dan otomatis terbaca getContext().
 *
 * ANTI-DOBEL: bila fakta dengan isi sama sudah ada untuk user ini, tidak disimpan lagi.
 */
export async function simpanFaktaPersonal(
  chatId: string,
  fakta: FaktaPersonal,
): Promise<boolean> {
  const c = db();
  if (!c || !chatId || !fakta?.fakta) return false;
  const isi = `${PENANDA_FAKTA} ${fakta.kategori}: ${fakta.fakta}`.slice(0, 300);
  try {
    // Cek duplikat: fakta yang sama tidak perlu disimpan dua kali.
    const { data } = await c
      .from('corrections')
      .select('correction')
      .eq('chat_id', chatId)
      .ilike('correction', `%${fakta.fakta.slice(0, 60)}%`)
      .limit(1);
    if (data && data.length > 0) return false; // sudah ada

    const { error } = await c.from('corrections').insert({ chat_id: chatId, correction: isi });
    if (error) return false;
    return true;
  } catch {
    return false;
  }
}

/** Ambil SEMUA fakta personal user (untuk disuntikkan ke prompt). */
export async function ambilFaktaPersonal(chatId: string, limit = 20): Promise<string[]> {
  const c = db();
  if (!c || !chatId) return [];
  try {
    const { data } = await c
      .from('corrections')
      .select('correction')
      .eq('chat_id', chatId)
      .ilike('correction', `${PENANDA_FAKTA}%`)
      .order('created_at', { ascending: true })
      .limit(limit);
    return (data ?? [])
      .map((r) => String((r as { correction?: string }).correction ?? ''))
      .map((x) => x.replace(PENANDA_FAKTA, '').trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Tangani pesan user: deteksi fakta personal, lalu simpan (bila ada).
 * Mengembalikan fakta yang tersimpan (atau null) — pemanggil TIDAK perlu
 * membalas apa pun ke user (penyimpanan diam-diam).
 */
export async function tangkapFaktaPersonal(
  chatId: string,
  teks: string,
): Promise<FaktaPersonal | null> {
  const fakta = deteksiFaktaPersonal(teks);
  if (!fakta) return null;
  const ok = await simpanFaktaPersonal(chatId, fakta);
  return ok ? fakta : null;
}
