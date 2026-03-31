import axios from 'axios';
import pino from 'pino';

const logger = pino({ name: 'BagsAgentService' });

export interface BagsAgentConfig {
  baseUrl: string;
}

export interface AgentAuthInitResponse {
  nonce: string;
  verificationMessage: string;
  expiresAt: string;
}

export interface AgentAuthLoginResponse {
  jwt: string;
  expiresAt: string;
  walletAddress: string;
}

export interface AgentDevKeyResponse {
  apiKey: string;
  keyId: string;
  prefix: string;
}

/**
 * Implements the Bags.fm 3-step Moltbook agent auth flow:
 * 1. POST /agent/auth/init  — get nonce + verification message
 * 2. Post verification message to social platform (manual step)
 * 3. POST /agent/auth/login — exchange verified nonce for JWT (365-day)
 *
 * After auth, the JWT can create dev API keys via /agent/dev/keys/create.
 */
export class BagsAgentService {
  private readonly client;

  constructor(private readonly config: BagsAgentConfig) {
    this.client = axios.create({
      baseURL: config.baseUrl,
      timeout: 30_000,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /** Step 1: Initialize agent auth */
  async initAuth(username: string): Promise<AgentAuthInitResponse> {
    logger.info({ username }, 'Initializing agent auth');

    const response = await this.client.post<AgentAuthInitResponse>(
      '/agent/auth/init',
      { username, platform: 'moltbook' },
    );

    logger.info(
      { username, expiresAt: response.data.expiresAt },
      'Agent auth initialized — post verification message to complete',
    );

    return response.data;
  }

  /** Step 3: Complete agent auth — returns JWT valid for 365 days */
  async login(username: string, nonce: string): Promise<AgentAuthLoginResponse> {
    logger.info({ username }, 'Completing agent auth login');

    const response = await this.client.post<AgentAuthLoginResponse>(
      '/agent/auth/login',
      { username, nonce, platform: 'moltbook' },
    );

    logger.info(
      { username, walletAddress: response.data.walletAddress, expiresAt: response.data.expiresAt },
      'Agent auth complete — JWT issued',
    );

    return response.data;
  }

  /** Create a dev API key using the agent JWT */
  async createDevKey(jwt: string, name: string): Promise<AgentDevKeyResponse> {
    logger.info({ name }, 'Creating agent dev key');

    const response = await this.client.post<AgentDevKeyResponse>(
      '/agent/dev/keys/create',
      { name },
      { headers: { Authorization: `Bearer ${jwt}` } },
    );

    logger.info(
      { keyId: response.data.keyId, prefix: response.data.prefix },
      'Agent dev key created',
    );

    return response.data;
  }

  /** Get the agent's wallet address from JWT */
  async getWallet(jwt: string): Promise<{ address: string; balance: number }> {
    const response = await this.client.get<{ address: string; balance: number }>(
      '/agent/wallet',
      { headers: { Authorization: `Bearer ${jwt}` } },
    );

    return response.data;
  }
}
