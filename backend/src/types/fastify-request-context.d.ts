/**
 * Module augmentation for @fastify/request-context — Phase E / E.2.
 *
 * We stash `wallet` and `route` into the per-request context store so
 * every log line (via serializer) can pick them up. Without this
 * augmentation the RequestContextData interface is `never`, which makes
 * `.set('wallet', ...)` a type error.
 */

import '@fastify/request-context';

declare module '@fastify/request-context' {
  interface RequestContextData {
    wallet: string | null;
    route: string | null;
  }
}
