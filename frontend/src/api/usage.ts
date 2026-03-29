import { useQuery } from '@tanstack/react-query';
import type { UsageSnapshot } from './types';
import { useApi } from './client';

export function useUsageKey(keyHash: string | undefined, limit = 100) {
  const api = useApi();
  return useQuery({
    queryKey: ['usage', 'key', keyHash, limit],
    queryFn: () => api.get<UsageSnapshot[]>(`/usage/key/${keyHash}?limit=${limit}`),
    enabled: !!keyHash,
  });
}

export function useUsageStrategy(strategyId: string | undefined, limit = 100) {
  const api = useApi();
  return useQuery({
    queryKey: ['usage', 'strategy', strategyId, limit],
    queryFn: () =>
      api.get<UsageSnapshot[]>(`/usage/strategy/${strategyId}?limit=${limit}`),
    enabled: !!strategyId,
  });
}
