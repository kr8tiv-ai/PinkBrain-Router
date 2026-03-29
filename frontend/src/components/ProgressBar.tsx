interface ProgressBarProps {
  value: number;
  max: number;
  color?: 'green' | 'yellow' | 'red' | 'blue';
  size?: 'sm' | 'md' | 'lg';
  label?: string;
  showPercent?: boolean;
}

const COLOR_CLASSES = {
  green: 'bg-emerald-500',
  yellow: 'bg-amber-500',
  red: 'bg-red-500',
  blue: 'bg-blue-500',
};

const SIZE_CLASSES = {
  sm: 'h-1.5',
  md: 'h-2.5',
  lg: 'h-4',
};

export function ProgressBar({
  value,
  max,
  color = 'blue',
  size = 'md',
  label,
  showPercent = false,
}: ProgressBarProps) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  const pctDisplay = pct.toFixed(1);

  return (
    <div className="w-full">
      {(label || showPercent) && (
        <div className="mb-1 flex items-center justify-between">
          {label && <span className="text-xs text-text-muted">{label}</span>}
          {showPercent && (
            <span className="font-mono text-xs text-text-secondary">{pctDisplay}%</span>
          )}
        </div>
      )}
      <div className={`w-full rounded-full bg-gray-800 ${SIZE_CLASSES[size]}`}>
        <div
          className={`${SIZE_CLASSES[size]} rounded-full transition-all duration-300 ${COLOR_CLASSES[color]}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
