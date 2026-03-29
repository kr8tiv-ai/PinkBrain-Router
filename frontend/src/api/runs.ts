import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { CreditRun } from './types';
import { useApi } from './client';

export function useRun(id: string | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: ['runs', id],
    queryFn: () => api.get<CreditRun>(`/runs/${id}`),
    enabled: !!id,
  });
}

export function useRuns(strategyId: string | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: ['runs', 'strategy', strategyId],
    queryFn: () => api.get<CreditRun[]>(`/runs/strategy/${strategyId}`),
    enabled: !!strategyId,
  });
}

export function useTriggerRun() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (strategyId: string) =>
      api.post<CreditRun>('/runs', { strategyId }),
    onSuccess: (_data, strategyId) => {
      queryClient.invalidateQueries({ queryKey: ['runs'] });
      queryClient.invalidateQueries({ queryKey: ['strategies', strategyId] });
      queryClient.invalidateQueries({ queryKey: ['strategies'] });
    },
  });
}

export function useResumeRun() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (runId: string) =>
      api.post<CreditRun>(`/runs/${runId}/resume`),
    onSuccess: (_data, runId) => {
      queryClient.invalidateQueries({ queryKey: ['runs', runId] });
      queryClient.invalidateQueries({ queryKey: ['runs'] });
    },
  });
}
