import { PublicKey, type Connection } from '@solana/web3.js';
import { BagsSDK } from '@bagsfm/bags-sdk';
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

const logger = pino({ name: 'BagsSdkAdapter' });

/**
 * BagsAdapter implementation backed by the official @bagsfm/bags-sdk.
 *
 * Translates between SDK types (PublicKey, VersionedTransaction) and our
 * domain types (string addresses, base64/base58 encoded transactions).
 *
 * Advantages over raw axios BagsClient:
 *  - Uses SDK-maintained HTTP client with built-in error handling
 *  - Automatic SDK updates when Bags API changes
 *  - Access to Jito bundle support via sdk.solana.sendBundle()
 *  - Consistent type system with Bags ecosystem
 */
export class BagsSdkAdapter implements BagsAdapter {
  private readonly sdk: BagsSDK;
  private rateLimitInfo: BagsRateLimitInfo = { remaining: 100, resetAt: 0 };

  constructor(
    private readonly config: BagsApiConfig,
    connection: Connection,
  ) {
    this.sdk = new BagsSDK(config.apiKey, connection);
    logger.info('BagsSdkAdapter initialized with official SDK');
  }

  /** Expose the underlying SDK for direct access (e.g., Jito bundles). */
  getSdk(): BagsSDK {
    return this.sdk;
  }

  async getClaimablePositions(
    wallet: string,
    _options?: BagsRequestOptions,
  ): Promise<ClaimablePosition[]> {
    logger.debug({ wallet }, 'Fetching claimable positions via SDK');

    const pubkey = new PublicKey(wallet);
    const sdkPositions = await this.sdk.fee.getAllClaimablePositions(pubkey);

    // Map SDK positions to our domain type
    const positions: ClaimablePosition[] = sdkPositions.map((pos: Record<string, unknown>) =>
      mapSdkPosition(pos),
    );

    logger.info(
      { wallet, count: positions.length },
      'Retrieved claimable positions via SDK',
    );
    return positions;
  }

  async getClaimTransactions(
    feeClaimer: string,
    position: ClaimablePosition,
    _options?: BagsRequestOptions,
  ): Promise<ClaimTransaction[]> {
    logger.debug(
      { feeClaimer, virtualPool: position.virtualPoolAddress },
      'Fetching claim transactions via SDK',
    );

    const wallet = new PublicKey(feeClaimer);
    const tokenMint = new PublicKey(position.baseMint);

    const sdkTransactions = await this.sdk.fee.getClaimTransactions(
      wallet,
      tokenMint,
    );

    // SDK returns Transaction objects; serialize back to our ClaimTransaction format
    const claimTxs: ClaimTransaction[] = sdkTransactions.map((tx) => {
      const serialized = tx.serialize();
      // Use base58 encoding for claim transactions (Bags.fm convention)
      const encoded = Buffer.from(serialized).toString('base64');
      // We need to extract blockhash from the transaction message
      const message = tx.compileMessage();
      return {
        tx: encoded,
        blockhash: {
          blockhash: message.recentBlockhash,
          lastValidBlockHeight: 0, // SDK doesn't expose this directly
        },
      };
    });

    return claimTxs;
  }

  async getTradeQuote(
    params: {
      inputMint: string;
      outputMint: string;
      amount: number;
      slippageBps?: number;
    },
    _options?: BagsRequestOptions,
  ): Promise<TradeQuote> {
    logger.debug(
      {
        inputMint: params.inputMint,
        outputMint: params.outputMint,
        amount: params.amount,
      },
      'Fetching trade quote via SDK',
    );

    const sdkQuote = await this.sdk.trade.getQuote({
      inputMint: new PublicKey(params.inputMint),
      outputMint: new PublicKey(params.outputMint),
      amount: params.amount,
      slippageBps: params.slippageBps,
    });

    // Map SDK response to our TradeQuote type
    const quote: TradeQuote = {
      requestId: sdkQuote.requestId,
      contextSlot: sdkQuote.contextSlot,
      inAmount: sdkQuote.inAmount,
      inputMint: sdkQuote.inputMint,
      outAmount: sdkQuote.outAmount,
      outputMint: sdkQuote.outputMint,
      minOutAmount: sdkQuote.minOutAmount,
      otherAmountThreshold: sdkQuote.minOutAmount, // SDK maps this
      priceImpactPct: sdkQuote.priceImpactPct,
      slippageBps: sdkQuote.slippageBps,
      routePlan: sdkQuote.routePlan?.map((leg) => ({
        venue: String(leg.venue ?? ''),
        inAmount: String(leg.inAmount ?? ''),
        outAmount: String(leg.outAmount ?? ''),
        inputMint: String(leg.inputMint ?? ''),
        outputMint: String(leg.outputMint ?? ''),
        inputMintDecimals: Number(leg.inputMintDecimals ?? 0),
        outputMintDecimals: Number(leg.outputMintDecimals ?? 0),
        marketKey: String(leg.marketKey ?? ''),
        data: String(leg.data ?? ''),
      })) ?? [],
      platformFee: {
        amount: String(sdkQuote.platformFee?.amount ?? '0'),
        feeBps: Number(sdkQuote.platformFee?.feeBps ?? 0),
        feeAccount: String(sdkQuote.platformFee?.feeAccount ?? ''),
        segmenterFeeAmount: String(sdkQuote.platformFee?.segmenterFeeAmount ?? '0'),
        segmenterFeePct: Number(sdkQuote.platformFee?.segmenterFeePct ?? 0),
      },
      outTransferFee: sdkQuote.outTransferFee ?? '0',
      simulatedComputeUnits: sdkQuote.simulatedComputeUnits ?? 0,
    };

    logger.info(
      {
        inAmount: quote.inAmount,
        outAmount: quote.outAmount,
        priceImpactPct: quote.priceImpactPct,
      },
      'Received trade quote via SDK',
    );
    return quote;
  }

  async createSwapTransaction(
    quoteResponse: TradeQuote,
    userPublicKey: string,
    _options?: BagsRequestOptions,
  ): Promise<SwapTransaction> {
    logger.debug(
      { requestId: quoteResponse.requestId, userPublicKey },
      'Creating swap transaction via SDK',
    );

    const sdkResult = await this.sdk.trade.createSwapTransaction({
      quoteResponse: quoteResponse as unknown as Parameters<typeof this.sdk.trade.createSwapTransaction>[0]['quoteResponse'],
      userPublicKey: new PublicKey(userPublicKey),
    });

    // SDK returns VersionedTransaction object; serialize to base64 for our interface
    const serialized = sdkResult.transaction.serialize();
    const swapTx: SwapTransaction = {
      swapTransaction: Buffer.from(serialized).toString('base64'),
      computeUnitLimit: sdkResult.computeUnitLimit,
      lastValidBlockHeight: sdkResult.lastValidBlockHeight,
      prioritizationFeeLamports: sdkResult.prioritizationFeeLamports,
    };

    logger.info(
      {
        requestId: quoteResponse.requestId,
        computeUnits: swapTx.computeUnitLimit,
      },
      'Swap transaction created via SDK',
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

    const swapTx = await this.createSwapTransaction(
      quote,
      params.userPublicKey,
      options,
    );
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
}

/**
 * Map an SDK BagsClaimablePosition to our ClaimablePosition domain type.
 * The SDK returns union types; we normalize to a flat structure.
 */
function mapSdkPosition(pos: Record<string, unknown>): ClaimablePosition {
  return {
    isCustomFeeVault: (pos.isCustomFeeVault as boolean) ?? false,
    baseMint: String(pos.baseMint ?? ''),
    isMigrated: (pos.isMigrated as boolean) ?? false,
    totalClaimableLamportsUserShare:
      (pos.totalClaimableLamportsUserShare as number) ?? 0,
    programId: String(pos.programId ?? ''),
    quoteMint: String(pos.quoteMint ?? ''),
    virtualPool: String(pos.virtualPool ?? ''),
    virtualPoolAddress: String(pos.virtualPoolAddress ?? ''),
    virtualPoolClaimableAmount:
      (pos.virtualPoolClaimableAmount as number) ?? 0,
    virtualPoolClaimableLamportsUserShare:
      (pos.virtualPoolClaimableLamportsUserShare as number) ?? 0,
    dammPoolClaimableAmount: (pos.dammPoolClaimableAmount as number) ?? 0,
    dammPoolClaimableLamportsUserShare:
      (pos.dammPoolClaimableLamportsUserShare as number) ?? 0,
    dammPoolAddress: String(pos.dammPoolAddress ?? ''),
    dammPositionInfo: pos.dammPositionInfo as ClaimablePosition['dammPositionInfo'],
    claimableDisplayAmount: (pos.claimableDisplayAmount as number) ?? 0,
    user: String(pos.user ?? ''),
    claimerIndex: (pos.claimerIndex as number) ?? 0,
    userBps: (pos.userBps as number) ?? 0,
    customFeeVault: String(pos.customFeeVault ?? ''),
    customFeeVaultClaimerA: String(pos.customFeeVaultClaimerA ?? ''),
    customFeeVaultClaimerB: String(pos.customFeeVaultClaimerB ?? ''),
    customFeeVaultClaimerSide:
      (pos.customFeeVaultClaimerSide as 'A' | 'B') ?? 'A',
  };
}
