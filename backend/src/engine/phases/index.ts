import type { RunState, PhaseResult, CreditRun } from '../../types/index.js';
import type { PhaseHandler } from '../StateMachine.js';
import { createClaimPhase, defaultClaimPhase, type ClaimPhaseDeps } from './claim.js';
import { swapPhase } from './swap.js';
import { createBridgePhase, type BridgePhaseDeps } from './bridge.js';
import { createFundPhase, type FundPhaseDeps } from './fund.js';
import { createAllocatePhase, type AllocatePhaseDeps, allocatePhase as defaultAllocatePhase } from './allocate.js';
import { createProvisionPhase, type ProvisionPhaseDeps, provisionPhase as defaultProvisionPhase } from './provision.js';

export type { ClaimPhaseDeps, BridgePhaseDeps, FundPhaseDeps, AllocatePhaseDeps, ProvisionPhaseDeps };

/**
 * Create phase handlers with injected dependencies.
 * Bridge, fund, allocate, and provision phases require service dependencies;
 * claim and swap are stub implementations.
 */
export function createPhaseHandlerMap(deps?: {
  claim?: ClaimPhaseDeps;
  bridge?: BridgePhaseDeps;
  fund?: FundPhaseDeps;
  allocate?: AllocatePhaseDeps;
  provision?: ProvisionPhaseDeps;
}): Map<RunState, PhaseHandler> {
  const claimDeps = deps?.claim;
  const bridgeDeps = deps?.bridge;
  const fundDeps = deps?.fund;
  const allocateDeps = deps?.allocate;
  const provisionDeps = deps?.provision;

  const claimHandler = claimDeps
    ? createClaimPhase(claimDeps)
    : defaultClaimPhase;

  const bridgeHandler = bridgeDeps
    ? createBridgePhase(bridgeDeps)
    : defaultBridgePhase;

  const fundHandler = fundDeps
    ? createFundPhase(fundDeps)
    : defaultFundPhase;

  const allocateHandler = allocateDeps
    ? createAllocatePhase(allocateDeps)
    : defaultAllocatePhase;

  const provisionHandler = provisionDeps
    ? createProvisionPhase(provisionDeps)
    : defaultProvisionPhase;

  return new Map<RunState, (run: CreditRun) => Promise<PhaseResult>>([
    ['CLAIMING', claimHandler],
    ['SWAPPING', swapPhase],
    ['BRIDGING', bridgeHandler],
    ['FUNDING', fundHandler],
    ['ALLOCATING', allocateHandler],
    ['PROVISIONING', provisionHandler],
  ]);
}

/**
 * Default bridge phase: returns a stub result when no deps are injected.
 * Used for testing the state machine without real services.
 */
async function defaultBridgePhase(run: CreditRun): Promise<PhaseResult> {
  const { pino } = await import('pino');
  const logger = pino({ name: 'phase:bridge:default' });
  logger.info(
    { runId: run.runId, swappedUsdc: run.swappedUsdc },
    'BRIDGING phase — no bridge deps injected, returning stub',
  );
  return {
    success: true,
    data: {
      bridgedUsdc: run.swappedUsdc ?? 0,
      bridgeTxHash: 'default-stub-tx',
      skipped: !run.swappedUsdc || run.swappedUsdc <= 0,
    },
  };
}

/**
 * Default fund phase: returns a stub result when no deps are injected.
 * Used for testing the state machine without real services.
 */
async function defaultFundPhase(run: CreditRun): Promise<PhaseResult> {
  const { pino } = await import('pino');
  const logger = pino({ name: 'phase:fund:default' });
  logger.info(
    { runId: run.runId, bridgedUsdc: run.bridgedUsdc },
    'FUNDING phase — no fund deps injected, returning stub',
  );
  return {
    success: true,
    data: {
      fundedUsdc: run.bridgedUsdc ?? 0,
      fundingTxHash: 'default-stub-charge',
      skipped: !run.bridgedUsdc || run.bridgedUsdc <= 0,
    },
  };
}

export { defaultClaimPhase } from './claim.js';
export { swapPhase } from './swap.js';
export { createBridgePhase } from './bridge.js';
export { createFundPhase } from './fund.js';
export { createAllocatePhase, allocatePhase } from './allocate.js';
export { createProvisionPhase, provisionPhase } from './provision.js';
