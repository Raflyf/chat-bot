import { config } from './env.js';
import { autoReply, describeImage, sanitizeAssistantOutput, continueIfTruncated } from './skills.js';
import { chat, geminiThinkingConfig } from './providers.js';
import type { ChatContext } from './memory.js';
import { keyUsed, isKeyAllowed, keyTokensUsed } from './quota.js';
import { getOrderedKeys } from './providers.js';
import mammoth from 'mammoth';
import zlib from 'node:zlib';
import { periksaBerkasAman } from './media_guard.js';

// ============================================================================
// PARSER EXCEL (.xlsx / .xlsm) TANPA DEPENDENSI EKSTERNAL
//
// KENAPA tidak memakai paket `xlsx` (SheetJS): versi terakhir yang tersedia di
// npm registry adalah 0.18.5 dan membawa DUA kerentanan tingkat tinggi tanpa
// perbaikan (Prototype Pollution GHSA-4r6h-8v6p-xvw6, ReDoS GHSA-5pgg-2g8v-p4x9).
// Bot ini menerima berkas dari pengguna umum, jadi memasang parser ber-CVE tinggi
// untuk membaca spreadsheet adalah pertukaran yang buruk.
//
// Sebagai gantinya, .xlsx dibaca langsung: berkasnya adalah arsip ZIP berisi XML.
// Yang dibutuhkan hanya tiga bagian:
//   xl/sharedStrings.xml  -> tabel string bersama (sel bertipe "s" menunjuk ke sini)
//   xl/worksheets/sheet1.xml -> isi sel (nilai + koordinat kolom/baris)
//   xl/workbook.xml       -> nama tiap sheet agar output terbaca manusia
// Ekstraksi ZIP dilakukan dengan membaca entri terpusat (central directory) dan
// meng-inflate tiap entri memakai zlib bawaan Node — tanpa paket pihak ketiga.
// ============================================================================

/** Cari entri di arsip ZIP berdasarkan nama, kembalikan isinya (sudah di-inflate). */
function zipEntry(buf: Buffer, nama: string): Buffer | null {
  // Cari End of Central Directory (EOCD): tanda 0x06054b50, dipindai dari belakang.
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 66000; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return null;
  const jumlahEntri = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16); // offset awal central directory

  for (let n = 0; n < jumlahEntri; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) break;
    const metode = buf.readUInt16LE(p + 10);
    const ukuranKompres = buf.readUInt32LE(p + 20);
    const panjangNama = buf.readUInt16LE(p + 28);
    const panjangExtra = buf.readUInt16LE(p + 30);
    const panjangKomentar = buf.readUInt16LE(p + 32);
    const offsetLokal = buf.readUInt32LE(p + 42);
    const namaEntri = buf.toString('utf8', p + 46, p + 46 + panjangNama);

    if (namaEntri === nama) {
      // Header lokal: lewati nama + extra field untuk menemukan awal data.
      const lNama = buf.readUInt16LE(offsetLokal + 26);
      const lExtra = buf.readUInt16LE(offsetLokal + 28);
      const mulai = offsetLokal + 30 + lNama + lExtra;
      const data = buf.subarray(mulai, mulai + ukuranKompres);
      if (metode === 0) return Buffer.from(data); // disimpan apa adanya
      try {
        return zlib.inflateRawSync(data);
      } catch {
        return null;
      }
    }
    p += 46 + panjangNama + panjangExtra + panjangKomentar;
  }
  return null;
}

/** Ambil semua teks di dalam <t>...</t>, sekaligus decode entitas XML dasar. */
function xmlDecode(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&');
}

/** Baca xl/sharedStrings.xml -> array string (indeks = nomor string bersama). */
function bacaSharedStrings(buf: Buffer): string[] {
  const xml = zipEntry(buf, 'xl/sharedStrings.xml');
  if (!xml) return [];
  const teks = xml.toString('utf8');
  const out: string[] = [];
  // Tiap <si> adalah satu string; di dalamnya bisa ada beberapa <t> (rich text).
  const reSi = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let m: RegExpExecArray | null;
  while ((m = reSi.exec(teks)) !== null) {
    const bagian = m[1];
    let gabung = '';
    const reT = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
    let t: RegExpExecArray | null;
    while ((t = reT.exec(bagian)) !== null) gabung += xmlDecode(t[1]);
    out.push(gabung);
  }
  return out;
}

/** Ubah referensi kolom Excel (A, B, ..., AA) menjadi indeks angka (0-based). */
function kolomKeIndeks(ref: string): number {
  const huruf = ref.replace(/[^A-Z]/gi, '').toUpperCase();
  let n = 0;
  for (const c of huruf) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

/**
 * PARSER FORMAT LAMA MICROSOFT (OLE2 / Compound File Binary)
 * DITAMBAHKAN 04 Okt — sebelumnya .doc dan .xls TIDAK didukung sama sekali.
 *
 * Kenapa bisa tanpa library eksternal: .doc/.xls lama memakai format OLE2
 * (signature D0CF11E0A1B11AE1) — sebuah "filesystem dalam berkas" dengan
 * header, tabel FAT, direktori, dan stream. Strukturnya terdokumentasi
 * (MS-CFB) sehingga bisa dibaca langsung dari Buffer.
 *
 * .doc  -> stream "WordDocument" + "0Table"/"1Table" (piece table CLX)
 * .xls  -> stream "Workbook"/"Book" (record BIFF8: SST, LABELSST, NUMBER, RK)
 *
 * Keduanya diuji dengan berkas ASLI buatan Microsoft Office (bukan tiruan):
 *   .doc -> "Laporan Penjualan Kayu Jati - Total 500 juta rupiah"
 *   .xls -> "Barang\tHarga\nKayu Jati\t50000"
 */
interface OleEntri {
  nama: string;
  tipe: number;
  startSector: number;
  ukuran: number;
}

function bacaOle(buf: Buffer): { entri: OleEntri[]; bacaStream: (e: OleEntri) => Buffer; sectorSize: number } | null {
  const SIG = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  if (!buf.subarray(0, 8).equals(SIG)) return null;

  const sectorShift = buf.readUInt16LE(30);
  const miniShift = buf.readUInt16LE(32);
  const sectorSize = 1 << sectorShift;
  const miniSize = 1 << miniShift;
  const numFatSectors = buf.readUInt32LE(44);
  const dirStart = buf.readUInt32LE(48);
  const miniCutoff = buf.readUInt32LE(56);
  const miniFatStart = buf.readUInt32LE(60);
  const numMiniFat = buf.readUInt32LE(64);
  const difStart = buf.readUInt32LE(68);
  const numDif = buf.readUInt32LE(72);

  const offsetSektor = (s: number): number => (s + 1) * sectorSize;

  // --- Kumpulkan daftar sektor FAT (termasuk DIF chain) ---
  const fatSectors = [];
  for (let i = 0; i < 109 && fatSectors.length < numFatSectors; i++) {
    const s = buf.readUInt32LE(76 + i * 4);
    if (s !== 0xffffffff) fatSectors.push(s);
  }
  let dif = difStart;
  for (let n = 0; n < numDif && dif !== 0xfffffffe && dif !== 0xffffffff; n++) {
    const base = offsetSektor(dif);
    for (let i = 0; i < sectorSize / 4 - 1; i++) {
      const s = buf.readUInt32LE(base + i * 4);
      if (s !== 0xffffffff && fatSectors.length < numFatSectors) fatSectors.push(s);
    }
    dif = buf.readUInt32LE(base + sectorSize - 4);
  }

  // --- Bangun tabel FAT ---
  const fat: number[] = [];
  for (const s of fatSectors) {
    const base = offsetSektor(s);
    for (let i = 0; i < sectorSize / 4; i++) fat.push(buf.readUInt32LE(base + i * 4));
  }

  // --- Baca rantai sektor ---
  function bacaRantai(start: number, ukuran?: number): Buffer {
    const bagian: Buffer[] = [];
    let s = start;
    let sisa = ukuran === undefined ? Infinity : ukuran;
    const terlihat = new Set<number>();
    while (s !== 0xfffffffe && s !== 0xffffffff && s < fat.length && sisa > 0) {
      if (terlihat.has(s)) break;
      terlihat.add(s);
      const base = offsetSektor(s);
      const potong = ukuran === undefined ? sectorSize : Math.min(sectorSize, sisa);
      bagian.push(buf.subarray(base, base + potong));
      sisa -= potong;
      s = fat[s];
    }
    return Buffer.concat(bagian);
  }

  // --- Direktori ---
  const dirBuf = bacaRantai(dirStart);
  const entri: OleEntri[] = [];
  for (let i = 0; i + 128 <= dirBuf.length; i += 128) {
    const namaLen = dirBuf.readUInt16LE(i + 64);
    if (namaLen < 2 || namaLen > 64) continue;
    const nama = dirBuf.toString('utf16le', i, i + namaLen - 2);
    const tipe = dirBuf[i + 66];
    const startSector = dirBuf.readUInt32LE(i + 116);
    const ukuran = dirBuf.readUInt32LE(i + 120);
    if (tipe === 2 || tipe === 5) entri.push({ nama, tipe, startSector, ukuran });
  }

  // --- Mini FAT (untuk stream < miniCutoff) ---
  const miniFat: number[] = [];
  if (miniFatStart !== 0xfffffffe && numMiniFat > 0) {
    const mf = bacaRantai(miniFatStart);
    for (let i = 0; i + 4 <= mf.length; i += 4) miniFat.push(mf.readUInt32LE(i));
  }
  const root = entri.find((e) => e.tipe === 5);
  const miniStream = root ? bacaRantai(root.startSector, root.ukuran) : Buffer.alloc(0);

  function bacaStream(e: OleEntri): Buffer {
    if (e.ukuran < miniCutoff && miniFat.length) {
      const bagian: Buffer[] = [];
      let s = e.startSector;
      let sisa = e.ukuran;
      const terlihat = new Set<number>();
      while (s !== 0xfffffffe && s !== 0xffffffff && s < miniFat.length && sisa > 0) {
        if (terlihat.has(s)) break;
        terlihat.add(s);
        const base = s * miniSize;
        const potong = Math.min(miniSize, sisa);
        bagian.push(miniStream.subarray(base, base + potong));
        sisa -= potong;
        s = miniFat[s];
      }
      return Buffer.concat(bagian);
    }
    return bacaRantai(e.startSector, e.ukuran);
  }

  return { entri, bacaStream, sectorSize };
}

// ---------- .DOC ----------
function bacaDoc(buf: Buffer): string | null {
  const ole = bacaOle(buf);
  if (!ole) return null;
  // Stream teks ada di "WordDocument" (FIB + teks). Teks biasanya UTF-16LE atau CP1252.
  const wd = ole.entri.find((e) => e.nama === 'WordDocument');
  if (!wd) return null;
  const data = ole.bacaStream(wd);

  // FIB: offset 0x000A = flags; bit fWhichTblStm (0x0200) -> 1Table/0Table
  const flags = data.readUInt16LE(0x000a);
  const pakai1Table = (flags & 0x0200) !== 0;
  const tblName = pakai1Table ? '1Table' : '0Table';
  const tbl = ole.entri.find((e) => e.nama === tblName);

  // fcMin/fcMac di FIB (offset 0x0018/0x001C) — teks utama
  const fcMin = data.readUInt32LE(0x0018);
  const fcMac = data.readUInt32LE(0x001c);

  let hasil = '';
  if (tbl) {
    const t = ole.bacaStream(tbl);
    // Cari CLX (piece table) — fcClx/lcbClx di FIB offset 0x01A2/0x01A6
    if (data.length > 0x01a6) {
      const fcClx = data.readUInt32LE(0x01a2);
      const lcbClx = data.readUInt32LE(0x01a6);
      if (fcClx > 0 && lcbClx > 0 && fcClx + lcbClx <= t.length) {
        const clx = t.subarray(fcClx, fcClx + lcbClx);
        // Lewati Prc (0x01) sampai Pcdt (0x02)
        let p = 0;
        while (p < clx.length && clx[p] === 0x01) {
          const cb = clx.readUInt16LE(p + 1);
          p += 3 + cb;
        }
        if (p < clx.length && clx[p] === 0x02) {
          const lcb = clx.readUInt32LE(p + 1);
          const pcdt = clx.subarray(p + 5, p + 5 + lcb);
          // PlcPcd: n+1 CP (4 byte) lalu n PCD (8 byte)
          const n = Math.floor((pcdt.length - 4) / 12);
          for (let i = 0; i < n; i++) {
            const pcdOff = (n + 1) * 4 + i * 8;
            if (pcdOff + 8 > pcdt.length) break;
            const fc = pcdt.readUInt32LE(pcdOff + 2);
            const cpStart = pcdt.readUInt32LE(i * 4);
            const cpEnd = pcdt.readUInt32LE((i + 1) * 4);
            const jmlChar = cpEnd - cpStart;
            const kompres = (fc & 0x40000000) !== 0;
            const fcNyata = kompres ? (fc & 0x3fffffff) / 2 : fc & 0x3fffffff;
            if (kompres) {
              hasil += data.toString('latin1', fcNyata, fcNyata + jmlChar);
            } else {
              hasil += data.toString('utf16le', fcNyata, fcNyata + jmlChar * 2);
            }
          }
        }
      }
    }
  }

  // Cadangan: teks mentah antara fcMin..fcMac
  if (!hasil.trim() && fcMac > fcMin && fcMac <= data.length) {
    hasil = data.toString('utf16le', fcMin, fcMac);
  }

  return hasil.replace(/\r/g, '\n').replace(/\x00/g, '').trim() || null;
}

// ---------- .XLS ----------
function bacaXls(buf: Buffer): string | null {
  const ole = bacaOle(buf);
  if (!ole) return null;
  const wb = ole.entri.find((e) => e.nama === 'Workbook' || e.nama === 'Book');
  if (!wb) return null;
  const data = ole.bacaStream(wb);

  // BIFF8: kumpulkan SST (shared strings) + angka per sel.
  const sst = [];
  const baris = new Map(); // row -> Map(col -> nilai)
  let p = 0;
  while (p + 4 <= data.length) {
    const rec = data.readUInt16LE(p);
    const len = data.readUInt16LE(p + 2);
    const isi = data.subarray(p + 4, p + 4 + len);
    if (rec === 0x00fc && isi.length >= 8) {
      // SST
      const total = isi.readUInt32LE(4);
      let q = 8;
      for (let i = 0; i < total && q + 3 <= isi.length; i++) {
        const cch = isi.readUInt16LE(q);
        const grbit = isi[q + 2];
        q += 3;
        const rich = (grbit & 0x08) !== 0;
        const farEast = (grbit & 0x04) !== 0;
        const kompres = (grbit & 0x01) === 0;
        if (rich) { const cRun = isi.readUInt16LE(q); q += 2 + cRun * 4; }
        if (farEast) { const cbExt = isi.readUInt32LE(q); q += 4 + cbExt; }
        const byteLen = kompres ? cch : cch * 2;
        const teks = kompres ? isi.toString('latin1', q, q + cch) : isi.toString('utf16le', q, q + byteLen);
        sst.push(teks);
        q += byteLen;
      }
    } else if (rec === 0x00fd && isi.length >= 10) {
      // LABELSST
      const row = isi.readUInt16LE(0);
      const col = isi.readUInt16LE(2);
      const idx = isi.readUInt32LE(6);
      if (!baris.has(row)) baris.set(row, new Map());
      baris.get(row).set(col, sst[idx] ?? '');
    } else if (rec === 0x0203 && isi.length >= 14) {
      // NUMBER
      const row = isi.readUInt16LE(0);
      const col = isi.readUInt16LE(2);
      const val = isi.readDoubleLE(6);
      if (!baris.has(row)) baris.set(row, new Map());
      baris.get(row).set(col, String(val));
    } else if (rec === 0x027e && isi.length >= 10) {
      // RK
      const row = isi.readUInt16LE(0);
      const col = isi.readUInt16LE(2);
      const rk = isi.readUInt32LE(6);
      let val;
      if (rk & 0x02) val = rk >> 2;
      else {
        const b = Buffer.alloc(8);
        b.writeUInt32LE(0, 0); b.writeUInt32LE(rk & 0xfffffffc, 4);
        val = b.readDoubleLE(0);
      }
      if (rk & 0x01) val = val / 100;
      if (!baris.has(row)) baris.set(row, new Map());
      baris.get(row).set(col, String(val));
    }
    if (len === 0 && rec === 0) break;
    p += 4 + len;
  }

  const keluaran = [];
  const rowNums = [...baris.keys()].sort((a, b) => a - b);
  for (const r of rowNums) {
    const kolom = baris.get(r);
    const maxCol = Math.max(...kolom.keys());
    const sel = [];
    for (let c = 0; c <= maxCol; c++) sel.push(kolom.get(c) ?? '');
    if (sel.some((x) => x !== '')) keluaran.push(sel.join('\t'));
  }
  return keluaran.length ? keluaran.join('\n') : null;
}

/**
 * Ekstrak isi .pptx (PowerPoint) menjadi teks per slide.
 * Format .pptx sama seperti .docx/.xlsx: arsip ZIP berisi XML. Teks tiap slide
 * ada di ppt/slides/slideN.xml dalam tag <a:t>...</a:t>.
 *
 * DITAMBAHKAN 04 Okt: sebelumnya .pptx TIDAK didukung (jatuh ke jalur "tidak
 * didukung"). Parser ini menutup celah itu tanpa dependensi baru (memakai
 * zipEntry + inflateRawSync yang sudah ada).
 */
function bacaPptx(buffer: Buffer): string | null {
  const bagian: string[] = [];
  // Slide biasanya slide1..slideN (bisa tidak berurutan di arsip, tapi umumnya ada).
  for (let idx = 1; idx <= 60; idx++) {
    const xml = zipEntry(buffer, `ppt/slides/slide${idx}.xml`);
    if (!xml) continue;
    const teks = xml.toString('utf8');
    const potongan: string[] = [];
    const reT = /<a:t>([\s\S]*?)<\/a:t>/g;
    let m: RegExpExecArray | null;
    while ((m = reT.exec(teks)) !== null) {
      const t = xmlDecode(m[1]).trim();
      if (t) potongan.push(t);
    }
    if (potongan.length > 0) {
      bagian.push(`### Slide ${idx}\n${potongan.join('\n')}`);
    }
  }
  // Catatan pembicara (notes) bila ada — sering memuat konteks penting.
  for (let idx = 1; idx <= 60; idx++) {
    const xml = zipEntry(buffer, `ppt/notesSlides/notesSlide${idx}.xml`);
    if (!xml) continue;
    const teks = xml.toString('utf8');
    const potongan: string[] = [];
    const reT = /<a:t>([\s\S]*?)<\/a:t>/g;
    let m: RegExpExecArray | null;
    while ((m = reT.exec(teks)) !== null) {
      const t = xmlDecode(m[1]).trim();
      if (t) potongan.push(t);
    }
    // notesSlide memuat nomor slide juga; buang yang hanya angka.
    const isi = potongan.filter((x) => !/^\d+$/.test(x));
    if (isi.length > 0) bagian.push(`### Catatan Slide ${idx}\n${isi.join('\n')}`);
  }
  return bagian.length > 0 ? bagian.join('\n\n') : null;
}

/**
 * Ekstrak isi .xlsx menjadi teks tab-separated (per sheet).
 * Angka diformat apa adanya; tanggal dikembalikan sebagai serial Excel + catatan,
 * karena konversi serial->tanggal butuh tabel format yang tidak ada di XML mentah.
 */
function bacaXlsx(buffer: Buffer): string | null {
  // Daftar nama sheet dari workbook.xml (urutan sesuai r:id).
  const wb = zipEntry(buffer, 'xl/workbook.xml');
  const namaSheet: string[] = [];
  if (wb) {
    const re = /<sheet\b[^>]*\bname="([^"]*)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(wb.toString('utf8'))) !== null) namaSheet.push(xmlDecode(m[1]));
  }

  const shared = bacaSharedStrings(buffer);
  const keluaran: string[] = [];

  // Coba sheet1..sheet20 sampai tidak ditemukan lagi.
  for (let idx = 1; idx <= 20; idx++) {
    const xml = zipEntry(buffer, `xl/worksheets/sheet${idx}.xml`);
    if (!xml) break;
    const teks = xml.toString('utf8');
    const baris: string[][] = [];
    const reRow = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
    let r: RegExpExecArray | null;

    while ((r = reRow.exec(teks)) !== null) {
      const sel: string[] = [];
      // Tiap <c r="A1" t="s"><v>12</v></c>  (t="s" = string bersama, t="inlineStr" = teks langsung)
      const reC = /<c\b([^>]*)>([\s\S]*?)<\/c>/g;
      let c: RegExpExecArray | null;
      while ((c = reC.exec(r[1])) !== null) {
        const atribut = c[1];
        const isi = c[2];
        const refMatch = /\br="([A-Z]+\d+)"/.exec(atribut);
        const kolom = refMatch ? kolomKeIndeks(refMatch[1]) : sel.length;
        const tipe = /\bt="([^"]+)"/.exec(atribut)?.[1] || '';

        let nilai = '';
        if (tipe === 's') {
          const v = /<v>([\s\S]*?)<\/v>/.exec(isi);
          const i = v ? Number(v[1]) : NaN;
          nilai = Number.isFinite(i) && shared[i] !== undefined ? shared[i] : '';
        } else if (tipe === 'inlineStr') {
          const reT = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
          let t: RegExpExecArray | null;
          while ((t = reT.exec(isi)) !== null) nilai += xmlDecode(t[1]);
        } else {
          const v = /<v>([\s\S]*?)<\/v>/.exec(isi);
          nilai = v ? xmlDecode(v[1]) : '';
        }
        // Isi celah kolom dengan string kosong agar kolom tetap sejajar.
        while (sel.length < kolom) sel.push('');
        sel[kolom] = nilai;
      }
      if (sel.some((s) => s !== '')) baris.push(sel);
    }

    if (baris.length > 0) {
      const nama = namaSheet[idx - 1] || `Sheet${idx}`;
      keluaran.push(`### ${nama}`);
      for (const b of baris) keluaran.push(b.join('\t'));
      keluaran.push('');
    }
  }

  return keluaran.length > 0 ? keluaran.join('\n').trim() : null;
}

/** Helper transkripsi via Groq Whisper API */
async function transcribeViaGroq(buffer: Buffer, mime: string, model: string): Promise<string | null> {
  const rawKeys = config.pools.groq;
  if (!rawKeys || rawKeys.length === 0) return null;
  // Rotasi key (round-robin) agar beban merata — berlaku untuk SEMUA endpoint.
  const keys = getOrderedKeys('groq', rawKeys);

  let ext = 'ogg';
  if (mime.includes('mp4') || mime.includes('m4a')) ext = 'm4a';
  else if (mime.includes('wav')) ext = 'wav';
  else if (mime.includes('mp3') || mime.includes('mpeg')) ext = 'mp3';
  const filename = `voice.${ext}`;
  const u8Array = new Uint8Array(buffer);

  for (const key of keys) {
    if (!(await isKeyAllowed('groq', key, config.dailyCap.groq))) continue;
    try {
      const formData = new FormData();
      formData.append('file', new Blob([u8Array], { type: mime }), filename);
      formData.append('model', model);
      formData.append('response_format', 'json');

      const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}` },
        body: formData,
        signal: AbortSignal.timeout(config.downloadTimeoutMs || 20000),
      });

      if (!res.ok) continue;
      const data = (await res.json()) as { text?: string };
      if (data.text && data.text.trim()) {
        // Catat pemakaian kuota Groq (Whisper memakai kuota provider yang sama).
        // Whisper dibatasi ASH/ASD (audio seconds), bukan TPD token, jadi hanya call count.
        keyUsed('groq', key);
        return data.text.trim();
      }
    } catch (err) {
      console.warn(`[media] Groq transkripsi [${model}] gagal:`, err);
    }
  }
  return null;
}

/** Helper transkripsi audio via Google Gemini Multimodal API */
async function transcribeViaGemini(buffer: Buffer, mime: string, model: string): Promise<string | null> {
  const rawKeys = config.pools.gemini;
  if (!rawKeys || rawKeys.length === 0) return null;
  const keys = getOrderedKeys('gemini', rawKeys);

  for (const key of keys) {
    if (!(await isKeyAllowed('gemini', key, config.dailyCap.gemini))) continue;
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(config.downloadTimeoutMs || 20000),
        body: JSON.stringify({
          contents: [{
            role: 'user',
            parts: [
              { inlineData: { mimeType: mime, data: buffer.toString('base64') } },
              { text: 'Transkripsikan isi rekaman suara ini persis kata demi kata dalam Bahasa Indonesia tanpa komentar tambahan. Tuliskan teks transkripsinya saja.' }
            ]
          }],
          generationConfig: { temperature: 0.1, ...geminiThinkingConfig(model) }
        })
      });

      if (!res.ok) continue;
      const data = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        usageMetadata?: { totalTokenCount?: number };
      };
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      if (text) {
        // Catat pemakaian kuota Gemini (transkripsi audio memakai kuota provider yang sama)
        keyUsed('gemini', key);
        if (data.usageMetadata?.totalTokenCount) {
          keyTokensUsed('gemini', key, Number(data.usageMetadata.totalTokenCount) || 0);
        }
        return text;
      }
    } catch (err) {
      console.warn(`[media] Gemini audio [${model}] gagal:`, err);
    }
  }
  return null;
}

/** Helper transkripsi audio via Cloudflare Workers AI Whisper (endpoint native /ai/run). */
async function transcribeViaCloudflare(buffer: Buffer, model: string): Promise<string | null> {
  const rawKeys = config.pools.cloudflare;
  if (!rawKeys || rawKeys.length === 0) return null;
  const keys = getOrderedKeys('cloudflare', rawKeys);

  for (const rawKey of keys) {
    if (!(await isKeyAllowed('cloudflare', rawKey, config.dailyCap.cloudflare))) continue;
    const accountId = rawKey.includes(':')
      ? rawKey.slice(0, rawKey.indexOf(':')).trim()
      : (config.cloudflareAccountId || '').trim();
    const token = rawKey.includes(':') ? rawKey.slice(rawKey.indexOf(':') + 1).trim() : rawKey.trim();
    if (!accountId) continue;
    try {
      const res = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ audio: buffer.toString('base64') }),
          signal: AbortSignal.timeout(config.downloadTimeoutMs || 20000),
        },
      );
      if (!res.ok) continue;
      const data = (await res.json()) as { result?: { text?: string } };
      const text = data.result?.text?.trim();
      if (text) {
        keyUsed('cloudflare', rawKey);
        return text;
      }
    } catch (err) {
      console.warn(`[media] Cloudflare transkripsi [${model}] gagal:`, err);
    }
  }
  return null;
}

/**
 * Transkripsi audio / Voice Note (VN) WhatsApp & Telegram:
 * - Primary: whisper-large-v3 (Groq)
 * - Cadangan 1: whisper-large-v3-turbo (Cloudflare Workers AI, endpoint native)
 * - Cadangan 2: whisper-large-v3-turbo (Groq)
 * - Cadangan 3: Gemini native audio (3.5 Flash Lite > 2.5 Flash)
 */
export async function transcribeAudio(buffer: Buffer, mime: string = 'audio/ogg'): Promise<string> {
  // 1. Primary: Groq whisper-large-v3
  const t1 = await transcribeViaGroq(buffer, mime, 'whisper-large-v3');
  if (t1) return t1;

  // 2. Cadangan 1: Cloudflare Whisper (pool & kuota berbeda dari Groq)
  const t2 = await transcribeViaCloudflare(buffer, '@cf/openai/whisper-large-v3-turbo');
  if (t2) return t2;

  // 3. Cadangan 2: Groq whisper-large-v3-turbo
  const t3 = await transcribeViaGroq(buffer, mime, 'whisper-large-v3-turbo');
  if (t3) return t3;

  // 4. Cadangan 3: Gemini native audio
  for (const model of config.models.geminiVision) {
    const t = await transcribeViaGemini(buffer, mime, model);
    if (t) return t;
  }

  throw new Error('TRANSCRIPTION_ALL_KEYS_FAILED');
}

/**
 * Ekstraksi teks dari PDF sederhana (uncompressed stream atau FlateDecode stream).
 */
export function extractPdfTextSimple(buffer: Buffer): string | null {
  try {
    let fullText = '';
    const content = buffer.toString('binary');
    const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
    let match: RegExpExecArray | null;
    while ((match = streamRegex.exec(content)) !== null) {
      const streamData = match[1];
      let decompressed = streamData;
      try {
        decompressed = zlib.inflateSync(Buffer.from(streamData, 'binary'), { maxOutputLength: 5 * 1024 * 1024 }).toString('utf-8');
      } catch {
        // stream mungkin uncompressed teks polos
      }
      const textMatches = decompressed.matchAll(/\(([^)]+)\)\s*Tj/g);
      for (const tm of textMatches) {
        fullText += tm[1] + ' ';
        if (fullText.length > 300000) break;
      }
      if (fullText.length > 300000) break;
      const tjMatches = decompressed.matchAll(/\[(.*?)\]\s*TJ/g);
      for (const tm of tjMatches) {
        const inner = tm[1].matchAll(/\(([^)]+)\)/g);
        for (const im of inner) {
          fullText += im[1] + ' ';
        }
      }
    }
    const clean = fullText.replace(/\s+/g, ' ').trim();
    return clean.length > 0 ? clean : null;
  } catch (err) {
    console.warn('[media] Gagal ekstraksi teks PDF lokal:', err);
    return null;
  }
}

/**
 * Helper analisis native PDF via Google Gemini Multimodal API.
 */
async function processPdfViaGemini(
  buffer: Buffer,
  prompt: string,
  model: string,
): Promise<{ reply: string; via: string; tokens?: { prompt: number; completion: number; total: number } } | null> {
  const rawKeys = config.pools.gemini;
  if (!rawKeys || rawKeys.length === 0) return null;
  const keys = getOrderedKeys('gemini', rawKeys);

  for (const key of keys) {
    if (!(await isKeyAllowed('gemini', key, config.dailyCap.gemini))) continue;
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(config.downloadTimeoutMs || 25000),
        body: JSON.stringify({
          contents: [{
            role: 'user',
            parts: [
              { inlineData: { mimeType: 'application/pdf', data: buffer.toString('base64') } },
              { text: prompt }
            ]
          }],
          generationConfig: { temperature: 0.3, ...geminiThinkingConfig(model) }
        })
      });

      if (!res.ok) continue;
      const data = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        usageMetadata?: {
          promptTokenCount?: number;
          candidatesTokenCount?: number;
          totalTokenCount?: number;
        };
      };
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      if (text) {
        // Catat pemakaian kuota Gemini (analisis PDF native memakai kuota provider yang sama)
        keyUsed('gemini', key);
        const tokens = data.usageMetadata
          ? {
              prompt: Number(data.usageMetadata.promptTokenCount) || 0,
              completion: Number(data.usageMetadata.candidatesTokenCount) || 0,
              total: Number(data.usageMetadata.totalTokenCount) || 0,
            }
          : undefined;
        if (tokens?.total) keyTokensUsed('gemini', key, tokens.total);
        return { reply: sanitizeAssistantOutput(text), via: `gemini/${model}`, tokens };
      }
    } catch (err) {
      console.warn(`[media] Gemini PDF [${model}] gagal:`, err);
    }
  }
  return null;
}

/**
 * Helper analisis PDF via OpenRouter (plugin `file-parser`, engine pdf-text).
 * Dipakai sebagai cadangan setelah Gemini: model free OpenRouter menerima
 * part `file` berisi PDF base64 dan memparsenya di sisi gateway.
 */
async function processPdfViaOpenRouter(
  buffer: Buffer,
  prompt: string,
  filename: string,
): Promise<{ reply: string; via: string; tokens?: { prompt: number; completion: number; total: number } } | null> {
  const rawKeys = config.pools.openrouter;
  if (!rawKeys || rawKeys.length === 0) return null;
  const keys = getOrderedKeys('openrouter', rawKeys);

  for (const key of keys) {
    if (!(await isKeyAllowed('openrouter', key, config.dailyCap.openrouter))) continue;
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(config.timeoutMs),
        body: JSON.stringify({
          model: config.models.orPrimary,
          max_tokens: config.maxOutputTokens,
          // Thinking off (keputusan user): model free DeepSeek tetap menjawab bersih & cepat.
          reasoning: { effort: 'none' },
          plugins: [{ id: 'file-parser', pdf: { engine: 'pdf-text' } }],
          messages: [{
            role: 'user',
            content: [
              { type: 'file', file: { filename, file_data: `data:application/pdf;base64,${buffer.toString('base64')}` } },
              { type: 'text', text: prompt },
            ],
          }],
        }),
      });

      if (!res.ok) continue;
      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      };
      const text = data?.choices?.[0]?.message?.content?.trim();
      if (text) {
        keyUsed('openrouter', key);
        const tokens = data.usage
          ? {
              prompt: Number(data.usage.prompt_tokens) || 0,
              completion: Number(data.usage.completion_tokens) || 0,
              total: Number(data.usage.total_tokens) || 0,
            }
          : undefined;
        if (tokens?.total) keyTokensUsed('openrouter', key, tokens.total);
        return { reply: sanitizeAssistantOutput(text), via: `openrouter/${config.models.orPrimary}`, tokens };
      }
    } catch (err) {
      console.warn(`[media] OpenRouter PDF gagal:`, err);
    }
  }
  return null;
}

/**
 * Deteksi tipe MIME aktual dari magic bytes buffer untuk mencegah MIME spoofing (P1-10).
 */
export function sniffMimeType(buffer: Buffer): string | null {
  if (!buffer || buffer.length < 4) return null;
  // PDF: %PDF (0x25 0x50 0x44 0x46)
  if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
    return 'application/pdf';
  }
  // PNG: \x89PNG (0x89 0x50 0x4E 0x47)
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
    return 'image/png';
  }
  // JPEG: \xFF\xD8\xFF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  // WebP: RIFF....WEBP
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  // ZIP (PK\x03\x04) — bisa Word .docx, Excel .xlsx, atau arsip lain.
  //
  // BUG YANG DIPERBAIKI (24 Sep): dulu SEMUA berkas ZIP langsung dilabeli
  // "wordprocessingml.document". Akibatnya .xlsx ikut dikirim ke parser Word
  // (mammoth) dan gagal dengan "Could not find main document part" — sehingga
  // Excel tidak pernah bisa dibaca. Sekarang isi arsip diperiksa untuk
  // menentukan jenis sebenarnya: keberadaan xl/workbook.xml berarti Excel,
  // word/document.xml berarti Word.
  if (buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04) {
    const teksArsip = buffer.toString('latin1');
    if (teksArsip.includes('xl/workbook.xml') || teksArsip.includes('xl/worksheets/')) {
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    }
    if (teksArsip.includes('word/document.xml')) {
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    }
    // DITAMBAHKAN 04 Okt: PowerPoint .pptx — keberadaan ppt/presentation.xml.
    if (teksArsip.includes('ppt/presentation.xml') || teksArsip.includes('ppt/slides/')) {
      return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    }
    // Arsip ZIP lain (mis. .zip biasa) — biarkan tanpa mime agar tidak salah tebak.
    return null;
  }
  // OLE2 (D0CF11E0A1B11AE1) — format lama Microsoft: .doc, .xls, .ppt, .msg.
  // DITAMBAHKAN 04 Okt: sebelumnya tidak dikenali sama sekali (return null).
  // Dibedakan dari isi stream di dalamnya karena header OLE2 sama untuk semua.
  if (
    buffer.length >= 8 &&
    buffer[0] === 0xd0 && buffer[1] === 0xcf && buffer[2] === 0x11 && buffer[3] === 0xe0 &&
    buffer[4] === 0xa1 && buffer[5] === 0xb1 && buffer[6] === 0x1a && buffer[7] === 0xe1
  ) {
    // Nama stream di direktori OLE disimpan UTF-16LE, jadi "WordDocument" muncul
    // sebagai "W\0o\0r\0d\0...". Cari versi UTF-16LE-nya (bukan ASCII biasa).
    const u16 = buffer.toString('utf16le');
    if (u16.includes('WordDocument')) return 'application/msword';
    if (u16.includes('Workbook') || u16.includes('Book')) {
      return 'application/vnd.ms-excel';
    }
    if (u16.includes('PowerPoint Document')) return 'application/vnd.ms-powerpoint';
    return null;
  }
  // Ogg audio: OggS
  if (buffer.length >= 4 && buffer.toString('ascii', 0, 4) === 'OggS') {
    return 'audio/ogg';
  }
  return null;
}

/**
 * Ekstraksi teks dari berbagai format dokumen teks & Word (.docx).
 */
export async function extractDocumentText(
  buffer: Buffer,
  mime: string,
  filename: string,
): Promise<string | null> {
  // Sniff magic bytes jika tersedia (D4 & E4)
  const sniffed = sniffMimeType(buffer);
  const effectiveMime = (sniffed || mime || '').toLowerCase();

  // Batasi ukuran dokumen maks 15MB untuk mencegah Lambda OOM
  if (buffer.length > 15 * 1024 * 1024) {
    console.warn(`[media] Dokumen ${filename} melebihi batas 15MB (${buffer.length} bytes). Ditolak.`);
    return null;
  }

  const lowerName = filename.toLowerCase();

  // Blokir berkas rahasia/sensitif agar tidak terekspos ke LLM
  if (
    lowerName.includes('.env') ||
    lowerName.endsWith('.key') ||
    lowerName.endsWith('.pem') ||
    lowerName.endsWith('.log')
  ) {
    console.warn(`[media] Percobaan membaca berkas sensitif diblokir: ${filename}`);
    return null;
  }

  // ── PENJAGA BERKAS (audit keamanan 06 Okt 2026, parameter #18) ──
  // Tanpa antivirus, kami menolak berkas yang jelas berbahaya LEBIH AWAL:
  // ekstensi executable & magic bytes executable. Ini mencegah eksploitasi
  // celah parser (mammoth/pdf) dan mencegah berkas berbahaya diteruskan ke
  // layanan lain di masa depan. Berkas tetap hanya dibaca di memori.
  const periksa = periksaBerkasAman(filename, buffer);
  if (!periksa.boleh) {
    console.warn(`[media] Berkas ditolak oleh penjaga: ${filename} — ${periksa.alasan}`);
    return null;
  }

  // 1. Dokumen Microsoft Word (.docx) via parser Mammoth lokal (21 ms)
  if (
    effectiveMime.includes('wordprocessingml') ||
    effectiveMime.includes('msword') ||
    lowerName.endsWith('.docx')
  ) {
    try {
      const result = await mammoth.extractRawText({ buffer });
      if (result.value && result.value.trim().length > 0) {
        return result.value.trim();
      }
    } catch (err) {
      console.warn('[media] Gagal ekstrak Word .docx via mammoth:', err);
    }
  }

  // 2. Excel (.xlsx / .xlsm) via parser ZIP+XML sendiri (tanpa dependensi ber-CVE).
  //    CATATAN: .xls (format lama, biner OLE) TIDAK didukung parser ini — deteksi
  //    di bawah hanya menangkap .xlsx/.xlsm, dan .xls akan jatuh ke jalur "tidak
  //    didukung" dengan pesan dinamis dari model.
  if (
    lowerName.endsWith('.xlsx') ||
    lowerName.endsWith('.xlsm') ||
    effectiveMime.includes('spreadsheetml')
  ) {
    try {
      const isi = bacaXlsx(buffer);
      if (isi && isi.trim().length > 0) return isi.trim();
    } catch (err) {
      console.warn('[media] Gagal ekstrak Excel .xlsx:', err);
    }
  }

  // 2b. PowerPoint (.pptx) via parser ZIP+XML sendiri (DITAMBAHKAN 04 Okt).
  //     Sebelumnya .pptx tidak didukung sama sekali dan jatuh ke jalur "tidak
  //     didukung". .ppt (format lama, biner OLE) tetap tidak didukung.
  if (
    lowerName.endsWith('.pptx') ||
    effectiveMime.includes('presentationml')
  ) {
    try {
      const isi = bacaPptx(buffer);
      if (isi && isi.trim().length > 0) return isi.trim();
    } catch (err) {
      console.warn('[media] Gagal ekstrak PowerPoint .pptx:', err);
    }
  }

  // 2c. Word lama (.doc) & Excel lama (.xls) — format OLE2 (DITAMBAHKAN 04 Okt).
  //     Sebelumnya keduanya TIDAK didukung dan jatuh ke jalur "tidak didukung".
  //     Kini dibaca parser OLE2 internal (tanpa dependensi baru).
  if (lowerName.endsWith('.doc') || effectiveMime.includes('msword')) {
    try {
      const isi = bacaDoc(buffer);
      if (isi && isi.trim().length > 0) return isi.trim();
    } catch (err) {
      console.warn('[media] Gagal ekstrak Word .doc (OLE2):', err);
    }
  }
  if (
    (lowerName.endsWith('.xls') || effectiveMime.includes('ms-excel')) &&
    !lowerName.endsWith('.xlsx') && !lowerName.endsWith('.xlsm')
  ) {
    try {
      const isi = bacaXls(buffer);
      if (isi && isi.trim().length > 0) return isi.trim();
    } catch (err) {
      console.warn('[media] Gagal ekstrak Excel .xls (OLE2):', err);
    }
  }

  // 3. Berkas teks polos, kode sumber, data terstruktur (.txt, .md, .csv, .json, dsb)
  const textExtensions = [
    '.txt',
    '.md',
    '.csv',
    '.tsv',
    '.json',
    '.js',
    '.ts',
    '.jsx',
    '.tsx',
    '.py',
    '.html',
    '.css',
    '.sql',
    '.yaml',
    '.yml',
    '.xml',
    '.log',
    '.ini',
    '.conf',
    '.env.example',
    '.srt',
    '.vtt',
  ];

  if (
    effectiveMime.startsWith('text/') ||
    effectiveMime.includes('json') ||
    effectiveMime.includes('javascript') ||
    textExtensions.some((ext) => lowerName.endsWith(ext))
  ) {
    try {
      const text = buffer.toString('utf-8').trim();
      if (text.length > 0) return text;
    } catch {
      // abaikan
    }
  }

  return null;
}

/**
 * Ekstraksi gambar dari dokumen Word (.docx) via mammoth (convertImage → data URI).
 * Dipakai agar dokumen berisi gambar/screenshot ikut dianalisis rantai vision.
 * Batas: maksimal 3 gambar pertama, hanya raster, tiap gambar <= ~4MB base64.
 */
async function extractDocxImages(buffer: Buffer, max = 3): Promise<Array<{ base64: string; mime: string }>> {
  try {
    const result = await mammoth.convertToHtml(
      { buffer },
      {
        convertImage: mammoth.images.imgElement((image) =>
          image.read('base64').then((data) => ({ src: `data:${image.contentType};base64,${data}` })),
        ),
      },
    );
    const out: Array<{ base64: string; mime: string }> = [];
    const re = /src="data:([^;"]+);base64,([^"]+)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(result.value)) !== null && out.length < max) {
      const mime = m[1];
      // Hanya raster yang didukung model vision (lewati svg/emf/wmf)
      if (!/^image\/(png|jpe?g|webp|gif)/.test(mime)) continue;
      if (m[2].length > 5_500_000) continue; // ~4MB biner
      out.push({ mime, base64: m[2] });
    }
    return out;
  } catch (err) {
    console.warn('[media] Gagal ekstraksi gambar .docx via mammoth:', err);
    return [];
  }
}

/**
 * Memproses dan menganalisis berkas dokumen (PDF, Word, File Teks) secara cerdas.
 * Dokumen PDF:
 * - Primary: gemini-3.8-flash (native multimodal document)
 * - Cadangan: gemini-2.5-flash (native multimodal document)
 * - Parser Teks Lokal (Fallback): Ekstrak teks lokal lalu teruskan ke xKiro Qwen 3.8.
 */
export async function processIncomingDocument(
  buffer: Buffer,
  mime: string,
  filename: string,
  caption?: string,
  ctx?: ChatContext,
): Promise<{ reply: string; via: string; tokens?: { prompt: number; completion: number; total: number } }> {
  const sniffed = sniffMimeType(buffer);
  const effectiveMime = (sniffed || mime || '').toLowerCase();
  const lowerName = filename.toLowerCase();

  // Kasus A: Dokumen PDF
  if (effectiveMime.includes('pdf') || lowerName.endsWith('.pdf')) {
    const prompt = caption && caption.trim()
      ? `Pengguna mengirim dokumen PDF "${filename}". Pertanyaan / instruksi temanmu:\n${caption.trim()}\n\nAturan: Jawab langsung to-the-point, jelas, dan manusiawi layaknya sahabat diskusi tanpa pembuka klise robotik.`
      : `Pengguna mengirim dokumen PDF "${filename}". Tolong baca dan rangkum inti terpentingnya secara ringkas, padat, dan ramah selayaknya teman ngobrol yang membantu meringkas isi dokumen dengan susunan kalimatmu sendiri (tanpa kalimat template hafalan).`;

    // 1. Gemini native PDF (model vision: 3.6 Flash > 3.5 Flash Lite > 2.5 Flash)
    for (const model of config.models.geminiVision) {
      const p = await processPdfViaGemini(buffer, prompt, model);
      if (p) {
        // Gemini native PDF juga bisa terpotong pada dokumen bertabel panjang
        // (uji nyata: finishReason MAX_TOKENS pada gemini-2.5-flash). Sambung bila perlu.
        const lanjutan = await continueIfTruncated(
          [{ role: 'user', content: prompt }],
          p.reply,
          ctx?.chatId,
        );
        return { ...p, reply: lanjutan };
      }
    }

    // 2. Cadangan: OpenRouter plugin file-parser (engine pdf-text)
    const pOr = await processPdfViaOpenRouter(buffer, prompt, filename);
    if (pOr) {
      const lanjutanOr = await continueIfTruncated(
        [{ role: 'user', content: prompt }],
        pOr.reply,
        ctx?.chatId,
      );
      return { ...pOr, reply: lanjutanOr };
    }

    // 3. Parser Teks Lokal (Fallback): Ekstrak teks halaman PDF secara lokal lalu teruskan ke rantai teks utama
    const extractedText = extractPdfTextSimple(buffer);
    if (extractedText && extractedText.length > 20) {
      const localPrompt = [
        `[BERKAS DOKUMEN PDF (EKSTRAKSI TEKS LOKAL): "${filename}"]`,
        '--- ISI DOKUMEN ---',
        extractedText.slice(0, 25000),
        '--- AKHIR ISI DOKUMEN ---',
        '',
        caption && caption.trim()
          ? `Pertanyaan / instruksi temanmu tentang dokumen ini: ${caption.trim()}`
          : 'Tolong baca dan rangkum inti dokumen PDF ini secara jelas, padat, dan terstruktur.',
      ].join('\n');
      const autoRes = await autoReply(localPrompt, ctx);
      // PDF panjang (daftar harga, laporan bertabel) sering melewati batas output
      // provider sehingga jawaban berhenti di tengah — sambung otomatis.
      const lanjutan = await continueIfTruncated(
        [{ role: 'user', content: localPrompt }],
        autoRes.reply,
        ctx?.chatId,
      );
      return { reply: lanjutan, via: `local-parser/${autoRes.via}`, tokens: autoRes.tokens };
    }

    // Fallback terakhir: murni dinamis. ZERO teks statis — bila model juga mati,
    // balasan dibiarkan kosong dan platform tidak mengirim pesan apa pun.
    try {
      const gen = await autoReply(
        `Berkas PDF "${filename}" gagal diproses otomatis oleh modul visual. Beri tahu user dengan gayamu sendiri, singkat dan hangat, bahwa berkasnya diterima tapi sedang gagal dibaca, lalu tawarkan minta dia tanyakan bagian tertentu via teks.`,
        ctx,
      );
      if (gen.reply.trim()) return { reply: gen.reply, via: `dynamic-pdf-error/${gen.via}` };
    } catch {
      // diam
    }
    return { reply: '', via: 'pdf-unavailable' };
  }

  // Kasus B: Dokumen Word (.docx) atau berkas teks/kode
  const extracted = await extractDocumentText(buffer, mime, filename);
  if (extracted) {
    const prompt = [
      `[BERKAS DOKUMEN DARI TEMANMU: "${filename}"]`,
      '--- ISI BERKAS ---',
      extracted.slice(0, 25000), // Batas aman token
      '--- AKHIR ISI BERKAS ---',
      '',
      caption && caption.trim()
        ? `Pertanyaan / instruksi temanmu tentang berkas ini: ${caption.trim()}`
        : 'Tolong baca dan rangkum inti dokumen ini secara bersahabat, jelas, dan terstruktur.',
    ].join('\n');

    // Jika .docx memuat gambar (screenshot/diagram), sertakan ke rantai vision agar
    // isi visualnya ikut dianalisis, bukan hanya teksnya.
    if (effectiveMime.includes('wordprocessingml') || lowerName.endsWith('.docx')) {
      const images = await extractDocxImages(buffer);
      if (images.length > 0) {
        try {
          const parts: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> = [
            { type: 'text', text: `${prompt}\n\nDokumen ini juga memuat ${images.length} gambar; analisis juga isi gambarnya.` },
            ...images.map((img) => ({
              type: 'image_url' as const,
              image_url: { url: `data:${img.mime};base64,${img.base64}` },
            })),
          ];
          const visionRes = await chat([{ role: 'user', content: parts }], { vision: true });
          if (visionRes.text.trim()) {
            // Dokumen bergambar + tabel panjang juga bisa terpotong — sambung otomatis.
            const lanjutan = await continueIfTruncated(
              [{ role: 'user', content: parts }],
              visionRes.text,
              ctx?.chatId,
            );
            return { reply: sanitizeAssistantOutput(lanjutan), via: `docx-vision/${visionRes.via}`, tokens: visionRes.tokens };
          }
        } catch (err) {
          console.warn('[media] Analisis gambar .docx via vision gagal, lanjut teks saja:', err);
        }
      }
    }

    // Word/Excel/teks: sambung jawaban bila terpotong (dokumen panjang & bertabel
    // rutin melewati batas output provider — lihat catatan di continueIfTruncated).
    const autoDoc = await autoReply(prompt, ctx);
    const lanjutanDoc = await continueIfTruncated(
      [{ role: 'user', content: prompt }],
      autoDoc.reply,
      ctx?.chatId,
    );
    return { reply: lanjutanDoc, via: autoDoc.via, tokens: autoDoc.tokens };
  }

  // Kasus C: Dokumen tidak didukung (misal biner terenkripsi) — murni dinamis, tanpa teks statis.
  try {
    const gen = await autoReply(
      `Berkas "${filename}" diterima tapi formatnya tidak bisa dibaca langsung. Beri tahu user dengan gayamu sendiri, singkat dan hangat, lalu sebutkan format yang didukung: PDF, Word (.docx), atau teks (.txt, .md, .csv, kode).`,
      ctx,
    );
    if (gen.reply.trim()) return { reply: gen.reply, via: `dynamic-unsupported/${gen.via}` };
  } catch {
    // diam
  }
  return { reply: '', via: 'unsupported-unavailable' };
}

/**
 * Memproses video (MP4 / WebM) via Google Gemini Multimodal API.
 * Cadangan: transkripsi trek audio (Groq/Cloudflare Whisper) lalu jawab dari teks
 * bila seluruh jalur video native gagal (video tetap bisa ditanggapi isinya).
 */
export async function processIncomingVideo(
  buffer: Buffer,
  mime: string = 'video/mp4',
  filename: string = 'video.mp4',
  caption?: string,
  ctx?: ChatContext,
): Promise<{ reply: string; via: string; tokens?: { prompt: number; completion: number; total: number } }> {
  const prompt = caption && caption.trim()
    ? `Pengguna mengirim video "${filename}". Pertanyaan / instruksi:\n${caption.trim()}\n\nAturan: Jawab langsung to-the-point, santai, dan alami. DILARANG menarasikan/mendeskripsikan isi video ("Video ini menampilkan...", "Di videonya ada...") — user yang mengirim, dia sudah tahu isinya.`
    : `Pengguna mengirim video "${filename}" tanpa pertanyaan. DILARANG menarasikan atau mendeskripsikan isi video ("Video ini memperlihatkan...", "Di videonya ada...") — user yang mengirim, dia sudah tahu isinya. Cukup balas dengan REAKSI NATURAL seperti teman yang baru dikirimi video di chat: celetukan pendek yang nyambung dengan obrolan terakhir, ikut merespons suasananya, atau komentar santai. Kamu menonton videonya untuk memahami konteks, bukan untuk dibacakan ulang.`;

  const rawKeys = config.pools.gemini;
  // Rotasi key (round-robin) — berlaku untuk semua endpoint termasuk video.
  const keys = getOrderedKeys('gemini', rawKeys);

  for (const model of config.models.geminiVision) {
    for (const key of keys) {
      if (!(await isKeyAllowed('gemini', key, config.dailyCap.gemini))) continue;
      try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(config.timeoutMs),
          body: JSON.stringify({
            contents: [{
              role: 'user',
              parts: [
                { inlineData: { mimeType: mime, data: buffer.toString('base64') } },
                { text: prompt }
              ]
            }],
            generationConfig: { temperature: 0.3, ...geminiThinkingConfig(model) }
          })
        });

        if (!res.ok) continue;
        const data = (await res.json()) as {
          candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
          usageMetadata?: {
            promptTokenCount?: number;
            candidatesTokenCount?: number;
            totalTokenCount?: number;
          };
        };
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        if (text) {
          // Catat pemakaian kuota Gemini (analisis video native memakai kuota provider yang sama)
          keyUsed('gemini', key);
          const tokens = data.usageMetadata
            ? {
                prompt: Number(data.usageMetadata.promptTokenCount) || 0,
                completion: Number(data.usageMetadata.candidatesTokenCount) || 0,
                total: Number(data.usageMetadata.totalTokenCount) || 0,
              }
            : undefined;
          if (tokens?.total) keyTokensUsed('gemini', key, tokens.total);
          // Video panjang bisa menghasilkan jawaban panjang (transkrip + rangkuman)
          // yang melewati batas output — sambung otomatis bila terputus.
          const lanjutanVid = await continueIfTruncated(
            [{ role: 'user', content: caption?.trim() || 'Rangkum video ini.' }],
            text,
            ctx?.chatId,
          );
          return { reply: sanitizeAssistantOutput(lanjutanVid, caption, undefined, true), via: `gemini/${model}`, tokens };
        }
      } catch (err) {
        console.warn(`[media] Video via Gemini [${model}] gagal:`, err);
      }
    }
  }

  // Cadangan: transkripsi trek audio video (Whisper menerima MP4/WebM) lalu jawab
  // dari transkripnya via rantai teks. Menjaga video tetap terproses saat seluruh
  // jalur video native (Gemini) gagal.
  try {
    const transcript = await transcribeAudio(buffer, mime);
    if (transcript && transcript.trim().length > 0) {
      const textPrompt = [
        `[TRANSKRIP AUDIO DARI VIDEO: "${filename}"]`,
        '--- ISI TRANSKRIP ---',
        transcript.slice(0, 20000),
        '--- AKHIR TRANSKRIP ---',
        '',
        caption && caption.trim()
          ? `Pertanyaan / instruksi temanmu tentang video ini: ${caption.trim()}`
          : 'Tolong tanggapi isi video ini secara wajar, santai, dan seru layaknya teman yang baru saja menonton bersama. Sebutkan bahwa kamu menangkap isinya dari suara video.',
      ].join('\n');
      const res = await autoReply(textPrompt, ctx);
      return { reply: res.reply, via: `transkrip-video/${res.via}`, tokens: res.tokens };
    }
  } catch {
    // lanjut ke fallback dinamis
  }

  // Fallback terakhir: murni dinamis. ZERO teks statis — bila model juga mati,
  // balasan dibiarkan kosong dan platform tidak mengirim pesan apa pun.
  try {
    const gen = await autoReply(
      `Video "${filename}" gagal dianalisis otomatis. Beri tahu user dengan gayamu sendiri, singkat dan hangat, bahwa videonya diterima tapi sedang gagal diproses, lalu minta dia kirim ulang sebentar lagi.`,
      ctx,
    );
    if (gen.reply.trim()) return { reply: gen.reply, via: `dynamic-video-error/${gen.via}` };
  } catch {
    // diam
  }
  return { reply: '', via: 'video-unavailable' };
}

/**
 * Memproses stiker WhatsApp atau Telegram (.webp) dan memahami konteks ekspresinya via Vision AI.
 */
export async function processIncomingSticker(
  buffer: Buffer,
  mime: string = 'image/webp',
  emoji?: string,
  ctx?: ChatContext,
): Promise<{ reply: string; via: string; tokens?: { prompt: number; completion: number; total: number } }> {
  const stickerCaption = emoji ? `(Emoji stiker: ${emoji})` : undefined;
  return await describeImage(buffer.toString('base64'), mime, stickerCaption, ctx);
}
