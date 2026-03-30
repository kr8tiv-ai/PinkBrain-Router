import type { AxiosInstance, AxiosError } from 'axios';
import axios from 'axios';
import pino from 'pino';

const logger = pino({ name: 'OpenRouterClient' });

const BASE_URL = 'https://openrouter.ai/api/v1';

export interface KeyData {
  hash: string;
  name: string;
  disabled: boolean;
  limit: number;
  limit_remaining: number;
  usage: number;
  usage_daily: number;
  usage_weekly: number;
  usage_monthly: number;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
}

export interface CreateKeyParams {
  name: string;
  limit: number;
  limit_reset?: string;
  expires_at?: string;
}

export interface UpdateKeyParams {
  limit?: number;
  disabled?: boolean;
}

export interface AccountCredits {
  total_credits: number;
  total_usage: number;
}

export interface CallData {
  deadline: string;
  fee_amount: string;
  id: string;
  operator: string;
  prefix: string;
  recipient: string;
  recipient_amount: string;
  recipient_currency: string;
  refund_destination: string;
  signature: string;
}

export interface TransferIntentMetadata {
  chain_id: number;
  contract_address: string;
  sender: string;
}

export interface TransferIntent {
  call_data: CallData;
  metadata: TransferIntentMetadata;
}

export interface Web3Data {
  transfer_intent: TransferIntent;
  metadata: Record<string, unknown>;
}

export interface CoinbaseChargeData {
  id: string;
  created_at: string;
  expires_at: string;
  web3_data: Web3Data;
}

export interface CreateCoinbaseChargeRequest {
  amount: number;
  sender: string;
  chain_id: number;
}

export interface CoinbaseChargeResponse {
  data: CoinbaseChargeData;
}

export class OpenRouterError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'OpenRouterError';
  }
}

export class OpenRouterClient {
  private readonly client: AxiosInstance;

  constructor(managementKey: string) {
    this.client = axios.create({
      baseURL: BASE_URL,
      timeout: 30_000,
      headers: {
        Authorization: `Bearer ${managementKey}`,
        'Content-Type': 'application/json',
      },
    });

    this.client.interceptors.response.use(
      (response) => response,
      (error: AxiosError<{ error?: { message?: string; code?: string } }>) => {
        const status = error.response?.status;
        const body = error.response?.data?.error;
        const message = body?.message ?? error.message;

        if (status === 401) {
          logger.error({ status }, 'OpenRouter management key is invalid');
          throw new OpenRouterError(
            message || 'Invalid management key',
            status,
            body?.code ?? 'INVALID_KEY',
          );
        }

        if (status === 404) {
          logger.warn({ status }, 'OpenRouter resource not found');
          throw new OpenRouterError(
            message || 'Resource not found',
            status,
            body?.code ?? 'NOT_FOUND',
          );
        }

        if (status === 429) {
          logger.warn({ status }, 'OpenRouter rate limit hit');
          throw new OpenRouterError(
            message || 'Rate limit exceeded',
            status,
            body?.code ?? 'RATE_LIMITED',
          );
        }

        if (status === 400) {
          logger.warn({ status, message }, 'OpenRouter invalid request');
          throw new OpenRouterError(
            message || 'Invalid request',
            status,
            body?.code ?? 'INVALID_REQUEST',
          );
        }

        if (status === 500) {
          logger.error({ status, message }, 'OpenRouter server error');
          throw new OpenRouterError(
            message || 'Internal server error',
            status,
            body?.code ?? 'SERVER_ERROR',
          );
        }

        return Promise.reject(error);
      },
    );
  }

  async createKey(
    params: CreateKeyParams,
  ): Promise<{ key: string; data: KeyData }> {
    logger.debug({ name: params.name, limit: params.limit }, 'Creating OpenRouter key');

    const response = await this.client.post<{ key: string; data: KeyData }>('/keys', params);

    logger.info({ hash: response.data.data.hash, name: params.name }, 'OpenRouter key created');
    return response.data;
  }

  async listKeys(): Promise<KeyData[]> {
    logger.debug('Listing OpenRouter keys');

    const response = await this.client.get<KeyData[]>('/keys');

    logger.info({ count: response.data.length }, 'Retrieved OpenRouter keys');
    return response.data;
  }

  async getKey(hash: string): Promise<KeyData> {
    logger.debug({ hash }, 'Getting OpenRouter key');

    const response = await this.client.get<KeyData>(`/keys/${hash}`);

    logger.debug({ hash, name: response.data.name }, 'Retrieved OpenRouter key');
    return response.data;
  }

  async updateKey(hash: string, params: UpdateKeyParams): Promise<KeyData> {
    logger.debug({ hash, params }, 'Updating OpenRouter key');

    const response = await this.client.patch<KeyData>(`/keys/${hash}`, params);

    logger.info({ hash }, 'OpenRouter key updated');
    return response.data;
  }

  async deleteKey(hash: string): Promise<void> {
    logger.debug({ hash }, 'Deleting OpenRouter key');

    await this.client.delete(`/keys/${hash}`);

    logger.info({ hash }, 'OpenRouter key deleted');
  }

  async getAccountCredits(): Promise<AccountCredits> {
    logger.debug('Fetching account credits');

    const response = await this.client.get<AccountCredits>('/auth/key');

    logger.info(
      { totalCredits: response.data.total_credits, totalUsage: response.data.total_usage },
      'Retrieved account credits',
    );
    return response.data;
  }

  async createCoinbaseCharge(
    params: CreateCoinbaseChargeRequest,
  ): Promise<CoinbaseChargeResponse> {
    logger.debug(
      { amount: params.amount, sender: params.sender, chainId: params.chain_id },
      'Creating Coinbase charge',
    );

    const response = await this.client.post<CoinbaseChargeResponse>('/credits/coinbase', params, {
      timeout: 300_000, // 5 minutes
    });

    const { id, expires_at } = response.data.data;
    logger.info({ chargeId: id, expiresAt: expires_at }, 'Coinbase charge created');
    return response.data;
  }
}
