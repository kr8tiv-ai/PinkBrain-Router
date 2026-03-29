import type { RunState, PhaseResult, CreditRun } from '../../types/index.js';
import type { PhaseHandler } from '../StateMachine.js';
import { claimPhase } from './claim.js';
import { swapPhase } from './swap.js';
import { createBridgePhase, type BridgePhaseDeps } from './bridge.js';
import { createFundPhase, type FundPhaseDeps } from './fund.js';
import { allocatePhase } from './allocate.js';
import { provisionPhase } from './provision.js';

export type { BridgePhaseDeps, FundPhaseDeps };

/**
 * Create phase handlers with injected dependencies.
 * Bridge and fund phases require service dependencies;
 * claim, swap, allocate, and provision are stub implementations.
 */
export function createPhaseHandlerMap(deps?: {
  bridge?: BridgePhaseDeps;
  fund?: FundPhaseDeps;
}): Map<RunState, PhaseHandler> {
  const bridgeDeps = deps?.bridge;
  const fundDeps = deps?.fund;

  const bridgeHandler = bridgeDeps
    ? createBridgePhase(bridgeDeps)
    : defaultBridgePhase;

  const fundHandler = fundDeps
    ? createFundPhase(fundDeps)
    : defaultFundPhase;

  return new Map<RunState, (run: CreditRun) => Promise<PhaseResult>>([
    ['CLAIMING', claimPhase],
    ['SWAPPING', swapPhase],
    ['BRIDGING', bridgeHandler],
    ['FUNDING', fundHandler],
    ['ALLOCATING', allocatePhase],
    ['PROVISIONING', provisionPhase],
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

export { claimPhase } from './claim.js';
export { swapPhase } from './swap.js';
export { createBridgePhase } from './bridge.js';
export { createFundPhase } from './fund.js';
export { allocatePhase } from './allocate.js';
export { provisionPhase } from './provision.js';
