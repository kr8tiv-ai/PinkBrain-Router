// ─── Domain Enum Types ────────────────────────────────────────

export type FeeSourceType = 'CLAIMABLE_POSITIONS' | 'PARTNER_FEES';
export type DistributionMode =
  | 'OWNER_ONLY'
  | 'TOP_N_HOLDERS'
  | 'EQUAL_SPLIT'
  | 'WEIGHTED_BY_HOLDINGS'
  | 'CUSTOM_LIST';
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

// ─── Strategy ─────────────────────────────────────────────────

export interface SwapConfig {
  slippageBps: number;
  maxPriceImpactBps: number;
}

export interface KeyConfig {
  defaultLimitUsd: number;
  limitReset: KeyLimitReset;
  expiryDays: number;
}

export interface Strategy {
  strategyId: string;
  ownerWallet: string;
  source: FeeSourceType;
  distributionToken: string;
  swapConfig: SwapConfig;
  distribution: DistributionMode;
  distributionTopN: number;
  keyConfig: KeyConfig;
  creditPoolReservePct: number;
  exclusionList: string[];
  schedule: string;
  minClaimThreshold: number;
  status: StrategyStatus;
  lastRunId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateStrategyPayload {
  ownerWallet: string;
  source?: FeeSourceType;
  distributionToken?: string;
  distribution?: DistributionMode;
  distributionTopN?: number;
  keyConfig?: Partial<KeyConfig>;
  creditPoolReservePct?: number;
  exclusionList?: string[];
  schedule?: string;
  minClaimThreshold?: number;
}

// ─── CreditRun ────────────────────────────────────────────────

export interface RunError {
  code: string;
  detail: string;
  failedState: RunState;
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
  bridgedUsdc: number | null;
  bridgeTxHash: string | null;
  fundedUsdc: number | null;
  fundingTxHash: string | null;
  allocatedUsd: number | null;
  keysProvisioned: number | null;
  keysUpdated: number | null;
  error: RunError | null;
}

// ─── UserKey (from GET /keys/strategy/:strategyId) ────────────

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

// ─── OpenRouter Key (from GET /keys, GET /keys/:hash) ────────
// These come in snake_case and are normalized to camelCase by the client.

export interface OpenRouterKey {
  hash: string;
  name: string;
  disabled: boolean;
  limit: number;
  limitRemaining: number;
  usage: number;
  usageDaily: number;
  usageWeekly: number;
  usageMonthly: number;
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
}

// ─── Credit Pool ─────────────────────────────────────────────

export interface CreditPoolStatus {
  totalBalanceUsd: number;
  totalAllocatedUsd: number;
  availableUsd: number;
  reservePct: number;
  reservedUsd: number;
  lastUpdated: string;
}

// ─── Usage Snapshot ──────────────────────────────────────────
// These come in snake_case and are normalized to camelCase.

export interface UsageSnapshot {
  id: string;
  keyHash: string;
  strategyId: string;
  usage: number;
  usageDaily: number;
  usageWeekly: number;
  usageMonthly: number;
  limitRemaining: number | null;
  limit: number | null;
  polledAt: string;
}

// ─── Health ───────────────────────────────────────────────────

export interface HealthResponse {
  status: string;
  timestamp: string;
  uptime: number;
  dependencies: {
    openrouter: boolean;
    database: boolean;
  };
  responseTimeMs: number;
}

// ─── API Error shape ─────────────────────────────────────────

export interface ApiError {
  error: string;
  statusCode: number;
}
