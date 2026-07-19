/**
 * Telegram companion bot — minimal factory + card push helper.
 *
 * Uses telegraf@^4.16.3 long-polling (no webhook, no HTTPS ingress).
 * Every failure path here MUST swallow errors — a bot outage must NEVER
 * take down the settler or the HTTP server. We log via console + the
 * in-process ring buffer that `/api/logs/tail` reads in dev.
 *
 * Docs consulted:
 *  - https://telegraf.js.org/ (Bot / Context / launch / stop semantics)
 *  - https://core.telegram.org/bots/api#sendphoto (multipart vs URL,
 *    inline_keyboard, parse_mode). HTML parse_mode chosen over
 *    MarkdownV2 to sidestep the "."/"-"/"!" escape footgun.
 */

import { Telegraf } from 'telegraf';
import { pushRawLine } from '../log-buffer.ts';

export type StickerOutcome = 'HIT' | 'MISS' | 'PENDING';

export interface StickerCardOpts {
  name: string;
  outcome: StickerOutcome;
  /**
   * EITHER an absolute HTTPS URL OR provide `imageBuffer` for direct
   * multipart upload. Buffer path is preferred when the renderer runs
   * in-process (dev, no public URL, no tunnel).
   */
  imageUrl?: string;
  imageBuffer?: Buffer;
  solscanUrl: string;
  fixtureLabel?: string; // e.g. "Argentina vs France · Final"
  slotLabel?: string; // e.g. "Slot 3 · Corners Over 8"
}

// ---------- logging ----------

/** Structured log line, both to stdout and to the dev ring buffer. */
function logLine(level: 'info' | 'warn' | 'error', msg: string, ctx?: Record<string, unknown>): void {
  const line = {
    time: Date.now(),
    level: level === 'error' ? 50 : level === 'warn' ? 40 : 30,
    msg,
    component: 'telegram',
    ...(ctx ?? {}),
  };
  const raw = JSON.stringify(line);
  // eslint-disable-next-line no-console
  (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(raw);
  try {
    pushRawLine(raw);
  } catch {
    /* ring buffer is best-effort */
  }
}

// ---------- factory ----------

/**
 * Instantiate the Telegraf client. Returns null when the token is missing
 * so callers can degrade to a silent no-op instead of crashing.
 *
 * NOTE: does NOT call `bot.launch()` — the caller (Fastify plugin) owns
 * lifecycle so it can wire shutdown handlers correctly.
 */
export function createBot(token: string | undefined | null): Telegraf | null {
  if (!token || token.trim().length === 0) return null;
  try {
    // handlerTimeout=90s — default is Infinity, which can wedge polling if
    // a handler hangs on network I/O (e.g. Prisma stall). 90s aligns with
    // Telegram's own long-poll ceiling.
    const bot = new Telegraf(token, { handlerTimeout: 90_000 });
    return bot;
  } catch (err) {
    logLine('error', 'telegraf constructor threw', { err: (err as Error).message });
    return null;
  }
}

// ---------- caption rendering ----------

/**
 * Minimal HTML-escape for Telegram HTML parse_mode.
 * Telegram docs: only `<`, `>`, `&` MUST be escaped inside text nodes.
 * We escape all three plus quote to be conservative.
 * https://core.telegram.org/bots/api#html-style
 */
function htmlEscape(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Clip long strings so Telegram doesn't 400 us on the 1024-char caption cap. */
function clip(input: string, max: number): string {
  if (input.length <= max) return input;
  return input.slice(0, Math.max(0, max - 1)) + '…';
}

export function renderCaption(opts: StickerCardOpts): string {
  const name = htmlEscape(clip(opts.name, 120));
  const outcomeLine =
    opts.outcome === 'HIT'
      ? '🎯 HIT 🎉'
      : opts.outcome === 'MISS'
        ? '💥 MISS'
        : '⏳ Pending';
  const parts = [`<b>${name}</b>`, outcomeLine];
  if (opts.fixtureLabel) parts.push(htmlEscape(clip(opts.fixtureLabel, 120)));
  if (opts.slotLabel) parts.push(`<i>${htmlEscape(clip(opts.slotLabel, 120))}</i>`);
  return clip(parts.join('\n'), 1024);
}

// ---------- push ----------

/**
 * Send a sticker-card as a Telegram photo message with an inline Solscan
 * button. Never throws — logs and returns on any failure so upstream
 * (settler / notify route) can keep processing.
 */
export async function pushStickerCard(
  bot: Telegraf,
  chatId: string,
  opts: StickerCardOpts,
): Promise<void> {
  if (!chatId) {
    logLine('warn', 'pushStickerCard: no chatId configured, skipping');
    return;
  }
  // Prefer direct Buffer upload (works from anywhere — no public URL
  // needed). Only fall back to URL path when caller has a real hosted
  // image (e.g. Helius DAS cdn_uri returning IPFS/Arweave content).
  const usingBuffer = Boolean(opts.imageBuffer && opts.imageBuffer.length > 0);
  const usingHttpsUrl = !usingBuffer && typeof opts.imageUrl === 'string' && /^https:\/\//i.test(opts.imageUrl);
  const usingNothing = !usingBuffer && !usingHttpsUrl;

  if (usingNothing) {
    // No usable image source — send a text-only message so the
    // notification still lands. Better than silent failure.
    logLine('warn', 'pushStickerCard: no image source, sending text-only', {
      imageUrl: opts.imageUrl,
    });
    try {
      await bot.telegram.sendMessage(chatId, renderCaption(opts), {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[{ text: 'View on Solscan', url: opts.solscanUrl }]],
        },
      });
    } catch (err) {
      logLine('error', 'sendMessage failed', { err: (err as Error).message, chatId });
    }
    return;
  }

  try {
    // Telegraf sendPhoto: `photo` accepts a string URL, a `{ source: Buffer | Readable }`,
    // or a file_id. We use the source-buffer path when we generated the
    // card in-process — this bypasses Telegram's need to fetch the URL
    // (which fails for localhost + unresolvable METADATA_HOST domains).
    // https://core.telegram.org/bots/api#sendphoto
    const photo = usingBuffer
      ? { source: opts.imageBuffer as Buffer, filename: 'momentum-card.png' }
      : (opts.imageUrl as string);

    await bot.telegram.sendPhoto(chatId, photo, {
      caption: renderCaption(opts),
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[{ text: 'View on Solscan', url: opts.solscanUrl }]],
      },
    });
    logLine('info', 'sticker card pushed', {
      chatId,
      name: opts.name,
      outcome: opts.outcome,
      via: usingBuffer ? 'buffer' : 'url',
    });
  } catch (err) {
    logLine('error', 'sendPhoto failed', {
      err: (err as Error).message,
      chatId,
      via: usingBuffer ? 'buffer' : 'url',
      imageUrl: opts.imageUrl,
    });
  }
}
