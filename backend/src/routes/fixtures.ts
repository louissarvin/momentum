/**
 * Fixture routes — Phase C / C.1.
 *
 * Public (no auth) — thin proxy over TxLINE's `/api/fixtures/snapshot` with
 * a 60s in-memory cache and mirror into the Prisma `Fixture` table.
 *
 *   GET /api/fixtures            snapshot (from TxLINE, cached 60s)
 *   GET /api/fixtures/:id        single fixture + latest score packet
 *
 * Rate limited to a moderate cap since this is unauthenticated.
 */

import type { FastifyInstance, FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { txlineHttp } from '../lib/txline/client.ts';
import { prismaQuery } from '../lib/prisma.ts';
import { handleError } from '../utils/errorHandler.ts';
import { jsonSafe } from '../utils/serialize.ts';

// ---- Query schema for GET / ----
// Every input is optional; when `search` is provided we hit the DB
// mirror. Otherwise we fall through to the TxLINE-proxied snapshot.
const ListQuery = z.object({
  search: z.string().min(2).max(40).optional(),
  status: z.enum(['live', 'upcoming', 'finished']).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).max(10_000).optional(),
});

// TxLINE / SportRadar status IDs. `live` covers in-play periods; the
// snapshot doc lists status 100 as terminal (game_finalised).
function statusFilterToWhere(status: 'live' | 'upcoming' | 'finished') {
  if (status === 'finished') return { statusId: 100 };
  if (status === 'live') return { statusId: { gt: 0, lt: 100 } };
  // upcoming: not yet started
  return { OR: [{ statusId: 0 }, { statusId: null }] };
}

// ---- 60s snapshot cache ----

interface CachedSnapshot {
  storedAt: number;
  data: unknown;
}
let snapshotCache: CachedSnapshot | null = null;
const SNAPSHOT_TTL_MS = 60_000;

type RawFixture = {
  fixtureId?: number | string;
  FixtureId?: number | string;
  competitionId?: number | string;
  CompetitionId?: number | string;
  competition?: string;
  Competition?: string;
  homeTeam?: string;
  HomeTeam?: string;
  awayTeam?: string;
  AwayTeam?: string;
  // TxLINE actual shape — Participant1/2 + Participant1IsHome to know sides
  Participant1?: string;
  Participant2?: string;
  Participant1IsHome?: boolean;
  participant1?: string;
  participant2?: string;
  participant1IsHome?: boolean;
  kickoff?: string | number;
  Kickoff?: string | number;
  startTime?: string | number;
  StartTime?: string | number;
  ts?: string | number;
  Ts?: string | number;
  statusId?: number;
  StatusId?: number;
  gameState?: number;
  GameState?: number;
  period?: number;
  Period?: number;
} & Record<string, unknown>;

interface NormalizedFixture {
  fixtureId: string;
  competitionId: string | null;
  competitionName: string | null;
  // TxLINE base stat keys are P1/P2, not home/away. Frontend needs this
  // flag to map "home team goals" → correct base key (1 if P1 is home, else 2).
  participant1IsHome: boolean;
  homeTeam: string;
  awayTeam: string;
  kickoffAt: Date | null;
  statusId: number | null;
  period: number | null;
  raw: unknown;
}

function pickString(...vals: unknown[]): string | null {
  for (const v of vals) {
    if (typeof v === 'string' && v.length > 0) return v;
    if (typeof v === 'number') return String(v);
  }
  return null;
}

function pickNumber(...vals: unknown[]): number | null {
  for (const v of vals) {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.length > 0 && !Number.isNaN(Number(v))) return Number(v);
  }
  return null;
}

function normalizeFixture(f: RawFixture): NormalizedFixture | null {
  const fixtureId = pickString(f.fixtureId, f.FixtureId, (f as { id?: unknown }).id);
  if (!fixtureId) return null;
  const competitionId = pickString(f.competitionId, f.CompetitionId, (f as { compId?: unknown }).compId);
  const competitionName = pickString(f.Competition, f.competition);

  // TxLINE returns Participant1/Participant2 plus Participant1IsHome to indicate
  // which side is at home. Fall through to homeTeam/awayTeam if the OpenAPI shape
  // is ever used, then to 'unknown' as final safety.
  const p1 = pickString(f.Participant1, f.participant1);
  const p2 = pickString(f.Participant2, f.participant2);
  const p1Home =
    typeof f.Participant1IsHome === 'boolean'
      ? f.Participant1IsHome
      : typeof f.participant1IsHome === 'boolean'
        ? f.participant1IsHome
        : true; // default: p1 is home

  let homeTeam: string;
  let awayTeam: string;
  if (p1 && p2) {
    homeTeam = p1Home ? p1 : p2;
    awayTeam = p1Home ? p2 : p1;
  } else {
    homeTeam = pickString(f.homeTeam, f.HomeTeam, (f as { home?: unknown }).home) ?? 'TBD';
    awayTeam = pickString(f.awayTeam, f.AwayTeam, (f as { away?: unknown }).away) ?? 'TBD';
  }

  // Kickoff — try StartTime (ms), then Kickoff/kickoff, then Ts as fallback.
  const kickoffRaw =
    f.startTime ?? f.StartTime ?? f.kickoff ?? f.Kickoff ?? f.ts ?? f.Ts;
  let kickoffAt: Date | null = null;
  if (typeof kickoffRaw === 'string') {
    const d = new Date(kickoffRaw);
    if (!Number.isNaN(d.getTime())) kickoffAt = d;
  } else if (typeof kickoffRaw === 'number') {
    // TxLINE StartTime is milliseconds; heuristic: > 10^12 → ms, else s.
    const d = new Date(kickoffRaw > 1e12 ? kickoffRaw : kickoffRaw * 1000);
    if (!Number.isNaN(d.getTime())) kickoffAt = d;
  }

  return {
    fixtureId,
    competitionId,
    competitionName,
    participant1IsHome: p1Home,
    homeTeam,
    awayTeam,
    kickoffAt,
    // TxLINE uses `GameState` (0=upcoming, 1=live, 100=final) in the snapshot;
    // the settlement doc uses `statusId` for the same concept.
    statusId: pickNumber(f.statusId, f.StatusId, f.gameState, f.GameState),
    period: pickNumber(f.period, f.Period),
    raw: f,
  };
}

async function upsertFixtures(items: NormalizedFixture[]): Promise<void> {
  // Bulk upsert. Prisma has no native bulk upsert, so we do them serially —
  // this only runs on cache miss (once/minute) so latency is fine.
  for (const f of items) {
    try {
      await prismaQuery.fixture.upsert({
        where: { fixtureId: f.fixtureId },
        create: {
          fixtureId: f.fixtureId,
          competitionId: f.competitionId,
          homeTeam: f.homeTeam,
          awayTeam: f.awayTeam,
          kickoffAt: f.kickoffAt,
          statusId: f.statusId,
          period: f.period,
          raw: f.raw as unknown as object,
        },
        update: {
          competitionId: f.competitionId ?? undefined,
          homeTeam: f.homeTeam,
          awayTeam: f.awayTeam,
          kickoffAt: f.kickoffAt ?? undefined,
          statusId: f.statusId ?? undefined,
          period: f.period ?? undefined,
        },
      });
    } catch {
      // best-effort; snapshot serving does not depend on mirror success
    }
  }
}

export const fixtureRoutes: FastifyPluginCallback = (app: FastifyInstance, _opts, done) => {
  app.get(
    '/',
    {
      config: {
        rateLimit: { max: 300, timeWindow: '1 minute' },
      },
      schema: {
        description:
          'Fixture snapshot. With no query params: cached TxLINE proxy. With ?search / ?status / ?limit / ?offset: DB-mirror search + pagination.',
        tags: ['fixtures'],
        querystring: {
          type: 'object',
          properties: {
            search: { type: 'string', minLength: 2, maxLength: 40 },
            status: { type: 'string', enum: ['live', 'upcoming', 'finished'] },
            limit: { type: 'integer', minimum: 1, maximum: 100 },
            offset: { type: 'integer', minimum: 0 },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      // ---- Query parse ----
      const parsed = ListQuery.safeParse(request.query);
      if (!parsed.success) {
        return handleError(reply, 400, 'invalid query', 'VALIDATION_ERROR', null, {
          issues: parsed.error.issues,
        });
      }
      const { search, status, limit: qLimit, offset: qOffset } = parsed.data;
      const limit = qLimit ?? 50;
      const offset = qOffset ?? 0;

      // ---- Search / filter path — DB mirror only ----
      // Any of search / status / explicit pagination triggers the DB
      // path. This keeps the snapshot-cache hot path unchanged for the
      // default homepage query.
      const hasFilters =
        search !== undefined || status !== undefined || qLimit !== undefined || qOffset !== undefined;
      if (hasFilters) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const where: any = {};
          if (status) Object.assign(where, statusFilterToWhere(status));
          if (search) {
            where.OR = [
              { homeTeam: { contains: search, mode: 'insensitive' } },
              { awayTeam: { contains: search, mode: 'insensitive' } },
              { competitionId: { contains: search, mode: 'insensitive' } },
            ];
          }
          const [rows, total] = await Promise.all([
            prismaQuery.fixture.findMany({
              where,
              orderBy: { kickoffAt: 'desc' },
              take: limit,
              skip: offset,
            }),
            prismaQuery.fixture.count({ where }),
          ]);
          const shaped = rows.map((f) => ({
            fixtureId: f.fixtureId,
            competitionId: f.competitionId,
            homeTeam: f.homeTeam,
            awayTeam: f.awayTeam,
            kickoffAt: f.kickoffAt?.toISOString() ?? null,
            statusId: f.statusId,
            period: f.period,
          }));
          return reply.code(200).send({
            success: true,
            error: null,
            data: shaped,
            meta: { total, limit, offset, hasMore: offset + shaped.length < total },
            source: 'db',
          });
        } catch (err) {
          return handleError(reply, 500, 'fixture search failed', 'FIXTURE_SEARCH_FAILED', err as Error);
        }
      }

      const now = Date.now();
      if (snapshotCache && now - snapshotCache.storedAt < SNAPSHOT_TTL_MS) {
        return reply.code(200).send({
          success: true,
          error: null,
          data: snapshotCache.data,
          cached: true,
        });
      }

      let rawSnapshot: unknown;
      try {
        const res = await txlineHttp.get('/api/fixtures/snapshot');
        rawSnapshot = res.data;
      } catch (err) {
        // If TxLINE is unavailable, serve from the mirror table so at least
        // stale-but-real data goes out.
        try {
          const fromDb = await prismaQuery.fixture.findMany({
            take: 100,
            orderBy: { kickoffAt: 'desc' },
          });
          const shaped = fromDb.map((f) => ({
            fixtureId: f.fixtureId,
            competitionId: f.competitionId,
            homeTeam: f.homeTeam,
            awayTeam: f.awayTeam,
            kickoffAt: f.kickoffAt?.toISOString() ?? null,
            statusId: f.statusId,
            period: f.period,
          }));
          return reply.code(200).send({
            success: true,
            error: null,
            data: shaped,
            cached: true,
            source: 'db-fallback',
          });
        } catch {
          return handleError(reply, 502, 'TxLINE fixtures unavailable', 'TXLINE_UNAVAILABLE', err as Error);
        }
      }

      const rawItems: RawFixture[] = Array.isArray(rawSnapshot)
        ? (rawSnapshot as RawFixture[])
        : ((rawSnapshot as { fixtures?: RawFixture[]; items?: RawFixture[] })?.fixtures
            ?? (rawSnapshot as { items?: RawFixture[] })?.items
            ?? []);

      const normalized = rawItems
        .map(normalizeFixture)
        .filter((f): f is NormalizedFixture => f !== null);

      // Fire-and-forget mirror.
      void upsertFixtures(normalized);

      const shape = normalized.map((f) => ({
        fixtureId: f.fixtureId,
        competitionId: f.competitionId,
        competitionName: f.competitionName,
        participant1IsHome: f.participant1IsHome,
        homeTeam: f.homeTeam,
        awayTeam: f.awayTeam,
        kickoffAt: f.kickoffAt?.toISOString() ?? null,
        statusId: f.statusId,
        period: f.period,
      }));

      snapshotCache = { storedAt: now, data: shape };
      return reply.code(200).send({ success: true, error: null, data: shape });
    },
  );

  // GET /api/fixtures/:id
  app.get(
    '/:id',
    { config: { rateLimit: { max: 240, timeWindow: '1 minute' } } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      if (!/^[0-9]+$/.test(id)) {
        return handleError(reply, 400, 'invalid fixtureId', 'VALIDATION_ERROR');
      }
      try {
        const fixture = await prismaQuery.fixture.findUnique({
          where: { fixtureId: id },
        });
        if (!fixture) {
          return handleError(reply, 404, 'fixture not found', 'FIXTURE_NOT_FOUND');
        }
        const latest = await prismaQuery.scorePacket.findFirst({
          where: { fixtureId: id },
          orderBy: { seq: 'desc' },
        });
        return reply.code(200).send({
          success: true,
          error: null,
          data: jsonSafe({
            fixture: {
              fixtureId: fixture.fixtureId,
              competitionId: fixture.competitionId,
              competitionName:
                (fixture.raw as { Competition?: string; competition?: string } | null)
                  ?.Competition ??
                (fixture.raw as { Competition?: string; competition?: string } | null)
                  ?.competition ??
                null,
              // Recover from raw if we stored it; default to `true` (P1 == home)
              // for older mirror rows that predate this field.
              participant1IsHome:
                (fixture.raw as { Participant1IsHome?: boolean } | null)
                  ?.Participant1IsHome ?? true,
              homeTeam: fixture.homeTeam,
              awayTeam: fixture.awayTeam,
              kickoffAt: fixture.kickoffAt?.toISOString() ?? null,
              statusId: fixture.statusId,
              period: fixture.period,
            },
            latestPacket: latest
              ? {
                  seq: latest.seq,
                  ts: latest.ts?.toString() ?? null,
                  action: latest.action,
                  statusId: latest.statusId,
                  period: latest.period,
                  raw: latest.raw,
                }
              : null,
          }),
        });
      } catch (err) {
        return handleError(reply, 500, 'failed to load fixture', 'FIXTURE_LOAD_FAILED', err as Error);
      }
    },
  );

  done();
};
