import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  extractSessionToken,
  getClientIp,
  verifySessionToken,
} from '../src/admin_auth.js';
import {
  getBaileysBackupSnapshot,
  runManualVpsCheck,
  runManualVpsKeepalive,
  runManualVpsResume,
  setAutoResumeMode,
  setKeepaliveMode,
  type BaileysBackupDeps,
} from '../src/baileys_backup_web.js';
import {
  getLocalAiVpsSnapshot,
  runManualLocalAiVpsCheck,
  runManualLocalAiVpsKeepalive,
  runManualLocalAiVpsResume,
  setLocalAiAutoResumeMode,
  setLocalAiKeepaliveMode,
  setLocalAiPrimaryMode,
  type LocalAiVpsDeps,
} from '../src/local_ai_vps.js';
import { cekRateLimit } from '../src/rate_limit.js';

export interface BaileysBackupHandlerDeps {
  verifyToken?: (token: string) => Promise<boolean>;
  extractToken?: (req: VercelRequest) => string | null;
  getIp?: (req: VercelRequest) => string;
  rateLimit?: typeof cekRateLimit;
  getSnapshot?: () => ReturnType<typeof getBaileysBackupSnapshot>;
  manualCheck?: () => ReturnType<typeof runManualVpsCheck>;
  manualResume?: () => ReturnType<typeof runManualVpsResume>;
  manualKeepalive?: (force?: boolean) => ReturnType<typeof runManualVpsKeepalive>;
  setAutoMode?: (enabled: boolean) => ReturnType<typeof setAutoResumeMode>;
  setKeepalive?: (enabled: boolean) => ReturnType<typeof setKeepaliveMode>;
  serviceDeps?: BaileysBackupDeps;
  aiServiceDeps?: LocalAiVpsDeps;
}

function parsePlainObjectBody(rawBody: unknown): Record<string, unknown> | null {
  if (rawBody === undefined || rawBody === null) return null;
  if (typeof rawBody === 'string') {
    const trimmed = rawBody.trim();
    if (!trimmed) return null;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return null;
    } catch {
      return null;
    }
  }
  if (typeof rawBody === 'object' && !Array.isArray(rawBody)) {
    return rawBody as Record<string, unknown>;
  }
  return null;
}

export function createBaileysBackupHandler(deps: BaileysBackupHandlerDeps = {}) {
  const verifyToken = deps.verifyToken ?? verifySessionToken;
  const extractToken = deps.extractToken ?? extractSessionToken;
  const getIp = deps.getIp ?? getClientIp;
  const rateLimit = deps.rateLimit ?? cekRateLimit;
  const svcDeps = deps.serviceDeps ?? {};
  const aiDeps = deps.aiServiceDeps ?? {};
  const getSnapshot = deps.getSnapshot ?? (() => getBaileysBackupSnapshot(svcDeps));
  const manualCheck = deps.manualCheck ?? (() => runManualVpsCheck(svcDeps));
  const manualResume = deps.manualResume ?? (() => runManualVpsResume(svcDeps));
  const manualKeepalive =
    deps.manualKeepalive ?? ((force?: boolean) => runManualVpsKeepalive(svcDeps, force));
  const setAutoMode = deps.setAutoMode ?? ((enabled: boolean) => setAutoResumeMode(enabled, svcDeps));
  const setKeepalive =
    deps.setKeepalive ?? ((enabled: boolean) => setKeepaliveMode(enabled, svcDeps));

  const isAiTarget = (req: VercelRequest, body?: Record<string, unknown> | null): boolean => {
    const qTarget = typeof req.query?.target === 'string' ? req.query.target.trim().toLowerCase() : '';
    const bTarget = body && typeof body.target === 'string' ? body.target.trim().toLowerCase() : '';
    return qTarget === 'ai' || bTarget === 'ai';
  };

  return async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');

    if (req.method !== 'GET' && req.method !== 'POST') {
      res.status(405).json({ ok: false, error: 'Method Not Allowed' });
      return;
    }

    const token = extractToken(req);
    const isAuthed = token ? await verifyToken(token) : false;
    if (!isAuthed) {
      res.status(401).json({
        ok: false,
        error: 'Unauthorized. Akses dashboard memerlukan Master PIN admin yang valid.',
        authRequired: true,
      });
      return;
    }

    const clientIp = getIp(req);

    try {
      if (req.method === 'GET') {
        const rl = rateLimit(`bb:get:${clientIp}`, 60, 60_000);
        if (!rl.boleh) {
          res.setHeader('Retry-After', String(rl.resetDalamDetik));
          res.status(429).json({
            ok: false,
            error: `Terlalu banyak permintaan. Coba lagi dalam ${rl.resetDalamDetik} detik.`,
          });
          return;
        }

        if (isAiTarget(req)) {
          const aiSnap = await getLocalAiVpsSnapshot(aiDeps);
          res.status(200).json(aiSnap);
          return;
        }
        const result = await getSnapshot();
        res.status(200).json(result);
        return;
      }

      const rlPost = rateLimit(`bb:post:${clientIp}`, 20, 60_000);
      if (!rlPost.boleh) {
        res.setHeader('Retry-After', String(rlPost.resetDalamDetik));
        res.status(429).json({
          ok: false,
          error: `Terlalu banyak permintaan. Coba lagi dalam ${rlPost.resetDalamDetik} detik.`,
        });
        return;
      }

      const body = parsePlainObjectBody(req.body);
      if (!body) {
        res.status(400).json({ ok: false, error: 'Payload JSON tidak valid.' });
        return;
      }

      const action = typeof body.action === 'string' ? body.action.trim().toLowerCase() : '';

      // ── JALUR KHUSUS VPS 2 (LOCAL AI VPS: target=ai) ──
      if (isAiTarget(req, body)) {
        if (action === 'check') {
          const result = await runManualLocalAiVpsCheck(aiDeps);
          res.status(200).json(result);
          return;
        }
        if (action === 'keepalive') {
          const rlPing = rateLimit(`bb:ai:keepalive:${clientIp}`, 12, 60_000);
          if (!rlPing.boleh) {
            res.setHeader('Retry-After', String(rlPing.resetDalamDetik));
            res.status(429).json({
              ok: false,
              error: `Terlalu sering ping VPS 2. Tunggu ${rlPing.resetDalamDetik} detik.`,
            });
            return;
          }
          const result = await runManualLocalAiVpsKeepalive(aiDeps, body.auto !== true);
          res.status(result.httpStatus).json({
            ok: result.ok,
            attempted: result.attempted,
            ...(result.reason ? { reason: result.reason } : {}),
            message: result.message,
            data: result.data,
          });
          return;
        }
        if (action === 'set_keepalive') {
          if (typeof body.keepaliveEnabled !== 'boolean') {
            res.status(400).json({ ok: false, error: 'Parameter keepaliveEnabled harus bernilai boolean.' });
            return;
          }
          const result = await setLocalAiKeepaliveMode(body.keepaliveEnabled, aiDeps);
          res.status(200).json(result);
          return;
        }
        if (action === 'resume') {
          const rlResume = rateLimit(`bb:ai:resume:${clientIp}`, 6, 60_000);
          if (!rlResume.boleh) {
            res.setHeader('Retry-After', String(rlResume.resetDalamDetik));
            res.status(429).json({
              ok: false,
              error: `Terlalu sering mengirim perintah resume VPS 2. Tunggu ${rlResume.resetDalamDetik} detik.`,
            });
            return;
          }
          const result = await runManualLocalAiVpsResume(aiDeps);
          res.status(result.httpStatus).json({
            ok: result.ok,
            status: result.status,
            message: result.message,
            ...(result.retryAfterSecs !== undefined && result.retryAfterSecs !== null
              ? { retryAfterSecs: result.retryAfterSecs }
              : {}),
            data: result.data,
          });
          return;
        }
        if (action === 'set_mode') {
          if (typeof body.autoResumeEnabled !== 'boolean') {
            res.status(400).json({ ok: false, error: 'Parameter autoResumeEnabled harus bernilai boolean.' });
            return;
          }
          const result = await setLocalAiAutoResumeMode(body.autoResumeEnabled, aiDeps);
          res.status(200).json(result);
          return;
        }
        if (action === 'set_primary') {
          if (typeof body.useAsPrimary !== 'boolean') {
            res.status(400).json({ ok: false, error: 'Parameter useAsPrimary harus bernilai boolean.' });
            return;
          }
          const result = await setLocalAiPrimaryMode(body.useAsPrimary, aiDeps);
          res.status(200).json(result);
          return;
        }
        res.status(400).json({
          ok: false,
          error: 'Parameter action untuk VPS 2 harus check, resume, set_mode, keepalive, set_keepalive, atau set_primary.',
        });
        return;
      }
      if (
        action !== 'check' &&
        action !== 'resume' &&
        action !== 'set_mode' &&
        action !== 'keepalive' &&
        action !== 'set_keepalive'
      ) {
        res.status(400).json({
          ok: false,
          error: 'Parameter action harus check, resume, set_mode, keepalive, atau set_keepalive.',
        });
        return;
      }

      if (action === 'check') {
        const result = await manualCheck();
        res.status(200).json(result);
        return;
      }

      if (action === 'keepalive') {
        const rlPing = rateLimit(`bb:keepalive:${clientIp}`, 12, 60_000);
        if (!rlPing.boleh) {
          res.setHeader('Retry-After', String(rlPing.resetDalamDetik));
          res.status(429).json({
            ok: false,
            error: `Terlalu sering ping VPS. Tunggu ${rlPing.resetDalamDetik} detik.`,
          });
          return;
        }

        const result = await manualKeepalive(body.auto !== true);
        res.status(result.httpStatus).json({
          ok: result.ok,
          attempted: result.attempted,
          ...(result.reason ? { reason: result.reason } : {}),
          message: result.message,
          data: result.data,
        });
        return;
      }

      if (action === 'set_keepalive') {
        if (typeof body.keepaliveEnabled !== 'boolean') {
          res.status(400).json({
            ok: false,
            error: 'Parameter keepaliveEnabled harus bernilai boolean.',
          });
          return;
        }

        const result = await setKeepalive(body.keepaliveEnabled);
        res.status(200).json(result);
        return;
      }

      if (action === 'resume') {
        const rlResume = rateLimit(`bb:resume:${clientIp}`, 6, 60_000);
        if (!rlResume.boleh) {
          res.setHeader('Retry-After', String(rlResume.resetDalamDetik));
          res.status(429).json({
            ok: false,
            error: `Terlalu sering mengirim perintah resume. Tunggu ${rlResume.resetDalamDetik} detik.`,
          });
          return;
        }

        const result = await manualResume();
        res.status(result.httpStatus).json({
          ok: result.ok,
          status: result.status,
          message: result.message,
          ...(result.retryAfterSecs !== undefined && result.retryAfterSecs !== null
            ? { retryAfterSecs: result.retryAfterSecs }
            : {}),
          data: result.data,
        });
        return;
      }

      if (typeof body.autoResumeEnabled !== 'boolean') {
        res.status(400).json({
          ok: false,
          error: 'Parameter autoResumeEnabled harus bernilai boolean.',
        });
        return;
      }

      const result = await setAutoMode(body.autoResumeEnabled);
      res.status(200).json(result);
    } catch {
      res.status(500).json({
        ok: false,
        error: 'Gagal memproses permintaan Baileys Backup.',
      });
    }
  };
}

export default createBaileysBackupHandler();
