import type { AxiosInstance, AxiosError } from 'axios';
import axios from 'axios';
import pino from 'pino';
import type {
  BagsAdapter,
  BagsApiConfig,
  BagsRequestOptions,
  BagsRateLimitInfo,
  ClaimablePosition,
  TradeQuote,
  SwapTransaction,
  ClaimTransaction,
} from '../types/index.js';
import {
  parseClaimablePositions,
  parseClaimTransactions,
  parseTradeQuote,
  parseSwapTransaction,
} from './bags-schemas.js';

const logger = pino({ name: 'BagsClient' });

export class BagsClient implements BagsAdapter {
  private readonly client: AxiosInstance;
  private rateLimitInfo: BagsRateLimitInfo = {
    remaining: 100,
    resetAt: 0,
  };

  constructor(private readonly config: BagsApiConfig) {
    this.client = axios.create({
      baseURL: config.baseUrl,
      timeout: 30_000,
      headers: {
        'X-API-Key': config.apiKey,
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
            'Bags API rate limit hit',
          );
        }
        return Promise.reject(error);
      },
    );
  }

  async getClaimablePositions(
    wallet: string,
    options?: BagsRequestOptions,
  ): Promise<ClaimablePosition[]> {
    const priority = options?.priority ?? 'high';
    logger.debug({ wallet, priority }, 'Fetching claimable positions');

    const response = await this.executeWithRetry(async () => {
      const res = await this.client.get<ClaimablePosition[]>('/fees/claimable', {
        params: { wallet },
        headers: this.priorityHeader(priority),
      });
      return res;
    });

    const positions = parseClaimablePositions(response.data);
    logger.info(
      { wallet, count: positions.length },
      'Retrieved claimable positions',
    );
    return positions;
  }

  async getClaimTransactions(
    feeClaimer: string,
    position: ClaimablePosition,
    options?: BagsRequestOptions,
  ): Promise<ClaimTransaction[]> {
    const priority = options?.priority ?? 'high';
    logger.debug(
      { feeClaimer, virtualPool: position.virtualPoolAddress },
      'Fetching claim transactions',
    );

    const response = await this.executeWithRetry(async () => {
      const res = await this.client.post<ClaimTransaction[]>(
        '/fees/claim/transactions',
        {
          feeClaimer,
          position: {
            isCustomFeeVault: position.isCustomFeeVault,
            baseMint: position.baseMint,
            isMigrated: position.isMigrated,
            programId: position.programId,
            quoteMint: position.quoteMint,
            virtualPool: position.virtualPool,
            virtualPoolAddress: position.virtualPoolAddress,
            customFeeVault: position.customFeeVault,
            customFeeVaultClaimerA: position.customFeeVaultClaimerA,
            customFeeVaultClaimerB: position.customFeeVaultClaimerB,
            customFeeVaultClaimerSide: position.customFeeVaultClaimerSide,
          },
        },
        { headers: this.priorityHeader(priority) },
      );
      return res;
    });

    return parseClaimTransactions(response.data);
  }

  async getTradeQuote(
    params: {
      inputMint: string;
      outputMint: string;
      amount: number;
      slippageBps?: number;
    },
    options?: BagsRequestOptions,
  ): Promise<TradeQuote> {
    const priority = options?.priority ?? 'high';
    logger.debug(
      { inputMint: params.inputMint, outputMint: params.outputMint, amount: params.amount },
      'Fetching trade quote',
    );

    const response = await this.executeWithRetry(async () => {
      const res = await this.client.get<TradeQuote>('/trade/quote', {
        params: {
          inputMint: params.inputMint,
          outputMint: params.outputMint,
          amount: params.amount,
          slippageBps: params.slippageBps,
        },
        headers: this.priorityHeader(priority),
      });
      return res;
    });

    const quote = parseTradeQuote(response.data);
    logger.info(
      {
        inAmount: quote.inAmount,
        outAmount: quote.outAmount,
        priceImpactPct: quote.priceImpactPct,
      },
      'Received trade quote',
    );
    return quote;
  }

  async createSwapTransaction(
    quoteResponse: TradeQuote,
    userPublicKey: string,
    options?: BagsRequestOptions,
  ): Promise<SwapTransaction> {
    const priority = options?.priority ?? 'high';
    logger.debug(
      { requestId: quoteResponse.requestId, userPublicKey },
      'Creating swap transaction',
    );

    const response = await this.executeWithRetry(async () => {
      const res = await this.client.post<SwapTransaction>(
        '/trade/swap',
        { quoteResponse, userPublicKey },
        { headers: this.priorityHeader(priority) },
      );
      return res;
    });

    const swapTx = parseSwapTransaction(response.data);
    logger.info(
      {
        requestId: quoteResponse.requestId,
        computeUnits: swapTx.computeUnitLimit,
      },
      'Swap transaction created',
    );
    return swapTx;
  }

  async prepareSwap(
    params: {
      inputMint: string;
      outputMint: string;
      amount: number;
      userPublicKey: string;
      slippageBps?: number;
      maxPriceImpactBps?: number;
    },
    options?: BagsRequestOptions,
  ): Promise<{ quote: TradeQuote; swapTx: SwapTransaction }> {
    const quote = await this.getTradeQuote(
      {
        inputMint: params.inputMint,
        outputMint: params.outputMint,
        amount: params.amount,
        slippageBps: params.slippageBps,
      },
      options,
    );

    if (
      params.maxPriceImpactBps !== undefined &&
      parseFloat(quote.priceImpactPct) * 100 > params.maxPriceImpactBps
    ) {
      throw new Error(
        `Price impact ${(parseFloat(quote.priceImpactPct) * 100).toFixed(2)} bps exceeds max ${params.maxPriceImpactBps} bps`,
      );
    }

    const swapTx = await this.createSwapTransaction(quote, params.userPublicKey, options);
    return { quote, swapTx };
  }

  async getTotalClaimableSol(
    wallet: string,
    options?: BagsRequestOptions,
  ): Promise<{ totalLamports: bigint; positions: ClaimablePosition[] }> {
    const positions = await this.getClaimablePositions(wallet, options);
    const totalLamports = positions.reduce(
      (sum, pos) => sum + BigInt(pos.totalClaimableLamportsUserShare),
      0n,
    );
    return { totalLamports, positions };
  }

  getRateLimitStatus(): BagsRateLimitInfo {
    return { ...this.rateLimitInfo };
  }

  private priorityHeader(priority: BagsRequestOptions['priority']): Record<string, string> {
    return priority ? { 'X-Priority': priority } : {};
  }

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
