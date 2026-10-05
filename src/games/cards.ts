/**
 * MESIN GAME — kartu, papan, dadu, dan aturan permainan.
 *
 * KENAPA MODUL INI ADA:
 * Sebelumnya bot MENGARANG saat diajak main (UNO/kartu/catur) karena tidak ada
 * state permainan tersimpan — tiap balasan kartunya berubah-ubah. Modul ini
 * menyimpan state NYATA dan memvalidasi setiap langkah dengan aturan permainan,
 * sehingga permainan terasa nyata dan konsisten.
 *
 * STRUKTUR:
 * - `KartuSet`  : dek kartu remi standar (52) + helper
 * - `kocok()`   : pengocokan Fisher-Yates (adil, tanpa bias)
 * - Tiap permainan punya: `mulai()` (buat state awal), `langkah()` (proses
 *   aksi user), `tampilan()` (render state jadi teks untuk chat), `selesai()`.
 *
 * Semua fungsi MURNI (tanpa efek samping) — state disimpan pemanggil (DB).
 */

// ============================================================================
// KARTU REMI
// ============================================================================

export type Jenis = 'sekop' | 'hati' | 'wajik' | 'keriting';
export type Nilai = 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K';

export interface Kartu {
  jenis: Jenis;
  nilai: Nilai;
}

/** Simbol tampilan jenis kartu (mudah dibaca di chat). */
export const SIMBOL: Record<Jenis, string> = {
  sekop: '♠', hati: '♥', wajik: '♦', keriting: '♣',
};

/** Nilai numerik untuk perbandingan (A=1..K=13). */
export const NILAI_ANGKA: Record<Nilai, number> = {
  A: 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10,
  J: 11, Q: 12, K: 13,
};

const SEMUA_JENIS: Jenis[] = ['sekop', 'hati', 'wajik', 'keriting'];
const SEMUA_NILAI: Nilai[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

/** Buat dek kartu remi standar (52 kartu). */
export function dekRemi(): Kartu[] {
  const out: Kartu[] = [];
  for (const j of SEMUA_JENIS) for (const n of SEMUA_NILAI) out.push({ jenis: j, nilai: n });
  return out;
}

/** Tampilkan satu kartu, mis. "♥K" atau "♠10". */
export function kartuTeks(k: Kartu): string {
  return `${SIMBOL[k.jenis]}${k.nilai}`;
}

/** Tampilkan daftar kartu. */
export function daftarKartuTeks(kartu: Kartu[]): string {
  return kartu.map(kartuTeks).join(' ');
}

/**
 * Kocok array dengan Fisher-Yates memakai sumber acak yang bisa disuntik
 * (agar bisa diuji deterministik). Tanpa bias seperti `sort(() => Math.random()-0.5)`.
 */
export function kocok<T>(arr: T[], rnd: () => number = Math.random): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Ambil n item dari depan array (mutasi array). Generik: kartu remi, UNO, domino. */
export function ambil<T>(dek: T[], n: number): T[] {
  return dek.splice(0, Math.min(n, dek.length));
}

// ============================================================================
// KARTU UNO
// ============================================================================

export type WarnaUno = 'merah' | 'kuning' | 'hijau' | 'biru';
export type KartuUno = { warna: WarnaUno | 'hitam'; nilai: string };

export const SIMBOL_WARNA: Record<string, string> = {
  merah: '🔴', kuning: '🟡', hijau: '🟢', biru: '🔵', hitam: '⚫',
};

/** Buat dek UNO standar (108 kartu): 0-9 (2x per warna), skip/reverse/+2 (2x), 4 wild, 4 wild+4. */
export function dekUno(): KartuUno[] {
  const warna: WarnaUno[] = ['merah', 'kuning', 'hijau', 'biru'];
  const out: KartuUno[] = [];
  for (const w of warna) {
    out.push({ warna: w, nilai: '0' });
    for (let n = 1; n <= 9; n++) {
      out.push({ warna: w, nilai: String(n) });
      out.push({ warna: w, nilai: String(n) });
    }
    for (const aksi of ['skip', 'reverse', '+2']) {
      out.push({ warna: w, nilai: aksi });
      out.push({ warna: w, nilai: aksi });
    }
  }
  for (let i = 0; i < 4; i++) {
    out.push({ warna: 'hitam', nilai: 'wild' });
    out.push({ warna: 'hitam', nilai: 'wild+4' });
  }
  return out;
}

export function kartuUnoTeks(k: KartuUno): string {
  return `${SIMBOL_WARNA[k.warna] ?? ''}${k.nilai}`;
}

export function daftarUnoTeks(kartu: KartuUno[]): string {
  return kartu.map(kartuUnoTeks).join(' ');
}

/** Apakah kartu `a` boleh diturunkan di atas `atas`? (aturan UNO) */
export function unoBoleh(a: KartuUno, atas: KartuUno, warnaAktif: string): boolean {
  if (a.warna === 'hitam') return true; // wild / wild+4 selalu boleh
  if (a.warna === warnaAktif) return true;
  if (a.nilai === atas.nilai) return true;
  return false;
}

// ============================================================================
// PAPAN CATUR
// ============================================================================

/**
 * Papan catur 8x8. Huruf besar = putih (pemain), huruf kecil = hitam (bot).
 * K=raja Q=menteri R=benteng B=uskup N=kuda P=pion. '.' = kosong.
 */
export type Papan = string[][];

export function papanAwal(): Papan {
  return [
    ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'],
    ['p', 'p', 'p', 'p', 'p', 'p', 'p', 'p'],
    ['.', '.', '.', '.', '.', '.', '.', '.'],
    ['.', '.', '.', '.', '.', '.', '.', '.'],
    ['.', '.', '.', '.', '.', '.', '.', '.'],
    ['.', '.', '.', '.', '.', '.', '.', '.'],
    ['P', 'P', 'P', 'P', 'P', 'P', 'P', 'P'],
    ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R'],
  ];
}

/** Render papan jadi teks (baris 8..1, kolom a..h). */
export function papanTeks(p: Papan): string {
  const garis = '  +------------------------+';
  const out: string[] = [garis];
  for (let r = 0; r < 8; r++) {
    const no = 8 - r;
    out.push(`${no} | ${p[r].map((c) => (c === '.' ? '·' : c)).join('  ')} |`);
  }
  out.push(garis);
  out.push('    a  b  c  d  e  f  g  h');
  return out.join('\n');
}

/** Ubah "e2" -> [baris, kolom]. Baris 0 = rank 8. */
export function posKe(p: string): [number, number] | null {
  const m = /^([a-h])([1-8])$/.exec(p.toLowerCase());
  if (!m) return null;
  const kol = m[1].charCodeAt(0) - 97;
  const baris = 8 - Number(m[2]);
  return [baris, kol];
}

// ============================================================================
// PAPAN HALMA (Chinese Checkers sederhana 8x8)
// ============================================================================

/** Halma 8x8: 'P' pion pemain (bawah), 'C' pion bot (atas), '.' kosong. */
export function halmaAwal(): Papan {
  const p: Papan = Array.from({ length: 8 }, () => Array(8).fill('.'));
  // Bot (atas) — bentuk piramida 3 baris
  const pola = [[0, 4], [1, 3], [1, 4], [1, 5], [2, 2], [2, 3], [2, 4], [2, 5], [2, 6]];
  for (const [r, c] of pola) p[r][c] = 'C';
  // Pemain (bawah) — cermin
  for (const [r, c] of pola) p[7 - r][7 - c] = 'P';
  return p;
}

// ============================================================================
// TIC-TAC-TOE
// ============================================================================

export type TicTac = string[]; // 9 sel: 'X' | 'O' | ''

export function ticTacAwal(): TicTac {
  return Array(9).fill('');
}

/** Cek pemenang tic-tac-toe: 'X' | 'O' | 'seri' | null */
export function ticTacPemenang(b: TicTac): string | null {
  const garis = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
  for (const [a, c, d] of garis) {
    if (b[a] && b[a] === b[c] && b[a] === b[d]) return b[a];
  }
  return b.every((x) => x) ? 'seri' : null;
}

export function ticTacTeks(b: TicTac): string {
  const sel = b.map((x, i) => (x || String(i + 1)));
  return `${sel[0]} | ${sel[1]} | ${sel[2]}\n${sel[3]} | ${sel[4]} | ${sel[5]}\n${sel[6]} | ${sel[7]} | ${sel[8]}`;
}

/** Langkah terbaik bot untuk tic-tac-toe (minimax sederhana, tidak pernah kalah). */
export function ticTacBot(b: TicTac): number {
  const kosong = b.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0);
  if (kosong.length === 0) return -1;

  const minimax = (papan: TicTac, giliran: 'O' | 'X', dalam: number): { skor: number; langkah: number } => {
    const p = ticTacPemenang(papan);
    if (p === 'O') return { skor: 10 - dalam, langkah: -1 };
    if (p === 'X') return { skor: dalam - 10, langkah: -1 };
    if (p === 'seri') return { skor: 0, langkah: -1 };

    let terbaik = { skor: giliran === 'O' ? -99 : 99, langkah: -1 };
    for (let i = 0; i < 9; i++) {
      if (papan[i]) continue;
      papan[i] = giliran;
      const h = minimax(papan, giliran === 'O' ? 'X' : 'O', dalam + 1);
      papan[i] = '';
      if (giliran === 'O' ? h.skor > terbaik.skor : h.skor < terbaik.skor) {
        terbaik = { skor: h.skor, langkah: i };
      }
    }
    return terbaik;
  };
  return minimax([...b], 'O', 0).langkah;
}

// ============================================================================
// HANGMAN
// ============================================================================

export const KATA_HANGMAN = [
  'komputer', 'sepeda', 'gunung', 'lautan', 'bintang', 'kucing', 'sekolah',
  'pelangi', 'jendela', 'kembang', 'harimau', 'pesawat', 'kereta', 'sawah',
  'nelayan', 'pulau', 'hutan', 'mentari', 'awan', 'buku', 'pensil', 'sepatu',
];

export function hangmanTeks(kata: string, terbuka: string[], salah: string[], nyawa: number): string {
  const tampil = kata.split('').map((c) => (terbuka.includes(c) ? c : '_')).join(' ');
  const gantung = ['😐', '😟', '😰', '😨', '😱', '💀'][Math.max(0, 5 - nyawa)] ?? '💀';
  return `Kata: ${tampil}\nSalah: ${salah.join(' ') || '-'}\nNyawa: ${'❤️'.repeat(nyawa)} ${gantung}`;
}

// ============================================================================
// REGISTRY PERMAINAN
// ============================================================================

/** Daftar permainan yang didukung + alias pemicu. */
export const DAFTAR_GAME: Array<{ kind: string; nama: string; alias: RegExp }> = [
  { kind: 'uno',        nama: 'UNO',                alias: /\buno\b/i },
  { kind: 'capsa',      nama: 'Capsa Banting',      alias: /\b(?:capsa|banting)\b/i },
  { kind: 'remi',       nama: 'Remi',               alias: /\b(?:remi|gin\s*rummy|ginrummy)\b/i },
  { kind: 'cangkulan',  nama: 'Cangkulan',          alias: /\b(?:cangkulan|cangkul)\b/i },
  { kind: 'gaple',      nama: 'Gaple (Domino)',     alias: /\b(?:gaple|domino)\b/i },
  { kind: 'qiuqiu',     nama: 'Domino Qiu-Qiu',     alias: /\b(?:qiu\s*-?\s*qiu|kiu\s*-?\s*kiu)\b/i },
  { kind: 'catur',      nama: 'Catur',              alias: /\b(?:catur|chess)\b/i },
  { kind: 'halma',      nama: 'Halma',              alias: /\bhalma\b/i },
  { kind: 'tictactoe',  nama: 'Tic-Tac-Toe',        alias: /\b(?:tic\s*tac\s*toe|tictactoe|tiga\s*berbaris|x\s*o)\b/i },
  { kind: 'hangman',    nama: 'Tebak Kata',         alias: /\b(?:hangman|tebak\s*kata|tebak\s*huruf)\b/i },
  { kind: 'tebakangka', nama: 'Tebak Angka',        alias: /\b(?:tebak\s*angka|guess\s*number|tebak\s*nomor)\b/i },
  { kind: 'dadu',       nama: 'Dadu (adu angka)',   alias: /\b(?:dadu|adu\s*angka|lempar\s*dadu)\b/i },
  { kind: 'batu',       nama: 'Batu-Gunting-Kertas', alias: /\b(?:batu\s*gunting|gunting\s*kertas|suit|janken)\b/i },
  { kind: 'monopoli',   nama: 'Monopoli (versi dadu)', alias: /\b(?:monopoli|monopoly)\b/i },
  { kind: 'suitjawa',   nama: 'Suit Jawa',          alias: /\b(?:suit\s*jawa)\b/i },
  { kind: 'kuis',       nama: 'Kuis Pengetahuan',   alias: /\b(?:kuis|quiz|trivia)\b/i },
];

/** Cari permainan dari teks. */
export function cariGame(teks: string): { kind: string; nama: string } | null {
  for (const g of DAFTAR_GAME) {
    if (g.alias.test(teks)) return { kind: g.kind, nama: g.nama };
  }
  return null;
}

/** Apakah teks minta BERHENTI dari permainan? */
export function mintaBerhenti(teks: string): boolean {
  return /\b(?:berhenti|stop|cukup|udahan|selesai|nyerah|gak\s*lanjut|ga\s*lanjut|keluar|quit|udah\s*ah|ganti\s*game|main\s*lain)\b/i.test(teks);
}
