import { useQuery } from '@tanstack/react-query';
import { useApi } from './client';
import type { Stats } from './types';

/**
 * useStats fetches aggregate pipeline statistics from GET /stats.
 */
export function useStats() {
  const api = useApi();
  return useQuery({
    queryKey: ['stats'],
    queryFn: () => api.get<Stats>('/stats'),
    refetchInterval: 60_000,
  });
}
