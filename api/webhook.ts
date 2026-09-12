import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';
import { config } from '../src/env.js';
import { getTelegramBot, processTelegramUpdate } from '../src/telegram.js';
import { logError, logWarn } from '../src/logger.js';

function verifySecretToken(tokenHeader: string | string[] | undefined, secret: string): boolean {
  if (!secret) {
    if (process.env.NODE_ENV === 'test') return true;
    logWarn('[webhook] TELEGRAM_WEBHOOK_SECRET tidak diset, menolak request demi keamanan fail-closed.');
    return false;
  }
  if (!tokenHeader || typeof tokenHeader !== 'string') return false;
  const a = Buffer.from(tokenHeader, 'utf8');
  const b = Buffer.from(secret, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  // Security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');

  // Hanya terima POST dari Telegram
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  // Verifikasi Secret Token Telegram
  const secretHeader = req.headers['x-telegram-bot-api-secret-token'];
  if (!verifySecretToken(secretHeader, config.telegramWebhookSecret)) {
    logWarn('[webhook] Unauthorized request: secret token mismatch');
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const update = req.body;
  if (!update || typeof update !== 'object') {
    res.status(400).json({ error: 'Invalid payload' });
    return;
  }

  try {
    const bot = getTelegramBot();
    await processTelegramUpdate(bot, update);
    res.status(200).json({ ok: true });
  } catch (err) {
    logError('[webhook] Error processing update', { error: String((err as Error)?.message ?? err) });
    // Selalu kembalikan 200 ke Telegram agar tidak terjadi Retry Storm
    res.status(200).json({ ok: false, error: 'Internal Error' });
  }
}
