import { useQuery } from '@tanstack/react-query';
import type { CreditPoolStatus } from './types';
import { useApi } from './client';

export function useCreditPool() {
  const api = useApi();
  return useQuery({
    queryKey: ['credit-pool'],
    queryFn: () => api.get<CreditPoolStatus>('/credit-pool'),
  });
}
