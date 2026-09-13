# Deploy Cloudflare Worker Proxy untuk Dahl Global API

## Kenapa perlu ini?
Vercel serverless functions berjalan di IP datacenter AWS. Dahl Global API menggunakan Cloudflare WAF yang memblokir IP AWS, sehingga setiap request dari Vercel mendapat **403 Forbidden** dan sistem langsung failover ke Groq.

Cloudflare Worker berjalan di IP jaringan Cloudflare sendiri — tidak diblokir oleh WAF Dahl.

---

## Opsi A: Deploy via Dashboard (paling mudah, 5 menit)

1. Buka **https://dash.cloudflare.com** → login
2. Klik **Workers & Pages** di sidebar kiri
3. Klik **Create** → **Create Worker**
4. Hapus kode default, paste isi file [`worker.js`](./worker.js)
5. Klik **Deploy**
6. Catat URL yang muncul, contoh: `https://dahl-proxy.YOUR-SUBDOMAIN.workers.dev`

---

## Opsi B: Deploy via CLI (wrangler)

```bash
# Install wrangler jika belum ada
npm install -g wrangler

# Login ke akun Cloudflare
wrangler login

# Masuk ke folder proxy
cd cloudflare-worker/dahl-proxy

# Deploy
wrangler deploy
```

URL akan tercetak di terminal setelah deploy berhasil.

---

## Langkah berikutnya: Update .env

Tambahkan variabel berikut ke `.env` (lokal) dan ke Vercel Dashboard → Settings → Environment Variables:

```env
DAHL_PROXY_URL=https://dahl-proxy.YOUR-SUBDOMAIN.workers.dev
```

Ganti `YOUR-SUBDOMAIN` dengan subdomain Cloudflare Workers akun kamu.

---

## Verifikasi proxy berjalan

Test manual via curl:

```bash
curl -X POST https://dahl-proxy.YOUR-SUBDOMAIN.workers.dev/v1/chat/completions \
  -H "Authorization: Bearer DAHL_KEY_KAMU" \
  -H "Content-Type: application/json" \
  -d '{"model":"deepseek-ai/DeepSeek-V4-Flash-0731","messages":[{"role":"user","content":"hi"}],"max_tokens":10}'
```

Jika dapat respons JSON dari model → proxy berhasil.

---

## Free Tier Cloudflare Workers

| Limit | Nilai |
|---|---|
| Request/hari | 100.000 |
| CPU time/request | 10ms |
| Biaya | Gratis |

100.000 request/hari sangat cukup untuk bot chat personal. Jika melampaui, upgrade ke Workers Paid ($5/bulan untuk 10 juta request).
