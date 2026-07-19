/**
 * Public PNG endpoint that renders a Momentum-branded card image on the
 * fly. Consumed by the Telegram bot's sendPhoto call (Telegram requires an
 * HTTPS URL) and reusable as an og:image endpoint.
 *
 *   GET /api/telegram/card.png?name=X&outcome=HIT&fixtureLabel=Y&slotLabel=Z[&assetId=A][&txSig=T]
 *
 * Public (no auth) because Telegram fetches it as an anonymous client.
 * Rate-limited by the global limiter. Cached in memory per unique
 * parameter combo (see card-image.ts LRU).
 */

import type { FastifyInstance, FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { renderCardPng } from '../lib/telegram/card-image.ts';

const QuerySchema = z.object({
  name: z.string().min(1).max(200),
  outcome: z.enum(['HIT', 'MISS', 'PENDING']),
  fixtureLabel: z.string().max(200).optional(),
  slotLabel: z.string().max(200).optional(),
  assetId: z.string().min(6).max(96).optional(),
  txSig: z.string().min(6).max(120).optional(),
});

export const telegramCardRoutes: FastifyPluginCallback = (
  app: FastifyInstance,
  _opts,
  done,
) => {
  app.get(
    '/card.png',
    {
      schema: {
        tags: ['meta'],
        summary: 'Render a Momentum-branded sticker card as PNG (1200x630).',
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = QuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.code(400).send({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'invalid query',
            details: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
          },
          data: null,
        });
      }

      let png: Buffer;
      try {
        png = renderCardPng(parsed.data);
      } catch (err) {
        request.log.error({ err }, 'card render failed');
        return reply.code(500).send({
          success: false,
          error: { code: 'RENDER_FAILED', message: 'could not render card' },
          data: null,
        });
      }

      return reply
        .code(200)
        .header('content-type', 'image/png')
        // Aggressive cache: the card is fully derived from query params, so
        // it's immutable per URL. Telegram's URL cache also benefits.
        .header('cache-control', 'public, max-age=86400, immutable')
        .send(png);
    },
  );

  done();
};
