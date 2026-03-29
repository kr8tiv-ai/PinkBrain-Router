import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('Config', () => {
  const envBackup: Record<string, string | undefined> = {};

  beforeEach(() => {
    // Snapshot and clear env vars
    for (const key of Object.keys(process.env)) {
      envBackup[key] = process.env[key];
    }
    // Delete config-related vars so tests start clean
    const configVars = [
      'BAGS_API_KEY', 'BAGS_API_BASE_URL', 'HELIUS_API_KEY', 'SOLANA_NETWORK',
      'OPENROUTER_MANAGEMENT_KEY', 'EVM_PRIVATE_KEY', 'EVM_CHAIN_ID',
      'API_AUTH_TOKEN', 'PORT', 'FEE_THRESHOLD_SOL', 'FEE_SOURCE',
      'SWAP_SLIPPAGE_BPS', 'DEFAULT_KEY_LIMIT_USD', 'KEY_LIMIT_RESET',
      'KEY_EXPIRY_DAYS', 'CREDIT_POOL_RESERVE_PCT', 'DISTRIBUTION_MODE',
      'DISTRIBUTION_TOP_N', 'DISTRIBUTION_TOKEN_MINT', 'CRON_EXPRESSION',
      'MIN_CRON_INTERVAL_HOURS', 'DRY_RUN', 'EXECUTION_KILL_SWITCH',
      'MAX_DAILY_RUNS', 'MAX_CLAIMABLE_SOL_PER_RUN', 'MAX_KEY_LIMIT_USD',
      'KEY_ROTATION_DAYS', 'USAGE_POLL_INTERVAL_MIN', 'SIGNER_PRIVATE_KEY',
      'BAGS_AGENT_USERNAME', 'BAGS_AGENT_JWT', 'BAGS_AGENT_WALLET_ADDRESS',
      'DATABASE_PATH', 'LOG_LEVEL', 'NODE_ENV',
    ];
    for (const key of configVars) {
      delete process.env[key];
    }

    // Reset config module cache
    vi.resetModules();
  });

  async function loadConfig() {
    const { loadConfig: fn, resetConfig } = await import('../src/config/index.js');
    resetConfig();
    return fn();
  }

  function setRequiredEnvVars(overrides: Record<string, string> = {}) {
    process.env.BAGS_API_KEY = overrides.BAGS_API_KEY ?? 'test-bags-key';
    process.env.HELIUS_API_KEY = overrides.HELIUS_API_KEY ?? 'test-helius-key';
    process.env.OPENROUTER_MANAGEMENT_KEY = overrides.OPENROUTER_MANAGEMENT_KEY ?? 'test-or-key';
    process.env.API_AUTH_TOKEN = overrides.API_AUTH_TOKEN ?? 'test-auth-token';
  }

  it('loadConfig() with all required vars set returns valid config', async () => {
    setRequiredEnvVars();
    const config = await loadConfig();

    expect(config.bagsApiKey).toBe('test-bags-key');
    expect(config.heliusApiKey).toBe('test-helius-key');
    expect(config.openrouterManagementKey).toBe('test-or-key');
    expect(config.apiAuthToken).toBe('test-auth-token');
  });

  it('loadConfig() throws on missing BAGS_API_KEY', async () => {
    setRequiredEnvVars();
    delete process.env.BAGS_API_KEY;

    await expect(loadConfig()).rejects.toThrow('Configuration validation failed');
  });

  it('loadConfig() throws on missing HELIUS_API_KEY', async () => {
    setRequiredEnvVars();
    delete process.env.HELIUS_API_KEY;

    await expect(loadConfig()).rejects.toThrow('Configuration validation failed');
  });

  it('loadConfig() throws on missing OPENROUTER_MANAGEMENT_KEY', async () => {
    setRequiredEnvVars();
    delete process.env.OPENROUTER_MANAGEMENT_KEY;

    await expect(loadConfig()).rejects.toThrow('Configuration validation failed');
  });

  it('loadConfig() throws on missing API_AUTH_TOKEN', async () => {
    setRequiredEnvVars();
    delete process.env.API_AUTH_TOKEN;

    await expect(loadConfig()).rejects.toThrow('Configuration validation failed');
  });

  it('loadConfig() applies defaults', async () => {
    setRequiredEnvVars();
    const config = await loadConfig();

    expect(config.port).toBe(3001);
    expect(config.dryRun).toBe(false);
    expect(config.feeThresholdSol).toBe(5);
    expect(config.solanaNetwork).toBe('mainnet-beta');
    expect(config.distributionMode).toBe('TOP_N_HOLDERS');
    expect(config.distributionTopN).toBe(100);
    expect(config.creditPoolReservePct).toBe(10);
    expect(config.logLevel).toBe('info');
    expect(config.nodeEnv).toBe('development');
    expect(config.distributionTokenMint).toBeUndefined();
  });

  it('loadConfig() rejects invalid types (e.g. port="abc")', async () => {
    setRequiredEnvVars();
    process.env.PORT = 'abc';

    await expect(loadConfig()).rejects.toThrow('Configuration validation failed');
  });
});
