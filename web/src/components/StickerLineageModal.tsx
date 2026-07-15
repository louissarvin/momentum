/**
 * StickerLineageModal — full audit trail for a minted sticker.
 *
 * Shows fixture, slot, outcome, merkle fields, mint tx, asset id.
 * All addresses: copy-to-clipboard + Solscan links.
 * "Share sticker" copies the dial.to Blinks URL.
 */

import { useState } from 'react'
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from '@heroui/react'
import { Check, Copy, ExternalLink, X } from 'lucide-react'
import type { CardLineage } from '@/lib/api/types'
import { cnm } from '@/utils/style'
import { solscanAcct, solscanTx } from '@/utils/solscan'
import { shortenAddress } from '@/utils/big'
import { env } from '@/env'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function blinkShareUrl(assetId: string): string {
  const actionUrl = `${env.VITE_API_URL}/api/actions/share-card/${encodeURIComponent(assetId)}`
  return `https://dial.to/?action=${encodeURIComponent(`solana-action:${actionUrl}`)}`
}

function CopyField({
  label,
  value,
  href,
}: {
  label: string
  value: string
  href?: string
}) {
  const [copied, setCopied] = useState(false)

  function copy() {
    navigator.clipboard
      .writeText(value)
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1800)
      })
      .catch(() => null)
  }

  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-mono uppercase tracking-[0.1em] text-slate-500">
        {label}
      </span>
      <div className="flex items-center gap-2">
        <span className="font-mono text-xs text-slate-300 truncate flex-1">
          {value.length > 20 ? shortenAddress(value, 8, 8) : value}
        </span>
        <button
          onClick={copy}
          aria-label={`Copy ${label}`}
          className={cnm(
            'shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-mono transition-colors duration-150 focus-ring',
            copied
              ? 'bg-success-500/15 border-success-500/30 text-success-500'
              : 'bg-ink-700 border-white/[0.1] text-slate-400 hover:text-cream-50',
          )}
        >
          {copied ? <Check size={10} strokeWidth={2} /> : <Copy size={10} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
        {href && (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`View ${label} on Solscan`}
            className="shrink-0 text-sui-500 hover:opacity-80 transition-opacity focus-ring rounded"
          >
            <ExternalLink size={12} strokeWidth={1.75} />
          </a>
        )}
      </div>
    </div>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  isOpen: boolean
  onClose: () => void
  lineage: CardLineage | null
  loading?: boolean
}

export function StickerLineageModal({
  isOpen,
  onClose,
  lineage,
  loading,
}: Props) {
  const [shareCopied, setShareCopied] = useState(false)

  const isHit = lineage?.outcome === 'hit' || lineage?.outcome === 'match_card'
  const accentColor = isHit
    ? 'var(--color-success-500)'
    : 'var(--color-slate-400)'

  function copyShareLink() {
    if (!lineage?.assetId) return
    navigator.clipboard
      .writeText(blinkShareUrl(lineage.assetId))
      .then(() => {
        setShareCopied(true)
        setTimeout(() => setShareCopied(false), 2000)
      })
      .catch(() => null)
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="lg"
      backdrop="blur"
      classNames={{
        backdrop: 'bg-ink-900/72',
        base: 'bg-ink-800 border border-white/[0.08] rounded-[var(--radius-2xl)] shadow-none',
        closeButton:
          'text-slate-400 hover:text-cream-50 transition-colors top-4 right-4',
      }}
      closeButton={
        <button
          onClick={onClose}
          aria-label="Close lineage modal"
          className="absolute top-4 right-4 p-1.5 rounded-full hover:bg-white/[0.06] transition-colors focus-ring text-slate-400 hover:text-cream-50"
        >
          <X size={16} strokeWidth={1.75} />
        </button>
      }
    >
      <ModalContent>
        <ModalHeader className="px-6 pt-6 pb-0">
          <div className="flex items-center gap-3">
            {/* Outcome badge */}
            <span
              className={cnm(
                'rounded-2xl relative inline-flex items-center gap-1.5 px-3 py-1 rounded-[var(--radius-sm)] font-mono text-xs font-bold uppercase tracking-widest',
                isHit
                  ? 'bg-success-500/15 text-success-500 border border-success-500/25'
                  : 'bg-slate-700/40 text-slate-400 border border-white/[0.08]',
              )}
              style={{ color: accentColor }}
            >
              {isHit ? 'HIT ✓' : 'MISS ✗'}
            </span>
            <div>
              <h2 className="text-base font-bold text-cream-50 leading-tight">
                Sticker Lineage
              </h2>
              <p className="text-xs text-slate-500 font-mono mt-0.5">
                {lineage?.fixture?.homeTeam ?? '—'} vs{' '}
                {lineage?.fixture?.awayTeam ?? '—'}
              </p>
            </div>
          </div>
        </ModalHeader>

        <ModalBody className="px-6 py-4">
          {loading && (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  className="h-8 rounded-[var(--radius-sm)] bg-ink-700 animate-pulse"
                />
              ))}
            </div>
          )}

          {!loading && !lineage && (
            <p className="text-sm text-slate-400 py-4 text-center font-mono">
              Proof data unavailable — lineage pending.
            </p>
          )}

          {!loading && lineage && (
            <div className="space-y-3">
              {/* Divider */}
              <div
                className="h-px w-full"
                style={{
                  background: `linear-gradient(to right, ${accentColor}40, transparent)`,
                }}
                aria-hidden="true"
              />

              {/* Merkle fields */}
              {lineage.assetId && (
                <CopyField
                  label="Asset ID"
                  value={lineage.assetId}
                  href={solscanAcct(lineage.assetId)}
                />
              )}

              {lineage.mintTxSig && (
                <CopyField
                  label="Mint Transaction"
                  value={lineage.mintTxSig}
                  href={solscanTx(lineage.mintTxSig)}
                />
              )}

              {lineage.eventStatRoot && (
                <CopyField
                  label="Event Stat Root"
                  value={lineage.eventStatRoot}
                />
              )}

              {lineage.proofTs && (
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] font-mono uppercase tracking-[0.1em] text-slate-500">
                    Proof Timestamp
                  </span>
                  <span className="font-mono text-xs text-slate-300">
                    {lineage.proofTs}
                  </span>
                </div>
              )}

              {lineage.tree && (
                <CopyField
                  label="Merkle Tree"
                  value={lineage.tree}
                  href={solscanAcct(lineage.tree)}
                />
              )}

              {lineage.leafIndex != null && (
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] font-mono uppercase tracking-[0.1em] text-slate-500">
                    Leaf Index
                  </span>
                  <span className="font-mono text-xs text-slate-300">
                    {String(lineage.leafIndex)}
                  </span>
                </div>
              )}

              {lineage.collection && (
                <CopyField
                  label="Collection"
                  value={lineage.collection}
                  href={solscanAcct(lineage.collection)}
                />
              )}

              {/* Slot + fixture */}
              {(lineage.slot != null || lineage.fixture?.fixtureId) && (
                <>
                  <div className="h-px bg-white/[0.06]" aria-hidden="true" />
                  <div className="grid grid-cols-2 gap-3">
                    {lineage.fixture?.fixtureId && (
                      <div className="flex flex-col gap-1">
                        <span className="text-[10px] font-mono uppercase tracking-[0.1em] text-slate-500">
                          Fixture ID
                        </span>
                        <span className="font-mono text-xs text-slate-300 truncate">
                          {lineage.fixture.fixtureId}
                        </span>
                      </div>
                    )}
                    {lineage.slot != null && (
                      <div className="flex flex-col gap-1">
                        <span className="text-[10px] font-mono uppercase tracking-[0.1em] text-slate-500">
                          Slot Index
                        </span>
                        <span className="font-mono text-xs text-slate-300">
                          {lineage.slot}
                        </span>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </ModalBody>

        <ModalFooter className="px-6 pb-6 pt-2 flex items-center gap-3">
          <button
            onClick={copyShareLink}
            disabled={!lineage?.assetId}
            className={cnm(
              'inline-flex items-center gap-2 h-9 px-4 rounded-full text-sm font-semibold transition-colors duration-150 focus-ring',
              'border',
              shareCopied
                ? 'bg-success-500/15 border-success-500/30 text-success-500'
                : 'bg-ink-700 border-white/[0.1] text-slate-400 hover:text-cream-50',
              !lineage?.assetId && 'opacity-40 cursor-not-allowed',
            )}
          >
            {shareCopied ? (
              <Check size={14} strokeWidth={2} />
            ) : (
              <Copy size={14} strokeWidth={1.75} />
            )}
            {shareCopied ? 'Link copied' : 'Share sticker'}
          </button>
          <button
            onClick={onClose}
            className="ml-auto h-9 px-5 rounded-full bg-accent-500 text-ink-900 font-semibold text-sm hover:bg-accent-600 transition-colors duration-150 focus-ring"
          >
            Done
          </button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
