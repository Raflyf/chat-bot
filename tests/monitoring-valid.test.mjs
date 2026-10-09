/**
 * TEST OTOMATIS — DATA MONITORING VALID (09 Okt 2026).
 *
 * LAPORAN PEMILIK PRODUK: "semua apikey habis? tapi monitoring masih hijau,
 * berarti ini bug fatal yg kamu buat, betulkan yg benar dan valid data monitoring
 * nya".
 *
 * BUKTI NYATA:
 *   - API Cloudflare balas HTTP 429 "used up daily free allocation of 10,000
 *     neurons" pada KETIGA akun.
 *   - `provider_cooldown` sudah mencatat alasan='neuron' (sistem TAHU habis).
 *   - TAPI dashboard menampilkan "5.459/10.000 neuron (55%) OPTIMAL".
 *
 * AKAR (3 bug):
 *   1. Dashboard TIDAK PERNAH membaca `provider_cooldown` -> key yang dibekukan
 *      tetap tampil "Optimal".
 *   2. Neuron dihitung dari tabel `messages` (125.066 token) padahal
 *      `provider_quota` mencatat 316.601 token — selisih 60% data hilang
 *      (`messages` hanya menyimpan balasan yang BERHASIL, bukan semua panggilan).
 *   3. Rasio input/output TIDAK KONSISTEN: providers.ts pakai 80/20,
 *      api/stats.ts pakai 99/1 untuk data yang sama.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const baca = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
// Buang KOMENTAR dulu — regex tidak boleh cocok dengan contoh di komentar.
const STATS = baca('api/stats.ts')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/[^\n]*/g, '');
const PROV = baca('src/providers.ts');
const DASH = baca('public/js/dashboard.js');

test('monitoring: ada PROBE AKTIF untuk kunci Cloudflare', () => {
  // KENAPA PERLU: cooldown hanya tercatat bila ada request yang GAGAL. Kunci yang
  // kebetulan tidak pernah dicoba TIDAK punya cooldown -> tampil "Optimal" padahal
  // neuron akun itu HABIS (kuota dihitung per AKUN, aplikasi lain bisa menghabiskan).
  // Bukti nyata: key #2 (59a278046880) HABIS tapi tidak ada cooldown-nya.
  assert.ok(PROV.includes('export async function probeKunciCloudflare'),
    'harus ada probeKunciCloudflare');
  assert.ok(/probeKunciCloudflare\(\)/.test(STATS), 'stats.ts harus memanggil probe');
  assert.ok(STATS.includes('PROBE_TTL_MS'), 'harus ada cache agar dashboard tidak lambat');
});

test('monitoring: dashboard MEMBACA provider_cooldown', () => {
  assert.ok(STATS.includes('provider_cooldown'), 'stats.ts harus membaca provider_cooldown');
  assert.ok(STATS.includes('cooldownAktif'), 'harus ada map cooldown aktif');
});

test('monitoring: cooldown MEMAKSA status capped', () => {
  assert.ok(/kenaCooldown[\s\S]{0,200}status = 'capped'/.test(STATS),
    'cooldown harus memaksa status capped');
});

test('monitoring: cooldown dikirim ke frontend', () => {
  assert.ok(STATS.includes('cooldownAlasan'), 'harus kirim cooldownAlasan');
  assert.ok(STATS.includes('cooldownSampai'), 'harus kirim cooldownSampai');
  assert.ok(DASH.includes('cooldownAlasan'), 'frontend harus menampilkan alasan cooldown');
});

test('monitoring: neuron dari provider_quota, bukan messages', () => {
  // Sumber token harus tokenQuotaMap (provider_quota), bukan hanya providerTokenStats.
  assert.ok(/tokenDariQuota[\s\S]{0,300}tokenQuotaMap/.test(STATS),
    'harus pakai tokenQuotaMap (provider_quota) sebagai sumber token');
  assert.ok(/tokenEfektif = Math\.max\(/.test(STATS),
    'harus pakai nilai TERBESAR agar tidak meremehkan pemakaian');
});

test('monitoring: rasio input/output KONSISTEN (99/1)', () => {
  // providers.ts tidak boleh lagi memakai 80/20.
  assert.ok(!/hitungNeuron\([^)]*\*\s*0\.8\s*,/.test(PROV),
    'providers.ts jangan pakai rasio 80/20 (tidak konsisten dengan stats.ts)');
  assert.ok(/0\.99/.test(PROV), 'providers.ts harus pakai 99/1');
});

test('sinkron: bar & angka TIDAK boleh beda saat kuota habis', () => {
  // LAPORAN PEMILIK PRODUK: "bar dan perhitungannya tidak singkron".
  // Bukti: bar 9% (dari REQUEST) padahal baris NEURON 50%; "≈ 12 balasan lagi"
  // padahal neuron HABIS.
  //
  // ATURAN: bila cooldown aktif, persentase NEURON & balasanTersisa WAJIB jujur
  // (100% dan 0) — agar bar, angka, dan status SINKRON.
  assert.ok(/cooldownAktif[\s\S]{0,200}tokenPercent = 100/.test(STATS),
    'tokenPercent harus dipaksa 100% saat cooldown aktif');
  assert.ok(/neuronBenarHabis[\s\S]{0,200}balasanTersisa/.test(STATS),
    'balasanTersisa harus 0 saat neuron habis');
  // Header provider: 100% bila semua kunci habis.
  assert.ok(/semuaKunciHabis[\s\S]{0,200}poolTokenPercent = 100/.test(STATS),
    'header provider harus 100% bila semua kunci habis');
});

test('sinkron: bar utama memakai metrik binding yang sama dengan label', () => {
  // DIPERBARUI (09 Okt 2026): dulu `bindingIsToken ? tokenPct : bindingPct` —
  // tetapi `tokenPct` didefinisikan DI DALAM blok `if (hasTokenCap)`, sehingga
  // pemakaian di luar blok melempar ReferenceError dan SEMUA card hilang.
  // Sekarang memakai `(k.tokenPercent || 0)` yang SELALU tersedia.
  assert.ok(/bindingIsToken \? \(k\.tokenPercent \|\| 0\) : bindingPct/.test(DASH),
    'bar utama harus pakai (k.tokenPercent || 0) bila metrik binding = token/neuron');
});

test('sinkron: neuronUsed harus = cap saat kuota habis', () => {
  // BUG: bar 100% tapi angka tetap 4.959/10.000 (50%) — dua angka berbeda.
  // ATURAN: bila cooldown aktif, neuronTampil = NEURON_HARIAN_GRATIS.
  assert.ok(/neuronTampil = adalahNeuron && kenaCooldownNeuron[\s\S]{0,100}NEURON_HARIAN_GRATIS/.test(STATS),
    'neuronTampil harus = cap saat cooldown aktif');
  assert.ok(/neuronUsed: adalahNeuron \? neuronTampil/.test(STATS),
    'output neuronUsed harus pakai neuronTampil');
});

test('stabilitas: PROBE TIDAK BOLEH MEMBLOKIR render', () => {
  // BUG FATAL: `await probeKunciCloudflare()` memblokir -> /api/stats timeout
  // -> SEMUA CARD PROVIDER HILANG (laporan: "ini ko malah hilang card").
  assert.ok(/void probeKunciCloudflare\(\)/.test(STATS),
    'probe harus fire-and-forget (void, bukan await)');
  assert.ok(!/await probeKunciCloudflare\(\)/.test(STATS),
    'JANGAN await probeKunciCloudflare di handler');
});

test('stabilitas: probe PARALEL dengan timeout pendek', () => {
  // 3 key × timeout 15s berurutan = 45s -> melebihi batas Vercel.
  assert.ok(/Promise\.allSettled/.test(PROV), 'probe harus paralel (Promise.allSettled)');
  assert.ok(/AbortSignal\.timeout\(6_000\)/.test(PROV), 'timeout probe maksimal 6 detik');
});

test('render: variabel TIDAK boleh dipakai di luar blok tempat didefinisikan', () => {
  // BUG FATAL: `const tokenPct` didefinisikan DI DALAM `if (hasTokenCap) { }`
  // tetapi dipakai di bar utama (DI LUAR blok) -> ReferenceError saat render.
  // Akibatnya loop render BERHENTI dan hanya sebagian card muncul
  // (laporan pemilik produk: "makin rusak, hanya opencode yg muncul card nya").
  //
  // ATURAN: untuk dipakai di luar blok, akses langsung field data
  // (mis. `k.tokenPercent`) — JANGAN pakai variabel yang scope-nya terbatas.
  const m = DASH.match(/function renderPoolMatrix\(data\) \{[\s\S]*?\n    \}/);
  assert.ok(m, 'renderPoolMatrix harus ada');
  const fn = m[0];
  // Bar utama TIDAK boleh memakai tokenPct (variabel lokal blok).
  const barUtama = fn.match(/progress-bar-fill[^>]*bindingIsToken \?[^:]*:/);
  assert.ok(barUtama, 'bar utama harus ada');
  assert.ok(!/bindingIsToken \? tokenPct/.test(fn),
    'bar utama JANGAN pakai tokenPct (di luar scope) — pakai k.tokenPercent');
  assert.ok(/bindingIsToken \? \(k\.tokenPercent \|\| 0\)/.test(fn),
    'bar utama harus pakai (k.tokenPercent || 0)');
});

test('render: semua pool dirender (uji data nyata)', () => {
  // Uji nyata: 8 pool dari API -> 8 card. Bukti bahwa loop tidak berhenti.
  assert.ok(!/bindingIsToken \? tokenPct/.test(DASH), 'tidak boleh ada pemakaian tokenPct di luar scope');
});

test('sinkron: TABEL BAWAH juga pakai metrik binding (bukan request saja)', () => {
  // LAPORAN PEMILIK PRODUK: "card yg atas sudah benar bar nya, yg bawah masih
  // belum singkron". Card atas (renderPoolMatrix) sudah benar, tetapi TABEL
  // bawah (renderLiveUpstreamTable) masih memakai `pct` (REQUEST) sehingga
  // Cloudflare tampil 9% padahal neuron 10.000/10.000 (100%).
  const m = DASH.match(/function renderLiveUpstreamTable\(data\) \{[\s\S]*?\n    \}/);
  assert.ok(m, 'renderLiveUpstreamTable harus ada');
  const fn = m[0];
  // Bar di tabel TIDAK boleh memakai `pct` mentah.
  const barPct = (fn.match(/progress-bar-fill \$\{pct >= 100/g) || []).length;
  assert.equal(barPct, 0, 'bar tabel jangan pakai `pct` mentah — pakai bindingPct');
  // Provider yang punya metrik token harus memakai bindingPct.
  for (const kind of ['nvidia', 'dahl', 'xkiro', 'cloudflare']) {
    assert.ok(fn.includes(`p.kind === "${kind}"`), `${kind} harus ada di tabel`);
  }
  assert.ok(/const bindingPct = typeof k\.bindingPercent === "number"/.test(fn),
    'tabel harus menghitung bindingPct dari k.bindingPercent');
});
