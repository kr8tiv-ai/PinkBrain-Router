import { useAuth } from '../hooks/useAuth';

const API_BASE = import.meta.env.VITE_API_URL ?? '/api';

export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly endpoint: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

/** Generic snake_case → camelCase converter for objects and arrays. */
function snakeToCamel<T>(obj: unknown): T {
  if (obj === null || obj === undefined) return obj as T;
  if (Array.isArray(obj)) return obj.map(snakeToCamel) as T;
  if (typeof obj === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      const camelKey = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
      out[camelKey] = snakeToCamel(value);
    }
    return out as T;
  }
  return obj as T;
}

export interface ApiClient {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  patch<T>(path: string, body?: unknown): Promise<T>;
  delete<T>(path: string, body?: unknown): Promise<T>;
}

/**
 * useApi returns a configured fetch wrapper that injects the auth token
 * and normalizes snake_case responses to camelCase.
 */
export function useApi(): ApiClient {
  const { token } = useAuth();

  async function request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${API_BASE}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      console.error(`[API] Network error: ${method} ${path}`, err);
      throw new ApiClientError(0, path, `Network error: ${String(err)}`);
    }

    if (!response.ok) {
      let detail = response.statusText;
      try {
        const json = await response.json();
        detail = json.error ?? json.message ?? detail;
      } catch {
        // non-JSON error body
      }
      console.error(`[API] ${response.status} ${method} ${path}: ${detail}`);
      throw new ApiClientError(response.status, path, `${response.status} ${method} ${path}: ${detail}`);
    }

    const json = await response.json();
    // Normalize snake_case responses to camelCase for consistent UI consumption
    return snakeToCamel<T>(json);
  }

  return {
    get: <T>(path: string) => request<T>('GET', path),
    post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
    patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
    delete: <T>(path: string, body?: unknown) => request<T>('DELETE', path, body),
  };
}
