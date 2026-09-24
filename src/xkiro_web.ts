/**
 * Lapisan web xKiro: pencarian & pembacaan halaman berkualitas tinggi.
 *
 * DIPAKAI SEBAGAI PELENGKAP, BUKAN PENGGANTI.
 * Mesin gratis kita (Bing News RSS, Bing Web, DuckDuckGo, feed media) tetap jadi
 * tulang punggung karena tanpa kuota. xKiro dipanggil HANYA saat mesin gratis gagal
 * atau hasilnya terlalu sedikit.
 *
 * ALASAN PEMBATASAN (hasil uji langsung 22 Sep 2026, bukan asumsi):
 * - `POST /v1/search` bekerja baik: hasil relevan (detik.com, gramedia.com), 2-3 detik,
 *   dan `search_domain_filter` benar-benar bekerja (5/5 hasil dari domain yang diminta).
 * - `POST /v1/fetch` mengembalikan markdown bersih (uji: halaman detik.com 9.838 karakter).
 * - Kuota gratis kecil: dokumentasi menyebut 20 pencarian/hari, dan pada uji langsung
 *   server membalas 402 "Insufficient wallet balance" saat habis.
 * - Kuota dihitung PER KUNCI, bukan per akun seperti klaim dokumentasi: 5 kunci baru
 *   masing-masing melaporkan `remainingToday: 19` pada uji terpisah.
 *
 * PENANGANAN KUOTA HABIS (perbaikan bug):
 * Versi pertama modul ini mematikan SELURUH lapisan saat satu kunci membalas 402.
 * Akibatnya satu kunci lama yang kuotanya habis melumpuhkan 5 kunci segar yang ada —
 * pencarian mengembalikan 0 hasil padahal kunci lain masih penuh. Sekarang kuota habis
 * dicatat PER KUNCI, lalu kunci berikutnya langsung dicoba.
 */

import { keyUsed, keyUsedAbsolute } from './quota.js';

const XKIRO_SEARCH_URL = 'https://api.xkiro.com/v1/search';
const XKIRO_FETCH_URL = 'https://api.xkiro.com/v1/fetch';
const XKIRO_CHAT_URL = 'https://api.xkiro.com/v1/chat/completions';

/** Lama menonaktifkan satu kunci setelah kuotanya habis (1 jam). */
const EXHAUSTED_MS = 60 * 60 * 1000;

/** Kunci yang kuotanya habis -> sampai kapan (epoch ms). */
const exhausted = new Map<string, number>();

function allKeys(): string[] {
  return (process.env.XKIRO_KEYS || '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
}

/** Kunci yang masih punya kuota (yang habis dibuang sampai jendelanya lewat). */
function availableKeys(): string[] {
  const now = Date.now();
  return allKeys().filter((k) => (exhausted.get(k) ?? 0) < now);
}

/** Rotasi kunci round-robin supaya pemakaian merata. */
let rr = 0;
function nextKey(list: string[]): string {
  if (list.length === 0) return '';
  const k = list[rr % list.length];
  rr = (rr + 1) % list.length;
  return k;
}

/** Apakah lapisan xKiro masih bisa dipakai (ada kunci yang belum habis kuotanya). */
export function xkiroWebAvailable(): boolean {
  return availableKeys().length > 0;
}

/** Berapa kunci yang masih tersedia (untuk diagnosa/verifikasi). */
export function xkiroKeysLeft(): number {
  return availableKeys().length;
}

// ============================================================================
// PELACAKAN KUOTA WEB SEARCH (ditambahkan 24 Sep 2026)
// ----------------------------------------------------------------------------
// Web search punya kuota TERPISAH dari kuota token. Batasnya diukur langsung,
// bukan dari dokumentasi: satu kunci membalas HTTP 429 pada pencarian ke-11,
// jadi batasnya 10 pencarian/kunci/hari. Dengan 8 kunci -> ~80 pencarian/hari.
//
// Kenapa dilacak di sini: dashboard perlu menampilkan pemakaian web search
// supaya pemilik produk tahu sisa jatah sebelum bot kehabisan dan turun ke
// mesin gratis. Tanpa ini, angka token terlihat aman padahal search bisa habis.
// ============================================================================

/**
 * Batas pencarian per kunci per hari.
 *
 * Nilai 20 dikonfirmasi DUA sumber independen:
 *   1. Dokumentasi xKiro: tier Free = 20 pencarian/hari.
 *   2. Pengukuran langsung: setelah 6 pemakaian tercatat di database, provider
 *      melaporkan `usage.remainingToday = 14`. Enam ditambah empat belas = 20.
 *
 * KOREKSI: pengukuran pertama menyimpulkan 10 karena kunci uji itu ternyata
 * SUDAH terpakai 10x sebelum sesi pengukuran, sehingga 429 muncul di percobaan
 * ke-11 dari sesi tersebut (total 20). Kesimpulan "cap=10" saat itu salah dan
 * sempat dipakai di kode.
 */
export const XKIRO_SEARCH_CAP_PER_KEY = 20;

/** Penghitung lokal per kunci (serverless: per instance, jadi perkiraan bawah). */
const searchUsage = new Map<string, number>();

/**
 * Sisa kuota yang DILAPORKAN PROVIDER (`usage.remainingToday`), per kunci.
 *
 * Ini angka OTORITATIF — provider yang tahu pasti sisanya, kita hanya membaca.
 * Dipakai untuk koreksi silang: bila hitungan lokal menyimpang jauh dari angka
 * provider, yang dipercaya adalah angka provider.
 *
 * Kenapa disimpan per kunci: kuota dihitung per kunci (terbukti dari uji, kunci
 * #1 kena 429 sementara 7 kunci lain masih 200), jadi satu angka global akan
 * salah. Nilai diambil dari respons terakhir tiap kunci.
 */
const reportedRemaining = new Map<string, number>();

/** Waktu (epoch ms) angka `reportedRemaining` terakhir diperbarui. */
let reportedRemainingAt: number | null = null;

/** Ringkasan pemakaian web search untuk dashboard. */
export type XkiroSearchStatus = {
  /** Jumlah kunci terdaftar. */
  keysTotal: number;
  /** Kunci yang masih bisa dipakai (tidak sedang kehabisan kuota). */
  keysAvailable: number;
  /** Batas pencarian per kunci per hari. */
  capPerKey: number;
  /** Total batas harian seluruh kunci (keysTotal x capPerKey). */
  capTotal: number;
  /**
   * Sisa jatah yang AKURAT: jumlah kunci siap pakai x batas per kunci.
   *
   * Kenapa bukan "capTotal - usedThisInstance": di serverless (Vercel) setiap
   * request bisa dilayani instance berbeda, sehingga penghitung in-memory selalu
   * mulai dari 0 dan angka "terpakai" nyaris selalu 0 — menyesatkan. Sebaliknya,
   * kunci yang kehabisan kuota DINONAKTIFKAN berdasarkan respons nyata provider
   * (402/429), jadi `keysAvailable` mencerminkan keadaan sebenarnya dan
   * `keysAvailable x capPerKey` adalah sisa jatah yang bisa dipercaya.
   */
  remainingFromKeys: number;
  /** Pencarian yang tercatat di instance INI saja (batas bawah, bukan total). */
  usedThisInstance: number;
  /** Kunci yang sedang dinonaktifkan karena kuota habis. */
  keysCoolingDown: number;
  /** Kapan kunci yang dinonaktifkan akan aktif kembali (epoch ms, paling cepat). */
  nextRecoveryAt: number | null;
  /**
   * Sisa kuota menurut PROVIDER untuk kunci yang SUDAH melapor saja.
   *
   * PENTING — jangan dipakai sebagai total: angka ini hanya mencakup kunci yang
   * pernah dipakai sejak instance hidup. Kunci yang belum dipakai tidak melapor,
   * padahal kuotanya biasanya masih penuh. Memakai angka ini sebagai total
   * membuat "terpakai" terlihat jauh lebih besar dari kenyataan.
   *
   * Untuk total, pakai `remainingEstimatedTotal`.
   */
  reportedRemaining: number | null;
  /**
   * Perkiraan sisa TOTAL: kunci yang sudah melapor memakai angka provider,
   * kunci yang belum melapor dianggap masih penuh (batas atas sisa).
   *
   * Ini estimasi paling jujur yang bisa dibuat tanpa memanggil provider untuk
   * setiap kunci: kunci yang belum dipakai memang belum mengonsumsi apa pun
   * menurut catatan kita.
   */
  remainingEstimatedTotal: number;
  /** Berapa kunci yang sudah melaporkan sisa kuotanya. */
  reportedKeys: number;
  /** Kapan laporan terakhir diterima (epoch ms). */
  reportedAt: number | null;
};

/**
 * Status web search xKiro untuk dashboard.
 *
 * Catatan kejujuran angka: penghitung di sini bersifat PER INSTANCE (serverless
 * Vercel bisa punya beberapa instance), jadi `usedThisInstance` adalah batas BAWAH,
 * bukan total sebenarnya. Yang akurat dan berguna adalah `keysAvailable` dan
 * `keysCoolingDown` — keduanya diturunkan dari respons nyata provider (402/429).
 */
export function xkiroSearchStatus(): XkiroSearchStatus {
  const keys = allKeys();
  const now = Date.now();
  const cooling = keys.filter((k) => (exhausted.get(k) ?? 0) > now);
  const available = keys.length - cooling.length;
  const nextRecovery = cooling.length
    ? Math.min(...cooling.map((k) => exhausted.get(k) ?? now))
    : null;

  let used = 0;
  for (const k of keys) used += searchUsage.get(k) ?? 0;

  const capTotal = keys.length * XKIRO_SEARCH_CAP_PER_KEY;
  return {
    keysTotal: keys.length,
    keysAvailable: available,
    capPerKey: XKIRO_SEARCH_CAP_PER_KEY,
    capTotal,
    // Angka yang bisa dipercaya: kunci sehat x jatah per kunci. Kunci yang sudah
    // kehabisan kuota sudah dikeluarkan dari `available` berdasarkan respons
    // nyata provider, jadi perkalian ini tidak mengarang.
    remainingFromKeys: available * XKIRO_SEARCH_CAP_PER_KEY,
    usedThisInstance: used,
    keysCoolingDown: cooling.length,
    nextRecoveryAt: nextRecovery,
    reportedRemaining: reportedRemaining.size > 0
      ? Array.from(reportedRemaining.values()).reduce((a, b) => a + b, 0)
      : null,
    // Estimasi total: kunci yang melapor pakai angka provider, sisanya dianggap
    // penuh. Jangan memakai reportedRemaining mentah sebagai total — lihat
    // catatan di deklarasi tipe.
    remainingEstimatedTotal:
      Array.from(reportedRemaining.values()).reduce((a, b) => a + b, 0) +
      Math.max(0, keys.length - reportedRemaining.size) * XKIRO_SEARCH_CAP_PER_KEY,
    reportedKeys: reportedRemaining.size,
    reportedAt: reportedRemainingAt,
  };
}

/** Catat satu pencarian sukses (dipakai internal setelah hasil diterima). */
function recordSearchUse(key: string): void {
  searchUsage.set(key, (searchUsage.get(key) ?? 0) + 1);
}

export type XkiroSearchResult = {
  title: string;
  url: string;
  snippet: string;
  source: string;
  publishedDate: string | null;
};

/**
 * Cari di web lewat xKiro. Mengembalikan array kosong bila gagal/semua kuota habis
 * (tidak pernah melempar error, supaya pemanggil bisa langsung lanjut ke cadangan).
 */
export async function xkiroWebSearch(
  query: string,
  opts: {
    maxResults?: number;
    domains?: string[];
    recency?: 'day' | 'week' | 'month' | 'year' | 'noLimit';
    country?: string;
    timeoutMs?: number;
  } = {},
): Promise<XkiroSearchResult[]> {
  const list = availableKeys();
  if (list.length === 0) return [];

  const body: Record<string, unknown> = {
    model: 'xkiro/web-search',
    query,
    max_results: Math.min(Math.max(opts.maxResults ?? 8, 1), 20),
  };
  if (opts.domains && opts.domains.length > 0) body.search_domain_filter = opts.domains.slice(0, 20);
  if (opts.recency) body.search_recency_filter = opts.recency;
  if (opts.country) body.country = opts.country;

  // Coba beberapa kunci: satu kunci habis tidak boleh menghentikan yang lain.
  const attempts = Math.min(list.length, 3);
  for (let i = 0; i < attempts; i++) {
    const key = nextKey(list);
    if (!key) break;
    try {
      const res = await fetch(XKIRO_SEARCH_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 12000),
      });

      if (res.status === 402 || res.status === 429) {
        // Kuota kunci INI habis: catat, lalu coba kunci berikutnya.
        // 429 ditambahkan 24 Sep 2026: pengukuran langsung menunjukkan kunci
        // membalas 429 (bukan 402) saat jatah pencariannya habis. Sebelumnya
        // hanya 402 yang ditangani, sehingga kunci habis tetap dicoba berulang
        // dan membuang waktu percobaan.
        exhausted.set(key, Date.now() + EXHAUSTED_MS);
        continue;
      }
      if (!res.ok) continue;

      const data = (await res.json()) as {
        results?: Array<{
          title?: string;
          url?: string;
          snippet?: string;
          source?: string;
          publishedDate?: string | null;
        }>;
        // Provider melaporkan sisa kuota di setiap respons. Membacanya jauh lebih
        // akurat daripada menghitung sendiri dari jumlah pemakaian kita.
        usage?: { searches?: number; remainingToday?: number | null };
      };

      // Simpan angka sisa dari provider (otoritatif). `null` berarti provider
      // tidak melaporkan apa-apa — jangan disimpan sebagai 0.
      let providerMelaporkan = false;
      if (typeof data.usage?.remainingToday === 'number') {
        reportedRemaining.set(key, data.usage.remainingToday);
        reportedRemainingAt = Date.now();
        providerMelaporkan = true;
        // Persist ke database juga: angka provider hanya hidup di memori instance
        // yang menerima respons, sedangkan dashboard bisa dilayani instance lain.
        // Pemakaian = jatah per kunci dikurangi sisa yang dilaporkan.
        const usedMenurutProvider = Math.max(0, XKIRO_SEARCH_CAP_PER_KEY - data.usage.remainingToday);
        keyUsedAbsolute('xkiro-search', key, usedMenurutProvider);
      }

      const mapped = (data.results || [])
        .filter((r) => r.url && (r.title || r.snippet))
        .map((r) => ({
          title: (r.title || '').trim(),
          url: (r.url || '').trim(),
          snippet: (r.snippet || '').trim(),
          source: (r.source || '').trim(),
          publishedDate: r.publishedDate ?? null,
        }));
      // Hasil kosong dianggap percobaan gagal -> coba kunci berikutnya.
      if (mapped.length > 0) {
        // Catat pemakaian HANYA saat berhasil, supaya angka di dashboard tidak
        // membengkak karena percobaan yang gagal.
        recordSearchUse(key);
        // Persist ke tabel provider_quota (kind 'xkiro-search') agar angka
        // pemakaian bertahan lintas instance serverless. In-memory saja tidak
        // cukup: setiap request bisa dilayani instance baru yang mulai dari 0.
        //
        // Pilih SALAH SATU jalur, jangan keduanya: bila provider sudah melaporkan
        // angka absolut (keyUsedAbsolute di atas), menambah +1 di sini akan
        // menulis baris yang sama dengan nilai berbeda -> hasilnya balapan dan
        // angka di dashboard bisa salah. Increment hanya dipakai sebagai
        // cadangan saat provider tidak melaporkan apa pun.
        if (!providerMelaporkan) keyUsed('xkiro-search', key);
        return mapped;
      }
    } catch {
      // Jaringan/timeout: coba kunci berikutnya.
    }
  }
  return [];
}

export type XkiroFetchResult = {
  url: string;
  title: string;
  content: string;
  error: string | null;
};

/**
 * Baca isi halaman sebagai markdown lewat xKiro (cadangan terakhir saat pengambil
 * halaman kita sendiri gagal: situs memblokir, butuh render JS, dsb).
 */
export async function xkiroWebFetch(urls: string[], maxContentTokens = 8000): Promise<XkiroFetchResult[]> {
  const list = urls.filter(Boolean).slice(0, 10);
  if (list.length === 0) return [];
  const keysNow = availableKeys();
  if (keysNow.length === 0) return [];

  const attempts = Math.min(keysNow.length, 3);
  for (let i = 0; i < attempts; i++) {
    const key = nextKey(keysNow);
    if (!key) break;
    try {
      const res = await fetch(XKIRO_FETCH_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'xkiro/web-fetch',
          urls: list,
          max_content_tokens: Math.min(Math.max(maxContentTokens, 1000), 200000),
        }),
        signal: AbortSignal.timeout(20000),
      });

      if (res.status === 402 || res.status === 429) {
        // 429 = jatah pencarian/fetch habis (lihat catatan di xkiroWebSearch).
        exhausted.set(key, Date.now() + EXHAUSTED_MS);
        continue;
      }
      if (!res.ok) continue;

      const data = (await res.json()) as {
        results?: Array<{ url?: string; title?: string; content?: string; error?: string | null }>;
      };

      const mapped = (data.results || []).map((r) => ({
        url: (r.url || '').trim(),
        title: (r.title || '').trim(),
        content: (r.content || '').trim(),
        error: r.error ?? null,
      }));
      if (mapped.some((m) => m.content && !m.error)) return mapped;
    } catch {
      // coba kunci berikutnya
    }
  }
  return [];
}

// ============================================================================
// CADANGAN TERAKHIR: jawaban + pencarian dalam satu panggilan
// ----------------------------------------------------------------------------
// xKiro menyediakan `POST /v1/chat/completions` dengan flag `web_search`. Provider
// yang menjalankan pencarian lalu menyusun jawabannya, dan menyertakan daftar
// halaman yang dipakai (`web_search.results`).
//
// KAPAN DIPAKAI: hanya sebagai jaring terakhir, saat SELURUH rantai model kita
// (6 tier) gagal. Alasan:
//   - Ia memakai 1 kuota pencarian yang SAMA dengan /v1/search, sedangkan kita
//     sudah punya 6 tier model sendiri yang lebih hemat (pencarian saja, model
//     kita yang menjawab).
//   - Model gratis di xKiro (`:free`) hanya beberapa; model premium menolak
//     dengan HTTP 403 "requires an active paid plan".
//
// Terverifikasi langsung (24 Sep 2026): `qwen/qwen3.5-omni-plus:free` menjawab
// 1.369 karakter dengan `web_search.status = "ok"`, 3 sumber, ~9,8 detik.
//
// CATATAN PENTING: respons menyertakan `web_search.notice` yang sudah berupa
// kalimat siap-tampil bila pencarian tidak jalan (kuota habis, rate limit).
// Jangan mengarang pesan sendiri — pakai `notice` dari provider.
// ============================================================================

/** Model gratis xKiro untuk jalur cadangan (diuji: semuanya menjawab). */
const XKIRO_CHAT_FREE_MODELS = [
  'qwen/qwen3.5-omni-plus:free',
  'qwen/qwen3.5-397b-a17b:free',
  'qwen/qwen3.6-35b-a3b:free',
];

export type XkiroChatResult = {
  text: string;
  model: string;
  /** Sumber yang dipakai model (untuk ditampilkan/dicatat). */
  sources: Array<{ title: string; url: string }>;
  /** Status pencarian menurut provider: ok | quota_exhausted | rate_limited | ... */
  searchStatus: string | null;
  /** Kalimat siap-tampil dari provider bila pencarian tidak berjalan. */
  notice: string | null;
  tokens?: { prompt: number; completion: number; total: number };
};

/**
 * Jawab pertanyaan lewat xKiro dengan pencarian web aktif.
 * Mengembalikan null bila tidak ada kunci tersedia atau semua model gagal —
 * pemanggil tidak boleh menganggap ini sukses.
 */
export async function xkiroChatWithSearch(
  messages: Array<{ role: string; content: string }>,
  opts: { count?: number; timeoutMs?: number } = {},
): Promise<XkiroChatResult | null> {
  const list = availableKeys();
  if (list.length === 0) return null;

  const attempts = Math.min(list.length, 3);
  for (let i = 0; i < attempts; i++) {
    const key = nextKey(list);
    if (!key) break;

    for (const model of XKIRO_CHAT_FREE_MODELS) {
      try {
        const res = await fetch(XKIRO_CHAT_URL, {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            web_search: { enable: true, count: opts.count ?? 5 },
            messages,
          }),
          signal: AbortSignal.timeout(opts.timeoutMs ?? 40000),
        });

        if (res.status === 402 || res.status === 429) {
          exhausted.set(key, Date.now() + EXHAUSTED_MS);
          break; // kunci ini habis, coba kunci berikutnya
        }
        if (!res.ok) continue; // model ini tidak tersedia, coba model lain

        const data = (await res.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
          usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
          web_search?: {
            status?: string;
            results?: Array<{ title?: string; url?: string }>;
            remaining_today?: number | null;
            notice?: string | null;
          };
        };

        const text = (data.choices?.[0]?.message?.content || '').trim();
        if (!text) continue;

        const ws = data.web_search;
        // Simpan sisa kuota yang dilaporkan (angka otoritatif).
        if (typeof ws?.remaining_today === 'number') {
          reportedRemaining.set(key, ws.remaining_today);
          reportedRemainingAt = Date.now();
        }
        // Catat pemakaian: 1 pencarian per request (bila pencariannya jalan).
        if (ws?.status === 'ok') keyUsed('xkiro-search', key);

        return {
          text,
          model,
          sources: (ws?.results || [])
            .filter((r) => r.url)
            .map((r) => ({ title: (r.title || '').trim(), url: (r.url || '').trim() })),
          searchStatus: ws?.status ?? null,
          notice: ws?.notice ?? null,
          tokens: data.usage
            ? {
                prompt: data.usage.prompt_tokens ?? 0,
                completion: data.usage.completion_tokens ?? 0,
                total: data.usage.total_tokens ?? 0,
              }
            : undefined,
        };
      } catch {
        // timeout / jaringan: coba model berikutnya
      }
    }
  }
  return null;
}
