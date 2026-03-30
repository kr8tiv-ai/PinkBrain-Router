import { Link, useSearchParams } from 'react-router';
import { useRuns, useStrategies, useTriggerRun, useResumeRun, ApiClientError } from '@/api';
import { RunStateBadge } from '@/components/StatusBadge';

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatUsd(val: number | null): string {
  if (val === null || val === undefined) return '—';
  return `$${val.toFixed(2)}`;
}

function truncateId(id: string): string {
  if (id.length <= 12) return id;
  return `${id.slice(0, 8)}...${id.slice(-4)}`;
}

export default function RunsPage() {
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
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-gray-800 py-20">
          <svg className="mb-4 h-12 w-12 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-sm text-text-muted">Select a strategy to view runs</p>
        </div>
      ) : isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-neon-green border-t-transparent" />
        </div>
      ) : error ? (
        <div className="rounded-lg border border-red-500/30 bg-surface p-6">
          <h2 className="mb-2 text-sm font-semibold text-red-400">Failed to load runs</h2>
          <p className="font-mono text-xs text-text-muted">{(error as Error).message}</p>
          <button
            type="button"
            onClick={() => refetch()}
            className="mt-3 text-xs text-neon-green transition hover:brightness-110"
          >
            Retry
          </button>
        </div>
      ) : !runs || runs.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-gray-800 py-20">
          <p className="text-sm text-text-muted">No runs for this strategy yet</p>
          <button
            type="button"
            onClick={() => triggerRun.mutate(strategyId)}
            disabled={triggerRun.isPending}
            className="mt-4 text-sm text-neon-green transition hover:brightness-110 disabled:opacity-50"
          >
            Trigger the first run
          </button>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-xs text-text-muted">
                <th className="pb-2 pr-4 font-medium">Run ID</th>
                <th className="pb-2 pr-4 font-medium">State</th>
                <th className="pb-2 pr-4 font-medium">Claimed SOL</th>
                <th className="pb-2 pr-4 font-medium">Swapped USDC</th>
                <th className="pb-2 pr-4 font-medium">Bridged USDC</th>
                <th className="pb-2 pr-4 font-medium">Funded USDC</th>
                <th className="pb-2 pr-4 font-medium">Allocated USD</th>
                <th className="pb-2 pr-4 font-medium">Keys</th>
                <th className="pb-2 pr-4 font-medium">Started</th>
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
                  <td className="py-2.5 pr-4 font-mono text-xs">{formatUsd(r.swappedUsdc)}</td>
                  <td className="py-2.5 pr-4 font-mono text-xs">{formatUsd(r.bridgedUsdc)}</td>
                  <td className="py-2.5 pr-4 font-mono text-xs">{formatUsd(r.fundedUsdc)}</td>
                  <td className="py-2.5 pr-4 font-mono text-xs">{formatUsd(r.allocatedUsd)}</td>
                  <td className="py-2.5 pr-4 font-mono text-xs">
                    {r.keysProvisioned != null ? `${r.keysProvisioned} / ${r.keysUpdated ?? 0}` : '—'}
                  </td>
                  <td className="py-2.5 pr-4 font-mono text-xs text-text-muted">{formatDateTime(r.startedAt)}</td>
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
      )}
    </div>
  );
}
