import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  verifyWhatsAppWebhook,
  verifyWhatsAppSignature,
  processWhatsAppCloudWebhook,
} from '../src/whatsapp_cloud.js';
import { logError, logInfo, logWarn } from '../src/logger.js';

export const config = {
  api: {
    bodyParser: false,
  },
};

async function readRawBody(req: VercelRequest): Promise<Buffer> {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return Buffer.from(req.body, 'utf8');
  if ((req as any).rawBody && Buffer.isBuffer((req as any).rawBody)) return (req as any).rawBody;

  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  // Security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');

  // 1. Tangani GET: Verifikasi Webhook Handshake dari Meta
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'] as string | undefined;
    const token = req.query['hub.verify_token'] as string | undefined;
    const challenge = req.query['hub.challenge'] as string | undefined;

    const result = verifyWhatsAppWebhook(mode, token, challenge);
    if (result.ok && result.challenge) {
      logInfo('[api/whatsapp] Webhook verification handshake berhasil.');
      res.status(200).send(result.challenge);
      return;
    }

    logWarn('[api/whatsapp] Webhook verification handshake gagal: token mismatch.');
    res.status(403).send('Forbidden');
    return;
  }

  // 2. Hanya terima POST untuk notifikasi pesan
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  // 3. Verifikasi Keamanan Signature (HMAC-SHA256) atas byte mentah (D2 & E3)
  const signature = req.headers['x-hub-signature-256'] as string | undefined;
  const rawBuf = await readRawBody(req);

  if (!verifyWhatsAppSignature(signature, rawBuf)) {
    logWarn('[api/whatsapp] Unauthorized request: signature mismatch.');
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  let payload: any = null;
  if (rawBuf.length > 0) {
    try {
      payload = JSON.parse(rawBuf.toString('utf8'));
    } catch {
      res.status(400).json({ error: 'Invalid JSON payload' });
      return;
    }
  } else if (req.body && typeof req.body === 'object') {
    payload = req.body;
  }

  if (!payload || typeof payload !== 'object') {
    res.status(400).json({ error: 'Invalid payload' });
    return;
  }

  try {
    await processWhatsAppCloudWebhook(payload);
    // Selalu kembalikan 200 OK ke Meta agar tidak terjadi Retry Storm
    res.status(200).json({ ok: true });
  } catch (err) {
    logError('[api/whatsapp] Error saat memproses pesan WhatsApp', { error: String((err as Error)?.message ?? err) });
    res.status(200).json({ ok: false, error: 'Internal Error' });
  }
}
