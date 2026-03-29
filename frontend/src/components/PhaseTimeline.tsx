import type { RunState } from '@/api/types';

const PHASES: RunState[] = [
  'PENDING',
  'CLAIMING',
  'SWAPPING',
  'BRIDGING',
  'FUNDING',
  'ALLOCATING',
  'PROVISIONING',
  'COMPLETE',
];

const PHASE_LABELS: Record<RunState, string> = {
  PENDING: 'Pending',
  CLAIMING: 'Claiming',
  SWAPPING: 'Swapping',
  BRIDGING: 'Bridging',
  FUNDING: 'Funding',
  ALLOCATING: 'Allocating',
  PROVISIONING: 'Provisioning',
  COMPLETE: 'Complete',
  FAILED: 'Failed',
};

function getPhaseIndex(state: RunState): number {
  if (state === 'FAILED') return PHASES.length;
  return PHASES.indexOf(state);
}

interface PhaseTimelineProps {
  state: RunState;
  failedState?: RunState | null;
}

export function PhaseTimeline({ state, failedState }: PhaseTimelineProps) {
  const currentIdx = getPhaseIndex(state);
  const failedIdx = failedState ? getPhaseIndex(failedState) : -1;
  const isFailed = state === 'FAILED';
  const activeIdx = isFailed ? failedIdx : currentIdx;

  return (
    <div className="flex items-center gap-1 overflow-x-auto py-4">
      {PHASES.map((phase, idx) => {
        const isCompleted = idx < activeIdx;
        const isCurrent = idx === activeIdx && !isFailed;
        const isFailedPhase = isFailed && idx === failedIdx;

        return (
          <div key={phase} className="flex items-center">
            {/* Phase node */}
            <div className="flex flex-col items-center gap-1.5">
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-full border-2 text-xs ${
                  isCompleted
                    ? 'border-emerald-500 bg-emerald-500/20 text-emerald-400'
                    : isFailedPhase
                      ? 'border-red-500 bg-red-500/20 text-red-400'
                      : isCurrent
                        ? 'border-neon-green bg-neon-green/20 text-neon-green animate-pulse'
                        : 'border-gray-700 bg-gray-800 text-gray-500'
                }`}
              >
                {isCompleted ? (
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                ) : isFailedPhase ? (
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                ) : (
                  <span className="font-mono">{idx + 1}</span>
                )}
              </div>
              <span
                className={`whitespace-nowrap text-xs ${
                  isCompleted
                    ? 'text-emerald-400'
                    : isFailedPhase
                      ? 'text-red-400'
                      : isCurrent
                        ? 'font-semibold text-neon-green'
                        : 'text-gray-500'
                }`}
              >
                {PHASE_LABELS[phase]}
              </span>
            </div>

            {/* Connector line */}
            {idx < PHASES.length - 1 && (
              <div
                className={`mx-1 h-0.5 w-6 flex-shrink-0 sm:w-10 ${
                  idx < activeIdx ? 'bg-emerald-500' : 'bg-gray-700'
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
