/**
 * POST /api/notify/telegram — internal push endpoint used by the
 * out-of-process settler worker to fan a sticker-mint event into the
 * pre-configured Telegram group.
 *
 * Auth model: shared secret header `X-Notify-Secret` (constant-time
 * compare via Node timingSafeEqual). NOT a public route. Rate-limited by
 * the global fastify-rate-limit plugin (300/min) plus a stricter local
 * cap of 60/min per IP so a leaked secret can't spam Telegram.
 *
 * Behavior:
 *  - If TELEGRAM_BOT_TOKEN is unset -> 204 { ok: false, reason:'bot_disabled' }
 *    (settler treats this as success; nothing to retry)
 *  - If NOTIFY_SHARED_SECRET is unset -> 503 (misconfigured, refuse)
 *  - If auth fails -> 401 generic (no user enumeration / secret disclosure)
 *  - If assetId provided and other fields missing -> hydrate from
 *    Prisma.StickerMint + Helius DAS (best-effort).
 *
 * Security refs:
 *  - OWASP REST Cheat Sheet: internal endpoints still need auth
 *  - OWASP Secrets Management: never log the secret; compare in
 *    constant time (see `constantTimeEqual`).
 */

import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { env } from '../config/env.ts';
import { prismaQuery } from '../lib/prisma.ts';
import { getAsset, heliusAvailable } from '../lib/helius.ts';
import type { StickerCardOpts, StickerOutcome } from '../lib/telegram/bot.ts';

// ---------- helpers ----------

function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    // timingSafeEqual requires equal length. Compare a to itself so the
    // op still runs, avoiding a fast-path length-oracle.
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

function solscanCluster(): string {
  if (env.SOLSCAN_CLUSTER) return env.SOLSCAN_CLUSTER;
  if (env.SOLANA_CLUSTER === 'mainnet') return 'mainnet-beta';
  return env.SOLANA_CLUSTER;
}

function solscanUrlForAssetOrTx(opts: { assetId?: string; txSig?: string }): string {
  const cluster = solscanCluster();
  if (opts.assetId) return `https://solscan.io/token/${encodeURIComponent(opts.assetId)}?cluster=${cluster}`;
  if (opts.txSig) return `https://solscan.io/tx/${encodeURIComponent(opts.txSig)}?cluster=${cluster}`;
  return `https://solscan.io/?cluster=${cluster}`;
}

// ---------- payload schema ----------

const NotifySchema = z
  .object({
    // Preferred: pass assetId and we'll hydrate everything else.
    assetId: z.string().min(32).max(64).optional(),
    // Manual overrides (used by /share command or when caller has richer context).
    name: z.string().min(1).max(200).optional(),
    outcome: z.enum(['HIT', 'MISS', 'PENDING']).optional(),
    imageUrl: z.string().url().optional(),
    solscanUrl: z.string().url().optional(),
    fixtureLabel: z.string().max(200).optional(),
    slotLabel: z.string().max(200).optional(),
    // Optional context passed through from settler for logging + fallback link.
    txSig: z.string().min(32).max(120).optional(),
    fixtureId: z.string().min(1).max(64).optional(),
    slotIndex: z.number().int().nonnegative().optional(),
    chatId: z.string().min(1).max(64).optional(),
  })
  .strict();

// ---------- hydration ----------

async function hydrate(
  body: z.infer<typeof NotifySchema>,
): Promise<StickerCardOpts | null> {
  // Fast path: caller provided everything.
  if (body.name && body.outcome && body.imageUrl && body.solscanUrl) {
    return {
      name: body.name,
      outcome: body.outcome,
      imageUrl: body.imageUrl,
      solscanUrl: body.solscanUrl,
      fixtureLabel: body.fixtureLabel,
      slotLabel: body.slotLabel,
    };
  }

  // Need to hydrate. We need at minimum an assetId OR (fixtureId+slotIndex)
  // to look up the StickerMint row.
  let mint = null as Awaited<ReturnType<typeof prismaQuery.stickerMint.findFirst>> | null;
  if (body.assetId) {
    mint = await prismaQuery.stickerMint.findFirst({ where: { assetId: body.assetId } });
  } else if (body.fixtureId && body.slotIndex !== undefined) {
    mint = await prismaQuery.stickerMint.findFirst({
      where: { fixtureId: body.fixtureId, slotIndex: body.slotIndex },
      orderBy: { mintedAt: 'desc' },
    });
  }

  const assetId = body.assetId ?? mint?.assetId ?? undefined;
  const outcome: StickerOutcome =
    body.outcome ??
    (mint?.outcome === 'hit' ? 'HIT' : mint?.outcome === 'miss' ? 'MISS' : 'PENDING');

  const fixtureId = body.fixtureId ?? mint?.fixtureId;
  const slotIndex = body.slotIndex ?? mint?.slotIndex;

  let name =
    body.name ??
    (fixtureId !== undefined && slotIndex !== undefined
      ? `Sticker · ${fixtureId}#${slotIndex}`
      : assetId
        ? `Sticker · ${assetId.slice(0, 8)}…`
        : 'Momentum Sticker');

  let imageUrl =
    body.imageUrl ??
    (fixtureId !== undefined && slotIndex !== undefined
      ? `${env.METADATA_HOST}/stickers/${fixtureId}-${slotIndex}.png`
      : undefined);

  // Best-effort DAS enrichment for name + image. Never fatal.
  if (assetId && heliusAvailable()) {
    try {
      const asset = await getAsset(assetId);
      const metaName = asset.content?.metadata?.name;
      if (metaName && !body.name) name = metaName;
      const cdn = asset.content?.files?.find((f) => f?.cdn_uri)?.cdn_uri;
      const link = asset.content?.links?.image;
      const file = asset.content?.files?.find((f) => f?.uri)?.uri;
      const chosen = cdn ?? link ?? file;
      if (!body.imageUrl && chosen && /^https:\/\//i.test(chosen)) imageUrl = chosen;
    } catch {
      /* best-effort */
    }
  }

  // Fixture label (home vs away) from Prisma.
  let fixtureLabel = body.fixtureLabel;
  if (!fixtureLabel && fixtureId) {
    try {
      const fx = await prismaQuery.fixture.findUnique({ where: { fixtureId } });
      if (fx) fixtureLabel = `${fx.homeTeam} vs ${fx.awayTeam}`;
    } catch {
      /* best-effort */
    }
  }

  const slotLabel = body.slotLabel ?? (slotIndex !== undefined ? `Slot ${slotIndex}` : undefined);

  const solscanUrl =
    body.solscanUrl ??
    solscanUrlForAssetOrTx({ assetId, txSig: body.txSig ?? mint?.mintTxSig ?? undefined });

  if (!imageUrl) {
    // Still no image — bail (bot.pushStickerCard would just send text).
    // Provide a minimal fallback that at least loads.
    imageUrl = `${env.METADATA_HOST}/stickers/placeholder.png`;
  }

  return { name, outcome, imageUrl, solscanUrl, fixtureLabel, slotLabel };
}

// ---------- plugin ----------

export const notifyRoutes: FastifyPluginCallback = (app: FastifyInstance, _opts, done) => {
  // Per-route stricter rate limit — the global limiter allows 300/min;
  // this endpoint is only called by the settler, so 60/min is plenty and
  // limits blast radius on a leaked secret.
  app.post(
    '/telegram',
    {
      config: {
        rateLimit: {
          max: 60,
          timeWindow: '1 minute',
        },
      },
      schema: {
        tags: ['meta'],
        summary: 'Internal: push a sticker card into the configured Telegram group.',
        headers: {
          type: 'object',
          properties: { 'x-notify-secret': { type: 'string' } },
          required: ['x-notify-secret'],
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
      // Refuse to run at all if server isn't configured to accept these calls.
      if (!env.NOTIFY_SHARED_SECRET) {
        return reply.code(503).send({
          success: false,
          error: { code: 'NOTIFY_NOT_CONFIGURED', message: 'notify endpoint not configured' },
          data: null,
        });
      }

      // Auth check.
      const rawHeader = request.headers['x-notify-secret'];
      const provided = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
      if (typeof provided !== 'string' || !constantTimeEqual(provided, env.NOTIFY_SHARED_SECRET)) {
        request.log.warn({ ip: request.ip }, 'notify/telegram unauthorized');
        return reply.code(401).send({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'unauthorized' },
          data: null,
        });
      }

      // Bot disabled? Return 204 so the settler treats it as success.
      if (!app.telegram.enabled || !app.telegram.bot) {
        return reply.code(204).send();
      }

      // Validate body.
      const parsed = NotifySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'invalid payload',
            details: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
          },
          data: null,
        });
      }

      const body = parsed.data;
      let opts: StickerCardOpts | null = null;
      try {
        opts = await hydrate(body);
      } catch (err) {
        request.log.error({ err }, 'notify/telegram hydrate failed');
        return reply.code(500).send({
          success: false,
          error: { code: 'HYDRATE_FAILED', message: 'could not resolve sticker fields' },
          data: null,
        });
      }
      if (!opts) {
        return reply.code(400).send({
          success: false,
          error: { code: 'INSUFFICIENT_INPUT', message: 'need assetId or (name+imageUrl+solscanUrl+outcome)' },
          data: null,
        });
      }

      const chatId = body.chatId ?? app.telegram.defaultChatId;
      if (!chatId) {
        return reply.code(503).send({
          success: false,
          error: { code: 'NO_CHAT_CONFIGURED', message: 'TELEGRAM_GROUP_CHAT_ID unset' },
          data: null,
        });
      }

      // Fire-and-forget the actual Telegram call — we don't want the
      // settler blocked on Telegram's response time (usually 100-800ms).
      // Any errors are logged inside pushStickerCard.
      void app.telegram.pushStickerCard(chatId, opts);

      return reply.code(200).send({
        success: true,
        error: null,
        data: { ok: true, sentAt: new Date().toISOString() },
      });
    },
  );

  done();
};
