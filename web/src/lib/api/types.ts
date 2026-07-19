// API types mirroring backend Zod schemas.
// bigint fields serialized as string on the wire (backend uses jsonSafe()).

export type Envelope<T> =
  | { success: true; error: null; data: T }
  | {
      success: false
      error: { code: string; message: string }
      data: null
      timestamp: string
    }

// Session
export type SessionUser = { id: string; wallet: string; createdAt: string }
export type LoginResponse = { token: string; user: SessionUser }
export type Challenge = {
  nonce: string
  message: string
  expiresAt: string
}

// Fixtures
export type Fixture = {
  fixtureId: string
  competitionId: string | null
  competitionName?: string | null
  // TxLINE stat keys are keyed to P1/P2. When true, base key 1 = home team;
  // when false, base key 2 = home team. Default true if missing (backend
  // mirror rows predating this field).
  participant1IsHome?: boolean
  homeTeam: string
  awayTeam: string
  kickoffAt: string | null
  statusId: number | null
  period: number | null
}
export type FixtureDetail = {
  fixture: Fixture
  latestPacket: null | {
    seq: number
    ts: string | null
    action: string | null
    statusId: number | null
    period: number | null
    raw: unknown
  }
}

// Groups
export type Membership = {
  groupPda: string
  userWallet: string
  joinedAt?: string
}
export type Group = {
  groupPda: string
  groupId: string
  creator: string
  name: string
  maxSize: number
  currentSize: number
  entryFeeLamports: string
  createdAt: string
  deletedAt: string | null
  memberships?: Array<Membership>
}
export type UnsignedTxEnvelope = {
  unsignedTx: string
  recentBlockhash: string
  lastValidBlockHeight: number
  feePayer: string
}

// Predictions
export type PredictionSlotInput = {
  statAKey: number
  statBKey?: number
  op?: 0 | 1 | 2
  predicateComparison: 0 | 1 | 2
  threshold: number
  period?: number
}
export type SlotStatus = 'pending' | 'hit' | 'miss'
export type PredictionSlotMirror = PredictionSlotInput & {
  status: number
  stickerAssetSeq: string
  eventStatRoot: string
  proofTs: string
}
export type PredictionCard = {
  cardPda: string
  userWallet: string
  fixtureId: string
  slotCount: number
  slots: Array<PredictionSlotMirror>
  stickers?: Array<StickerMint>
  matchCard?: MatchCard | null
}

// Album / Cards
export type StickerMint = {
  assetId: string | null
  stickerAssetSeq: string | null
  fixtureId: string
  slotIndex: number | null
  outcome: 'hit' | 'miss' | 'match_card' | null
  mintTxSig: string | null
  eventStatRoot: string | null
  proofTs: string | null
  mintedAt: string
  tree: string
  collection: string
  name?: string | null
  image?: string | null
  uri?: string | null
}
export type MatchCard = StickerMint
export type CardLineage = {
  assetId: string
  kind: 'sticker' | 'match_card'
  fixture: {
    fixtureId: string
    competitionId?: string | null
    homeTeam?: string
    awayTeam?: string
    kickoffAt?: string | null
    statusId?: number | null
  }
  slot: number | null
  outcome: string
  eventStatRoot: string | null
  proofTs: string | null
  mintTxSig: string | null
  mintTxSolscan: string | null
  tree: string
  leafIndex: string | null
  collection: string
  das: { asset: unknown; proof: unknown }
}

// Marketplace
export type Listing = {
  listingPda: string
  assetId: string
  seller: string
  priceLamports: string
  active: boolean
  createdAt: string
  deletedAt: string | null
}
export type ListingWithSticker = Listing & { sticker: StickerMint | null }

// Live stats
export type LiveStats = {
  totalPredictions: number
  totalStickersMinted: number
  activeGroups: number
  salesLast24h: number
}

// Public user profile
export type UserProfile = {
  wallet: string
  memberSince: string
  stats: {
    predictionsSubmitted: number
    slotsHit: number
    slotsMissed: number
    slotsPending: number
    hitRate: number
    stickersOwned: number
    matchCardsClaimed: number
    groupsJoined: number
    listingsCreated: number
    salesCompleted: number
  }
  recentActivity: Array<{
    type: string
    description: string
    at: string
    txSig?: string | null
  }>
}

// Meta
export type Flags = {
  kora: boolean
  turnkey: boolean
  blinks: boolean
  settler: boolean
  heliusDas: boolean
}
export type ReplayStatus = null | {
  active: boolean
  fixtureId: string
  currentSeq: number
  endSeq: number
  startSeq: number
  totalPackets: number
  processedPackets: number
  speed: number
  startedAt: string
  updatedAt: string
  estimatedCompletionAt: string | null
  finishedAt?: string
}
export type HealthResponse = {
  status: 'ok'
  uptimeMs: number
  commit: string
  version: string
  replayMode: {
    active: boolean
    fixtureId: string | null
    currentSeq: number | null
    endSeq: number | null
  }
  flags: Flags
  solana: {
    cluster: string
    programId: string
    keeper: string | null
    keeperBalanceSol: number | null
  }
  prisma: {
    connected: boolean
    poolSize: number | null
    activeConnections: number | null
  }
  txlineAuth: 'not_initialized' | 'live' | 'expired' | string
  txlineJwtValidHours: number | null
  lastPacketMs: number | null
  workers: {
    ingester: string
    settler: string
    replay: string
    settlerLastTickMs: number | null
    settlerLastJobId: string | null
  }
  backlog: {
    pending: number
    inProgress: number
    errored: number
    doneLast24h: number
  }
  marketplace: { activeListings: number; salesLast24h: number }
  stats?: {
    totalPredictions: number
    totalStickers: number
    activeGroups: number
  }
}

// SSE events
export type SseEvent =
  | {
      event: 'hello'
      data: { fixtureId: string; wallet: string | null; serverTime: string }
    }
  | {
      event: 'packet'
      data: { fixtureId: string; seq: number; [k: string]: unknown }
    }
  | {
      event: 'sticker_minted'
      data: {
        fixtureId: string
        userWallet?: string
        cardPda?: string
        slotIndex?: number
        assetId?: string
        mintTxSig?: string
      }
    }
  | {
      event: 'match_card_claimed'
      data: { fixtureId: string; userWallet?: string; assetId?: string }
    }
  | { event: 'settlement_started'; data: { fixtureId: string } }
  | { event: 'settlement_error'; data: { fixtureId: string; error: string } }

// Pagination
export type PaginatedResponse<T> = {
  items: Array<T>
  nextCursor: string | null
}
