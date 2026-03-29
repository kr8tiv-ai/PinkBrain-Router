import { Connection, Keypair, VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';
import pino from 'pino';
import type { ClaimTransaction } from '../types/index.js';

const logger = pino({ name: 'signAndSendClaim' });

/**
 * Create a claim transaction signer bound to a specific Connection and Keypair.
 *
 * The Bags.fm API returns base58-encoded serialized VersionedTransactions.
 * This function decodes, partially signs, sends, and confirms them on-chain.
 *
 * @param connection - Solana RPC connection (typically Helius)
 * @param keypair - The fee claimer's keypair (derived from SIGNER_PRIVATE_KEY)
 * @returns A function that takes a ClaimTransaction and returns the on-chain tx signature
 */
export function createSignAndSendClaim(
  connection: Connection,
  keypair: Keypair,
): (claimTx: ClaimTransaction) => Promise<string> {
  return async function signAndSendClaim(claimTx: ClaimTransaction): Promise<string> {
    logger.debug(
      { blockhash: claimTx.blockhash.blockhash, lastValidBlockHeight: claimTx.blockhash.lastValidBlockHeight },
      'Deserializing claim transaction',
    );

    // Decode base58-encoded serialized VersionedTransaction
    const txBytes = bs58.decode(claimTx.tx);
    const transaction = VersionedTransaction.deserialize(txBytes);

    // Partially sign with the claimer's keypair
    transaction.sign([keypair]);

    logger.debug('Transaction signed, sending to network');

    // Send the signed transaction
    const signature = await connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: false,
      maxRetries: 3,
    });

    logger.info({ signature }, 'Transaction sent, confirming');

    // Confirm the transaction
    const { blockhash, lastValidBlockHeight } = claimTx.blockhash;
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
        'Claim transaction confirmation failed',
      );
      throw new Error(
        `Claim transaction ${signature} failed confirmation (blockhash: ${blockhash}, lastValidBlockHeight: ${lastValidBlockHeight}): ${(confirmError as Error).message}`,
      );
    }

    logger.info({ signature }, 'Claim transaction confirmed');
    return signature;
  };
}
