import { useStats } from '@/api';

function formatUsd(val: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(val);
}

function formatSol(val: number): string {
  return `${val.toFixed(4)} SOL`;
}

interface StatCardProps {
  label: string;
  value: string;
  accent?: string;
}

function StatCard({ label, value, accent = 'text-text-primary' }: StatCardProps) {
  return (
    <div className="rounded-lg border border-gray-800 bg-surface p-5">
      <p className="mb-1 text-xs text-text-muted">{label}</p>
      <p className={`font-mono text-xl font-bold ${accent}`}>{value}</p>
    </div>
  );
}

export default function StatsPage() {
  const { data: stats, isLoading, error } = useStats();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-neon-green border-t-transparent" />
      </div>
    );
  }

  if (error || !stats) {
    return (
      <div className="rounded-lg border border-red-500/30 bg-surface p-6">
        <h2 className="mb-2 text-sm font-semibold text-red-400">Failed to load stats</h2>
        <p className="font-mono text-xs text-text-muted">{(error as Error).message}</p>
      </div>
    );
  }

  const successRate = stats.totalRuns > 0
    ? ((stats.completedRuns / stats.totalRuns) * 100).toFixed(1)
    : '—';

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-text-primary">Stats</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Aggregate pipeline statistics
        </p>
      </div>

      {/* Primary metrics */}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total Runs" value={stats.totalRuns.toLocaleString()} />
        <StatCard label="Completed" value={stats.completedRuns.toLocaleString()} accent="text-emerald-400" />
        <StatCard label="Failed" value={stats.failedRuns.toLocaleString()} accent="text-red-400" />
        <StatCard label="Success Rate" value={`${successRate}%`} accent="text-neon-green" />
      </div>

      {/* Financial metrics */}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard label="Claimed SOL" value={formatSol(stats.totalClaimedSol)} />
        <StatCard label="Swapped USDC" value={formatUsd(stats.totalSwappedUsdc)} />
        <StatCard label="Allocated USD" value={formatUsd(stats.totalAllocatedUsd)} />
      </div>

      {/* Key metrics */}
      <div className="grid gap-4 sm:grid-cols-2">
        <StatCard label="Keys Provisioned" value={stats.totalKeysProvisioned.toLocaleString()} />
        <StatCard label="Keys Updated" value={stats.totalKeysUpdated.toLocaleString()} />
      </div>
    </div>
  );
}
