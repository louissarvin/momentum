/**
 * Ring buffer of recent log lines — Phase E / E.2.
 *
 * Populated by a pino stream target we register in `index.ts`. Consumed
 * by the dev-only `GET /api/logs/tail` endpoint. Keeps up to 500 lines
 * (drop-oldest), returns the last 200 by default.
 *
 * Not intended for production — pino goes to stdout there, which the
 * platform (Railway / Fly / Docker) ships to its own log aggregator.
 */

const MAX_LINES = 500;

interface Line {
  ts: string;
  level: string;
  msg: string;
  ctx: Record<string, unknown>;
}

const buffer: Line[] = [];

const LEVEL_LABEL: Record<number, string> = {
  10: 'trace',
  20: 'debug',
  30: 'info',
  40: 'warn',
  50: 'error',
  60: 'fatal',
};

export function pushRawLine(raw: string): void {
  if (!raw) return;
  const trimmed = raw.trim();
  if (!trimmed) return;
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    // Not JSON — treat as plain message.
    parsed = { msg: trimmed };
  }
  const level =
    typeof parsed.level === 'number'
      ? LEVEL_LABEL[parsed.level] ?? String(parsed.level)
      : String(parsed.level ?? 'info');
  const ts =
    typeof parsed.time === 'number'
      ? new Date(parsed.time).toISOString()
      : typeof parsed.time === 'string'
        ? parsed.time
        : new Date().toISOString();
  const msg = String(parsed.msg ?? '');
  // Strip verbose keys from ctx.
  const { level: _lv, time: _t, msg: _m, pid: _p, hostname: _h, ...ctx } = parsed;
  buffer.push({ ts, level, msg, ctx: ctx as Record<string, unknown> });
  while (buffer.length > MAX_LINES) buffer.shift();
}

export function tailLines(limit = 200): Line[] {
  const n = Math.min(Math.max(1, limit), MAX_LINES);
  return buffer.slice(-n);
}
