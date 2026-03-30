import { useHealth } from '@/api';
import { LoadingSpinner, ErrorState } from '@/components/ui';
import { formatDateTime } from '@/lib/format';

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24) return `${hours}h ${remainingMinutes}m`;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return `${days}d ${remainingHours}h`;
}

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      className={`inline-block h-3 w-3 rounded-full ${
        ok ? 'bg-emerald-500' : 'bg-red-500'
      }`}
      title={ok ? 'Healthy' : 'Unhealthy'}
    />
  );
}

function DependencyCard({
  name,
  healthy,
}: {
  name: string;
  healthy: boolean;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-gray-800 bg-surface p-4">
      <span className="text-sm text-text-secondary">{name}</span>
      <div className="flex items-center gap-2">
        <StatusDot ok={healthy} />
        <span
          className={`text-xs font-medium ${
            healthy ? 'text-emerald-400' : 'text-red-400'
          }`}
        >
          {healthy ? 'Connected' : 'Disconnected'}
        </span>
      </div>
    </div>
  );
}

export default function HealthPage() {
  const { data: health, isLoading, error } = useHealth();

  if (isLoading) {
    return <LoadingSpinner />;
  }

  if (error || !health) {
    return <ErrorState title="Failed to load health status" message={(error as Error).message} />;
  }

  const allHealthy = health.status === 'ok' && health.dependencies.openrouter && health.dependencies.database;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-text-primary">System Health</h1>
          <p className="mt-1 text-sm text-text-secondary">
            Auto-refreshes every 30s
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusDot ok={allHealthy} />
          <span
            className={`text-sm font-semibold ${
              allHealthy ? 'text-emerald-400' : 'text-red-400'
            }`}
          >
            {allHealthy ? 'All Systems Operational' : 'Degraded'}
          </span>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Overall status */}
        <div className="rounded-lg border border-gray-800 bg-surface p-6">
          <h3 className="mb-4 text-sm font-medium text-text-secondary">Overview</h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs text-text-muted">Status</span>
              <div className="flex items-center gap-2">
                <StatusDot ok={health.status === 'ok'} />
                <span className="font-mono text-sm text-text-primary capitalize">{health.status}</span>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-text-muted">Uptime</span>
              <span className="font-mono text-sm text-text-primary">{formatUptime(health.uptime)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-text-muted">Response Time</span>
              <span className="font-mono text-sm text-text-primary">{health.responseTimeMs}ms</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-text-muted">Last Check</span>
              <span className="font-mono text-sm text-text-muted">{formatDateTime(health.timestamp)}</span>
            </div>
          </div>
        </div>

        {/* Dependencies */}
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-text-secondary">Dependencies</h3>
          <DependencyCard
            name="OpenRouter API"
            healthy={health.dependencies.openrouter}
          />
          <DependencyCard
            name="Database"
            healthy={health.dependencies.database}
          />
        </div>
      </div>
    </div>
  );
}
