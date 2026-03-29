import { useCreditPool } from '@/api';
import { ProgressBar } from '@/components/ProgressBar';

function formatUsd(val: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(val);
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

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
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-neon-green border-t-transparent" />
      </div>
    );
  }

  if (error || !pool) {
    return (
      <div className="rounded-lg border border-red-500/30 bg-surface p-6">
        <h2 className="mb-2 text-sm font-semibold text-red-400">Failed to load credit pool</h2>
        <p className="font-mono text-xs text-text-muted">{(error as Error).message}</p>
      </div>
    );
  }

  const availablePct = pool.totalBalanceUsd > 0
    ? (pool.availableUsd / pool.totalBalanceUsd) * 100
    : 0;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-text-primary">Credit Pool</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Last updated: {formatDateTime(pool.lastUpdated)}
        </p>
      </div>

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
