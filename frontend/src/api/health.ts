import { useQuery } from '@tanstack/react-query';
import type { HealthResponse } from './types';
import { useAuth } from '../hooks/useAuth';

/**
 * useHealth fetches /health/ready directly (bypasses API_BASE) since the
 * backend serves health probes at /health/live and /health/ready without
 * the /api prefix. The Vite proxy forwards /health/* to the backend.
 */
export function useHealth() {
  const { token } = useAuth();
  return useQuery({
    queryKey: ['health'],
    queryFn: async (): Promise<HealthResponse> => {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      const res = await fetch('/health/ready', { headers });
      if (!res.ok) {
        throw new Error(`Health check failed: ${res.status}`);
      }
      return res.json();
    },
    refetchInterval: 30_000,
  });
}
