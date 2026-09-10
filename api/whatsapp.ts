import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  verifyWhatsAppWebhook,
  verifyWhatsAppSignature,
  processWhatsAppCloudWebhook,
} from '../src/whatsapp_cloud.js';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  // 1. Tangani GET: Verifikasi Webhook Handshake dari Meta
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'] as string | undefined;
    const token = req.query['hub.verify_token'] as string | undefined;
    const challenge = req.query['hub.challenge'] as string | undefined;

    const result = verifyWhatsAppWebhook(mode, token, challenge);
    if (result.ok && result.challenge) {
      console.log('[api/whatsapp] Webhook verification handshake berhasil.');
      res.status(200).send(result.challenge);
      return;
    }

    console.warn('[api/whatsapp] Webhook verification handshake gagal: token mismatch.');
    res.status(403).send('Forbidden');
    return;
  }

  // 2. Hanya terima POST untuk notifikasi pesan
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  // 3. Verifikasi Keamanan Signature (HMAC-SHA256) jika WHATSAPP_APP_SECRET diset
  const signature = req.headers['x-hub-signature-256'] as string | undefined;
  const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
  if (!verifyWhatsAppSignature(signature, rawBody)) {
    console.warn('[api/whatsapp] Unauthorized request: signature mismatch.');
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const payload = req.body;
  if (!payload || typeof payload !== 'object') {
    res.status(400).json({ error: 'Invalid payload' });
    return;
  }

  try {
    await processWhatsAppCloudWebhook(payload);
    // Selalu kembalikan 200 OK ke Meta agar tidak terjadi Retry Storm
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[api/whatsapp] Error saat memproses pesan WhatsApp:', err);
    res.status(200).json({ ok: false, error: 'Internal Error' });
  }
}
