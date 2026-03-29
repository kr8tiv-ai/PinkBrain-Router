import { useQuery } from '@tanstack/react-query';
import type { OpenRouterKey, UserKey } from './types';
import { useApi } from './client';

export function useKeys() {
  const api = useApi();
  return useQuery({
    queryKey: ['keys'],
    queryFn: () => api.get<OpenRouterKey[]>('/keys'),
  });
}

export function useKey(hash: string | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: ['keys', hash],
    queryFn: () => api.get<OpenRouterKey>(`/keys/${hash}`),
    enabled: !!hash,
  });
}

export function useStrategyKeys(strategyId: string | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: ['keys', 'strategy', strategyId],
    queryFn: () => api.get<UserKey[]>(`/keys/strategy/${strategyId}`),
    enabled: !!strategyId,
  });
}
