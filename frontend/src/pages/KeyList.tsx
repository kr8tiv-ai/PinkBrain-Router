import { useState } from 'react';
import { Link } from 'react-router';
import { useKeys } from '@/api';
import { ProgressBar } from '@/components/ProgressBar';
import { CardSkeleton, EmptyState, ErrorState } from '@/components/ui';
import { formatDate, truncateId } from '@/lib/format';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';

export default function KeysPage() {
  useDocumentTitle('API Keys — PinkBrain Router');
  const { data: keys, isLoading, error } = useKeys();
  const [showDisabled, setShowDisabled] = useState<'all' | 'active' | 'disabled'>('all');

  const filteredKeys = keys?.filter((k) => {
    if (showDisabled === 'active') return !k.disabled;
    if (showDisabled === 'disabled') return k.disabled;
    return true;
  });

  if (isLoading) {
    return (
      <div>
        <div className="mb-6 flex items-center justify-between">
          <div>
            <div className="h-6 w-24 animate-pulse rounded bg-gray-800" />
            <div className="mt-1 h-4 w-16 animate-pulse rounded bg-gray-800" />
          </div>
        </div>
        <div className="grid gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return <ErrorState title="Failed to load keys" message={(error as Error).message} />;
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-text-primary">API Keys</h1>
          <p className="mt-1 text-sm text-text-secondary">
            {filteredKeys?.length ?? 0} keys
          </p>
        </div>
        {/* Filter */}
        <div className="flex gap-1 rounded-lg border border-gray-700 p-0.5">
          {(['all', 'active', 'disabled'] as const).map((filter) => (
            <button
              key={filter}
              type="button"
              onClick={() => setShowDisabled(filter)}
              className={`rounded px-3 py-1 text-xs font-medium transition ${
                showDisabled === filter
                  ? 'bg-neon-green/15 text-neon-green'
                  : 'text-text-muted hover:text-text-secondary'
              }`}
            >
              {filter === 'all' ? 'All' : filter === 'active' ? 'Active' : 'Disabled'}
            </button>
          ))}
        </div>
      </div>

      {!filteredKeys || filteredKeys.length === 0 ? (
        <EmptyState
          icon={
            <svg className="h-12 w-12 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
            </svg>
          }
          title="No keys found"
        />
      ) : (
        <div className="grid gap-3">
          {filteredKeys.map((key) => {
            const usagePct = key.limit > 0 ? (key.usage / key.limit) * 100 : 0;
            const barColor = usagePct > 90 ? 'red' : usagePct > 70 ? 'yellow' : 'green';

            return (
              <Link
                key={key.hash}
                to={`/keys/${key.hash}`}
                className="group rounded-lg border border-gray-800 bg-surface p-5 transition hover:border-gray-700 hover:bg-surface-raised"
              >
                <div className="flex items-start justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="mb-2 flex items-center gap-3">
                      <span className="truncate font-mono text-sm font-medium text-text-primary">
                        {key.name || truncateId(key.hash, 10)}
                      </span>
                      {key.disabled && (
                        <span className="rounded border border-gray-600 bg-gray-800 px-1.5 py-0.5 text-xs text-gray-400">
                          Disabled
                        </span>
                      )}
                    </div>

                    <div className="mb-3">
                      <ProgressBar
                        value={key.usage}
                        max={key.limit}
                        color={barColor}
                        size="sm"
                        showPercent
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-x-8 gap-y-1 sm:grid-cols-4">
                      <Field label="Usage">${key.usage.toFixed(2)}</Field>
                      <Field label="Limit">${key.limit.toFixed(2)}</Field>
                      <Field label="Daily">${key.usageDaily.toFixed(2)}</Field>
                      <Field label="Weekly">${key.usageWeekly.toFixed(2)}</Field>
                      <Field label="Monthly">${key.usageMonthly.toFixed(2)}</Field>
                      <Field label="Remaining">${key.limitRemaining.toFixed(2)}</Field>
                      <Field label="Created">{formatDate(key.createdAt)}</Field>
                      <Field label="Expires">{formatDate(key.expiresAt)}</Field>
                    </div>
                  </div>
                  <svg className="ml-3 h-5 w-5 flex-shrink-0 text-text-muted transition group-hover:text-text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </Link>
            );
          })}
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
