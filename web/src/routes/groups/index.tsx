import { useState } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import {
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Skeleton,
  useDisclosure,
} from '@heroui/react'
import { Loader2, Plus, RefreshCw, Users } from 'lucide-react'
import { z } from 'zod'
import type { Group } from '@/lib/api/types'
import { groupsApi } from '@/lib/api/endpoints'
import { useCreateGroup } from '@/hooks/mutations/useGroupMutations'
import { useAuth } from '@/hooks/useAuth'
import { useToast } from '@/hooks/useToast'
import { ToastStack } from '@/components/ui/ToastStack'
import { lamportsToSol, shortenAddress } from '@/utils/big'
import { solscanAcct } from '@/utils/solscan'
import { cnm } from '@/utils/style'
import AnimateComponent from '@/components/elements/AnimateComponent'

export const Route = createFileRoute('/groups/')({ component: GroupsPage })

// ─── Form validation ──────────────────────────────────────────────────────────

const CreateGroupSchema = z.object({
  name: z.string().min(1, 'Name is required').max(32, 'Max 32 characters'),
  maxSize: z.coerce
    .number()
    .int()
    .min(2, 'Min 2 members')
    .max(64, 'Max 64 members'),
  entryFeeSol: z.coerce
    .number()
    .min(0, 'Entry fee cannot be negative')
    .max(100, 'Max 100 SOL'),
})

// ─── Group card ───────────────────────────────────────────────────────────────

function GroupCard({ group }: { group: Group }) {
  const fee = lamportsToSol(group.entryFeeLamports)
  const creatorShort = shortenAddress(group.creator)

  return (
    <Link
      to="/groups/$groupPda"
      params={{ groupPda: group.groupPda }}
      className={cnm(
        'block p-5 rounded-[var(--radius-lg)] bg-ink-800 border border-white/[0.08]',
        'hover:border-accent-500/40 hover:translate-y-[-2px] transition-all duration-200',
        'text-cream-50 focus-ring',
      )}
    >
      {/* Name + member count */}
      <div className="flex items-start justify-between mb-4">
        <h3 className="text-base font-semibold text-cream-50 leading-tight truncate mr-2">
          {group.name}
        </h3>
        <div className="flex items-center gap-1 shrink-0">
          <Users size={12} strokeWidth={1.75} className="text-slate-500" />
          <span className="font-mono text-xs text-slate-400 tabular-nums">
            {group.currentSize}/{group.maxSize}
          </span>
        </div>
      </div>

      {/* Stats row */}
      <div className="flex items-center gap-4 mb-4">
        <div>
          <p className="text-[10px] font-mono uppercase tracking-widest text-slate-600 mb-0.5">
            Entry
          </p>
          <p className="font-mono text-sm text-accent-500 tabular-nums">
            {fee === 0 ? 'Free' : `${fee.toFixed(3)} SOL`}
          </p>
        </div>
        <div>
          <p className="text-[10px] font-mono uppercase tracking-widest text-slate-600 mb-0.5">
            Creator
          </p>
          <a
            href={solscanAcct(group.creator)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="font-mono text-xs text-sui-500 hover:underline underline-offset-4 tabular-nums"
          >
            {creatorShort}
          </a>
        </div>
      </div>

      {/* CTA */}
      <div className="pt-3 border-t border-white/[0.06]">
        <span className="text-xs font-semibold text-accent-500 group-hover:underline underline-offset-4">
          Enter lobby →
        </span>
      </div>
    </Link>
  )
}

// ─── Skeleton card ────────────────────────────────────────────────────────────

function GroupSkeleton() {
  return (
    <div className="p-5 rounded-[var(--radius-lg)] bg-ink-800 border border-white/[0.06] space-y-3">
      <div className="flex justify-between">
        <Skeleton className="h-5 w-32 rounded-[var(--radius-sm)] pixel-shimmer bg-ink-700" />
        <Skeleton className="h-4 w-10 rounded-[var(--radius-sm)] pixel-shimmer bg-ink-700" />
      </div>
      <Skeleton className="h-4 w-20 rounded-[var(--radius-sm)] pixel-shimmer bg-ink-700" />
      <Skeleton className="h-3 w-full rounded-[var(--radius-sm)] pixel-shimmer bg-ink-700 mt-auto" />
    </div>
  )
}

// ─── Create group modal ───────────────────────────────────────────────────────

function CreateGroupModal({
  isOpen,
  onOpenChange,
}: {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [name, setName] = useState('')
  const [maxSize, setMaxSize] = useState('10')
  const [entryFeeSol, setEntryFeeSol] = useState('0')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const { isAuthenticated } = useAuth()
  const { toasts, show: showToast, dismiss } = useToast()
  const createGroup = useCreateGroup()

  async function handleCreate(onClose: () => void) {
    if (!isAuthenticated) {
      showToast('error', 'Connect your wallet first.')
      return
    }

    const parse = CreateGroupSchema.safeParse({ name, maxSize, entryFeeSol })
    if (!parse.success) {
      const errs: Record<string, string> = {}
      parse.error.issues.forEach((e) => {
        if (e.path[0]) errs[String(e.path[0])] = e.message
      })
      setErrors(errs)
      return
    }
    setErrors({})

    const entryFeeLamports = Math.round(parse.data.entryFeeSol * 1e9)

    try {
      const { groupPda } = await createGroup.mutateAsync({
        name: parse.data.name,
        maxSize: parse.data.maxSize,
        entryFeeLamports,
      })
      showToast('success', `Group "${name}" created.`)
      onClose()
      // Navigate happens naturally via link in the success toast
      window.location.href = `/groups/${groupPda}`
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create group'
      showToast('error', msg)
    }
  }

  const entryFeeNum = Number(entryFeeSol) || 0
  const maxSizeNum = Number(maxSize) || 0

  return (
    <>
      <Modal
        isOpen={isOpen}
        onOpenChange={onOpenChange}
        size="md"
        backdrop="blur"
        placement="center"
        classNames={{
          base: 'bg-ink-800 border border-white/[0.08] rounded-[var(--radius-2xl)] mx-4 max-w-[480px]',
          header: 'px-6 pt-6 pb-0 border-b-0',
          body: 'px-6 py-6',
          footer: 'px-6 py-4 border-t border-white/[0.06] bg-ink-900/40',
          closeButton:
            'top-4 right-4 text-slate-500 hover:text-cream-50 hover:bg-white/[0.06] rounded-full transition-colors',
        }}
      >
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader className="flex flex-col gap-1.5">
                <p className="text-[10px] font-mono uppercase tracking-[0.16em] text-accent-500">
                  New group
                </p>
                <h2 className="text-cream-50 font-bold text-2xl tracking-tight">
                  Create a group
                </h2>
                <p className="text-slate-400 text-sm font-normal leading-relaxed">
                  Invite friends. Compete on prediction accuracy. Winner takes the pot.
                </p>
              </ModalHeader>

              <ModalBody>
                <div className="space-y-5">
                  {/* Group name */}
                  <div className="space-y-2">
                    <label
                      htmlFor="group-name"
                      className="block text-[11px] font-mono uppercase tracking-[0.14em] text-slate-500"
                    >
                      Group name
                    </label>
                    <Input
                      id="group-name"
                      placeholder="The Lads · Torino Ultras · Bola Nusantara"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      maxLength={32}
                      isInvalid={!!errors.name}
                      errorMessage={errors.name}
                      classNames={{
                        input:
                          'bg-transparent text-cream-50 text-sm placeholder:text-slate-600',
                        inputWrapper:
                          'h-12 px-4 bg-ink-900/60 border border-white/[0.08] rounded-[var(--radius-md)] hover:border-white/[0.16] data-[focus=true]:border-accent-500 data-[focus=true]:shadow-[0_0_0_3px_rgba(249,115,22,0.15)] transition-all',
                        errorMessage: 'text-xs text-error-500 mt-1',
                      }}
                    />
                    <p className="text-[11px] text-slate-500">
                      {name.length}/32 characters
                    </p>
                  </div>

                  {/* Max members + Entry fee (2-col grid) */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <label
                        htmlFor="group-max"
                        className="block text-[11px] font-mono uppercase tracking-[0.14em] text-slate-500"
                      >
                        Max members
                      </label>
                      <Input
                        id="group-max"
                        placeholder="10"
                        type="number"
                        min={2}
                        max={64}
                        value={maxSize}
                        onChange={(e) => setMaxSize(e.target.value)}
                        isInvalid={!!errors.maxSize}
                        errorMessage={errors.maxSize}
                        endContent={
                          <span className="text-[11px] font-mono text-slate-500 whitespace-nowrap">
                            people
                          </span>
                        }
                        classNames={{
                          input:
                            'bg-transparent text-cream-50 text-sm font-mono placeholder:text-slate-600',
                          inputWrapper:
                            'h-12 px-4 bg-ink-900/60 border border-white/[0.08] rounded-[var(--radius-md)] hover:border-white/[0.16] data-[focus=true]:border-accent-500 data-[focus=true]:shadow-[0_0_0_3px_rgba(249,115,22,0.15)] transition-all',
                          errorMessage: 'text-xs text-error-500 mt-1',
                        }}
                      />
                      <p className="text-[11px] text-slate-500">
                        2 to 64
                      </p>
                    </div>

                    <div className="space-y-2">
                      <label
                        htmlFor="group-fee"
                        className="block text-[11px] font-mono uppercase tracking-[0.14em] text-slate-500"
                      >
                        Entry fee
                      </label>
                      <Input
                        id="group-fee"
                        placeholder="0"
                        type="number"
                        min={0}
                        step={0.001}
                        value={entryFeeSol}
                        onChange={(e) => setEntryFeeSol(e.target.value)}
                        isInvalid={!!errors.entryFeeSol}
                        errorMessage={errors.entryFeeSol}
                        endContent={
                          <span className="text-[11px] font-mono text-slate-500 whitespace-nowrap">
                            SOL
                          </span>
                        }
                        classNames={{
                          input:
                            'bg-transparent text-cream-50 text-sm font-mono placeholder:text-slate-600',
                          inputWrapper:
                            'h-12 px-4 bg-ink-900/60 border border-white/[0.08] rounded-[var(--radius-md)] hover:border-white/[0.16] data-[focus=true]:border-accent-500 data-[focus=true]:shadow-[0_0_0_3px_rgba(249,115,22,0.15)] transition-all',
                          errorMessage: 'text-xs text-error-500 mt-1',
                        }}
                      />
                      <p className="text-[11px] text-slate-500">
                        0 = free to join
                      </p>
                    </div>
                  </div>

                  {/* Prize preview */}
                  {entryFeeNum > 0 && maxSizeNum >= 2 && (
                    <div className="rounded-[var(--radius-md)] bg-accent-500/[0.06] border border-accent-500/20 p-3">
                      <p className="text-[10px] font-mono uppercase tracking-[0.14em] text-accent-500 mb-1">
                        Prize pool if full
                      </p>
                      <p className="text-cream-50 text-lg font-mono font-semibold">
                        {(entryFeeNum * maxSizeNum).toFixed(3)} SOL
                      </p>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        {maxSizeNum} × {entryFeeNum.toFixed(3)} SOL · winner takes all
                      </p>
                    </div>
                  )}
                </div>
              </ModalBody>

              <ModalFooter className="flex items-center justify-between gap-3">
                <button
                  onClick={() => onClose()}
                  className="px-5 h-10 rounded-full text-slate-400 text-sm font-medium hover:text-cream-50 hover:bg-white/[0.04] transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleCreate(onClose)}
                  disabled={createGroup.isPending || !name.trim()}
                  className={cnm(
                    'inline-flex items-center gap-2 px-6 h-10 rounded-full text-sm font-semibold',
                    'transition-all duration-150 focus-ring active:scale-[0.97]',
                    createGroup.isPending || !name.trim()
                      ? 'bg-accent-500/30 text-ink-900/50 cursor-not-allowed'
                      : 'bg-accent-500 text-ink-900 hover:bg-accent-600 shadow-[0_4px_16px_rgba(249,115,22,0.25)]',
                  )}
                >
                  {createGroup.isPending && (
                    <Loader2
                      size={14}
                      strokeWidth={1.75}
                      className="animate-spin"
                    />
                  )}
                  {createGroup.isPending ? 'Creating…' : 'Create group'}
                </button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

function GroupsPage() {
  const { isOpen, onOpen, onOpenChange } = useDisclosure()

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['groups', {}],
    queryFn: () => groupsApi.list({ limit: 20 }),
    staleTime: 30_000,
    retry: false,
  })

  const groups = data?.groups ?? []

  return (
    <div className="min-h-screen bg-ink-900">
      <div className="mx-auto w-full max-w-[1120px] px-4 md:px-6 py-12 md:py-16">
        {/* Header */}
        <AnimateComponent entry="fadeInUp" duration={400}>
          <div className="flex items-start justify-between mb-8">
            <div>
              <p className="text-xs font-mono uppercase tracking-[0.12em] text-accent-500 mb-2">
                Groups
              </p>
              <h1 className="text-3xl md:text-5xl font-bold text-cream-50 tracking-[-0.02em]">
                Momentum Groups
              </h1>
              <p className="mt-3 text-slate-400 text-base">
                Compete with friends. Share your prediction cards.
              </p>
            </div>
            <button
              onClick={onOpen}
              className={cnm(
                'inline-flex items-center gap-2 px-5 h-11 rounded-full shrink-0',
                'bg-accent-500 text-ink-900 font-semibold text-sm',
                'hover:bg-accent-600 active:scale-[0.97] transition-all duration-150 focus-ring',
              )}
            >
              <Plus size={15} strokeWidth={1.75} />
              Create group
            </button>
          </div>
        </AnimateComponent>

        {/* Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {isLoading &&
            Array.from({ length: 6 }).map((_, i) => <GroupSkeleton key={i} />)}

          {isError && (
            <div className="col-span-full flex flex-col items-center py-24 text-center">
              <p className="text-base font-semibold text-cream-50 mb-2">
                Failed to load groups.
              </p>
              <button
                onClick={() => refetch()}
                className="mt-4 inline-flex items-center gap-2 px-5 h-10 rounded-full bg-ink-700 border border-white/[0.1] text-cream-50 text-sm font-semibold hover:bg-ink-800 transition-colors"
              >
                <RefreshCw size={14} strokeWidth={1.75} />
                Retry
              </button>
            </div>
          )}

          {!isLoading && !isError && groups.length === 0 && (
            <div className="col-span-full flex flex-col items-center py-24 text-center">
              <div className="w-24 h-24 rounded-[var(--radius-lg)] bg-ink-800 border border-white/[0.06] flex items-center justify-center mb-6 text-4xl pixel">
                🪑
              </div>
              <p className="text-base font-semibold text-cream-50 mb-2">
                No groups yet.
              </p>
              <p className="text-sm text-slate-400 mb-6">
                Be the first to create one and invite your crew.
              </p>
              <button
                onClick={onOpen}
                className="inline-flex items-center gap-2 px-6 h-11 rounded-full bg-accent-500 text-ink-900 font-semibold text-sm hover:bg-accent-600 transition-colors"
              >
                <Plus size={15} strokeWidth={1.75} />
                Create group
              </button>
            </div>
          )}

          {!isLoading &&
            !isError &&
            groups.map((group, i) => (
              <AnimateComponent
                key={group.groupPda}
                entry="fadeInUp"
                duration={400}
                delay={i * 50}
              >
                <GroupCard group={group} />
              </AnimateComponent>
            ))}
        </div>
      </div>

      <CreateGroupModal isOpen={isOpen} onOpenChange={onOpenChange} />
    </div>
  )
}
