/**
 * RATE LIMIT sederhana berbasis memori.
 *
 * KENAPA: endpoint publik (login admin) bisa dibombardir percobaan.
 * Lockout PIN sudah ada, tapi GET status tidak dibatasi — penyerang bisa
 * memantau kapan lockout berakhir. Modul ini membatasi jumlah permintaan
 * per IP dalam jendela waktu.
 *
 * CATATAN JUJUR: ini IN-MEMORY, jadi pada Vercel serverless batasnya per-instance
 * (tidak lintas instance). Untuk kebutuhan lebih kuat, gunakan Upstash Redis
 * atau simpan di database. Untuk endpoint login, lapisan ini sudah menambah
 * biaya serangan secara signifikan.
 */

interface Catatan {
  hit: number;
  resetAt: number;
}

const peta = new Map<string, Catatan>();
const MAKS_ENTRI = 5000;

export interface HasilRateLimit {
  boleh: boolean;
  sisa: number;
  resetDalamDetik: number;
}

/**
 * Periksa & catat satu permintaan.
 * @param kunci   identitas (mis. `login:${ip}`)
 * @param batas   jumlah maksimum permintaan per jendela
 * @param jendelaMs panjang jendela (ms)
 */
export function cekRateLimit(kunci: string, batas: number, jendelaMs: number): HasilRateLimit {
  const now = Date.now();
  let c = peta.get(kunci);

  if (!c || now >= c.resetAt) {
    c = { hit: 0, resetAt: now + jendelaMs };
    peta.set(kunci, c);
  }
  c.hit += 1;

  // Bersihkan entri lama agar memori tidak tumbuh tanpa batas.
  if (peta.size > MAKS_ENTRI) {
    for (const [k, v] of peta) {
      if (now >= v.resetAt) peta.delete(k);
      if (peta.size <= MAKS_ENTRI / 2) break;
    }
  }

  const sisa = Math.max(0, batas - c.hit);
  return {
    boleh: c.hit <= batas,
    sisa,
    resetDalamDetik: Math.max(0, Math.ceil((c.resetAt - now) / 1000)),
  };
}

/** Ambil IP klien dari header proxy Vercel. */
export function ipDariReq(req: { headers?: Record<string, unknown>; socket?: { remoteAddress?: string } }): string {
  const h = req.headers || {};
  const fwd = h['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.trim()) return fwd.split(',')[0].trim();
  const real = h['x-real-ip'];
  if (typeof real === 'string' && real.trim()) return real.trim();
  return req.socket?.remoteAddress || 'unknown';
}
