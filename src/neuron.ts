/**
 * KONVERSI NEURON CLOUDFLARE.
 *
 * MASALAH (laporan pemilik produk 06 Okt 2026):
 * "masa baru 2 request sudah habis? kan cloudflare itu hitungannya neuron,
 *  bukan token, betul tidak?"
 *
 * JAWABAN: BENAR. Cloudflare Workers AI membatasi NEURON, bukan token.
 * Dashboard sebelumnya menyamakan keduanya -> salah lapor "KUOTA HABIS"
 * padahal kuncinya masih berfungsi (dibuktikan: HTTP 200).
 *
 * APA ITU NEURON?
 * Neuron adalah satuan komputasi internal Cloudflare. Setiap model punya
 * tarif neuron berbeda per 1 juta token — model besar & output lebih mahal.
 * Contoh (tarif resmi Cloudflare):
 *   @cf/meta/llama-3.2-1b-instruct  :  2.457 neuron/M input  |  18.252 neuron/M output
 *   @cf/meta/llama-3.2-3b-instruct  :  4.625 neuron/M input  |  30.475 neuron/M output
 *   @cf/qwen/qwen3.8-27b            : 40.909 neuron/M input  | 290.909 neuron/M output
 * Kuota gratis: 10.000 neuron/hari.
 *
 * Sumber: https://developers.cloudflare.com/workers-ai/platform/pricing/
 */

/** Tarif neuron per 1 JUTA token (input, output) untuk model yang dipakai. */
export interface TarifNeuron {
  inputPerJuta: number;
  outputPerJuta: number;
}

/**
 * Peta tarif per model. Angka dari dokumentasi resmi Cloudflare.
 * Bila model tidak terdaftar, dipakai tarif KONSERVATIF (tertinggi yang umum)
 * supaya estimasi tidak terlalu optimistis.
 */
export const TARIF_NEURON: Record<string, TarifNeuron> = {
  '@cf/meta/llama-3.2-1b-instruct':        { inputPerJuta: 2457,  outputPerJuta: 18252 },
  '@cf/meta/llama-3.2-3b-instruct':        { inputPerJuta: 4625,  outputPerJuta: 30475 },
  '@cf/meta/llama-3.1-8b-instruct-fp8-fast': { inputPerJuta: 4119, outputPerJuta: 34868 },
  '@cf/meta/llama-3.2-11b-vision-instruct': { inputPerJuta: 4410, outputPerJuta: 61493 },
  '@cf/qwen/qwen3-30b-a3b-fp8':            { inputPerJuta: 4625,  outputPerJuta: 30475 },
  '@cf/qwen/qwen3.8-27b':                  { inputPerJuta: 40909, outputPerJuta: 290909 },
  '@cf/qwen/qwq-32b':                      { inputPerJuta: 60000, outputPerJuta: 90909 },
  '@cf/qwen/qwen2.5-coder-32b-instruct':   { inputPerJuta: 60000, outputPerJuta: 90909 },
};

/** Tarif cadangan bila model tidak dikenal (konservatif). */
export const TARIF_DEFAULT: TarifNeuron = { inputPerJuta: 40909, outputPerJuta: 290909 };

/** Ambil tarif untuk sebuah model. */
export function tarifModel(model: string): TarifNeuron {
  return TARIF_NEURON[model] ?? TARIF_DEFAULT;
}

/** Kuota neuron gratis harian Cloudflare. */
export const NEURON_HARIAN_GRATIS = 10_000;

/**
 * Hitung neuron terpakai dari jumlah token.
 * @param inputTokens  token prompt (system + history + pesan user)
 * @param outputTokens token jawaban model
 * @param model        nama model Cloudflare
 */
export function hitungNeuron(inputTokens: number, outputTokens: number, model: string): number {
  const t = tarifModel(model);
  return Math.round((inputTokens * t.inputPerJuta + outputTokens * t.outputPerJuta) / 1_000_000);
}

/**
 * Perkirakan berapa neuron untuk SATU balasan khas (untuk tampilan dashboard).
 * Default: prompt ~8.000 token (persona besar), jawaban ~300 token.
 */
export function neuronPerBalasanKhas(model: string, promptTok = 8000, outputTok = 300): number {
  return hitungNeuron(promptTok, outputTok, model);
}

/** Berapa balasan khas yang masih bisa dilakukan dari sisa neuron. */
export function sisaBalasan(sisaNeuron: number, model: string, promptTok = 8000, outputTok = 300): number {
  const per = neuronPerBalasanKhas(model, promptTok, outputTok);
  return per > 0 ? Math.floor(sisaNeuron / per) : 0;
}

