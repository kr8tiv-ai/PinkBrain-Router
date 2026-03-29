import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CoinbaseChargeService, CoinbaseChargeError } from '../src/services/CoinbaseChargeService.js';
import { CircuitBreaker } from '../src/clients/CircuitBreaker.js';
import type { OpenRouterClient } from '../src/clients/OpenRouterClient.js';

vi.mock('pino', () => ({
  default: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

function createMockOpenRouterClient(overrides: Partial<OpenRouterClient> = {}) {
  return {
    getAccountCredits: vi.fn().mockResolvedValue({ total_credits: 100, total_usage: 20 }),
    ...overrides,
  } as unknown as OpenRouterClient;
}

describe('CoinbaseChargeService', () => {
  describe('confirmFunding', () => {
    it('returns success with current credit balance when funding is confirmed', async () => {
      const mockClient = createMockOpenRouterClient({
        getAccountCredits: vi.fn().mockResolvedValue({ total_credits: 500, total_usage: 20 }),
      });
      const service = new CoinbaseChargeService(mockClient, false);

      const result = await service.confirmFunding('charge-run-123');

      expect(result.success).toBe(true);
      expect(result.chargeId).toBe('charge-run-123');
      expect(result.previousBalance).toBe(500);
      expect(result.newBalance).toBe(500);
      expect(mockClient.getAccountCredits).toHaveBeenCalled();
    });

    it('returns failure when getAccountCredits throws', async () => {
      const mockClient = createMockOpenRouterClient({
        getAccountCredits: vi.fn().mockRejectedValue(new Error('Network error')),
      });
      const service = new CoinbaseChargeService(mockClient, false);

      const result = await service.confirmFunding('charge-run-456');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Network error');
    });
  });

  describe('getCurrentCredits', () => {
    it('delegates to openRouterClient.getAccountCredits', async () => {
      const mockClient = createMockOpenRouterClient({
        getAccountCredits: vi.fn().mockResolvedValue({ total_credits: 1000, total_usage: 300 }),
      });
      const service = new CoinbaseChargeService(mockClient, false);

      const credits = await service.getCurrentCredits();

      expect(credits).toEqual({ total_credits: 1000, total_usage: 300 });
      expect(mockClient.getAccountCredits).toHaveBeenCalledTimes(1);
    });
  });

  describe('isAvailable', () => {
    it('returns true when circuit breaker is closed', () => {
      const mockClient = createMockOpenRouterClient();
      const service = new CoinbaseChargeService(mockClient, false);

      expect(service.isAvailable()).toBe(true);
    });

    it('returns false after 3 consecutive failures', async () => {
      const mockClient = createMockOpenRouterClient({
        getAccountCredits: vi.fn().mockRejectedValue(new Error('fail')),
      });
      const service = new CoinbaseChargeService(mockClient, false);

      // Trigger 3 failures to open the circuit breaker
      for (let i = 0; i < 3; i++) {
        await service.fund({ amountUsdc: 100, runId: `run-${i}`, strategyId: 's1' }).catch(() => {});
      }

      expect(service.isAvailable()).toBe(false);
    });
  });

  describe('fund (non-dry-run error paths)', () => {
    it('catches CoinbaseChargeError and returns failure', async () => {
      const mockClient = createMockOpenRouterClient({
        getAccountCredits: vi.fn().mockImplementation(() => {
          throw new CoinbaseChargeError('Insufficient funds', 'INSUFFICIENT_FUNDS', false);
        }),
      });
      const service = new CoinbaseChargeService(mockClient, false);

      const result = await service.fund({ amountUsdc: 100, runId: 'r1', strategyId: 's1' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Insufficient funds');
      expect(result.amountFunded).toBe(100);
    });

    it('catches unexpected errors and returns failure', async () => {
      const mockClient = createMockOpenRouterClient({
        getAccountCredits: vi.fn().mockRejectedValue(new Error('Something broke')),
      });
      const service = new CoinbaseChargeService(mockClient, false);

      const result = await service.fund({ amountUsdc: 200, runId: 'r2', strategyId: 's2' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Something broke');
      expect(result.previousBalance).toBe(0);
    });
  });
});
