import crypto from 'crypto';
import type { VercelRequest } from '@vercel/node';
import { db } from './db.js';
import { config } from './env.js';

export interface AdminAuthConfig {
  pinHash: string;
  lockoutAttempts: number;
  lockedUntil: string | null;
  otpCodeHash: string | null;
  otpExpiresAt: string | null;
  sessionTokens: Array<{ token: string; exp: number }>;
}

const ENV_PIN = config.adminPin || '';
const PIN_SALT = config.pinSalt || (config.supabaseKey ? crypto.createHash('sha256').update(config.supabaseKey).digest('hex').slice(0, 32) : 'agentkit_runtime_internal_salt');
const TARGET_EMAIL = config.adminEmail || '';

const DEFAULT_PIN_HASH = ENV_PIN ? hashValue(ENV_PIN) : '';

// In-memory fallback if database is temporarily unavailable
let inMemoryAuthConfig: AdminAuthConfig = {
  pinHash: DEFAULT_PIN_HASH,
  lockoutAttempts: 0,
  lockedUntil: null,
  otpCodeHash: null,
  otpExpiresAt: null,
  sessionTokens: [],
};

// Throttle caches (in-memory fast path)
const otpSendCache = new Map<string, { count: number; start: number; lastSendAt: number }>();
const otpAttemptCache = new Map<string, { count: number; start: number }>();

const OTP_SEND_MAX = 3;
const OTP_SEND_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const OTP_SEND_MIN_INTERVAL_MS = 60 * 1000; // 60 seconds interval
const OTP_MAX_ATTEMPTS = 5;
const OTP_ATTEMPT_WINDOW_MS = 10 * 60 * 1000;

export function hashValue(val: string): string {
  return crypto.createHash('sha256').update(String(val) + PIN_SALT).digest('hex');
}

export function timingSafeMatch(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function getClientIp(req: VercelRequest): string {
  const trusted = req.headers['x-vercel-forwarded-for'];
  if (trusted && typeof trusted === 'string') return trusted.split(',')[0].trim();
  const xff = req.headers['x-forwarded-for'];
  if (xff && typeof xff === 'string') {
    const parts = xff.split(',');
    return (parts[parts.length - 1] || '').trim() || req.socket?.remoteAddress || 'unknown-client';
  }
  return req.socket?.remoteAddress || 'unknown-client';
}

/**
 * Load auth configuration from Supabase.
 * Dual-Store strategy:
 * 1. Tries `admin_auth_config` table
 * 2. If table doesn't exist, reads from `whatsapp_sessions` (filename: '__admin_auth_config.json')
 */
export async function getAuthConfig(): Promise<AdminAuthConfig> {
  const c = db();
  if (!c) return inMemoryAuthConfig;

  try {
    // 1. Try admin_auth_config table
    const { data: tableData, error: tableErr } = await c
      .from('admin_auth_config')
      .select('*')
      .eq('id', 'master_auth')
      .maybeSingle();

    if (!tableErr && tableData) {
      let sessionTokens: Array<{ token: string; exp: number }> = [];
      if (tableData.session_token) {
        try {
          const parsed = JSON.parse(tableData.session_token);
          if (Array.isArray(parsed)) {
            sessionTokens = parsed.filter(s => s && s.token && Number(s.exp) > Date.now());
          }
        } catch {
          // single token legacy string
          if (typeof tableData.session_token === 'string') {
            sessionTokens = [{
              token: tableData.session_token,
              exp: tableData.session_expires_at ? new Date(tableData.session_expires_at).getTime() : Date.now() + 24 * 3600 * 1000
            }];
          }
        }
      }

      if (!tableData.pin_hash && DEFAULT_PIN_HASH) {
        // Auto-provisioning first-run: persist hash default ke database
        saveAuthConfig({ pinHash: DEFAULT_PIN_HASH }).catch(() => {});
      }

      return {
        pinHash: tableData.pin_hash || DEFAULT_PIN_HASH,
        lockoutAttempts: tableData.lockout_attempts || 0,
        lockedUntil: tableData.locked_until || null,
        otpCodeHash: tableData.otp_code_hash || null,
        otpExpiresAt: tableData.otp_expires_at || null,
        sessionTokens,
      };
    }

    // 2. Fallback to whatsapp_sessions (__admin_auth_config.json)
    const { data: waData, error: waErr } = await c
      .from('whatsapp_sessions')
      .select('content')
      .eq('filename', '__admin_auth_config.json')
      .maybeSingle();

    if (!waErr && waData && waData.content) {
      try {
        const parsed = JSON.parse(waData.content);
        return {
          pinHash: parsed.pinHash || DEFAULT_PIN_HASH,
          lockoutAttempts: parsed.lockoutAttempts || 0,
          lockedUntil: parsed.lockedUntil || null,
          otpCodeHash: parsed.otpCodeHash || null,
          otpExpiresAt: parsed.otpExpiresAt || null,
          sessionTokens: Array.isArray(parsed.sessionTokens)
            ? parsed.sessionTokens.filter((s: { token: string; exp: number }) => s && s.token && Number(s.exp) > Date.now())
            : [],
        };
      } catch {
        // malformed json, fallback below
      }
    }

    // 3. If missing in both, fallback to memory
    return inMemoryAuthConfig;
  } catch (e) {
    console.warn('[admin-auth] getAuthConfig error, fallback to memory:', e);
    return inMemoryAuthConfig;
  }
}

/**
 * Persist auth configuration back to Supabase.
 */
export async function saveAuthConfig(updates: Partial<AdminAuthConfig>): Promise<boolean> {
  // Fetch latest state from Supabase to prevent overwriting concurrent updates
  const latest = await getAuthConfig();
  const current: AdminAuthConfig = {
    ...latest,
    ...updates,
  };
  inMemoryAuthConfig = current;

  const c = db();
  if (!c) return true;

  try {
    // 1. Try admin_auth_config table
    const { error: tableErr } = await c
      .from('admin_auth_config')
      .upsert({
        id: 'master_auth',
        pin_hash: current.pinHash,
        lockout_attempts: current.lockoutAttempts,
        locked_until: current.lockedUntil,
        otp_code_hash: current.otpCodeHash,
        otp_expires_at: current.otpExpiresAt,
        session_token: JSON.stringify(current.sessionTokens),
        session_expires_at: current.sessionTokens.length > 0
          ? new Date(Math.max(...current.sessionTokens.map(s => s.exp))).toISOString()
          : null,
        updated_at: new Date().toISOString(),
      });

    if (!tableErr) return true;

    // 2. Fallback to whatsapp_sessions table
    const { error: waErr } = await c
      .from('whatsapp_sessions')
      .upsert({
        filename: '__admin_auth_config.json',
        content: JSON.stringify(current),
      });

    if (!waErr) return true;

    console.warn('[admin-auth] Gagal menyimpan auth config ke Supabase:', waErr.message);
    return false;
  } catch (e) {
    console.warn('[admin-auth] saveAuthConfig exception:', e);
    return false;
  }
}

/**
 * Buat token sesi kriptografis HMAC-SHA256 stateless.
 * Token memuat payload waktu terenkapsulasi dan tanda tangan HMAC yang terikat ke PIN_SALT + pinHash.
 * Jika PIN diubah atau direset, seluruh token aktif sebelumnya otomatis gugur secara universal di semua instance serverless.
 */
export function createSessionToken(
  currentPinHash: string,
  durationMs: number = 15 * 60 * 1000
): { token: string; exp: number } {
  const now = Date.now();
  const exp = now + durationMs;
  const nonce = crypto.randomBytes(16).toString('hex');
  const payloadObj = { iat: now, exp, nonce };
  const payloadStr = Buffer.from(JSON.stringify(payloadObj), 'utf8').toString('base64url');

  const hmacKey = crypto.createHash('sha256').update(PIN_SALT + ':' + currentPinHash).digest();
  const signature = crypto.createHmac('sha256', hmacKey).update(payloadStr).digest('hex');

  const token = `adm_${payloadStr}.${signature}`;
  return { token, exp };
}

/**
 * Validasi token sesi admin (digunakan oleh middleware endpoint /api/stats, /api/dataset, /api/admin-otp).
 */
export async function verifySessionToken(token: string): Promise<boolean> {
  if (!token || typeof token !== 'string' || !token.startsWith('adm_')) {
    return false;
  }

  const config = await getAuthConfig();
  const now = Date.now();

  // 1. Cek token kriptografis HMAC: adm_<payload_base64url>.<signature_hex>
  const raw = token.slice(4); // hilangkan 'adm_'
  const dotIdx = raw.indexOf('.');
  if (dotIdx > 0) {
    const payloadStr = raw.slice(0, dotIdx);
    const signature = raw.slice(dotIdx + 1);

    try {
      const hmacKey = crypto.createHash('sha256').update(PIN_SALT + ':' + config.pinHash).digest();
      const expectedSig = crypto.createHmac('sha256', hmacKey).update(payloadStr).digest('hex');

      if (!timingSafeMatch(signature, expectedSig)) {
        return false;
      }

      const payloadJson = Buffer.from(payloadStr, 'base64url').toString('utf8');
      const payload = JSON.parse(payloadJson);

      if (typeof payload.exp !== 'number' || typeof payload.iat !== 'number') {
        return false;
      }

      // Pastikan token belum kedaluwarsa
      if (now > payload.exp) {
        return false;
      }

      // Pastikan rentang waktu wajar (maksimal 16 menit dari penerbitan untuk mencegah manipulasi waktu)
      if (payload.exp - payload.iat > 16 * 60 * 1000 || payload.iat > now + 60 * 1000) {
        return false;
      }

      return true;
    } catch {
      return false;
    }
  }

  // 2. Fallback untuk token legasi (adm_<hex64>) yang tersimpan di memori/database
  const valid = config.sessionTokens.some(
    s => s && timingSafeMatch(s.token, token) && Number(s.exp) > now
  );
  return valid;
}

/**
 * Ambil token sesi dari request headers.
 */
export function extractSessionToken(req: VercelRequest): string | null {
  const authHeader = req.headers['authorization'];
  if (authHeader && typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  const customHeader = req.headers['x-admin-token'];
  if (customHeader && typeof customHeader === 'string') {
    return customHeader.trim();
  }
  return null;
}

/**
 * Invalidate session token saat logout.
 */
export async function logoutSession(token: string): Promise<boolean> {
  if (!token) return true;
  const current = await getAuthConfig();
  const remaining = current.sessionTokens.filter(s => !timingSafeMatch(s.token, token));
  return await saveAuthConfig({ sessionTokens: remaining });
}

/**
 * Verifikasi Master PIN server-side dengan pembatasan brute-force.
 */
export async function verifyPin(
  inputPinOrHash: string,
  clientIp: string
): Promise<{
  success: boolean;
  verified: boolean;
  sessionToken?: string;
  expiresAt?: number;
  isLocked?: boolean;
  lockedUntil?: string | null;
  lockoutAttempts?: number;
  remainingAttempts?: number;
  message: string;
}> {
  // Selalu hash PIN input dengan PIN_SALT server (tidak mempercayai hash mentah dari client - C1)
  const inputHash = hashValue(inputPinOrHash);
  const now = Date.now();

  const c = db();
  // Coba verifikasi atomik via RPC PostgreSQL terlebih dahulu (C3 & P0-2)
  if (c) {
    try {
      const { data: rpcRes, error: rpcErr } = await c.rpc('rpc_admin_verify_pin', {
        p_pin_hash: inputHash,
      });

      if (!rpcErr && rpcRes && typeof rpcRes === 'object') {
        const res = rpcRes as {
          success?: boolean;
          verified?: boolean;
          is_locked?: boolean;
          locked_until?: string | null;
          lockout_attempts?: number;
          remaining_attempts?: number;
          message?: string;
        };

        if (res.verified) {
          const { token: sessionToken, exp: expiresAt } = createSessionToken(inputHash, 15 * 60 * 1000);
          const current = await getAuthConfig();
          const updatedTokens = [
            ...current.sessionTokens.filter(s => Number(s.exp) > now),
            { token: sessionToken, exp: expiresAt }
          ].slice(-10);

          saveAuthConfig({
            lockoutAttempts: 0,
            lockedUntil: null,
            sessionTokens: updatedTokens,
          }).catch(e => console.warn('[admin-auth] saveAuthConfig async error:', e));

          return {
            success: true,
            verified: true,
            sessionToken,
            expiresAt,
            isLocked: false,
            lockedUntil: null,
            lockoutAttempts: 0,
            remainingAttempts: 5,
            message: 'Autentikasi Master PIN berhasil.',
          };
        }

        // Jika rpcRes bukan verified tapi ada response valid dari DB
        if (res.message && !res.message.includes('belum dikonfigurasi')) {
          return {
            success: false,
            verified: false,
            isLocked: !!res.is_locked,
            lockedUntil: res.locked_until || null,
            lockoutAttempts: res.lockout_attempts || 0,
            remainingAttempts: typeof res.remaining_attempts === 'number' ? res.remaining_attempts : 0,
            message: res.message || 'Master PIN salah.',
          };
        }
      }
    } catch (e) {
      console.warn('[admin-auth] rpc_admin_verify_pin fallback to JS engine:', e);
    }
  }

  // Fallback JS Engine (Dual-Store / In-Memory)
  const current = await getAuthConfig();

  // Check if unconfigured
  if (!current.pinHash) {
    return {
      success: false,
      verified: false,
      isLocked: false,
      lockedUntil: null,
      lockoutAttempts: 0,
      remainingAttempts: 0,
      message: 'Master PIN belum dikonfigurasi di server. Silakan isi ADMIN_PIN di environment variable.',
    };
  }

  // Check if locked
  if (current.lockedUntil && new Date(current.lockedUntil).getTime() > now) {
    return {
      success: false,
      verified: false,
      isLocked: true,
      lockedUntil: current.lockedUntil,
      lockoutAttempts: current.lockoutAttempts,
      remainingAttempts: 0,
      message: 'Akses terkunci sementara karena melebihi batas percobaan PIN. Gunakan pemulihan OTP.',
    };
  }

  // Match comparison
  if (timingSafeMatch(inputHash, current.pinHash)) {
    // Berhasil: buat session token kriptografis HMAC 15 menit
    const { token: sessionToken, exp: expiresAt } = createSessionToken(current.pinHash, 15 * 60 * 1000);

    const updatedTokens = [
      ...current.sessionTokens.filter(s => Number(s.exp) > now),
      { token: sessionToken, exp: expiresAt }
    ].slice(-10); // Simpan maks 10 sesi aktif

    saveAuthConfig({
      lockoutAttempts: 0,
      lockedUntil: null,
      sessionTokens: updatedTokens,
    }).catch(e => console.warn('[admin-auth] saveAuthConfig async error:', e));

    return {
      success: true,
      verified: true,
      sessionToken,
      expiresAt,
      isLocked: false,
      lockedUntil: null,
      lockoutAttempts: 0,
      remainingAttempts: 5,
      message: 'Autentikasi Master PIN berhasil.',
    };
  }

  // Gagal: tambah hitungan percobaan
  const newAttempts = current.lockoutAttempts + 1;
  const willLock = newAttempts >= 5;
  // Kunci selama 15 menit jika gagal 5x berturut-turut
  const lockedUntil = willLock ? new Date(now + 15 * 60 * 1000).toISOString() : null;

  await saveAuthConfig({
    lockoutAttempts: newAttempts,
    lockedUntil,
  });

  return {
    success: false,
    verified: false,
    isLocked: willLock,
    lockedUntil,
    lockoutAttempts: newAttempts,
    remainingAttempts: Math.max(0, 5 - newAttempts),
    message: willLock
      ? 'Batas 5 kali percobaan PIN terlampaui. Sistem dikunci selama 15 menit. Silakan tunggu atau gunakan pemulihan OTP.'
      : `Master PIN salah. Sisa percobaan: ${Math.max(0, 5 - newAttempts)} kali.`,
  };
}

/**
 * Dispatch Email OTP menggunakan Resend API.
 */
async function dispatchEmail(otpCode: string): Promise<{ dispatched: boolean; provider: string; error?: string }> {
  const apiKey = config.resendApiKey;
  const from = config.resendFrom || 'ChatBot Security <onboarding@resend.dev>';
  const to = TARGET_EMAIL;

  if (!apiKey) {
    console.warn('[admin-auth] RESEND_API_KEY tidak dikonfigurasi. Mode cloud log.');
    return { dispatched: false, provider: 'cloud_log', error: 'RESEND_API_KEY is not set' };
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey.trim()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: from,
        to: [to],
        subject: `[Admin Security] Kode OTP Reset Master PIN: ${otpCode}`,
        text: `Halo Admin,\n\nKode OTP verifikasi untuk mereset Master PIN Monitoring Dashboard Anda adalah:\n\nKODE OTP: ${otpCode}\n\nKode ini berlaku selama 10 menit. Jangan berikan kepada siapapun.\n\nJika Anda tidak melakukan permintaan ini, abaikan email ini.\n\n-- FreeAIBot Security System`,
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 32px 24px; background: #090d16; color: #f8fafc; border-radius: 12px; border: 1px solid #24344d;">
            <div style="text-align: center; margin-bottom: 24px;">
              <h2 style="color: #38bdf8; margin: 0; font-size: 20px; font-weight: 700;">FreeAIBot Monitoring Console</h2>
              <p style="color: #94a3b8; font-size: 13px; margin: 4px 0 0 0;">Verifikasi Reset Master PIN</p>
            </div>
            <div style="background: #111827; border: 1px solid #1e293b; border-radius: 8px; padding: 24px; text-align: center;">
              <p style="color: #cbd5e1; font-size: 14px; margin-top: 0;">Berikut adalah kode verifikasi OTP 6-digit untuk mereset Master PIN Anda:</p>
              <div style="margin: 20px 0; padding: 14px; background: #0f172a; border: 1.5px dashed #38bdf8; border-radius: 8px; font-size: 32px; font-weight: 800; letter-spacing: 8px; color: #38bdf8; font-family: monospace;">
                ${otpCode}
              </div>
              <p style="color: #94a3b8; font-size: 12px; margin-bottom: 0;">Kode ini berlaku selama <strong>10 menit</strong>. Jangan berikan kode ini kepada siapapun.</p>
            </div>
            <p style="color: #64748b; font-size: 11px; text-align: center; margin-top: 24px;">Jika Anda tidak melakukan permintaan ini, abaikan pesan ini.</p>
          </div>
        `,
      }),
    });

    const resData = await res.json().catch(() => ({}));
    if (res.ok) {
      return { dispatched: true, provider: 'resend' };
    } else {
      console.warn('[admin-auth] Resend error:', res.status, resData);
      return { dispatched: false, provider: 'resend', error: JSON.stringify(resData) };
    }
  } catch (e: any) {
    console.warn('[admin-auth] Resend fetch failed:', e.message);
    return { dispatched: false, provider: 'resend', error: e.message };
  }
}

/**
 * Kirim kode OTP 6-digit ke email admin.
 */
export async function sendOtp(clientIp: string): Promise<{
  success: boolean;
  message: string;
  expiresAt?: string;
  retryAfterSeconds?: number;
  targetEmailMasked?: string;
}> {
  if (!TARGET_EMAIL) {
    return {
      success: false,
      message: 'Email admin belum dikonfigurasi di environment variable ADMIN_EMAIL.',
    };
  }
  const now = Date.now();
  const rec = otpSendCache.get(clientIp);

  if (rec && now - rec.start > OTP_SEND_WINDOW_MS) {
    otpSendCache.delete(clientIp);
  }

  const currentThrottle = otpSendCache.get(clientIp);
  if (currentThrottle) {
    const elapsed = now - currentThrottle.lastSendAt;
    if (elapsed < OTP_SEND_MIN_INTERVAL_MS) {
      const waitSec = Math.ceil((OTP_SEND_MIN_INTERVAL_MS - elapsed) / 1000);
      return {
        success: false,
        retryAfterSeconds: waitSec,
        message: `Terlalu banyak permintaan. Coba lagi dalam ${waitSec} detik.`,
      };
    }
    if (currentThrottle.count >= OTP_SEND_MAX) {
      const waitSec = Math.ceil((currentThrottle.start + OTP_SEND_WINDOW_MS - now) / 1000);
      return {
        success: false,
        retryAfterSeconds: Math.max(1, waitSec),
        message: `Batas pengiriman OTP terlampaui (maks 3 per 10 menit). Coba lagi dalam ${Math.max(1, waitSec)} detik.`,
      };
    }
  }

  // Generate CSPRNG 6-digit OTP
  const otpCode = crypto.randomInt(100000, 1000000).toString();
  const otpHash = hashValue(otpCode);
  const expiresAt = new Date(now + 10 * 60 * 1000).toISOString();

  // Save OTP in database
  const saved = await saveAuthConfig({
    otpCodeHash: otpHash,
    otpExpiresAt: expiresAt,
  });

  if (!saved) {
    return {
      success: false,
      message: 'Gagal menyimpan status OTP ke server.',
    };
  }

  // Update send throttle
  if (!currentThrottle || now - currentThrottle.start > OTP_SEND_WINDOW_MS) {
    otpSendCache.set(clientIp, { count: 1, start: now, lastSendAt: now });
  } else {
    currentThrottle.count += 1;
    currentThrottle.lastSendAt = now;
  }

  // Send Email
  const emailResult = await dispatchEmail(otpCode);

  const maskedEmail = TARGET_EMAIL.replace(/(.{3})(.*)(@.*)/, '$1***$3');

  return {
    success: true,
    expiresAt,
    targetEmailMasked: maskedEmail,
    message: `Kode verifikasi OTP 6-digit telah dikirim ke ${maskedEmail}. Berlaku 10 menit.`,
  };
}

/**
 * Verifikasi kode OTP dan reset Master PIN baru.
 */
export async function verifyOtpAndResetPin(
  otpCode: string,
  newPin: string,
  clientIp: string
): Promise<{ success: boolean; message: string }> {
  const now = Date.now();

  // Check attempt limiter
  const attemptRec = otpAttemptCache.get(clientIp);
  if (attemptRec) {
    if (now - attemptRec.start > OTP_ATTEMPT_WINDOW_MS) {
      otpAttemptCache.delete(clientIp);
    } else if (attemptRec.count >= OTP_MAX_ATTEMPTS) {
      return {
        success: false,
        message: 'Terlalu banyak percobaan OTP gagal. Minta kode baru atau tunggu 10 menit.',
      };
    }
  }

  const enteredOtp = String(otpCode || '').trim();
  const cleanNewPin = String(newPin || '').trim();

  if (!/^\d{6}$/.test(enteredOtp)) {
    return { success: false, message: 'Format kode OTP harus 6 digit angka.' };
  }

  if (cleanNewPin.length < 4 || cleanNewPin.length > 8 || !/^\d+$/.test(cleanNewPin)) {
    return { success: false, message: 'Master PIN baru harus berupa 4 hingga 8 digit angka.' };
  }

  const current = await getAuthConfig();

  if (!current.otpCodeHash || !current.otpExpiresAt) {
    return { success: false, message: 'Tidak ada kode OTP aktif. Silakan minta kode OTP baru.' };
  }

  if (new Date(current.otpExpiresAt).getTime() < now) {
    return { success: false, message: 'Kode OTP telah kadaluwarsa. Silakan minta kode OTP baru.' };
  }

  const inputOtpHash = hashValue(enteredOtp);

  if (!timingSafeMatch(inputOtpHash, current.otpCodeHash)) {
    // Record failure
    const rec = otpAttemptCache.get(clientIp);
    if (!rec || now - rec.start > OTP_ATTEMPT_WINDOW_MS) {
      otpAttemptCache.set(clientIp, { count: 1, start: now });
    } else {
      rec.count += 1;
    }
    return { success: false, message: 'Kode OTP tidak cocok. Periksa kembali email Anda.' };
  }

  // OTP Valid: reset PIN, bersihkan lockout, hapus semua token sesi lama
  otpAttemptCache.delete(clientIp);

  const newPinHash = hashValue(cleanNewPin);
  const updated = await saveAuthConfig({
    pinHash: newPinHash,
    lockoutAttempts: 0,
    lockedUntil: null,
    otpCodeHash: null,
    otpExpiresAt: null,
    sessionTokens: [], // invalidate all sessions on credential change
  });

  if (!updated) {
    return { success: false, message: 'Gagal memperbarui PIN di database.' };
  }

  return {
    success: true,
    message: 'Master PIN keamanan berhasil diperbarui dan status penguncian telah direset.',
  };
}

/**
 * Update PIN langsung jika pengguna tahu PIN saat ini.
 */
export async function updatePin(
  currentPinOrHash: string,
  newPin: string,
): Promise<{ success: boolean; message: string }> {
  const cleanNewPin = String(newPin || '').trim();
  if (cleanNewPin.length < 4 || cleanNewPin.length > 8 || !/^\d+$/.test(cleanNewPin)) {
    return { success: false, message: 'PIN baru harus berupa 4 hingga 8 digit angka.' };
  }

  const currentHash = hashValue(currentPinOrHash);
  const newPinHash = hashValue(cleanNewPin);

  const c = db();
  // Prioritaskan eksekusi atomik RPC PostgreSQL (C6 & F4)
  if (c) {
    try {
      const { data: rpcRes, error: rpcErr } = await c.rpc('rpc_admin_change_pin', {
        p_old_pin_hash: currentHash,
        p_new_pin_hash: newPinHash,
      });

      if (!rpcErr && rpcRes && typeof rpcRes === 'object') {
        const res = rpcRes as { success?: boolean; message?: string };
        return {
          success: !!res.success,
          message: res.message || (res.success ? 'Master PIN berhasil diubah di seluruh sesi.' : 'Gagal mengubah PIN.'),
        };
      }
    } catch (e) {
      console.warn('[admin-auth] rpc_admin_change_pin fallback to JS:', e);
    }
  }

  // Fallback ke JS Engine
  const current = await getAuthConfig();
  const now = Date.now();

  // Cek apakah sistem sedang terkunci (C3 & P1-2)
  if (current.lockedUntil && new Date(current.lockedUntil).getTime() > now) {
    return {
      success: false,
      message: 'Akses terkunci sementara karena melebihi batas percobaan PIN. Gunakan pemulihan OTP.',
    };
  }

  if (!timingSafeMatch(currentHash, current.pinHash)) {
    const newAttempts = current.lockoutAttempts + 1;
    const willLock = newAttempts >= 5;
    const lockedUntil = willLock ? new Date(now + 15 * 60 * 1000).toISOString() : null;

    await saveAuthConfig({
      lockoutAttempts: newAttempts,
      lockedUntil,
    });

    return {
      success: false,
      message: willLock
        ? 'Batas 5 kali percobaan PIN terlampaui. Sistem dikunci selama 15 menit. Silakan gunakan pemulihan OTP.'
        : `Master PIN saat ini tidak cocok. Sisa percobaan: ${Math.max(0, 5 - newAttempts)} kali.`,
    };
  }

  await saveAuthConfig({
    pinHash: newPinHash,
    lockoutAttempts: 0,
    lockedUntil: null,
    sessionTokens: [], // invalidate all sessions on credential change
  });

  return {
    success: true,
    message: 'Master PIN berhasil diubah di seluruh sesi.',
  };
}

/**
 * Mengambil status publik autentikasi (apakah sedang lockout, sisa percobaan).
 * Tidak membocorkan hash atau data privat apapun.
 */
export async function getPublicAuthState(clientIp: string): Promise<{
  isLocked: boolean;
  lockedUntil: string | null;
  lockoutAttempts: number;
  remainingAttempts: number;
  hasActiveOtp: boolean;
  targetEmailMasked: string;
}> {
  const current = await getAuthConfig();
  const now = Date.now();
  const isLocked = !!(current.lockedUntil && new Date(current.lockedUntil).getTime() > now);
  const hasActiveOtp = !!(current.otpCodeHash && current.otpExpiresAt && new Date(current.otpExpiresAt).getTime() > now);
  const maskedEmail = TARGET_EMAIL.replace(/(.{3})(.*)(@.*)/, '$1***$3');

  return {
    isLocked,
    lockedUntil: isLocked ? current.lockedUntil : null,
    lockoutAttempts: current.lockoutAttempts,
    remainingAttempts: Math.max(0, 5 - current.lockoutAttempts),
    hasActiveOtp,
    targetEmailMasked: maskedEmail,
  };
}
