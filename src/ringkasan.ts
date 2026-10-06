/**
 * RINGKASAN PERIODIK, laporan bulanan/mingguan di chat.
 *
 * KENAPA (audit 05 Okt 2026): user harus membuka dashboard atau bertanya satu
 * per satu untuk tahu kondisi datanya. Dengan `/ringkasan`, satu perintah
 * menyajikan gambaran lengkap: keuangan, tugas, pengingat, catatan, game.
 *
 * Semua angka diambil dari DATABASE (bukan dikarang AI), konsisten dengan
 * aturan "jangan mengarang data pribadi".
 */
import { rekapUang, daftarTugas, daftarCatatan } from './notes.js';
import { daftarPengingatPending } from './reminder-ubah.js';
import { labelUlang } from './reminder-repeat.js';
import { ambilProfilWaktu } from './user-profile.js';

/** Format rupiah singkat. */
function rp(n: number): string {
  if (Math.abs(n) >= 1_000_000_000) return `Rp${(n / 1_000_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000_000) return `Rp${(n / 1_000_000).toFixed(1)}jt`;
  if (Math.abs(n) >= 1_000) return `Rp${Math.round(n / 1000)}rb`;
  return `Rp${n.toLocaleString('id-ID')}`;
}

/** Format tanggal ramah (zona user). */
function tanggalRamah(iso: string, zona: string): string {
  try {
    return new Date(iso).toLocaleString('id-ID', {
      timeZone: zona, weekday: 'short', day: 'numeric', month: 'short',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso.slice(0, 16);
  }
}

export interface OpsiRingkasan {
  /** Periode keuangan: 7 (minggu) atau 30 (bulan). */
  hari?: number;
}

/**
 * Susun laporan ringkasan untuk satu chat.
 * Mengembalikan teks siap kirim.
 */
export async function susunRingkasan(chatId: string, opsi: OpsiRingkasan = {}): Promise<string> {
  const hari = opsi.hari ?? 30;
  const labelPeriode = hari <= 7 ? '7 hari terakhir' : hari <= 30 ? '30 hari terakhir' : `${hari} hari terakhir`;

  // Zona waktu user (agar jam pengingat tampil benar).
  let zona = 'Asia/Jakarta';
  try {
    const p = await ambilProfilWaktu(chatId);
    if (p?.timezone) zona = p.timezone;
  } catch {
    // pakai default
  }

  // Ambil data paralel (lebih cepat daripada berurutan).
  const [uang, tugas, catatan, pengingat] = await Promise.all([
    rekapUang(chatId, hari).catch(() => ({ masuk: 0, keluar: 0, selisih: 0, perKategori: [] })),
    daftarTugas(chatId, true).catch(() => []),
    daftarCatatan(chatId, 5).catch(() => []),
    daftarPengingatPending(chatId).catch(() => []),
  ]);

  const baris: string[] = [];
  baris.push(`📊 *Ringkasan (${labelPeriode})*`);
  baris.push('');

  // ── KEUANGAN ──
  baris.push('💰 *Keuangan*');
  if (uang.masuk === 0 && uang.keluar === 0) {
    baris.push('   Belum ada catatan keuangan.');
  } else {
    baris.push(`   Pemasukan : ${rp(uang.masuk)}`);
    baris.push(`   Pengeluaran: ${rp(uang.keluar)}`);
    const tanda = uang.selisih >= 0 ? '🟢' : '🔴';
    baris.push(`   ${tanda} Selisih : ${rp(uang.selisih)}`);
    // 3 kategori terbesar
    const top = uang.perKategori.filter((k) => k.kind === 'out').slice(0, 3);
    if (top.length > 0) {
      baris.push('   Terbesar:');
      for (const k of top) baris.push(`     • ${k.category}: ${rp(k.total)} (${k.jumlah}x)`);
    }
  }
  baris.push('');

  // ── TUGAS ──
  baris.push('📝 *Tugas belum selesai*');
  if (tugas.length === 0) {
    baris.push('   Tidak ada tugas tertunda. 👍');
  } else {
    for (const t of tugas.slice(0, 5)) {
      const prioritas = t.priority >= 3 ? '🔴' : t.priority === 2 ? '🟡' : '⚪';
      // Pakai NOMOR URUT per-user (bukan ID global yang bisa #13).
      baris.push(`   ${prioritas} #${(t as { nomor?: number }).nomor ?? t.id} ${t.task.slice(0, 50)}`);
    }
    if (tugas.length > 5) baris.push(`   ... dan ${tugas.length - 5} tugas lain`);
  }
  baris.push('');

  // ── PENGINGAT ──
  baris.push('⏰ *Pengingat aktif*');
  if (pengingat.length === 0) {
    baris.push('   Tidak ada pengingat.');
  } else {
    for (const p of pengingat.slice(0, 5)) {
      const ulang = (p as { repeat_kind?: string; repeat_value?: string | null }).repeat_kind;
      const tandaUlang = ulang && ulang !== 'none'
        ? ` 🔁 ${labelUlang({ repeat_kind: ulang as never, repeat_value: (p as { repeat_value?: string | null }).repeat_value ?? null, repeat_until: null, repeat_count: 0 })}`
        : '';
      baris.push(`   • ${p.message.slice(0, 40)}, ${tanggalRamah(p.due_at, zona)}${tandaUlang}`);
    }
    if (pengingat.length > 5) baris.push(`   ... dan ${pengingat.length - 5} pengingat lain`);
  }
  baris.push('');

  // ── CATATAN ──
  if (catatan.length > 0) {
    baris.push('🗒️ *Catatan terakhir*');
    for (const c of catatan.slice(0, 3)) {
      const isi = (c.content || '').replace(/\s+/g, ' ').slice(0, 50);
      baris.push(`   • ${isi}`);
    }
    baris.push('');
  }

  // ── SARAN ──
  const saran: string[] = [];
  if (tugas.length > 0) saran.push(`selesaikan tugas dengan /selesai <id>`);
  if (uang.keluar > uang.masuk && uang.keluar > 0) saran.push('pengeluaran melebihi pemasukan');
  if (saran.length > 0) {
    baris.push(`💡 ${saran.join('; ')}.`);
  } else {
    baris.push('💡 Semua terkendali. Mantap! 👍');
  }

  return baris.join('\n');
}

/** Deteksi apakah pesan minta ringkasan. */
export function mintaRingkasan(teks: string): { hari: number } | null {
  const s = teks.toLowerCase().trim();

  // BUG YANG DIPERBAIKI (05 Okt 2026, ditemukan uji):
  // "tambah tugas penting KIRIM LAPORAN" salah diklasifikasi jadi ringkasan hanya
  // karena memuat kata "laporan". Padahal itu perintah membuat TUGAS.
  //
  // Aturan sekarang: TOLAK bila ada kata perintah pencatatan/aksi lain.
  if (/\b(?:tambah|tambahin|catat|catet|simpan|tulis|buat|bikin|masukkan|input|ingatkan|ingetin|remind|hapus|buang|selesai|selesaikan|undur|geser|tunda|majukan|batal)\b/.test(s)) {
    return null;
  }
  // Tolak bila ini pertanyaan tentang cara/definisi (bukan minta data sendiri).
  if (/\b(?:cara|gimana cara|bagaimana cara|apa itu|apa yang dimaksud|contoh|tutorial)\b/.test(s)) {
    return null;
  }

  // Harus ada kata ringkas/rekap/laporan/summary, TAPI kata "laporan" saja tidak
  // cukup (bisa bagian dari tugas). Wajib ada penanda permintaan data diri.
  const adaKataRingkas = /\b(?:ringkas(?:an)?|rekap|rangkum|summary|kesimpulan|overview)\b/.test(s);
  // "laporan" sah bila berdiri SENDIRI atau diikuti periode/keuangan
  // ("laporan mingguan", "laporan bulanan"), tapi TIDAK bila jadi objek tugas
  // ("kirim laporan", "buat laporan mingguan ke bos").
  const adaLaporanSah = /\b(?:laporan|report)\b/.test(s) &&
    !/\b(?:kirim|serahkan|setor|kumpulkan|sampaikan|presentasi|tulis|buat(?:kan)?|bikin)\s+(?:ke|kepada|untuk|sama|sama)?\s*(?:bos|atasan|klien|guru|dosen|kantor|tim)?\s*(?:laporan|report)\b/.test(s) &&
    (/^\s*\/?(?:laporan|report)\s*(?:mingguan|bulanan|harian|tahunan)?\s*$/.test(s) ||
     /\b(?:laporan|report)\s+(?:mingguan|bulanan|harian|tahunan|keuangan|pengeluaran|pemasukan|data)\b/.test(s) ||
     /\b(?:ku|saya|aku|milikku|punyaku|kondisi)\b/.test(s));
  const adaTanyaKondisi = /gimana\s*(?:kondisi|keuangan|semua|data)|kondisi\s*(?:keuangan|data|saya|aku)/.test(s);
  if (!adaKataRingkas && !adaLaporanSah && !adaTanyaKondisi) {
    return null;
  }

  // Periode
  let hari = 30;
  if (/\b(?:minggu(?:an)?|pekan|7\s*hari)\b/.test(s)) hari = 7;
  else if (/\b(?:hari\s*ini|hari\s*ini|today|sekarang)\b/.test(s)) hari = 1;
  else if (/\b(?:bulan(?:an)?|30\s*hari|sebulan)\b/.test(s)) hari = 30;
  else if (/\b(?:tahun(?:an)?|setahun)\b/.test(s)) hari = 365;

  return { hari };
}
