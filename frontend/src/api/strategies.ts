import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Strategy, CreateStrategyPayload, UpdateStrategyPayload } from './types';
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

export function useUpdateStrategy(id: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: UpdateStrategyPayload) =>
      api.patch<Strategy>(`/strategies/${id}`, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['strategies'] });
      queryClient.invalidateQueries({ queryKey: ['strategies', id] });
    },
  });
}

export function useDeleteStrategy() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<{ deleted: boolean }>(`/strategies/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['strategies'] });
    },
  });
}

export function useEnableStrategy(id: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<Strategy>(`/strategies/${id}/enable`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['strategies'] });
      queryClient.invalidateQueries({ queryKey: ['strategies', id] });
    },
  });
}

export function useDisableStrategy(id: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<Strategy>(`/strategies/${id}/disable`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['strategies'] });
      queryClient.invalidateQueries({ queryKey: ['strategies', id] });
    },
  });
}
