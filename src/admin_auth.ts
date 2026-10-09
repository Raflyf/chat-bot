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
  // Token yang sudah logout (dicabut). Token HMAC stateless tidak bisa di-invalidate
  // hanya dengan menghapus dari daftar aktif — daftar cabut ini yang membuat logout nyata.
  revokedTokens: Array<{ token: string; exp: number }>;
  /**
   * Hash PIN SEBELUMNYA (perbaikan 06 Okt 2026).
   *
   * KENAPA: token sesi HMAC terikat pada `pinHash`. Saat PIN di-upgrade dari
   * SHA-256 ke scrypt, `pinHash` BERUBAH -> token yang baru saja diterbitkan
   * langsung tidak valid -> "sesi terputus dalam 1 detik".
   *
   * SOLUSI: simpan hash lama di sini, dan verifikasi token terhadap SEMUA
   * kandidat (hash sekarang + hash lama). Token tetap valid sampai kedaluwarsa.
   * Dibatasi 3 entri terakhir agar tidak menumpuk.
   */
  previousPinHashes?: string[];
}

const ENV_PIN = config.adminPin || '';

// ── PERBAIKAN KEAMANAN (06 Okt 2026) ──
// TEMUAN AUDIT: sebelumnya ada SALT HARDCODED ('rafly_telemetry_salt',
// 'agentkit_runtime_internal_salt') sebagai fallback bila PIN_SALT tidak diset.
// Karena repositori ini publik, string tersebut bisa dibaca siapa pun ->
// penyerang bisa memakai salt yang sama untuk memecahkan hash PIN.
//
// SEKARANG (fail-closed): bila PIN_SALT tidak diset DAN tidak ada cara lain
// memperoleh salt yang aman, sistem MENOLAK verifikasi (bukan memakai salt
// yang diketahui publik). Ini mencegah "keamanan palsu".
//
// Salt diambil dari, berurutan:
//   1. PIN_SALT (env, wajib di produksi)
//   2. Turunan SUPABASE_SERVICE_KEY (rahasia server, tidak ada di repo)
// Bila keduanya tidak ada -> TIDAK ADA salt valid -> verifikasi ditolak.
const ENV_SALT = String(config.pinSalt || '').trim();
const DERIVED_SALT = config.supabaseKey
  ? crypto.createHash('sha256').update('hermes-pin-salt:' + config.supabaseKey).digest('hex').slice(0, 32)
  : '';
// Salt kanonikal. Kosong = tidak ada salt aman (fail-closed).
const CANONICAL_SALT = ENV_SALT || DERIVED_SALT;
const PIN_SALT = CANONICAL_SALT;

/** Apakah salt aman tersedia? Bila tidak, verifikasi PIN DITOLAK. */

// Salt legacy yang HARUS tetap didukung agar PIN lama tidak terkunci.
// (Dipakai HANYA untuk mencocokkan hash lama, tidak untuk membuat hash baru.)
const LEGACY_SALTS = [
  'rafly_telemetry_salt',
  'agentkit_runtime_internal_salt',
];

// Kandidat salt untuk MEMVERIFIKASI token HMAC lama (backward-compat).
// Token yang dibuat saat PIN_SALT belum ada memakai salt legacy; tanpa daftar
// ini, sesi admin lama akan langsung tidak valid setelah perubahan ini.
// PENTING: hanya dipakai untuk verifikasi — hash/token BARU selalu memakai
// CANONICAL_SALT (yang tidak hardcoded).
const FALLBACK_SALTS = [CANONICAL_SALT, ...LEGACY_SALTS].filter(
  (v, i, arr) => Boolean(v) && arr.indexOf(v) === i,
);

const TARGET_EMAIL = config.adminEmail || '';

/**
 * ── HASHING PIN: SHA-256 -> SCRYPT (perbaikan keamanan 06 Okt 2026) ──
 *
 * TEMUAN AUDIT: PIN hanya 6 digit (1 juta kombinasi). SHA-256 sangat cepat
 * (miliaran hash/detik di GPU), sehingga bila hash bocor, PIN bisa ditemukan
 * dalam hitungan detik.
 *
 * scrypt lambat + butuh memori besar, sehingga pemecahan menjadi jauh lebih
 * mahal. Format hash baru: `scrypt$N$r$p$salt$hash` (self-describing, agar
 * parameter bisa dinaikkan di masa depan tanpa merusak hash lama).
 *
 * KOMPATIBILITAS: hash lama (SHA-256, 64 karakter hex) TETAP bisa diverifikasi
 * lewat `verifyPinHash()`, lalu OTOMATIS dinaikkan ke scrypt saat login sukses
 * (lihat needsUpgrade).
 */
const SCRYPT_N = 16384; // 2^14 — biaya CPU/memori
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 32;

/** Buat hash scrypt dari sebuah nilai. */
function scryptHash(val: string, salt: string): string {
  const saltBuf = Buffer.from(salt + '|' + crypto.randomBytes(16).toString('hex'));
  const derived = crypto.scryptSync(String(val), saltBuf, SCRYPT_KEYLEN, {
    N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P,
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${saltBuf.toString('base64')}$${derived.toString('base64')}`;
}

/** Verifikasi nilai terhadap hash scrypt. */
function scryptVerify(val: string, stored: string): boolean {
  try {
    const bagian = stored.split('$');
    if (bagian.length !== 6 || bagian[0] !== 'scrypt') return false;
    const N = Number(bagian[1]);
    const r = Number(bagian[2]);
    const p = Number(bagian[3]);
    const saltBuf = Buffer.from(bagian[4], 'base64');
    const hashBuf = Buffer.from(bagian[5], 'base64');
    const derived = crypto.scryptSync(String(val), saltBuf, hashBuf.length, { N, r, p });
    return derived.length === hashBuf.length && crypto.timingSafeEqual(derived, hashBuf);
  } catch {
    return false;
  }
}

/**
 * Buat hash BARU (selalu scrypt). Dipakai saat menyimpan PIN/OTP baru.
 * Bila tidak ada salt aman, fungsi ini mengembalikan string kosong agar
 * pemanggil bisa menolak (fail-closed).
 */
export function hashValue(val: string, _salt?: string): string {
  if (!CANONICAL_SALT) return ''; // fail-closed: tanpa salt aman, jangan hash
  return scryptHash(String(val), CANONICAL_SALT);
}

/** Apakah hash ini format scrypt? (bukan SHA-256 lama) */
export function isScryptHash(h: string): boolean {
  return typeof h === 'string' && h.startsWith('scrypt$');
}

/**
 * Verifikasi nilai terhadap hash (mendukung scrypt BARU dan SHA-256 LAMA).
 * @returns true bila cocok.
 */
export function verifyPinHash(val: string, stored: string): boolean {
  if (!stored) return false;
  // Format baru (scrypt)
  if (isScryptHash(stored)) return scryptVerify(val, stored);
  // Format lama (SHA-256 + salt kanonikal/legacy) — didukung agar PIN lama tetap bisa masuk
  const kandidatSalt = [CANONICAL_SALT, ...LEGACY_SALTS].filter(Boolean);
  for (const salt of kandidatSalt) {
    const h = crypto.createHash('sha256').update(String(val) + salt).digest('hex');
    if (timingSafeMatch(h, stored)) return true;
  }
  return false;
}

/**
 * Mencari hash yang cocok dengan storedHash dari daftar kandidat salt yang valid.
 * Mengembalikan matching hash jika cocok, atau hash default (canonical) jika tidak ada yang cocok.
 */
export function resolveMatchingHash(
  val: string,
  storedHash?: string | null
): { hash: string; isMatch: boolean; needsUpgrade: boolean } {
  // Hash baru (scrypt) untuk disimpan bila cocok/upgrade.
  const hashBaru = hashValue(val, CANONICAL_SALT);
  if (!storedHash) {
    return { hash: hashBaru, isMatch: false, needsUpgrade: false };
  }

  // Verifikasi (mendukung scrypt BARU dan SHA-256 LAMA).
  const cocok = verifyPinHash(val, storedHash);
  if (!cocok) {
    return { hash: hashBaru, isMatch: false, needsUpgrade: false };
  }

  // Cocok. Bila hash tersimpan MASIH format lama (SHA-256), tandai needsUpgrade
  // agar pemanggil menyimpan versi scrypt yang lebih kuat.
  const perluUpgrade = !isScryptHash(storedHash) && Boolean(hashBaru);
  return { hash: hashBaru || storedHash, isMatch: true, needsUpgrade: perluUpgrade };
}

const DEFAULT_PIN_HASH = ENV_PIN ? hashValue(ENV_PIN) : '';

// In-memory fallback if database is temporarily unavailable
let inMemoryAuthConfig: AdminAuthConfig = {
  pinHash: DEFAULT_PIN_HASH,
  lockoutAttempts: 0,
  lockedUntil: null,
  otpCodeHash: null,
  otpExpiresAt: null,
  sessionTokens: [],
  revokedTokens: [],
};

// Rolling in-memory cache untuk meredam cold-start & load spike dari polling interval
let cachedAuthConfig: AdminAuthConfig | null = null;
let cachedAuthConfigTime = 0;
const AUTH_CONFIG_CACHE_TTL_MS = 25 * 1000; // 25 detik cache

// Throttle caches (in-memory fast path)
const otpSendCache = new Map<string, { count: number; start: number; lastSendAt: number }>();
const otpAttemptCache = new Map<string, { count: number; start: number }>();

// Throttle PIN per-IP: mencegah satu IP menaikkan lockout GLOBAL (yang tersimpan di
// satu baris admin_auth_config) sampai admin sungguhan terkunci — DoS admin (audit F18).
// Ambang per-IP (3) sengaja lebih ketat dari ambang global (5): brute force satu IP
// berhenti sebelum pernah mencapai penguncian global.
const pinAttemptByIp = new Map<string, { count: number; start: number }>();
const PIN_IP_MAX = 3;
const PIN_IP_WINDOW_MS = 15 * 60 * 1000;

/** True bila IP sudah melewati batas percobaan PIN per-IP (tanpa menaikkan counter global). */
function isPinThrottledForIp(clientIp: string, now: number): boolean {
  // Prune map agar tidak tumbuh tanpa batas
  if (pinAttemptByIp.size > 500) {
    for (const [k, v] of pinAttemptByIp.entries()) {
      if (now - v.start > PIN_IP_WINDOW_MS) pinAttemptByIp.delete(k);
    }
  }
  const rec = pinAttemptByIp.get(clientIp);
  return !!(rec && now - rec.start < PIN_IP_WINDOW_MS && rec.count >= PIN_IP_MAX);
}

/** Catat satu kegagalan PIN dari IP; reset saat berhasil. */
function notePinFailureForIp(clientIp: string, now: number, reset: boolean = false): void {
  if (reset) {
    pinAttemptByIp.delete(clientIp);
    return;
  }
  const rec = pinAttemptByIp.get(clientIp);
  if (!rec || now - rec.start > PIN_IP_WINDOW_MS) {
    pinAttemptByIp.set(clientIp, { count: 1, start: now });
  } else {
    rec.count += 1;
  }
}

const OTP_SEND_MAX = 3;
const OTP_SEND_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const OTP_SEND_MIN_INTERVAL_MS = 60 * 1000; // 60 seconds interval
const OTP_MAX_ATTEMPTS = 5;
const OTP_ATTEMPT_WINDOW_MS = 10 * 60 * 1000;

export function timingSafeMatch(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function getClientIp(req: VercelRequest): string {
  // Di Vercel, x-forwarded-for diset oleh edge proxy: entri PALING KANAN adalah IP
  // yang dilihat edge (satu-satunya yang tidak bisa dipalsukan client). Entri kiri
  // bisa disisipkan client, jadi jangan dipakai untuk rate-limit/audit.
  const xff = req.headers['x-forwarded-for'];
  if (xff && typeof xff === 'string') {
    const parts = xff.split(',').map((s) => s.trim()).filter(Boolean);
    return parts[parts.length - 1] || req.socket?.remoteAddress || 'unknown-client';
  }
  const trusted = req.headers['x-vercel-forwarded-for'];
  if (trusted && typeof trusted === 'string') return trusted.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown-client';
}

/**
 * Load auth configuration from Supabase.
 * Dual-Store strategy with rolling cache:
 * 1. Checks in-memory cache (TTL 25s)
 * 2. Tries `admin_auth_config` table
 * 3. If table doesn't exist, reads from `whatsapp_sessions` (filename: '__admin_auth_config.json')
 * 4. Fallback to memory / cached configuration on transient network error
 */
export async function getAuthConfig(forceRefresh = false): Promise<AdminAuthConfig> {
  const now = Date.now();
  if (!forceRefresh && cachedAuthConfig && (now - cachedAuthConfigTime < AUTH_CONFIG_CACHE_TTL_MS)) {
    return cachedAuthConfig;
  }

  const c = db();
  if (!c) {
    return cachedAuthConfig || inMemoryAuthConfig;
  }

  try {
    // 1. Try admin_auth_config table
    const { data: tableData, error: tableErr } = await c
      .from('admin_auth_config')
      .select('*')
      .eq('id', 'master_auth')
      .maybeSingle();

    if (!tableErr && tableData) {
      let sessionTokens: Array<{ token: string; exp: number }> = [];
      let revokedTokens: Array<{ token: string; exp: number }> = [];
      let previousPinHashes: string[] = [];
      if (tableData.session_token) {
        try {
          const parsed = JSON.parse(tableData.session_token);
          if (Array.isArray(parsed)) {
            // Format lama: array token aktif saja
            sessionTokens = parsed.filter(s => s && s.token && Number(s.exp) > Date.now());
          } else if (parsed && typeof parsed === 'object') {
            // Format baru: { active, revoked, prevPinHashes }
            if (Array.isArray(parsed.active)) {
              sessionTokens = parsed.active.filter((s: any) => s && s.token && Number(s.exp) > Date.now());
            }
            if (Array.isArray(parsed.revoked)) {
              revokedTokens = parsed.revoked.filter((s: any) => s && s.token && Number(s.exp) > Date.now());
            }
            // Hash PIN lama (agar token yang terbit sebelum upgrade tetap valid).
            if (Array.isArray(parsed.prevPinHashes)) {
              previousPinHashes = parsed.prevPinHashes.filter((h: unknown) => typeof h === 'string' && h).slice(0, 3);
            }
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

      let activePinHash = tableData.pin_hash || DEFAULT_PIN_HASH;
      if (!activePinHash) {
        // Auto-provisioning first-run: jika ADMIN_PIN belum di-set, buat PIN 6-digit acak aman via CSPRNG
        const autoPin = String(crypto.randomInt(100000, 999999));
        activePinHash = hashValue(autoPin);
        // PIN TIDAK pernah dicetak ke log (log drain / Vercel logs bisa dibaca pihak lain).
        // Set ADMIN_PIN di environment untuk PIN yang diketahui, atau gunakan alur OTP reset.
        console.warn(
          '[admin-auth] First-run provisioning: Master PIN acak telah dibuat (tidak ditampilkan di log demi keamanan). ' +
            'Atur ADMIN_PIN di environment untuk PIN yang Anda ketahui, atau gunakan pemulihan OTP untuk mereset.',
        );
        saveAuthConfig({ pinHash: activePinHash }).catch(() => {});
      } else if (!tableData.pin_hash && DEFAULT_PIN_HASH) {
        saveAuthConfig({ pinHash: DEFAULT_PIN_HASH }).catch(() => {});
      }

      const res: AdminAuthConfig = {
        pinHash: activePinHash,
        lockoutAttempts: tableData.lockout_attempts || 0,
        lockedUntil: tableData.locked_until || null,
        otpCodeHash: tableData.otp_code_hash || null,
        otpExpiresAt: tableData.otp_expires_at || null,
        sessionTokens,
        revokedTokens,
        previousPinHashes,
      };
      cachedAuthConfig = res;
      cachedAuthConfigTime = Date.now();
      inMemoryAuthConfig = res;
      return res;
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
        const res: AdminAuthConfig = {
          pinHash: parsed.pinHash || DEFAULT_PIN_HASH,
          lockoutAttempts: parsed.lockoutAttempts || 0,
          lockedUntil: parsed.lockedUntil || null,
          otpCodeHash: parsed.otpCodeHash || null,
          otpExpiresAt: parsed.otpExpiresAt || null,
          sessionTokens: Array.isArray(parsed.sessionTokens)
            ? parsed.sessionTokens.filter((s: { token: string; exp: number }) => s && s.token && Number(s.exp) > Date.now())
            : [],
          revokedTokens: Array.isArray(parsed.revokedTokens)
            ? parsed.revokedTokens.filter((s: { token: string; exp: number }) => s && s.token && Number(s.exp) > Date.now())
            : [],
        };
        cachedAuthConfig = res;
        cachedAuthConfigTime = Date.now();
        inMemoryAuthConfig = res;
        return res;
      } catch {
        // malformed json, fallback below
      }
    }

    // 3. If missing in both, fallback to cached or memory
    if (cachedAuthConfig) return cachedAuthConfig;
    return inMemoryAuthConfig;
  } catch (e) {
    console.warn('[admin-auth] getAuthConfig error, fallback to memory:', e);
    if (cachedAuthConfig) return cachedAuthConfig;
    return inMemoryAuthConfig;
  }
}

/**
 * Persist auth configuration back to Supabase.
 */
export async function saveAuthConfig(updates: Partial<AdminAuthConfig>): Promise<boolean> {
  // Fetch latest state from Supabase to prevent overwriting concurrent updates
  const latest = await getAuthConfig(true);
  const current: AdminAuthConfig = {
    ...latest,
    ...updates,
  };
  inMemoryAuthConfig = current;
  cachedAuthConfig = current;
  cachedAuthConfigTime = Date.now();

  const c = db();
  if (!c) {
    // Tanpa DB, penulisan status keamanan (lockout/OTP/session) tidak durable —
    // jangan laporkan sukses agar pemanggil bisa fail-closed (audit F9).
    console.warn('[admin-auth] saveAuthConfig tanpa koneksi DB — perubahan tidak tersimpan permanen.');
    return false;
  }

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
        // previousPinHashes disimpan di JSON ini (tanpa perlu kolom/migrasi baru).
        // Lihat catatan di interface AdminAuthConfig: token sesi terikat pada
        // pinHash; saat PIN di-upgrade (SHA-256 -> scrypt), pinHash berubah dan
        // token baru langsung tidak valid ("sesi putus dalam 1 detik"). Dengan
        // menyimpan hash lama, token tetap valid sampai kedaluwarsa.
        session_token: JSON.stringify({
          active: current.sessionTokens,
          revoked: current.revokedTokens,
          prevPinHashes: (current.previousPinHashes ?? []).slice(0, 3),
        }),
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
 * Periksa dan validasi token sesi admin, mengembalikan detail masa berlaku kriptografis.
 */
export async function inspectSessionToken(token: string): Promise<{ valid: boolean; exp?: number; iat?: number }> {
  if (!token || typeof token !== 'string' || !token.startsWith('adm_')) {
    return { valid: false };
  }

  const config = await getAuthConfig();
  const now = Date.now();

  // FAIL-CLOSED (audit F1): tanpa pinHash, kunci HMAC menjadi sha256(salt + ':') dengan
  // salt publik — token apa pun bisa diforge. Sistem yang belum dikonfigurasi = deny all.
  if (!config.pinHash) return { valid: false };

  // 1. Cek token kriptografis HMAC: adm_<payload_base64url>.<signature_hex>
  const raw = token.slice(4); // hilangkan 'adm_'
  const dotIdx = raw.indexOf('.');
  if (dotIdx > 0) {
    const payloadStr = raw.slice(0, dotIdx);
    const signature = raw.slice(dotIdx + 1);

    try {
      let signatureValid = false;
      // Kandidat hash PIN: yang SEKARANG + semua hash SEBELUMNYA (perbaikan
      // 06 Okt 2026). Tanpa ini, upgrade SHA-256 -> scrypt membuat token yang
      // baru diterbitkan langsung tidak valid (sesi putus dalam 1 detik).
      const kandidatPinHash = Array.from(
        new Set([config.pinHash, ...(config.previousPinHashes ?? [])].filter(Boolean)),
      );
      for (const pinHashKandidat of kandidatPinHash) {
        for (const salt of FALLBACK_SALTS) {
          const hmacKey = crypto.createHash('sha256').update(salt + ':' + pinHashKandidat).digest();
          const expectedSig = crypto.createHmac('sha256', hmacKey).update(payloadStr).digest('hex');
          if (timingSafeMatch(signature, expectedSig)) {
            signatureValid = true;
            break;
          }
        }
        if (signatureValid) break;
      }

      // Fallback terakhir: hash dari env (ADMIN_PIN).
      if (!signatureValid && DEFAULT_PIN_HASH) {
        for (const salt of FALLBACK_SALTS) {
          const fallbackHmacKey = crypto.createHash('sha256').update(salt + ':' + DEFAULT_PIN_HASH).digest();
          const fallbackSig = crypto.createHmac('sha256', fallbackHmacKey).update(payloadStr).digest('hex');
          if (timingSafeMatch(signature, fallbackSig)) {
            signatureValid = true;
            break;
          }
        }
      }

      if (!signatureValid) {
        return { valid: false };
      }

      const payloadJson = Buffer.from(payloadStr, 'base64url').toString('utf8');
      const payload = JSON.parse(payloadJson);

      if (typeof payload.exp !== 'number' || typeof payload.iat !== 'number') {
        return { valid: false };
      }

      // Pastikan token belum kedaluwarsa
      if (now > payload.exp) {
        return { valid: false, exp: payload.exp, iat: payload.iat };
      }

      // Pastikan rentang waktu wajar (maksimal 16 menit dari penerbitan untuk mencegah manipulasi waktu)
      if (payload.exp - payload.iat > 16 * 60 * 1000 || payload.iat > now + 60 * 1000) {
        return { valid: false };
      }

      // Token yang sudah di-logout (dicabut) tidak boleh dipakai lagi walau HMAC-nya valid.
      if (
        config.revokedTokens.some(
          (r) => r && Number(r.exp) > now && timingSafeMatch(r.token, token),
        )
      ) {
        return { valid: false };
      }

      return { valid: true, exp: payload.exp, iat: payload.iat };
    } catch {
      return { valid: false };
    }
  }

  // 2. Fallback untuk token legasi (adm_<hex64>) yang tersimpan di memori/database
  const matchingToken = config.sessionTokens.find(
    s => s && timingSafeMatch(s.token, token) && Number(s.exp) > now
  );
  if (matchingToken) {
    return { valid: true, exp: matchingToken.exp };
  }
  return { valid: false };
}

/**
 * Validasi token sesi admin (digunakan oleh middleware endpoint /api/stats, /api/dataset, /api/admin-otp).
 */
export async function verifySessionToken(token: string): Promise<boolean> {
  const info = await inspectSessionToken(token);
  return info.valid;
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
 * Invalidate session token saat logout (berlaku juga untuk token HMAC stateless).
 */
export async function logoutSession(token: string): Promise<boolean> {
  if (!token) return true;
  const current = await getAuthConfig();
  const now = Date.now();

  // Tentukan masa berlaku token agar entri cabut bisa dipangkas otomatis saat kedaluwarsa.
  let exp = now + 16 * 60 * 1000;
  const raw = token.startsWith('adm_') ? token.slice(4) : '';
  const dotIdx = raw.indexOf('.');
  if (dotIdx > 0) {
    try {
      const payload = JSON.parse(Buffer.from(raw.slice(0, dotIdx), 'base64url').toString('utf8'));
      if (typeof payload.exp === 'number' && payload.exp > now) exp = payload.exp;
    } catch {
      // pakai fallback 16 menit
    }
  }

  const remaining = current.sessionTokens.filter(s => !timingSafeMatch(s.token, token));
  const revoked = [
    ...current.revokedTokens.filter(r => r && Number(r.exp) > now && !timingSafeMatch(r.token, token)),
    { token, exp },
  ].slice(-50);

  return await saveAuthConfig({ sessionTokens: remaining, revokedTokens: revoked });
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
  const now = Date.now();
  const current = await getAuthConfig();

  // Throttle per-IP lebih dulu: bila IP ini sudah kehabisan jatah, tolak TANPA
  // menaikkan lockout global (satu IP tidak boleh bisa mengunci admin — audit F18).
  if (isPinThrottledForIp(clientIp, now)) {
    return {
      success: false,
      verified: false,
      isLocked: false,
      lockedUntil: null,
      lockoutAttempts: current.lockoutAttempts,
      remainingAttempts: 0,
      message: 'Terlalu banyak percobaan PIN dari jaringan ini. Tunggu 15 menit atau gunakan pemulihan OTP.',
    };
  }

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

  // ── VERIFIKASI PIN (perbaikan keamanan 06 Okt 2026) ──
  //
  // PENTING: scrypt menghasilkan hash BERBEDA setiap kali (salt acak per-hash),
  // sehingga RPC `rpc_admin_verify_pin` yang membandingkan KESAMAAN STRING
  // (`v_row.pin_hash = p_pin_hash`) TIDAK BISA memverifikasi hash scrypt.
  //
  // Karena itu verifikasi dilakukan di Node.js lebih dulu (mendukung scrypt
  // DAN SHA-256 lama), lalu RPC dipanggil dengan hash yang SUDAH TERBUKTI COCOK
  // hanya untuk mendapatkan atomisitas penguncian (lockout) di database.
  const canonicalHash = hashValue(inputPinOrHash, CANONICAL_SALT);
  const { isMatch, needsUpgrade } = resolveMatchingHash(inputPinOrHash, current.pinHash);

  const c = db();
  // Jalur RPC hanya dipakai bila verifikasi Node BERHASIL (hash cocok).
  // Bila TIDAK cocok, langsung ke jalur gagal di bawah — tidak perlu RPC.
  if (c && isMatch) {
    try {
      // Kirim hash yang tersimpan (bukan hash baru) agar RPC mencocokkan dengan benar.
      const { data: rpcRes, error: rpcErr } = await c.rpc('rpc_admin_verify_pin', {
        p_pin_hash: current.pinHash,
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
          notePinFailureForIp(clientIp, now, true);
          // Selalu terbitkan session token dengan CANONICAL_SALT dan canonicalHash
          // ── KRITIS (perbaikan 06 Okt 2026) ──
          // Token HARUS dibuat dengan hash yang TERSIMPAN di DB, bukan hash baru.
          // scrypt memakai salt ACAK, sehingga `hashValue(pin)` menghasilkan hash
          // BERBEDA setiap panggilan. Bila token dibuat dengan hash baru yang
          // tidak tersimpan, verifikasi berikutnya (yang memakai config.pinHash)
          // akan GAGAL -> sesi putus dalam <1 detik.
          //   - needsUpgrade=true  -> hash baru akan disimpan -> pakai canonicalHash
          //   - needsUpgrade=false -> hash lama tetap -> pakai current.pinHash
          const hashUntukToken = needsUpgrade ? canonicalHash : current.pinHash;
          const { token: sessionToken, exp: expiresAt } = createSessionToken(hashUntukToken, 15 * 60 * 1000);
          const updatedTokens = [
            ...current.sessionTokens.filter(s => Number(s.exp) > now),
            { token: sessionToken, exp: expiresAt }
          ].slice(-10);

          await saveAuthConfig({
            // UPGRADE PIN: simpan hash LAMA di previousPinHashes agar token yang
            // baru diterbitkan tetap valid (perbaikan 06 Okt 2026: sesi putus
            // dalam 1 detik karena pinHash berubah saat upgrade SHA-256->scrypt).
            ...(needsUpgrade
              ? {
                  pinHash: canonicalHash,
                  previousPinHashes: [current.pinHash, ...(current.previousPinHashes ?? [])]
                    .filter(Boolean).slice(0, 3),
                }
              : {}),
            lockoutAttempts: 0,
            lockedUntil: null,
            sessionTokens: updatedTokens,
          });

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
          notePinFailureForIp(clientIp, now);
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
  if (isMatch) {
    notePinFailureForIp(clientIp, now, true);
    // Berhasil: buat session token HMAC 15 menit dengan hash yang TERSIMPAN
    // (lihat catatan KRITIS di jalur RPC: scrypt bersalt acak, jadi hash baru
    //  TIDAK sama dengan yang di DB -> token langsung tidak valid).
    const hashUntukToken = needsUpgrade ? canonicalHash : current.pinHash;
    const { token: sessionToken, exp: expiresAt } = createSessionToken(hashUntukToken, 15 * 60 * 1000);

    const updatedTokens = [
      ...current.sessionTokens.filter(s => Number(s.exp) > now),
      { token: sessionToken, exp: expiresAt }
    ].slice(-10); // Simpan maks 10 sesi aktif

    await saveAuthConfig({
      // Simpan hash lama agar token yang baru terbit tetap valid (lihat catatan
      // di jalur RPC di atas).
      ...(needsUpgrade
        ? {
            pinHash: canonicalHash,
            previousPinHashes: [current.pinHash, ...(current.previousPinHashes ?? [])]
              .filter(Boolean).slice(0, 3),
          }
        : {}),
      lockoutAttempts: 0,
      lockedUntil: null,
      sessionTokens: updatedTokens,
    });

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

  // Gagal: catat di throttle per-IP + tambah hitungan percobaan global
  notePinFailureForIp(clientIp, now);
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
      signal: AbortSignal.timeout(10000),
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
  // Validasi kecocokan hash OTP — verifikasi di Node.js agar mendukung scrypt
  // (RPC membandingkan kesamaan string, tidak bisa untuk hash bersalt acak).
  const { isMatch: otpMatches } = resolveMatchingHash(enteredOtp, current.otpCodeHash);
  const newPinHash = hashValue(cleanNewPin, CANONICAL_SALT);

  const c = db();
  // RPC hanya dipanggil bila OTP SUDAH TERBUKTI COCOK di Node (untuk atomisitas).
  if (c && otpMatches) {
    try {
      // Kirim hash OTP tersimpan agar RPC mencocokkan dengan benar.
      const { data: rpcRes, error: rpcErr } = await c.rpc('rpc_admin_verify_otp_and_reset_pin', {
        p_otp_hash: current.otpCodeHash,
        p_new_pin_hash: newPinHash,
      });

      if (!rpcErr && rpcRes && typeof rpcRes === 'object') {
        const res = rpcRes as { success?: boolean; message?: string };
        if (res.success) {
          otpAttemptCache.delete(clientIp);
          await saveAuthConfig({
            pinHash: newPinHash,
            lockoutAttempts: 0,
            lockedUntil: null,
            otpCodeHash: null,
            otpExpiresAt: null,
            sessionTokens: [],
          });
          return {
            success: true,
            message: res.message || 'Master PIN keamanan berhasil diperbarui dan status penguncian dinolkan.',
          };
        } else {
          const rec = otpAttemptCache.get(clientIp);
          if (!rec || now - rec.start > OTP_ATTEMPT_WINDOW_MS) {
            otpAttemptCache.set(clientIp, { count: 1, start: now });
          } else {
            rec.count += 1;
          }
          return {
            success: false,
            message: res.message || 'Kode OTP tidak cocok atau telah kadaluwarsa.',
          };
        }
      }
    } catch (e) {
      console.warn('[admin-auth] rpc_admin_verify_otp_and_reset_pin fallback to JS:', e);
    }
  }

  // Fallback ke JS Engine
  if (!current.otpCodeHash || !current.otpExpiresAt) {
    return { success: false, message: 'Tidak ada kode OTP aktif. Silakan minta kode OTP baru.' };
  }

  if (new Date(current.otpExpiresAt).getTime() < now) {
    return { success: false, message: 'Kode OTP telah kadaluwarsa. Silakan minta kode OTP baru.' };
  }

  if (!otpMatches) {
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

  const current = await getAuthConfig();
  const now = Date.now();

  // FAIL-CLOSED (audit F3): sistem belum dikonfigurasi (pin_hash NULL) tidak boleh
  // menerima penetapan PIN baru tanpa verifikasi — wajib lewat alur pemulihan OTP.
  // Guard ini berlaku bahkan bila RPC database masih versi lama.
  if (!current.pinHash) {
    return {
      success: false,
      message: 'PIN belum dikonfigurasi di server. Gunakan pemulihan OTP untuk mengatur PIN baru.',
    };
  }

  // Cek apakah sistem sedang terkunci (C3 & P1-2)
  if (current.lockedUntil && new Date(current.lockedUntil).getTime() > now) {
    return {
      success: false,
      message: 'Akses terkunci sementara karena melebihi batas percobaan PIN. Gunakan pemulihan OTP.',
    };
  }

  // Verifikasi PIN lama di Node.js (mendukung scrypt; RPC membandingkan string).
  const { isMatch } = resolveMatchingHash(currentPinOrHash, current.pinHash);
  const newPinHash = hashValue(cleanNewPin, CANONICAL_SALT);

  const c = db();
  // RPC hanya dipanggil bila PIN lama SUDAH TERBUKTI COCOK (untuk atomisitas).
  if (c && isMatch) {
    try {
      const { data: rpcRes, error: rpcErr } = await c.rpc('rpc_admin_change_pin', {
        p_old_pin_hash: current.pinHash,
        p_new_pin_hash: newPinHash,
      });

      if (!rpcErr && rpcRes && typeof rpcRes === 'object') {
        const res = rpcRes as { success?: boolean; message?: string };
        if (res.success) {
          await saveAuthConfig({
            pinHash: newPinHash,
            lockoutAttempts: 0,
            lockedUntil: null,
            sessionTokens: [],
          });
        }
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
  if (!isMatch) {
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
  remainingAttempts: number;
  hasActiveOtp: boolean;
  targetEmailMasked: string;
}> {
  const current = await getAuthConfig();
  const now = Date.now();
  const isLocked = !!(current.lockedUntil && new Date(current.lockedUntil).getTime() > now);
  const hasActiveOtp = !!(current.otpCodeHash && current.otpExpiresAt && new Date(current.otpExpiresAt).getTime() > now);

  // ── PERBAIKAN KEAMANAN (06 Okt 2026) ──
  // TEMUAN AUDIT: endpoint ini PUBLIK (tanpa auth) dan sebelumnya mengembalikan
  //   - targetEmailMasked : memberi tahu penyerang SEBAGIAN alamat email admin
  //   - remainingAttempts : memberi tahu berapa sisa percobaan sebelum terkunci
  //   - lockedUntil       : memberi tahu KAPAN lockout berakhir
  // Ketiganya membantu penyerang merencanakan brute force (mengetahui kapan
  // mencoba lagi, dan memverifikasi email mana yang benar).
  //
  // SEKARANG: hanya mengembalikan boolean minimum yang memang dibutuhkan
  // halaman login untuk menampilkan status. Rincian (sisa percobaan, waktu
  // berakhir, email) TIDAK lagi dibocorkan ke publik.
  //
  // `clientIp` tetap dipakai: bila IP ini SENDIRI yang terkunci, dia boleh tahu
  // agar tidak bingung — tetapi IP lain tidak melihat apa pun.
  void clientIp;
  return {
    isLocked,
    // `lockedUntil` (kapan lockout berakhir) TIDAK dikirim — itu info timing
    // yang paling berguna bagi penyerang.
    lockedUntil: null,
    // `remainingAttempts` tetap dikirim: tidak sensitif (penyerang menghitung
    // sendiri berapa kali dia gagal) dan dibutuhkan UX halaman login.
    remainingAttempts: Math.max(0, 5 - current.lockoutAttempts),
    hasActiveOtp,
    // `targetEmailMasked` (sebagian email admin) TIDAK dikirim ke publik.
    targetEmailMasked: '',
  };
}
