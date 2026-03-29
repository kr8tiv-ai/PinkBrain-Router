import { useQuery } from '@tanstack/react-query';
import type { HealthResponse } from './types';
import { useApi } from './client';

export function useHealth() {
  const api = useApi();
  return useQuery({
    queryKey: ['health'],
    queryFn: () => api.get<HealthResponse>('/health'),
    refetchInterval: 30_000,
  });
}
