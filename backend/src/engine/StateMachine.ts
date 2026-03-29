import pino from 'pino';
import type { RunState, PhaseResult, CreditRun } from '../types/index.js';
import { AuditService } from '../services/AuditService.js';
import { RunService } from '../services/RunService.js';
import { ExecutionPolicy } from './ExecutionPolicy.js';

const logger = pino({ name: 'StateMachine' });

// Valid transitions: fromState -> [toState, ...]
const VALID_TRANSITIONS: Record<string, RunState[]> = {
  PENDING: ['CLAIMING', 'FAILED'],
  CLAIMING: ['SWAPPING', 'FAILED'],
  SWAPPING: ['BRIDGING', 'FAILED'],
  BRIDGING: ['FUNDING', 'FAILED'],
  FUNDING: ['ALLOCATING', 'FAILED'],
  ALLOCATING: ['PROVISIONING', 'FAILED'],
  PROVISIONING: ['COMPLETE', 'FAILED'],
  COMPLETE: [],
  FAILED: ['CLAIMING', 'SWAPPING', 'BRIDGING', 'FUNDING', 'ALLOCATING', 'PROVISIONING'],
};

// Phase ordering for resume-from-checkpoint logic
const PHASE_ORDER: RunState[] = [
  'PENDING',
  'CLAIMING',
  'SWAPPING',
  'BRIDGING',
  'FUNDING',
  'ALLOCATING',
  'PROVISIONING',
  'COMPLETE',
];

export type PhaseHandler = (run: CreditRun) => Promise<PhaseResult>;

export interface StateMachineDeps {
  auditService: AuditService;
  runService: RunService;
  executionPolicy: ExecutionPolicy;
  phaseHandlers: Map<RunState, PhaseHandler>;
}

export class StateMachine {
  private readonly audit: AuditService;
  private readonly runs: RunService;
  private readonly policy: ExecutionPolicy;
  private readonly handlers: Map<RunState, PhaseHandler>;

  constructor(deps: StateMachineDeps) {
    this.audit = deps.auditService;
    this.runs = deps.runService;
    this.policy = deps.executionPolicy;
    this.handlers = deps.phaseHandlers;
  }

  async transition(
    run: CreditRun,
    toPhase: RunState,
    result?: PhaseResult,
  ): Promise<CreditRun> {
    this.validateTransition(run.state, toPhase);

    const action = result?.success
      ? `transition:${run.state}->${toPhase}`
      : `fail:${run.state}->${toPhase}`;

    const details: Record<string, unknown> = {
      fromPhase: run.state,
      toPhase,
      runId: run.runId,
      ...(result?.data ?? {}),
    };

    if (result?.error) {
      details.error = result.error;
    }

    this.audit.logTransition(run.runId, run.state, action, details);

    const updatedRun = this.runs.updateState(run.runId, toPhase, result?.data ?? {});

    if (!updatedRun) {
      throw new Error(`Run ${run.runId} not found after state update`);
    }

    logger.info(
      { runId: run.runId, from: run.state, to: toPhase, success: result?.success },
      'State transition complete',
    );

    return updatedRun;
  }

  async execute(run: CreditRun): Promise<CreditRun> {
    const policyCheck = this.policy.canStartRun();
    if (!policyCheck.allowed) {
      logger.warn({ runId: run.runId, reason: policyCheck.reason }, 'Execution blocked by policy');
      return this.failRun(run, 'POLICY_BLOCKED', policyCheck.reason!);
    }

    let currentRun = run;

    // Start: PENDING -> CLAIMING
    if (currentRun.state === 'PENDING') {
      currentRun = await this.transition(currentRun, 'CLAIMING');
    }

    // Execute each phase in sequence
    const phases: RunState[] = [
      'CLAIMING',
      'SWAPPING',
      'BRIDGING',
      'FUNDING',
      'ALLOCATING',
      'PROVISIONING',
    ];

    const nextPhaseMap: Record<string, RunState> = {
      CLAIMING: 'SWAPPING',
      SWAPPING: 'BRIDGING',
      BRIDGING: 'FUNDING',
      FUNDING: 'ALLOCATING',
      ALLOCATING: 'PROVISIONING',
      PROVISIONING: 'COMPLETE',
    };

    for (const phase of phases) {
      if (currentRun.state === 'FAILED') break;

      // Skip phases already completed (for resume)
      if (this.phaseIndex(currentRun.state) > this.phaseIndex(phase)) {
        logger.debug(
          { runId: currentRun.runId, phase, currentState: currentRun.state },
          'Skipping already-completed phase',
        );
        continue;
      }

      // Only execute if we're at this phase
      if (currentRun.state !== phase) {
        logger.debug(
          { runId: currentRun.runId, phase, currentState: currentRun.state },
          'Phase not current, skipping',
        );
        continue;
      }

      const handler = this.handlers.get(phase);
      if (!handler) {
        logger.warn({ phase }, 'No handler registered for phase');
        currentRun = await this.failRun(
          currentRun,
          'MISSING_HANDLER',
          `No handler registered for phase ${phase}`,
        );
        break;
      }

      const phaseCheck = this.policy.canExecutePhase(phase);
      if (!phaseCheck.allowed) {
        currentRun = await this.failRun(currentRun, 'POLICY_BLOCKED', phaseCheck.reason!);
        break;
      }

      try {
        logger.info(
          { runId: currentRun.runId, phase, dryRun: this.policy.isDryRun() },
          `Executing phase: ${phase}`,
        );

        const result = await handler(currentRun);

        if (result.success) {
          const nextPhase = nextPhaseMap[phase];
          if (nextPhase) {
            currentRun = await this.transition(currentRun, nextPhase, result);
          }
        } else {
          currentRun = await this.failRun(
            currentRun,
            result.error?.code ?? 'PHASE_FAILED',
            result.error?.message ?? `Phase ${phase} failed`,
          );
        }
      } catch (error) {
        logger.error(
          { runId: currentRun.runId, phase, error: (error as Error).message },
          `Phase ${phase} threw unexpected error`,
        );
        currentRun = await this.failRun(
          currentRun,
          'PHASE_ERROR',
          `Phase ${phase} error: ${(error as Error).message}`,
        );
      }
    }

    return currentRun;
  }

  async resume(run: CreditRun): Promise<CreditRun> {
    if (run.state !== 'FAILED') {
      throw new Error(`Cannot resume run in state ${run.state}. Only FAILED runs can be resumed.`);
    }

    // Find the last successful phase from audit log
    const auditEntries = this.audit.getByRunId(run.runId);
    const lastSuccessEntry = auditEntries
      .reverse()
      .find((entry) => entry.action.startsWith('transition:'));

    if (!lastSuccessEntry) {
      // No successful transitions — restart from CLAIMING
      logger.info({ runId: run.runId }, 'No successful phases found, restarting from CLAIMING');
      const restarted = this.runs.updateState(run.runId, 'PENDING');
      if (!restarted) throw new Error(`Run ${run.runId} not found`);
      return this.execute(restarted);
    }

    const lastSuccessPhase = lastSuccessEntry.details.toPhase as RunState;
    const nextPhaseIndex = this.phaseIndex(lastSuccessPhase) + 1;

    if (nextPhaseIndex >= PHASE_ORDER.length) {
      logger.info({ runId: run.runId }, 'All phases already completed');
      return run;
    }

    const resumePhase = PHASE_ORDER[nextPhaseIndex];
    logger.info(
      { runId: run.runId, lastSuccess: lastSuccessPhase, resumeAt: resumePhase },
      'Resuming run from checkpoint',
    );

    const resumed = this.runs.updateState(run.runId, resumePhase);
    if (!resumed) throw new Error(`Run ${run.runId} not found`);

    // Clear the error
    this.runs.updateState(run.runId, resumePhase);

    return this.execute(resumed);
  }

  private validateTransition(from: RunState, to: RunState): void {
    const allowed = VALID_TRANSITIONS[from];
    if (!allowed || !allowed.includes(to)) {
      throw new Error(
        `Invalid state transition: ${from} → ${to}. Allowed: [${allowed?.join(', ') ?? 'none'}]`,
      );
    }
  }

  private async failRun(
    run: CreditRun,
    code: string,
    detail: string,
  ): Promise<CreditRun> {
    const failed = this.runs.markFailed(run.runId, {
      code,
      detail,
      failedState: run.state,
    });

    if (!failed) {
      throw new Error(`Run ${run.runId} not found after markFailed`);
    }

    this.audit.logTransition(
      run.runId,
      run.state,
      `fail:${run.state}`,
      { error: { code, detail }, failedState: run.state },
    );

    logger.error({ runId: run.runId, code, detail, failedState: run.state }, 'Run failed');
    return failed;
  }

  private phaseIndex(state: RunState): number {
    return PHASE_ORDER.indexOf(state);
  }
}
