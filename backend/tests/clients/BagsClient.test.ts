import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BagsClient } from '../../src/clients/BagsClient.js';
import type { ClaimablePosition, TradeQuote } from '../../src/types/index.js';

vi.mock('pino', () => ({
  default: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

const mockPosition: ClaimablePosition = {
  isCustomFeeVault: false,
  baseMint: 'So11111111111111111111111111111111111111112',
  isMigrated: true,
  totalClaimableLamportsUserShare: 5000000000,
  programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  quoteMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  virtualPool: 'vpool',
  virtualPoolAddress: '7xKpXq2oBkV4L7v7vYV7vYV7vYV7vYV7vYV7vYV7vY',
  virtualPoolClaimableAmount: 5000000000,
  virtualPoolClaimableLamportsUserShare: 5000000000,
  dammPoolClaimableAmount: 0,
  dammPoolClaimableLamportsUserShare: 0,
  dammPoolAddress: '',
  claimableDisplayAmount: 5.0,
  user: '7xKpXq2oBkV4L7v7vYV7vYV7vYV7vYV7vYV7vYV7vY',
  claimerIndex: 0,
  userBps: 10000,
  customFeeVault: '',
  customFeeVaultClaimerA: '',
  customFeeVaultClaimerB: '',
  customFeeVaultClaimerSide: 'A',
};

const mockQuote: TradeQuote = {
  requestId: 'req-123',
  contextSlot: 250000,
  inAmount: '5000000000',
  inputMint: 'So11111111111111111111111111111111111111112',
  outAmount: '300000000',
  outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  minOutAmount: '297000000',
  otherAmountThreshold: '297000000',
  priceImpactPct: '0.5',
  slippageBps: 50,
  routePlan: [],
  platformFee: { amount: '0', feeBps: 0, feeAccount: '', segmenterFeeAmount: '0', segmenterFeePct: 0 },
  outTransferFee: '0',
  simulatedComputeUnits: 200000,
};

// Mock axios at module level so axios.create() returns a fully structured mock
const mockGet = vi.fn();
const mockPost = vi.fn();
vi.mock('axios', () => {
  return {
    default: {
      create: vi.fn(() => ({
        get: mockGet,
        post: mockPost,
        interceptors: {
          response: {
            use: vi.fn((_fulfilled?: Function, _rejected?: Function) => {}),
          },
        },
        defaults: {},
      })),
    },
  };
});

describe('BagsClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getClaimablePositions', () => {
    it('returns claimable positions for a wallet', async () => {
      mockGet.mockResolvedValue({ data: [mockPosition], headers: {} });

      const client = new BagsClient({
        apiKey: 'test-key',
        baseUrl: 'https://test-api.bags.fm/api/v1',
      });

      const result = await client.getClaimablePositions('wallet123');
      expect(result).toHaveLength(1);
      expect(result[0].claimableDisplayAmount).toBe(5.0);
      expect(mockGet).toHaveBeenCalledWith(
        '/fees/claimable',
        expect.objectContaining({ params: { wallet: 'wallet123' } }),
      );
    });
  });

  describe('getTradeQuote', () => {
    it('returns a trade quote', async () => {
      mockGet.mockResolvedValue({ data: mockQuote, headers: {} });

      const client = new BagsClient({
        apiKey: 'test-key',
        baseUrl: 'https://test-api.bags.fm/api/v1',
      });

      const result = await client.getTradeQuote({
        inputMint: 'So11111111111111111111111111111111111111112',
        outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        amount: 5000000000,
      });

      expect(result.requestId).toBe('req-123');
      expect(result.outAmount).toBe('300000000');
    });
  });

  describe('getTotalClaimableSol', () => {
    it('aggregates total claimable lamports across positions', async () => {
      const twoPositions = [mockPosition, { ...mockPosition, totalClaimableLamportsUserShare: 3000000000 }];
      mockGet.mockResolvedValue({ data: twoPositions, headers: {} });

      const client = new BagsClient({
        apiKey: 'test-key',
        baseUrl: 'https://test-api.bags.fm/api/v1',
      });

      const result = await client.getTotalClaimableSol('wallet123');
      expect(result.totalLamports).toBe(8000000000n);
      expect(result.positions).toHaveLength(2);
    });
  });

  describe('getRateLimitStatus', () => {
    it('returns initial rate limit info', async () => {
      const client = new BagsClient({
        apiKey: 'test-key',
        baseUrl: 'https://test-api.bags.fm/api/v1',
      });

      const status = client.getRateLimitStatus();
      expect(status.remaining).toBe(100);
    });
  });

  describe('prepareSwap', () => {
    it('returns both quote and swap transaction', async () => {
      mockGet.mockResolvedValue({ data: mockQuote, headers: {} });
      mockPost.mockResolvedValue({
        data: {
          swapTransaction: 'base64-tx',
          computeUnitLimit: 200000,
          lastValidBlockHeight: 300000,
          prioritizationFeeLamports: 1000,
        },
        headers: {},
      });

      const client = new BagsClient({
        apiKey: 'test-key',
        baseUrl: 'https://test-api.bags.fm/api/v1',
      });

      const result = await client.prepareSwap({
        inputMint: 'So11111111111111111111111111111111111111112',
        outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        amount: 5000000000,
        userPublicKey: 'wallet123',
        slippageBps: 50,
      });

      expect(result.quote.requestId).toBe('req-123');
      expect(result.swapTx.swapTransaction).toBe('base64-tx');
    });

    it('throws when price impact exceeds max', async () => {
      const highImpactQuote = { ...mockQuote, priceImpactPct: '5.0' };
      mockGet.mockResolvedValue({ data: highImpactQuote, headers: {} });

      const client = new BagsClient({
        apiKey: 'test-key',
        baseUrl: 'https://test-api.bags.fm/api/v1',
      });

      await expect(
        client.prepareSwap({
          inputMint: 'So11111111111111111111111111111111111111112',
          outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          amount: 5000000000,
          userPublicKey: 'wallet123',
          maxPriceImpactBps: 300,
        }),
      ).rejects.toThrow('Price impact');
    });
  });
});
