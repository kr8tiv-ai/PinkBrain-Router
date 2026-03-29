import { Connection, Keypair, VersionedTransaction } from '@solana/web3.js';
import pino from 'pino';
import type { SwapTransaction } from '../types/index.js';

const logger = pino({ name: 'signAndSendSwap' });

/**
 * Create a swap transaction signer bound to a specific Connection and Keypair.
 *
 * The Bags.fm / Jupiter API returns base64-encoded serialized VersionedTransactions.
 * This function decodes, partially signs, sends, and confirms them on-chain.
 *
 * @param connection - Solana RPC connection (typically Helius)
 * @param keypair - The swap signer's keypair (derived from SIGNER_PRIVATE_KEY)
 * @returns A function that takes a SwapTransaction and returns the on-chain tx signature
 */
export function createSignAndSendSwap(
  connection: Connection,
  keypair: Keypair,
): (swapTx: SwapTransaction) => Promise<string> {
  return async function signAndSendSwap(swapTx: SwapTransaction): Promise<string> {
    logger.debug(
      { lastValidBlockHeight: swapTx.lastValidBlockHeight, computeUnitLimit: swapTx.computeUnitLimit },
      'Deserializing swap transaction',
    );

    // Decode base64-encoded serialized VersionedTransaction (Jupiter standard)
    const txBytes = Buffer.from(swapTx.swapTransaction, 'base64');
    const transaction = VersionedTransaction.deserialize(txBytes);

    // Partially sign with the signer's keypair
    transaction.sign([keypair]);

    logger.debug('Transaction signed, sending to network');

    // Send the signed transaction
    const signature = await connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: false,
      maxRetries: 3,
    });

    logger.info({ signature }, 'Transaction sent, confirming');

    // Extract blockhash from the deserialized transaction message
    const blockhash = transaction.message.recentBlockhash;
    const { lastValidBlockHeight } = swapTx;

    try {
      await connection.confirmTransaction(
        { signature, blockhash, lastValidBlockHeight },
        'confirmed',
      );
    } catch (confirmError) {
      logger.error(
        {
          signature,
          blockhash,
          lastValidBlockHeight,
          error: (confirmError as Error).message,
        },
        'Swap transaction confirmation failed',
      );
      throw new Error(
        `Swap transaction ${signature} failed confirmation (blockhash: ${blockhash}, lastValidBlockHeight: ${lastValidBlockHeight}): ${(confirmError as Error).message}`,
      );
    }

    logger.info({ signature }, 'Swap transaction confirmed');
    return signature;
  };
}
