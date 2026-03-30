/**
 * Shared formatting utilities.
 * Single source of truth for USD, date/time, duration, and ID truncation formatters.
 */

export function formatUsd(val: number | null): string {
  if (val === null || val === undefined) return '—';
  return `$${val.toFixed(2)}`;
}

export function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function formatDuration(start: string, end: string | null): string {
  const ms = new Date(end ?? new Date().toISOString()).getTime() - new Date(start).getTime();
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

export function truncateId(id: string, chars = 8): string {
  if (id.length <= chars + 4 + 3) return id;
  return `${id.slice(0, chars)}...${id.slice(-4)}`;
}
