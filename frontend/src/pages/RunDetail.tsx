import { useParams, useNavigate, Link } from 'react-router';
import { useRun, useResumeRun } from '@/api';
import { RunStateBadge } from '@/components/StatusBadge';
import { PhaseTimeline } from '@/components/PhaseTimeline';
import { LoadingSpinner, ErrorState } from '@/components/ui';
import { formatUsd, formatDateTime, formatDuration, truncateId } from '@/lib/format';

export default function RunDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: run, isLoading, error, refetch } = useRun(id);
  const resumeRun = useResumeRun();

  if (isLoading) {
    return <LoadingSpinner />;
  }

  if (error || !run) {
    return <ErrorState title="Failed to load run" message={(error as Error)?.message ?? 'Not found'} backTo="/runs" backLabel="Back to runs" />;
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate('/runs')}
            className="rounded p-1 text-text-muted transition hover:text-text-primary"
            aria-label="Back to runs"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <div className="flex items-center gap-3">
              <span className="font-mono text-sm text-text-primary">{run.runId}</span>
              <RunStateBadge state={run.state} />
            </div>
            <p className="mt-0.5 text-xs text-text-muted">
              Strategy:{' '}
              <Link to={`/strategies/${run.strategyId}`} className="text-neon-green hover:brightness-110">
                {run.strategyId}
              </Link>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => refetch()}
            className="rounded border border-gray-700 px-3 py-1.5 text-xs text-text-secondary transition hover:bg-surface-raised"
          >
            Refresh
          </button>
          {run.state === 'FAILED' && (
            <button
              type="button"
              onClick={() => resumeRun.mutate(run.runId)}
              disabled={resumeRun.isPending}
              className="rounded bg-neon-green px-3 py-1.5 text-xs font-semibold text-gray-950 transition hover:brightness-110 disabled:opacity-50"
            >
              {resumeRun.isPending ? 'Resuming...' : 'Resume Run'}
            </button>
          )}
        </div>
      </div>

      {/* Phase Timeline */}
      <div className="mb-8 rounded-lg border border-gray-800 bg-surface p-4">
        <h3 className="mb-2 text-sm font-medium text-text-secondary">Pipeline Phase</h3>
        <PhaseTimeline state={run.state} failedState={run.error?.failedState} />
      </div>

      {/* Error Details */}
      {run.state === 'FAILED' && run.error && (
        <div className="mb-8 rounded-lg border border-red-500/30 bg-red-500/5 p-4">
          <h3 className="mb-2 text-sm font-semibold text-red-400">Error Details</h3>
          <div className="grid gap-2 sm:grid-cols-3">
            <div>
              <dt className="text-xs text-text-muted">Error Code</dt>
              <dd className="font-mono text-sm text-red-400">{run.error.code}</dd>
            </div>
            <div>
              <dt className="text-xs text-text-muted">Failed State</dt>
              <dd><RunStateBadge state={run.error.failedState} /></dd>
            </div>
            <div>
              <dt className="text-xs text-text-muted">Detail</dt>
              <dd className="font-mono text-sm text-text-secondary">{run.error.detail}</dd>
            </div>
          </div>
        </div>
      )}

      {/* Metrics */}
      <div className="mb-8">
        <h3 className="mb-4 text-base font-semibold text-text-primary">Run Metrics</h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard label="Claimed SOL" value={formatUsd(run.claimedSol)} />
          <MetricCard label="Swapped USDC" value={formatUsd(run.swappedUsdc)} />
          <MetricCard label="Bridged USDC" value={formatUsd(run.bridgedUsdc)} />
          <MetricCard label="Funded USDC" value={formatUsd(run.fundedUsdc)} />
          <MetricCard label="Allocated USD" value={formatUsd(run.allocatedUsd)} />
          <MetricCard label="Keys Provisioned" value={run.keysProvisioned?.toString() ?? '—'} />
          <MetricCard label="Keys Updated" value={run.keysUpdated?.toString() ?? '—'} />
          <MetricCard
            label="Duration"
            value={formatDuration(run.startedAt, run.finishedAt)}
          />
        </div>
      </div>

      {/* Timestamps & Transaction Links */}
      <div className="mb-8">
        <h3 className="mb-4 text-base font-semibold text-text-primary">Timestamps</h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <DetailCard label="Started At" value={formatDateTime(run.startedAt)} />
          <DetailCard label="Finished At" value={formatDateTime(run.finishedAt)} />
          {run.claimedTxSignature && (
            <DetailCard label="Claim Tx" value={truncateId(run.claimedTxSignature, 10)} mono />
          )}
          {run.swapTxSignature && (
            <DetailCard label="Swap Tx" value={truncateId(run.swapTxSignature, 10)} mono />
          )}
          {run.bridgeTxHash && (
            <DetailCard label="Bridge Tx" value={truncateId(run.bridgeTxHash, 10)} mono />
          )}
          {run.fundingTxHash && (
            <DetailCard label="Funding Tx" value={truncateId(run.fundingTxHash, 10)} mono />
          )}
        </div>
      </div>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-800 bg-surface p-4">
      <dt className="text-xs text-text-muted">{label}</dt>
      <dd className="mt-1 font-mono text-lg font-medium text-text-primary">{value}</dd>
    </div>
  );
}

function DetailCard({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-lg border border-gray-800 bg-surface p-4">
      <dt className="text-xs text-text-muted">{label}</dt>
      <dd className={`mt-1 text-sm text-text-primary ${mono ? 'font-mono' : ''}`}>{value}</dd>
    </div>
  );
}
