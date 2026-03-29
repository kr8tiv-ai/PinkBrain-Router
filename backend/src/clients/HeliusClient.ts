import type { AxiosInstance, AxiosError } from 'axios';
import axios from 'axios';
import pino from 'pino';

const logger = pino({ name: 'HeliusClient' });

/**
 * Well-known Solana program addresses that should never appear as holders.
 */
const PROTOCOL_ADDRESSES = new Set([
  '11111111111111111111111111111111',                       // System Program
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',           // Token Program
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',          // Associated Token Program
  'SysvarRent111111111111111111111111111111111',              // Rent sysvar
  '1nc1nerator11111111111111111111111111111111',             // Incinerator (burn)
  'So11111111111111111111111111111111111111112',             // Wrapped SOL mint
]);

export interface HeliusClientConfig {
  apiKey: string;
  rpcUrl: string;
  timeoutMs?: number;
}

export interface HolderRecord {
  wallet: string;
  tokenBalance: string;
}

interface HeliusRateLimitInfo {
  remaining: number;
  resetAt: number;
}

interface CompressedMintTokenHoldersParams {
  mint: string;
}

interface CompressedMintTokenHoldersResult {
  result?: {
    items?: Array<{
      owner: string;
      amount: number;
      delegation?: string;
    }>;
  };
}

interface GetTokenAccountsParams {
  mint: string;
  page?: number;
  limit?: number;
}

interface GetTokenAccountsResult {
  result?: {
    token_accounts?: Array<{
      address: string;
      mint: string;
      owner: string;
      amount: number;
      decimals: number;
    }>;
  };
}

export class HeliusClient {
  private readonly client: AxiosInstance;
  private rateLimitInfo: HeliusRateLimitInfo = {
    remaining: 100,
    resetAt: 0,
  };

  constructor(private readonly config: HeliusClientConfig) {
    this.client = axios.create({
      baseURL: config.rpcUrl,
      timeout: config.timeoutMs ?? 30_000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    this.client.interceptors.response.use(
      (response) => {
        const remaining = response.headers['x-ratelimit-remaining'];
        const resetAt = response.headers['x-ratelimit-reset'];
        if (remaining !== undefined) {
          this.rateLimitInfo.remaining = parseInt(remaining, 10);
        }
        if (resetAt !== undefined) {
          this.rateLimitInfo.resetAt = parseInt(resetAt, 10);
        }
        return response;
      },
      (error: AxiosError) => {
        if (error.response?.status === 429) {
          logger.warn(
            { remaining: this.rateLimitInfo.remaining, resetAt: this.rateLimitInfo.resetAt },
            'Helius API rate limit hit',
          );
        }
        return Promise.reject(error);
      },
    );
  }

  /**
   * Resolve token holders for a mint address.
   *
   * Tries compressed NFT endpoint first (single request, all holders).
   * Falls back to regular SPL token accounts (paginated at 1000).
   * Deduplicates by owner wallet, filters zero-balance and protocol addresses.
   */
  async getTokenHolders(
    mint: string,
    options?: { maxPages?: number },
  ): Promise<HolderRecord[]> {
    const startTime = Date.now();
    logger.info({ mint }, 'Resolving token holders');

    let holders: HolderRecord[];

    // Try compressed endpoint first
    try {
      holders = await this.fetchCompressedHolders(mint);
    } catch {
      logger.debug({ mint }, 'Compressed endpoint returned empty/error, trying regular SPL');
      holders = [];
    }

    // Fall back to regular SPL token accounts if compressed returned nothing
    if (holders.length === 0) {
      holders = await this.fetchRegularHolders(mint, options?.maxPages ?? 10);
    }

    // Deduplicate by wallet (sum balances), filter zero-balance and protocol addresses
    const deduped = this.deduplicateAndFilter(holders);

    const duration = Date.now() - startTime;
    logger.info(
      { mint, count: deduped.length, durationMs: duration },
      'Token holders resolved',
    );

    return deduped;
  }

  getRateLimitStatus(): HeliusRateLimitInfo {
    return { ...this.rateLimitInfo };
  }

  /**
   * Fetch holders via DAS compressed NFT endpoint.
   */
  private async fetchCompressedHolders(mint: string): Promise<HolderRecord[]> {
    const response = await this.executeWithRetry(async () => {
      return await this.client.post<CompressedMintTokenHoldersResult>('/', {
        jsonrpc: '2.0',
        id: 1,
        method: 'getCompressedMintTokenHolders',
        params: [{ mint }],
      });
    });

    const items = response.data?.result?.items;
    if (!items || items.length === 0) {
      return [];
    }

    return items
      .filter((item) => item.amount > 0)
      .filter((item) => !PROTOCOL_ADDRESSES.has(item.owner))
      .map((item) => ({
        wallet: item.owner,
        tokenBalance: String(item.amount),
      }));
  }

  /**
   * Fetch holders via DAS-enhanced getTokenAccounts endpoint (paginated).
   */
  private async fetchRegularHolders(
    mint: string,
    maxPages: number,
  ): Promise<HolderRecord[]> {
    const allHolders: HolderRecord[] = [];
    let page = 1;

    while (page <= maxPages) {
      const response = await this.executeWithRetry(async () => {
        return await this.client.post<GetTokenAccountsResult>('/', {
          jsonrpc: '2.0',
          id: 1,
          method: 'getTokenAccounts',
          params: [{ mint, page, limit: 1000 }],
        });
      });

      const accounts = response.data?.result?.token_accounts;
      if (!accounts || accounts.length === 0) {
        break;
      }

      for (const account of accounts) {
        if (account.amount > 0 && !PROTOCOL_ADDRESSES.has(account.owner)) {
          allHolders.push({
            wallet: account.owner,
            tokenBalance: String(account.amount),
          });
        }
      }

      // Less than a full page means we've reached the end
      if (accounts.length < 1000) {
        break;
      }

      page++;
    }

    return allHolders;
  }

  /**
   * Deduplicate by wallet address (sum balances across accounts).
   * Already filtered for zero-balance and protocol addresses in the
   * individual fetch methods, but this handles cross-source dedup
   * if compressed returned some and regular returned more.
   */
  private deduplicateAndFilter(holders: HolderRecord[]): HolderRecord[] {
    const walletMap = new Map<string, bigint>();

    for (const h of holders) {
      const key = h.wallet.toLowerCase();
      const existing = walletMap.get(key) ?? 0n;
      walletMap.set(key, existing + BigInt(h.tokenBalance));
    }

    return Array.from(walletMap.entries())
      .filter(([, balance]) => balance > 0n)
      .map(([wallet, balance]) => ({
        wallet,
        tokenBalance: balance.toString(),
      }));
  }

  /**
   * Execute a request with retry logic.
   * Retries on 429 (rate limit) and 5xx (server errors).
   * Does not retry on 4xx client errors (except 429).
   */
  private async executeWithRetry<T>(
    fn: () => Promise<T>,
    maxRetries = 3,
  ): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error as Error;
        const status = (error as AxiosError)?.response?.status;

        if (status === 429 && attempt < maxRetries - 1) {
          const resetAt = this.rateLimitInfo.resetAt;
          const waitMs = resetAt > Date.now() ? resetAt - Date.now() : 1000 * (attempt + 1);
          logger.warn(
            { attempt: attempt + 1, waitMs, remaining: this.rateLimitInfo.remaining },
            'Rate limited, backing off',
          );
          await this.sleep(waitMs);
          continue;
        }

        if (status && status >= 400 && status < 500) {
          // Client errors don't benefit from retry
          throw error;
        }

        if (attempt < maxRetries - 1) {
          logger.warn(
            { attempt: attempt + 1, error: lastError.message },
            'Request failed, retrying',
          );
          await this.sleep(1000 * (attempt + 1));
        }
      }
    }

    throw lastError;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
