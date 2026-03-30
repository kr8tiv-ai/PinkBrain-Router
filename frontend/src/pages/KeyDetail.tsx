import { useState } from 'react';
import { useParams, useNavigate } from 'react-router';
import { useKey, useUsageKey } from '@/api';
import { ProgressBar } from '@/components/ProgressBar';
import { UsageChart } from '@/components/UsageChart';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { LoadingSpinner, ErrorState } from '@/components/ui';
import { formatDate, formatUsd } from '@/lib/format';

export default function KeyDetail() {
  const { hash } = useParams<{ hash: string }>();
  useDocumentTitle(hash ? `Key ${hash.slice(0, 8)} — PinkBrain Router` : 'Key — PinkBrain Router');
  const navigate = useNavigate();
  const { data: key, isLoading, error } = useKey(hash);
  const { data: snapshots } = useUsageKey(hash, 200);
  const [chartMode, setChartMode] = useState<'all' | 'daily' | 'weekly' | 'monthly'>('all');

  if (isLoading) {
    return <LoadingSpinner />;
  }

  if (error || !key) {
    return <ErrorState title="Failed to load key" message={(error as Error)?.message ?? 'Not found'} backTo="/keys" backLabel="Back to keys" />;
  }

  const usagePct = key.limit > 0 ? (key.usage / key.limit) * 100 : 0;
  const barColor = usagePct > 90 ? 'red' : usagePct > 70 ? 'yellow' : 'green';

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate('/keys')}
          className="rounded p-1 text-text-muted transition hover:text-text-primary"
          aria-label="Back to keys"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-mono text-sm font-medium text-text-primary">
              {key.name || key.hash}
            </h1>
            {key.disabled && (
              <span className="rounded border border-gray-600 bg-gray-800 px-1.5 py-0.5 text-xs text-gray-400">
                Disabled
              </span>
            )}
          </div>
          <p className="mt-0.5 font-mono text-xs text-text-muted">{key.hash}</p>
        </div>
      </div>

      {/* Usage progress */}
      <div className="mb-8 rounded-lg border border-gray-800 bg-surface p-5">
        <div className="mb-4">
          <ProgressBar
            value={key.usage}
            max={key.limit}
            color={barColor}
            size="lg"
            label="Usage"
            showPercent
          />
        </div>
        <div className="grid grid-cols-2 gap-x-8 gap-y-1 sm:grid-cols-4">
          <DetailField label="Total Usage">{formatUsd(key.usage)}</DetailField>
          <DetailField label="Limit">{formatUsd(key.limit)}</DetailField>
          <DetailField label="Remaining">{formatUsd(key.limitRemaining)}</DetailField>
          <DetailField label="Status">{key.disabled ? 'Disabled' : 'Active'}</DetailField>
          <DetailField label="Daily Usage">{formatUsd(key.usageDaily)}</DetailField>
          <DetailField label="Weekly Usage">{formatUsd(key.usageWeekly)}</DetailField>
          <DetailField label="Monthly Usage">{formatUsd(key.usageMonthly)}</DetailField>
          <DetailField label="Expires">{formatDate(key.expiresAt)}</DetailField>
          <DetailField label="Created">{formatDate(key.createdAt)}</DetailField>
          <DetailField label="Updated">{formatDate(key.updatedAt)}</DetailField>
        </div>
      </div>

      {/* Usage Chart */}
      <div className="mb-8 rounded-lg border border-gray-800 bg-surface p-5">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-medium text-text-secondary">Usage Over Time</h3>
          <div className="flex gap-1 rounded-lg border border-gray-700 p-0.5">
            {(['all', 'daily', 'weekly', 'monthly'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setChartMode(mode)}
                className={`rounded px-2.5 py-1 text-xs font-medium transition ${
                  chartMode === mode
                    ? 'bg-neon-green/15 text-neon-green'
                    : 'text-text-muted hover:text-text-secondary'
                }`}
              >
                {mode === 'all' ? 'All' : mode === 'daily' ? 'Daily' : mode === 'weekly' ? 'Weekly' : 'Monthly'}
              </button>
            ))}
          </div>
        </div>
        <UsageChart
          snapshots={snapshots ?? []}
          showDaily={chartMode === 'all' || chartMode === 'daily'}
          showWeekly={chartMode === 'all' || chartMode === 'weekly'}
          showMonthly={chartMode === 'all' || chartMode === 'monthly'}
        />
        <p className="mt-2 text-xs text-text-muted">
          {snapshots?.length ?? 0} data points · Auto-refreshes every 60s
        </p>
      </div>
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
