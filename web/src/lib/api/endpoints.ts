import { queryOptions } from '@tanstack/react-query'
import { apiGet, apiPost } from './client'
import type {
  CardLineage,
  Challenge,
  Fixture,
  FixtureDetail,
  Flags,
  Group,
  HealthResponse,
  Listing,
  ListingWithSticker,
  LiveStats,
  LoginResponse,
  PredictionCard,
  PredictionSlotInput,
  ReplayStatus,
  SessionUser,
  StickerMint,
  UnsignedTxEnvelope,
  UserProfile,
} from './types'

// Session
export const sessionApi = {
  challenge: (wallet: string) =>
    apiPost<Challenge>('/api/session/challenge', { wallet }),

  walletLogin: (payload: { wallet: string; signature: string }) =>
    apiPost<LoginResponse>('/api/session/wallet-login', payload),

  me: () => apiGet<SessionUser>('/api/session/me'),
}

export const sessionMeOptions = () =>
  queryOptions({
    queryKey: ['session', 'me'],
    queryFn: () => sessionApi.me(),
    retry: false,
  })

// Fixtures
export const fixturesApi = {
  list: () => apiGet<Array<Fixture>>('/api/fixtures'),
  get: (id: string) => apiGet<FixtureDetail>(`/api/fixtures/${id}`),
}

export const fixturesListOptions = () =>
  queryOptions({
    queryKey: ['fixtures'],
    queryFn: () => fixturesApi.list(),
    staleTime: 30_000,
  })

export const fixtureDetailOptions = (id: string) =>
  queryOptions({
    queryKey: ['fixtures', id],
    queryFn: () => fixturesApi.get(id),
    staleTime: 10_000,
  })

// Groups
export const groupsApi = {
  list: (params?: { limit?: number; cursor?: string }) => {
    const url = new URL('/api/groups', 'http://x')
    if (params?.limit) url.searchParams.set('limit', String(params.limit))
    if (params?.cursor) url.searchParams.set('cursor', params.cursor)
    return apiGet<{ groups: Array<Group>; nextCursor: string | null }>(
      url.pathname + url.search,
    )
  },
  get: (groupPda: string) => apiGet<Group>(`/api/groups/${groupPda}`),
  create: (
    payload: {
      name: string
      maxSize: number
      entryFeeLamports: number | string
    },
    idempotencyKey?: string,
  ) =>
    apiPost<
      UnsignedTxEnvelope & {
        groupPda: string
        vaultPda: string
        membershipPda: string
      }
    >('/api/groups', payload, { idempotencyKey }),
  confirm: (groupPda: string, txSig: string) =>
    apiPost<Group>(`/api/groups/${groupPda}/confirm`, { txSig }),
  join: (groupPda: string) =>
    apiPost<UnsignedTxEnvelope>(`/api/groups/${groupPda}/join`, {}),
  joinConfirm: (groupPda: string, txSig: string) =>
    apiPost<{ membership: unknown; group: Group }>(
      `/api/groups/${groupPda}/join/confirm`,
      { txSig },
    ),
}

// Predictions
export const predictionsApi = {
  submit: (fixtureId: string, slots: Array<PredictionSlotInput>) =>
    apiPost<
      | (UnsignedTxEnvelope & { fixtureId: string; cardPda: string })
      | { cardPda: string; alreadyExists: true; unsignedTx: null }
    >(`/api/predictions/${fixtureId}`, { slots }),

  confirm: (fixtureId: string, txSig: string) =>
    apiPost<PredictionCard>(`/api/predictions/${fixtureId}/confirm`, { txSig }),

  me: (fixtureId: string) =>
    apiGet<PredictionCard>(`/api/predictions/${fixtureId}/me`),
}

export const predictionMeOptions = (fixtureId: string) =>
  queryOptions({
    queryKey: ['predictions', fixtureId, 'me'],
    queryFn: () => predictionsApi.me(fixtureId),
    staleTime: 5_000,
  })

// Cards / Album
export const cardsApi = {
  mine: (params?: { limit?: number; cursor?: string }) => {
    const url = new URL('/api/cards/mine', 'http://x')
    if (params?.limit) url.searchParams.set('limit', String(params.limit))
    if (params?.cursor) url.searchParams.set('cursor', params.cursor)
    return apiGet<{
      cards: Array<StickerMint>
      count: number
      nextCursor: string | null
      source: string
    }>(url.pathname + url.search)
  },
  get: (assetId: string) =>
    apiGet<{ assetId: string; mirror: unknown; dasAsset: unknown }>(
      `/api/cards/${assetId}`,
    ),
  lineage: (assetId: string) =>
    apiGet<CardLineage>(`/api/cards/${assetId}/lineage`),
}

export const cardsMineOptions = () =>
  queryOptions({
    queryKey: ['cards', 'mine'],
    queryFn: () => cardsApi.mine(),
    staleTime: 30_000,
  })

export const cardLineageOptions = (assetId: string) =>
  queryOptions({
    queryKey: ['cards', assetId, 'lineage'],
    queryFn: () => cardsApi.lineage(assetId),
    staleTime: Infinity,
  })

// Marketplace
export const marketplaceApi = {
  list: (params?: {
    limit?: number
    cursor?: string
    sort?: 'price_asc' | 'price_desc' | 'createdAt'
  }) => {
    const url = new URL('/api/marketplace', 'http://x')
    if (params?.limit) url.searchParams.set('limit', String(params.limit))
    if (params?.cursor) url.searchParams.set('cursor', params.cursor)
    if (params?.sort) url.searchParams.set('sort', params.sort)
    return apiGet<{
      listings: Array<ListingWithSticker>
      nextCursor: string | null
    }>(url.pathname + url.search)
  },
  get: (listingPda: string) =>
    apiGet<{ listing: Listing; sticker: StickerMint | null }>(
      `/api/marketplace/${listingPda}`,
    ),
  buy: (listingPda: string) =>
    apiPost<
      UnsignedTxEnvelope & {
        listingPda: string
        assetId: string
        priceLamports: string
      }
    >(`/api/marketplace/buy/${listingPda}`, {}),
  buyConfirm: (listingPda: string, txSig: string) =>
    apiPost<{
      listingPda: string
      buyer: string
      seller: string
      assetId: string
      priceLamports: string
      saleTxSig: string
    }>(`/api/marketplace/buy/${listingPda}/confirm`, { txSig }),
  cancel: (listingPda: string) =>
    apiPost<UnsignedTxEnvelope>(`/api/marketplace/cancel/${listingPda}`, {}),
  cancelConfirm: (listingPda: string, txSig: string) =>
    apiPost<{ listingPda: string; cancelled: true }>(
      `/api/marketplace/cancel/${listingPda}/confirm`,
      { txSig },
    ),
}

export const marketplaceListOptions = (
  sort?: 'price_asc' | 'price_desc' | 'createdAt',
) =>
  queryOptions({
    queryKey: ['marketplace', { sort }],
    queryFn: () => marketplaceApi.list({ sort }),
    staleTime: 15_000,
  })

// Meta
export const metaApi = {
  health: () => apiGet<HealthResponse>('/health'),
  flags: () => apiGet<Flags>('/api/flags'),
  replayStatus: () => apiGet<ReplayStatus>('/api/replay/status'),
}

export const healthOptions = () =>
  queryOptions({
    queryKey: ['health'],
    queryFn: () => metaApi.health(),
    staleTime: 30_000,
    refetchInterval: 30_000,
  })

export const flagsOptions = () =>
  queryOptions({
    queryKey: ['flags'],
    queryFn: () => metaApi.flags(),
    staleTime: 60_000,
  })

// Live stats
export const statsApi = {
  live: () => apiGet<LiveStats>('/api/stats/live'),
}

export const liveStatsOptions = () =>
  queryOptions({
    queryKey: ['stats', 'live'],
    queryFn: () => statsApi.live(),
    staleTime: 30_000,
    refetchInterval: 30_000,
    retry: false,
  })

// User profiles
export const usersApi = {
  profile: (wallet: string) => apiGet<UserProfile>(`/api/users/${wallet}`),
}

export const userProfileOptions = (wallet: string) =>
  queryOptions({
    queryKey: ['users', wallet, 'profile'],
    queryFn: () => usersApi.profile(wallet),
    staleTime: 60_000,
    retry: false,
  })
