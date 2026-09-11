import type { VercelRequest, VercelResponse } from '@vercel/node';
import { config } from '../../src/env.js';
import { getTelegramBot } from '../../src/telegram.js';
import { checkDueReminders } from '../../src/remind.js';
import { sendWhatsAppCloudMessageSafe } from '../../src/whatsapp_cloud.js';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  // Verifikasi Cron Secret jika diset di environment Vercel
  if (config.cronSecret) {
    const authHeader = req.headers['authorization'];
    if (authHeader !== `Bearer ${config.cronSecret}`) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
  }

  try {
    const bot = getTelegramBot();
    const processed = await checkDueReminders(async (chatId, text) => {
      // Routing cerdas: kirim via WhatsApp jika chatId nomor telepon / JID, selain itu kirim via Telegram
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
