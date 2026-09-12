import crypto from 'crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { config } from '../../src/env.js';
import { getTelegramBot } from '../../src/telegram.js';
import { checkDueReminders } from '../../src/remind.js';
import { sendWhatsAppCloudMessageSafe } from '../../src/whatsapp_cloud.js';

function timingSafeMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  // Security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');

  // Verifikasi Cron Secret jika diset di environment Vercel
  if (config.cronSecret) {
    const authHeader = req.headers['authorization'] || '';
    const expected = `Bearer ${config.cronSecret}`;
    if (!timingSafeMatch(authHeader, expected)) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
  } else if (config.isServerless) {
    res.status(403).json({ error: 'CRON_SECRET wajib dikonfigurasi di lingkungan serverless.' });
    return;
  }

  try {
    const bot = getTelegramBot();
    const processed = await checkDueReminders(async (chatId, text, platform) => {
      // Prioritas 1: Platform eksplisit dari database
      if (platform === 'whatsapp') {
        const cleanTo = chatId.replace(/@.*$/, '').replace(/^\+/, '');
        await sendWhatsAppCloudMessageSafe(cleanTo, text);
        return;
      }
      if (platform === 'telegram') {
        await bot.sendMessage(Number(chatId), text);
        return;
      }

      // Fallback: Routing berbasis struktur chatId jika platform belum tercatat
      if (chatId.includes('@') || (chatId.length >= 10 && /^(62|1|\+)/.test(chatId))) {
        const cleanTo = chatId.replace(/@.*$/, '').replace(/^\+/, '');
        await sendWhatsAppCloudMessageSafe(cleanTo, text);
      } else {
        await bot.sendMessage(Number(chatId), text);
      }
    });

    res.status(200).json({ ok: true, processed, timestamp: new Date().toISOString() });
  } catch (err) {
    console.error('[cron/reminders] Error running reminder cron:', err);
    res.status(500).json({ error: 'Internal Error' });
  }
}
