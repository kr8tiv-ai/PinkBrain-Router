import { Link } from 'react-router';
import { useStrategies } from '@/api';
import { StatusBadge } from '@/components/StatusBadge';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function truncateWallet(wallet: string): string {
  if (wallet.length <= 10) return wallet;
  return `${wallet.slice(0, 6)}...${wallet.slice(-4)}`;
}

export default function StrategyList() {
  const { data: strategies, isLoading, error } = useStrategies();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-neon-green border-t-transparent" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-500/30 bg-surface p-6">
        <h2 className="mb-2 text-sm font-semibold text-red-400">Failed to load strategies</h2>
        <p className="font-mono text-xs text-text-muted">{(error as Error).message}</p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-text-primary">Strategies</h1>
          <p className="mt-1 text-sm text-text-secondary">
            {strategies?.length ?? 0} strategies configured
          </p>
        </div>
        <Link
          to="/strategies/new"
          className="rounded bg-neon-green px-4 py-2 text-sm font-semibold text-gray-950 transition hover:brightness-110"
        >
          + Create Strategy
        </Link>
      </div>

      {!strategies || strategies.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-gray-800 py-20">
          <svg className="mb-4 h-12 w-12 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
          </svg>
          <p className="text-sm text-text-muted">No strategies yet</p>
          <Link
            to="/strategies/new"
            className="mt-4 text-sm text-neon-green transition hover:brightness-110"
          >
            Create your first strategy
          </Link>
        </div>
      ) : (
        <div className="grid gap-4">
          {strategies.map((s) => (
            <Link
              key={s.strategyId}
              to={`/strategies/${s.strategyId}`}
              className="group rounded-lg border border-gray-800 bg-surface p-5 transition hover:border-gray-700 hover:bg-surface-raised"
            >
              <div className="flex items-start justify-between">
                <div className="min-w-0 flex-1">
                  <div className="mb-2 flex items-center gap-3">
                    <span className="truncate font-mono text-sm font-medium text-text-primary">
                      {truncateWallet(s.ownerWallet)}
                    </span>
                    <StatusBadge status={s.status} />
                  </div>
                  <div className="grid grid-cols-2 gap-x-8 gap-y-1 sm:grid-cols-4">
                    <Field label="Distribution">{s.distribution}</Field>
                    <Field label="Source">{s.source}</Field>
                    <Field label="Schedule">
                      <span className="font-mono">{s.schedule || '—'}</span>
                    </Field>
                    <Field label="Reserve">{s.creditPoolReservePct}%</Field>
                    <Field label="Token">{s.distributionToken || '—'}</Field>
                    <Field label="Top N">{s.distributionTopN || '—'}</Field>
                    <Field label="Last Run">{s.lastRunId ?? '—'}</Field>
                    <Field label="Created">{formatDate(s.createdAt)}</Field>
                  </div>
                </div>
                <svg className="h-5 w-5 flex-shrink-0 text-text-muted transition group-hover:text-text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-text-muted">{label}</dt>
      <dd className="truncate font-mono text-sm text-text-secondary">{children}</dd>
    </div>
  );
}
