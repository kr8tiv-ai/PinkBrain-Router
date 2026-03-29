import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Strategy, CreateStrategyPayload } from './types';
import { useApi } from './client';

export function useStrategies() {
  const api = useApi();
  return useQuery({
    queryKey: ['strategies'],
    queryFn: () => api.get<Strategy[]>('/strategies'),
  });
}

export function useStrategy(id: string | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: ['strategies', id],
    queryFn: () => api.get<Strategy>(`/strategies/${id}`),
    enabled: !!id,
  });
}

export function useCreateStrategy() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateStrategyPayload) =>
      api.post<Strategy>('/strategies', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['strategies'] });
    },
  });
}
