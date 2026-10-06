/**
 * PROFIL WAKTU PENGGUNA, zona waktu per-user, permanen.
 *
 * MASALAH (temuan pemilik produk 05 Okt 2026):
 * "jangan salah membaca waktu user sedang berada... misal sistem defaultnya WIB,
 *  jika user di belahan waktu lain maka jadi tidak sama waktunya. Jadi untuk
 *  mencegah itu jika ada user baru masuk ke database maka jika user menanyakan
 *  waktu, menyuruh mengingatkan, atau apapun yang berhubungan dengan waktu,
 *  jangan sok tau dan asal jawab defaultnya, langsung tanya pastikan user di
 *  belahan bumi mana, lalu simpan di database agar tidak pernah lupa. Dan jika
 *  user id yang sudah diketahui zona waktunya, tidak usah ditanya lagi."
 *
 * STRATEGI BERTINGKAT (dari paling pasti ke paling lemah):
 *  1. Profil tersimpan & TERVERIFIKASI  -> langsung pakai (tidak tanya lagi)
 *  2. Profil tersimpan tapi belum terverifikasi -> pakai, tapi boleh dikonfirmasi
 *  3. Belum ada profil, tapi nomor telepon memberi kode negara -> TEBAK, tapi
 *     WAJIB dikonfirmasi ke user (jangan sok tahu)
 *  4. Belum ada apa-apa -> TANYA user (jangan asal pakai WIB)
 *
 * Penyimpanan: tabel `user_profiles` (migrasi v25) dengan fallback ke tabel
 * `corrections` (menyimpan baris bertanda khusus) bila migrasi belum dijalankan.
 */
import { db } from './db.js';
import {
  detectUserCountry, detectLocation, detectUserLocationDeclaration,
  registerPembacaProfil,
  type LocationMatch,
} from './timezone.js';

export interface ProfilWaktu {
  timezone: string;
  label: string;
  kota?: string | null;
  sumber: 'manual' | 'telepon' | 'gps' | 'default';
  terverifikasi: boolean;
}

/** Tanda baris profil di tabel `corrections` (fallback tanpa migrasi). */
const TANDA_FALLBACK = '[ZONA_WAKTU]';

// ============================================================================
// BACA / TULIS
// ============================================================================

/** Ambil profil waktu user (null bila belum diketahui). */
export async function ambilProfilWaktu(chatId: string): Promise<ProfilWaktu | null> {
  const c = db();
  if (!c) return null;

  // 1. Tabel v25
  try {
    const { data, error } = await c.rpc('get_user_timezone', { p_chat_id: chatId });
    const row = Array.isArray(data) ? data[0] : data;
    if (!error && row && row.timezone) {
      return {
        timezone: String(row.timezone),
        label: String(row.label ?? ''),
        kota: (row.kota as string | null) ?? null,
        sumber: (String(row.sumber ?? 'manual') as ProfilWaktu['sumber']),
        terverifikasi: Boolean(row.terverifikasi),
      };
    }
  } catch {
    // lanjut ke fallback
  }

  // 2. Fallback: baris bertanda di tabel `corrections`
  try {
    const { data: rows } = await c.from('corrections')
      .select('correction')
      .eq('chat_id', chatId)
      .ilike('correction', `${TANDA_FALLBACK}%`)
      .order('created_at', { ascending: false })
      .limit(1);
    const r0 = (rows ?? [])[0] as { correction?: string } | undefined;
    if (r0?.correction) {
      // Format: [ZONA_WAKTU] zone=Asia/Jakarta; label=...; kota=...; sumber=manual; verif=1
      const kv = new Map<string, string>();
      for (const bagian of r0.correction.replace(TANDA_FALLBACK, '').split(';')) {
        const i = bagian.indexOf('=');
        if (i > 0) kv.set(bagian.slice(0, i).trim(), bagian.slice(i + 1).trim());
      }
      const tz = kv.get('zone');
      if (tz) {
        return {
          timezone: tz,
          label: kv.get('label') ?? '',
          kota: kv.get('kota') ?? null,
          sumber: (kv.get('sumber') as ProfilWaktu['sumber']) ?? 'manual',
          terverifikasi: kv.get('verif') === '1',
        };
      }
    }
  } catch {
    // tidak ada
  }
  return null;
}

/** Simpan/perbarui profil waktu user. */
export async function simpanProfilWaktu(
  chatId: string,
  platform: string,
  profil: ProfilWaktu,
): Promise<boolean> {
  const c = db();
  if (!c) return false;

  // 1. Tabel v25
  try {
    const { error } = await c.rpc('set_user_timezone', {
      p_chat_id: chatId,
      p_platform: platform,
      p_timezone: profil.timezone,
      p_label: profil.label,
      p_kota: profil.kota ?? null,
      p_sumber: profil.sumber,
      p_terverifikasi: profil.terverifikasi,
    });
    if (!error) return true;
  } catch {
    // lanjut ke fallback
  }

  // 2. Fallback: simpan di `corrections` dengan tanda khusus (idempoten).
  try {
    await c.from('corrections').delete()
      .eq('chat_id', chatId).ilike('correction', `${TANDA_FALLBACK}%`);
    const isi = `${TANDA_FALLBACK} zone=${profil.timezone}; label=${profil.label}; kota=${profil.kota ?? ''}; sumber=${profil.sumber}; verif=${profil.terverifikasi ? '1' : '0'}`;
    const { error } = await c.from('corrections').insert({ chat_id: chatId, correction: isi });
    return !error;
  } catch {
    return false;
  }
}

// ============================================================================
// DETEKSI & KEPUTUSAN
// ============================================================================

/** Ubah hasil deteksi lokasi menjadi profil. */
export function profilDariLokasi(lok: LocationMatch, kota?: string | null): ProfilWaktu {
  return {
    timezone: lok.zone,
    label: lok.label,
    kota: kota ?? lok.matchedKeyword ?? null,
    sumber: 'manual',
    terverifikasi: true,
  };
}

export interface KeputusanWaktu {
  /** Profil yang harus dipakai (null = BELUM DIKETAHUI, harus tanya user). */
  profil: ProfilWaktu | null;
  /** true = bot HARUS menanyakan lokasi/zona user sebelum menjawab. */
  perluTanya: boolean;
  /** true = zona ini masih TEBAKAN (dari nomor telepon) dan sebaiknya dikonfirmasi. */
  perluKonfirmasi: boolean;
  /** Teks pertanyaan siap kirim (bila perluTanya). */
  pertanyaan: string;
}

/**
 * Tentukan profil waktu yang dipakai untuk chat ini.
 *
 * @param chatId  chat key (wa_<nomor> atau id telegram)
 * @param platform 'whatsapp' | 'telegram'
 * @param teksPesan pesan user saat ini (untuk mendeteksi deklarasi lokasi baru)
 */
export async function tentukanProfilWaktu(
  chatId: string,
  platform: string,
  teksPesan = '',
): Promise<KeputusanWaktu> {
  // 0. User menyebut lokasinya di pesan ini? -> simpan (paling akurat).
  const deklarasi = detectUserLocationDeclaration(teksPesan);
  if (deklarasi) {
    const profil = profilDariLokasi(deklarasi);
    await simpanProfilWaktu(chatId, platform, profil);
    setCacheProfil(chatId, profil);
    return { profil, perluTanya: false, perluKonfirmasi: false, pertanyaan: '' };
  }

  // 1. Sudah ada profil tersimpan.
  const tersimpan = await ambilProfilWaktu(chatId);
  if (tersimpan) {
    setCacheProfil(chatId, tersimpan);
    return {
      profil: tersimpan,
      perluTanya: false,
      // Bila masih tebakan dari nomor telepon, boleh dikonfirmasi (tidak wajib).
      perluKonfirmasi: !tersimpan.terverifikasi,
      pertanyaan: '',
    };
  }

  // 2. Belum ada profil -> coba tebak dari kode negara nomor telepon.
  //    Hanya WhatsApp (chat key memuat nomor asli); ID Telegram BUKAN nomor.
  const negara = /^wa[_:]/i.test(chatId) ? detectUserCountry(chatId) : null;
  if (negara && negara.country !== 'Indonesia') {
    // Negara di luar Indonesia: zona biasanya tunggal -> tebak, tapi konfirmasi.
    const profil: ProfilWaktu = {
      timezone: negara.zone,
      label: negara.country,
      kota: null,
      sumber: 'telepon',
      terverifikasi: false,
    };
    await simpanProfilWaktu(chatId, platform, profil);
    setCacheProfil(chatId, profil);
    return {
      profil,
      perluTanya: false,
      perluKonfirmasi: true,
      pertanyaan: '',
    };
  }

  // 3. Indonesia (+62) -> zona TIDAK bisa ditebak (ada WIB/WITA/WIT).
  //    JANGAN asal pakai WIB. Harus tanya.
  //
  // PERTANYAAN DIPERUMUM (06 Okt 2026): dulu hanya menyebut "soal waktu",
  // padahal pemicunya bisa CUACA ("cuaca hari ini gimana?"). Sekarang netral
  // (lokasi/waktu) agar nyambung untuk semua konteks.
  return {
    profil: null,
    perluTanya: true,
    perluKonfirmasi: false,
    pertanyaan:
      'Sebelum aku jawab, aku perlu tahu kamu di daerah mana dulu ya, ' +
      'soalnya jam dan cuaca di Indonesia beda-beda tergantung lokasinya.\n\n' +
      'Kamu di kota/daerah mana? (mis. *Cianjur*, *Makassar*, *Jayapura*)',
  };
}

/** Apakah pesan ini berkaitan dengan WAKTU (tanya jam / minta pengingat / jadwal)? */
export function berkaitanDenganWaktu(teks: string): boolean {
  const s = teks.toLowerCase();
  return (
    // Tanya jam/waktu/tanggal
    /\b(?:jam|pukul|waktu)\s*(?:berapa|brp|sekarang|skrg|saat ini|ini)\b/.test(s) ||
    /\b(?:sekarang|saat ini|hari ini)\s*(?:jam|pukul|tanggal|hari apa)\b/.test(s) ||
    /\b(?:hari|tanggal)\s*(?:apa|berapa)\b/.test(s) ||
    // Minta pengingat
    /\b(?:ingatkan|ingetin|ingat|remind|reminder|pengingat)\b/.test(s) ||
    // Waktu relatif/absolut yang menandakan jadwal
    /\b(?:besok|lusa|nanti|hari ini|senin|selasa|rabu|kamis|jumat|sabtu|minggu)\b/.test(s) ||
    /\b\d{1,2}\s*(?:menit|jam)\s*(?:lagi|kemudian)\b/.test(s) ||
    /\b(?:jam|pukul)\s*\d{1,2}\b/.test(s) ||
    // Ubah/batalkan jadwal
    /\b(?:undur|mundur|tunda|geser|majukan|jadwal|agenda)\b/.test(s)
  );
}

/**
 * ── PERBAIKAN (06 Okt 2026) — PERMINTAAN PEMILIK PRODUK ──
 * "berlaku juga untuk semua, misal jika user baru menanyakan cuaca hari ini,
 *  lalu bot menanyakan posisi, nah setelah itu lanjut carikan cuaca, jangan
 *  malah tidak jadi dicarikan cuaca nya, dan itu berlaku ke semua pertanyaan
 *  yang berkaitan waktu, tempat dan lainnya"
 *
 * MASALAH: `berkaitanDenganWaktu()` hanya mencakup waktu & pengingat. Pertanyaan
 * seperti "cuaca hari ini" TIDAK terdeteksi, sehingga saat bot menanyakan lokasi,
 * permintaannya TIDAK disimpan -> setelah user menjawab lokasi, cuaca tidak dicari.
 *
 * SEKARANG: fungsi ini mencakup SEMUA permintaan yang BUTUH LOKASI/WAKTU user:
 *   - cuaca, suhu, hujan, prakiraan
 *   - waktu, jam, tanggal, jadwal, pengingat
 *   - arah/kiblat, matahari terbit/terbenam, puasa, sahur, berbuka
 *   - dan pertanyaan lain yang jawabannya bergantung pada lokasi/waktu user.
 */
export function butuhLokasiAtauWaktu(teks: string): boolean {
  // Semua yang berkaitan waktu sudah tercakup.
  if (berkaitanDenganWaktu(teks)) return true;
  const s = teks.toLowerCase();
  return (
    // Cuaca & iklim
    /\b(?:cuaca|suhu|hujan|gerimis|panas|dingin|mendung|cerah|berawan|prakiraan|ramalan|bmkg|udara|kelembapan|angin)\b/.test(s) ||
    // Matahari & waktu ibadah (bergantung lokasi)
    /\b(?:matahari|terbit|terbenam|senja|subuh|maghrib|imsak|sahur|berbuka|puasa|sholat|shalat|salat|kiblat|adzan|azan)\b/.test(s) ||
    // Lokasi/arah & perjalanan (HARUS berupa pertanyaan, bukan sekadar menyebut kata)
    /\b(?:arah|rute|jarak|macet|kemacetan|peta)\b/.test(s) ||
    // ── DIPERBAIKI (06 Okt 2026) ──
    // BUG: pola "dimana" terlalu luas sehingga pertanyaan RETORIS/bercanda ikut
    // memicu tanya lokasi. Contoh nyata: "Emang kamu gaul dimana" -> bot malah
    // bertanya "kamu di daerah mana?" (TIDAK NYAMBUNG, mengganggu obrolan).
    //
    // Sekarang hanya memicu bila memang menanyakan LOKASI NYATA: tempat tinggal,
    // alamat, keberadaan, atau tujuan perjalanan.
    /\b(?:tinggal|domisili|alamat|berada|lokasi(?:nya)?|posisi(?:nya)?)\s*(?:di\s*mana|dimana)\b/.test(s) ||
    /\b(?:di\s*mana|dimana)\s+(?:kamu|kita|aku|saya|lu|gue|rumah|tempat|kota|daerah)\b/.test(s) ||
    /\b(?:ke\s*mana|dari\s*mana)\b/.test(s)
  );
}

/** Format waktu di zona profil (untuk balasan konsisten). */
export function waktuDiZona(zone: string, d: Date = new Date()): string {
  try {
    return d.toLocaleString('id-ID', {
      timeZone: zone, dateStyle: 'medium', timeStyle: 'short',
    });
  } catch {
    return d.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'medium', timeStyle: 'short' });
  }
}


// ============================================================================
// CACHE SINKRON (untuk dipakai buildUniversalTimePrompt yang sinkron)
// ============================================================================
//
// `buildUniversalTimePrompt()` di skills.ts dipanggil secara SINKRON, sementara
// profil waktu ada di DATABASE (async). Solusinya: `tentukanProfilWaktu()`
// mengisi cache ini setiap ada pesan masuk, lalu pembaca sinkron mengambilnya.
// Cache di-key per chatId; entri lama dibersihkan otomatis (batas 500).
const cacheProfil = new Map<string, { profil: ProfilWaktu; at: number }>();
const CACHE_TTL_MS = 10 * 60_000;

/** Isi cache (dipanggil tentukanProfilWaktu). */
export function setCacheProfil(chatId: string, profil: ProfilWaktu | null): void {
  if (!profil) {
    cacheProfil.delete(chatId);
    return;
  }
  cacheProfil.set(chatId, { profil, at: Date.now() });
  if (cacheProfil.size > 500) {
    const palingLama = [...cacheProfil.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (palingLama) cacheProfil.delete(palingLama[0]);
  }
}

/** Baca cache (sinkron). Mengembalikan null bila belum ada / kadaluarsa. */
export function getCacheProfil(chatId?: string): ProfilWaktu | null {
  if (!chatId) return null;
  const e = cacheProfil.get(chatId);
  if (!e) return null;
  if (Date.now() - e.at > CACHE_TTL_MS) {
    cacheProfil.delete(chatId);
    return null;
  }
  return e.profil;
}

// Daftarkan pembaca cache ke timezone.ts (agar buildUniversalTimePrompt sinkron
// bisa membaca profil waktu user tanpa circular import).
registerPembacaProfil((chatKey) => {
  const p = getCacheProfil(chatKey);
  return p ? { timezone: p.timezone, label: p.label } : null;
});
