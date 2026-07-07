-- CreateEnum
CREATE TYPE "SettlementJobType" AS ENUM ('settle', 'match_card');

-- CreateEnum
CREATE TYPE "SettlementJobStatus" AS ENUM ('pending', 'in_progress', 'done', 'error');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "nonce" TEXT,
    "lastSignIn" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErrorLog" (
    "id" TEXT NOT NULL,
    "errorCode" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "statusCode" INTEGER NOT NULL,
    "stack" TEXT,
    "context" TEXT,
    "userId" TEXT,
    "method" TEXT,
    "path" TEXT,
    "userAgent" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ErrorLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "wallet" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TxlineSession" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "jwt" TEXT NOT NULL,
    "apiToken" TEXT NOT NULL,
    "jwtExpiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TxlineSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TxlineJwt" (
    "id" TEXT NOT NULL,
    "jwt" TEXT NOT NULL,
    "jwtExpiresAt" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TxlineJwt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Fixture" (
    "fixtureId" TEXT NOT NULL,
    "competitionId" TEXT,
    "homeTeam" TEXT NOT NULL,
    "awayTeam" TEXT NOT NULL,
    "kickoffAt" TIMESTAMP(3),
    "statusId" INTEGER,
    "period" INTEGER,
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Fixture_pkey" PRIMARY KEY ("fixtureId")
);

-- CreateTable
CREATE TABLE "ScorePacket" (
    "id" TEXT NOT NULL,
    "fixtureId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "ts" BIGINT,
    "action" TEXT,
    "statusId" INTEGER,
    "period" INTEGER,
    "raw" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScorePacket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProofCache" (
    "id" TEXT NOT NULL,
    "fixtureId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "statKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProofCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Group" (
    "groupPda" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "creator" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "maxSize" INTEGER NOT NULL,
    "currentSize" INTEGER NOT NULL DEFAULT 0,
    "entryFeeLamports" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Group_pkey" PRIMARY KEY ("groupPda")
);

-- CreateTable
CREATE TABLE "Membership" (
    "groupPda" TEXT NOT NULL,
    "userWallet" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("groupPda","userWallet")
);

-- CreateTable
CREATE TABLE "PredictionCard" (
    "cardPda" TEXT NOT NULL,
    "userWallet" TEXT NOT NULL,
    "fixtureId" TEXT NOT NULL,
    "slots" JSONB NOT NULL,
    "slotCount" INTEGER NOT NULL,
    "matchCardMinted" BOOLEAN NOT NULL DEFAULT false,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PredictionCard_pkey" PRIMARY KEY ("cardPda")
);

-- CreateTable
CREATE TABLE "StickerMint" (
    "id" TEXT NOT NULL,
    "cardPda" TEXT NOT NULL,
    "userWallet" TEXT NOT NULL,
    "fixtureId" TEXT NOT NULL,
    "slotIndex" INTEGER NOT NULL,
    "outcome" TEXT NOT NULL,
    "stickerAssetSeq" BIGINT,
    "assetId" TEXT,
    "treeMerkle" TEXT,
    "eventStatRoot" TEXT,
    "proofTs" BIGINT,
    "mintTxSig" TEXT,
    "mintedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StickerMint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchCard" (
    "id" TEXT NOT NULL,
    "cardPda" TEXT NOT NULL,
    "userWallet" TEXT NOT NULL,
    "fixtureId" TEXT NOT NULL,
    "assetId" TEXT,
    "eventStatRoot" TEXT,
    "proofTs" BIGINT,
    "mintTxSig" TEXT,
    "mintedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatchCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Listing" (
    "listingPda" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "seller" TEXT NOT NULL,
    "priceLamports" BIGINT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Listing_pkey" PRIMARY KEY ("listingPda")
);

-- CreateTable
CREATE TABLE "Sale" (
    "id" TEXT NOT NULL,
    "listingPda" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "seller" TEXT NOT NULL,
    "buyer" TEXT NOT NULL,
    "priceLamports" BIGINT NOT NULL,
    "saleTxSig" TEXT NOT NULL,
    "soldAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Sale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SettlementJob" (
    "id" TEXT NOT NULL,
    "type" "SettlementJobType" NOT NULL,
    "fixtureId" TEXT NOT NULL,
    "seq" INTEGER,
    "statKey" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "status" "SettlementJobStatus" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SettlementJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_walletAddress_key" ON "User"("walletAddress");

-- CreateIndex
CREATE INDEX "User_walletAddress_idx" ON "User"("walletAddress");

-- CreateIndex
CREATE INDEX "ErrorLog_errorCode_idx" ON "ErrorLog"("errorCode");

-- CreateIndex
CREATE INDEX "ErrorLog_createdAt_idx" ON "ErrorLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Session_nonce_key" ON "Session"("nonce");

-- CreateIndex
CREATE INDEX "Session_wallet_idx" ON "Session"("wallet");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "TxlineJwt_createdAt_idx" ON "TxlineJwt"("createdAt");

-- CreateIndex
CREATE INDEX "Fixture_competitionId_idx" ON "Fixture"("competitionId");

-- CreateIndex
CREATE INDEX "Fixture_kickoffAt_idx" ON "Fixture"("kickoffAt");

-- CreateIndex
CREATE INDEX "Fixture_statusId_idx" ON "Fixture"("statusId");

-- CreateIndex
CREATE INDEX "ScorePacket_fixtureId_createdAt_idx" ON "ScorePacket"("fixtureId", "createdAt");

-- CreateIndex
CREATE INDEX "ScorePacket_action_idx" ON "ScorePacket"("action");

-- CreateIndex
CREATE UNIQUE INDEX "ScorePacket_fixtureId_seq_key" ON "ScorePacket"("fixtureId", "seq");

-- CreateIndex
CREATE INDEX "ProofCache_fixtureId_seq_idx" ON "ProofCache"("fixtureId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "ProofCache_fixtureId_seq_statKey_key" ON "ProofCache"("fixtureId", "seq", "statKey");

-- CreateIndex
CREATE UNIQUE INDEX "Group_groupId_key" ON "Group"("groupId");

-- CreateIndex
CREATE INDEX "Group_creator_idx" ON "Group"("creator");

-- CreateIndex
CREATE INDEX "Group_deletedAt_idx" ON "Group"("deletedAt");

-- CreateIndex
CREATE INDEX "Membership_userWallet_idx" ON "Membership"("userWallet");

-- CreateIndex
CREATE INDEX "PredictionCard_fixtureId_idx" ON "PredictionCard"("fixtureId");

-- CreateIndex
CREATE INDEX "PredictionCard_userWallet_idx" ON "PredictionCard"("userWallet");

-- CreateIndex
CREATE UNIQUE INDEX "PredictionCard_userWallet_fixtureId_key" ON "PredictionCard"("userWallet", "fixtureId");

-- CreateIndex
CREATE INDEX "StickerMint_userWallet_idx" ON "StickerMint"("userWallet");

-- CreateIndex
CREATE INDEX "StickerMint_fixtureId_idx" ON "StickerMint"("fixtureId");

-- CreateIndex
CREATE INDEX "StickerMint_assetId_idx" ON "StickerMint"("assetId");

-- CreateIndex
CREATE UNIQUE INDEX "StickerMint_cardPda_slotIndex_key" ON "StickerMint"("cardPda", "slotIndex");

-- CreateIndex
CREATE UNIQUE INDEX "MatchCard_cardPda_key" ON "MatchCard"("cardPda");

-- CreateIndex
CREATE INDEX "MatchCard_userWallet_idx" ON "MatchCard"("userWallet");

-- CreateIndex
CREATE INDEX "MatchCard_fixtureId_idx" ON "MatchCard"("fixtureId");

-- CreateIndex
CREATE UNIQUE INDEX "Listing_assetId_key" ON "Listing"("assetId");

-- CreateIndex
CREATE INDEX "Listing_seller_idx" ON "Listing"("seller");

-- CreateIndex
CREATE INDEX "Listing_active_idx" ON "Listing"("active");

-- CreateIndex
CREATE INDEX "Listing_deletedAt_idx" ON "Listing"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Sale_saleTxSig_key" ON "Sale"("saleTxSig");

-- CreateIndex
CREATE INDEX "Sale_buyer_idx" ON "Sale"("buyer");

-- CreateIndex
CREATE INDEX "Sale_assetId_idx" ON "Sale"("assetId");

-- CreateIndex
CREATE INDEX "Sale_seller_idx" ON "Sale"("seller");

-- CreateIndex
CREATE INDEX "SettlementJob_status_priority_createdAt_idx" ON "SettlementJob"("status", "priority", "createdAt");

-- CreateIndex
CREATE INDEX "SettlementJob_fixtureId_idx" ON "SettlementJob"("fixtureId");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScorePacket" ADD CONSTRAINT "ScorePacket_fixtureId_fkey" FOREIGN KEY ("fixtureId") REFERENCES "Fixture"("fixtureId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProofCache" ADD CONSTRAINT "ProofCache_fixtureId_fkey" FOREIGN KEY ("fixtureId") REFERENCES "Fixture"("fixtureId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_groupPda_fkey" FOREIGN KEY ("groupPda") REFERENCES "Group"("groupPda") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StickerMint" ADD CONSTRAINT "StickerMint_cardPda_fkey" FOREIGN KEY ("cardPda") REFERENCES "PredictionCard"("cardPda") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchCard" ADD CONSTRAINT "MatchCard_cardPda_fkey" FOREIGN KEY ("cardPda") REFERENCES "PredictionCard"("cardPda") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_listingPda_fkey" FOREIGN KEY ("listingPda") REFERENCES "Listing"("listingPda") ON DELETE CASCADE ON UPDATE CASCADE;
