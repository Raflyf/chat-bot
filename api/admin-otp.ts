import type { VercelRequest, VercelResponse } from '@vercel/node';
import { config } from '../src/env.js';
import {
  getClientIp,
  verifyPin,
  verifySessionToken,
  extractSessionToken,
  logoutSession,
  sendOtp,
  verifyOtpAndResetPin,
  updatePin,
  getPublicAuthState,
} from '../src/admin_auth.js';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  // CORS & Security Headers
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  // Parse action from query or body
  const query = req.query || {};
  const body = (typeof req.body === 'object' && req.body !== null) ? req.body : {};
  const action = String(query.action || body.action || '').trim().toLowerCase();
  const clientIp = getClientIp(req);

  try {
    // 1. GET AUTH STATE
    if (action === 'get_auth_state' || (!action && req.method === 'GET')) {
      const state = await getPublicAuthState(clientIp);
      res.status(200).json({
        success: true,
        ...state,
      });
      return;
    }

    // 2. VERIFY PIN
    if (action === 'verify_pin') {
      if (req.method !== 'POST') {
        res.status(405).json({ success: false, message: 'Method Not Allowed' });
        return;
      }

      const inputPin = String(body.pin || query.pin || '').trim();
      const inputHash = String(body.pin_hash || query.pin_hash || '').trim();
      const credential = inputHash || inputPin;

      if (!credential) {
        res.status(400).json({ success: false, message: 'PIN atau PIN hash wajib disertakan.' });
        return;
      }

      const result = await verifyPin(credential, clientIp);
      const statusCode = result.verified ? 200 : result.isLocked ? 423 : 401;

      res.status(statusCode).json({
        success: result.success,
        verified: result.verified,
        session_token: result.sessionToken,
        expires_at: result.expiresAt,
        duration_ms: 15 * 60 * 1000,
        is_locked: result.isLocked,
        locked_until: result.lockedUntil,
        lockout_attempts: result.lockoutAttempts,
        remaining_attempts: result.remainingAttempts,
        message: result.message,
      });
      return;
    }

    // 3. SEND OTP
    if (action === 'send_otp') {
      if (req.method !== 'POST') {
        res.status(405).json({ success: false, message: 'Method Not Allowed' });
        return;
      }

      const result = await sendOtp(clientIp);
      const statusCode = result.success ? 200 : result.retryAfterSeconds ? 429 : 500;

      res.status(statusCode).json({
        success: result.success,
        message: result.message,
        expires_at: result.expiresAt,
        target_email_masked: result.targetEmailMasked,
        retry_after_seconds: result.retryAfterSeconds,
      });
      return;
    }

    // 4. VERIFY OTP & RESET PIN
    if (action === 'verify_otp_and_reset_pin') {
      if (req.method !== 'POST') {
        res.status(405).json({ success: false, message: 'Method Not Allowed' });
        return;
      }

      const otpCode = String(body.otp_code || query.otp_code || '').trim();
      const newPin = String(body.new_pin || query.new_pin || '').trim();

      if (!otpCode || !newPin) {
        res.status(400).json({ success: false, message: 'Kode OTP dan PIN baru wajib disertakan.' });
        return;
      }

      const result = await verifyOtpAndResetPin(otpCode, newPin, clientIp);
      const statusCode = result.success ? 200 : 400;

      res.status(statusCode).json({
        success: result.success,
        message: result.message,
      });
      return;
    }

    // 5. UPDATE PIN (Authenticated / with current PIN)
    if (action === 'update_pin') {
      if (req.method !== 'POST') {
        res.status(405).json({ success: false, message: 'Method Not Allowed' });
        return;
      }

      const currentPin = String(body.current_pin || query.current_pin || body.current_pin_hash || '').trim();
      const newPin = String(body.new_pin || query.new_pin || '').trim();

      if (!currentPin || !newPin) {
        res.status(400).json({ success: false, message: 'PIN saat ini dan PIN baru wajib disertakan.' });
        return;
      }

      const result = await updatePin(currentPin, newPin);
      const statusCode = result.success ? 200 : 403;

      res.status(statusCode).json({
        success: result.success,
        message: result.message,
      });
      return;
    }

    // 6. VERIFY SESSION
    if (action === 'verify_session') {
      const token = extractSessionToken(req) || String(body.session_token || query.session_token || '').trim();
      const isValid = token ? await verifySessionToken(token) : false;

      res.status(isValid ? 200 : 401).json({
        success: isValid,
        valid: isValid,
        message: isValid ? 'Sesi admin aktif dan terverifikasi.' : 'Sesi tidak valid atau telah kedaluwarsa.',
      });
      return;
    }

    // 7. LOGOUT
    if (action === 'logout') {
      const token = extractSessionToken(req) || String(body.session_token || query.session_token || '').trim();
      if (token) {
        await logoutSession(token);
      }

      res.status(200).json({
        success: true,
        message: 'Berhasil keluar dari sesi admin.',
      });
      return;
    }

    res.status(400).json({ success: false, message: `Aksi tidak dikenal: ${action}` });
  } catch (err: any) {
    console.error('[api/admin-otp] Gateway error:', err);
    res.status(500).json({ success: false, message: String(err?.message || err), stack: String(err?.stack || '') });
  }
}
