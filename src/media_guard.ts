/**
 * PENJAGA BERKAS — pertahanan berlapis untuk unggahan pengguna.
 *
 * LATAR BELAKANG (audit keamanan 06 Okt 2026, parameter #18):
 * Proyek ini TIDAK memakai antivirus/ClamAV. Itu dapat diterima karena:
 *   1. Berkas TIDAK PERNAH disimpan ke disk — hanya dibaca di memori (RAM).
 *   2. Berkas TIDAK PERNAH dieksekusi.
 *   3. Berkas TIDAK PERNAH disajikan kembali ke publik.
 *   4. Ukuran dibatasi (15 MB) + dekompresi dibatasi (5 MB) -> anti zip-bomb.
 *   5. Tipe MIME diverifikasi dari MAGIC BYTES, bukan ekstensi.
 *
 * Modul ini MENAMBAH lapisan keamanan tanpa dependensi eksternal:
 *   - Daftar hitam ekstensi yang bisa dieksekusi (executable).
 *   - Deteksi magic bytes executable (MZ/PE, ELF, Mach-O, script shebang).
 *
 * KENAPA PENTING: meski berkas tidak dieksekusi di server ini, menolaknya lebih
 * awal mencegah (a) berkas berbahaya diteruskan ke layanan lain di masa depan,
 * dan (b) eksploitasi celah parser (mis. kerentanan di library pembaca dokumen).
 */

/** Ekstensi yang DITOLAK mentah-mentah (bisa dieksekusi / berbahaya). */
const EKSTENSI_TERLARANG = new Set([
  // Windows executable & installer
  'exe', 'msi', 'bat', 'cmd', 'com', 'scr', 'pif', 'cpl', 'dll', 'sys', 'drv',
  // Script yang bisa dijalankan
  'sh', 'bash', 'zsh', 'ksh', 'csh', 'ps1', 'psm1', 'vbs', 'vbe', 'js', 'jse',
  'wsf', 'wsh', 'hta', 'jar', 'app', 'action', 'workflow',
  // Unix executable / paket
  'elf', 'bin', 'run', 'deb', 'rpm', 'apk', 'dmg', 'pkg',
  // Lain-lain
  'lnk', 'reg', 'inf', 'scf', 'chm', 'ade', 'adp', 'msp', 'mst', 'gadget',
  'crt', 'ins', 'isp', 'job', 'ws', 'msc',
]);

/** Cek magic bytes berbahaya pada awal buffer. */
export function adaMagicBytesBerbahaya(buf: Buffer): string | null {
  if (!buf || buf.length < 2) return null;

  // Windows PE / DOS executable: "MZ"
  if (buf[0] === 0x4d && buf[1] === 0x5a) return 'PE/DOS executable (MZ)';
  // Linux ELF: 0x7F 'E' 'L' 'F'
  if (buf[0] === 0x7f && buf[1] === 0x45 && buf[2] === 0x4c && buf[3] === 0x46) return 'ELF executable';
  // Mach-O (macOS): 0xFEEDFACE / 0xFEEDFACF / 0xCAFEBABE
  if (buf[0] === 0xfe && buf[1] === 0xed && (buf[2] === 0xfa || buf[2] === 0xfa)) return 'Mach-O executable';
  if (buf[0] === 0xca && buf[1] === 0xfe && buf[2] === 0xba && buf[3] === 0xbe) return 'Mach-O (fat) executable';
  // Java class: 0xCAFEBABE (sama dengan di atas, tapi beda konteks) — tetap ditolak.
  // Script shebang: "#!"
  if (buf[0] === 0x23 && buf[1] === 0x21) return 'Script shebang (#!)';

  return null;
}

/**
 * Periksa apakah berkas layak diproses.
 * @returns `{ boleh: true }` bila aman, atau `{ boleh: false, alasan }` bila ditolak.
 */
export function periksaBerkasAman(
  filename: string,
  buffer: Buffer,
): { boleh: boolean; alasan?: string } {
  // 1. Ekstensi terlarang
  const titik = filename.lastIndexOf('.');
  const ekstensi = titik >= 0 ? filename.slice(titik + 1).toLowerCase() : '';
  if (ekstensi && EKSTENSI_TERLARANG.has(ekstensi)) {
    return { boleh: false, alasan: `Ekstensi .${ekstensi} diblokir (berpotensi dieksekusi).` };
  }

  // 2. Path traversal: tolak "..", garis miring "/" maupun backslash "\".
  //    (Bug ditemukan oleh test otomatis 06 Okt 2026: regex sebelumnya hanya
  //     menangkap "/", sehingga "folder\\file.txt" lolos.)
  const adaPemisah = filename.includes('/') || filename.includes('\\');
  if (filename.includes('..') || adaPemisah) {
    return { boleh: false, alasan: 'Nama berkas memuat jalur direktori (tidak diizinkan).' };
  }

  // 3. Magic bytes berbahaya
  const magic = adaMagicBytesBerbahaya(buffer);
  if (magic) {
    return { boleh: false, alasan: `Isi berkas terdeteksi sebagai ${magic}.` };
  }

  return { boleh: true };
}

/** Ekspor daftar untuk keperluan uji/dokumentasi. */
export const DAFTAR_EKSTENSI_TERLARANG = Array.from(EKSTENSI_TERLARANG).sort();
