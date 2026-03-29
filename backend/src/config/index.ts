import { config } from 'dotenv';
import { resolve } from 'path';
import { z } from 'zod';

config({ path: resolve(process.cwd(), '.env') });

const DistributionModeSchema = z.enum([
  'OWNER_ONLY',
  'TOP_N_HOLDERS',
  'EQUAL_SPLIT',
  'WEIGHTED_BY_HOLDINGS',
  'CUSTOM_LIST',
]);

const KeyLimitResetSchema = z.enum(['daily', 'weekly', 'monthly']).nullable();

const configSchema = z.object({
  bagsApiKey: z.string().min(1, 'BAGS_API_KEY is required'),
  bagsApiBaseUrl: z.string().url().default('https://public-api-v2.bags.fm/api/v1'),
  
  heliusApiKey: z.string().min(1, 'HELIUS_API_KEY is required'),
  heliusRpcUrl: z.string().url(),
  
  solanaNetwork: z.enum(['mainnet-beta', 'devnet']).default('mainnet-beta'),
  
  openrouterManagementKey: z.string().min(1, 'OPENROUTER_MANAGEMENT_KEY is required'),
  
  evmPrivateKey: z.string().optional(),
  evmChainId: z.coerce.number().default(8453),
  
  apiAuthToken: z.string().min(1, 'API_AUTH_TOKEN is required'),
  port: z.coerce.number().default(3001),
  
  feeThresholdSol: z.coerce.number().min(1).max(100).default(5),
  feeSource: z.enum(['CLAIMABLE_POSITIONS', 'PARTNER_FEES']).default('CLAIMABLE_POSITIONS'),
  swapSlippageBps: z.coerce.number().min(0).max(1000).default(50),
  
  defaultKeyLimitUsd: z.coerce.number().min(1).default(10),
  keyLimitReset: KeyLimitResetSchema.default('monthly'),
  keyExpiryDays: z.coerce.number().min(0).default(365),
  creditPoolReservePct: z.coerce.number().min(0).max(50).default(10),
  
  distributionMode: DistributionModeSchema.default('TOP_N_HOLDERS'),
  distributionTopN: z.coerce.number().min(1).default(100),
  distributionTokenMint: z.string().optional(),
  
  cronExpression: z.string().default('0 */6 * * *'),
  minCronIntervalHours: z.coerce.number().min(1).default(1),
  
  dryRun: z.coerce.boolean().default(false),
  executionKillSwitch: z.coerce.boolean().default(false),
  maxDailyRuns: z.coerce.number().min(0).default(4),
  maxClaimableSolPerRun: z.coerce.number().min(0).default(100),
  
  signerPrivateKey: z.string().optional(),
  bagsAgentUsername: z.string().optional(),
  bagsAgentJwt: z.string().optional(),
  bagsAgentWalletAddress: z.string().optional(),
  
  databasePath: z.string().default('./data/creditbrain.db'),
  
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  nodeEnv: z.enum(['development', 'production', 'test']).default('development'),
});

export type Config = z.infer<typeof configSchema>;

function buildHeliusRpcUrl(apiKey: string | undefined): string {
  if (apiKey) {
    return `https://mainnet.helius-rpc.com/?api-key=${apiKey}`;
  }
  return 'https://api.mainnet-beta.solana.com';
}

function parseEnvValue(value: string | undefined): string | undefined {
  if (value === undefined || value === '' || value === '<from bags.fm/developers>' || 
      value === '<from helius.dev>' || value === '<from openrouter.ai dashboard>' ||
      value === '<bearer token for CreditBrain API routes>' || value === '<spl_token_mint>' ||
      value === '<base58_or_json>' || value === '<username>' || value === '<jwt>' ||
      value === '<pubkey>' || value === '<hex_private_key>') {
    return undefined;
  }
  return value;
}

export function loadConfig(): Config {
  const heliusApiKey = parseEnvValue(process.env.HELIUS_API_KEY);
  
  const rawConfig = {
    bagsApiKey: parseEnvValue(process.env.BAGS_API_KEY),
    bagsApiBaseUrl: process.env.BAGS_API_BASE_URL,
    heliusApiKey,
    heliusRpcUrl: buildHeliusRpcUrl(heliusApiKey),
    solanaNetwork: process.env.SOLANA_NETWORK,
    openrouterManagementKey: parseEnvValue(process.env.OPENROUTER_MANAGEMENT_KEY),
    evmPrivateKey: parseEnvValue(process.env.EVM_PRIVATE_KEY),
    evmChainId: process.env.EVM_CHAIN_ID,
    apiAuthToken: parseEnvValue(process.env.API_AUTH_TOKEN),
    port: process.env.PORT,
    feeThresholdSol: process.env.FEE_THRESHOLD_SOL,
    feeSource: process.env.FEE_SOURCE,
    swapSlippageBps: process.env.SWAP_SLIPPAGE_BPS,
    defaultKeyLimitUsd: process.env.DEFAULT_KEY_LIMIT_USD,
    keyLimitReset: process.env.KEY_LIMIT_RESET,
    keyExpiryDays: process.env.KEY_EXPIRY_DAYS,
    creditPoolReservePct: process.env.CREDIT_POOL_RESERVE_PCT,
    distributionMode: process.env.DISTRIBUTION_MODE,
    distributionTopN: process.env.DISTRIBUTION_TOP_N,
    distributionTokenMint: parseEnvValue(process.env.DISTRIBUTION_TOKEN_MINT),
    cronExpression: process.env.CRON_EXPRESSION,
    minCronIntervalHours: process.env.MIN_CRON_INTERVAL_HOURS,
    dryRun: process.env.DRY_RUN,
    executionKillSwitch: process.env.EXECUTION_KILL_SWITCH,
    maxDailyRuns: process.env.MAX_DAILY_RUNS,
    maxClaimableSolPerRun: process.env.MAX_CLAIMABLE_SOL_PER_RUN,
    signerPrivateKey: parseEnvValue(process.env.SIGNER_PRIVATE_KEY),
    bagsAgentUsername: parseEnvValue(process.env.BAGS_AGENT_USERNAME),
    bagsAgentJwt: parseEnvValue(process.env.BAGS_AGENT_JWT),
    bagsAgentWalletAddress: parseEnvValue(process.env.BAGS_AGENT_WALLET_ADDRESS),
    databasePath: process.env.DATABASE_PATH,
    logLevel: process.env.LOG_LEVEL,
    nodeEnv: process.env.NODE_ENV,
  };

  try {
    return configSchema.parse(rawConfig);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = error.issues.map(i => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
      throw new Error(`Configuration validation failed:\n${issues}`);
    }
    throw error;
  }
}

let _config: Config | null = null;

export function getConfig(): Config {
  if (!_config) {
    _config = loadConfig();
  }
  return _config;
}

export function resetConfig(): void {
  _config = null;
}
