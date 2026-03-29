import { z } from 'zod';
import type {
  ClaimTransaction,
  ClaimablePosition,
  TradeQuote,
  SwapTransaction,
} from '../types/index.js';

const numberish = z.union([z.number(), z.string()]).transform((value, ctx) => {
  const parsed = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(parsed)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Expected a finite number',
    });
    return z.NEVER;
  }
  return parsed;
});

const stringish = z.union([z.string(), z.number()]).transform((value) => String(value));

const DammPositionInfoSchema = z.object({
  position: z.string(),
  pool: z.string(),
  positionNftAccount: z.string(),
  tokenAMint: z.string(),
  tokenBMint: z.string(),
  tokenAVault: z.string(),
  tokenBVault: z.string(),
}).partial();

export const ClaimablePositionSchema = z.object({
  isCustomFeeVault: z.boolean().default(false),
  baseMint: z.string(),
  isMigrated: z.boolean().default(false),
  totalClaimableLamportsUserShare: numberish.default(0),
  programId: z.string().default(''),
  quoteMint: z.string().default(''),
  virtualPool: z.string().default(''),
  virtualPoolAddress: z.string().default(''),
  virtualPoolClaimableAmount: numberish.default(0),
  virtualPoolClaimableLamportsUserShare: numberish.default(0),
  dammPoolClaimableAmount: numberish.default(0),
  dammPoolClaimableLamportsUserShare: numberish.default(0),
  dammPoolAddress: z.string().default(''),
  dammPositionInfo: DammPositionInfoSchema.optional(),
  claimableDisplayAmount: numberish.default(0),
  user: z.string().default(''),
  claimerIndex: numberish.default(0),
  userBps: numberish.default(0),
  customFeeVault: z.string().default(''),
  customFeeVaultClaimerA: z.string().default(''),
  customFeeVaultClaimerB: z.string().default(''),
  customFeeVaultClaimerSide: z.enum(['A', 'B']).default('A'),
}).strip();

export const ClaimablePositionsSchema = z.array(ClaimablePositionSchema);

export const ClaimTransactionSchema = z.object({
  tx: z.string(),
  blockhash: z.object({
    blockhash: z.string(),
    lastValidBlockHeight: numberish,
  }),
}).strip();

export const ClaimTransactionsSchema = z.array(ClaimTransactionSchema);

export const TradeQuoteSchema = z.object({
  requestId: z.string(),
  contextSlot: numberish,
  inAmount: stringish,
  inputMint: z.string(),
  outAmount: stringish,
  outputMint: z.string(),
  minOutAmount: stringish,
  otherAmountThreshold: stringish,
  priceImpactPct: stringish,
  slippageBps: numberish,
  routePlan: z.array(z.object({
    venue: z.string(),
    inAmount: stringish,
    outAmount: stringish,
    inputMint: z.string(),
    outputMint: z.string(),
    inputMintDecimals: numberish,
    outputMintDecimals: numberish,
    marketKey: z.string(),
    data: z.string(),
  }).passthrough()),
  platformFee: z.object({
    amount: stringish,
    feeBps: numberish,
    feeAccount: z.string(),
    segmenterFeeAmount: stringish,
    segmenterFeePct: numberish,
  }).passthrough(),
  outTransferFee: stringish,
  simulatedComputeUnits: numberish,
}).strip();

export const SwapTransactionSchema = z.object({
  swapTransaction: z.string(),
  computeUnitLimit: numberish,
  lastValidBlockHeight: numberish,
  prioritizationFeeLamports: numberish,
}).strip();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function extractSchemaError(label: string, error: z.ZodError): Error {
  const issue = error.issues[0];
  return new Error(
    `Invalid Bags response for ${label}: ${issue?.path.join('.') || 'root'} ${issue?.message || 'schema validation failed'}`.trim(),
  );
}

export function unwrapBagsPayload(payload: unknown): unknown {
  if (!isRecord(payload)) {
    return payload;
  }

  if (payload.success === true && 'response' in payload) {
    return payload.response;
  }

  if (payload.success === true && 'data' in payload) {
    return payload.data;
  }

  return payload;
}

export function parseBagsPayload<T>(
  schema: z.ZodType<T>,
  payload: unknown,
  label: string,
): T {
  const normalized = unwrapBagsPayload(payload);
  const result = schema.safeParse(normalized);
  if (!result.success) {
    throw extractSchemaError(label, result.error);
  }
  return result.data;
}

export function parseClaimablePositions(payload: unknown): ClaimablePosition[] {
  return parseBagsPayload(
    ClaimablePositionsSchema as z.ZodType<ClaimablePosition[]>,
    payload,
    'claimable positions',
  );
}

export function parseClaimTransactions(payload: unknown): ClaimTransaction[] {
  return parseBagsPayload(
    ClaimTransactionsSchema as z.ZodType<ClaimTransaction[]>,
    payload,
    'claim transactions',
  );
}

export function parseTradeQuote(payload: unknown): TradeQuote {
  return parseBagsPayload(
    TradeQuoteSchema as z.ZodType<TradeQuote>,
    payload,
    'trade quote',
  );
}

export function parseSwapTransaction(payload: unknown): SwapTransaction {
  return parseBagsPayload(
    SwapTransactionSchema as z.ZodType<SwapTransaction>,
    payload,
    'swap transaction',
  );
}
