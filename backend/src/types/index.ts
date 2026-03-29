import BN from 'bn.js';

// ─── Bags API ───────────────────────────────────────────────────

export type BagsRequestPriority = 'high' | 'low';

export interface BagsRequestOptions {
  priority?: BagsRequestPriority;
}

export interface BagsApiConfig {
  apiKey: string;
  baseUrl: string;
  connection?: unknown; // Connection from @solana/web3.js
}

export interface BagsRateLimitInfo {
  remaining: number;
  resetAt: number;
}

export interface ClaimablePosition {
  isCustomFeeVault: boolean;
  baseMint: string;
  isMigrated: boolean;
  totalClaimableLamportsUserShare: number;
  programId: string;
  quoteMint: string;
  virtualPool: string;
  virtualPoolAddress: string;
  virtualPoolClaimableAmount: number;
  virtualPoolClaimableLamportsUserShare: number;
  dammPoolClaimableAmount: number;
  dammPoolClaimableLamportsUserShare: number;
  dammPoolAddress: string;
  dammPositionInfo?: {
    position: string;
    pool: string;
    positionNftAccount: string;
    tokenAMint: string;
    tokenBMint: string;
    tokenAVault: string;
    tokenBVault: string;
  };
  claimableDisplayAmount: number;
  user: string;
  claimerIndex: number;
  userBps: number;
  customFeeVault: string;
  customFeeVaultClaimerA: string;
  customFeeVaultClaimerB: string;
  customFeeVaultClaimerSide: 'A' | 'B';
}

export interface TradeQuote {
  requestId: string;
  contextSlot: number;
  inAmount: string;
  inputMint: string;
  outAmount: string;
  outputMint: string;
  minOutAmount: string;
  otherAmountThreshold: string;
  priceImpactPct: string;
  slippageBps: number;
  routePlan: Array<{
    venue: string;
    inAmount: string;
    outAmount: string;
    inputMint: string;
    outputMint: string;
    inputMintDecimals: number;
    outputMintDecimals: number;
    marketKey: string;
    data: string;
  }>;
  platformFee: {
    amount: string;
    feeBps: number;
    feeAccount: string;
    segmenterFeeAmount: string;
    segmenterFeePct: number;
  };
  outTransferFee: string;
  simulatedComputeUnits: number;
}

export interface SwapTransaction {
  swapTransaction: string;
  computeUnitLimit: number;
  lastValidBlockHeight: number;
  prioritizationFeeLamports: number;
}

export interface ClaimTransaction {
  tx: string;
  blockhash: {
    blockhash: string;
    lastValidBlockHeight: number;
  };
}

// ─── Helius ────────────────────────────────────────────────────

export interface HeliusConfig {
  apiKey: string;
  rpcUrl: string;
}

export interface PriorityFeeEstimate {
  priorityFeeEstimate: number;
  priorityFeeLevels?: {
    min: number;
    low: number;
    medium: number;
    high: number;
    veryHigh: number;
    unsafeMax: number;
  };
}

export interface TokenAccount {
  address: string;
  mint: string;
  owner: string;
  amount: string;
  decimals: number;
}

export interface TokenHolder {
  address: string;
  owner: string;
  balance: BN;
}

// ─── Core Domain Types ─────────────────────────────────────────

export type FeeSourceType = 'CLAIMABLE_POSITIONS' | 'PARTNER_FEES';
export type DistributionMode = 'OWNER_ONLY' | 'TOP_N_HOLDERS' | 'EQUAL_SPLIT' | 'WEIGHTED_BY_HOLDINGS' | 'CUSTOM_LIST';
export type StrategyStatus = 'ACTIVE' | 'PAUSED' | 'ERROR';
export type KeyLimitReset = 'daily' | 'weekly' | 'monthly' | null;

export type RunState =
  | 'PENDING'
  | 'CLAIMING'
  | 'SWAPPING'
  | 'BRIDGING'
  | 'FUNDING'
  | 'ALLOCATING'
  | 'PROVISIONING'
  | 'COMPLETE'
  | 'FAILED';

export interface Strategy {
  strategyId: string;
  ownerWallet: string;
  source: FeeSourceType;
  distributionToken: string;
  swapConfig: {
    slippageBps: number;
    maxPriceImpactBps: number;
  };
  distribution: DistributionMode;
  distributionTopN: number;
  keyConfig: {
    defaultLimitUsd: number;
    limitReset: KeyLimitReset;
    expiryDays: number;
  };
  creditPoolReservePct: number;
  exclusionList: string[];
  schedule: string;
  minClaimThreshold: number;
  status: StrategyStatus;
  lastRunId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreditRun {
  runId: string;
  strategyId: string;
  state: RunState;
  startedAt: string;
  finishedAt: string | null;
  claimedSol: number | null;
  claimedTxSignature: string | null;
  swappedUsdc: number | null;
  swapTxSignature: string | null;
  swapQuoteSnapshot: TradeQuote | null;
  bridgedUsdc: number | null;
  bridgeTxHash: string | null;
  fundedUsdc: number | null;
  fundingTxHash: string | null;
  allocatedUsd: number | null;
  keysProvisioned: number | null;
  keysUpdated: number | null;
  error: {
    code: string;
    detail: string;
    failedState: RunState;
  } | null;
}

export interface UserKey {
  keyId: string;
  strategyId: string;
  holderWallet: string;
  openrouterKeyHash: string;
  spendingLimitUsd: number;
  currentUsageUsd: number;
  status: 'ACTIVE' | 'EXHAUSTED' | 'EXPIRED' | 'REVOKED';
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
}

export interface AllocationSnapshot {
  snapshotId: string;
  runId: string;
  holderWallet: string;
  tokenBalance: string;
  allocationWeight: number;
  allocatedUsd: number;
  keyHash: string | null;
  createdAt: string;
}

export interface AuditLogEntry {
  logId: string;
  runId: string;
  phase: RunState;
  action: string;
  details: Record<string, unknown>;
  txSignature?: string;
  timestamp: string;
}

export interface CreditPoolStatus {
  totalBalanceUsd: number;
  totalAllocatedUsd: number;
  availableUsd: number;
  reservePct: number;
  reservedUsd: number;
  lastUpdated: string;
}

export interface PhaseResult {
  success: boolean;
  data?: Record<string, unknown>;
  error?: {
    code: string;
    message: string;
  };
}

// ─── BagsAdapter interface ─────────────────────────────────────

export interface BagsAdapter {
  getClaimablePositions(
    wallet: string,
    options?: BagsRequestOptions,
  ): Promise<ClaimablePosition[]>;
  getClaimTransactions(
    feeClaimer: string,
    position: ClaimablePosition,
    options?: BagsRequestOptions,
  ): Promise<ClaimTransaction[]>;
  getTradeQuote(
    params: {
      inputMint: string;
      outputMint: string;
      amount: number;
      slippageBps?: number;
    },
    options?: BagsRequestOptions,
  ): Promise<TradeQuote>;
  createSwapTransaction(
    quoteResponse: TradeQuote,
    userPublicKey: string,
    options?: BagsRequestOptions,
  ): Promise<SwapTransaction>;
  prepareSwap(
    params: {
      inputMint: string;
      outputMint: string;
      amount: number;
      userPublicKey: string;
      slippageBps?: number;
      maxPriceImpactBps?: number;
    },
    options?: BagsRequestOptions,
  ): Promise<{ quote: TradeQuote; swapTx: SwapTransaction }>;
  getTotalClaimableSol(
    wallet: string,
    options?: BagsRequestOptions,
  ): Promise<{ totalLamports: bigint; positions: ClaimablePosition[] }>;
  getRateLimitStatus(): BagsRateLimitInfo;
}
