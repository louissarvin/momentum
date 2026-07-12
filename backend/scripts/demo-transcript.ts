#!/usr/bin/env bun
/**
 * demo-transcript — Pass 6 / P6-02.
 *
 * Reads structured Pino JSON logs (from stdin or a --file) and emits a
 * chronological, human-readable timeline of the moments a judge/demo
 * viewer cares about:
 *
 *   [22:03:15.421] wallet=2QayN... POST /api/session/challenge → 200 in 12ms
 *   [22:03:24.223] wallet=77WT... [SETTLE] jobId=... fixture=18237038 seq=732
 *   [22:03:26.115] wallet=77WT... [MINTED] cNFT 3e2LzD... tx=4fH7oq... event_stat_root=24ebb2...
 *
 * Usage:
 *   bun run demo-transcript --file logs.jsonl
 *   cat logs.jsonl | bun run demo-transcript
 *   bun run start | tee /dev/stderr | bun run demo-transcript
 *
 * Flags:
 *   --file <path>    Read from a file instead of stdin.
 *   --json           Emit the filtered JSONL to stdout (no colour, no format).
 *   --no-color       Disable ANSI colour codes.
 *
 * Filters (any of these makes a line demo-relevant):
 *   * request lines with a `reqId`, `route`, and `statusCode`.
 *   * lines whose `tag` is in {DEMO, SETTLE, MINTED, TXCONFIRMED,
 *     SETTLE_STARTED, SETTLE_CONFIRMED, SETTLE_ERROR, MATCH_CARD}.
 *   * lines whose `msg` matches settler event decodes ("decoded StickerMinted
 *     event", "sending settle tx", "settle tx submitted", "settle tx
 *     confirmed", "match_card tx confirmed").
 */

import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { stdin } from 'node:process';

// ---- minimal ANSI colour helpers (no dep) ----

interface Color {
  dim: (s: string) => string;
  bold: (s: string) => string;
  cyan: (s: string) => string;
  green: (s: string) => string;
  yellow: (s: string) => string;
  red: (s: string) => string;
  magenta: (s: string) => string;
  blue: (s: string) => string;
  gray: (s: string) => string;
}

function makeColor(enabled: boolean): Color {
  const wrap =
    (code: string) =>
    (s: string): string =>
      enabled ? `\x1b[${code}m${s}\x1b[0m` : s;
  return {
    dim: wrap('2'),
    bold: wrap('1'),
    cyan: wrap('36'),
    green: wrap('32'),
    yellow: wrap('33'),
    red: wrap('31'),
    magenta: wrap('35'),
    blue: wrap('34'),
    gray: wrap('90'),
  };
}

// ---- CLI parse ----

interface Options {
  file: string | null;
  json: boolean;
  color: boolean;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = { file: null, json: false, color: process.stdout.isTTY ?? false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--file' && argv[i + 1]) {
      opts.file = argv[++i];
    } else if (a === '--json') {
      opts.json = true;
    } else if (a === '--no-color') {
      opts.color = false;
    } else if (a === '--color') {
      opts.color = true;
    } else if (a === '-h' || a === '--help') {
      printHelp();
      process.exit(0);
    }
  }
  return opts;
}

function printHelp(): void {
  process.stdout.write(
    'Usage: bun run demo-transcript [--file <path>] [--json] [--no-color]\n' +
      '\n' +
      'Reads Pino JSON logs from stdin (or --file) and emits a demo timeline.\n',
  );
}

// ---- log shape ----

interface LogRow {
  level?: number | string;
  time?: number | string;
  msg?: string;
  reqId?: string;
  route?: string;
  method?: string;
  statusCode?: number;
  responseTime?: number;
  wallet?: string;
  tag?: string;
  // free-form
  [k: string]: unknown;
}

const DEMO_TAGS = new Set([
  'DEMO',
  'SETTLE',
  'MINTED',
  'TXCONFIRMED',
  'SETTLE_STARTED',
  'SETTLE_CONFIRMED',
  'SETTLE_ERROR',
  'MATCH_CARD',
  'TXLINE',
]);

const DEMO_MSGS = [
  'sending settle tx',
  'settle tx submitted',
  'decoded StickerMinted event',
  'decoded MatchCardClaimed event',
  'match_card tx confirmed',
  'sending claim_match_card tx',
  'settlement disabled',
];

function isDemoRelevant(row: LogRow): boolean {
  if (row.tag && typeof row.tag === 'string' && DEMO_TAGS.has(row.tag)) return true;
  if (row.reqId && row.route && typeof row.statusCode === 'number') return true;
  if (row.msg && typeof row.msg === 'string') {
    for (const m of DEMO_MSGS) {
      if (row.msg.includes(m)) return true;
    }
  }
  return false;
}

// ---- formatting ----

function shortWallet(w: string | undefined | null): string {
  if (!w) return '';
  if (w.length <= 12) return w;
  return `${w.slice(0, 5)}...${w.slice(-3)}`;
}

function shortSig(s: string | undefined | null): string {
  if (!s) return '';
  if (s.length <= 12) return s;
  return `${s.slice(0, 6)}...${s.slice(-4)}`;
}

function shortHex(h: string | undefined | null, n = 6): string {
  if (!h) return '';
  if (h.length <= n * 2) return h;
  return h.slice(0, n) + '...';
}

function fmtTime(t: number | string | undefined): string {
  if (t === undefined) return '00:00:00.000';
  const d = new Date(typeof t === 'string' ? Number(t) || t : t);
  if (Number.isNaN(d.getTime())) return String(t);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${ms}`;
}

function statusColor(color: Color, code: number): string {
  if (code < 300) return color.green(String(code));
  if (code < 400) return color.cyan(String(code));
  if (code < 500) return color.yellow(String(code));
  return color.red(String(code));
}

function formatRow(row: LogRow, color: Color): string | null {
  const time = color.gray(`[${fmtTime(row.time)}]`);
  const wallet = row.wallet ? color.blue(`wallet=${shortWallet(String(row.wallet))}`) : '';

  // Request-completed line
  if (row.reqId && row.route && typeof row.statusCode === 'number') {
    const method = row.method ? color.bold(String(row.method)) : '';
    const route = color.cyan(String(row.route));
    const status = statusColor(color, row.statusCode);
    const dur =
      typeof row.responseTime === 'number'
        ? color.dim(`in ${row.responseTime.toFixed(0)}ms`)
        : '';
    const parts = [time, wallet, method, route, color.gray('→'), status, dur].filter(Boolean);
    return parts.join(' ');
  }

  // Tagged demo line
  const tag = row.tag ? String(row.tag) : inferTagFromMsg(String(row.msg ?? ''));
  const badge = tag ? tagBadge(color, tag) : '';
  const msg = row.msg ? String(row.msg) : '';

  // Highlight specific demo events
  if (msg.includes('decoded StickerMinted event')) {
    const parts = [
      time,
      wallet,
      color.magenta('[MINTED]'),
      `cNFT ${color.bold(shortSig(String(row.assetId ?? '')))}`,
      `tx=${color.dim(shortSig(String(row.sig ?? '')))}`,
      `event_stat_root=${color.dim(shortHex(String(row.eventStatRoot ?? '')))}`,
      `outcome=${row.outcome === 1 ? color.green('HIT') : row.outcome === 2 ? color.yellow('MISS') : ''}`,
      `seq=${color.dim(String(row.stickerAssetSeq ?? ''))}`,
    ].filter((p) => p && !p.endsWith('='));
    return parts.join(' ');
  }
  if (msg.includes('sending settle tx')) {
    const parts = [
      time,
      wallet,
      color.magenta('[SETTLE]'),
      `card=${color.dim(shortSig(String(row.cardPda ?? '')))}`,
      `slot=${row.slotIndex ?? ''}`,
      `outcome=${row.outcome ?? ''}`,
      `bytes=${row.bytes ?? ''}`,
    ].filter((p) => !String(p).endsWith('='));
    return parts.join(' ');
  }
  if (msg.includes('settle tx submitted')) {
    const parts = [time, wallet, color.magenta('[TX_SUBMIT]'), `sig=${color.dim(shortSig(String(row.sig ?? '')))}`];
    return parts.join(' ');
  }
  if (msg.includes('match_card tx confirmed')) {
    const parts = [time, wallet, color.magenta('[MATCH_CARD]'), `sig=${color.dim(shortSig(String(row.sig ?? '')))}`];
    return parts.join(' ');
  }

  // Generic demo-tagged line
  if (tag && DEMO_TAGS.has(tag)) {
    return [time, wallet, badge, msg].filter(Boolean).join(' ');
  }

  return null;
}

function inferTagFromMsg(msg: string): string | null {
  if (msg.includes('decoded StickerMinted')) return 'MINTED';
  if (msg.includes('decoded MatchCardClaimed')) return 'MATCH_CARD';
  if (msg.includes('sending settle tx')) return 'SETTLE';
  if (msg.includes('settle tx submitted')) return 'SETTLE';
  if (msg.includes('match_card tx confirmed')) return 'MATCH_CARD';
  return null;
}

function tagBadge(color: Color, tag: string): string {
  switch (tag) {
    case 'DEMO':
      return color.magenta('[DEMO]');
    case 'SETTLE':
      return color.magenta('[SETTLE]');
    case 'MINTED':
      return color.green('[MINTED]');
    case 'MATCH_CARD':
      return color.green('[MATCH_CARD]');
    case 'TXCONFIRMED':
      return color.green('[TX_CONFIRMED]');
    case 'SETTLE_ERROR':
      return color.red('[SETTLE_ERROR]');
    case 'TXLINE':
      return color.cyan('[TXLINE]');
    default:
      return color.magenta(`[${tag}]`);
  }
}

// ---- main ----

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const color = makeColor(opts.color);

  const stream = opts.file ? createReadStream(opts.file, { encoding: 'utf8' }) : stdin;
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  let seen = 0;
  let printed = 0;

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed[0] !== '{') continue; // skip pino-pretty text lines
    seen++;
    let row: LogRow;
    try {
      row = JSON.parse(trimmed) as LogRow;
    } catch {
      continue;
    }
    if (!isDemoRelevant(row)) continue;
    if (opts.json) {
      process.stdout.write(JSON.stringify(row) + '\n');
      printed++;
      continue;
    }
    const formatted = formatRow(row, color);
    if (formatted) {
      process.stdout.write(formatted + '\n');
      printed++;
    }
  }

  if (!opts.json && printed === 0) {
    process.stderr.write(
      color.dim(`[demo-transcript] scanned ${seen} lines, no demo events matched.\n`),
    );
  }
}

main().catch((err) => {
  process.stderr.write(`[demo-transcript] fatal: ${(err as Error).message}\n`);
  process.exit(1);
});
