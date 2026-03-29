import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import type { UsageSnapshot } from '@/api/types';

interface UsageChartProps {
  snapshots: UsageSnapshot[];
  showDaily?: boolean;
  showWeekly?: boolean;
  showMonthly?: boolean;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

interface TooltipPayload {
  name: string;
  value: number;
  color: string;
}

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: TooltipPayload[]; label?: string }) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 text-text-muted">{label}</p>
      {payload.map((entry) => (
        <p key={entry.name} className="font-mono" style={{ color: entry.color }}>
          {entry.name}: ${entry.value.toFixed(2)}
        </p>
      ))}
    </div>
  );
}

export function UsageChart({
  snapshots,
  showDaily = true,
  showWeekly = false,
  showMonthly = false,
}: UsageChartProps) {
  // Snapshots come DESC by polled_at — reverse for left-to-right time progression
  const data = [...snapshots].reverse().map((s) => ({
    time: formatTime(s.polledAt),
    usage: s.usage,
    usageDaily: s.usageDaily,
    usageWeekly: s.usageWeekly,
    usageMonthly: s.usageMonthly,
    limit: s.limit,
    limitRemaining: s.limitRemaining,
  }));

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-gray-800 py-16">
        <p className="text-sm text-text-muted">No usage data available</p>
      </div>
    );
  }

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
          <XAxis
            dataKey="time"
            tick={{ fontSize: 10, fill: '#9ca3af' }}
            tickLine={false}
            axisLine={{ stroke: '#374151' }}
          />
          <YAxis
            tick={{ fontSize: 10, fill: '#9ca3af' }}
            tickLine={false}
            axisLine={{ stroke: '#374151' }}
            tickFormatter={(v: number) => `$${v}`}
          />
          <Tooltip content={<CustomTooltip />} />
          <Line
            type="monotone"
            dataKey="usage"
            name="Total Usage"
            stroke="#22c55e"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
          />
          {showDaily && (
            <Line
              type="monotone"
              dataKey="usageDaily"
              name="Daily"
              stroke="#3b82f6"
              strokeWidth={1.5}
              dot={false}
              strokeDasharray="5 5"
            />
          )}
          {showWeekly && (
            <Line
              type="monotone"
              dataKey="usageWeekly"
              name="Weekly"
              stroke="#f59e0b"
              strokeWidth={1.5}
              dot={false}
              strokeDasharray="5 5"
            />
          )}
          {showMonthly && (
            <Line
              type="monotone"
              dataKey="usageMonthly"
              name="Monthly"
              stroke="#a855f7"
              strokeWidth={1.5}
              dot={false}
              strokeDasharray="5 5"
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
