/**
 * UJI KELAYAKAN JEV — apakah benar lebih pintar daripada regex yang dipakai bot?
 *
 * KENAPA DIUJI DULU, BUKAN LANGSUNG DIPASANG:
 *   Klaim "lebih pintar, tidak ngawur salah klasifikasi niat" harus dibuktikan
 *   dengan kasus NYATA, bukan diyakini. Bot sudah punya pola regex yang teruji
 *   589 test. Menambahkan dependensi luar tanpa bukti justru menambah risiko
 *   (kuota, latensi, dan titik gagal baru).
 *
 *   Script ini membandingkan keduanya pada kalimat yang MEMANG sering bikin
 *   regex salah: kalimat ambigu, kiasan, dan campuran beberapa maksud.
 *
 * CARA PAKAI:
 *   JEV_API_KEY=jv_live_xxx node scripts/uji_jev.mjs
 */
const API_KEY = process.env.JEV_API_KEY;
const ENDPOINT = 'https://jevtypesafe.org/api/v1/decide';

/** Kasus uji: kalimat + jawaban yang MENURUT MANUSIA benar. */
const KASUS = [
  {
    teks: 'nanti jam 7 aku harus ke kantor, ingetin ya',
    harap: 'reminder',
    catatan: 'kata "ingetin" jelas, tapi ada kata lain juga',
  },
  {
    teks: 'besok aku ada meeting jam 9 pagi sama klien',
    harap: 'obrolan',
    catatan: 'menyebut waktu, TAPI tidak minta diingatkan',
  },
  {
    teks: 'tolong catet ya, nomor resi paketku 8821',
    harap: 'catatan',
    catatan: 'minta dicatat, bukan pengingat',
  },
  {
    teks: 'eh tadi aku mimpi aneh banget deh',
    harap: 'obrolan',
    catatan: 'obrolan biasa, tidak ada permintaan',
  },
  {
    teks: 'cariin dong harga tiket kereta jakarta bandung',
    harap: 'cari_web',
    catatan: 'minta dicarikan, bukan dicatat',
  },
  {
    teks: 'jangan lupa ya besok aku ulang tahun, catet',
    harap: 'catatan',
    catatan: 'kata "jangan lupa" menyerupai pola pengingat',
  },
  {
    teks: 'kamu tuh kalau diingetin suka lupa ya',
    harap: 'obrolan',
    catatan: 'kata "diingetin" tapi sedang membahas bot, bukan minta diingatkan',
  },
  {
    teks: 'ingat ga sih waktu kita ke pantai bulan lalu',
    harap: 'obrolan',
    catatan: 'kata "ingat" tapi mengajak mengenang',
  },
];

/** Pola regex yang kira-kira dipakai skill dispatcher saat ini. */
function klasifikasiRegex(teks) {
  const t = teks.toLowerCase();
  if (/\b(remind|ingatkan|ingetin|pengingat)\b/.test(t)) return 'reminder';
  if (/\b(catat|catet|note|simpan)\b/.test(t)) return 'catatan';
  if (/\b(cari|carikan|cariin|search|googling)\b/.test(t)) return 'cari_web';
  return 'obrolan';
}

const CRITERIA = {
  reminder: 'user minta diingatkan pada waktu tertentu',
  catatan: 'user minta menyimpan sesuatu sebagai catatan',
  cari_web: 'user minta dicarikan informasi dari internet',
  obrolan: 'user sekedar mengobrol atau bercerita',
};

async function tanyaJev(teks) {
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        state: teks,
        questions: {
          tujuan: {
            type: 'choice',
            instructions: 'Apa yang sebenarnya user minta?',
            criteria: CRITERIA,
          },
        },
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      const t = await res.text();
      return { salah: `HTTP ${res.status}: ${t.slice(0, 120)}` };
    }
    const d = await res.json();
    const a = d.answers?.tujuan;
    return {
      jawab: a?.choice,
      yakin: a?.confidence,
      distribusi: a?.probabilities,
      ms: d.meta?.latency_ms,
      sisa: d.usage?.remaining_tokens,
    };
  } catch (e) {
    return { salah: String(e.message || e).slice(0, 120) };
  }
}

async function main() {
  console.log('Membandingkan regex bot vs JEV pada kasus ambigu\n');
  console.log('No | Regex            | JEV              | Keyakinan | Benar? | Kalimat');
  console.log('-'.repeat(110));

  let regexBenar = 0;
  let jevBenar = 0;
  let jevSalahJalan = 0;
  let totalMs = 0;
  let sisaTerakhir = null;

  for (const [i, k] of KASUS.entries()) {
    const r = klasifikasiRegex(k.teks);
    const j = await tanyaJev(k.teks);

    if (j.salah) {
      jevSalahJalan++;
      console.log(
        `${String(i + 1).padStart(2)} | ${r.padEnd(16)} | GAGAL: ${j.salah.slice(0, 40)}`,
      );
      continue;
    }

    totalMs += j.ms || 0;
    sisaTerakhir = j.sisa;

    const rBenar = r === k.harap;
    const jBenar = j.jawab === k.harap;
    if (rBenar) regexBenar++;
    if (jBenar) jevBenar++;

    console.log(
      `${String(i + 1).padStart(2)} | ${(rBenar ? 'OK ' : 'SALAH ') + r.padEnd(10)} | ` +
        `${(jBenar ? 'OK ' : 'SALAH ') + String(j.jawab).padEnd(10)} | ` +
        `${String(j.yakin).padEnd(9)} | ${(jBenar ? 'ya' : 'TIDAK').padEnd(6)} | ${k.teks.slice(0, 40)}`,
    );
  }

  const n = KASUS.length;
  console.log('-'.repeat(110));
  console.log(`\nRegex benar : ${regexBenar}/${n}`);
  console.log(`JEV benar   : ${jevBenar}/${n}`);
  if (jevSalahJalan) console.log(`JEV gagal   : ${jevSalahJalan}/${n} permintaan`);
  console.log(`Rata-rata   : ${Math.round(totalMs / Math.max(1, n - jevSalahJalan))} ms per keputusan`);
  if (sisaTerakhir !== null) console.log(`Sisa kuota  : ${sisaTerakhir} token`);

  console.log('\nKesimpulan:');
  if (jevBenar > regexBenar) {
    console.log(`  JEV lebih akurat ${jevBenar - regexBenar} kasus dari ${n}. Layak dipertimbangkan.`);
  } else if (jevBenar === regexBenar) {
    console.log(`  Akurasi SAMA (${jevBenar}/${n}). Belum ada alasan kuat mengganti regex.`);
  } else {
    console.log(`  Regex justru lebih akurat. JEV belum layak dipasang.`);
  }
}

main().catch((e) => {
  console.error('Gagal:', e.message);
  process.exit(1);
});
