import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import pino from 'pino';
import type { SwapTransaction } from '../types/index.js';

const logger = pino({ name: 'signAndSendSwap' });

/**
 * Well-known Jito tip accounts.
 * One is randomly selected per bundle to distribute load.
 * @see https://jito-labs.gitbook.io/mev/searcher-resources/tip-accounts
 */
const JITO_TIP_ACCOUNTS = [
  '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5',
  'HFqU5x63VTqvQss8hp11i4bVqkfRtQ7NmXwkiKAn37Yf',
  'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY',
  'ADaUMid9yfUytqMBgopwjb2DTLSLEwwy4PgCCWXNNaJb',
  'DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh',
  'ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt',
  'DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL',
  '3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT',
];

/** Jito block engine endpoint for bundle submission */
const JITO_BUNDLE_URL =
  'https://mainnet.block-engine.jito.wtf/api/v1/bundles';

export interface JitoBundleConfig {
  /** Whether to send via Jito bundles for MEV protection */
  enabled: boolean;
  /** Tip amount in lamports to send to a Jito tip account */
  tipLamports: number;
}

/**
 * Create a swap transaction signer bound to a specific Connection and Keypair.
 *
 * The Bags.fm / Jupiter API returns base64-encoded serialized VersionedTransactions.
 * This function decodes, partially signs, sends, and confirms them on-chain.
 *
 * When `jitoConfig.enabled` is true, transactions are submitted as Jito bundles
 * with a tip for MEV protection, preventing sandwich attacks on swaps.
 *
 * @param connection - Solana RPC connection (typically Helius)
 * @param keypair - The swap signer's keypair (derived from SIGNER_PRIVATE_KEY)
 * @param jitoConfig - Optional Jito bundle configuration
 * @returns A function that takes a SwapTransaction and returns the on-chain tx signature
 */
export function createSignAndSendSwap(
  connection: Connection,
  keypair: Keypair,
  jitoConfig?: JitoBundleConfig,
): (swapTx: SwapTransaction) => Promise<string> {
  return async function signAndSendSwap(
    swapTx: SwapTransaction,
  ): Promise<string> {
    logger.debug(
      {
        lastValidBlockHeight: swapTx.lastValidBlockHeight,
        computeUnitLimit: swapTx.computeUnitLimit,
        jito: jitoConfig?.enabled ?? false,
      },
      'Deserializing swap transaction',
    );

    // Decode base64-encoded serialized VersionedTransaction (Jupiter standard)
    const txBytes = Buffer.from(swapTx.swapTransaction, 'base64');
    const transaction = VersionedTransaction.deserialize(txBytes);

    // Partially sign with the signer's keypair
    transaction.sign([keypair]);

    logger.debug('Transaction signed');

    // ── Jito bundle path ──────────────────────────────────────
    if (jitoConfig?.enabled && jitoConfig.tipLamports > 0) {
      return sendViaJitoBundle(connection, keypair, transaction, jitoConfig, swapTx);
    }

    // ── Standard RPC path ─────────────────────────────────────
    return sendViaRpc(connection, transaction, swapTx);
  };
}

/**
 * Send a signed transaction via Jito block engine as a 2-tx bundle:
 *  1. The swap transaction
 *  2. A tip transfer to a random Jito tip account
 */
async function sendViaJitoBundle(
  connection: Connection,
  keypair: Keypair,
  swapTx: VersionedTransaction,
  jitoConfig: JitoBundleConfig,
  meta: SwapTransaction,
): Promise<string> {
  logger.info(
    { tipLamports: jitoConfig.tipLamports },
    'Sending swap via Jito bundle for MEV protection',
  );

  // Build tip transaction
  const tipAccount =
    JITO_TIP_ACCOUNTS[Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length)];

  const { blockhash } = await connection.getLatestBlockhash('confirmed');

  const tipInstruction = SystemProgram.transfer({
    fromPubkey: keypair.publicKey,
    toPubkey: new PublicKey(tipAccount),
    lamports: jitoConfig.tipLamports,
  });

  const tipMessage = new TransactionMessage({
    payerKey: keypair.publicKey,
    recentBlockhash: blockhash,
    instructions: [tipInstruction],
  }).compileToV0Message();

  const tipTx = new VersionedTransaction(tipMessage);
  tipTx.sign([keypair]);

  // Encode both transactions as base58 for Jito API
  const bundle = [
    Buffer.from(swapTx.serialize()).toString('base64'),
    Buffer.from(tipTx.serialize()).toString('base64'),
  ];

  // Submit bundle to Jito block engine
  const response = await fetch(JITO_BUNDLE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'sendBundle',
      params: [bundle],
    }),
  });

  const result = (await response.json()) as {
    result?: string;
    error?: { message: string };
  };

  if (result.error) {
    throw new Error(`Jito bundle submission failed: ${result.error.message}`);
  }

  const bundleId = result.result;
  logger.info({ bundleId, tipAccount }, 'Jito bundle submitted');

  // Poll for bundle landing (max 30s)
  const signature = await pollJitoBundleStatus(bundleId!, meta);

  logger.info({ signature, bundleId }, 'Jito bundle landed');
  return signature;
}

/**
 * Poll the Jito block engine for bundle landing status.
 * Returns the swap transaction signature once the bundle lands.
 */
async function pollJitoBundleStatus(
  bundleId: string,
  meta: SwapTransaction,
  maxAttempts = 30,
  intervalMs = 1000,
): Promise<string> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const response = await fetch(JITO_BUNDLE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getBundleStatuses',
        params: [[bundleId]],
      }),
    });

    const result = (await response.json()) as {
      result?: {
        value: Array<{
          bundle_id: string;
          transactions: string[];
          slot: number;
          confirmation_status: string;
          err?: { Ok?: null; InstructionError?: unknown };
        }>;
      };
    };

    const status = result.result?.value?.[0];

    if (status) {
      if (
        status.confirmation_status === 'confirmed' ||
        status.confirmation_status === 'finalized'
      ) {
        // First transaction in the bundle is the swap
        return status.transactions[0];
      }
      if (status.err && !('Ok' in status.err)) {
        throw new Error(
          `Jito bundle ${bundleId} failed: ${JSON.stringify(status.err)}`,
        );
      }
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(
    `Jito bundle ${bundleId} did not land within ${maxAttempts * intervalMs}ms (lastValidBlockHeight: ${meta.lastValidBlockHeight})`,
  );
}

/**
 * Send a signed transaction via standard Solana RPC and confirm.
 */
async function sendViaRpc(
  connection: Connection,
  transaction: VersionedTransaction,
  meta: SwapTransaction,
): Promise<string> {
  logger.debug('Sending transaction via standard RPC');

  const signature = await connection.sendRawTransaction(
    transaction.serialize(),
    {
      skipPreflight: false,
      maxRetries: 3,
    },
  );

  logger.info({ signature }, 'Transaction sent, confirming');

  const blockhash = transaction.message.recentBlockhash;
  const { lastValidBlockHeight } = meta;

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
}
