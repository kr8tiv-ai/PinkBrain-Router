import { useStats } from '@/api';
import { LoadingSpinner, ErrorState, PageHeader } from '@/components/ui';
import { formatUsd } from '@/lib/format';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';

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
  useDocumentTitle('Stats — PinkBrain Router');
  const { data: stats, isLoading, error } = useStats();

  if (isLoading) {
    return <LoadingSpinner />;
  }

  if (error || !stats) {
    return <ErrorState title="Failed to load stats" message={(error as Error).message} />;
  }

  const successRate = stats.totalRuns > 0
    ? ((stats.completedRuns / stats.totalRuns) * 100).toFixed(1)
    : '—';

  return (
    <div>
      <PageHeader title="Stats" subtitle="Aggregate pipeline statistics" />

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
