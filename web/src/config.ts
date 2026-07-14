const PROGRAM_ID = '39oqYsjuQLkFLEieaP7tisN8Bq4K8A2fS2gttKaFwTAT'
const CLUSTER = 'devnet'
const SOLSCAN_BASE = 'https://solscan.io'

interface AppConfig {
  appName: string
  appDescription: string
  links: {
    twitter: string
    github: string
    telegram: string
    discord: string
    docs: string
  }
  contracts: {
    main: string
    merkleTree: string
    collectionMint: string
    treeConfig: string
    treeStatePda: string
    collectionStatePda: string
    collectionMetadata: string
    collectionEdition: string
    mintAuthPda: string
    settleAlt: string
    txlineProgram: string
  }
  solscan: {
    tx: (sig: string) => string
    account: (addr: string) => string
    token: (mint: string) => string
  }
  flags: {
    kora: boolean
    turnkey: boolean
    blinks: boolean
    settler: boolean
    heliusDas: boolean
  }
  features: {
    darkMode: boolean
    smoothScroll: boolean
  }
}

export const config: AppConfig = {
  appName: 'Momentum',
  appDescription:
    'Predict every kick of the World Cup, own the moments. On-chain prediction pools with cNFT stickers as proof.',

  links: {
    twitter: 'https://twitter.com/momentum_sui',
    github: 'https://github.com/kwek-labs/momentum',
    telegram: '',
    discord: '',
    docs: '/docs',
  },

  contracts: {
    main: PROGRAM_ID,
    merkleTree: '2jKMbtBFhgnsPNNQnz9awKzDBpgisPSa87pDg5ZiU5PX',
    collectionMint: 'CJwWJmcMT3KyRq43fiXY7NZKAxYWg8759YcKaNL2Kbqg',
    treeConfig: 'FH11cU3FJZGyutv6DKynbncjnkK8aTf1NwCBQD1cCfdc',
    treeStatePda: '9oMjwx2AdLMckkNSPD1ytsipLxVwXJmYtbY1e1aNnYYr',
    collectionStatePda: 'Kh4o5Ahpk8hzXtnKZHJ7cVCU6eod4BW4urzofyoxFrj',
    collectionMetadata: 'm82nwvqoxZ27LnfjeMzCGe7j1XsQQMdHTWhm4C6vk3D',
    collectionEdition: 'Fen6DcmpQK6gkFYqom8BuSCEps54X9shY763XyLU56tL',
    mintAuthPda: 'FqUTz5Fmy8WXEvzkJhrsa1kTfsX6L1ox7cBgLmjPkb41',
    settleAlt: 'E6HMUAQswijWbVDAz2L884y9QbTmqj96Tt9VKky1rLH9',
    txlineProgram: '6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J',
  },

  solscan: {
    tx: (sig: string) => `${SOLSCAN_BASE}/tx/${sig}?cluster=${CLUSTER}`,
    account: (addr: string) =>
      `${SOLSCAN_BASE}/account/${addr}?cluster=${CLUSTER}`,
    token: (mint: string) => `${SOLSCAN_BASE}/token/${mint}?cluster=${CLUSTER}`,
  },

  // Default flags — overridden at runtime by GET /api/flags
  flags: {
    kora: false,
    turnkey: false,
    blinks: true,
    settler: true,
    heliusDas: true,
  },

  features: {
    darkMode: true,
    smoothScroll: true,
  },
}

export type Config = AppConfig
