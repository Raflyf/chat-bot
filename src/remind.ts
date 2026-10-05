import type TelegramBot from 'node-telegram-bot-api';
import { autoReply } from './skills.js';
import { db } from './db.js';
import { config } from './env.js';
import { kemiripanPesan, AMBANG_MIRIP, TOLERANSI_WAKTU_MENIT } from './reminder-dedup.js';
import { berikutnya, type AturanUlang } from './reminder-repeat.js';
import { ambilProfilWaktu } from './user-profile.js';

export interface ReminderItem {
  id: number;
  chat_id: string;
  message: string;
  due_at: string;
  status: 'pending' | 'processing' | 'sent' | 'failed';
  platform?: 'telegram' | 'whatsapp';
  lease_until?: string | null;
  /** Kapan pengingat dibuat (dipakai agar AI tidak mengarang "kemarin"). */
  created_at?: string | null;
}

/** Simpan reminder ke Supabase untuk persistensi Vercel Serverless & Cron. */
/**
 * Waktu jatuh tempo dipakai APA ADANYA (tanpa pembulatan).
 *
 * CATATAN PERUBAHAN (04 Okt 2026):
 * Versi sebelumnya membulatkan due_at ke awal menit. Setelah disimulasikan
 * (20.000 sampel), cara itu KALAH dibanding strategi "due_at tepat + endpoint
 * menunggu sebentar":
 *   bulat + tunggu 20s : rata-rata 21,9s | median 21,7s
 *   tepat + tunggu 20s : rata-rata 15,0s | median  9,9s  <- LEBIH BAIK
 * Karena itu pembulatan dibatalkan; ketepatan ditangani oleh mekanisme
 * "tunggu sebentar" di checkDueReminders().
 */
function waktuJatuhTempo(dueAt: Date): Date {
  return dueAt;
}
export interface HasilSimpanReminder {
  /** Berhasil disimpan / diperbarui. */
  ok: boolean;
  /** 'baru' = ditambahkan, 'digabung' = pengingat lama diperbarui (anti-dobel). */
  aksi: 'baru' | 'digabung' | 'gagal';
  /** Pesan pengingat final yang tersimpan. */
  pesan: string;
  /** Untuk pesan balasan ke user (jujur soal apa yang terjadi). */
  keterangan: string;
}

export async function saveReminderToDb(
  chatId: string,
  message: string,
  dueAt: Date,
  platform: 'telegram' | 'whatsapp' = 'telegram',
): Promise<boolean> {
  const hasil = await simpanReminderCerdas(chatId, message, dueAt, platform);
  return hasil.ok;
}

/**
 * Simpan pengingat dengan DETEKSI DUPLIKAT.
 *
 * MASALAH (temuan pemilik produk 05 Okt 2026):
 *   "misal ingatkan besok jam 9 ada rapat, lalu beberapa jam kemudian user
 *    mengingatkan lagi 'jangan lupa besok jam 9 ada rapat', itu gimana?
 *    apakah akan double atau di replace?"
 * -> SEBELUMNYA: DOUBLE. User minta hal sama 3x -> dapat 3 pengingat.
 *
 * SEKARANG: bila waktu sama (selisih <= 5 menit) DAN isi mirip, pengingat lama
 * DIPERBARUI (tidak dobel). Bila isi berbeda (mis. "antar anak"), tetap dibuat
 * pengingat TERPISAH karena memang dua hal berbeda.
 *
 * Laporan jujur ke user: "sudah ada, saya perbarui" vs "ditambahkan".
 */
export async function simpanReminderCerdas(
  chatId: string,
  message: string,
  dueAt: Date,
  platform: 'telegram' | 'whatsapp' = 'telegram',
  ulang?: { repeat_kind: string; repeat_value: string | null },
): Promise<HasilSimpanReminder> {
  const c = db();
  if (!c) return { ok: false, aksi: 'gagal', pesan: message, keterangan: 'Database tidak tersedia.' };
  const dueIso = waktuJatuhTempo(dueAt).toISOString();

  try {
    // 1. Cari pengingat PENDING yang waktunya dekat (<= TOLERANSI menit).
    const batas = new Date(new Date(dueIso).getTime() + TOLERANSI_WAKTU_MENIT * 60_000).toISOString();
    const batasBawah = new Date(new Date(dueIso).getTime() - TOLERANSI_WAKTU_MENIT * 60_000).toISOString();
    const { data: dekat } = await c.from('reminders')
      .select('id, message, due_at')
      .eq('chat_id', chatId)
      .eq('status', 'pending')
      .gte('due_at', batasBawah)
      .lte('due_at', batas)
      .limit(10);

    // 2. Cari yang isinya paling mirip.
    let palingMirip: { id: number; message: string } | null = null;
    let skorTerbaik = 0;
    for (const r of (dekat ?? []) as Array<{ id: number; message: string }>) {
      const skor = kemiripanPesan(message, r.message);
      if (skor > skorTerbaik) { skorTerbaik = skor; palingMirip = r; }
    }

    // 3. Sangat mirip / mirip -> PERBARUI (anti-dobel).
    if (palingMirip && skorTerbaik >= AMBANG_MIRIP) {
      // Pilih pesan yang lebih INFORMATIF (lebih panjang) agar tidak kehilangan detail.
      const pesanFinal = message.length >= palingMirip.message.length ? message : palingMirip.message;
      const { error } = await c.from('reminders')
        .update({ message: pesanFinal, due_at: dueIso })
        .eq('id', palingMirip.id);
      if (!error) {
        return {
          ok: true,
          aksi: 'digabung',
          pesan: pesanFinal,
          keterangan: `Pengingat ini sudah ada (${palingMirip.message}) — sudah saya perbarui, tidak dobel.`,
        };
      }
      // Gagal update -> jatuh ke insert biasa di bawah
    }

    // 3b. Cek BENTROK dengan pengingat lain pada waktu yang sama/berdekatan.
    //     Bukan duplikat (isinya beda), tapi waktunya bertabrakan -> beri tahu user
    //     supaya dia sadar ada dua agenda berdekatan. Tetap DISIMPAN (bukan ditolak),
    //     karena user mungkin memang ingin dua pengingat.
    let peringatanBentrok = '';
    const daftarDekat = (dekat ?? []) as Array<{ id: number; message: string; due_at?: string }>;
    if (daftarDekat.length > 0) {
      const namaDekat = daftarDekat.map((r) => {
        const jam = r.due_at
          ? new Date(r.due_at).toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' })
          : '?';
        return `"${r.message}" (${jam})`;
      });
      peringatanBentrok = `\n\n⚠️ _Catatan: waktunya berdekatan dengan pengingat lain — ${namaDekat.join(', ')}. Pastikan tidak bentrok ya._`;
    }

    // 4. Baru / berbeda -> simpan sebagai pengingat baru.
    //    Kolom berulang (v27) disertakan HANYA bila ada, supaya tetap bekerja
    //    walau migrasi v27 belum dijalankan (fallback: insert tanpa kolom itu).
    const barisDasar: Record<string, unknown> = {
      chat_id: chatId, message, due_at: dueIso, status: 'pending', platform,
    };
    const barisUlang = ulang && ulang.repeat_kind && ulang.repeat_kind !== 'none'
      ? { ...barisDasar, repeat_kind: ulang.repeat_kind, repeat_value: ulang.repeat_value }
      : barisDasar;

    let { error } = await c.from('reminders').insert(barisUlang);
    // Fallback: kolom v27 belum ada (kode PGRST204 / 42703) -> insert tanpa kolom itu.
    const kolomTidakAda = (e: unknown): boolean => {
      const kode = (e as { code?: string })?.code || '';
      const pesan = String((e as { message?: string })?.message || '');
      return kode === 'PGRST204' || kode === '42703' || /repeat_kind|column/i.test(pesan);
    };
    if (error && barisUlang !== barisDasar && kolomTidakAda(error)) {
      const retry = await c.from('reminders').insert(barisDasar);
      error = retry.error;
    }
    if (error) return { ok: false, aksi: 'gagal', pesan: message, keterangan: 'Gagal menyimpan pengingat.' };
    return {
      ok: true,
      aksi: 'baru',
      pesan: message,
      keterangan: palingMirip
        ? `Pengingat ditambahkan (beda dengan "${palingMirip.message}" yang sudah ada).${peringatanBentrok}`
        : peringatanBentrok.trim(),
    };
  } catch {
    // Fallback: insert langsung (perilaku lama) agar tetap tersimpan.
    try {
      const { error } = await c.from('reminders').insert({
        chat_id: chatId, message, due_at: dueIso, status: 'pending', platform,
      });
      return error
        ? { ok: false, aksi: 'gagal', pesan: message, keterangan: 'Gagal menyimpan pengingat.' }
        : { ok: true, aksi: 'baru', pesan: message, keterangan: '' };
    } catch {
      return { ok: false, aksi: 'gagal', pesan: message, keterangan: 'Gagal menyimpan pengingat.' };
    }
  }
}

/**
 * Teks pengingat CADANGAN (tanpa AI) — dipakai HANYA bila AI gagal/timeout.
 *
 * MASALAH YANG DIPERBAIKI (04 Okt 2026, protes pemilik produk):
 * Versi sebelumnya mengirim `item.message` APA ADANYA saat AI gagal, sehingga
 * user menerima pesan aneh seperti cuma "login" atau "buat masak nasi" —
 * tanpa penanda bahwa itu pengingat. User: "jangan gitu dong, jadi aneh kalo
 * gitu responnya".
 *
 * Sekarang cadangan ini menyusun kalimat yang tetap WAJAR dibaca, dengan
 * penyesuaian sederhana pada isi pesan (bukan template kaku satu bentuk):
 *   "login"           -> "⏰ Pengingat: Login"
 *   "buat masak nasi" -> "⏰ Pengingat: Buat masak nasi"
 *   "waktunya login"  -> "⏰ Waktunya login"        (tidak diulang "waktunya")
 *   "jangan lupa obat"-> "⏰ Jangan lupa obat"       (tidak diulang "jangan lupa")
 */
function teksPengingatCadangan(pesan: string): string {
  const p = String(pesan || '').trim().replace(/\s+/g, ' ');
  if (!p) return '⏰ Pengingat!';
  const kapital = p.charAt(0).toUpperCase() + p.slice(1);
  // Bila isi pesan sudah mengandung kata pengingat/waktu, jangan diulang.
  if (/^(pengingat|waktu|ingat|jangan lupa|jgn lupa)\b/i.test(p)) {
    return `⏰ ${kapital}`;
  }
  return `⏰ Pengingat: ${kapital}`;
}

/**
 * Susun teks pengingat dengan gaya bot (AI), dengan BATAS WAKTU.
 * Bila AI tidak menjawab dalam `batasMs`, kembalikan teks cadangan yang tetap wajar.
 */
async function susunTeksPengingat(
  item: { message: string; due_at: string; created_at?: string | null },
  batasMs = 12_000,
): Promise<string> {
  const dibuatPada = item.created_at ? new Date(item.created_at) : new Date(item.due_at);
  const createdAtStr = dibuatPada.toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta', dateStyle: 'full', timeStyle: 'short',
  });
  try {
    const gen = await Promise.race([
      autoReply(
        `TUGAS: Kamu sedang MENGIRIM PENGINGAT yang sudah dijadwalkan user sebelumnya. ` +
        `Isi pengingat user: "${item.message}".\n\n` +
        `ATURAN KERAS:\n` +
        `- Awali dengan kata/penanda pengingat (mis. "Pengingat!" / "⏰ Pengingat:" / "Woy, waktunya..." ).\n` +
        `- Sebut KEMBALI isi pengingatnya secara jelas supaya user tahu apa yang diingatkan.\n` +
        `- DILARANG menasihati, menyuruh, mengucapkan selamat, atau menambah kalimat motivasi ` +
        `(contoh SALAH: "Istirahat yang nyenyak ya", "Jangan begadang terus", "Semangat ya!").\n` +
        `- DILARANG bertanya balik atau menambah obrolan baru.\n` +
        // BUG YANG DIPERBAIKI (04 Okt 2026): bot pernah menulis
        // "waktunya login sesuai jadwalmu KEMARIN" — padahal pengingat dibuat
        // BARU SAJA. AI MENGARANG keterangan waktu karena tidak diberi tahu
        // kapan pengingat ini dibuat.
        `- Waktu SEKARANG: ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'full', timeStyle: 'short' })} WIB.\n` +
        `- Pengingat ini dibuat user pada: ${createdAtStr} WIB.\n` +
        `- DILARANG menyebut "kemarin", "besok", "minggu lalu", atau keterangan waktu lain ` +
        `yang TIDAK disebutkan di atas. Kalau ragu soal waktu, JANGAN sebut waktu sama sekali.\n` +
        `- Boleh 1 kalimat pendek saja. Gaya boleh santai/hangat, tapi TETAP sebuah pengingat.\n\n` +
        `Contoh BENAR (bentuknya seperti ini, kalimatnya bebas kamu susun sendiri):\n` +
        `- "Pengingat! Waktunya tidur 🌙"\n` +
        `- "⏰ Woy, waktunya login game nih!"\n` +
        `- "Pengingat: jangan lupa minum obat ya 💊"\n\n` +
        `Sekarang tulis pengingatnya:`,
      ),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('batas-waktu')), batasMs)),
    ]);
    const teks = String(gen.reply || '').trim();
    if (teks) return teks;
  } catch {
    // jatuh ke cadangan di bawah
  }
  // CADANGAN: tetap wajar dibaca (bukan teks mentah user).
  return teksPengingatCadangan(item.message);
}

/**
 * Cek dan kirim semua reminder yang jatuh tempo dengan atomic claim (CAS).
 * Mencegah duplikasi pesan saat cron dan worker berjalan beriringan.
 */

/** Zona waktu untuk sebuah chat (dari profil user, fallback WIB). */
async function zonaWaktuChat(chatId: string): Promise<string> {
  try {
    const p = await ambilProfilWaktu(chatId);
    return p?.timezone || 'Asia/Jakarta';
  } catch {
    return 'Asia/Jakarta';
  }
}

export async function checkDueReminders(
  sendFn: (chatId: string, text: string, platform?: 'telegram' | 'whatsapp') => Promise<unknown>,
): Promise<number> {
  const c = db();
  if (!c) return 0;
  try {
    // ── TUNGGU SEBENTAR BILA ADA PENGINGAT YANG HAMPIR JATUH TEMPO ──
    //
    // MASALAH (keluhan: "tidak bisa diperkecil lagi jadi 5 atau 10 detik?"):
    // cron-job.org memanggil tiap 60 detik dengan jitter 4-40 detik. Bila
    // panggilan datang sedikit SEBELUM due_at, pengingat harus menunggu
    // panggilan berikutnya (~60 detik lagi) -> terasa ngaret.
    //
    // SOLUSI: bila ada pengingat yang jatuh tempo dalam <= TUNGGU_MAKS detik,
    // endpoint MENUNGGU sebentar (sleep) lalu mengirimnya di panggilan yang SAMA.
    // Hasil simulasi (20.000 sampel):
    //   tanpa tunggu : rata-rata 31,9s | median 30,1s | <=10s hanya 17%
    //   tunggu 25s   : rata-rata 12,0s | median  5,1s | <=10s jadi 58%
    //
    // BATAS AMAN: cron-job.org timeout 30 detik dan Vercel maxDuration 30 detik
    // untuk endpoint cron. Karena itu tunggu maksimum dibatasi 20 detik (sisakan
    // 10 detik untuk proses kirim + respons).
    //
    // PENTING — MENUNGGU HANYA BILA TIDAK ADA YANG SUDAH JATUH TEMPO.
    // BUG YANG DIPERBAIKI (04 Okt 2026, temuan pemilik produk: "kalo gitu yg lama
    // jadi nunggu nya dong?"): versi pertama menunggu TANPA memeriksa apakah ada
    // pengingat yang SUDAH telat. Akibatnya, bila ada pengingat telat 5 menit DAN
    // satu lagi jatuh tempo 15 detik lagi, pengingat yang sudah telat itu IKUT
    // TERTUNDA 15 detik — padahal seharusnya langsung dikirim.
    // Sekarang: kalau ada yang sudah jatuh tempo, kirim SEGERA (jangan menunggu).
    const TUNGGU_MAKS_MS = 20_000;
    try {
      // 1) Ada yang SUDAH jatuh tempo? -> jangan menunggu, kirim sekarang.
      const { data: sudahTelat } = await c
        .from('reminders')
        .select('id')
        .eq('status', 'pending')
        .lte('due_at', new Date().toISOString())
        .limit(1);
      const adaYangTelat = ((sudahTelat ?? []) as unknown[]).length > 0;

      if (!adaYangTelat) {
        // 2) Tidak ada yang telat -> boleh menunggu yang HAMPIR jatuh tempo.
        const batasCek = new Date(Date.now() + TUNGGU_MAKS_MS + 2000).toISOString();
        const { data: hampir } = await c
          .from('reminders')
          .select('due_at')
          .eq('status', 'pending')
          .gt('due_at', new Date().toISOString())   // belum jatuh tempo
          .lte('due_at', batasCek)                  // tapi sangat dekat
          .order('due_at', { ascending: true })
          .limit(1);
        const terdekat = (hampir ?? [])[0] as { due_at?: string } | undefined;
        if (terdekat?.due_at) {
          const selisih = new Date(terdekat.due_at).getTime() - Date.now();
          if (selisih > 0 && selisih <= TUNGGU_MAKS_MS) {
            console.log(`[remind] Menunggu ${Math.round(selisih / 1000)}s agar pengingat terkirim tepat waktu.`);
            await new Promise((r) => setTimeout(r, selisih + 200)); // +200ms margin
          }
        }
      }
    } catch {
      // best-effort: bila gagal, lanjut tanpa menunggu
    }

    const now = new Date().toISOString();

    // 1. Reaper: Kembalikan reminder 'processing' yang lease-nya kadaluwarsa ke 'pending'
    // Prioritas: cek kolom lease_until (B4)
    await c
      .from('reminders')
      .update({ status: 'pending', lease_until: null })
      .eq('status', 'processing')
      .lte('lease_until', now);

    // Fallback reaper hanya untuk DB pra-migrasi lease_until (lease_until IS NULL).
    // Ambang dinaikkan ke 30 menit (dari 10 menit): pengiriman yang masih in-flight
    // tidak boleh di-reap lalu diklaim ulang worker/cron lain -> cegah dobel kirim.
    // Tradeoff: baris yang benar-benar macet baru pulih setelah 30 menit, bukan 10.
    const staleThreshold = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    await c
      .from('reminders')
      .update({ status: 'pending', lease_until: null })
      .eq('status', 'processing')
      .is('lease_until', null)
      .lte('due_at', staleThreshold);

    // 2. Ambil pengingat yang jatuh tempo
    // Kolom berulang (v27) diambil bila ada. Bila migrasi v27 belum dijalankan,
    // query dengan kolom itu GAGAL -> fallback ke kolom dasar.
    const KOLOM_DASAR = 'id, chat_id, message, due_at, status, platform, lease_until, created_at';
    const KOLOM_LENGKAP = `${KOLOM_DASAR}, repeat_kind, repeat_value, repeat_until, repeat_count`;
    // Tipe dibuat longgar (Record) agar tidak bentrok saat kolom v27 belum ada.
    let data: Array<Record<string, unknown>> | null = null;
    let error: unknown = null;
    {
      const h1 = await c
        .from('reminders')
        .select(KOLOM_LENGKAP)
        .eq('status', 'pending')
        .lte('due_at', now)
        .order('due_at', { ascending: true })
        .limit(50);
      if (!h1.error) {
        data = (h1.data ?? []) as Array<Record<string, unknown>>;
      } else {
        const h2 = await c
          .from('reminders')
          .select(KOLOM_DASAR)
          .eq('status', 'pending')
          .lte('due_at', now)
          .order('due_at', { ascending: true })
          .limit(50);
        data = (h2.data ?? []) as Array<Record<string, unknown>>;
        error = h2.error;
      }
    }

    if (error || !data || data.length === 0) return 0;

    let processed = 0;
    for (const itemRaw of data) {
      const item = itemRaw as unknown as ReminderItem & { repeat_kind?: string; repeat_value?: string | null; repeat_until?: string | null; repeat_count?: number };
      // Atomic claim dengan lease_until 10 menit tanpa memodifikasi due_at asli (B4)
      const leaseExpiry = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      let claimSuccess = false;

      // Klaim atomik menggunakan kolom lease_until
      const { data: claimed, error: claimErr } = await c
        .from('reminders')
        .update({ status: 'processing', lease_until: leaseExpiry })
        .eq('id', item.id)
        .eq('status', 'pending')
        .select('id');

      if (!claimErr && claimed && claimed.length > 0) {
        claimSuccess = true;
      } else if (claimErr) {
        // Fallback jika database belum memiliki kolom lease_until
        const { data: directClaim, error: directErr } = await c
          .from('reminders')
          .update({ status: 'processing' })
          .eq('id', item.id)
          .eq('status', 'pending')
          .select('id');

        if (!directErr && directClaim && directClaim.length > 0) {
          claimSuccess = true;
        }
      }

      // Jika baris sudah diklaim worker/cron lain, lewati
      if (!claimSuccess) {
        continue;
      }

      try {
        // Teks pengingat disusun AI dengan gaya bot + BATAS WAKTU.
        //
        // Bila AI gagal/timeout, dipakai teks CADANGAN yang tetap wajar dibaca
        // (mis. "⏰ Pengingat: Login"), BUKAN teks mentah user — protes pemilik
        // produk: "jangan gitu dong, jadi aneh kalo gitu responnya".
        const deliveryText = await susunTeksPengingat({
          message: item.message,
          due_at: item.due_at,
          created_at: item.created_at,
        });
        await sendFn(item.chat_id, deliveryText, item.platform);

        // ── PENGINGAT BERULANG (fitur baru 05 Okt 2026) ──
        // Bila punya aturan pengulangan, JANGAN ditandai 'sent' (itu akan
        // menghentikannya). Sebaliknya, hitung kemunculan berikutnya lalu
        // perbarui due_at dan kembalikan status ke 'pending'.
        const it = item;
        const kindUlang = it.repeat_kind && it.repeat_kind !== 'none' ? it.repeat_kind : 'none';

        if (kindUlang !== 'none') {
          const aturan: AturanUlang = {
            repeat_kind: kindUlang as AturanUlang['repeat_kind'],
            repeat_value: it.repeat_value ?? null,
            repeat_until: it.repeat_until ?? null,
            repeat_count: it.repeat_count ?? 0,
          };
          const zona = await zonaWaktuChat(item.chat_id);
          let next = berikutnya(new Date(item.due_at), aturan, zona);
          // ── CATCH-UP (05 Okt 2026) ──
          // Bila cron sempat MATI berhari-hari, pengingat berulang tertinggal jauh.
          // Jangan kirim bertubi-tubi (mis. 5x "minum obat" sekaligus) — kirim
          // SEKALI, lalu LOMPATKAN jadwal ke kemunculan berikutnya setelah SEKARANG.
          // Batas 30 iterasi (~1 bulan untuk harian) agar tidak menggantung.
          let iterasi = 0;
          const sekarang = Date.now();
          while (next && next.getTime() <= sekarang && iterasi < 30) {
            next = berikutnya(next, aturan, zona);
            iterasi++;
          }
          if (next) {
            await c.from('reminders').update({
              due_at: next.toISOString(),
              status: 'pending',
              lease_until: null,
              repeat_count: (it.repeat_count ?? 0) + 1,
            }).eq('id', item.id);
          } else {
            // Lewat batas akhir -> hentikan.
            await c.from('reminders').update({ status: 'sent', lease_until: null }).eq('id', item.id);
          }
        } else {
          // Tandai selesai (sent) HANYA setelah pesan benar-benar sukses terkirim (C1)
          await c.from('reminders').update({ status: 'sent', lease_until: null }).eq('id', item.id);
        }
        processed++;
      } catch (err) {
        console.error(`[remind] gagal kirim reminder id ${item.id}:`, err);
        await c.from('reminders').update({ status: 'failed', lease_until: null }).eq('id', item.id);
      }
    }
    return processed;
  } catch (err) {
    console.error('[remind] error checkDueReminders:', err);
    return 0;
  }
}

/**
 * Reminder handler:
 * 1. Simpan ke database Supabase (tabel reminders) agar persisten di Vercel.
 * 2. Pasang in-memory timer HANYA jika database tidak tersedia saat running local.
 * 3. Balasan konfirmasi dinamis via AI.
 */
export async function handleRemind(
  bot: TelegramBot,
  chatId: number,
  args: string,
  platform: 'telegram' | 'whatsapp' = 'telegram',
  senderName?: string,
): Promise<void> {
  const m = args.trim().match(/^(\d+)\s+([\s\S]+)/);
  if (!m) {
    const { reply } = await autoReply(
      'User salah format perintah pengingat (tidak ada angka menit dan pesan). Jelaskan format yang benar: /remind <menit> <pesan>, dengan satu contoh singkat dan ramah.',
    );
    if (reply.trim()) await bot.sendMessage(chatId, reply);
    return;
  }

  const minutes = Number(m[1]);
  const rawMessage = m[2].trim().slice(0, 500);
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 43200 || !rawMessage) {
    const { reply } = await autoReply(
      `User salah format perintah pengingat (menit="${m[1]}"). Jelaskan syaratnya (angka 1-43200 + pesan) dengan satu contoh singkat dan ramah.`,
    );
    if (reply.trim()) await bot.sendMessage(chatId, reply);
    return;
  }

  const message = senderName ? `[Pengingat untuk ${senderName}]: ${rawMessage}` : rawMessage;
  const dueAt = new Date(Date.now() + minutes * 60_000);
  const dbSaved = await saveReminderToDb(String(chatId), message, dueAt, platform);

  // In-memory fallback HANYA jika DB tidak tersedia untuk mencegah pesan dobel
  if (!config.isServerless && !dbSaved) {
    setTimeout(() => {
      void (async () => {
        try {
          const gen = await autoReply(
            `Sampaikan pengingat ini ke user dengan gayamu sendiri, singkat dan hangat, tanpa pertanyaan tambahan: "${rawMessage}"`,
          );
          await bot.sendMessage(chatId, gen.reply.trim() || rawMessage);
        } catch {
          await bot.sendMessage(chatId, rawMessage).catch(() => undefined);
        }
      })();
    }, minutes * 60_000);
  }

  const promptConfirm = senderName
    ? `Konfirmasi singkat dan hangat: pengingat "${rawMessage}" untuk ${senderName} telah dicatat dan akan dikirim ${minutes} menit lagi di grup.`
    : `Konfirmasi singkat dan hangat: pengingat "${rawMessage}" telah dicatat dan akan dikirim ${minutes} menit lagi.`;

  const { reply } = await autoReply(promptConfirm);
  if (reply.trim()) await bot.sendMessage(chatId, reply);
}

let workerInterval: NodeJS.Timeout | null = null;

/**
 * Worker lokal untuk memproses reminder tiap 30 detik saat bot dijalankan di terminal.
 * WAJIB menghormati `platform` — chat_id WhatsApp (mis. '62812...') tidak boleh dikirim
 * ke Telegram (Number('62812...') menargetkan chat id Telegram yang salah — misdelivery).
 * sendWhatsApp opsional agar pemanggil WhatsApp-only tidak perlu impor Telegram.
 */
export function startReminderWorker(
  bot: TelegramBot,
  sendWhatsApp?: (chatId: string, text: string) => Promise<unknown>,
): void {
  if (config.isServerless || workerInterval) return;
  workerInterval = setInterval(() => {
    void checkDueReminders(async (chatId, text, platform) => {
      if (platform === 'whatsapp') {
        if (sendWhatsApp) {
          await sendWhatsApp(chatId, text);
        } else {
          console.warn(`[remind] Reminder WhatsApp dilewati (tanpa sender WA): ${chatId}`);
        }
        return;
      }
      // Telegram (atau platform belum tercatat): kirim via bot Telegram.
      await bot.sendMessage(Number(chatId), text);
    });
  }, 30_000);
}
