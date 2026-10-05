/**
 * MESIN GAME — logika utama semua permainan.
 *
 * Alur: `mulaiGame()` -> state awal -> tiap pesan user lewat `prosesGame()`
 * -> state baru + teks balasan. State disimpan di DB (tabel game_sessions).
 *
 * Semua permainan MURNI: fungsi menerima state, mengembalikan state baru.
 * Tidak ada efek samping, sehingga mudah diuji dan aman di serverless.
 */
import {
  Kartu, dekRemi, kocok, ambil, daftarKartuTeks, kartuTeks,
  KartuUno, dekUno, kartuUnoTeks, daftarUnoTeks, unoBoleh,
  Papan, papanAwal, papanTeks, posKe, halmaAwal,
  TicTac, ticTacAwal, ticTacPemenang, ticTacTeks, ticTacBot,
  KATA_HANGMAN, hangmanTeks, cariGame, mintaBerhenti, NILAI_ANGKA,
} from './cards.js';

export interface HasilGame {
  /** Teks balasan untuk user. */
  balas: string;
  /** State baru (null = permainan berakhir). */
  state: Record<string, unknown> | null;
  /** true bila permainan selesai. */
  selesai: boolean;
  /** true bila user menang (untuk statistik). */
  menang?: boolean;
}

// ============================================================================
// UTIL
// ============================================================================

/** Pilih acak satu elemen. */
function pilih<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Angka acak 1..n (inklusif). */
function acak(n: number): number {
  return Math.floor(Math.random() * n) + 1;
}

// ============================================================================
// 1. UNO — permainan kartu dengan aturan nyata
// ============================================================================

export function unoMulai(): Record<string, unknown> {
  const dek: KartuUno[] = kocok(dekUno());
  const tanganBot = ambil(dek, 7);
  const tanganUser = ambil(dek, 7);
  // Kartu atas: bukan wild+4 agar adil di awal
  let atas = dek.shift()!;
  while (atas.warna === 'hitam') { dek.push(atas); atas = dek.shift()!; }
  return {
    dek, tanganBot, tanganUser, atas,
    warnaAktif: atas.warna, giliran: 'user', arah: 1, pesanAkhir: '',
  };
}

export function unoLangkah(state: Record<string, unknown>, aksi: string): HasilGame {
  const s = state as {
    dek: KartuUno[]; tanganBot: KartuUno[]; tanganUser: KartuUno[];
    atas: KartuUno; warnaAktif: string; giliran: string; arah: number;
  };
  const teks = aksi.trim().toLowerCase();

  // "tarik" — ambil kartu
  if (/^(tarik|ambil|draw|ga ada|gak ada|nggak ada)$/i.test(teks)) {
    if (s.dek.length === 0) return { balas: 'Dek habis! Permainan berakhir seri. 🤝', state: null, selesai: true };
    const k = s.dek.shift()!;
    s.tanganUser.push(k);
    // Boleh langsung pakai bila cocok
    if (unoBoleh(k, s.atas, s.warnaAktif)) {
      return {
        balas: `Kamu tarik ${kartuUnoTeks(k)} — kebetulan cocok! Turunkan atau ketik *lewat*.\n\n${unoTampilan(s)}`,
        state: s, selesai: false,
      };
    }
    s.giliran = 'bot';
    const hasilBot = unoJalanBot(s);
    return hasilBot;
  }

  // "lewat" / "pass"
  if (/^(lewat|pass|skip)$/i.test(teks)) {
    s.giliran = 'bot';
    return unoJalanBot(s);
  }

  // Cari kartu yang cocok dari input (mis. "kuning 5", "5", "merah skip", "wild")
  const kartu = unoCariKartu(s.tanganUser, teks);
  if (!kartu) {
    return {
      balas: `Nggak ada kartu itu di tanganmu. Kartumu: ${daftarUnoTeks(s.tanganUser)}\n\nKetik warna+angka (mis. "merah 5"), atau *tarik*.`,
      state: s, selesai: false,
    };
  }
  if (!unoBoleh(kartu, s.atas, s.warnaAktif)) {
    return {
      balas: `❌ ${kartuUnoTeks(kartu)} nggak cocok dengan ${kartuUnoTeks(s.atas)} (warna aktif: ${s.warnaAktif}). Pilih lain atau *tarik*.`,
      state: s, selesai: false,
    };
  }

  // Buang kartu
  s.tanganUser = s.tanganUser.filter((k) => k !== kartu);
  s.atas = kartu;
  s.warnaAktif = kartu.warna === 'hitam' ? 'merah' : kartu.warna; // wild: default merah (disederhanakan)

  if (s.tanganUser.length === 0) {
    return { balas: `🎉 *KAMU MENANG!* Kartu terakhirmu ${kartuUnoTeks(kartu)}. Keren banget!\n\nMau main lagi? Ketik *main uno*.`, state: null, selesai: true, menang: true };
  }

  // Efek kartu khusus
  if (kartu.nilai === 'skip') {
    return { balas: `${kartuUnoTeks(kartu)} — bot kelewat giliran! 😄\n\n${unoTampilan(s)}`, state: s, selesai: false };
  }
  if (kartu.nilai === '+2') {
    const extra = ambil(s.dek, 2);
    s.tanganBot.push(...extra);
    return { balas: `${kartuUnoTeks(kartu)} — bot ambil 2 kartu! 😎\n\n${unoTampilan(s)}`, state: s, selesai: false };
  }
  if (kartu.nilai === 'reverse') s.arah *= -1;

  s.giliran = 'bot';
  return unoJalanBot(s);
}

function unoCariKartu(tangan: KartuUno[], teks: string): KartuUno | null {
  const t = teks.toLowerCase().replace(/[^a-z0-9+ ]/g, '');
  if (/\bwild\s*\+?\s*4|plus\s*4|\+4\b/.test(t)) return tangan.find((k) => k.nilai === 'wild+4') ?? null;
  if (/\bwild\b/.test(t)) return tangan.find((k) => k.nilai === 'wild') ?? null;
  const warna = ['merah', 'kuning', 'hijau', 'biru'].find((w) => t.includes(w));
  const nilai = t.match(/\b(10|[0-9])\b/)?.[1];
  const aksi = ['skip', 'reverse'].find((a) => t.includes(a)) ?? (t.includes('+2') ? '+2' : null);
  return tangan.find((k) => {
    if (warna && k.warna !== warna) return false;
    if (nilai && k.nilai !== nilai) return false;
    if (aksi && k.nilai !== aksi) return false;
    return Boolean(warna || nilai || aksi);
  }) ?? null;
}

function unoJalanBot(s: {
  dek: KartuUno[]; tanganBot: KartuUno[]; tanganUser: KartuUno[];
  atas: KartuUno; warnaAktif: string; giliran: string; arah: number;
}): HasilGame {
  // Strategi bot: utamakan kartu berwarna sama / angka sama; simpan wild untuk akhir.
  const cocok = s.tanganBot.filter((k) => unoBoleh(k, s.atas, s.warnaAktif));
  const nonWild = cocok.filter((k) => k.warna !== 'hitam');
  let main: KartuUno | null = null;
  if (nonWild.length > 0) {
    // Pilih yang paling banyak dimiliki (buang yang menguntungkan)
    const hitung = new Map<string, number>();
    for (const k of s.tanganBot) hitung.set(k.warna, (hitung.get(k.warna) ?? 0) + 1);
    nonWild.sort((a, b) => (hitung.get(b.warna) ?? 0) - (hitung.get(a.warna) ?? 0));
    main = nonWild[0];
  } else if (cocok.length > 0 && s.tanganBot.length <= 3) {
    main = cocok[0]; // baru pakai wild saat hampir menang
  }

  if (!main) {
    if (s.dek.length === 0) {
      return { balas: `Bot nggak punya kartu cocok dan dek habis. Seri! 🤝\n\n${unoTampilan(s)}`, state: null, selesai: true };
    }
    const k = s.dek.shift()!;
    s.tanganBot.push(k);
    s.giliran = 'user';
    return { balas: `Bot tarik kartu. Giliranmu! 🎴\n\n${unoTampilan(s)}`, state: s, selesai: false };
  }

  s.tanganBot = s.tanganBot.filter((x) => x !== main);
  s.atas = main!;
  s.warnaAktif = main!.warna === 'hitam' ? 'merah' : main!.warna;

  if (s.tanganBot.length === 0) {
    return { balas: `😤 *Bot menang!* Kartu terakhirnya ${kartuUnoTeks(main!)}.\n\nCoba lagi? Ketik *main uno*.`, state: null, selesai: true, menang: false };
  }

  let info = '';
  if (main!.nilai === 'skip') {
    info = ' — kamu kelewat giliran!';
  } else if (main!.nilai === '+2') {
    const extra = ambil(s.dek, 2);
    s.tanganUser.push(...extra);
    info = ' — kamu ambil 2 kartu! 😈';
  } else if (main!.nilai === 'reverse') {
    s.arah *= -1;
  } else if (main!.nilai === 'wild+4') {
    const extra = ambil(s.dek, 4);
    s.tanganUser.push(...extra);
    info = ' — kamu ambil 4 kartu! 😱';
  } else if (main!.nilai === 'wild') {
    info = ' (ganti warna)';
  }

  // Bila bot main skip/+2, giliran tetap user
  const userJalan = ['skip', '+2', 'wild+4'].includes(main!.nilai);
  s.giliran = userJalan ? 'user' : 'user'; // UNO 2 pemain: selalu kembali ke user
  return {
    balas: `Bot menurunkan ${kartuUnoTeks(main!)}${info}\n\n${unoTampilan(s)}`,
    state: s, selesai: false,
  };
}

function unoTampilan(s: { atas: KartuUno; warnaAktif: string; tanganUser: KartuUno[]; tanganBot: KartuUno[]; dek: KartuUno[] }): string {
  return [
    `🎴 Kartu atas: *${kartuUnoTeks(s.atas)}* (warna aktif: ${s.warnaAktif})`,
    `🖐️ Kartumu (${s.tanganUser.length}): ${daftarUnoTeks(s.tanganUser)}`,
    `🤖 Bot: ${s.tanganBot.length} kartu | Dek sisa: ${s.dek.length}`,
    `\nKetik warna+angka (mis. "merah 5"), atau *tarik* / *lewat*.`,
  ].join('\n');
}

// ============================================================================
// 2. CAPSA BANTING — 13 kartu, adu kombinasi
// ============================================================================

export function capsaMulai(): Record<string, unknown> {
  const dek: Kartu[] = kocok(dekRemi());
  const tanganUser = ambil(dek, 13);
  const tanganBot = ambil(dek, 13);
  return { tanganUser, tanganBot, ronde: 0 };
}

/** Nilai kekuatan satu kartu (A tertinggi). */
function kekuatanKartu(k: Kartu): number {
  return NILAI_ANGKA[k.nilai];
}

/** Cari kombinasi terbaik dari tangan: [jenis, nilai, kartu[]]. */
export function capsaKombinasiTerbaik(tangan: Kartu[]): { nama: string; skor: number; kartu: Kartu[] } {
  const hitungNilai = new Map<string, Kartu[]>();
  const hitungJenis = new Map<string, Kartu[]>();
  for (const k of tangan) {
    if (!hitungNilai.has(k.nilai)) hitungNilai.set(k.nilai, []);
    hitungNilai.get(k.nilai)!.push(k);
    if (!hitungJenis.has(k.jenis)) hitungJenis.set(k.jenis, []);
    hitungJenis.get(k.jenis)!.push(k);
  }

  let terbaik = { nama: 'kartu tertinggi', skor: 0, kartu: [tangan.slice().sort((a, b) => kekuatanKartu(b) - kekuatanKartu(a))[0]] };

  // Four of a kind (4 nilai sama)
  for (const [nilai, ks] of hitungNilai) {
    if (ks.length === 4) {
      const skor = 4000 + NILAI_ANGKA[nilai as keyof typeof NILAI_ANGKA];
      if (skor > terbaik.skor) terbaik = { nama: `four of a kind ${nilai}`, skor, kartu: ks };
    }
  }
  // Straight flush (5 berurutan satu jenis)
  for (const [jenis, ks] of hitungJenis) {
    const urut = ks.slice().sort((a, b) => kekuatanKartu(a) - kekuatanKartu(b));
    for (let i = 0; i + 4 < urut.length; i++) {
      const run = urut.slice(i, i + 5);
      const berurutan = run.every((k, idx) => idx === 0 || kekuatanKartu(k) === kekuatanKartu(run[idx - 1]) + 1);
      if (berurutan) {
        const skor = 3000 + kekuatanKartu(run[4]);
        if (skor > terbaik.skor) terbaik = { nama: `straight flush ${jenis}`, skor, kartu: run };
      }
    }
  }
  // Full house (3 + 2)
  const tiga = [...hitungNilai.entries()].filter(([, ks]) => ks.length >= 3).sort((a, b) => NILAI_ANGKA[b[0] as keyof typeof NILAI_ANGKA] - NILAI_ANGKA[a[0] as keyof typeof NILAI_ANGKA]);
  const dua = [...hitungNilai.entries()].filter(([, ks]) => ks.length >= 2).sort((a, b) => NILAI_ANGKA[b[0] as keyof typeof NILAI_ANGKA] - NILAI_ANGKA[a[0] as keyof typeof NILAI_ANGKA]);
  if (tiga.length > 0) {
    const pasangan = dua.find(([n]) => n !== tiga[0][0]);
    if (pasangan) {
      const skor = 2000 + NILAI_ANGKA[tiga[0][0] as keyof typeof NILAI_ANGKA];
      if (skor > terbaik.skor) terbaik = { nama: `full house ${tiga[0][0]}+${pasangan[0]}`, skor, kartu: [...tiga[0][1], ...pasangan[1].slice(0, 2)] };
    }
  }
  // Flush (5 satu jenis)
  for (const [jenis, ks] of hitungJenis) {
    if (ks.length >= 5) {
      const top5 = ks.slice().sort((a, b) => kekuatanKartu(b) - kekuatanKartu(a)).slice(0, 5);
      const skor = 1500 + kekuatanKartu(top5[0]);
      if (skor > terbaik.skor) terbaik = { nama: `flush ${jenis}`, skor, kartu: top5 };
    }
  }
  // Straight (5 berurutan beda jenis)
  const unikNilai = [...new Set(tangan.map((k) => k.nilai))].sort((a, b) => NILAI_ANGKA[a] - NILAI_ANGKA[b]);
  for (let i = 0; i + 4 < unikNilai.length; i++) {
    const run = unikNilai.slice(i, i + 5);
    if (run.every((n, idx) => idx === 0 || NILAI_ANGKA[n] === NILAI_ANGKA[run[idx - 1]] + 1)) {
      const kartuRun = run.map((n) => tangan.find((k) => k.nilai === n)!);
      const skor = 1000 + NILAI_ANGKA[run[4]];
      if (skor > terbaik.skor) terbaik = { nama: `straight ${run[0]}-${run[4]}`, skor, kartu: kartuRun };
    }
  }
  // Three of a kind
  if (tiga.length > 0) {
    const skor = 700 + NILAI_ANGKA[tiga[0][0] as keyof typeof NILAI_ANGKA];
    if (skor > terbaik.skor) terbaik = { nama: `three of a kind ${tiga[0][0]}`, skor, kartu: tiga[0][1].slice(0, 3) };
  }
  // Pair
  if (dua.length > 0) {
    const skor = 300 + NILAI_ANGKA[dua[0][0] as keyof typeof NILAI_ANGKA];
    if (skor > terbaik.skor) terbaik = { nama: `pair ${dua[0][0]}`, skor, kartu: dua[0][1].slice(0, 2) };
  }
  // High card
  const tertinggi = tangan.slice().sort((a, b) => kekuatanKartu(b) - kekuatanKartu(a))[0];
  const skorTinggi = kekuatanKartu(tertinggi);
  if (skorTinggi > terbaik.skor) terbaik = { nama: `kartu tertinggi ${tertinggi.nilai}`, skor: skorTinggi, kartu: [tertinggi] };

  return terbaik;
}

export function capsaLangkah(state: Record<string, unknown>, aksi: string): HasilGame {
  const s = state as { tanganUser: Kartu[]; tanganBot: Kartu[]; ronde: number };
  const teks = aksi.trim().toLowerCase();

  // "banting" = adu kombinasi
  if (/banting|adu|main|taruh|keluar/.test(teks) || teks === '') {
    const ku = capsaKombinasiTerbaik(s.tanganUser);
    const kb = capsaKombinasiTerbaik(s.tanganBot);
    s.ronde += 1;
    const menang = ku.skor >= kb.skor;

    const balas = [
      `🎴 *RONDE ${s.ronde}*`,
      ``,
      `*Kamu* — ${ku.nama}`,
      `   ${daftarKartuTeks(ku.kartu)}`,
      `*Bot* — ${kb.nama}`,
      `   ${daftarKartuTeks(kb.kartu)}`,
      ``,
      menang ? `🏆 *Kamu menang ronde ini!*` : `😤 *Bot menang ronde ini!*`,
      ``,
      `Tanganmu: ${daftarKartuTeks(s.tanganUser)}`,
      ``,
      `Ketik *banting* untuk adu lagi, atau *berhenti* untuk keluar.`,
    ].join('\n');
    return { balas, state: s, selesai: false, menang };
  }

  return { balas: `Ketik *banting* untuk adu kombinasi, atau *berhenti* untuk keluar.`, state: s, selesai: false };
}

// ============================================================================
// 3. REMI (Rummy) — bentuk set/run dari 7 kartu
// ============================================================================

export function remiMulai(): Record<string, unknown> {
  const dek: Kartu[] = kocok(dekRemi());
  return { tanganUser: ambil(dek, 7), tanganBot: ambil(dek, 7), dek, ronde: 0 };
}

/** Cari run (3+ berurutan sejenis) dan set (3+ nilai sama). */
function remiKombinasi(tangan: Kartu[]): { nama: string; kartu: Kartu[] }[] {
  const hasil: { nama: string; kartu: Kartu[] }[] = [];
  // Set (nilai sama)
  const byNilai = new Map<string, Kartu[]>();
  for (const k of tangan) {
    if (!byNilai.has(k.nilai)) byNilai.set(k.nilai, []);
    byNilai.get(k.nilai)!.push(k);
  }
  for (const [n, ks] of byNilai) if (ks.length >= 3) hasil.push({ nama: `set ${n}`, kartu: ks });
  // Run (berurutan sejenis)
  const byJenis = new Map<string, Kartu[]>();
  for (const k of tangan) {
    if (!byJenis.has(k.jenis)) byJenis.set(k.jenis, []);
    byJenis.get(k.jenis)!.push(k);
  }
  for (const [j, ks] of byJenis) {
    const urut = ks.slice().sort((a, b) => NILAI_ANGKA[a.nilai] - NILAI_ANGKA[b.nilai]);
    let run: Kartu[] = [];
    for (const k of urut) {
      if (run.length === 0 || NILAI_ANGKA[k.nilai] === NILAI_ANGKA[run[run.length - 1].nilai] + 1) {
        run.push(k);
      } else {
        if (run.length >= 3) hasil.push({ nama: `run ${j} ${run[0].nilai}-${run[run.length - 1].nilai}`, kartu: [...run] });
        run = [k];
      }
    }
    if (run.length >= 3) hasil.push({ nama: `run ${j} ${run[0].nilai}-${run[run.length - 1].nilai}`, kartu: [...run] });
  }
  return hasil;
}

export function remiLangkah(state: Record<string, unknown>, aksi: string): HasilGame {
  const s = state as { tanganUser: Kartu[]; tanganBot: Kartu[]; dek: Kartu[]; ronde: number };
  const teks = aksi.trim().toLowerCase();

  if (/^(tarik|ambil|draw)$/i.test(teks)) {
    if (s.dek.length === 0) return { balas: 'Dek habis! Permainan selesai.', state: null, selesai: true };
    const k = s.dek.shift()!;
    s.tanganUser.push(k);
    return {
      balas: `Kamu tarik ${kartuTeks(k)}.\n\nTanganmu: ${daftarKartuTeks(s.tanganUser)}\n\nKetik *susun* untuk lihat kombinasi, atau *buang <kartu>* (mis. "buang ♠7").`,
      state: s, selesai: false,
    };
  }

  if (/susun|lihat|kombinasi/.test(teks)) {
    const komb = remiKombinasi(s.tanganUser);
    if (komb.length === 0) {
      return { balas: `Belum ada kombinasi (butuh 3+ berurutan sejenis, atau 3+ nilai sama).\n\nTanganmu: ${daftarKartuTeks(s.tanganUser)}\n\nKetik *tarik* untuk ambil kartu.`, state: s, selesai: false };
    }
    const balas = `🧩 Kombinasi di tanganmu:\n${komb.map((x) => `• ${x.nama}: ${daftarKartuTeks(x.kartu)}`).join('\n')}\n\nKetik *selesai* bila sudah puas, atau *tarik* untuk cari lagi.`;
    return { balas, state: s, selesai: false };
  }

  if (/selesai|jadi|tutup/.test(teks)) {
    const ku = remiKombinasi(s.tanganUser);
    const kb = remiKombinasi(s.tanganBot);
    const skorU = ku.reduce((a, x) => a + x.kartu.length, 0);
    const skorB = kb.reduce((a, x) => a + x.kartu.length, 0);
    const menang = skorU > skorB;
    return {
      balas: [
        `🏁 *Permainan selesai!*`,
        ``,
        `*Kamu* (${skorU} kartu tersusun):`,
        ku.length ? ku.map((x) => `• ${x.nama}`).join('\n') : '• tidak ada kombinasi',
        ``,
        `*Bot* (${skorB} kartu tersusun):`,
        kb.length ? kb.map((x) => `• ${x.nama}`).join('\n') : '• tidak ada kombinasi',
        ``,
        menang ? `🏆 *Kamu menang!*` : skorU === skorB ? `🤝 *Seri!*` : `😤 *Bot menang!*`,
        ``,
        `Ketik *main remi* untuk main lagi.`,
      ].join('\n'),
      state: null, selesai: true, menang,
    };
  }

  const mBuang = teks.match(/buang\s+(.+)/);
  if (mBuang) {
    const target = mBuang[1].trim();
    const idx = s.tanganUser.findIndex((k) => kartuTeks(k).toLowerCase() === target || k.nilai.toLowerCase() === target);
    if (idx < 0) return { balas: `Kartu "${target}" tidak ada di tanganmu.\n\nTanganmu: ${daftarKartuTeks(s.tanganUser)}`, state: s, selesai: false };
    const dibuang = s.tanganUser.splice(idx, 1)[0];
    return { balas: `Kamu buang ${kartuTeks(dibuang)}.\n\nTanganmu: ${daftarKartuTeks(s.tanganUser)}`, state: s, selesai: false };
  }

  return { balas: `Perintah: *tarik* (ambil kartu), *susun* (lihat kombinasi), *buang <kartu>*, atau *selesai*.`, state: s, selesai: false };
}

// ============================================================================
// 4. CANGKULAN — kartu, ambil dari buangan atau tarik, buang 1
// ============================================================================

export function cangkulanMulai(): Record<string, unknown> {
  const dek: Kartu[] = kocok(dekRemi());
  return { tanganUser: ambil(dek, 7), tanganBot: ambil(dek, 7), dek, buangan: [], ronde: 0 };
}

export function cangkulanLangkah(state: Record<string, unknown>, aksi: string): HasilGame {
  const s = state as { tanganUser: Kartu[]; tanganBot: Kartu[]; dek: Kartu[]; buangan: Kartu[]; ronde: number };
  const teks = aksi.trim().toLowerCase();

  if (/tarik|ambil|draw/.test(teks) && !/buang/.test(teks)) {
    if (s.dek.length === 0) return { balas: 'Dek habis! Permainan selesai.', state: null, selesai: true };
    const k = s.dek.shift()!;
    s.tanganUser.push(k);
    return { balas: `Kamu tarik ${kartuTeks(k)}.\n\nTanganmu (${s.tanganUser.length}): ${daftarKartuTeks(s.tanganUser)}\n\nSekarang *buang <kartu>*.`, state: s, selesai: false };
  }

  const mBuang = teks.match(/buang\s+(.+)/);
  if (mBuang) {
    const target = mBuang[1].trim();
    const idx = s.tanganUser.findIndex((k) => kartuTeks(k).toLowerCase() === target || k.nilai.toLowerCase() === target);
    if (idx < 0) return { balas: `Kartu "${target}" tidak ada. Tanganmu: ${daftarKartuTeks(s.tanganUser)}`, state: s, selesai: false };
    const dibuang = s.tanganUser.splice(idx, 1)[0];
    s.buangan.push(dibuang);

    if (s.tanganUser.length === 0) {
      return { balas: `🎉 *Kamu habis kartunya duluan — MENANG!*\n\nKetik *main cangkulan* untuk main lagi.`, state: null, selesai: true, menang: true };
    }

    // Bot: tarik lalu buang
    if (s.dek.length > 0) s.tanganBot.push(s.dek.shift()!);
    if (s.tanganBot.length > 0) s.buangan.push(s.tanganBot.shift()!);
    if (s.tanganBot.length === 0) {
      return { balas: `😤 *Bot habis kartunya duluan — bot menang!*\n\nKetik *main cangkulan* untuk main lagi.`, state: null, selesai: true, menang: false };
    }

    return {
      balas: `Kamu buang ${kartuTeks(dibuang)}. Buangan terakhir: ${kartuTeks(s.buangan[s.buangan.length - 1])}\n\nTanganmu (${s.tanganUser.length}): ${daftarKartuTeks(s.tanganUser)}\nBot: ${s.tanganBot.length} kartu\n\nKetik *tarik* untuk ambil kartu baru.`,
      state: s, selesai: false,
    };
  }

  return { balas: `Perintah: *tarik* (ambil kartu) lalu *buang <kartu>* (mis. "buang ♥3").\n\nTanganmu: ${daftarKartuTeks(s.tanganUser)}`, state: s, selesai: false };
}

// ============================================================================
// 5. GAPLE / DOMINO — 28 kartu domino, cocokkan angka
// ============================================================================

export function gapleMulai(): Record<string, unknown> {
  const dek: Array<[number, number]> = [];
  for (let a = 0; a <= 6; a++) for (let b = a; b <= 6; b++) dek.push([a, b]);
  const kocokDek: Array<[number, number]> = kocok(dek);
  return {
    tanganUser: ambil(kocokDek, 7),
    tanganBot: ambil(kocokDek, 7),
    dek: kocokDek,
    papan: [] as Array<[number, number]>,
    ronde: 0,
  };
}

function dominoTeks(d: [number, number]): string {
  return `[${d[0]}|${d[1]}]`;
}

export function gapleLangkah(state: Record<string, unknown>, aksi: string): HasilGame {
  const s = state as { tanganUser: Array<[number, number]>; tanganBot: Array<[number, number]>; dek: Array<[number, number]>; papan: Array<[number, number]>; ronde: number };
  const teks = aksi.trim().toLowerCase();

  if (/tarik|ambil|draw|lewat|pass|ga ada|gak ada/.test(teks)) {
    if (s.dek.length > 0) {
      const k = s.dek.shift()!;
      s.tanganUser.push(k);
      return { balas: `Kamu tarik ${dominoTeks(k)}.\n\nTanganmu: ${s.tanganUser.map(dominoTeks).join(' ')}`, state: s, selesai: false };
    }
    // Bot jalan
    const jalan = s.tanganBot.find((d) => gapleBoleh(d, s.papan));
    if (jalan) {
      s.tanganBot = s.tanganBot.filter((d) => d !== jalan);
      s.papan.push(jalan);
    }
    return { balas: `Dek habis. Bot ${jalan ? 'taruh ' + dominoTeks(jalan) : 'lewat'}.\n\nTanganmu: ${s.tanganUser.map(dominoTeks).join(' ')}\nPapan: ${s.papan.map(dominoTeks).join(' ') || '(kosong)'}`, state: s, selesai: false };
  }

  // Cari domino yang dimainkan (mis. "3 5" atau "3-5")
  const mAngka = teks.match(/\b(\d)\D+(\d)\b/);
  if (mAngka) {
    const a = Number(mAngka[1]), b = Number(mAngka[2]);
    const idx = s.tanganUser.findIndex((d) => (d[0] === a && d[1] === b) || (d[0] === b && d[1] === a));
    if (idx < 0) return { balas: `Kamu tidak punya ${dominoTeks([a, b])}.\n\nTanganmu: ${s.tanganUser.map(dominoTeks).join(' ')}`, state: s, selesai: false };
    const kartu = s.tanganUser[idx];
    if (!gapleBoleh(kartu, s.papan)) {
      const ujung = s.papan.length === 0 ? '(papan kosong, semua boleh)' : `ujung: ${s.papan[0][0]} dan ${s.papan[s.papan.length - 1][1]}`;
      return { balas: `❌ ${dominoTeks(kartu)} tidak cocok (${ujung}).`, state: s, selesai: false };
    }
    s.tanganUser.splice(idx, 1);
    s.papan.push(kartu);

    if (s.tanganUser.length === 0) {
      return { balas: `🎉 *Kamu habis kartunya — MENANG!*\n\nKetik *main gaple* untuk main lagi.`, state: null, selesai: true, menang: true };
    }

    const botMain = s.tanganBot.find((d) => gapleBoleh(d, s.papan));
    if (botMain) {
      s.tanganBot = s.tanganBot.filter((d) => d !== botMain);
      s.papan.push(botMain);
    } else if (s.dek.length > 0) {
      s.tanganBot.push(s.dek.shift()!);
    }
    if (s.tanganBot.length === 0) {
      return { balas: `😤 *Bot habis kartunya — bot menang!*\n\nKetik *main gaple* untuk main lagi.`, state: null, selesai: true, menang: false };
    }

    const ujungKiri = s.papan[0][0], ujungKanan = s.papan[s.papan.length - 1][1];
    return {
      balas: [
        `Papan: ${s.papan.map(dominoTeks).join(' ')}`,
        `Ujung terbuka: *${ujungKiri}* dan *${ujungKanan}*`,
        ``,
        `Tanganmu (${s.tanganUser.length}): ${s.tanganUser.map(dominoTeks).join(' ')}`,
        `Bot: ${s.tanganBot.length} kartu | Dek: ${s.dek.length}`,
        ``,
        `Ketik angka pasanganmu (mis. *3 5*), atau *tarik*.`,
      ].join('\n'),
      state: s, selesai: false,
    };
  }

  return { balas: `Perintah: ketik angka domino (mis. *3 5*) untuk menaruh, atau *tarik*.\n\nTanganmu: ${s.tanganUser.map(dominoTeks).join(' ')}\nPapan: ${s.papan.map(dominoTeks).join(' ') || '(kosong)'}`, state: s, selesai: false };
}

function gapleBoleh(d: [number, number], papan: Array<[number, number]>): boolean {
  if (papan.length === 0) return true;
  const kiri = papan[0][0];
  const kanan = papan[papan.length - 1][1];
  return d[0] === kiri || d[1] === kiri || d[0] === kanan || d[1] === kanan;
}

// ============================================================================
// 6. QIU-QIU — domino 3 kartu, adu nilai (mod 10)
// ============================================================================

export function qiuqiuMulai(): Record<string, unknown> {
  const dek: Array<[number, number]> = [];
  for (let a = 0; a <= 6; a++) for (let b = a; b <= 6; b++) dek.push([a, b]);
  const k: Array<[number, number]> = kocok(dek);
  return { tanganUser: ambil(k, 3), tanganBot: ambil(k, 3), ronde: 0 };
}

/** Nilai qiu-qiu: jumlah semua angka mod 10. */
function nilaiQiu(t: Array<[number, number]>): number {
  const total = t.reduce((a, d) => a + d[0] + d[1], 0);
  return total % 10;
}

export function qiuqiuLangkah(state: Record<string, unknown>, aksi: string): HasilGame {
  const s = state as { tanganUser: Array<[number, number]>; tanganBot: Array<[number, number]>; ronde: number };
  if (/buka|adu|main|lihat/.test(aksi.toLowerCase()) || aksi.trim() === '') {
    s.ronde += 1;
    const nu = nilaiQiu(s.tanganUser);
    const nb = nilaiQiu(s.tanganBot);
    const menang = nu >= nb;
    return {
      balas: [
        `🎲 *RONDE ${s.ronde} — Qiu-Qiu*`,
        ``,
        `*Kamu*: ${s.tanganUser.map(dominoTeks).join(' ')} → nilai *${nu}*`,
        `*Bot* : ${s.tanganBot.map(dominoTeks).join(' ')} → nilai *${nb}*`,
        ``,
        menang ? `🏆 *Kamu menang!*` : `😤 *Bot menang!*`,
        ``,
        `Ketik *buka* untuk ronde baru, atau *berhenti*.`,
      ].join('\n'),
      state: s, selesai: false, menang,
    };
  }
  return { balas: `Ketik *buka* untuk adu kartu, atau *berhenti*.`, state: s, selesai: false };
}

// ============================================================================
// 7. CATUR — gerakan sah per bidak (tanpa deteksi skak, versi ramah chat)
// ============================================================================

export function caturMulai(): Record<string, unknown> {
  return { papan: papanAwal(), giliran: 'user', riwayat: [] as string[] };
}

/** Cek gerakan sah bidak. Mengembalikan true bila sah (tanpa validasi skak). */
function caturSah(p: Papan, dari: [number, number], ke: [number, number], putih: boolean): boolean {
  const [r1, c1] = dari, [r2, c2] = ke;
  if (r2 < 0 || r2 > 7 || c2 < 0 || c2 > 7) return false;
  const bidak = p[r1][c1];
  if (bidak === '.') return false;
  const milikPutih = bidak === bidak.toUpperCase();
  if (milikPutih !== putih) return false;
  const tujuan = p[r2][c2];
  if (tujuan !== '.' && (tujuan === tujuan.toUpperCase()) === putih) return false; // tidak makan kawan

  const dr = r2 - r1, dc = c2 - c1;
  const adr = Math.abs(dr), adc = Math.abs(dc);
  const jenis = bidak.toLowerCase();

  const jalurBersih = (): boolean => {
    const sr = Math.sign(dr), sc = Math.sign(dc);
    let rr = r1 + sr, cc = c1 + sc;
    while (rr !== r2 || cc !== c2) {
      if (p[rr][cc] !== '.') return false;
      rr += sr; cc += sc;
    }
    return true;
  };

  switch (jenis) {
    case 'p': { // pion
      const maju = putih ? -1 : 1;
      const awal = putih ? 6 : 1;
      if (dc === 0 && dr === maju && tujuan === '.') return true;
      if (dc === 0 && dr === 2 * maju && r1 === awal && tujuan === '.' && p[r1 + maju][c1] === '.') return true;
      if (adc === 1 && dr === maju && tujuan !== '.') return true; // makan diagonal
      return false;
    }
    case 'n': return (adr === 2 && adc === 1) || (adr === 1 && adc === 2);
    case 'b': return adr === adc && adr > 0 && jalurBersih();
    case 'r': return ((dr === 0) !== (dc === 0)) && jalurBersih();
    case 'q': return ((adr === adc) || (dr === 0) || (dc === 0)) && jalurBersih();
    case 'k': return adr <= 1 && adc <= 1 && (adr + adc > 0);
    default: return false;
  }
}

export function caturLangkah(state: Record<string, unknown>, aksi: string): HasilGame {
  const s = state as { papan: Papan; giliran: string; riwayat: string[] };
  const teks = aksi.trim().toLowerCase().replace(/\s+/g, ' ');

  // Terima "e2 e4" atau "e2e4"
  const m = teks.match(/\b([a-h][1-8])\s*[-–]?\s*([a-h][1-8])\b/);
  if (!m) {
    return { balas: `Ketik gerakan seperti *e2 e4* (dari -> ke).\n\n${papanTeks(s.papan)}`, state: s, selesai: false };
  }
  const dari = posKe(m[1]), ke = posKe(m[2]);
  if (!dari || !ke) return { balas: `Format posisi salah. Contoh: *e2 e4*.`, state: s, selesai: false };
  if (!caturSah(s.papan, dari, ke, true)) {
    return { balas: `❌ Gerakan *${m[1]} ${m[2]}* tidak sah untuk bidak di ${m[1]}.\n\n${papanTeks(s.papan)}`, state: s, selesai: false };
  }

  const dimakan = s.papan[ke[0]][ke[1]];
  s.papan[ke[0]][ke[1]] = s.papan[dari[0]][dari[1]];
  s.papan[dari[0]][dari[1]] = '.';
  s.riwayat.push(`${m[1]}-${m[2]}`);

  if (dimakan.toLowerCase() === 'k') {
    return { balas: `👑 *Kamu menang!* Raja bot berhasil dimakan (${m[2]}).\n\n${papanTeks(s.papan)}\n\nKetik *main catur* untuk main lagi.`, state: null, selesai: true, menang: true };
  }

  // Bot: cari gerakan sah acak yang menguntungkan (prioritas makan)
  const gerakanBot = caturCariGerakan(s.papan, false);
  if (gerakanBot.length === 0) {
    return { balas: `Bot tidak punya gerakan sah. Permainan selesai.\n\n${papanTeks(s.papan)}`, state: null, selesai: true };
  }
  // Prioritaskan makan bidak bernilai tinggi
  const nilaiBidak: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };
  gerakanBot.sort((a, b) => (nilaiBidak[s.papan[b[1][0]][b[1][1]].toLowerCase()] ?? 0) - (nilaiBidak[s.papan[a[1][0]][a[1][1]].toLowerCase()] ?? 0));
  const [dariB, keB] = gerakanBot[0];
  const dimakanB = s.papan[keB[0]][keB[1]];
  s.papan[keB[0]][keB[1]] = s.papan[dariB[0]][dariB[1]];
  s.papan[dariB[0]][dariB[1]] = '.';
  s.riwayat.push(`${posTeks(dariB)}-${posTeks(keB)}`);

  if (dimakanB.toLowerCase() === 'k') {
    return { balas: `😤 *Bot menang!* Rajamu dimakan.\n\n${papanTeks(s.papan)}\n\nCoba lagi: *main catur*.`, state: null, selesai: true, menang: false };
  }

  const infoMakan = dimakan ? ` (makan ${dimakan})` : '';
  const infoKena = dimakanB ? `\n⚠️ Bot makan bidakmu di ${posTeks(keB)}!` : '';
  return {
    balas: `Bot jalan ${posTeks(dariB)}-${posTeks(keB)}${infoMakan}.${infoKena}\n\n${papanTeks(s.papan)}\n\nGiliranmu — ketik gerakan (mis. *e2 e4*).`,
    state: s, selesai: false,
  };
}

function posTeks(p: [number, number]): string {
  return `${String.fromCharCode(97 + p[1])}${8 - p[0]}`;
}

function caturCariGerakan(p: Papan, putih: boolean): Array<[[number, number], [number, number]]> {
  const out: Array<[[number, number], [number, number]]> = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const b = p[r][c];
      if (b === '.') continue;
      if ((b === b.toUpperCase()) !== putih) continue;
      for (let r2 = 0; r2 < 8; r2++) {
        for (let c2 = 0; c2 < 8; c2++) {
          if (caturSah(p, [r, c], [r2, c2], putih)) out.push([[r, c], [r2, c2]]);
        }
      }
    }
  }
  return out;
}

// ============================================================================
// 8. HALMA — pindahkan pion ke sisi lawan (versi sederhana)
// ============================================================================

export function halmaMulai(): Record<string, unknown> {
  return { papan: halmaAwal(), langkah: 0 };
}

export function halmaLangkah(state: Record<string, unknown>, aksi: string): HasilGame {
  const s = state as { papan: Papan; langkah: number };
  const teks = aksi.trim().toLowerCase();
  const m = teks.match(/\b([a-h][1-8])\s*[-–]?\s*([a-h][1-8])\b/);
  if (!m) {
    return { balas: `Ketik posisi seperti *d7 d6* (dari -> ke). Pionmu huruf *P*.\n\n${papanTeks(s.papan)}`, state: s, selesai: false };
  }
  const dari = posKe(m[1]), ke = posKe(m[2]);
  if (!dari || !ke) return { balas: 'Format posisi salah. Contoh: *d7 d6*.', state: s, selesai: false };
  if (s.papan[dari[0]][dari[1]] !== 'P') return { balas: `Di ${m[1]} bukan pionmu.`, state: s, selesai: false };
  if (s.papan[ke[0]][ke[1]] !== '.') return { balas: `Posisi ${m[2]} sudah terisi.`, state: s, selesai: false };

  const adr = Math.abs(ke[0] - dari[0]), adc = Math.abs(ke[1] - dari[1]);
  const satuLangkah = adr <= 1 && adc <= 1;
  // Lompatan: ada pion di tengah, dan mendarat 2 langkah
  const tengah: [number, number] = [(dari[0] + ke[0]) / 2, (dari[1] + ke[1]) / 2];
  const lompat = adr <= 2 && adc <= 2 && Number.isInteger(tengah[0]) && Number.isInteger(tengah[1]) && s.papan[tengah[0]][tengah[1]] !== '.';
  if (!satuLangkah && !lompat) {
    return { balas: `❌ Gerakan tidak sah. Pion hanya bisa geser 1 langkah (atau lompat 1 pion).`, state: s, selesai: false };
  }

  s.papan[ke[0]][ke[1]] = 'P';
  s.papan[dari[0]][dari[1]] = '.';
  s.langkah += 1;

  // Bot: geser satu pion ke arah bawah (mendekati sisi pemain)
  const botPion: Array<[number, number]> = [];
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if (s.papan[r][c] === 'C') botPion.push([r, c]);
  for (const [r, c] of botPion.sort((a, b) => b[0] - a[0])) {
    for (const [dr, dc] of [[1, 0], [1, 1], [1, -1], [0, 1], [0, -1]]) {
      const nr = r + dr, nc = c + dc;
      if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8 && s.papan[nr][nc] === '.') {
        s.papan[nr][nc] = 'C';
        s.papan[r][c] = '.';
        break;
      }
    }
    if (s.papan[r][c] === '.') break;
  }

  // Menang: semua P ada di 3 baris atas
  const pBawah = [];
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if (s.papan[r][c] === 'P' && r > 2) pBawah.push([r, c]);
  if (pBawah.length === 0) {
    return { balas: `🎉 *Kamu menang!* Semua pionmu sampai sisi lawan!\n\n${papanTeks(s.papan)}`, state: null, selesai: true, menang: true };
  }

  return { balas: `✅ Pionmu pindah ${m[1]} → ${m[2]}.\n\n${papanTeks(s.papan)}\n\nGiliranmu lagi (bot sudah jalan). Ketik gerakan berikutnya.`, state: s, selesai: false };
}

// ============================================================================
// 9. TIC-TAC-TOE
// ============================================================================

export function tictactoeMulai(): Record<string, unknown> {
  return { papan: ticTacAwal() };
}

export function tictactoeLangkah(state: Record<string, unknown>, aksi: string): HasilGame {
  const s = state as { papan: TicTac };
  const m = aksi.match(/\b([1-9])\b/);
  if (!m) return { balas: `Ketik nomor kotak 1-9.\n\n${ticTacTeks(s.papan)}`, state: s, selesai: false };
  const idx = Number(m[1]) - 1;
  if (s.papan[idx]) return { balas: `Kotak ${m[1]} sudah terisi.\n\n${ticTacTeks(s.papan)}`, state: s, selesai: false };

  s.papan[idx] = 'X';
  let p = ticTacPemenang(s.papan);
  if (p === 'X') return { balas: `🎉 *Kamu menang!*\n\n${ticTacTeks(s.papan)}\n\nKetik *main tictactoe* untuk main lagi.`, state: null, selesai: true, menang: true };
  if (p === 'seri') return { balas: `🤝 *Seri!*\n\n${ticTacTeks(s.papan)}`, state: null, selesai: true };

  const bot = ticTacBot(s.papan);
  if (bot >= 0) s.papan[bot] = 'O';
  p = ticTacPemenang(s.papan);
  if (p === 'O') return { balas: `😤 *Bot menang!*\n\n${ticTacTeks(s.papan)}\n\nCoba lagi: *main tictactoe*.`, state: null, selesai: true, menang: false };
  if (p === 'seri') return { balas: `🤝 *Seri!*\n\n${ticTacTeks(s.papan)}`, state: null, selesai: true };

  return { balas: `Bot jalan di kotak ${bot + 1}.\n\n${ticTacTeks(s.papan)}\n\nGiliranmu — ketik nomor kotak.`, state: s, selesai: false };
}

// ============================================================================
// 10. HANGMAN (Tebak Kata)
// ============================================================================

export function hangmanMulai(): Record<string, unknown> {
  const kata = pilih(KATA_HANGMAN);
  return { kata, terbuka: [] as string[], salah: [] as string[], nyawa: 5 };
}

export function hangmanLangkah(state: Record<string, unknown>, aksi: string): HasilGame {
  const s = state as { kata: string; terbuka: string[]; salah: string[]; nyawa: number };
  const m = aksi.toLowerCase().match(/[a-z]/g);
  if (!m) return { balas: `Ketik satu huruf.\n\n${hangmanTeks(s.kata, s.terbuka, s.salah, s.nyawa)}`, state: s, selesai: false };

  // Dukung tebak kata utuh
  const tebak = aksi.trim().toLowerCase().replace(/[^a-z]/g, '');
  if (tebak.length > 1) {
    if (tebak === s.kata) {
      return { balas: `🎉 *BENAR!* Katanya "${s.kata}". Kamu menang! 🏆\n\nKetik *main hangman* untuk main lagi.`, state: null, selesai: true, menang: true };
    }
    s.nyawa -= 1;
    if (s.nyawa <= 0) return { balas: `💀 *Kalah!* Katanya "${s.kata}".\n\nCoba lagi: *main hangman*.`, state: null, selesai: true, menang: false };
    return { balas: `❌ Bukan "${tebak}".\n\n${hangmanTeks(s.kata, s.terbuka, s.salah, s.nyawa)}`, state: s, selesai: false };
  }

  const huruf = m[0];
  if (s.terbuka.includes(huruf) || s.salah.includes(huruf)) {
    return { balas: `Huruf "${huruf}" sudah ditebak.\n\n${hangmanTeks(s.kata, s.terbuka, s.salah, s.nyawa)}`, state: s, selesai: false };
  }
  if (s.kata.includes(huruf)) {
    s.terbuka.push(huruf);
    if (s.kata.split('').every((c) => s.terbuka.includes(c))) {
      return { balas: `🎉 *BENAR!* Katanya "${s.kata}". Kamu menang! 🏆\n\nKetik *main hangman* untuk main lagi.`, state: null, selesai: true, menang: true };
    }
    return { balas: `✅ Ada huruf "${huruf}"!\n\n${hangmanTeks(s.kata, s.terbuka, s.salah, s.nyawa)}`, state: s, selesai: false };
  }
  s.salah.push(huruf);
  s.nyawa -= 1;
  if (s.nyawa <= 0) {
    return { balas: `💀 *Kalah!* Katanya "${s.kata}".\n\nCoba lagi: *main hangman*.`, state: null, selesai: true, menang: false };
  }
  return { balas: `❌ Tidak ada "${huruf}".\n\n${hangmanTeks(s.kata, s.terbuka, s.salah, s.nyawa)}`, state: s, selesai: false };
}

// ============================================================================
// 11. TEBAK ANGKA
// ============================================================================

export function tebakAngkaMulai(): Record<string, unknown> {
  return { target: acak(100), tebakan: [] as number[], maks: 7 };
}

export function tebakAngkaLangkah(state: Record<string, unknown>, aksi: string): HasilGame {
  const s = state as { target: number; tebakan: number[]; maks: number };
  const m = aksi.match(/\b(\d{1,3})\b/);
  if (!m) return { balas: `Ketik angka 1-100. Sisa percobaan: ${s.maks - s.tebakan.length}.`, state: s, selesai: false };
  const n = Number(m[1]);
  if (n < 1 || n > 100) return { balas: `Angkanya antara 1 sampai 100.`, state: s, selesai: false };
  s.tebakan.push(n);

  if (n === s.target) {
    return { balas: `🎉 *BENAR!* Angkanya ${s.target}. Kamu menebak dalam ${s.tebakan.length} percobaan! 🏆\n\nKetik *main tebakangka* untuk main lagi.`, state: null, selesai: true, menang: true };
  }
  if (s.tebakan.length >= s.maks) {
    return { balas: `💀 *Habis percobaan!* Angkanya ${s.target}.\n\nCoba lagi: *main tebakangka*.`, state: null, selesai: true, menang: false };
  }
  const petunjuk = n < s.target ? '📈 Terlalu *kecil*' : '📉 Terlalu *besar*';
  return { balas: `${petunjuk}.\n\nSisa percobaan: ${s.maks - s.tebakan.length}\nSudah ditebak: ${s.tebakan.join(', ')}`, state: s, selesai: false };
}

// ============================================================================
// 12. DADU (adu angka)
// ============================================================================

export function daduMulai(): Record<string, unknown> {
  return { skorUser: 0, skorBot: 0, ronde: 0 };
}

export function daduLangkah(state: Record<string, unknown>, aksi: string): HasilGame {
  const s = state as { skorUser: number; skorBot: number; ronde: number };
  const t = aksi.toLowerCase();
  if (/lempar|kocok|roll|main|gas|ayo/.test(t) || t.trim() === '') {
    const d1 = acak(6), d2 = acak(6);
    const b1 = acak(6), b2 = acak(6);
    const totalU = d1 + d2, totalB = b1 + b2;
    s.ronde += 1;
    s.skorUser += totalU;
    s.skorBot += totalB;
    const menang = totalU > totalB;
    return {
      balas: [
        `🎲 *RONDE ${s.ronde}*`,
        `Kamu: ${d1} + ${d2} = *${totalU}*`,
        `Bot : ${b1} + ${b2} = *${totalB}*`,
        ``,
        menang ? '🏆 Kamu menang ronde ini!' : totalU === totalB ? '🤝 Seri ronde ini!' : '😤 Bot menang ronde ini!',
        ``,
        `Skor total — Kamu: *${s.skorUser}* | Bot: *${s.skorBot}*`,
        ``,
        `Ketik *lempar* lagi, atau *berhenti*.`,
      ].join('\n'),
      state: s, selesai: false, menang,
    };
  }
  return { balas: `Ketik *lempar* untuk mengocok dadu, atau *berhenti*.`, state: s, selesai: false };
}

// ============================================================================
// 13. BATU-GUNTING-KERTAS
// ============================================================================

const PILIHAN_BGK = ['batu', 'gunting', 'kertas'];
export const EMOJI_BGK: Record<string, string> = { batu: '✊', gunting: '✌️', kertas: '✋' };

export function batuMulai(): Record<string, unknown> {
  return { skorUser: 0, skorBot: 0, ronde: 0 };
}

export function batuLangkah(state: Record<string, unknown>, aksi: string): HasilGame {
  const s = state as { skorUser: number; skorBot: number; ronde: number };
  const t = aksi.toLowerCase();
  const pilihUser = PILIHAN_BGK.find((p) => t.includes(p));
  if (!pilihUser) return { balas: `Pilih: *batu*, *gunting*, atau *kertas*.`, state: s, selesai: false };
  const pilihBot = pilih(PILIHAN_BGK);
  s.ronde += 1;

  let hasil: 'menang' | 'kalah' | 'seri';
  if (pilihUser === pilihBot) hasil = 'seri';
  else if (
    (pilihUser === 'batu' && pilihBot === 'gunting') ||
    (pilihUser === 'gunting' && pilihBot === 'kertas') ||
    (pilihUser === 'kertas' && pilihBot === 'batu')
  ) hasil = 'menang';
  else hasil = 'kalah';

  if (hasil === 'menang') s.skorUser += 1;
  if (hasil === 'kalah') s.skorBot += 1;

  return {
    balas: [
      `Kamu ${EMOJI_BGK[pilihUser]} vs Bot ${EMOJI_BGK[pilihBot]}`,
      ``,
      hasil === 'menang' ? '🏆 Kamu menang!' : hasil === 'kalah' ? '😤 Bot menang!' : '🤝 Seri!',
      ``,
      `Skor — Kamu: *${s.skorUser}* | Bot: *${s.skorBot}* (ronde ${s.ronde})`,
      ``,
      `Ketik *batu*/*gunting*/*kertas* lagi, atau *berhenti*.`,
    ].join('\n'),
    state: s, selesai: false, menang: hasil === 'menang',
  };
}

// ============================================================================
// 14. SUIT JAWA (gajah, orang, semut)
// ============================================================================

const SUIT_JAWA = ['gajah', 'orang', 'semut'];
export const EMOJI_SUIT: Record<string, string> = { gajah: '🐘', orang: '🧑', semut: '🐜' };

export function suitJawaMulai(): Record<string, unknown> {
  return { skorUser: 0, skorBot: 0, ronde: 0 };
}

export function suitJawaLangkah(state: Record<string, unknown>, aksi: string): HasilGame {
  const s = state as { skorUser: number; skorBot: number; ronde: number };
  const t = aksi.toLowerCase();
  const pilihUser = SUIT_JAWA.find((p) => t.includes(p));
  if (!pilihUser) return { balas: `Pilih: *gajah*, *orang*, atau *semut*.\n(Gajah kalah lawan semut, semut kalah lawan orang, orang kalah lawan gajah)`, state: s, selesai: false };
  const pilihBot = pilih(SUIT_JAWA);
  s.ronde += 1;

  let hasil: 'menang' | 'kalah' | 'seri';
  if (pilihUser === pilihBot) hasil = 'seri';
  else if (
    (pilihUser === 'gajah' && pilihBot === 'orang') ||
    (pilihUser === 'orang' && pilihBot === 'semut') ||
    (pilihUser === 'semut' && pilihBot === 'gajah')
  ) hasil = 'menang';
  else hasil = 'kalah';

  if (hasil === 'menang') s.skorUser += 1;
  if (hasil === 'kalah') s.skorBot += 1;

  return {
    balas: [
      `Kamu ${EMOJI_SUIT[pilihUser]} vs Bot ${EMOJI_SUIT[pilihBot]}`,
      ``,
      hasil === 'menang' ? '🏆 Kamu menang!' : hasil === 'kalah' ? '😤 Bot menang!' : '🤝 Seri!',
      ``,
      `Skor — Kamu: *${s.skorUser}* | Bot: *${s.skorBot}*`,
      ``,
      `Ketik *gajah*/*orang*/*semut* lagi, atau *berhenti*.`,
    ].join('\n'),
    state: s, selesai: false, menang: hasil === 'menang',
  };
}

// ============================================================================
// 15. MONOPOLI (versi dadu sederhana)
// ============================================================================

const PETAK = ['START', 'Medan', 'Bandung', 'Jakarta', 'Semarang', 'Surabaya', 'Bali', 'Yogyakarta', 'Malang', 'Makassar', 'Papua', 'Penjara', 'Bebas', 'Kesempatan', 'Pajak', 'Bandara', 'Pelabuhan', 'Hotel', 'Stasiun', 'Listrik', 'Air', 'Internet', 'Kartu', 'Bonus', 'Denda', 'Lelang', 'Warisan', 'Hadiah', 'Zonasi', 'Sertifikat', 'Krisis', 'Boom', 'Final'];

export function monopoliMulai(): Record<string, unknown> {
  return { posUser: 0, posBot: 0, uangUser: 1500, uangBot: 1500, ronde: 0, properti: [] as string[] };
}

export function monopoliLangkah(state: Record<string, unknown>, aksi: string): HasilGame {
  const s = state as { posUser: number; posBot: number; uangUser: number; uangBot: number; ronde: number; properti: string[] };
  const t = aksi.toLowerCase();
  if (/lempar|kocok|roll|gas|main|ayo/.test(t) || t.trim() === '') {
    const d = acak(6);
    s.posUser = (s.posUser + d) % PETAK.length;
    const petak = PETAK[s.posUser];
    s.ronde += 1;

    let efek = '';
    if (petak === 'Bonus' || petak === 'Hadiah') { s.uangUser += 200; efek = '💰 Dapat bonus +200!'; }
    else if (petak === 'Denda' || petak === 'Pajak') { s.uangUser -= 150; efek = '💸 Kena denda -150.'; }
    else if (petak === 'Penjara') { efek = '🚔 Masuk penjara (lewat 1 giliran).'; }
    else if (petak === 'Krisis') { s.uangUser -= 300; efek = '📉 Krisis! -300.'; }
    else if (petak === 'Boom') { s.uangUser += 300; efek = '📈 Boom! +300.'; }
    else if (petak === 'Kesempatan' || petak === 'Kartu') {
      const untung = Math.random() > 0.5;
      s.uangUser += untung ? 100 : -100;
      efek = untung ? '🎴 Kartu keberuntungan: +100!' : '🎴 Kartu sial: -100.';
    } else if (petak !== 'START' && petak !== 'Bebas' && petak !== 'Final') {
      // Beli properti otomatis bila mampu
      if (s.uangUser >= 200 && !s.properti.includes(petak)) {
        s.uangUser -= 200;
        s.properti.push(petak);
        efek = `🏠 Kamu beli ${petak} (-200).`;
      }
    }

    // Bot jalan
    const db = acak(6);
    s.posBot = (s.posBot + db) % PETAK.length;
    const petakBot = PETAK[s.posBot];
    if (petakBot === 'Bonus' || petakBot === 'Hadiah') s.uangBot += 200;
    else if (petakBot === 'Denda' || petakBot === 'Pajak') s.uangBot -= 150;
    else if (petakBot === 'Krisis') s.uangBot -= 300;
    else if (petakBot === 'Boom') s.uangBot += 300;
    else if (s.uangBot >= 200 && !PETAK.includes(petakBot)) s.uangBot -= 200;

    if (s.uangUser <= 0) {
      return { balas: `💀 *Kamu bangkrut!* Bot menang.\n\nKetik *main monopoli* untuk main lagi.`, state: null, selesai: true, menang: false };
    }
    if (s.uangBot <= 0) {
      return { balas: `🎉 *Bot bangkrut — kamu MENANG!* 🏆\n\nKetik *main monopoli* untuk main lagi.`, state: null, selesai: true, menang: true };
    }

    return {
      balas: [
        `🎲 Dadu: *${d}* → kamu mendarat di *${petak}*`,
        efek || '   (tidak ada efek khusus)',
        ``,
        `Bot lempar ${db} → mendarat di *${petakBot}*`,
        ``,
        `💰 Uangmu: *Rp${s.uangUser.toLocaleString('id-ID')}*`,
        `🤖 Uang bot: Rp${s.uangBot.toLocaleString('id-ID')}`,
        `🏠 Propertimu: ${s.properti.join(', ') || '(belum ada)'}`,
        ``,
        `Ketik *lempar* lagi, atau *berhenti*.`,
      ].join('\n'),
      state: s, selesai: false,
    };
  }
  return { balas: `Ketik *lempar* untuk mengocok dadu, atau *berhenti*.`, state: s, selesai: false };
}

// ============================================================================
// 16. KUIS PENGETAHUAN
// ============================================================================

const BANK_KUIS: Array<{ t: string; j: string[]; b: number }> = [
  { t: 'Ibu kota Indonesia adalah?', j: ['Jakarta', 'Bandung', 'Surabaya', 'Medan'], b: 0 },
  { t: 'Planet terdekat dengan Matahari?', j: ['Venus', 'Merkurius', 'Bumi', 'Mars'], b: 1 },
  { t: 'Berapa jumlah provinsi di Indonesia (2024)?', j: ['34', '36', '38', '40'], b: 2 },
  { t: 'Hewan tercepat di darat?', j: ['Kuda', 'Cheetah', 'Singa', 'Antelop'], b: 1 },
  { t: 'Lambang kimia emas?', j: ['Ag', 'Au', 'Fe', 'Cu'], b: 1 },
  { t: 'Danau terluas di Indonesia?', j: ['Toba', 'Singkarak', 'Poso', 'Sentani'], b: 0 },
  { t: 'Gunung tertinggi di Jawa?', j: ['Semeru', 'Merapi', 'Slamet', 'Arjuno'], b: 0 },
  { t: 'Berapa jumlah pemain sepak bola satu tim?', j: ['9', '10', '11', '12'], b: 2 },
  { t: 'Mata uang Jepang?', j: ['Won', 'Yuan', 'Yen', 'Baht'], b: 2 },
  { t: 'Siapa penemu lampu pijar?', j: ['Nikola Tesla', 'Thomas Edison', 'Alexander Bell', 'James Watt'], b: 1 },
];

export function kuisMulai(): Record<string, unknown> {
  return { indeks: kocok(BANK_KUIS.map((_, i) => i)).slice(0, 5), putaran: 0, skorUser: 0, skorBot: 0, jawabanSekarang: null as number | null };
}

export function kuisLangkah(state: Record<string, unknown>, aksi: string): HasilGame {
  const s = state as { indeks: number[]; putaran: number; skorUser: number; skorBot: number; jawabanSekarang: number | null };

  if (s.jawabanSekarang === null) {
    if (s.putaran >= s.indeks.length) {
      const menang = s.skorUser > s.skorBot;
      return {
        balas: `🏁 *Kuis selesai!*\n\nSkor — Kamu: *${s.skorUser}* | Bot: *${s.skorBot}*\n\n${menang ? '🏆 Kamu menang!' : s.skorUser === s.skorBot ? '🤝 Seri!' : '😤 Bot menang!'}\n\nKetik *main kuis* untuk main lagi.`,
        state: null, selesai: true, menang,
      };
    }
    const q = BANK_KUIS[s.indeks[s.putaran]];
    s.jawabanSekarang = q.b;
    return {
      balas: `❓ *Soal ${s.putaran + 1}/${s.indeks.length}*\n\n${q.t}\n\n${q.j.map((x, i) => `${i + 1}. ${x}`).join('\n')}\n\nJawab dengan nomor (1-4).`,
      state: s, selesai: false,
    };
  }

  const m = aksi.match(/\b([1-4])\b/);
  if (!m) return { balas: `Jawab dengan nomor 1-4.`, state: s, selesai: false };
  const jawab = Number(m[1]) - 1;
  const q = BANK_KUIS[s.indeks[s.putaran]];
  const benar = jawab === s.jawabanSekarang;

  // Bot: peluang benar 70%
  const botBenar = Math.random() < 0.7;
  if (benar) s.skorUser += 1;
  if (botBenar) s.skorBot += 1;

  s.putaran += 1;
  s.jawabanSekarang = null;

  const info = benar ? '✅ *BENAR!*' : `❌ *Salah.* Jawabannya: ${q.j[q.b]}`;
  const infoBot = botBenar ? '🤖 Bot juga benar.' : '🤖 Bot salah.';

  if (s.putaran >= s.indeks.length) {
    const menang = s.skorUser > s.skorBot;
    return {
      balas: `${info}\n${infoBot}\n\n🏁 *Kuis selesai!*\nSkor — Kamu: *${s.skorUser}* | Bot: *${s.skorBot}*\n\n${menang ? '🏆 Kamu menang!' : s.skorUser === s.skorBot ? '🤝 Seri!' : '😤 Bot menang!'}\n\nKetik *main kuis* untuk main lagi.`,
      state: null, selesai: true, menang,
    };
  }

  const qNext = BANK_KUIS[s.indeks[s.putaran]];
  s.jawabanSekarang = qNext.b;
  return {
    balas: `${info}\n${infoBot}\n\nSkor — Kamu: *${s.skorUser}* | Bot: *${s.skorBot}*\n\n❓ *Soal ${s.putaran + 1}/${s.indeks.length}*\n${qNext.t}\n\n${qNext.j.map((x, i) => `${i + 1}. ${x}`).join('\n')}\n\nJawab dengan nomor (1-4).`,
    state: s, selesai: false,
  };
}

// ============================================================================
// ROUTER — pilih fungsi berdasarkan jenis permainan
// ============================================================================

export function mulaiGame(kind: string): Record<string, unknown> | null {
  switch (kind) {
    case 'uno': return unoMulai();
    case 'capsa': return capsaMulai();
    case 'remi': return remiMulai();
    case 'cangkulan': return cangkulanMulai();
    case 'gaple': return gapleMulai();
    case 'qiuqiu': return qiuqiuMulai();
    case 'catur': return caturMulai();
    case 'halma': return halmaMulai();
    case 'tictactoe': return tictactoeMulai();
    case 'hangman': return hangmanMulai();
    case 'tebakangka': return tebakAngkaMulai();
    case 'dadu': return daduMulai();
    case 'batu': return batuMulai();
    case 'suitjawa': return suitJawaMulai();
    case 'monopoli': return monopoliMulai();
    case 'kuis': return kuisMulai();
    default: return null;
  }
}

export function langkahGame(kind: string, state: Record<string, unknown>, aksi: string): HasilGame {
  switch (kind) {
    case 'uno': return unoLangkah(state, aksi);
    case 'capsa': return capsaLangkah(state, aksi);
    case 'remi': return remiLangkah(state, aksi);
    case 'cangkulan': return cangkulanLangkah(state, aksi);
    case 'gaple': return gapleLangkah(state, aksi);
    case 'qiuqiu': return qiuqiuLangkah(state, aksi);
    case 'catur': return caturLangkah(state, aksi);
    case 'halma': return halmaLangkah(state, aksi);
    case 'tictactoe': return tictactoeLangkah(state, aksi);
    case 'hangman': return hangmanLangkah(state, aksi);
    case 'tebakangka': return tebakAngkaLangkah(state, aksi);
    case 'dadu': return daduLangkah(state, aksi);
    case 'batu': return batuLangkah(state, aksi);
    case 'suitjawa': return suitJawaLangkah(state, aksi);
    case 'monopoli': return monopoliLangkah(state, aksi);
    case 'kuis': return kuisLangkah(state, aksi);
    default: return { balas: 'Permainan tidak dikenali.', state: null, selesai: true };
  }
}

/** Teks pembuka saat permainan dimulai. */
export function pembukaGame(kind: string, state: Record<string, unknown>): string {
  switch (kind) {
    case 'uno': {
      const s = state as { atas: KartuUno; warnaAktif: string; tanganUser: KartuUno[]; tanganBot: KartuUno[]; dek: KartuUno[] };
      return `🎴 *UNO dimulai!* Kamu dan bot masing-masing 7 kartu.\n\nKartu atas: *${kartuUnoTeks(s.atas)}* (warna aktif: ${s.warnaAktif})\n\n🖐️ Kartumu: ${daftarUnoTeks(s.tanganUser)}\n🤖 Bot: ${s.tanganBot.length} kartu\n\nKetik warna+angka (mis. *merah 5*), atau *tarik*. Ketik *berhenti* untuk keluar.`;
    }
    case 'capsa':
      return `🃏 *Capsa Banting dimulai!* Kamu dan bot dapat 13 kartu.\n\nTanganmu: ${daftarKartuTeks((state as { tanganUser: Kartu[] }).tanganUser)}\n\nKetik *banting* untuk adu kombinasi terbaik!`;
    case 'remi':
      return `🃏 *Remi dimulai!* Kamu dan bot dapat 7 kartu.\n\nTanganmu: ${daftarKartuTeks((state as { tanganUser: Kartu[] }).tanganUser)}\n\nKetik *tarik* (ambil kartu), *susun* (lihat kombinasi), *buang <kartu>*, atau *selesai*.`;
    case 'cangkulan':
      return `🃏 *Cangkulan dimulai!* 7 kartu masing-masing.\n\nTanganmu: ${daftarKartuTeks((state as { tanganUser: Kartu[] }).tanganUser)}\n\nKetik *tarik* lalu *buang <kartu>*. Yang habis duluan menang!`;
    case 'gaple': {
      const s = state as { tanganUser: Array<[number, number]> };
      return `🁫 *Gaple dimulai!* 7 kartu domino masing-masing.\n\nTanganmu: ${s.tanganUser.map((d) => `[${d[0]}|${d[1]}]`).join(' ')}\n\nKetik angka pasanganmu (mis. *3 5*) untuk menaruh, atau *tarik*.`;
    }
    case 'qiuqiu': {
      const s = state as { tanganUser: Array<[number, number]> };
      return `🎲 *Qiu-Qiu dimulai!* 3 kartu domino.\n\nKartumu: ${s.tanganUser.map((d) => `[${d[0]}|${d[1]}]`).join(' ')}\n\nKetik *buka* untuk adu nilai (jumlah angka mod 10, tertinggi menang).`;
    }
    case 'catur':
      return `♟️ *Catur dimulai!* Kamu putih (huruf besar), bot hitam (huruf kecil).\n\n${papanTeks((state as { papan: Papan }).papan)}\n\nKetik gerakan seperti *e2 e4*.`;
    case 'halma':
      return `🔵 *Halma dimulai!* Pionmu *P* (bawah), bot *C* (atas).\n\n${papanTeks((state as { papan: Papan }).papan)}\n\nKetik gerakan seperti *d7 d6*. Menang bila semua pionmu sampai 3 baris atas.`;
    case 'tictactoe':
      return `❌⭕ *Tic-Tac-Toe dimulai!* Kamu *X*, bot *O*.\n\n${ticTacTeks((state as { papan: TicTac }).papan)}\n\nKetik nomor kotak 1-9.`;
    case 'hangman': {
      const s = state as { kata: string; terbuka: string[]; salah: string[]; nyawa: number };
      return `🔤 *Tebak Kata dimulai!* Tebak huruf satu per satu.\n\n${hangmanTeks(s.kata, s.terbuka, s.salah, s.nyawa)}\n\nKetik satu huruf, atau tebak kata utuhnya.`;
    }
    case 'tebakangka':
      return `🔢 *Tebak Angka dimulai!* Aku pikirkan angka 1-100.\n\nKamu punya 7 percobaan. Ketik tebakanmu!`;
    case 'dadu':
      return `🎲 *Adu Dadu dimulai!* Kita lempar 2 dadu, total tertinggi menang.\n\nKetik *lempar*!`;
    case 'batu':
      return `✊✌️✋ *Batu-Gunting-Kertas dimulai!*\n\nKetik *batu*, *gunting*, atau *kertas*.`;
    case 'suitjawa':
      return `🐘🧑🐜 *Suit Jawa dimulai!*\n\nGajah kalah lawan semut, semut kalah lawan orang, orang kalah lawan gajah.\n\nKetik *gajah*, *orang*, atau *semut*.`;
    case 'monopoli':
      return `🎩 *Monopoli (versi dadu) dimulai!* Uang awal Rp1.500.\n\nKetik *lempar* untuk jalan, atau *berhenti*.`;
    case 'kuis': {
      const s = state as { indeks: number[]; jawabanSekarang: number | null };
      const q = BANK_KUIS[s.indeks[0]];
      s.jawabanSekarang = q.b;
      return `🧠 *Kuis Pengetahuan dimulai!* 5 soal, kamu lawan bot.\n\n❓ *Soal 1/5*\n${q.t}\n\n${q.j.map((x, i) => `${i + 1}. ${x}`).join('\n')}\n\nJawab dengan nomor (1-4).`;
    }
    default:
      return 'Permainan dimulai!';
  }
}
