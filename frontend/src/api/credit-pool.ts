import { useQuery } from '@tanstack/react-query';
import type { CreditPoolStatus } from './types';
import { useApi } from './client';

export interface PoolHistoryEntry {
  id: string;
  runId: string;
  amountUsd: number;
  createdAt: string;
}

export function useCreditPool() {
  const api = useApi();
  return useQuery({
    queryKey: ['credit-pool'],
    queryFn: () => api.get<CreditPoolStatus>('/credit-pool'),
  });
}

export function useCreditPoolHistory(limit?: number) {
  const api = useApi();
  return useQuery({
    queryKey: ['credit-pool', 'history', limit],
    queryFn: () =>
      api.get<PoolHistoryEntry[]>(
        `/credit-pool/history${limit ? `?limit=${limit}` : ''}`,
      ),
  });
}
