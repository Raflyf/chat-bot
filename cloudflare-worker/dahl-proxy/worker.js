/**
 * Dahl Global API - Cloudflare Worker Reverse Proxy
 * 
 * Fungsi: Memforward request dari Vercel (IP AWS yang diblokir Dahl)
 *         melalui Cloudflare Worker (IP bersih CF) ke inference.dahl.global
 * 
 * Free tier: 100.000 request/hari — cukup untuk bot chat skala personal.
 * Deploy: wrangler deploy  ATAU  paste ke dashboard workers.cloudflare.com
 */

const DAHL_ORIGIN = 'https://inference.dahl.global';

// Daftar origin yang diizinkan memanggil proxy ini (keamanan dasar)
// Isi dengan domain Vercel kamu, atau kosongkan untuk allow-all sementara
const ALLOWED_ORIGINS = [
  // 'https://projek-no-name.vercel.app',
  // 'https://your-custom-domain.com',
];

export default {
  async fetch(request, env, ctx) {
    // Validasi origin (opsional — aktifkan jika ALLOWED_ORIGINS diisi)
    if (ALLOWED_ORIGINS.length > 0) {
      const origin = request.headers.get('Origin') || '';
      if (!ALLOWED_ORIGINS.includes(origin)) {
        return new Response('Forbidden', { status: 403 });
      }
    }

    // Hanya izinkan POST (semua OpenAI-compatible endpoint pakai POST)
    if (request.method !== 'POST' && request.method !== 'GET') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    // Susun URL tujuan: ganti hostname Worker → inference.dahl.global
    const url = new URL(request.url);
    url.hostname = new URL(DAHL_ORIGIN).hostname;
    url.protocol = 'https:';

    // Salin semua header dari request asli, lalu bersihkan header CF-specific
    const headers = new Headers(request.headers);
    headers.delete('CF-Connecting-IP');
    headers.delete('CF-IPCountry');
    headers.delete('CF-Ray');
    headers.delete('CF-Visitor');
    headers.delete('X-Forwarded-For');
    headers.delete('X-Real-IP');

    // Forward request ke Dahl
    const upstreamReq = new Request(url.toString(), {
      method: request.method,
      headers,
      body: request.body,
      redirect: 'follow',
    });

    try {
      const upstreamRes = await fetch(upstreamReq);

      // Salin response dari Dahl, tambahkan CORS header
      const resHeaders = new Headers(upstreamRes.headers);
      resHeaders.set('Access-Control-Allow-Origin', '*');
      resHeaders.set('X-Proxied-By', 'cf-dahl-proxy');

      return new Response(upstreamRes.body, {
        status: upstreamRes.status,
        statusText: upstreamRes.statusText,
        headers: resHeaders,
      });
    } catch (err) {
      return new Response(
        JSON.stringify({ error: 'proxy_error', message: String(err) }),
        { status: 502, headers: { 'Content-Type': 'application/json' } }
      );
    }
  },
};
