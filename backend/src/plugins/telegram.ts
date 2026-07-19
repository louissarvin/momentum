/**
 * Fastify plugin: Telegram companion bot.
 *
 * - Boots a Telegraf long-polling client IN the HTTP process (they share
 *   the event loop but not the socket — no port conflict).
 * - `bot.launch()` never resolves until stop, so we fire-and-forget with
 *   `void bot.launch().catch(...)` — awaiting inline would hang boot.
 * - If TELEGRAM_BOT_TOKEN is missing, the plugin registers a disabled
 *   decorator so downstream routes can call `app.telegram.pushStickerCard`
 *   without null-checking (it becomes a no-op).
 * - SIGINT/SIGTERM stop the poller so the process can shut down cleanly.
 */

import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import type { Telegraf } from 'telegraf';

import { env } from '../config/env.ts';
import { createBot, pushStickerCard, type StickerCardOpts } from '../lib/telegram/bot.ts';
import { registerCommands } from '../lib/telegram/commands.ts';

export interface TelegramContext {
  /** null when the bot is disabled (missing token). */
  bot: Telegraf | null;
  /** null when TELEGRAM_GROUP_CHAT_ID is unset. */
  defaultChatId: string | null;
  enabled: boolean;
  /** Safe push helper — no-ops when bot or chatId is missing. */
  pushStickerCard: (chatId: string | null | undefined, opts: StickerCardOpts) => Promise<void>;
}

declare module 'fastify' {
  interface FastifyInstance {
    telegram: TelegramContext;
  }
}

const telegramPlugin: FastifyPluginAsync = async (app) => {
  const token = env.TELEGRAM_BOT_TOKEN;
  const defaultChatId = env.TELEGRAM_GROUP_CHAT_ID ?? null;

  const bot = createBot(token);

  if (!bot) {
    app.log.warn(
      { hasToken: !!token, hasChatId: !!defaultChatId },
      'Telegram bot disabled (TELEGRAM_BOT_TOKEN unset or invalid) — /api/notify/telegram will 204',
    );

    const noopCtx: TelegramContext = {
      bot: null,
      defaultChatId,
      enabled: false,
      pushStickerCard: async () => {
        /* no-op when disabled */
      },
    };
    app.decorate('telegram', noopCtx);
    return;
  }

  registerCommands(bot, defaultChatId ?? undefined);

  // Fire-and-forget launch. Any error inside long-polling gets logged but
  // MUST NOT crash the HTTP server.
  void bot
    .launch({ dropPendingUpdates: true })
    .catch((err: unknown) => {
      app.log.error({ err }, 'telegraf launch failed');
    });

  // Global handler-level error hook — telegraf calls this for any thrown
  // handler error, including our /start and /share bodies.
  bot.catch((err, ctx) => {
    app.log.error(
      { err, update: ctx.update?.update_id },
      'telegraf handler error',
    );
  });

  const ctx: TelegramContext = {
    bot,
    defaultChatId,
    enabled: true,
    pushStickerCard: async (chatId, opts) => {
      const target = chatId ?? defaultChatId;
      if (!target) {
        app.log.warn('telegram.pushStickerCard: no chatId provided or configured');
        return;
      }
      await pushStickerCard(bot, target, opts);
    },
  };
  app.decorate('telegram', ctx);

  app.log.info(
    {
      hasChatId: !!defaultChatId,
      handlerTimeoutMs: 90_000,
    },
    'Telegram bot launched (long-polling)',
  );

  // Graceful shutdown: stop the poller so bun can exit cleanly. Fastify
  // fires onClose before process exit. We also register SIGINT/SIGTERM
  // directly as a belt-and-braces guard for shells that skip the fastify
  // close path (rare, but harmless when duplicated — bot.stop is idempotent).
  const stop = (signal: string): void => {
    try {
      bot.stop(signal);
    } catch {
      /* already stopped */
    }
  };
  app.addHook('onClose', async () => {
    stop('fastify-close');
  });
  process.once('SIGINT', () => stop('SIGINT'));
  process.once('SIGTERM', () => stop('SIGTERM'));
};

export default fp(telegramPlugin, { name: 'telegram' });
