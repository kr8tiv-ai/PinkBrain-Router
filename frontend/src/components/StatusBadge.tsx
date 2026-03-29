import type { StrategyStatus, RunState } from '@/api/types';

const STATUS_COLORS: Record<StrategyStatus, string> = {
  ACTIVE: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  PAUSED: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  ERROR: 'bg-red-500/15 text-red-400 border-red-500/30',
};

const RUN_STATE_COLORS: Record<RunState, string> = {
  PENDING: 'bg-gray-500/15 text-gray-400 border-gray-500/30',
  CLAIMING: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  SWAPPING: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',
  BRIDGING: 'bg-violet-500/15 text-violet-400 border-violet-500/30',
  FUNDING: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  ALLOCATING: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
  PROVISIONING: 'bg-teal-500/15 text-teal-400 border-teal-500/30',
  COMPLETE: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  FAILED: 'bg-red-500/15 text-red-400 border-red-500/30',
};

export function StatusBadge({ status }: { status: StrategyStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded border px-2 py-0.5 font-mono text-xs ${STATUS_COLORS[status]}`}
    >
      {status}
    </span>
  );
}

export function RunStateBadge({ state }: { state: RunState }) {
  return (
    <span
      className={`inline-flex items-center rounded border px-2 py-0.5 font-mono text-xs ${RUN_STATE_COLORS[state]}`}
    >
      {state}
    </span>
  );
}
