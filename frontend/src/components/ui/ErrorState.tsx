import { Link } from 'react-router';

export function ErrorState({
  title,
  message,
  onRetry,
  backTo,
  backLabel,
}: {
  title: string;
  message: string;
  onRetry?: () => void;
  backTo?: string;
  backLabel?: string;
}) {
  return (
    <div className="rounded-lg border border-red-500/30 bg-surface p-6">
      <h2 className="mb-2 text-sm font-semibold text-red-400">{title}</h2>
      <p className="font-mono text-xs text-text-muted">{message}</p>
      {(onRetry || backTo) && (
        <div className="mt-3 flex items-center gap-3">
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="text-xs text-neon-green transition hover:brightness-110"
            >
              Retry
            </button>
          )}
          {backTo && (
            <Link
              to={backTo}
              className="text-xs text-neon-green transition hover:brightness-110"
            >
              &larr; {backLabel ?? `Back`}
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
