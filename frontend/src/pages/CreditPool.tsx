import { useCreditPool } from '@/api';
import { ProgressBar } from '@/components/ProgressBar';
import { LoadingSpinner, ErrorState, PageHeader } from '@/components/ui';
import { formatUsd, formatDateTime } from '@/lib/format';

function getAvailabilityColor(availablePct: number): 'green' | 'yellow' | 'red' {
  if (availablePct > 20) return 'green';
  if (availablePct > 10) return 'yellow';
  return 'red';
}

function getAvailabilityTextColor(availablePct: number): string {
  if (availablePct > 20) return 'text-emerald-400';
  if (availablePct > 10) return 'text-amber-400';
  return 'text-red-400';
}

export default function CreditPoolPage() {
  const { data: pool, isLoading, error } = useCreditPool();

  if (isLoading) {
    return <LoadingSpinner />;
  }

  if (error || !pool) {
    return <ErrorState title="Failed to load credit pool" message={(error as Error).message} />;
  }

  const availablePct = pool.totalBalanceUsd > 0
    ? (pool.availableUsd / pool.totalBalanceUsd) * 100
    : 0;

  return (
    <div>
      <PageHeader title="Credit Pool" subtitle={`Last updated: ${formatDateTime(pool.lastUpdated)}`} />

      {/* Total balance */}
      <div className="mb-8 rounded-lg border border-gray-800 bg-surface p-8 text-center">
        <p className="mb-1 text-sm text-text-muted">Total Balance</p>
        <p className="font-mono text-4xl font-bold text-text-primary">
          {formatUsd(pool.totalBalanceUsd)}
        </p>
        <div className={`mt-2 inline-block rounded-full px-3 py-0.5 text-xs font-medium ${
          availablePct > 20
            ? 'bg-emerald-500/15 text-emerald-400'
            : availablePct > 10
              ? 'bg-amber-500/15 text-amber-400'
              : 'bg-red-500/15 text-red-400'
        }`}>
          {availablePct.toFixed(1)}% available
        </div>
      </div>

      {/* Breakdown */}
      <div className="mb-8 grid gap-6 lg:grid-cols-2">
        {/* Allocated vs Available */}
        <div className="rounded-lg border border-gray-800 bg-surface p-5">
          <h3 className="mb-4 text-sm font-medium text-text-secondary">Allocated vs Available</h3>
          <div className="mb-6">
            <ProgressBar
              value={pool.totalAllocatedUsd}
              max={pool.totalBalanceUsd}
              color="blue"
              size="lg"
              showPercent
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <dt className="text-xs text-text-muted">Allocated</dt>
              <dd className="mt-1 font-mono text-lg font-medium text-text-primary">
                {formatUsd(pool.totalAllocatedUsd)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-text-muted">Available</dt>
              <dd className={`mt-1 font-mono text-lg font-medium ${getAvailabilityTextColor(availablePct)}`}>
                {formatUsd(pool.availableUsd)}
              </dd>
            </div>
          </div>
        </div>

        {/* Reserve */}
        <div className="rounded-lg border border-gray-800 bg-surface p-5">
          <h3 className="mb-4 text-sm font-medium text-text-secondary">Reserve</h3>
          <div className="mb-6">
            <ProgressBar
              value={pool.reservedUsd}
              max={pool.totalBalanceUsd}
              color={getAvailabilityColor(availablePct)}
              size="lg"
              showPercent
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <dt className="text-xs text-text-muted">Reserved</dt>
              <dd className="mt-1 font-mono text-lg font-medium text-text-primary">
                {formatUsd(pool.reservedUsd)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-text-muted">Reserve %</dt>
              <dd className="mt-1 font-mono text-lg font-medium text-text-primary">
                {pool.reservePct}%
              </dd>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
