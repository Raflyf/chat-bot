/**
 * UJI KEDUA JEV — kasus yang LEBIH dekat ke obrolan sehari-hari.
 *
 * Uji pertama memakai kalimat rapi. Yang benar-benar membuat bot "ngawur"
 * adalah obrolan santai: singkatan, bahasa gaul, typo, kalimat berlapis, dan
 * permintaan yang tidak memakai kata kunci apa pun.
 *
 * CARA PAKAI:
 *   JEV_API_KEY=jv_live_xxx node scripts/uji_jev2.mjs
 */
const API_KEY = process.env.JEV_API_KEY;
const ENDPOINT = 'https://jevtypesafe.org/api/v1/decide';

const KASUS = [
  { teks: 'ntar sore gw ke dokter, jgn sampe lupa', harap: 'reminder', catatan: 'permintaan tanpa kata "ingatkan"' },
  { teks: 'wkwk iya deh terserah km', harap: 'obrolan', catatan: 'obrolan murni' },
  { teks: 'simpen dong link tadi', harap: 'catatan', catatan: 'minta simpan tautan' },
  { teks: 'eh itu yang kemarin udah beres belum', harap: 'obrolan', catatan: 'pertanyaan lanjutan tanpa konteks' },
  { teks: 'bantuin cek dong harga tiket konser coldplay', harap: 'cari_web', catatan: 'tanpa kata "cari"' },
  { teks: 'gw mau tidur dulu ya, bangunin jam 5', harap: 'reminder', catatan: 'minta dibangunkan' },
  { teks: 'kalo soal uang jangan diinget-inget deh', harap: 'obrolan', catatan: 'menolak diingatkan' },
  { teks: 'tolong hapus catatan yang kemarin', harap: 'hapus_catatan', catatan: 'maksud berbeda: menghapus' },
];

function klasifikasiRegex(teks) {
  const t = teks.toLowerCase();
  if (/\b(remind|ingatkan|ingetin|pengingat|bangunin|bangunkan)\b/.test(t)) return 'reminder';
  if (/\b(hapus|delete)\b/.test(t)) return 'hapus_catatan';
  if (/\b(catat|catet|note|simpan|simpen)\b/.test(t)) return 'catatan';
  if (/\b(cari|carikan|cariin|search|googling|cek harga)\b/.test(t)) return 'cari_web';
  return 'obrolan';
}

const CRITERIA = {
  reminder: 'user minta diingatkan atau dibangunkan pada waktu tertentu',
  catatan: 'user minta menyimpan sesuatu sebagai catatan',
  hapus_catatan: 'user minta menghapus catatan yang sudah ada',
  cari_web: 'user minta dicarikan informasi dari internet',
  obrolan: 'user sekedar mengobrol atau bercerita',
};

async function tanyaJev(teks) {
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
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
    if (!res.ok) return { salah: `HTTP ${res.status}` };
    const d = await res.json();
    const a = d.answers?.tujuan;
    return { jawab: a?.choice, yakin: a?.confidence, ms: d.meta?.latency_ms, sisa: d.usage?.remaining_tokens };
  } catch (e) {
    return { salah: String(e.message).slice(0, 80) };
  }
}

async function main() {
  console.log('Uji kedua: obrolan santai, singkatan, typo\n');
  let rb = 0, jb = 0, gagal = 0, totalMs = 0, sisa = null;

  for (const [i, k] of KASUS.entries()) {
    const r = klasifikasiRegex(k.teks);
    const j = await tanyaJev(k.teks);
    if (j.salah) {
      gagal++;
      console.log(`${i + 1}. [JEV gagal: ${j.salah}]  "${k.teks}"`);
      continue;
    }
    totalMs += j.ms || 0;
    sisa = j.sisa;
    const rOk = r === k.harap;
    const jOk = j.jawab === k.harap;
    if (rOk) rb++;
    if (jOk) jb++;
    console.log(
      `${i + 1}. regex=${(rOk ? 'OK ' : 'SALAH ') + r}  jev=${(jOk ? 'OK ' : 'SALAH ') + j.jawab} (${j.yakin})  | ${k.teks}`,
    );
    console.log(`    harap: ${k.harap}  —  ${k.catatan}`);
  }

  const n = KASUS.length;
  console.log('\n' + '-'.repeat(60));
  console.log(`Regex benar : ${rb}/${n}`);
  console.log(`JEV benar   : ${jb}/${n}`);
  if (gagal) console.log(`JEV gagal   : ${gagal}/${n}`);
  console.log(`Rata-rata   : ${Math.round(totalMs / Math.max(1, n - gagal))} ms`);
  if (sisa !== null) console.log(`Sisa kuota  : ${sisa} token`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
