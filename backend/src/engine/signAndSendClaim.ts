import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import bs58 from 'bs58';
import pino from 'pino';
import type { ClaimTransaction } from '../types/index.js';
import type { JitoBundleConfig } from './signAndSendSwap.js';

const logger = pino({ name: 'signAndSendClaim' });

/**
 * Well-known Jito tip accounts (same as signAndSendSwap).
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

const JITO_BUNDLE_URL =
  'https://mainnet.block-engine.jito.wtf/api/v1/bundles';

/**
 * Create a claim transaction signer bound to a specific Connection and Keypair.
 *
 * The Bags.fm API returns base58-encoded serialized VersionedTransactions.
 * This function decodes, partially signs, sends, and confirms them on-chain.
 *
 * When `jitoConfig.enabled` is true, transactions are submitted as Jito bundles
 * with a tip for MEV protection.
 *
 * @param connection - Solana RPC connection (typically Helius)
 * @param keypair - The fee claimer's keypair (derived from SIGNER_PRIVATE_KEY)
 * @param jitoConfig - Optional Jito bundle configuration
 * @returns A function that takes a ClaimTransaction and returns the on-chain tx signature
 */
export function createSignAndSendClaim(
  connection: Connection,
  keypair: Keypair,
  jitoConfig?: JitoBundleConfig,
): (claimTx: ClaimTransaction) => Promise<string> {
  return async function signAndSendClaim(
    claimTx: ClaimTransaction,
  ): Promise<string> {
    logger.debug(
      {
        blockhash: claimTx.blockhash.blockhash,
        lastValidBlockHeight: claimTx.blockhash.lastValidBlockHeight,
        jito: jitoConfig?.enabled ?? false,
      },
      'Deserializing claim transaction',
    );

    // Decode base58-encoded serialized VersionedTransaction
    const txBytes = bs58.decode(claimTx.tx);
    const transaction = VersionedTransaction.deserialize(txBytes);

    // Partially sign with the claimer's keypair
    transaction.sign([keypair]);

    logger.debug('Transaction signed');

    // ── Jito bundle path ──────────────────────────────────────
    if (jitoConfig?.enabled && jitoConfig.tipLamports > 0) {
      return sendClaimViaJito(connection, keypair, transaction, jitoConfig, claimTx);
    }

    // ── Standard RPC path ─────────────────────────────────────
    return sendClaimViaRpc(connection, transaction, claimTx);
  };
}

/**
 * Send claim transaction via Jito bundle with tip.
 */
async function sendClaimViaJito(
  connection: Connection,
  keypair: Keypair,
  claimTx: VersionedTransaction,
  jitoConfig: JitoBundleConfig,
  meta: ClaimTransaction,
): Promise<string> {
  logger.info(
    { tipLamports: jitoConfig.tipLamports },
    'Sending claim via Jito bundle for MEV protection',
  );

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

  const bundle = [
    Buffer.from(claimTx.serialize()).toString('base64'),
    Buffer.from(tipTx.serialize()).toString('base64'),
  ];

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
  logger.info({ bundleId, tipAccount }, 'Jito claim bundle submitted');

  // Poll for landing
  const signature = await pollBundleStatus(bundleId!, meta.blockhash.lastValidBlockHeight);
  logger.info({ signature, bundleId }, 'Jito claim bundle landed');
  return signature;
}

/**
 * Poll Jito for bundle status until landed or timeout.
 */
async function pollBundleStatus(
  bundleId: string,
  lastValidBlockHeight: number,
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
        return status.transactions[0];
      }
      if (status.err && !('Ok' in status.err)) {
        throw new Error(
          `Jito claim bundle ${bundleId} failed: ${JSON.stringify(status.err)}`,
        );
      }
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(
    `Jito claim bundle ${bundleId} did not land within ${maxAttempts * intervalMs}ms (lastValidBlockHeight: ${lastValidBlockHeight})`,
  );
}

/**
 * Send claim transaction via standard Solana RPC.
 */
async function sendClaimViaRpc(
  connection: Connection,
  transaction: VersionedTransaction,
  meta: ClaimTransaction,
): Promise<string> {
  logger.debug('Sending claim via standard RPC');

  const signature = await connection.sendRawTransaction(
    transaction.serialize(),
    {
      skipPreflight: false,
      maxRetries: 3,
    },
  );

  logger.info({ signature }, 'Transaction sent, confirming');

  const { blockhash, lastValidBlockHeight } = meta.blockhash;
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
}
