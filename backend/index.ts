import './dotenv.ts';

// Sentry MUST be initialised before any other module wires into errorHandler.
import { initSentry } from './src/lib/sentry.ts';
initSentry('http');

import Fastify from 'fastify';
import FastifyCors from '@fastify/cors';
import FastifyHelmet from '@fastify/helmet';
import FastifyJwt from '@fastify/jwt';
import FastifyRateLimit from '@fastify/rate-limit';
import FastifySensible from '@fastify/sensible';
import FastifySwagger from '@fastify/swagger';
import FastifySwaggerUi from '@fastify/swagger-ui';
import { fastifyRequestContext } from '@fastify/request-context';

import { env } from './src/config/env.ts';
import { flags } from './src/lib/flags.ts';
import { pushRawLine } from './src/lib/log-buffer.ts';
import { captureError, isSentryActive } from './src/lib/sentry.ts';

// Plugins
import solanaPlugin from './src/plugins/solana.ts';
import authPlugin from './src/plugins/auth.ts';
import streamPlugin from './src/plugins/stream.ts';
import pgNotifyBridge from './src/plugins/pg-notify-bridge.ts';
import corsActionsPlugin from './src/plugins/cors-actions.ts';
import telegramPlugin from './src/plugins/telegram.ts';

// Routes
import { healthRoutes } from './src/routes/health.ts';
import { exampletRoute } from './src/routes/exampleRoutes.ts';
import { sessionRoutes } from './src/routes/session.ts';
import { fixtureRoutes } from './src/routes/fixtures.ts';
import { groupRoutes } from './src/routes/groups.ts';
import { predictionRoutes } from './src/routes/predictions.ts';
import { albumRoutes } from './src/routes/album.ts';
import { streamRoutes } from './src/routes/stream.ts';
import { marketplaceRoutes } from './src/routes/marketplace.ts';
import { actionsRoutes } from './src/routes/actions.ts';
import { flagRoutes } from './src/routes/flags.ts';
import { replayRoutes } from './src/routes/replay.ts';
import { logsRoutes } from './src/routes/logs.ts';
import { statsRoutes } from './src/routes/stats.ts';
import { userRoutes } from './src/routes/users.ts';
import { matchCardRoutes } from './src/routes/match-cards.ts';
import { notifyRoutes } from './src/routes/notify.ts';
import { telegramCardRoutes } from './src/routes/telegram-card.ts';

// Workers
import { startErrorLogCleanupWorker } from './src/workers/errorLogCleanup.ts';

// TxLINE
import { bootstrapTxline } from './src/lib/txline/bootstrap.ts';
import { refreshTxline } from './src/lib/txline/refresh.ts';
import { registerTxlineRefresher } from './src/lib/txline/client.ts';
import { connection as solConnection } from './src/lib/solana/connection.ts';
import { keeper as solKeeper } from './src/lib/solana/keeper.ts';

// ------------------------------------------------------------
// Log destination: fan pino output into both stdout AND our
// in-process ring buffer so `/api/logs/tail` can serve it in dev.
// ------------------------------------------------------------

const logStream = {
  write(chunk: string): void {
    // stdout for humans + platform log aggregators
    process.stdout.write(chunk);
    // in-memory ring for /api/logs/tail
    if (env.IS_DEV) pushRawLine(chunk);
  },
};

// ------------------------------------------------------------
// Fastify instance
// ------------------------------------------------------------

const fastify = Fastify({
  trustProxy: true,
  bodyLimit: 100 * 1024,
  // Fastify auto-tags every req with a genReqId; we surface it as `reqId`
  // in every log line via serializers. This is what makes the demo
  // transcript searchable (`jq 'select(.reqId=="...")'`).
  genReqId: (req) => {
    const hdr = req.headers['x-request-id'];
    if (typeof hdr === 'string' && hdr.length > 0 && hdr.length <= 128) return hdr;
    return `req_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
  },
  requestIdLogLabel: 'reqId',
  logger: env.IS_DEV
    ? {
        level: env.LOG_LEVEL,
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers["x-api-token"]',
            'req.headers.cookie',
            '*.jwt',
            '*.apiToken',
            '*.secretKey',
            '*.privateKey',
            '*.KEEPER_SECRET_JSON',
            '*.KEEPER_KEYPAIR_PATH',
          ],
          censor: '[REDACTED]',
        },
        transport: {
          target: 'pino-pretty',
          options: {
            translateTime: 'SYS:HH:MM:ss.l',
            ignore: 'pid,hostname',
          },
        },
      }
    : {
        level: env.LOG_LEVEL,
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers["x-api-token"]',
            'req.headers.cookie',
            '*.jwt',
            '*.apiToken',
            '*.secretKey',
            '*.privateKey',
            '*.KEEPER_SECRET_JSON',
            '*.KEEPER_KEYPAIR_PATH',
          ],
          censor: '[REDACTED]',
        },
        // In prod we skip pino-pretty so the platform ingests raw JSON.
        // Route through our tee stream so the dev buffer path stays uniform.
        stream: logStream,
        // Serializer enriches every request log with wallet+route pulled
        // from request-context (populated in the preHandler below).
        serializers: {
          req(req: {
            id?: string;
            method?: string;
            url?: string;
            headers?: Record<string, unknown>;
            momentumUser?: { walletAddress?: string };
          }): Record<string, unknown> {
            return {
              reqId: req.id,
              method: req.method,
              url: req.url,
              wallet: req.momentumUser?.walletAddress,
            };
          },
        },
      },
});

// ------------------------------------------------------------
// Global plugin registration order
// ------------------------------------------------------------

async function registerPlugins(): Promise<void> {
  await fastify.register(FastifySensible);

  // Phase E / E.2: request-context lets us tag every log line with the
  // authenticated wallet even from deep inside handlers.
  await fastify.register(fastifyRequestContext, {
    defaultStoreValues: {
      wallet: null as string | null,
      route: null as string | null,
    },
  });

  await fastify.register(FastifyHelmet, {
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  });

  const allowedOrigins = env.FRONTEND_URL.split(',').map((s) => s.trim()).filter(Boolean);
  await fastify.register(FastifyCors, {
    origin: env.IS_DEV ? true : allowedOrigins,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'token', 'x-api-token'],
    credentials: false,
  });

  await fastify.register(FastifyRateLimit, {
    max: 300,
    timeWindow: '1 minute',
  });

  await fastify.register(FastifyJwt, {
    secret: env.SESSION_JWT_SECRET,
    sign: { expiresIn: env.SESSION_JWT_EXPIRES_IN },
  });

  await fastify.register(solanaPlugin);
  await fastify.register(authPlugin);
  await fastify.register(streamPlugin);
  await fastify.register(pgNotifyBridge);
  await fastify.register(corsActionsPlugin);
  // Telegram plugin AFTER auth/solana (in case future commands need them),
  // BEFORE the /api/notify route below which reads `app.telegram`.
  await fastify.register(telegramPlugin);

  // -------- OpenAPI (Phase E / E.4) --------
  await fastify.register(FastifySwagger, {
    openapi: {
      info: {
        title: 'MOMENTUM API',
        version: '0.1.0',
        description: [
          `MOMENTUM backend — Solana devnet.`,
          `programId: ${env.MOMENTUM_PROGRAM_ID}`,
          `txlineProgramId: ${env.TXLINE_PROGRAM_ID}`,
          `cluster: ${env.SOLANA_CLUSTER}`,
        ].join('\n\n'),
      },
      servers: [{ url: `http://localhost:${env.APP_PORT}` }],
      tags: [
        { name: 'meta', description: 'Health, flags, replay status, logs.' },
        { name: 'session', description: 'SIWS challenge/verify + JWT.' },
        { name: 'fixtures', description: 'Fixtures + score packets.' },
        { name: 'groups', description: 'Group create/join.' },
        { name: 'predictions', description: 'Prediction cards + confirms.' },
        { name: 'cards', description: 'Sticker album + cNFT lineage.' },
        { name: 'stream', description: 'SSE fanout.' },
        { name: 'marketplace', description: 'List/buy/cancel cNFTs.' },
        { name: 'actions', description: 'Solana Actions / Blinks.' },
      ],
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        },
      },
    },
  });
  await fastify.register(FastifySwaggerUi, {
    routePrefix: '/docs',
    uiConfig: { docExpansion: 'list', deepLinking: true },
  });
}

// ------------------------------------------------------------
// Routes
// ------------------------------------------------------------

function registerRoutes(): void {
  fastify.register(healthRoutes);
  fastify.register(exampletRoute, { prefix: '/example' });
  fastify.register(sessionRoutes, { prefix: '/api/session' });
  fastify.register(fixtureRoutes, { prefix: '/api/fixtures' });
  fastify.register(groupRoutes, { prefix: '/api/groups' });
  fastify.register(predictionRoutes, { prefix: '/api/predictions' });
  fastify.register(albumRoutes, { prefix: '/api/cards' });
  fastify.register(streamRoutes, { prefix: '/api/stream' });
  fastify.register(marketplaceRoutes, { prefix: '/api/marketplace' });
  fastify.register(actionsRoutes);
  fastify.register(flagRoutes, { prefix: '/api/flags' });
  fastify.register(replayRoutes, { prefix: '/api/replay' });
  fastify.register(statsRoutes, { prefix: '/api/stats' });
  fastify.register(userRoutes, { prefix: '/api/users' });
  fastify.register(matchCardRoutes, { prefix: '/api/match-cards' });
  fastify.register(notifyRoutes, { prefix: '/api/notify' });
  fastify.register(telegramCardRoutes, { prefix: '/api/telegram' });
  if (env.IS_DEV) {
    fastify.register(logsRoutes, { prefix: '/api/logs' });
  }
}

// ------------------------------------------------------------
// Global request hooks — Phase E / E.2 structured tags.
// Populate request-context with wallet from JWT (best-effort) so log
// serializers can tag every line with it.
// ------------------------------------------------------------

function attachRequestContext(): void {
  fastify.addHook('preHandler', async (req) => {
    try {
      const raw = req.headers.authorization;
      if (raw && raw.startsWith('Bearer ')) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const claims = (await (req as any).jwtVerify({ onlyCookie: false }).catch(() => null)) as
          | { wallet?: string; sub?: string }
          | null;
        if (claims?.wallet) {
          req.requestContext.set('wallet', claims.wallet);
        }
      }
    } catch {
      // Anonymous request — nothing to tag.
    }
    req.requestContext.set('route', `${req.method} ${req.routeOptions?.url ?? req.url}`);
  });

  // Enrich every request log with the resolved context.
  fastify.addHook('onResponse', async (req, reply) => {
    const wallet = req.requestContext.get('wallet');
    const route = req.requestContext.get('route');
    const line = {
      reqId: req.id,
      wallet: wallet ?? undefined,
      route: route ?? undefined,
      statusCode: reply.statusCode,
      durMs: Math.round(reply.elapsedTime),
    };
    req.log.info(line, 'request completed');
    // Feed the dev ring buffer directly — pino-pretty is a worker
    // transport so we can't sniff its stream in-process.
    if (env.IS_DEV) {
      pushRawLine(
        JSON.stringify({
          time: Date.now(),
          level: reply.statusCode >= 500 ? 50 : reply.statusCode >= 400 ? 40 : 30,
          msg: 'request completed',
          ...line,
        }),
      );
    }
  });

  // Global uncaught-error hook → Sentry.
  fastify.setErrorHandler((err, req, reply) => {
    req.log.error({ err, reqId: req.id }, 'unhandled error');
    if (isSentryActive()) {
      const wallet = req.requestContext.get('wallet') ?? undefined;
      captureError(err, {
        reqId: req.id,
        route: `${req.method} ${req.url}`,
        wallet,
      });
    }
    if (!reply.sent) {
      const status =
        (err as { statusCode?: number }).statusCode ?? 500;
      reply.code(status).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
        data: null,
      });
    }
  });
}

// ------------------------------------------------------------
// TxLINE activation (fire-and-forget on boot)
// ------------------------------------------------------------

function startTxlineBootstrap(): void {
  registerTxlineRefresher(async () => {
    fastify.log.info('TxLINE refresh triggered by 401');
    await refreshTxline((m) => fastify.log.info(m));
  });

  const log = (m: string) => fastify.log.info(m);
  bootstrapTxline({ connection: solConnection, keeper: solKeeper, log })
    .then((res) => {
      fastify.log.info(
        { txSig: res.txSig, jwtExpiresAt: res.jwtExpiresAt },
        'TxLINE bootstrap complete',
      );
    })
    .catch((err) => {
      fastify.log.error({ err }, 'TxLINE bootstrap failed — /health will show txlineAuth: not_initialized');
      captureError(err, { component: 'txline-bootstrap' });
    });
}

// ------------------------------------------------------------
// Graceful shutdown
// ------------------------------------------------------------

function attachShutdown(): void {
  const shutdown = async (signal: string): Promise<void> => {
    fastify.log.info({ signal }, 'Received shutdown signal, closing server');
    try {
      await fastify.close();
      process.exit(0);
    } catch (err) {
      fastify.log.error({ err }, 'Error during shutdown');
      captureError(err, { component: 'shutdown' });
      process.exit(1);
    }
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  // Uncaught → Sentry, then exit.
  process.on('uncaughtException', (err: unknown) => {
    fastify.log.fatal({ err }, 'uncaughtException');
    captureError(err, { component: 'uncaught' });
  });
  process.on('unhandledRejection', (err: unknown) => {
    fastify.log.fatal({ err }, 'unhandledRejection');
    captureError(err, { component: 'unhandledRejection' });
  });
}

// ------------------------------------------------------------
// Boot
// ------------------------------------------------------------

const start = async (): Promise<void> => {
  try {
    await registerPlugins();
    attachRequestContext();
    registerRoutes();
    attachShutdown();

    startErrorLogCleanupWorker();

    await fastify.listen({
      port: env.APP_PORT,
      host: '0.0.0.0',
    });

    fastify.log.info(
      {
        port: env.APP_PORT,
        env: env.NODE_ENV,
        cluster: env.SOLANA_CLUSTER,
        programId: env.MOMENTUM_PROGRAM_ID,
        flags,
        sentry: isSentryActive() ? 'active' : 'noop',
        docs: `/docs`,
      },
      'MOMENTUM backend online',
    );

    startTxlineBootstrap();

    // ------------------------------------------------------------
    // Auto-spawn workers in the same container.
    //
    // Set AUTO_SPAWN_WORKERS=true (Railway/Fly) to run all 3 workers
    // as child processes alongside the HTTP server. Each worker's
    // stdio is inherited so logs stream to the container log. If a
    // worker crashes, we log it but keep the HTTP server running —
    // and restart the worker up to 5 times with 5s backoff.
    //
    // For local dev, leave this unset and run each worker in its
    // own `bun run` terminal (per README).
    // ------------------------------------------------------------
    if (process.env.AUTO_SPAWN_WORKERS === 'true') {
      spawnWorkers();
    }
  } catch (error) {
    fastify.log.error({ err: error }, 'Error starting server');
    captureError(error, { component: 'boot' });
    process.exit(1);
  }
};

function spawnWorkers(): void {
  const workers = ['ingester', 'settler', 'replay'] as const;
  const maxRestarts = 5;
  const restartDelayMs = 5000;
  const restartCounts = new Map<string, number>();

  const spawn = (name: string): void => {
    const script = `src/workers/${name}.ts`;
    fastify.log.info({ worker: name, script }, '[bootstrap] spawning worker');

    const proc = Bun.spawn(['bun', 'run', script], {
      stdout: 'inherit',
      stderr: 'inherit',
      env: process.env,
      onExit(_p, exitCode, signalCode) {
        const count = (restartCounts.get(name) ?? 0) + 1;
        restartCounts.set(name, count);
        fastify.log.warn(
          { worker: name, exitCode, signalCode, restarts: count },
          '[bootstrap] worker exited',
        );
        if (count > maxRestarts) {
          fastify.log.error(
            { worker: name, maxRestarts },
            '[bootstrap] worker exceeded max restart attempts, giving up',
          );
          return;
        }
        setTimeout(() => spawn(name), restartDelayMs);
      },
    });
    fastify.log.info({ worker: name, pid: proc.pid }, '[bootstrap] worker started');
  };

  workers.forEach(spawn);
}

void start();
