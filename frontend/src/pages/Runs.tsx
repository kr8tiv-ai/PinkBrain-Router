import { Link, useSearchParams } from 'react-router';
import { useRuns, useStrategies, useTriggerRun, useResumeRun, ApiClientError } from '@/api';
import { RunStateBadge } from '@/components/StatusBadge';
import { LoadingSpinner, EmptyState, ErrorState } from '@/components/ui';
import { formatUsd, formatDateTime, truncateId } from '@/lib/format';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';

export default function RunsPage() {
  useDocumentTitle('Runs — PinkBrain Router');
  const [searchParams, setSearchParams] = useSearchParams();
  const strategyId = searchParams.get('strategyId') ?? undefined;
  const { data: strategies } = useStrategies();
  const { data: runs, isLoading, error, refetch } = useRuns(strategyId);
  const triggerRun = useTriggerRun();
  const resumeRun = useResumeRun();

  const isConflict = triggerRun.isError && triggerRun.error instanceof ApiClientError && triggerRun.error.status === 409;

  const handleStrategyChange = (id: string) => {
    if (id) {
      setSearchParams({ strategyId: id });
    } else {
      setSearchParams({});
    }
  };

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-text-primary">Run History</h1>
          <p className="mt-1 text-sm text-text-secondary">
            {runs?.length ?? 0} runs
          </p>
        </div>
        {strategyId && (
          <button
            type="button"
            onClick={() => triggerRun.mutate(strategyId)}
            disabled={triggerRun.isPending}
            className="rounded bg-neon-green px-4 py-2 text-sm font-semibold text-gray-950 transition hover:brightness-110 disabled:opacity-50"
          >
            {triggerRun.isPending ? 'Triggering...' : 'Trigger Run'}
          </button>
        )}
      </div>

      {/* 409 conflict banner */}
      {isConflict && (
        <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-400">
          A run is already in progress for this strategy. Wait for it to finish before triggering another.
        </div>
      )}
      {triggerRun.isError && !isConflict && (
        <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {(triggerRun.error as Error)?.message ?? 'Failed to trigger run'}
        </div>
      )}

      {/* Strategy selector */}
      <div className="mb-6">
        <label htmlFor="strategy-select" className="mb-1.5 block text-xs text-text-muted">
          Strategy
        </label>
        <select
          id="strategy-select"
          value={strategyId ?? ''}
          onChange={(e) => handleStrategyChange(e.target.value)}
          className="w-full rounded border border-gray-700 bg-surface px-3 py-2 font-mono text-sm text-text-primary focus:border-neon-green focus:outline-none sm:w-80"
        >
          <option value="">Select a strategy...</option>
          {strategies?.map((s) => (
            <option key={s.strategyId} value={s.strategyId}>
              {truncateId(s.strategyId)} — {s.status}
            </option>
          ))}
        </select>
      </div>

      {!strategyId ? (
        <EmptyState
          icon={
            <svg className="h-12 w-12 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
          title="Select a strategy to view runs"
        />
      ) : isLoading ? (
        <LoadingSpinner />
      ) : error ? (
        <ErrorState title="Failed to load runs" message={(error as Error).message} onRetry={() => refetch()} />
      ) : !runs || runs.length === 0 ? (
        <EmptyState
          title="No runs for this strategy yet"
          action={
            <button
              type="button"
              onClick={() => triggerRun.mutate(strategyId)}
              disabled={triggerRun.isPending}
              className="text-sm text-neon-green transition hover:brightness-110 disabled:opacity-50"
            >
              Trigger the first run
            </button>
          }
        />
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-xs text-text-muted">
                  <th className="pb-2 pr-4 font-medium">Run ID</th>
                  <th className="pb-2 pr-4 font-medium">State</th>
                  <th className="pb-2 pr-4 font-medium">Claimed SOL</th>
                  <th className="hidden pb-2 pr-4 font-medium md:table-cell">Swapped USDC</th>
                  <th className="hidden pb-2 pr-4 font-medium md:table-cell">Bridged USDC</th>
                  <th className="hidden pb-2 pr-4 font-medium md:table-cell">Funded USDC</th>
                  <th className="hidden pb-2 pr-4 font-medium md:table-cell">Allocated USD</th>
                  <th className="pb-2 pr-4 font-medium">Keys</th>
                  <th className="hidden pb-2 pr-4 font-medium md:table-cell">Started</th>
                  <th className="pb-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.runId} className="border-b border-gray-800/50 transition hover:bg-surface-raised">
                    <td className="py-2.5 pr-4">
                      <Link to={`/runs/${r.runId}`} className="font-mono text-xs text-neon-green hover:brightness-110">
                        {truncateId(r.runId)}
                      </Link>
                    </td>
                    <td className="py-2.5 pr-4">
                      <RunStateBadge state={r.state} />
                    </td>
                    <td className="py-2.5 pr-4 font-mono text-xs">{formatUsd(r.claimedSol)}</td>
                    <td className="hidden py-2.5 pr-4 font-mono text-xs md:table-cell">{formatUsd(r.swappedUsdc)}</td>
                    <td className="hidden py-2.5 pr-4 font-mono text-xs md:table-cell">{formatUsd(r.bridgedUsdc)}</td>
                    <td className="hidden py-2.5 pr-4 font-mono text-xs md:table-cell">{formatUsd(r.fundedUsdc)}</td>
                    <td className="hidden py-2.5 pr-4 font-mono text-xs md:table-cell">{formatUsd(r.allocatedUsd)}</td>
                    <td className="py-2.5 pr-4 font-mono text-xs">
                      {r.keysProvisioned != null ? `${r.keysProvisioned} / ${r.keysUpdated ?? 0}` : '—'}
                    </td>
                    <td className="hidden py-2.5 pr-4 font-mono text-xs text-text-muted md:table-cell">{formatDateTime(r.startedAt)}</td>
                    <td className="py-2.5">
                      {r.state === 'FAILED' && (
                        <button
                          type="button"
                          onClick={() => resumeRun.mutate(r.runId)}
                          disabled={resumeRun.isPending}
                          className="rounded border border-amber-500/30 px-2 py-1 text-xs text-amber-400 transition hover:border-amber-400 hover:bg-amber-500/10 disabled:opacity-50"
                        >
                          {resumeRun.isPending ? 'Resuming...' : 'Resume'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile card view */}
          <div className="flex flex-col gap-3 md:hidden">
            {runs.map((r) => (
              <Link
                key={r.runId}
                to={`/runs/${r.runId}`}
                className="rounded-lg border border-gray-800 bg-surface p-4 transition hover:border-gray-700"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-neon-green">{truncateId(r.runId)}</span>
                  <RunStateBadge state={r.state} />
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-text-muted">Claimed SOL</span>
                    <div className="font-mono text-text-primary">{formatUsd(r.claimedSol)}</div>
                  </div>
                  <div>
                    <span className="text-text-muted">Keys</span>
                    <div className="font-mono text-text-primary">
                      {r.keysProvisioned != null ? `${r.keysProvisioned} / ${r.keysUpdated ?? 0}` : '—'}
                    </div>
                  </div>
                  <div>
                    <span className="text-text-muted">Swapped</span>
                    <div className="font-mono text-text-primary">{formatUsd(r.swappedUsdc)}</div>
                  </div>
                  <div>
                    <span className="text-text-muted">Bridged</span>
                    <div className="font-mono text-text-primary">{formatUsd(r.bridgedUsdc)}</div>
                  </div>
                  <div>
                    <span className="text-text-muted">Funded</span>
                    <div className="font-mono text-text-primary">{formatUsd(r.fundedUsdc)}</div>
                  </div>
                  <div>
                    <span className="text-text-muted">Allocated</span>
                    <div className="font-mono text-text-primary">{formatUsd(r.allocatedUsd)}</div>
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-xs text-text-muted">{formatDateTime(r.startedAt)}</span>
                  {r.state === 'FAILED' && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        resumeRun.mutate(r.runId);
                      }}
                      disabled={resumeRun.isPending}
                      className="rounded border border-amber-500/30 px-2 py-1 text-xs text-amber-400 transition hover:border-amber-400 hover:bg-amber-500/10 disabled:opacity-50"
                    >
                      Resume
                    </button>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
