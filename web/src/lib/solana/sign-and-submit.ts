import { Transaction, VersionedTransaction } from '@solana/web3.js'
import type { Connection } from '@solana/web3.js'
import type { WalletContextState } from '@solana/wallet-adapter-react'

export type SignAndSubmitResult = {
  txSig: string
}

/**
 * Takes a base64-encoded unsigned tx from the backend, signs it via the
 * wallet adapter, submits to the network, and awaits confirmation using
 * the lastValidBlockHeight strategy. Handles both legacy and v0 txs.
 *
 * NOTE: the `recentBlockhash` must be the one the backend baked INTO the tx,
 * not a fresh one — mismatched blockhash breaks confirmation strategy.
 */
export async function signAndSubmit(
  connection: Connection,
  wallet: WalletContextState,
  unsignedTxBase64: string,
  lastValidBlockHeight: number,
  recentBlockhash: string,
): Promise<SignAndSubmitResult> {
  if (!wallet.publicKey) {
    throw new Error('Wallet not connected')
  }
  if (!wallet.signTransaction) {
    throw new Error('Wallet does not support transaction signing')
  }

  const txBytes = Buffer.from(unsignedTxBase64, 'base64')

  // Detect versioned vs legacy. In an unsigned legacy serialize, byte 0 is
  // the signature count (0). In a v0 tx, byte 0 is the version prefix
  // (0x80+). So the 0x80 bit distinguishes them cleanly.
  const isVersioned = (txBytes[0] & 0x80) !== 0

  let rawTx: Uint8Array
  try {
    if (isVersioned) {
      const vTx = VersionedTransaction.deserialize(txBytes)
      const signed = await wallet.signTransaction(vTx)
      rawTx = signed.serialize()
    } else {
      const legacyTx = Transaction.from(txBytes)
      const signed = await wallet.signTransaction(legacyTx)
      rawTx = signed.serialize()
    }
  } catch (err) {
    console.error('[signAndSubmit] wallet sign failed', err)
    throw err
  }

  let txSig: string
  try {
    txSig = await connection.sendRawTransaction(rawTx, {
      skipPreflight: true,
      maxRetries: 3,
    })
    console.log('[signAndSubmit] submitted tx', txSig)
  } catch (err) {
    console.error('[signAndSubmit] sendRawTransaction failed', err)
    // Solana SDK sometimes wraps a SendTransactionError with .logs
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyErr = err as any
    if (anyErr?.logs) console.error('[signAndSubmit] program logs:', anyErr.logs)
    throw err
  }

  try {
    const conf = await connection.confirmTransaction(
      {
        signature: txSig,
        blockhash: recentBlockhash,
        lastValidBlockHeight,
      },
      'confirmed',
    )
    // confirmTransaction resolves "confirmed" even when the tx REVERTED
    // on-chain — you get a valid slot with a non-null .err. Surface it as
    // a proper thrown error so the UI can react.
    if (conf.value?.err) {
      console.error('[signAndSubmit] tx reverted on-chain', conf.value.err)
      try {
        const tx = await connection.getTransaction(txSig, {
          maxSupportedTransactionVersion: 0,
          commitment: 'confirmed',
        })
        if (tx?.meta?.logMessages) {
          console.error(
            '[signAndSubmit] on-chain logs:',
            tx.meta.logMessages,
          )
        }
      } catch {}
      throw new Error(
        `Transaction reverted on-chain: ${JSON.stringify(conf.value.err)}`,
      )
    }
  } catch (err) {
    console.error('[signAndSubmit] confirmTransaction failed', err)
    // Fetch tx logs from RPC — the confirmation error itself is opaque, but
    // the tx metadata carries the on-chain program logs which are readable.
    try {
      const tx = await connection.getTransaction(txSig, {
        maxSupportedTransactionVersion: 0,
        commitment: 'confirmed',
      })
      if (tx?.meta?.logMessages) {
        console.error('[signAndSubmit] on-chain logs:', tx.meta.logMessages)
      }
      if (tx?.meta?.err) {
        console.error('[signAndSubmit] on-chain err:', tx.meta.err)
      }
    } catch {}
    throw err
  }

  return { txSig }
}
