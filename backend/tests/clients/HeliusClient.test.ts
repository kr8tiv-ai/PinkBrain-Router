import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HeliusClient } from '../../src/clients/HeliusClient.js';

vi.mock('pino', () => ({
  default: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

// Mock axios at module level
const mockPost = vi.fn();
vi.mock('axios', () => ({
  default: {
    create: vi.fn(() => ({
      post: mockPost,
      get: vi.fn(),
      interceptors: {
        response: {
          use: vi.fn((_fulfilled?: Function, _rejected?: Function) => {}),
        },
      },
      defaults: {},
    })),
  },
}));

const makeClient = () =>
  new HeliusClient({
    apiKey: 'test-key',
    rpcUrl: 'https://test.helius-rpc.com',
  });

/**
 * Helper: set up rate limit info so 429 backoff is minimal.
 */
const resetRateLimit = (client: HeliusClient) => {
  (client as unknown as { rateLimitInfo: { resetAt: number } }).rateLimitInfo.resetAt = Date.now() - 1000;
};

describe('HeliusClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getTokenHolders — compressed NFT happy path', () => {
    it('returns holders from compressed endpoint', async () => {
      mockPost.mockResolvedValueOnce({
        data: {
          jsonrpc: '2.0',
          result: {
            items: [
              { owner: 'WalletAaaaAaaaAaaaAaaaAaaaAaaaAaaaAaaaAaaa', amount: 2 },
              { owner: 'WalletBbbbBbbbBbbbBbbbBbbbBbbbBbbbBbbbBbbb', amount: 1 },
            ],
          },
        },
        headers: {},
      });

      const client = makeClient();
      const holders = await client.getTokenHolders('MintXYZ');

      expect(holders).toHaveLength(2);
      // Client lowercases wallet addresses
      expect(holders[0]).toEqual({ wallet: 'walletaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', tokenBalance: '2' });
      expect(holders[1]).toEqual({ wallet: 'walletbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', tokenBalance: '1' });

      // Should call compressed endpoint once
      expect(mockPost).toHaveBeenCalledTimes(1);
      expect(mockPost).toHaveBeenCalledWith(
        '/',
        expect.objectContaining({ method: 'getCompressedMintTokenHolders' }),
      );
    });

    it('filters out zero-balance compressed holders', async () => {
      mockPost.mockResolvedValueOnce({
        data: {
          result: {
            items: [
              { owner: 'WalletAaaaAaaaAaaaAaaaAaaaAaaaAaaaAaaaAaaa', amount: 0 },
              { owner: 'WalletBbbbBbbbBbbbBbbbBbbbBbbbBbbbBbbbBbbb', amount: 3 },
            ],
          },
        },
        headers: {},
      });

      const client = makeClient();
      const holders = await client.getTokenHolders('MintXYZ');

      expect(holders).toHaveLength(1);
      expect(holders[0].wallet).toBe('walletbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
    });

    it('filters out protocol addresses from compressed holders', async () => {
      mockPost.mockResolvedValueOnce({
        data: {
          result: {
            items: [
              { owner: '11111111111111111111111111111111', amount: 100 },
              { owner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', amount: 50 },
              { owner: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL', amount: 30 },
              { owner: '1nc1nerator11111111111111111111111111111111', amount: 10 },
              { owner: 'So11111111111111111111111111111111111111112', amount: 5 },
              { owner: 'RealWalletHere111111111111111111111111111', amount: 7 },
            ],
          },
        },
        headers: {},
      });

      const client = makeClient();
      const holders = await client.getTokenHolders('MintXYZ');

      expect(holders).toHaveLength(1);
      expect(holders[0].wallet).toBe('realwallethere111111111111111111111111111');
    });
  });

  describe('getTokenHolders — compressed error falls back to regular SPL', () => {
    it('falls back to getTokenAccounts when compressed returns error', async () => {
      // Compressed call retries 3 times (all fail), then catch catches the final throw
      // We use mockRejectedValue so all compressed calls fail
      mockPost.mockRejectedValue({ response: { status: 500 }, message: 'Server Error' });

      // After compressed exhausts retries, we need the regular call to succeed.
      // But mockRejectedValue applies to ALL calls, so we need to switch to resolved
      // after the 3 compressed attempts.
      // Actually, let's use sequential mocks:
      vi.clearAllMocks();
      // 3 compressed retry attempts (all fail)
      mockPost
        .mockRejectedValueOnce({ response: { status: 500 }, message: 'Server Error' })
        .mockRejectedValueOnce({ response: { status: 500 }, message: 'Server Error' })
        .mockRejectedValueOnce({ response: { status: 500 }, message: 'Server Error' })
        // Regular SPL succeeds
        .mockResolvedValueOnce({
          data: {
            result: {
              token_accounts: [
                { address: 'acc1', mint: 'MintXYZ', owner: 'WalletAaaaAaaaAaaaAaaaAaaaAaaaAaaaAaaaAaaa', amount: 1000, decimals: 6 },
                { address: 'acc2', mint: 'MintXYZ', owner: 'WalletBbbbBbbbBbbbBbbbBbbbBbbbBbbbBbbbBbbb', amount: 500, decimals: 6 },
              ],
            },
          },
          headers: {},
        });

      const client = makeClient();
      const holders = await client.getTokenHolders('MintXYZ');

      expect(holders).toHaveLength(2);
      expect(mockPost).toHaveBeenCalledTimes(4);
      // First call is compressed
      expect(mockPost).toHaveBeenNthCalledWith(
        1,
        '/',
        expect.objectContaining({ method: 'getCompressedMintTokenHolders' }),
      );
      // Fourth call is regular
      expect(mockPost).toHaveBeenNthCalledWith(
        4,
        '/',
        expect.objectContaining({ method: 'getTokenAccounts' }),
      );
    }, 15_000);

    it('falls back to getTokenAccounts when compressed returns empty', async () => {
      mockPost.mockResolvedValueOnce({
        data: { jsonrpc: '2.0', result: { items: [] } },
        headers: {},
      });

      mockPost.mockResolvedValueOnce({
        data: {
          result: {
            token_accounts: [
              { address: 'acc1', mint: 'MintXYZ', owner: 'WalletAaaaAaaaAaaaAaaaAaaaAaaaAaaaAaaaAaaa', amount: 100, decimals: 6 },
            ],
          },
        },
        headers: {},
      });

      const client = makeClient();
      const holders = await client.getTokenHolders('MintXYZ');

      expect(holders).toHaveLength(1);
      // Lowercased
      expect(holders[0].wallet).toBe('walletaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
      expect(mockPost).toHaveBeenCalledTimes(2);
    });
  });

  describe('getTokenHolders — regular SPL token accounts with pagination', () => {
    it('fetches multiple pages until result count is below limit', async () => {
      // Compressed returns empty
      mockPost.mockResolvedValueOnce({
        data: { jsonrpc: '2.0', result: { items: [] } },
        headers: {},
      });

      // Page 1 — full page (1000 accounts)
      const page1Accounts = Array.from({ length: 1000 }, (_, i) => ({
        address: `acc${i}`,
        mint: 'MintXYZ',
        owner: `Owner${i}Wallet${i.toString().padStart(30, '0')}`,
        amount: 100,
        decimals: 6,
      }));

      // Page 2 — partial page (200 accounts)
      const page2Accounts = Array.from({ length: 200 }, (_, i) => ({
        address: `acc${1000 + i}`,
        mint: 'MintXYZ',
        owner: `Owner2_${i}Wallet${i.toString().padStart(30, '0')}`,
        amount: 50,
        decimals: 6,
      }));

      mockPost.mockResolvedValueOnce({
        data: { result: { token_accounts: page1Accounts } },
        headers: {},
      });

      mockPost.mockResolvedValueOnce({
        data: { result: { token_accounts: page2Accounts } },
        headers: {},
      });

      const client = makeClient();
      const holders = await client.getTokenHolders('MintXYZ');

      // 1000 + 200 = 1200 holders
      expect(holders).toHaveLength(1200);

      // Compressed (1) + page 1 (1) + page 2 (1) = 3 calls
      expect(mockPost).toHaveBeenCalledTimes(3);

      // Verify page params
      expect(mockPost).toHaveBeenNthCalledWith(
        2,
        '/',
        expect.objectContaining({
          params: [{ mint: 'MintXYZ', page: 1, limit: 1000 }],
        }),
      );
      expect(mockPost).toHaveBeenNthCalledWith(
        3,
        '/',
        expect.objectContaining({
          params: [{ mint: 'MintXYZ', page: 2, limit: 1000 }],
        }),
      );
    });

    it('respects maxPages option', async () => {
      // Compressed returns empty
      mockPost.mockResolvedValueOnce({
        data: { jsonrpc: '2.0', result: { items: [] } },
        headers: {},
      });

      // Page 1 — 1000 unique owners
      const page1Accounts = Array.from({ length: 1000 }, (_, i) => ({
        address: `acc_p1_${i}`,
        mint: 'MintXYZ',
        owner: `Page1Owner_${i}`,
        amount: 100,
        decimals: 6,
      }));

      // Page 2 — 1000 unique owners (different from page 1)
      const page2Accounts = Array.from({ length: 1000 }, (_, i) => ({
        address: `acc_p2_${i}`,
        mint: 'MintXYZ',
        owner: `Page2Owner_${i}`,
        amount: 100,
        decimals: 6,
      }));

      // Page 1 returns full page
      mockPost.mockResolvedValueOnce({
        data: { result: { token_accounts: page1Accounts } },
        headers: {},
      });

      // Page 2 also returns full page (should stop because maxPages=2)
      mockPost.mockResolvedValueOnce({
        data: { result: { token_accounts: page2Accounts } },
        headers: {},
      });

      const client = makeClient();
      const holders = await client.getTokenHolders('MintXYZ', { maxPages: 2 });

      // Should stop at maxPages=2: 1000 + 1000 unique owners = 2000
      expect(holders).toHaveLength(2000);

      // Compressed (1) + page 1 (1) + page 2 (1) = 3 calls (no page 3)
      expect(mockPost).toHaveBeenCalledTimes(3);
    });

    it('filters zero-balance and protocol addresses in regular endpoint', async () => {
      // Compressed returns empty
      mockPost.mockResolvedValueOnce({
        data: { jsonrpc: '2.0', result: { items: [] } },
        headers: {},
      });

      mockPost.mockResolvedValueOnce({
        data: {
          result: {
            token_accounts: [
              { address: 'acc1', mint: 'MintXYZ', owner: '11111111111111111111111111111111', amount: 100, decimals: 6 },
              { address: 'acc2', mint: 'MintXYZ', owner: 'RealWallet1111111111111111111111111111111', amount: 0, decimals: 6 },
              { address: 'acc3', mint: 'MintXYZ', owner: 'RealWallet2222222222222222222222222222222', amount: 50, decimals: 6 },
            ],
          },
        },
        headers: {},
      });

      const client = makeClient();
      const holders = await client.getTokenHolders('MintXYZ');

      expect(holders).toHaveLength(1);
      expect(holders[0].wallet).toBe('realwallet2222222222222222222222222222222');
    });
  });

  describe('deduplication', () => {
    it('deduplicates same wallet across multiple accounts summing balances', async () => {
      mockPost.mockResolvedValueOnce({
        data: { jsonrpc: '2.0', result: { items: [] } },
        headers: {},
      });

      mockPost.mockResolvedValueOnce({
        data: {
          result: {
            token_accounts: [
              { address: 'acc1', mint: 'MintXYZ', owner: 'SameWallet', amount: 100, decimals: 6 },
              { address: 'acc2', mint: 'MintXYZ', owner: 'SameWallet', amount: 200, decimals: 6 },
              { address: 'acc3', mint: 'MintXYZ', owner: 'SameWallet', amount: 50, decimals: 6 },
              { address: 'acc4', mint: 'MintXYZ', owner: 'OtherWallet', amount: 300, decimals: 6 },
            ],
          },
        },
        headers: {},
      });

      const client = makeClient();
      const holders = await client.getTokenHolders('MintXYZ');

      expect(holders).toHaveLength(2);
      const sameWalletHolder = holders.find((h) => h.wallet === 'samewallet');
      expect(sameWalletHolder).toBeDefined();
      expect(sameWalletHolder!.tokenBalance).toBe('350');
      expect(holders.find((h) => h.wallet === 'otherwallet')!.tokenBalance).toBe('300');
    });

    it('deduplicates case-insensitively', async () => {
      mockPost.mockResolvedValueOnce({
        data: { jsonrpc: '2.0', result: { items: [] } },
        headers: {},
      });

      mockPost.mockResolvedValueOnce({
        data: {
          result: {
            token_accounts: [
              { address: 'acc1', mint: 'MintXYZ', owner: 'AbCWallet', amount: 100, decimals: 6 },
              { address: 'acc2', mint: 'MintXYZ', owner: 'abcWALLET', amount: 200, decimals: 6 },
            ],
          },
        },
        headers: {},
      });

      const client = makeClient();
      const holders = await client.getTokenHolders('MintXYZ');

      expect(holders).toHaveLength(1);
      expect(holders[0].tokenBalance).toBe('300');
    });
  });

  describe('empty results', () => {
    it('returns empty array when compressed and regular both return empty', async () => {
      mockPost.mockResolvedValueOnce({
        data: { jsonrpc: '2.0', result: { items: [] } },
        headers: {},
      });

      mockPost.mockResolvedValueOnce({
        data: { jsonrpc: '2.0', result: { token_accounts: [] } },
        headers: {},
      });

      const client = makeClient();
      const holders = await client.getTokenHolders('MintXYZ');

      expect(holders).toEqual([]);
    });

    it('returns empty array when compressed returns null result', async () => {
      mockPost.mockResolvedValueOnce({
        data: { jsonrpc: '2.0', result: null },
        headers: {},
      });

      mockPost.mockResolvedValueOnce({
        data: { jsonrpc: '2.0', result: { token_accounts: [] } },
        headers: {},
      });

      const client = makeClient();
      const holders = await client.getTokenHolders('MintXYZ');

      expect(holders).toEqual([]);
    });
  });

  describe('retry logic', () => {
    it('retries on 429 rate limit errors', async () => {
      // Compressed returns empty, regular SPL retries on 429
      mockPost.mockResolvedValueOnce({
        data: { jsonrpc: '2.0', result: { items: [] } },
        headers: {},
      });

      mockPost
        .mockRejectedValueOnce({ response: { status: 429 }, message: 'Too Many Requests' })
        .mockRejectedValueOnce({ response: { status: 429 }, message: 'Too Many Requests' })
        .mockResolvedValueOnce({
          data: {
            result: {
              token_accounts: [
                { address: 'acc1', mint: 'MintXYZ', owner: 'WalletA', amount: 100, decimals: 6 },
              ],
            },
          },
          headers: {},
        });

      const client = makeClient();
      resetRateLimit(client);

      const holders = await client.getTokenHolders('MintXYZ');

      expect(holders).toHaveLength(1);
      // Compressed (1) + 3 regular attempts = 4 calls total
      expect(mockPost).toHaveBeenCalledTimes(4);
    }, 15_000);

    it('retries on 5xx server errors', async () => {
      mockPost.mockResolvedValueOnce({
        data: { jsonrpc: '2.0', result: { items: [] } },
        headers: {},
      });

      mockPost
        .mockRejectedValueOnce({ response: { status: 500 }, message: 'Internal Server Error' })
        .mockRejectedValueOnce({ response: { status: 503 }, message: 'Service Unavailable' })
        .mockResolvedValueOnce({
          data: {
            result: {
              token_accounts: [
                { address: 'acc1', mint: 'MintXYZ', owner: 'WalletA', amount: 100, decimals: 6 },
              ],
            },
          },
          headers: {},
        });

      const client = makeClient();
      const holders = await client.getTokenHolders('MintXYZ');

      expect(holders).toHaveLength(1);
      expect(mockPost).toHaveBeenCalledTimes(4);
    }, 15_000);

    it('does not retry on 4xx client errors (non-429)', async () => {
      // Compressed returns empty
      mockPost.mockResolvedValueOnce({
        data: { jsonrpc: '2.0', result: { items: [] } },
        headers: {},
      });

      mockPost.mockRejectedValueOnce({ response: { status: 401 }, message: 'Unauthorized' });

      const client = makeClient();

      await expect(client.getTokenHolders('MintXYZ')).rejects.toEqual(
        expect.objectContaining({ response: { status: 401 } }),
      );

      // Compressed (1) + 1 regular = 2 calls total (no retry for 4xx)
      expect(mockPost).toHaveBeenCalledTimes(2);
    });

    it('does not retry on 400 bad request', async () => {
      mockPost.mockResolvedValueOnce({
        data: { jsonrpc: '2.0', result: { items: [] } },
        headers: {},
      });

      mockPost.mockRejectedValueOnce({ response: { status: 400 }, message: 'Bad Request' });

      const client = makeClient();

      await expect(client.getTokenHolders('MintXYZ')).rejects.toEqual(
        expect.objectContaining({ response: { status: 400 } }),
      );

      expect(mockPost).toHaveBeenCalledTimes(2);
    });

    it('throws after max retries exhausted', async () => {
      mockPost.mockResolvedValueOnce({
        data: { jsonrpc: '2.0', result: { items: [] } },
        headers: {},
      });

      // All regular calls fail with 500 — need 3 rejections
      mockPost
        .mockRejectedValueOnce({ response: { status: 500 }, message: 'Server Error' })
        .mockRejectedValueOnce({ response: { status: 500 }, message: 'Server Error' })
        .mockRejectedValueOnce({ response: { status: 500 }, message: 'Server Error' });

      const client = makeClient();

      await expect(client.getTokenHolders('MintXYZ')).rejects.toEqual(
        expect.objectContaining({ response: { status: 500 } }),
      );

      // Compressed (1) + 3 regular retries = 4 calls
      expect(mockPost).toHaveBeenCalledTimes(4);
    }, 15_000);
  });

  describe('API error handling', () => {
    it('throws with descriptive message on network error', async () => {
      // Compressed returns empty
      mockPost.mockResolvedValueOnce({
        data: { jsonrpc: '2.0', result: { items: [] } },
        headers: {},
      });

      // Network errors have no response.status, so they retry 3 times
      const networkError = new Error('ECONNREFUSED');
      mockPost
        .mockRejectedValueOnce(networkError)
        .mockRejectedValueOnce(networkError)
        .mockRejectedValueOnce(networkError);

      const client = makeClient();

      await expect(client.getTokenHolders('MintXYZ')).rejects.toThrow('ECONNREFUSED');
      // Compressed (1) + 3 regular retries = 4 calls
      expect(mockPost).toHaveBeenCalledTimes(4);
    }, 15_000);
  });

  describe('getRateLimitStatus', () => {
    it('returns initial rate limit info', () => {
      const client = makeClient();
      const status = client.getRateLimitStatus();
      expect(status.remaining).toBe(100);
      expect(status.resetAt).toBe(0);
    });
  });
});
