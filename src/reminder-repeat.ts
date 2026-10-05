/**
 * PENGINGAT BERULANG — aturan pengulangan & perhitungan kemunculan berikutnya.
 *
 * FITUR BARU (permintaan pemilik produk 05 Okt 2026):
 *   "ingatkan tiap hari jam 7 minum obat"
 *   "ingatkan tiap Senin jam 9 rapat"
 *   "ingatkan tiap tanggal 1 bayar listrik"
 *
 * DESAIN: satu baris `reminders` menyimpan ATURAN, bukan membuat baris baru
 * tiap kali (bisa membengkak). Worker menghitung kemunculan berikutnya setelah
 * mengirim, lalu memperbarui `due_at` — sehingga pengingat berulang berjalan
 * selamanya tanpa menumpuk baris.
 */
import { formatInZone } from './timezone.js';

export type RepeatKind = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'weekday';

export interface AturanUlang {
  repeat_kind: RepeatKind;
  /** weekly: 0-6 (Minggu=0). monthly: 1-31. yearly: 'MM-DD'. */
  repeat_value: string | null;
  /** Batas akhir (ISO) atau null = selamanya. */
  repeat_until: string | null;
  /** Sudah berapa kali terkirim. */
  repeat_count: number;
}

const NAMA_HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const NAMA_HARI_ID = ['minggu', 'senin', 'selasa', 'rabu', 'kamis', 'jumat', 'sabtu'];

/**
 * Deteksi aturan pengulangan dari teks user.
 * Mengembalikan null bila bukan pengingat berulang.
 */
export function deteksiPengulangan(teks: string): { kind: RepeatKind; value: string | null; label: string } | null {
  const s = teks.toLowerCase();

  // 1. "tiap hari KERJA" HARUS dicek SEBELUM "tiap hari" — kalau tidak, pola
  //    "tiap hari" menangkapnya lebih dulu (BUG ditemukan test otomatis 05 Okt 2026).
  if (/\bhari\s+kerja\b|\bweekday\b|\bkerja\s*hari\b/.test(s)) {
    return { kind: 'weekday', value: null, label: 'tiap hari kerja (Senin-Jumat)' };
  }

  // 2. "tiap hari" / "setiap hari" / "harian" / "tiap pagi" / "tiap malam"
  if (/\b(?:tiap|setiap|tiap-tiap|tiap2|saban)\s+hari\b|\bharian\b|\btiap\s+pagi\b|\btiap\s+malam\b/.test(s)) {
    return { kind: 'daily', value: null, label: 'tiap hari' };
  }

  // 3. "tiap Senin" / "setiap jumat" / "tiap minggu" (nama hari)
  const mHari = s.match(/\b(?:tiap|setiap|saban)\s+(minggu|senin|selasa|rabu|kamis|jumat|jum'at|sabtu)\b/);
  if (mHari) {
    const hari = mHari[1].replace("jum'at", 'jumat');
    const idx = NAMA_HARI_ID.indexOf(hari);
    if (idx >= 0) {
      return { kind: 'weekly', value: String(idx), label: `tiap ${NAMA_HARI[idx]}` };
    }
  }

  // 4. "tiap minggu" (tanpa nama hari) -> mingguan (hari yang sama seperti sekarang)
  if (/\b(?:tiap|setiap|saban)\s+minggu\b|\bmingguan\b/.test(s)) {
    return { kind: 'weekly', value: null, label: 'tiap minggu' };
  }

  // 5. "tiap tanggal 1" / "tiap tanggal 15" / "tiap awal bulan" / "bulanan"
  const mTgl = s.match(/\b(?:tiap|setiap|saban)\s+tanggal\s+(\d{1,2})\b/);
  if (mTgl) {
    const t = Math.min(31, Math.max(1, Number(mTgl[1])));
    return { kind: 'monthly', value: String(t), label: `tiap tanggal ${t}` };
  }
  if (/\b(?:tiap|setiap|saban)\s+(?:awal|akhir)\s+bulan\b|\bbulanan\b/.test(s)) {
    return { kind: 'monthly', value: '1', label: 'tiap awal bulan' };
  }

  // 6. "tiap tahun" / "tahunan"
  if (/\b(?:tiap|setiap|saban)\s+tahun\b|\btahunan\b/.test(s)) {
    return { kind: 'yearly', value: null, label: 'tiap tahun' };
  }

  return null;
}

/**
 * Hitung kemunculan BERIKUTNYA dari sebuah waktu dasar.
 * Semua perhitungan memakai zona waktu user agar "jam 7" tetap jam 7 lokal.
 */
export function berikutnya(
  dasar: Date,
  aturan: AturanUlang,
  zona = 'Asia/Jakarta',
): Date | null {
  const kind = aturan.repeat_kind;
  if (kind === 'none') return null;

  // Batas akhir pengulangan?
  if (aturan.repeat_until && dasar.getTime() > new Date(aturan.repeat_until).getTime()) {
    return null;
  }

  // Ambil jam & menit lokal user dari waktu dasar (pakai zona user).
  const lokal = bagianLokal(dasar, zona);
  const jam = lokal.jam, menit = lokal.menit;

  const maju = new Date(dasar.getTime());
  const MAX_ITER = 400; // batas aman (~1 tahun+)

  switch (kind) {
    case 'daily': {
      maju.setUTCDate(maju.getUTCDate() + 1);
      return setJamLokal(maju, jam, menit, zona);
    }
    case 'weekday': {
      // Maju ke hari kerja berikutnya (Senin-Jumat).
      for (let i = 1; i <= 7; i++) {
        const coba = new Date(dasar.getTime());
        coba.setUTCDate(coba.getUTCDate() + i);
        const h = bagianLokal(coba, zona).hari;
        if (h >= 1 && h <= 5) return setJamLokal(coba, jam, menit, zona);
      }
      return null;
    }
    case 'weekly': {
      const target = aturan.repeat_value !== null ? Number(aturan.repeat_value) : bagianLokal(dasar, zona).hari;
      for (let i = 1; i <= MAX_ITER; i++) {
        const coba = new Date(dasar.getTime());
        coba.setUTCDate(coba.getUTCDate() + i);
        if (bagianLokal(coba, zona).hari === target) return setJamLokal(coba, jam, menit, zona);
      }
      return null;
    }
    case 'monthly': {
      const targetTgl = aturan.repeat_value ? Number(aturan.repeat_value) : bagianLokal(dasar, zona).tanggal;
      for (let i = 1; i <= MAX_ITER; i++) {
        const coba = new Date(dasar.getTime());
        coba.setUTCDate(coba.getUTCDate() + i);
        const l = bagianLokal(coba, zona);
        // Bila bulan tidak punya tanggal itu (mis. 31 di Februari), pakai hari terakhir.
        if (l.tanggal === targetTgl) return setJamLokal(coba, jam, menit, zona);
        // Deteksi akhir bulan untuk target > jumlah hari di bulan itu.
        const besok = new Date(coba.getTime());
        besok.setUTCDate(besok.getUTCDate() + 1);
        if (bagianLokal(besok, zona).tanggal === 1 && targetTgl > l.tanggal) {
          return setJamLokal(coba, jam, menit, zona);
        }
      }
      return null;
    }
    case 'yearly': {
      // Tanggal & bulan sama tahun depan.
      const coba = new Date(dasar.getTime());
      coba.setUTCFullYear(coba.getUTCFullYear() + 1);
      return setJamLokal(coba, jam, menit, zona);
    }
    default:
      return null;
  }
}

/** Ambil komponen lokal (jam, menit, tanggal, hari) menurut zona waktu. */
function bagianLokal(d: Date, zona: string): { jam: number; menit: number; tanggal: number; hari: number; bulan: number } {
  try {
    const f = new Intl.DateTimeFormat('en-US', {
      timeZone: zona, hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'numeric', weekday: 'short', hour12: false,
    });
    const p = f.formatToParts(d);
    const get = (t: string) => p.find((x) => x.type === t)?.value || '0';
    const namaHari = get('weekday');
    const petaHari: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return {
      jam: Number(get('hour')) % 24,
      menit: Number(get('minute')),
      tanggal: Number(get('day')),
      bulan: Number(get('month')),
      hari: petaHari[namaHari] ?? 0,
    };
  } catch {
    return { jam: d.getHours(), menit: d.getMinutes(), tanggal: d.getDate(), bulan: d.getMonth() + 1, hari: d.getDay() };
  }
}

/** Set jam & menit LOKAL pada sebuah Date (mengembalikan Date baru). */
function setJamLokal(d: Date, jam: number, menit: number, zona: string): Date {
  const lokal = bagianLokal(d, zona);
  // Selisih menit antara waktu lokal saat ini dan yang diinginkan.
  const bedaMenit = (jam * 60 + menit) - (lokal.jam * 60 + lokal.menit);
  return new Date(d.getTime() + bedaMenit * 60_000);
}

/** Label ramah untuk ditampilkan ke user. */
export function labelUlang(aturan: AturanUlang, zona = 'Asia/Jakarta'): string {
  switch (aturan.repeat_kind) {
    case 'daily': return 'tiap hari';
    case 'weekday': return 'tiap hari kerja (Senin-Jumat)';
    case 'weekly': {
      const v = aturan.repeat_value !== null ? Number(aturan.repeat_value) : null;
      return v !== null ? `tiap ${NAMA_HARI[v] ?? 'minggu'}` : 'tiap minggu';
    }
    case 'monthly': return `tiap tanggal ${aturan.repeat_value ?? 1}`;
    case 'yearly': return 'tiap tahun';
    default: return '';
  }
}

/** Format waktu untuk ditampilkan (memakai zona user). */
export function waktuTeks(d: Date, zona = 'Asia/Jakarta'): string {
  const t = formatInZone(d, zona);
  return `${t.dayName}, ${t.dateStr} ${t.time.slice(0, 5)}`;
}
