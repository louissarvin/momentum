import type { FastifyInstance, FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import { prismaQuery } from '../lib/prisma.ts';
import { env } from '../config/env.ts';
import { readSettlerHeartbeat } from '../lib/settler-heartbeat.ts';
import { readReplayStatus } from '../lib/replay-status.ts';
import { flags } from '../lib/flags.ts';
import { getCachedLiveStats } from './stats.ts';

const bootTime = Date.now();
const VERSION = '0.1.0';

// Balance is a devnet RPC round-trip — cache 15s so /health stays cheap
// enough for the platform's health-check poller (typical 2-10s cadence).
const BALANCE_CACHE_MS = 15_000;
let cachedBalance: { lamports: number; ts: number } | null = null;

// Ingester staleness threshold. > 30s since last heartbeat → 'stale'.
const INGESTER_STALE_MS = 30_000;
// Settler heartbeat threshold. > 10s → 'stale'.
const SETTLER_STALE_MS = 10_000;
const ERROR_LOOKBACK_MS = 24 * 60 * 60 * 1000;

/**
 * Health / readiness — Phase E / E.8 final shape.
 *
 * Judges + sponsor will curl this. Keep every probe best-effort — a
 * single failing subsystem must not fail the whole response.
 */
export const healthRoutes: FastifyPluginCallback = (app: FastifyInstance, _opts, done) => {
  app.get(
    '/health',
    {
      schema: {
        description: 'Full health surface — all subsystems, all counts. Never fails.',
        tags: ['meta'],
      },
    },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      let prismaConnected = false;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (prismaQuery as any).$queryRawUnsafe('SELECT 1');
        prismaConnected = true;
      } catch (err) {
        app.log.warn({ err }, '/health: prisma probe failed');
      }

      // TxLINE + ingester derived from TxlineSession singleton row.
      let txlineAuth: 'not_initialized' | 'live' | 'expired' = 'not_initialized';
      let txlineJwtValidHours: number | null = null;
      let lastPacketMs: number | null = null;
      let ingesterStatus: 'live' | 'stale' | 'not_started' = 'not_started';

      if (prismaConnected) {
        try {
          const row = await prismaQuery.txlineSession.findUnique({ where: { id: 1 } });
          if (row) {
            const now = Date.now();
            txlineAuth = row.jwtExpiresAt.getTime() > now ? 'live' : 'expired';
            txlineJwtValidHours = Math.max(0, (row.jwtExpiresAt.getTime() - now) / 3_600_000);
            if (row.lastPacketAt) {
              lastPacketMs = now - row.lastPacketAt.getTime();
              ingesterStatus = lastPacketMs > INGESTER_STALE_MS ? 'stale' : 'live';
            } else if (row.ingesterStartedAt) {
              const sinceStart = now - row.ingesterStartedAt.getTime();
              ingesterStatus = sinceStart > INGESTER_STALE_MS ? 'stale' : 'live';
            }
          }
        } catch (err) {
          app.log.warn({ err }, '/health: TxlineSession probe failed');
        }
      }

      let backlogPending = 0;
      let backlogInProgress = 0;
      let backlogErrored24h = 0;
      let backlogDoneLast24h = 0;
      if (prismaConnected) {
        try {
          backlogPending = await prismaQuery.settlementJob.count({ where: { status: 'pending' } });
          backlogInProgress = await prismaQuery.settlementJob.count({
            where: { status: 'in_progress' },
          });
          backlogErrored24h = await prismaQuery.settlementJob.count({
            where: {
              status: 'error',
              updatedAt: { gt: new Date(Date.now() - ERROR_LOOKBACK_MS) },
            },
          });
          backlogDoneLast24h = await prismaQuery.settlementJob.count({
            where: {
              status: 'done',
              updatedAt: { gt: new Date(Date.now() - ERROR_LOOKBACK_MS) },
            },
          });
        } catch (err) {
          app.log.warn({ err }, '/health: settlementJob count failed');
        }
      }

      // Pass 8 / E-7 — embed the same landing counters we serve at
      // /api/stats/live so ops can see them in a single probe. Best
      // effort: a stats failure must not fail the whole health probe.
      let liveStats:
        | {
            totalPredictions: number;
            totalStickers: number;
            activeGroups: number;
          }
        | null = null;
      if (prismaConnected) {
        try {
          const s = await getCachedLiveStats();
          liveStats = {
            totalPredictions: s.totalPredictions,
            totalStickers: s.totalStickers,
            activeGroups: s.activeGroups,
          };
        } catch (err) {
          app.log.warn({ err }, '/health: live stats probe failed');
        }
      }

      // Marketplace stats — Phase D / D.6.
      let marketplaceActive = 0;
      let marketplaceSales24h = 0;
      if (prismaConnected) {
        try {
          marketplaceActive = await prismaQuery.listing.count({
            where: { active: true, deletedAt: null },
          });
          marketplaceSales24h = await prismaQuery.sale.count({
            where: { soldAt: { gt: new Date(Date.now() - ERROR_LOOKBACK_MS) } },
          });
        } catch (err) {
          app.log.warn({ err }, '/health: marketplace count failed');
        }
      }

      let settlerStatus: 'live' | 'stale' | 'not_started' = 'not_started';
      let settlerLastTickMs: number | null = null;
      let settlerLastJobId: string | null = null;
      try {
        const hb = await readSettlerHeartbeat();
        if (hb) {
          settlerLastTickMs = Date.now() - new Date(hb.updatedAt).getTime();
          settlerStatus = settlerLastTickMs > SETTLER_STALE_MS ? 'stale' : 'live';
          settlerLastJobId = hb.lastJobId ?? null;
        }
      } catch (err) {
        app.log.warn({ err }, '/health: settler heartbeat read failed');
      }

      // Replay worker state — file-heartbeat like the settler.
      let replayMode: {
        active: boolean;
        fixtureId: string | null;
        currentSeq: number | null;
        endSeq: number | null;
      } = { active: false, fixtureId: null, currentSeq: null, endSeq: null };
      let replayWorkerStatus: 'active' | 'not_started' = 'not_started';
      try {
        const rp = await readReplayStatus();
        if (rp) {
          replayMode = {
            active: rp.active,
            fixtureId: rp.fixtureId,
            currentSeq: rp.currentSeq,
            endSeq: rp.endSeq,
          };
          replayWorkerStatus = rp.active ? 'active' : 'not_started';
        }
      } catch {
        // best-effort
      }

      const sol = app.solana;
      let keeperBalanceSol: number | null = null;
      if (sol) {
        const now = Date.now();
        if (cachedBalance && now - cachedBalance.ts < BALANCE_CACHE_MS) {
          keeperBalanceSol = cachedBalance.lamports / LAMPORTS_PER_SOL;
        } else {
          try {
            const lamports = await sol.connection.getBalance(sol.keeper.publicKey, 'confirmed');
            cachedBalance = { lamports, ts: now };
            keeperBalanceSol = lamports / LAMPORTS_PER_SOL;
          } catch (err) {
            app.log.warn({ err }, '/health: keeper balance probe failed');
            if (cachedBalance) keeperBalanceSol = cachedBalance.lamports / LAMPORTS_PER_SOL;
          }
        }
      }

      // Prisma pool stats — best-effort. The pg driver adapter doesn't
      // expose a public counter, so we surface what we can from the pool
      // instance if present. Null-safe.
      let poolSize: number | null = null;
      let activeConnections: number | null = null;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const anyPrisma = prismaQuery as any;
        const pool = anyPrisma?._engine?.driverAdapterManager?.adapter?.pool ?? anyPrisma?.$pool;
        if (pool) {
          poolSize = typeof pool.totalCount === 'number' ? pool.totalCount : null;
          activeConnections = typeof pool.idleCount === 'number'
            ? Math.max(0, (pool.totalCount ?? 0) - pool.idleCount)
            : null;
        }
      } catch {
        // ignore
      }

      // Enveloped in {success, error, data} to match the rest of the API.
      // The frontend's `apiFetch` always unwraps `data` — this was the
      // source of the "Backend offline" widget bug on Vercel. Docker /
      // Railway healthchecks still work fine since they only look at
      // HTTP status code, not response body shape.
      return reply.code(200).send({
        success: true,
        error: null,
        data: {
          status: 'ok',
          uptimeMs: Date.now() - bootTime,
          commit: process.env.GIT_COMMIT ?? 'unknown',
          version: VERSION,
          replayMode,
          flags,
          solana: {
            cluster: env.SOLANA_CLUSTER,
            programId: sol?.momentum.programId.toBase58() ?? env.MOMENTUM_PROGRAM_ID,
            keeper: sol?.keeper.publicKey.toBase58() ?? null,
            keeperBalanceSol,
          },
          prisma: {
            connected: prismaConnected,
            poolSize,
            activeConnections,
          },
          txlineAuth,
          txlineJwtValidHours,
          lastPacketMs,
          workers: {
            ingester: ingesterStatus,
            settler: settlerStatus,
            replay: replayWorkerStatus,
            settlerLastTickMs,
            settlerLastJobId,
          },
          backlog: {
            pending: backlogPending,
            inProgress: backlogInProgress,
            errored: backlogErrored24h,
            doneLast24h: backlogDoneLast24h,
          },
          marketplace: {
            activeListings: marketplaceActive,
            salesLast24h: marketplaceSales24h,
          },
          stats: liveStats ?? { totalPredictions: 0, totalStickers: 0, activeGroups: 0 },
        },
      });
    },
  );

  // Root now redirects to health so old checks still hit something useful.
  app.get('/', async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.redirect('/health', 302);
  });

  done();
};
