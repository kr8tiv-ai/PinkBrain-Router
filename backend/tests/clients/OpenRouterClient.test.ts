import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import {
  OpenRouterClient,
  OpenRouterError,
} from '../../src/clients/OpenRouterClient.js';
import type { KeyData } from '../../src/clients/OpenRouterClient.js';

vi.mock('axios');
vi.mock('pino', () => ({
  default: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

const mockAxios = vi.mocked(axios, true);

const mockKeyData: KeyData = {
  hash: 'sk-or-v1-abc123def456',
  name: 'test-key-holder',
  disabled: false,
  limit: 10.0,
  limit_remaining: 7.5,
  usage: 2.5,
  usage_daily: 0.5,
  usage_weekly: 1.5,
  usage_monthly: 2.5,
  created_at: '2025-01-15T00:00:00Z',
  updated_at: '2025-01-20T12:00:00Z',
  expires_at: '2026-01-15T00:00:00Z',
};

function createMockClient(overrides: Record<string, any> = {}): ReturnType<typeof mockAxios.create> {
  return {
    get: vi.fn().mockResolvedValue({ data: null, headers: {} }),
    post: vi.fn().mockResolvedValue({ data: null, headers: {} }),
    patch: vi.fn().mockResolvedValue({ data: null, headers: {} }),
    delete: vi.fn().mockResolvedValue({ data: null, headers: {} }),
    interceptors: { response: { use: vi.fn() } },
    defaults: {},
    ...overrides,
  } as any;
}

describe('OpenRouterClient', () => {
  let client: OpenRouterClient;
  let mockInstance: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockInstance = createMockClient();
    mockAxios.create.mockReturnValue(mockInstance);
    client = new OpenRouterClient('test-management-key');
  });

  describe('constructor', () => {
    it('creates axios instance with correct auth header', () => {
      expect(mockAxios.create).toHaveBeenCalledWith(
        expect.objectContaining({
          baseURL: 'https://openrouter.ai/api/v1',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-management-key',
            'Content-Type': 'application/json',
          }),
        }),
      );
    });
  });

  describe('createKey', () => {
    it('posts to /keys and returns key + data', async () => {
      const created = { key: 'sk-or-live-newkey', data: mockKeyData };
      mockInstance.post.mockResolvedValue({ data: created });

      const result = await client.createKey({
        name: 'test-key-holder',
        limit: 10,
      });

      expect(mockInstance.post).toHaveBeenCalledWith('/keys', {
        name: 'test-key-holder',
        limit: 10,
      });
      expect(result.key).toBe('sk-or-live-newkey');
      expect(result.data.hash).toBe('sk-or-v1-abc123def456');
    });

    it('passes optional fields', async () => {
      mockInstance.post.mockResolvedValue({
        data: { key: 'sk-or-live-newkey', data: mockKeyData },
      });

      await client.createKey({
        name: 'test-key-holder',
        limit: 10,
        limit_reset: 'monthly',
        expires_at: '2026-01-15T00:00:00Z',
      });

      expect(mockInstance.post).toHaveBeenCalledWith('/keys', {
        name: 'test-key-holder',
        limit: 10,
        limit_reset: 'monthly',
        expires_at: '2026-01-15T00:00:00Z',
      });
    });
  });

  describe('listKeys', () => {
    it('gets /keys and returns array of key data', async () => {
      const keys = [mockKeyData, { ...mockKeyData, hash: 'sk-or-v1-other' }];
      mockInstance.get.mockResolvedValue({ data: keys });

      const result = await client.listKeys();

      expect(mockInstance.get).toHaveBeenCalledWith('/keys');
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('test-key-holder');
    });
  });

  describe('getKey', () => {
    it('gets /keys/:hash and returns key data', async () => {
      mockInstance.get.mockResolvedValue({ data: mockKeyData });

      const result = await client.getKey('sk-or-v1-abc123def456');

      expect(mockInstance.get).toHaveBeenCalledWith('/keys/sk-or-v1-abc123def456');
      expect(result.hash).toBe('sk-or-v1-abc123def456');
    });
  });

  describe('updateKey', () => {
    it('patches /keys/:hash with new limit', async () => {
      const updated = { ...mockKeyData, limit: 20 };
      mockInstance.patch.mockResolvedValue({ data: updated });

      const result = await client.updateKey('sk-or-v1-abc123def456', { limit: 20 });

      expect(mockInstance.patch).toHaveBeenCalledWith(
        '/keys/sk-or-v1-abc123def456',
        { limit: 20 },
      );
      expect(result.limit).toBe(20);
    });

    it('patches /keys/:hash to disable key', async () => {
      const updated = { ...mockKeyData, disabled: true };
      mockInstance.patch.mockResolvedValue({ data: updated });

      const result = await client.updateKey('sk-or-v1-abc123def456', { disabled: true });

      expect(mockInstance.patch).toHaveBeenCalledWith(
        '/keys/sk-or-v1-abc123def456',
        { disabled: true },
      );
      expect(result.disabled).toBe(true);
    });
  });

  describe('deleteKey', () => {
    it('deletes /keys/:hash', async () => {
      mockInstance.delete.mockResolvedValue({ data: null });

      await client.deleteKey('sk-or-v1-abc123def456');

      expect(mockInstance.delete).toHaveBeenCalledWith('/keys/sk-or-v1-abc123def456');
    });
  });

  describe('getAccountCredits', () => {
    it('gets /auth/key and returns credits', async () => {
      const credits = { total_credits: 100.0, total_usage: 42.5 };
      mockInstance.get.mockResolvedValue({ data: credits });

      const result = await client.getAccountCredits();

      expect(mockInstance.get).toHaveBeenCalledWith('/auth/key');
      expect(result.total_credits).toBe(100.0);
      expect(result.total_usage).toBe(42.5);
    });
  });

  describe('error handling', () => {
    function getErrorInterceptor(): (err: any) => Promise<any> {
      let interceptor: (err: any) => any;
      mockAxios.create.mockImplementation(() => ({
        ...createMockClient(),
        interceptors: {
          response: {
            use: (_success: any, error: any) => {
              interceptor = error;
            },
          },
        },
      }));
      client = new OpenRouterClient('test-key');
      return interceptor!;
    }

    it('rejects 401 with OpenRouterError INVALID_KEY', async () => {
      const interceptor = getErrorInterceptor();

      const axiosError = {
        response: {
          status: 401,
          data: { error: { message: 'Invalid API key', code: 'INVALID_KEY' } },
        },
        message: 'Request failed with status code 401',
        config: {},
      } as any;

      try {
        await interceptor(axiosError);
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(OpenRouterError);
        expect((err as OpenRouterError).status).toBe(401);
        expect((err as OpenRouterError).code).toBe('INVALID_KEY');
        expect((err as OpenRouterError).message).toBe('Invalid API key');
      }
    });

    it('rejects 404 with OpenRouterError NOT_FOUND', async () => {
      const interceptor = getErrorInterceptor();

      const axiosError = {
        response: {
          status: 404,
          data: { error: { message: 'Key not found' } },
        },
        message: 'Request failed with status code 404',
        config: {},
      } as any;

      try {
        await interceptor(axiosError);
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(OpenRouterError);
        expect((err as OpenRouterError).status).toBe(404);
        expect((err as OpenRouterError).code).toBe('NOT_FOUND');
      }
    });

    it('rejects 429 with OpenRouterError RATE_LIMITED', async () => {
      const interceptor = getErrorInterceptor();

      const axiosError = {
        response: {
          status: 429,
          data: { error: { message: 'Rate limit exceeded', code: 'RATE_LIMITED' } },
        },
        message: 'Request failed with status code 429',
        config: {},
      } as any;

      try {
        await interceptor(axiosError);
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(OpenRouterError);
        expect((err as OpenRouterError).status).toBe(429);
        expect((err as OpenRouterError).code).toBe('RATE_LIMITED');
      }
    });

    it('passes through non-handled errors', async () => {
      const interceptor = getErrorInterceptor();

      const axiosError = {
        response: {
          status: 500,
          data: { error: { message: 'Internal server error' } },
        },
        message: 'Request failed with status code 500',
        config: {},
      } as any;

      // 500 is not explicitly handled, so it should pass through as a rejected promise
      await expect(interceptor(axiosError)).rejects.toEqual(axiosError);
    });
  });
});
