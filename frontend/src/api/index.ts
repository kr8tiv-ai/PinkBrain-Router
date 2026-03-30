export { useApi, ApiClientError } from './client';
export type { ApiClient } from './client';

export {
  useStrategies,
  useStrategy,
  useCreateStrategy,
  useUpdateStrategy,
  useDeleteStrategy,
  useEnableStrategy,
  useDisableStrategy,
} from './strategies';

export {
  useRun,
  useRuns,
  useTriggerRun,
  useResumeRun,
} from './runs';

export {
  useKeys,
  useKey,
  useStrategyKeys,
} from './keys';

export { useCreditPool, useCreditPoolHistory } from './credit-pool';
export type { PoolHistoryEntry } from './credit-pool';

export {
  useUsageKey,
  useUsageStrategy,
} from './usage';

export { useHealth } from './health';
export { useStats } from './stats';

export type {
  FeeSourceType,
  DistributionMode,
  StrategyStatus,
  KeyLimitReset,
  RunState,
  SwapConfig,
  KeyConfig,
  Strategy,
  CreateStrategyPayload,
  UpdateStrategyPayload,
  RunError,
  CreditRun,
  UserKey,
  OpenRouterKey,
  CreditPoolStatus,
  UsageSnapshot,
  HealthResponse,
  Stats,
  ApiError,
} from './types';
