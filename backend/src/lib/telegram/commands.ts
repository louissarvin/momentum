/**
 * Telegram bot commands: /start and /share.
 *
 * All command handlers wrap their body in a try/catch — a thrown error
 * in a Telegraf handler is caught by the framework, but we still want
 * structured logging + a user-facing "something went wrong" message
 * instead of silence.
 */

import type { Telegraf } from 'telegraf';

import { prismaQuery } from '../prisma.ts';
import { getAsset, heliusAvailable } from '../helius.ts';
import { pushStickerCard, type StickerOutcome } from './bot.ts';
import { env } from '../../config/env.ts';

function solscanCluster(): string {
  if (env.SOLSCAN_CLUSTER) return env.SOLSCAN_CLUSTER;
  if (env.SOLANA_CLUSTER === 'mainnet') return 'mainnet-beta';
  return env.SOLANA_CLUSTER; // 'devnet' | 'testnet' | 'localnet'
}

function solscanAssetUrl(assetId: string): string {
  return `https://solscan.io/token/${encodeURIComponent(assetId)}?cluster=${solscanCluster()}`;
}

async function loadFixtureLabel(fixtureId: string): Promise<string | undefined> {
  try {
    const fx = await prismaQuery.fixture.findUnique({ where: { fixtureId } });
    if (!fx) return undefined;
    return `${fx.homeTeam} vs ${fx.awayTeam}`;
  } catch {
    return undefined;
  }
}

/**
 * Hydrate the display fields for a sticker asset from Prisma first, then
 * fall back to Helius DAS for the human-readable name / image.
 */
async function hydrateFromAsset(assetId: string): Promise<{
  name: string;
  imageUrl: string;
  outcome: StickerOutcome;
  fixtureLabel?: string;
  slotLabel?: string;
  solscanUrl: string;
} | null> {
  const mint = await prismaQuery.stickerMint.findFirst({ where: { assetId } });
  const outcome: StickerOutcome =
    mint?.outcome === 'hit' ? 'HIT' : mint?.outcome === 'miss' ? 'MISS' : 'PENDING';

  let name = mint ? `Sticker · ${mint.fixtureId}#${mint.slotIndex}` : `Sticker · ${assetId.slice(0, 8)}`;
  let imageUrl = `${env.METADATA_HOST}/stickers/${mint?.fixtureId ?? 'unknown'}-${mint?.slotIndex ?? 0}.png`;

  if (heliusAvailable()) {
    try {
      const asset = await getAsset(assetId);
      const metaName = asset.content?.metadata?.name;
      if (metaName) name = metaName;
      const imgFromLinks = asset.content?.links?.image;
      const imgFromFiles = asset.content?.files?.find((f) => f?.uri)?.uri;
      const cdnUri = asset.content?.files?.find((f) => f?.cdn_uri)?.cdn_uri;
      const chosen = cdnUri ?? imgFromLinks ?? imgFromFiles;
      if (chosen && /^https:\/\//i.test(chosen)) imageUrl = chosen;
    } catch {
      // best-effort — fall back to defaults derived above
    }
  }

  const fixtureLabel = mint?.fixtureId ? await loadFixtureLabel(mint.fixtureId) : undefined;
  const slotLabel = mint ? `Slot ${mint.slotIndex}` : undefined;

  return {
    name,
    imageUrl,
    outcome,
    fixtureLabel,
    slotLabel,
    solscanUrl: solscanAssetUrl(assetId),
  };
}

export function registerCommands(bot: Telegraf, defaultChatId: string | undefined): void {
  bot.start(async (ctx) => {
    try {
      await ctx.reply(
        [
          'Welcome to Momentum.',
          '',
          'Predict football stats on Solana. Every settled prediction mints a compressed sticker; every match earns a card.',
          '',
          'Use /share <assetId> to preview a minted sticker in this chat.',
        ].join('\n'),
      );
    } catch {
      /* ignore */
    }
  });

  bot.command('share', async (ctx) => {
    try {
      // Telegraf gives us ctx.message.text — split off the command.
      const raw = (ctx.message as { text?: string } | undefined)?.text ?? '';
      const parts = raw.trim().split(/\s+/);
      const assetId = parts[1];
      if (!assetId || assetId.length < 32) {
        await ctx.reply('Usage: /share <assetId>');
        return;
      }
      const hydrated = await hydrateFromAsset(assetId);
      if (!hydrated) {
        await ctx.reply('Sticker not found.');
        return;
      }
      const chatId = String(ctx.chat?.id ?? defaultChatId ?? '');
      if (!chatId) {
        await ctx.reply('No chat context to reply into.');
        return;
      }
      await pushStickerCard(bot, chatId, hydrated);
    } catch (err) {
      try {
        await ctx.reply('Something went wrong sharing that sticker.');
      } catch {
        /* ignore */
      }
      // eslint-disable-next-line no-console
      console.error('[telegram] /share error', (err as Error).message);
    }
  });
}
