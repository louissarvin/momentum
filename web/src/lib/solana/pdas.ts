// PDA derivations mirroring backend/src/lib/solana/pdas.ts
// Only the two PDAs needed client-side per web-plan.md §3.3.

import { PublicKey } from '@solana/web3.js'
import { PROGRAM_ID } from './anchor'

function u64LeBytes(n: bigint): Buffer {
  const buf = Buffer.alloc(8)
  buf.writeBigUInt64LE(n)
  return buf
}

export async function deriveGroup(groupId: bigint): Promise<PublicKey> {
  const [pda] = await PublicKey.findProgramAddress(
    [Buffer.from('group'), u64LeBytes(groupId)],
    PROGRAM_ID,
  )
  return pda
}

export async function derivePredictionCard(
  user: PublicKey,
  fixtureId: bigint,
): Promise<PublicKey> {
  const [pda] = await PublicKey.findProgramAddress(
    [Buffer.from('card'), user.toBuffer(), u64LeBytes(fixtureId)],
    PROGRAM_ID,
  )
  return pda
}
