/**
 * PENCATATAN PRIBADI — catatan, tugas, keuangan, kebiasaan.
 *
 * KENAPA MODUL INI ADA (permintaan pemilik produk, 04 Okt 2026):
 *   "apakah bot nya bisa digunakan untuk mencatat dan mengingat sesuatu seperti
 *    to do list, mencatat pengeluaran uang, ataupun lainnya?"
 *   "kalo ada saran lain seperti fitur todo list dan lainnya apapun itu coba
 *    masukan dan tambahkan saja"
 *
 * Sebelumnya bot hanya punya /remind (pengingat berbasis menit) dan /salah
 * (preferensi personal). Modul ini menambah 4 kemampuan pencatatan:
 *   1. notes    — catatan bebas & jurnal (resep, ide, info penting)
 *   2. todos    — daftar tugas dengan prioritas & tenggat
 *   3. expenses — catatan pengeluaran/pemasukan + rekap
 *   4. habits   — kebiasaan berulang + streak
 *
 * DUA CARA PAKAI (permintaan user: "bisa tanpa format /?"):
 *   A. Bahasa alami — "catat pengeluaran 50rb buat makan"
 *      -> dideteksi `deteksiNiat()`, lalu DIKONFIRMASI dulu sebelum disimpan
 *         (permintaan user: "konfirmasi dulu (aman — hindari salah catat)").
 *   B. Perintah / — "/catat", "/todo", "/uang", "/rekap" (cepat & pasti)
 *
 * PRINSIP: modul ini TIDAK memanggil AI sendiri untuk hal yang bisa dipastikan
 * dengan pola. AI hanya dipakai di lapisan atas (skills.ts) bila perlu; di sini
 * semuanya deterministik agar cepat, murah, dan tidak berhalusinasi.
 */
import { db } from './db.js';

// ============================================================================
// TIPE & KONSTANTA
// ============================================================================

export type NoteKind = 'note' | 'todo' | 'expense' | 'habit';
export type ExpenseKind = 'in' | 'out';

export interface NiatTerdeteksi {
  kind: NoteKind;
  /** Kepercayaan 0..1. <0.6 → minta konfirmasi. */
  yakin: number;
  /** Data mentah hasil ekstraksi (belum divalidasi). */
  data: Record<string, unknown>;
  /** Ringkasan untuk pesan konfirmasi. */
  ringkas: string;
}

export interface CatatanRingkas {
  id: number;
  content: string;
  title?: string | null;
  created_at: string;
}

export interface TugasRingkas {
  id: number;
  task: string;
  priority: number;
  status: string;
  due_at?: string | null;
}

export interface UangRingkas {
  id: number;
  kind: ExpenseKind;
  amount: number;
  category: string;
  note?: string | null;
  occurred_at: string;
}

export interface RekapUang {
  masuk: number;
  keluar: number;
  selisih: number;
  perKategori: Array<{ kind: string; category: string; total: number; jumlah: number }>;
}

// ============================================================================
// UTILITAS ANGKA & TANGGAL (deterministik, tanpa AI)
// ============================================================================

/**
 * Ubah nominal Indonesia menjadi angka.
 * Mendukung: 50000, 50.000, 50rb, 50 ribu, 1jt, 1,5jt, 2 juta, 10k.
 */
export function parseNominal(teks: string): number | null {
  const s = teks.toLowerCase().replace(/\s+/g, ' ').trim();

  // Pola dengan satuan: "50rb", "50 ribu", "1jt", "1,5 juta", "10k"
  const m = s.match(/(\d+(?:[.,]\d+)?)\s*(rb|ribu|k|jt|juta|m|miliar|milyar)\b/);
  if (m) {
    const angka = Number(m[1].replace(',', '.'));
    if (!Number.isFinite(angka)) return null;
    const satuan = m[2];
    const faktor =
      satuan === 'rb' || satuan === 'ribu' || satuan === 'k' ? 1_000
      : satuan === 'jt' || satuan === 'juta' ? 1_000_000
      : 1_000_000_000; // m, miliar, milyar
    return Math.round(angka * faktor);
  }

  // Pola angka biasa: "50.000" atau "50000" atau "1.234.567"
  const m2 = s.match(/(\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{1,2})?/);
  if (m2) {
    const bersih = m2[1].replace(/\./g, '');
    const n = Number(bersih);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

/** Kategori keuangan dari kata kunci (deterministik). */
export function tebakKategori(teks: string): string {
  const s = teks.toLowerCase();
  const peta: Array<[RegExp, string]> = [
    // Kesehatan & tagihan diperiksa LEBIH DULU dari "belanja", karena frasa
    // seperti "beli obat" / "bayar listrik" memuat kata "beli/bayar" yang jika
    // diperiksa belakangan akan salah masuk kategori "belanja"/"lainnya".
    [/obat|dokter|klinik|rumah sakit|\brs\b|vitamin|periksa|medis|bpjs|apotek|apotik/, 'kesehatan'],
    [/listrik|air|pdam|pln|internet|wifi|indihome|pulsa|kuota|token|gas|sewa|kontrak|kos|tagihan/, 'tagihan'],
    [/makan|minum|kopi|nasi|ayam|bakso|sate|resto|warung|kafe|cafe|jajan|snack|sarapan|lunch|dinner|gofood|grabfood/, 'makan'],
    [/bensin|pertalite|pertamax|solar|transport|ojek|grab|gojek|taksi|taxi|bus|kereta|tiket|parkir|tol|angkot/, 'transport'],
    [/belanja|beli|shopping|supermarket|indomaret|alfamart|tokopedia|shopee|lazada/, 'belanja'],
    [/sekolah|kuliah|buku|kursus|les|seminar|training|pendidikan|ukt|spp/, 'pendidikan'],
    [/gaji|bonus|thr|upah|honor|fee|pendapatan|penghasilan|proyek|jual/, 'gaji'],
    [/hiburan|nonton|bioskop|game|langganan|netflix|spotify|liburan|wisata|jalan-jalan/, 'hiburan'],
  ];
  for (const [re, kat] of peta) if (re.test(s)) return kat;
  return 'lainnya';
}

/**
 * Ubah waktu alami Indonesia menjadi Date.
 * Mendukung: "besok jam 8", "nanti jam 15:30", "hari ini jam 7 pagi",
 *           "3 hari lagi", "senin depan", "30 menit lagi".
 */
export function parseWaktuAlami(teks: string, sekarang: Date = new Date()): Date | null {
  const s = teks.toLowerCase().trim();
  const hasil = new Date(sekarang.getTime());

  // "N menit lagi" / "N jam lagi" / "N hari lagi"
  const mJeda = s.match(/(\d+)\s*(menit|jam|hari|minggu|bulan)\s*(lagi|kemudian|kedepan)?/);
  if (mJeda) {
    const n = Number(mJeda[1]);
    const satuan = mJeda[2];
    const ms =
      satuan === 'menit' ? n * 60_000
      : satuan === 'jam' ? n * 3_600_000
      : satuan === 'hari' ? n * 86_400_000
      : satuan === 'minggu' ? n * 7 * 86_400_000
      : n * 30 * 86_400_000;
    // Bila ada jam eksplisit ("2 jam lagi jam 8"), abaikan — jeda lebih pasti.
    return new Date(sekarang.getTime() + ms);
  }

  // Hari: hari ini / besok / lusa / senin..minggu
  const namaHari = ['minggu', 'senin', 'selasa', 'rabu', 'kamis', 'jumat', 'sabtu'];
  let geserHari: number | null = null;
  if (/\bbesok\b/.test(s)) geserHari = 1;
  else if (/\blusa\b/.test(s)) geserHari = 2;
  else if (/\bhari ini\b/.test(s)) geserHari = 0;
  else {
    for (let i = 0; i < namaHari.length; i++) {
      if (new RegExp(`\\b${namaHari[i]}\\b`).test(s)) {
        const skrg = sekarang.getDay();
        let delta = (i - skrg + 7) % 7;
        if (delta === 0) delta = 7; // "senin" saat hari Senin → Senin depan
        geserHari = delta;
        break;
      }
    }
  }

  // Jam: "jam 8", "jam 08:30", "pukul 15.00", "8 pagi", "7 malam"
  const mJam = s.match(/(?:jam|pukul)\s*(\d{1,2})(?:[:.](\d{2}))?/);
  let jam: number | null = null;
  let menit = 0;
  if (mJam) {
    jam = Number(mJam[1]);
    menit = mJam[2] ? Number(mJam[2]) : 0;
    // "jam 7 malam" → 19, "jam 8 pagi" → 8
    if (/\b(malam|sore|petang)\b/.test(s) && jam < 12) jam += 12;
    if (/\b(pagi|subuh)\b/.test(s) && jam === 12) jam = 0;
  }

  if (geserHari === null && jam === null) return null;

  if (geserHari !== null) hasil.setDate(hasil.getDate() + geserHari);
  if (jam !== null) {
    hasil.setHours(jam, menit, 0, 0);
  } else if (geserHari !== null) {
    // Tanpa jam eksplisit → default 08:00 pagi
    hasil.setHours(8, 0, 0, 0);
  }
  // Bila hasil sudah lewat (mis. "jam 8" tapi sekarang 9 malam) → besok
  if (hasil.getTime() <= sekarang.getTime() && geserHari === null) {
    hasil.setDate(hasil.getDate() + 1);
  }
  return hasil;
}

// ============================================================================
// DETEKSI NIAT (deterministik — tanpa AI, cepat, tanpa biaya token)
// ============================================================================

/**
 * Deteksi niat pencatatan dari bahasa alami.
 * Mengembalikan null bila pesan bukan niat mencatat (obrolan biasa).
 *
 * Sengaja KONSERVATIF: lebih baik melewatkan catatan (user bisa pakai /)
 * daripada salah mencatat obrolan biasa.
 */
export function deteksiNiat(teks: string): NiatTerdeteksi | null {
  const s = teks.toLowerCase().trim();
  if (s.length < 6 || s.length > 400) return null;

  // ── 1. KEUANGAN ──
  // Kata pemicu + nominal wajib ada (agar "aku makan mahal" tidak tercatat)
  const pemicuUang =
    /\b(catat|catet|note|ingat|simpan|tulis)\b/.test(s) && /\b(pengeluaran|pemasukan|belanja|bayar|beli|uang|duit|habis|keluar|masuk|gaji|bonus|dapat|terima)\b/.test(s);
  const nominal = parseNominal(s);
  if (pemicuUang && nominal) {
    const kind: ExpenseKind = /\b(masuk|gaji|bonus|dapat|terima|pemasukan|honor|fee|pendapatan)\b/.test(s) ? 'in' : 'out';
    return {
      kind: 'expense',
      yakin: 0.9,
      data: { amount: nominal, kind, category: tebakKategori(s), note: teks.trim() },
      ringkas: `${kind === 'in' ? 'Pemasukan' : 'Pengeluaran'} Rp${nominal.toLocaleString('id-ID')} (${tebakKategori(s)})`,
    };
  }

  // ── 2. TUGAS / TO-DO ──
  const pemicuTodo =
    /\b(tambah|tambahin|catat|catet|buat|bikin)\b[^.]{0,20}\b(tugas|todo|to-do|task|list|daftar|kerjaan|pekerjaan|pr)\b/.test(s) ||
    /^\s*(todo|to-do|tugas)\s*[:]\s*\S/.test(s) ||
    /\b(ingetin|ingatkan)\s+(aku|saya)?\s*(buat|untuk|jangan lupa)\b/.test(s);
  if (pemicuTodo) {
    // Bersihkan berulang: buang SEMUA kata pemicu & kata sifat di awal, karena
    // kalimat bisa memuat lebih dari satu ("tambah tugas penting bayar listrik"
    // punya "tambah" + "tugas" + "penting").
    let isi = teks.trim();
    const polaBuang = [
      /^\s*\/?(todo|to-do|tugas|task|tambah|tambahin|tambahin|catat|catet|buat|bikin)\b\s*[:\-]?\s*/i,
      /^\s*(penting|urgent|segera|buruan|prioritas|santai|dong|nih|ya)\b\s*/i,
    ];
    let berubah = true;
    let putaran = 0;
    while (berubah && putaran < 5) {
      berubah = false;
      for (const pola of polaBuang) {
        const sebelum = isi;
        isi = isi.replace(pola, '');
        if (isi !== sebelum) berubah = true;
      }
      putaran++;
    }
    isi = isi.trim();
    if (isi.length >= 3) {
      const prioritas = /\b(penting|urgent|segera|buruan|prioritas)\b/.test(s) ? 1 : /\b(santai|nanti|kapan-kapan|gak urgent)\b/.test(s) ? 3 : 2;
      const due = parseWaktuAlami(s);
      return {
        kind: 'todo',
        yakin: 0.85,
        data: { task: isi, priority: prioritas, due_at: due ? due.toISOString() : null },
        ringkas: `Tugas: "${isi}"${due ? ` (tenggat ${due.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })})` : ''}`,
      };
    }
  }

  // ── 3. PENGINGAT BAHASA ALAMI ──
  // "ingatkan saya besok jam 8 rapat" — beda dari /remind (menit)
  const pemicuIngat =
    /\b(ingatkan|ingetin|remind)\b/.test(s) && /\b(besok|lusa|hari ini|jam|pukul|pagi|siang|sore|malam|nanti|senin|selasa|rabu|kamis|jumat|sabtu|minggu)\b/.test(s);
  if (pemicuIngat) {
    const kapan = parseWaktuAlami(s);
    if (kapan) {
      // Buang kata pemicu, kata waktu, dan sisa "jam 8" agar pesan bersih.
      const pesan = teks
        .replace(/^\s*(tolong\s+)?(ingatkan|ingetin|remind)\s*(aku|saya)?\s*/i, '')
        .replace(/\b(besok|lusa|hari ini|nanti|pagi|siang|sore|malam)\b/gi, '')
        .replace(/\b(jam|pukul)\s*\d{1,2}([:.]\d{2})?/gi, '')
        .replace(/\b(senin|selasa|rabu|kamis|jumat|sabtu|minggu)\b/gi, '')
        .replace(/\s{2,}/g, ' ')
        .trim() || teks.trim();
      return {
        kind: 'note', // pengingat disimpan lewat jalur reminder, ditandai di atas
        yakin: 0.8,
        data: { pengingat: true, due_at: kapan.toISOString(), message: pesan },
        ringkas: `Pengingat "${pesan}" pada ${kapan.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })}`,
      };
    }
  }

  // ── 4. CATATAN BEBAS ──
  const pemicuCatatan =
    /\b(catat|catet|simpan|note|tulis)\b[^.]{0,15}\b(catatan|ini|nih|ya|dong)?\b/.test(s) &&
    !/\b(tugas|todo|pengeluaran|pemasukan|uang|duit)\b/.test(s);
  if (pemicuCatatan) {
    const isi = teks.replace(/^\s*(catat|catet|simpan|note|tulis)\s*(ini|nih|ya|dong)?\s*[:\-]?\s*/i, '').trim();
    if (isi.length >= 5) {
      return {
        kind: 'note',
        yakin: 0.75,
        data: { content: isi },
        ringkas: `Catatan: "${isi.slice(0, 80)}${isi.length > 80 ? '…' : ''}"`,
      };
    }
  }

  return null;
}

// ============================================================================
// SIMPAN & AMBIL — CATATAN
// ============================================================================

export async function simpanCatatan(
  chatId: string, content: string, opts?: { title?: string; tags?: string[]; actor?: string; platform?: string },
): Promise<number | null> {
  const c = db();
  if (!c) return null;
  try {
    const { data, error } = await c.from('notes').insert({
      chat_id: chatId,
      content: content.slice(0, 4000),
      title: opts?.title?.slice(0, 120) ?? null,
      tags: opts?.tags ?? [],
      actor: opts?.actor ?? null,
      platform: opts?.platform ?? 'whatsapp',
    }).select('id').single();
    if (error) return null;
    return (data as { id: number }).id;
  } catch {
    return null;
  }
}

export async function daftarCatatan(chatId: string, limit = 10): Promise<CatatanRingkas[]> {
  const c = db();
  if (!c) return [];
  try {
    const { data, error } = await c.from('notes')
      .select('id, title, content, created_at')
      .eq('chat_id', chatId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return data as CatatanRingkas[];
  } catch {
    return [];
  }
}

export async function cariCatatan(chatId: string, kata: string, limit = 10): Promise<CatatanRingkas[]> {
  const c = db();
  if (!c) return [];
  try {
    const { data, error } = await c.from('notes')
      .select('id, title, content, created_at')
      .eq('chat_id', chatId)
      .ilike('content', `%${kata}%`)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return data as CatatanRingkas[];
  } catch {
    return [];
  }
}

export async function hapusCatatan(chatId: string, id: number): Promise<boolean> {
  const c = db();
  if (!c) return false;
  try {
    const { error } = await c.from('notes').delete().eq('chat_id', chatId).eq('id', id);
    return !error;
  } catch {
    return false;
  }
}

// ============================================================================
// SIMPAN & AMBIL — TUGAS
// ============================================================================

export async function simpanTugas(
  chatId: string, task: string, opts?: { priority?: number; due_at?: string | null; actor?: string; platform?: string },
): Promise<number | null> {
  const c = db();
  if (!c) return null;
  try {
    const { data, error } = await c.from('todos').insert({
      chat_id: chatId,
      task: task.slice(0, 500),
      priority: opts?.priority ?? 2,
      due_at: opts?.due_at ?? null,
      actor: opts?.actor ?? null,
      platform: opts?.platform ?? 'whatsapp',
    }).select('id').single();
    if (error) return null;
    return (data as { id: number }).id;
  } catch {
    return null;
  }
}

export async function daftarTugas(chatId: string, hanyaBelumSelesai = true): Promise<TugasRingkas[]> {
  const c = db();
  if (!c) return [];
  try {
    let q = c.from('todos').select('id, task, priority, status, due_at').eq('chat_id', chatId);
    if (hanyaBelumSelesai) q = q.eq('status', 'open');
    const { data, error } = await q.order('priority', { ascending: true }).order('created_at', { ascending: true }).limit(50);
    if (error || !data) return [];
    return data as TugasRingkas[];
  } catch {
    return [];
  }
}

export async function selesaikanTugas(chatId: string, id: number): Promise<boolean> {
  const c = db();
  if (!c) return false;
  try {
    const { error } = await c.from('todos')
      .update({ status: 'done', done_at: new Date().toISOString() })
      .eq('chat_id', chatId).eq('id', id);
    return !error;
  } catch {
    return false;
  }
}

export async function hapusTugas(chatId: string, id: number): Promise<boolean> {
  const c = db();
  if (!c) return false;
  try {
    const { error } = await c.from('todos').delete().eq('chat_id', chatId).eq('id', id);
    return !error;
  } catch {
    return false;
  }
}

// ============================================================================
// SIMPAN & AMBIL — KEUANGAN
// ============================================================================

export async function simpanUang(
  chatId: string,
  amount: number,
  kind: ExpenseKind,
  category: string,
  note?: string,
  opts?: { actor?: string; platform?: string; occurred_at?: string },
): Promise<number | null> {
  const c = db();
  if (!c) return null;
  try {
    const { data, error } = await c.from('expenses').insert({
      chat_id: chatId,
      amount,
      kind,
      category: category.slice(0, 40),
      note: note?.slice(0, 300) ?? null,
      occurred_at: opts?.occurred_at ?? new Date().toISOString(),
      actor: opts?.actor ?? null,
      platform: opts?.platform ?? 'whatsapp',
    }).select('id').single();
    if (error) return null;
    return (data as { id: number }).id;
  } catch {
    return null;
  }
}

export async function rekapUang(chatId: string, dariHari: number = 30): Promise<RekapUang> {
  const kosong: RekapUang = { masuk: 0, keluar: 0, selisih: 0, perKategori: [] };
  const c = db();
  if (!c) return kosong;
  try {
    const sejak = new Date(Date.now() - dariHari * 86_400_000).toISOString();
    const { data, error } = await c.from('expenses')
      .select('kind, amount, category')
      .eq('chat_id', chatId)
      .gte('occurred_at', sejak);
    if (error || !data) return kosong;

    let masuk = 0, keluar = 0;
    const kat = new Map<string, { total: number; jumlah: number }>();
    for (const r of data as Array<{ kind: string; amount: number; category: string }>) {
      const amt = Number(r.amount) || 0;
      if (r.kind === 'in') masuk += amt; else keluar += amt;
      const key = `${r.kind}|${r.category}`;
      const cur = kat.get(key) ?? { total: 0, jumlah: 0 };
      cur.total += amt; cur.jumlah += 1;
      kat.set(key, cur);
    }
    const perKategori = [...kat.entries()]
      .map(([k, v]) => {
        const [kind, category] = k.split('|');
        return { kind, category, total: v.total, jumlah: v.jumlah };
      })
      .sort((a, b) => b.total - a.total);

    return { masuk, keluar, selisih: masuk - keluar, perKategori };
  } catch {
    return kosong;
  }
}

export async function hapusUang(chatId: string, id: number): Promise<boolean> {
  const c = db();
  if (!c) return false;
  try {
    const { error } = await c.from('expenses').delete().eq('chat_id', chatId).eq('id', id);
    return !error;
  } catch {
    return false;
  }
}

// ============================================================================
// SIMPAN & AMBIL — KEBIASAAN
// ============================================================================

export async function simpanKebiasaan(chatId: string, name: string, targetPerDay = 1, opts?: { actor?: string; platform?: string }): Promise<number | null> {
  const c = db();
  if (!c) return null;
  try {
    const { data, error } = await c.from('habits').insert({
      chat_id: chatId,
      name: name.slice(0, 120),
      target_per_day: targetPerDay,
      actor: opts?.actor ?? null,
      platform: opts?.platform ?? 'whatsapp',
    }).select('id').single();
    if (error) return null;
    return (data as { id: number }).id;
  } catch {
    return null;
  }
}

/** Centang kebiasaan hari ini; kembalikan streak terbaru (null bila gagal). */
export async function centangKebiasaan(chatId: string, id: number): Promise<{ streak: number; best: number } | null> {
  const c = db();
  if (!c) return null;
  try {
    const { data: h, error: e1 } = await c.from('habits')
      .select('id, streak, best_streak, last_done_at')
      .eq('chat_id', chatId).eq('id', id).single();
    if (e1 || !h) return null;
    const row = h as { streak: number; best_streak: number; last_done_at: string | null };

    const hariIni = new Date().toISOString().slice(0, 10);
    const terakhir = row.last_done_at ? row.last_done_at.slice(0, 10) : null;
    const kemarin = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

    let streak = row.streak;
    if (terakhir === hariIni) {
      // sudah dicentang hari ini → tidak menambah streak
    } else if (terakhir === kemarin) {
      streak += 1;
    } else {
      streak = 1; // putus → mulai dari 1
    }
    const best = Math.max(row.best_streak, streak);

    await c.from('habit_logs').upsert(
      { habit_id: id, done_on: hariIni, count: 1 },
      { onConflict: 'habit_id,done_on' },
    );
    const { error: e2 } = await c.from('habits')
      .update({ streak, best_streak: best, last_done_at: new Date().toISOString() })
      .eq('id', id);
    if (e2) return null;
    return { streak, best };
  } catch {
    return null;
  }
}

export async function daftarKebiasaan(chatId: string): Promise<Array<{ id: number; name: string; streak: number; best_streak: number; last_done_at: string | null }>> {
  const c = db();
  if (!c) return [];
  try {
    const { data, error } = await c.from('habits')
      .select('id, name, streak, best_streak, last_done_at')
      .eq('chat_id', chatId).eq('active', true)
      .order('created_at', { ascending: true }).limit(30);
    if (error || !data) return [];
    return data as Array<{ id: number; name: string; streak: number; best_streak: number; last_done_at: string | null }>;
  } catch {
    return [];
  }
}

// ============================================================================
// FORMATTER (untuk balasan bot — teks rapi, tanpa AI)
// ============================================================================

export function formatDaftarCatatan(rows: CatatanRingkas[]): string {
  if (!rows.length) return 'Belum ada catatan.';
  return rows.map((r, i) => {
    const judul = r.title ? `*${r.title}* — ` : '';
    const isi = r.content.length > 120 ? `${r.content.slice(0, 120)}…` : r.content;
    return `${i + 1}. ${judul}${isi}`;
  }).join('\n');
}

export function formatDaftarTugas(rows: TugasRingkas[]): string {
  if (!rows.length) return 'Belum ada tugas. 🎉';
  const label = (p: number) => (p === 1 ? '🔴' : p === 3 ? '🟢' : '🟡');
  return rows.map((r) => {
    const due = r.due_at
      ? ` — tenggat ${new Date(r.due_at).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' })}`
      : '';
    return `${label(r.priority)} #${r.id} ${r.task}${due}`;
  }).join('\n');
}

export function formatRekapUang(r: RekapUang, hari: number): string {
  // Format Rupiah TANPA spasi: "Rp20.000" (bukan "Rp20. 000").
  // `toLocaleString('id-ID')` bisa menyisipkan spasi tipis (U+00A0/U+202F) yang
  // tampil seperti spasi di WhatsApp. Karena itu hasilnya dibersihkan eksplisit.
  const rp = (n: number) =>
    `Rp${Math.round(n).toLocaleString('id-ID').replace(/[\u00A0\u202F\s]/g, '')}`;
  const baris = [`*Rekap ${hari} hari terakhir*`, `Masuk   : ${rp(r.masuk)}`, `Keluar  : ${rp(r.keluar)}`, `Selisih : ${rp(r.selisih)}`];
  const keluarKat = r.perKategori.filter((x) => x.kind === 'out').slice(0, 8);
  if (keluarKat.length) {
    baris.push('', '*Pengeluaran per kategori:*');
    for (const k of keluarKat) baris.push(`• ${k.category}: ${rp(k.total)} (${k.jumlah}x)`);
  }
  return baris.join('\n');
}

export function formatDaftarKebiasaan(rows: Array<{ id: number; name: string; streak: number; best_streak: number; last_done_at: string | null }>): string {
  if (!rows.length) return 'Belum ada kebiasaan yang dilacak.';
  const hariIni = new Date().toISOString().slice(0, 10);
  return rows.map((r) => {
    const sudah = r.last_done_at?.slice(0, 10) === hariIni ? '✅' : '⬜';
    return `${sudah} #${r.id} ${r.name} — streak ${r.streak} hari (terbaik ${r.best_streak})`;
  }).join('\n');
}

// ============================================================================
// ORKESTRATOR — dipakai lapisan pesan (WhatsApp/Telegram)
// ============================================================================

/**
 * Konfirmasi tertunda per chat: setelah bot menanyakan "simpan?", pesan
 * berikutnya ("iya"/"tidak") diproses di sini tanpa memanggil AI.
 * Disimpan di memori proses (cukup — konfirmasi hanya bertahan beberapa detik).
 */
interface KonfirmasiTertunda {
  niat: NiatTerdeteksi;
  actor?: string;
  platform: string;
  at: number;
}
const konfirmasiTertunda = new Map<string, KonfirmasiTertunda>();
const KONFIRMASI_TTL_MS = 120_000; // 2 menit

/** Deteksi jawaban konfirmasi singkat. */
function jawabanKonfirmasi(teks: string): 'ya' | 'tidak' | null {
  const s = teks.toLowerCase().trim();
  if (/^(ya|iya|y|yes|yup|yoi|betul|benar|bener|ok|oke|sip|gas|simpan|catat|lanjut|boleh|udah|sudah)\b/.test(s)) return 'ya';
  if (/^(tidak|tdk|gak|ga|nggak|ngga|no|nope|batal|cancel|jangan|salah|bukan)\b/.test(s)) return 'tidak';
  return null;
}

/** Bentuk entri dari niat yang sudah dikonfirmasi. */
async function simpanDariNiat(
  chatId: string, niat: NiatTerdeteksi, opts: { actor?: string; platform: string },
): Promise<{ ok: boolean; pesan: string }> {
  const d = niat.data;
  if (niat.kind === 'expense') {
    const id = await simpanUang(
      chatId,
      Number(d.amount) || 0,
      (d.kind as ExpenseKind) || 'out',
      String(d.category || 'lainnya'),
      String(d.note || ''),
      { actor: opts.actor, platform: opts.platform },
    );
    return id
      ? { ok: true, pesan: `✅ Tercatat (#${id}) — ${niat.ringkas}` }
      : { ok: false, pesan: '⚠️ Gagal menyimpan ke database. Coba lagi nanti ya.' };
  }
  if (niat.kind === 'todo') {
    const id = await simpanTugas(chatId, String(d.task || ''), {
      priority: Number(d.priority) || 2,
      due_at: (d.due_at as string) ?? null,
      actor: opts.actor,
      platform: opts.platform,
    });
    return id
      ? { ok: true, pesan: `✅ Tugas dicatat (#${id}) — ${niat.ringkas}` }
      : { ok: false, pesan: '⚠️ Gagal menyimpan tugas. Coba lagi nanti ya.' };
  }
  // note (termasuk pengingat bahasa alami)
  if (d.pengingat && d.due_at) {
    const { saveReminderToDb } = await import('./remind.js');
    const ok = await saveReminderToDb(
      chatId, String(d.message || 'Pengingat'), new Date(String(d.due_at)),
      opts.platform === 'telegram' ? 'telegram' : 'whatsapp',
    );
    return ok
      ? { ok: true, pesan: `✅ Pengingat disimpan — ${niat.ringkas}` }
      : { ok: false, pesan: '⚠️ Gagal menyimpan pengingat. Coba lagi nanti ya.' };
  }
  const id = await simpanCatatan(chatId, String(d.content || ''), {
    actor: opts.actor, platform: opts.platform,
  });
  return id
    ? { ok: true, pesan: `✅ Catatan disimpan (#${id}) — ${niat.ringkas}` }
    : { ok: false, pesan: '⚠️ Gagal menyimpan catatan. Coba lagi nanti ya.' };
}

/**
 * Tangani pesan yang mungkin berkaitan dengan pencatatan.
 * Mengembalikan { ditangani: true, reply } bila pesan sudah diurus di sini
 * (pemanggil TIDAK boleh meneruskannya ke AI), atau { ditangani: false }.
 */
export async function tanganiPencatatan(
  teks: string,
  chatId: string,
  ctx: unknown,
  opts: { actor?: string; platform: string },
): Promise<{ ditangani: boolean; reply: string; jalur: string }> {
  const s = teks.trim();
  const low = s.toLowerCase();

  // ── 0. Jawaban konfirmasi tertunda ──
  const tertunda = konfirmasiTertunda.get(chatId);
  if (tertunda) {
    if (Date.now() - tertunda.at > KONFIRMASI_TTL_MS) {
      konfirmasiTertunda.delete(chatId);
    } else {
      const jawab = jawabanKonfirmasi(low);
      if (jawab === 'ya') {
        konfirmasiTertunda.delete(chatId);
        const r = await simpanDariNiat(chatId, tertunda.niat, { actor: opts.actor, platform: opts.platform });
        return { ditangani: true, reply: r.pesan, jalur: 'konfirmasi-ya' };
      }
      if (jawab === 'tidak') {
        konfirmasiTertunda.delete(chatId);
        return { ditangani: true, reply: 'Oke, tidak dicatat. 👍', jalur: 'konfirmasi-tidak' };
      }
      // bukan jawaban ya/tidak → lanjut ke deteksi baru, tapi konfirmasi lama tetap
    }
  }

  // ── A. PERINTAH EKSPLISIT (/) ──

  // /catat <isi>  atau  /note <isi>
  let m = low.match(/^\/(?:catat|note|notes)\s+([\s\S]+)/);
  if (m) {
    const isi = s.replace(/^\/(?:catat|note|notes)\s+/i, '').trim();
    konfirmasiTertunda.set(chatId, {
      niat: { kind: 'note', yakin: 1, data: { content: isi }, ringkas: `Catatan: "${isi.slice(0, 80)}"` },
      actor: opts.actor, platform: opts.platform, at: Date.now(),
    });
    return { ditangani: true, reply: `Simpan catatan ini?\n"${isi.slice(0, 200)}"\n\nBalas *iya* untuk simpan, *tidak* untuk batal.`, jalur: 'perintah-catat' };
  }

  // /todo <isi>  atau  /tugas <isi>
  m = low.match(/^\/(?:todo|tugas|task)\s+([\s\S]+)/);
  if (m) {
    const isi = s.replace(/^\/(?:todo|tugas|task)\s+/i, '').trim();
    const prio = /penting|urgent|segera/.test(low) ? 1 : 2;
    const due = parseWaktuAlami(low);
    konfirmasiTertunda.set(chatId, {
      niat: { kind: 'todo', yakin: 1, data: { task: isi, priority: prio, due_at: due?.toISOString() ?? null }, ringkas: `Tugas: "${isi}"` },
      actor: opts.actor, platform: opts.platform, at: Date.now(),
    });
    return { ditangani: true, reply: `Tambah tugas ini?\n"${isi.slice(0, 200)}"\n\nBalas *iya* untuk simpan, *tidak* untuk batal.`, jalur: 'perintah-todo' };
  }

  // /uang <nominal> [keterangan]   |   /masuk <nominal> [ket]
  m = low.match(/^\/(?:uang|keluar|out)\s+([\s\S]+)/);
  const mIn = low.match(/^\/(?:masuk|in|gaji)\s+([\s\S]+)/);
  if (m || mIn) {
    const isi = (m || mIn)![1];
    const nominal = parseNominal(isi);
    if (!nominal) {
      return { ditangani: true, reply: 'Nominalnya belum kebaca. Contoh: /uang 50000 makan siang', jalur: 'perintah-uang-gagal' };
    }
    const kind: ExpenseKind = mIn ? 'in' : 'out';
    const kategori = tebakKategori(isi);
    konfirmasiTertunda.set(chatId, {
      niat: {
        kind: 'expense', yakin: 1,
        data: { amount: nominal, kind, category: kategori, note: isi },
        ringkas: `${kind === 'in' ? 'Pemasukan' : 'Pengeluaran'} Rp${nominal.toLocaleString('id-ID')} (${kategori})`,
      },
      actor: opts.actor, platform: opts.platform, at: Date.now(),
    });
    return { ditangani: true, reply: `Catat ini?\n${kind === 'in' ? '💰 Pemasukan' : '💸 Pengeluaran'} *Rp${nominal.toLocaleString('id-ID')}* (${kategori})\n\nBalas *iya* untuk simpan, *tidak* untuk batal.`, jalur: 'perintah-uang' };
  }

  // /rekap [hari]
  m = low.match(/^\/rekap(?:\s+(\d+))?/);
  if (m) {
    const hari = m[1] ? Math.min(365, Math.max(1, Number(m[1]))) : 30;
    const r = await rekapUang(chatId, hari);
    return { ditangani: true, reply: formatRekapUang(r, hari), jalur: 'perintah-rekap' };
  }

  // /list  atau  /tugas-saya
  if (/^\/(?:list|daftar|tugas-saya|todos?)$/.test(low)) {
    const t = await daftarTugas(chatId, true);
    return { ditangani: true, reply: `*Tugas kamu:*\n${formatDaftarTugas(t)}`, jalur: 'perintah-list' };
  }

  // /catatan  (daftar catatan)
  if (/^\/(?:catatan|notes)$/.test(low)) {
    const c = await daftarCatatan(chatId, 10);
    return { ditangani: true, reply: `*Catatan terakhir:*\n${formatDaftarCatatan(c)}`, jalur: 'perintah-catatan' };
  }

  // /selesai <id>  |  /hapus <id>
  m = low.match(/^\/selesai\s+(\d+)/);
  if (m) {
    const ok = await selesaikanTugas(chatId, Number(m[1]));
    return { ditangani: true, reply: ok ? `✅ Tugas #${m[1]} selesai!` : `Tugas #${m[1]} tidak ditemukan.`, jalur: 'perintah-selesai' };
  }
  m = low.match(/^\/hapus\s+(\d+)/);
  if (m) {
    const id = Number(m[1]);
    const a = await hapusTugas(chatId, id);
    const b = a ? false : await hapusCatatan(chatId, id);
    const c = a || b ? false : await hapusUang(chatId, id);
    return { ditangani: true, reply: a || b || c ? `🗑️ #${id} dihapus.` : `#${id} tidak ditemukan.`, jalur: 'perintah-hapus' };
  }

  // ── B0. PERTANYAAN (jawab dari DATABASE, JANGAN dikirim ke AI) ──
  // Temuan 04 Okt: "berapa sisa uang saya" pernah dijawab AI dengan ANGKA
  // KARANGAN (Rp20.000) padahal tabel kosong. Pertanyaan seperti ini HARUS
  // dijawab di sini dari data nyata, bukan diserahkan ke model.
  const jenisTanya = deteksiPertanyaan(s);
  if (jenisTanya) {
    const jawab = await jawabPertanyaan(jenisTanya, chatId);
    return { ditangani: true, reply: jawab, jalur: `tanya-${jenisTanya}` };
  }

  // ── B. DETEKSI NIAT BAHASA ALAMI ──
  const niat = deteksiNiat(s);
  if (niat) {
    // Selalu konfirmasi dulu (permintaan user: aman — hindari salah catat)
    konfirmasiTertunda.set(chatId, { niat, actor: opts.actor, platform: opts.platform, at: Date.now() });
    return {
      ditangani: true,
      reply: `Sepertinya kamu mau mencatat:\n*${niat.ringkas}*\n\nBalas *iya* untuk simpan, *tidak* untuk batal.`,
      jalur: `niat-${niat.kind}`,
    };
  }

  return { ditangani: false, reply: '', jalur: '' };
}

// ============================================================================
// DETEKSI PERTANYAAN — jawab dari DATABASE, bukan dari "pengetahuan" model
// ============================================================================

/**
 * KENAPA INI PENTING (temuan nyata 04 Okt 2026):
 * User bertanya "berapa sisa uang saya" padahal tabel `expenses` KOSONG (0 baris).
 * Bot menjawab "Sisa uang kamu tinggal Rp20.000 dari pemasukan 100 ribu dikurangi
 * pengeluaran 80 ribu" — ANGKA KARANGAN. Halusinasi data keuangan itu berbahaya:
 * user bisa mengambil keputusan salah berdasarkan angka palsu.
 *
 * Sebabnya: pertanyaan seperti itu TIDAK melewati modul ini sama sekali — langsung
 * dikirim ke model AI, dan model "menjawab" dengan mengarang.
 *
 * Solusi: deteksi pertanyaan keuangan/tugas/catatan di sini, jawab dari DATABASE.
 * Bila data kosong, katakan JUJUR bahwa belum ada catatan — jangan mengarang.
 */
export function deteksiPertanyaan(teks: string): 'keuangan' | 'tugas' | 'catatan' | null {
  const s = teks.toLowerCase().trim();
  if (s.length < 5 || s.length > 200) return null;

  // Pertanyaan keuangan: "berapa sisa uang", "total pengeluaran", "rekap", "saldo"
  if (
    /\b(berapa|brp|total|rekap|sisa|saldo|jumlah)\b/.test(s) &&
    /\b(uang|duit|pengeluaran|pemasukan|belanja|budget|keuangan|tabungan|cash|dompet)\b/.test(s)
  ) return 'keuangan';
  // "pengeluaranku berapa", "uangku sisa berapa", "duitku berapa"
  if (/\b(uang|duit|pengeluaran|pemasukan|belanja|keuangan|saldo|tabungan|budget)(ku|saya|gue|aku)?\b/.test(s) &&
      /\b(berapa|brp|total|rekap|sisa|saldo|jumlah)\b/.test(s)) return 'keuangan';
  if (/^\/?(rekap|saldo|keuangan|dompet|kas)\b/.test(s)) return 'keuangan';

  // Pertanyaan tugas: "tugas saya apa", "apa yang harus dikerjakan", "list tugas"
  if (
    /\b(apa|apa aja|apa saja|list|daftar|lihat|tampilkan|cek)\b/.test(s) &&
    /\b(tugas|todo|to-do|task|kerjaan|pekerjaan|pr)\b/.test(s)
  ) return 'tugas';
  if (/\b(tugas|todo)(ku|saya|gue|aku)\b/.test(s)) return 'tugas';

  // Pertanyaan catatan: "catatanku apa", "lihat catatan"
  if (
    /\b(apa|apa aja|apa saja|list|daftar|lihat|tampilkan|cek)\b/.test(s) &&
    /\b(catatan|note|notes|jurnal)\b/.test(s)
  ) return 'catatan';
  if (/\b(catatan|jurnal)(ku|saya|gue|aku)\b/.test(s)) return 'catatan';

  return null;
}

/** Jawab pertanyaan dari DATABASE (tanpa AI, tanpa halusinasi). */
export async function jawabPertanyaan(
  jenis: 'keuangan' | 'tugas' | 'catatan',
  chatId: string,
  hari: number = 30,
): Promise<string> {
  if (jenis === 'keuangan') {
    const r = await rekapUang(chatId, hari);
    if (r.masuk === 0 && r.keluar === 0 && r.perKategori.length === 0) {
      return `Belum ada catatan keuangan sama sekali.\n\nKalau mau mencatat, kirim misalnya:\n• /uang 50000 makan siang\n• /masuk 5000000 gaji\natau ketik biasa: "catat pengeluaran 25rb buat bensin".`;
    }
    return formatRekapUang(r, hari);
  }
  if (jenis === 'tugas') {
    const t = await daftarTugas(chatId, true);
    if (!t.length) {
      return 'Belum ada tugas yang tercatat. 🎉\n\nKalau mau menambah, kirim misalnya: /todo beli susu';
    }
    return `*Tugas kamu (${t.length}):*\n${formatDaftarTugas(t)}`;
  }
  const c = await daftarCatatan(chatId, 10);
  if (!c.length) {
    return 'Belum ada catatan tersimpan.\n\nKalau mau mencatat, kirim misalnya: /catat resep nasi goreng';
  }
  return `*Catatan terakhir (${c.length}):*\n${formatDaftarCatatan(c)}`;
}
