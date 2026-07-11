/**
 * Dynamic match-card SVG — Pass 8 / E-5.
 *
 *   GET /api/match-cards/:fixtureId/image.svg
 *
 * Returns a 512x512 SVG image suitable for use as a cNFT metadata URI's
 * `image` field or as an OpenGraph card. Public, cacheable at the CDN.
 *
 * Security note (OWASP XSS Prevention):
 *   Team names come from TxLINE and are ultimately user-visible strings.
 *   We treat every interpolated fragment as untrusted and pass it
 *   through `xmlEscape()` before inserting into the SVG. Never use
 *   this text in an SVG attribute without also quoting the attribute.
 */

import type { FastifyInstance, FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { prismaQuery } from '../lib/prisma.ts';
import { handleError } from '../utils/errorHandler.ts';

// XML/SVG entity escape — the five predefined entities plus the two
// control chars that break SVG parsers. Strip anything under U+0020
// except tab/newline. This is the OWASP-recommended allowlist for
// mixed HTML/XML output contexts.
export function xmlEscape(input: unknown): string {
  const s = typeof input === 'string' ? input : input === null || input === undefined ? '' : String(input);
  return s
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Truncate to a max character count, appending an ellipsis if clipped.
export function clip(input: string, max: number): string {
  if (input.length <= max) return input;
  return input.slice(0, Math.max(0, max - 1)) + '…';
}

// Constants — pull the orange from the brand palette.
const BG = '#0a0a0a';
const FG = '#f5f0e6';
const ACCENT = '#ff5722';
const MUTED = '#6b6b6b';

export interface FixtureBits {
  fixtureId: string;
  home: string;
  away: string;
  competition: string;
  kickoff: string;
}

export function renderSvg(bits: FixtureBits): string {
  const fixtureId = xmlEscape(bits.fixtureId);
  const home = xmlEscape(clip(bits.home, 24));
  const away = xmlEscape(clip(bits.away, 24));
  const competition = xmlEscape(clip(bits.competition, 40));
  const kickoff = xmlEscape(clip(bits.kickoff, 40));

  // Pixel-art frame with corner brackets. Mono font-family stack (SVG
  // renderers fall back left-to-right).
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512" role="img" aria-label="Momentum match card ${fixtureId}">
  <defs>
    <style>
      .mono { font-family: 'IBM Plex Mono', 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace; }
      .brand { font-family: 'IBM Plex Mono', ui-monospace, monospace; letter-spacing: 0.16em; }
    </style>
  </defs>
  <rect x="0" y="0" width="512" height="512" fill="${BG}"/>
  <rect x="12" y="12" width="488" height="488" fill="none" stroke="${FG}" stroke-width="2"/>
  <g stroke="${ACCENT}" stroke-width="4" fill="none">
    <polyline points="12,44 12,12 44,12"/>
    <polyline points="468,12 500,12 500,44"/>
    <polyline points="500,468 500,500 468,500"/>
    <polyline points="44,500 12,500 12,468"/>
  </g>
  <text x="256" y="80" text-anchor="middle" class="brand" fill="${ACCENT}" font-size="18" font-weight="700">MOMENTUM</text>
  <line x1="80" y1="104" x2="432" y2="104" stroke="${MUTED}" stroke-width="1"/>
  <text x="256" y="152" text-anchor="middle" class="mono" fill="${MUTED}" font-size="14">${competition}</text>
  <text x="256" y="240" text-anchor="middle" class="mono" fill="${FG}" font-size="30" font-weight="700">${home}</text>
  <text x="256" y="288" text-anchor="middle" class="mono" fill="${ACCENT}" font-size="20">vs</text>
  <text x="256" y="336" text-anchor="middle" class="mono" fill="${FG}" font-size="30" font-weight="700">${away}</text>
  <line x1="80" y1="392" x2="432" y2="392" stroke="${MUTED}" stroke-width="1"/>
  <text x="256" y="424" text-anchor="middle" class="mono" fill="${MUTED}" font-size="13">${kickoff}</text>
  <text x="256" y="476" text-anchor="middle" class="mono" fill="${MUTED}" font-size="11">FIXTURE ${fixtureId}</text>
</svg>`;
}

export function renderPlaceholderSvg(fixtureId: string): string {
  const id = xmlEscape(fixtureId);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512" role="img" aria-label="Momentum match card">
  <rect x="0" y="0" width="512" height="512" fill="${BG}"/>
  <rect x="12" y="12" width="488" height="488" fill="none" stroke="${FG}" stroke-width="2"/>
  <g stroke="${ACCENT}" stroke-width="4" fill="none">
    <polyline points="12,44 12,12 44,12"/>
    <polyline points="468,12 500,12 500,44"/>
    <polyline points="500,468 500,500 468,500"/>
    <polyline points="44,500 12,500 12,468"/>
  </g>
  <text x="256" y="240" text-anchor="middle" font-family="ui-monospace, monospace" fill="${ACCENT}" font-size="28" font-weight="700" letter-spacing="0.16em">MOMENTUM</text>
  <text x="256" y="288" text-anchor="middle" font-family="ui-monospace, monospace" fill="${FG}" font-size="20">#${id}</text>
</svg>`;
}

export const matchCardRoutes: FastifyPluginCallback = (app: FastifyInstance, _opts, done) => {
  app.get(
    '/:fixtureId/image.svg',
    {
      config: { rateLimit: { max: 300, timeWindow: '1 minute' } },
      schema: {
        description:
          'Dynamically generated match-card SVG for a fixture. Cacheable at CDN for 1h. Content-Type: image/svg+xml.',
        tags: ['cards'],
        params: {
          type: 'object',
          properties: { fixtureId: { type: 'string' } },
        },
        response: {
          200: {
            description: 'SVG image bytes.',
            content: { 'image/svg+xml': { schema: { type: 'string' } } },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { fixtureId } = request.params as { fixtureId: string };
      // Fixture IDs from TxLINE are numeric strings. Reject anything else
      // so we don't reflect arbitrary path segments into the SVG.
      if (!/^[0-9]{1,20}$/.test(fixtureId)) {
        return handleError(reply, 400, 'invalid fixtureId', 'VALIDATION_ERROR');
      }

      let svg: string;
      try {
        const fixture = await prismaQuery.fixture.findUnique({
          where: { fixtureId },
        });
        if (fixture) {
          svg = renderSvg({
            fixtureId,
            home: fixture.homeTeam,
            away: fixture.awayTeam,
            competition: fixture.competitionId ?? 'FIXTURE',
            kickoff: fixture.kickoffAt
              ? fixture.kickoffAt.toISOString().replace('T', ' ').slice(0, 16) + ' UTC'
              : 'kickoff tbd',
          });
        } else {
          svg = renderPlaceholderSvg(fixtureId);
        }
      } catch (err) {
        // Never surface DB errors into an image URL; return the placeholder
        // so metadata renderers keep working, but log server-side.
        request.log.warn({ err, fixtureId }, 'match-card SVG: db lookup failed, returning placeholder');
        svg = renderPlaceholderSvg(fixtureId);
      }

      reply
        .code(200)
        .header('Content-Type', 'image/svg+xml; charset=utf-8')
        .header('Cache-Control', 'public, max-age=3600, immutable')
        .header('X-Content-Type-Options', 'nosniff')
        .send(svg);
      return reply;
    },
  );

  done();
};
