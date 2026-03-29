import { useState } from 'react';
import { useParams, useNavigate } from 'react-router';
import { useStrategy, useRuns, useStrategyKeys, useTriggerRun } from '@/api';
import { StatusBadge, RunStateBadge } from '@/components/StatusBadge';

const KEY_STATUS_COLORS: Record<string, string> = {
  ACTIVE: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  EXHAUSTED: 'bg-red-500/15 text-red-400 border-red-500/30',
  EXPIRED: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  REVOKED: 'bg-gray-500/15 text-gray-400 border-gray-500/30',
};

function KeyStatusBadge({ status }: { status: string }) {
  const cls = KEY_STATUS_COLORS[status] ?? KEY_STATUS_COLORS.REVOKED;
  return (
    <span className={`inline-flex items-center rounded border px-2 py-0.5 font-mono text-xs ${cls}`}>
      {status}
    </span>
  );
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatUsd(val: number | null): string {
  if (val === null || val === undefined) return '—';
  return `$${val.toFixed(2)}`;
}

export default function StrategyDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: strategy, isLoading, error } = useStrategy(id);
  const { data: runs } = useRuns(id);
  const { data: keys } = useStrategyKeys(id);
  const triggerRun = useTriggerRun();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-neon-green border-t-transparent" />
      </div>
    );
  }

  if (error || !strategy) {
    return (
      <div className="rounded-lg border border-red-500/30 bg-surface p-6">
        <h2 className="mb-2 text-sm font-semibold text-red-400">Failed to load strategy</h2>
        <p className="font-mono text-xs text-text-muted">{(error as Error)?.message ?? 'Not found'}</p>
        <button
          type="button"
          onClick={() => navigate('/strategies')}
          className="mt-4 text-sm text-neon-green transition hover:brightness-110"
        >
          &larr; Back to strategies
        </button>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate('/strategies')}
            className="rounded p-1 text-text-muted transition hover:text-text-primary"
            aria-label="Back to strategies"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="font-mono text-sm font-medium text-text-primary">
                {strategy.strategyId}
              </h1>
              <StatusBadge status={strategy.status} />
            </div>
            <p className="mt-0.5 text-xs text-text-muted">
              Created {formatDate(strategy.createdAt)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => triggerRun.mutate(strategy.strategyId)}
            disabled={triggerRun.isPending}
            className="rounded bg-neon-green px-3 py-1.5 text-xs font-semibold text-gray-950 transition hover:brightness-110 disabled:opacity-50"
          >
            {triggerRun.isPending ? 'Triggering...' : 'Trigger Run'}
          </button>
          <button
            type="button"
            onClick={() => setShowDeleteConfirm(true)}
            className="rounded border border-red-500/30 px-3 py-1.5 text-xs text-red-400 transition hover:border-red-400 hover:bg-red-500/10"
          >
            Delete
          </button>
        </div>
      </div>

      {/* Strategy details grid */}
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <DetailCard title="Owner">{strategy.ownerWallet}</DetailCard>
        <DetailCard title="Source">{strategy.source}</DetailCard>
        <DetailCard title="Distribution">{strategy.distribution}</DetailCard>
        <DetailCard title="Distribution Token">{strategy.distributionToken || '—'}</DetailCard>
        <DetailCard title="Top N">{strategy.distributionTopN || '—'}</DetailCard>
        <DetailCard title="Reserve">{strategy.creditPoolReservePct}%</DetailCard>
        <DetailCard title="Schedule">
          <span className="font-mono">{strategy.schedule || '—'}</span>
        </DetailCard>
        <DetailCard title="Min Claim">{formatUsd(strategy.minClaimThreshold)}</DetailCard>
        <DetailCard title="Last Run">{strategy.lastRunId ?? '—'}</DetailCard>
      </div>

      {/* Key Config */}
      <div className="mb-8 rounded-lg border border-gray-800 bg-surface p-4">
        <h3 className="mb-3 text-sm font-medium text-text-secondary">Key Configuration</h3>
        <div className="grid grid-cols-3 gap-4">
          <DetailField label="Default Limit">{formatUsd(strategy.keyConfig?.defaultLimitUsd ?? null)}</DetailField>
          <DetailField label="Reset">{strategy.keyConfig?.limitReset ?? '—'}</DetailField>
          <DetailField label="Expiry">{strategy.keyConfig?.expiryDays ?? '—'} days</DetailField>
        </div>
      </div>

      {/* Exclusion List */}
      {strategy.exclusionList && strategy.exclusionList.length > 0 && (
        <div className="mb-8 rounded-lg border border-gray-800 bg-surface p-4">
          <h3 className="mb-3 text-sm font-medium text-text-secondary">Exclusion List</h3>
          <div className="flex flex-wrap gap-2">
            {strategy.exclusionList.map((addr) => (
              <span
                key={addr}
                className="rounded border border-gray-700 bg-surface-raised px-2 py-1 font-mono text-xs text-text-muted"
              >
                {addr}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Run History */}
      <Section title="Run History">
        {!runs || runs.length === 0 ? (
          <p className="py-4 text-center text-sm text-text-muted">No runs yet</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-xs text-text-muted">
                  <th className="pb-2 pr-4 font-medium">Run ID</th>
                  <th className="pb-2 pr-4 font-medium">State</th>
                  <th className="pb-2 pr-4 font-medium">Claimed SOL</th>
                  <th className="pb-2 pr-4 font-medium">Swapped USDC</th>
                  <th className="pb-2 pr-4 font-medium">Keys</th>
                  <th className="pb-2 font-medium">Started</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.runId} className="border-b border-gray-800/50">
                    <td className="py-2 pr-4 font-mono text-xs text-text-secondary">{r.runId}</td>
                    <td className="py-2 pr-4"><RunStateBadge state={r.state} /></td>
                    <td className="py-2 pr-4 font-mono text-xs">{formatUsd(r.claimedSol)}</td>
                    <td className="py-2 pr-4 font-mono text-xs">{formatUsd(r.swappedUsdc)}</td>
                    <td className="py-2 pr-4 font-mono text-xs">{r.keysProvisioned ?? '—'}</td>
                    <td className="py-2 font-mono text-xs text-text-muted">{formatDate(r.startedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* Keys */}
      <Section title="Provisioned Keys">
        {!keys || keys.length === 0 ? (
          <p className="py-4 text-center text-sm text-text-muted">No keys provisioned</p>
        ) : (
          <div className="grid gap-3">
            {keys.map((k) => (
              <div key={k.keyId} className="rounded-lg border border-gray-800 bg-surface p-4">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-text-secondary">{k.holderWallet}</span>
                  <KeyStatusBadge status={k.status} />
                </div>
                <div className="mt-2 grid grid-cols-3 gap-4">
                  <DetailField label="Usage">{formatUsd(k.currentUsageUsd)}</DetailField>
                  <DetailField label="Limit">{formatUsd(k.spendingLimitUsd)}</DetailField>
                  <DetailField label="Expires">{formatDate(k.expiresAt)}</DetailField>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Delete confirmation modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-full max-w-sm rounded-lg border border-gray-700 bg-surface p-6">
            <h3 className="mb-2 text-sm font-semibold text-text-primary">Delete Strategy</h3>
            <p className="mb-6 text-sm text-text-secondary">
              This will permanently delete strategy {strategy.strategyId}. This action cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(false)}
                className="rounded border border-gray-700 px-4 py-2 text-sm text-text-secondary transition hover:bg-surface-raised"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  // Delete via API client — for now navigate back
                  setShowDeleteConfirm(false);
                  navigate('/strategies');
                }}
                className="rounded bg-red-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-400"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-8">
      <h2 className="mb-4 text-base font-semibold text-text-primary">{title}</h2>
      {children}
    </div>
  );
}

function DetailCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-gray-800 bg-surface p-4">
      <dt className="text-xs text-text-muted">{title}</dt>
      <dd className="mt-1 truncate font-mono text-sm text-text-primary">{children}</dd>
    </div>
  );
}

function DetailField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-text-muted">{label}</dt>
      <dd className="font-mono text-sm text-text-primary">{children}</dd>
    </div>
  );
}
