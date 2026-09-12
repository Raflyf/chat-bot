/**
 * Logger terstruktur tanpa dependensi eksternal (single-line JSON).
 *
 * CATATAN MIGRASI: Saat ini logger hanya dipasang di entrypoint (src/index.ts)
 * dan endpoint webhook (api/webhook.ts, api/whatsapp.ts). Berkas lain
 * (telegram.ts, whatsapp_cloud.ts, whatsapp_baileys.ts, db.ts, web.ts, dst.)
 * masih memakai console.* dan dapat dimigrasi secara bertahap.
 */

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogContext {
  requestId?: string;
  chatId?: string;
  platform?: string;
}

type LogFields = Record<string, unknown>;

export interface Logger {
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
}

const LEVEL_TAG: Record<LogLevel, string> = { info: 'INFO', warn: 'WARN', error: 'ERROR' };

function prettyEnabled(): boolean {
  return process.env.LOG_PRETTY === '1';
}

function emit(level: LogLevel, line: string): void {
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

function write(level: LogLevel, msg: string, ctx: LogContext, fields?: LogFields): void {
  if (prettyEnabled()) {
    const bits: string[] = [new Date().toISOString(), LEVEL_TAG[level], msg];
    if (ctx.requestId) bits.push(`req=${ctx.requestId}`);
    if (ctx.chatId) bits.push(`chat=${ctx.chatId}`);
    if (ctx.platform) bits.push(`platform=${ctx.platform}`);
    if (fields && Object.keys(fields).length > 0) bits.push(JSON.stringify(fields));
    emit(level, bits.join(' '));
    return;
  }

  const payload: Record<string, unknown> = { level, ts: new Date().toISOString(), msg };
  if (ctx.requestId !== undefined) payload.requestId = ctx.requestId;
  if (ctx.chatId !== undefined) payload.chatId = ctx.chatId;
  if (ctx.platform !== undefined) payload.platform = ctx.platform;
  if (fields) {
    for (const [k, v] of Object.entries(fields)) {
      if (payload[k] === undefined) payload[k] = v;
    }
  }
  emit(level, JSON.stringify(payload));
}

/** Buat child logger dengan correlation id (requestId / chatId / platform). */
export function withContext(ctx: LogContext): Logger {
  return {
    info: (msg, fields) => write('info', msg, ctx, fields),
    warn: (msg, fields) => write('warn', msg, ctx, fields),
    error: (msg, fields) => write('error', msg, ctx, fields),
  };
}

export function log(level: LogLevel, msg: string, fields?: LogFields): void {
  write(level, msg, {}, fields);
}

export function logInfo(msg: string, fields?: LogFields): void {
  write('info', msg, {}, fields);
}

export function logWarn(msg: string, fields?: LogFields): void {
  write('warn', msg, {}, fields);
}

export function logError(msg: string, fields?: LogFields): void {
  write('error', msg, {}, fields);
}
