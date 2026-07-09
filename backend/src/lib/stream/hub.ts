/**
 * In-process pub/sub — Phase B / B.4.
 *
 * A thin typed wrapper over Node's EventEmitter used to fan out events
 * inside the HTTP process. Phase C's SSE fanout route subscribes to these
 * events and pushes them to browser clients.
 *
 * The ingester runs in a separate process (per doc 13 §6.6 restart
 * isolation), so it does NOT emit here directly — instead it writes to
 * Postgres and the pg-notify-bridge plugin (plugins/pg-notify-bridge.ts)
 * re-emits into this hub on LISTEN notifications.
 */

import { EventEmitter } from 'node:events';

export interface StreamPacketEvent {
  fixtureId: string;
  seq: number;
  ts?: number;
  action?: string | null;
  statusId?: number | null;
  period?: number | null;
  raw: unknown;
}

export interface StickerMintedEvent {
  fixtureId: string;
  cardPda: string;
  slotIndex: number;
  assetId?: string | null;
  mintTxSig?: string | null;
  // Optional on-chain-decoded fields (populated when the settler successfully
  // runs Anchor's EventParser against the confirmed tx logs — Pass 6).
  user?: string | null;
  outcome?: number | null; // 1 = HIT, 2 = MISS
  stickerAssetSeq?: string | null;
  eventStatRoot?: string | null; // hex
  proofTs?: string | null;
  merkleTree?: string | null;
  decoded?: boolean;
}

export interface MatchCardClaimedEvent {
  fixtureId: string;
  cardPda: string;
  assetId?: string | null;
  mintTxSig?: string | null;
  user?: string | null;
  matchCardSeq?: string | null;
  eventStatRoot?: string | null;
  proofTs?: string | null;
  merkleTree?: string | null;
  decoded?: boolean;
}

export interface SettlementStartedEvent {
  jobId: string;
  fixtureId: string;
  seq?: number | null;
  statKey?: string | null;
}

export interface SettlementErrorEvent {
  jobId: string;
  fixtureId: string;
  error: string;
}

export interface StreamHubEvents {
  packet: (evt: StreamPacketEvent) => void;
  sticker_minted: (evt: StickerMintedEvent) => void;
  match_card_claimed: (evt: MatchCardClaimedEvent) => void;
  settlement_started: (evt: SettlementStartedEvent) => void;
  settlement_error: (evt: SettlementErrorEvent) => void;
}

class StreamHub extends EventEmitter {
  emit<K extends keyof StreamHubEvents>(
    event: K,
    ...args: Parameters<StreamHubEvents[K]>
  ): boolean {
    return super.emit(event, ...args);
  }
  on<K extends keyof StreamHubEvents>(event: K, listener: StreamHubEvents[K]): this {
    return super.on(event, listener as (...a: unknown[]) => void);
  }
  off<K extends keyof StreamHubEvents>(event: K, listener: StreamHubEvents[K]): this {
    return super.off(event, listener as (...a: unknown[]) => void);
  }
}

/** Process-wide singleton. */
export const streamHub = new StreamHub();
// Never throw on emit-with-no-listeners. A quiet fixture is a valid state.
streamHub.setMaxListeners(0);
