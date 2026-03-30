import pino from 'pino';
import { Connection, Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { Database } from './services/Database.js';
import { StrategyService } from './services/StrategyService.js';
import { RunService } from './services/RunService.js';
import { AuditService } from './services/AuditService.js';
import { KeyManagerService } from './services/KeyManagerService.js';
import { CreditPoolService } from './services/CreditPoolService.js';
import { UsageTrackingService } from './services/UsageTrackingService.js';
import { OpenRouterClient } from './clients/OpenRouterClient.js';
import { BagsClient } from './clients/BagsClient.js';
import { HeliusClient } from './clients/HeliusClient.js';
import { DistributionService } from './services/DistributionService.js';
import { createSignAndSendClaim } from './engine/signAndSendClaim.js';
import { createSignAndSendSwap } from './engine/signAndSendSwap.js';
import { ExecutionPolicy } from './engine/ExecutionPolicy.js';
import { StateMachine } from './engine/StateMachine.js';
import { RunLock } from './engine/RunLock.js';
import { createPhaseHandlerMap } from './engine/phases/index.js';
import { SchedulerService } from './services/SchedulerService.js';
import { CctpBridgeService } from './services/CctpBridgeService.js';
import { CoinbaseChargeService } from './services/CoinbaseChargeService.js';
import { BridgeKitClient } from './clients/BridgeKitClient.js';
import { EvmPaymentExecutor } from './clients/EvmPaymentExecutor.js';
import { buildApp } from './server.js';
import { getConfig } from './config/index.js';

const logger = pino({ name: 'creditbrain-server' });

async function main() {
  logger.info('Starting CreditBrain server...');

  const config = getConfig();

  // Database
  const db = new Database({ dbPath: config.databasePath });
  db.init();
  const dbConn = db.getDb();
  logger.info({ path: config.databasePath }, 'Database initialized');

  // Services
  const orClient = new OpenRouterClient(config.openrouterManagementKey);

  const strategyService = new StrategyService(dbConn);
  const runService = new RunService(dbConn);
  const auditService = new AuditService(dbConn);
  const keyManagerService = new KeyManagerService({ openRouterClient: orClient, db: dbConn });
  const creditPoolService = new CreditPoolService(orClient, dbConn, config.creditPoolReservePct);
  const usageTrackingService = new UsageTrackingService(orClient, dbConn);

  // Execution policy with DB persistence
  const executionPolicy = new ExecutionPolicy(config, dbConn);

  // Engine
  const runLock = new RunLock();

  // Helius client for holder resolution
  const heliusClient = new HeliusClient({
    apiKey: config.heliusApiKey,
    rpcUrl: config.heliusRpcUrl,
  });

  // Distribution service for allocate phase
  const distributionService = new DistributionService({
    db: dbConn,
    creditPoolService,
  });

  // Claim phase dependencies: Solana connection, signer keypair, Bags.fm client
  const connection = new Connection(config.heliusRpcUrl);
  const claimKeypair = config.signerPrivateKey
    ? Keypair.fromSecretKey(bs58.decode(config.signerPrivateKey))
    : null;

  const bagsClient = new BagsClient({
    apiKey: config.bagsApiKey,
    baseUrl: config.bagsApiBaseUrl,
  });

  const signAndSendClaim = claimKeypair
    ? createSignAndSendClaim(connection, claimKeypair)
    : () => Promise.reject(new Error('No signer configured — set SIGNER_PRIVATE_KEY for live claiming'));

  const signAndSendSwap = claimKeypair
    ? createSignAndSendSwap(connection, claimKeypair)
    : () => Promise.reject(new Error('No signer configured — set SIGNER_PRIVATE_KEY for live swapping'));

  // ── Bridge phase ─────────────────────────────────────────────
  // Requires both Solana signer (for burn) and EVM key (for mint on Base).
  // Falls back to stub when either key is missing.
  const evmPrivateKey = config.evmPrivateKey;
  let bridgeDeps: { bridgeService: CctpBridgeService } | undefined;
  if (config.signerPrivateKey && evmPrivateKey) {
    const bridgeKitClient = new BridgeKitClient({
      solanaRpcUrl: config.heliusRpcUrl,
      solanaPrivateKey: config.signerPrivateKey,
      evmPrivateKey: evmPrivateKey,
    });
    const cctpBridgeService = new CctpBridgeService(bridgeKitClient);
    bridgeDeps = { bridgeService: cctpBridgeService, dryRun: config.dryRun };
    logger.info('Bridge phase: using real CctpBridgeService (Bridge Kit)');
  } else {
    logger.info(
      { hasSignerKey: !!config.signerPrivateKey, hasEvmKey: !!evmPrivateKey },
      'Bridge phase: using stub (missing signerPrivateKey or evmPrivateKey)',
    );
  }

  // ── Fund phase ──────────────────────────────────────────────
  // Full EVM execution requires evmPrivateKey. Falls back to stub when absent.
  let fundDeps: { chargeService: CoinbaseChargeService; creditPoolService: CreditPoolService } | undefined;
  if (evmPrivateKey) {
    const evmExecutor = new EvmPaymentExecutor({
      privateKey: evmPrivateKey,
      chainId: config.evmChainId,
    });
    const coinbaseChargeService = new CoinbaseChargeService(orClient, {
      dryRun: config.dryRun,
      evmPaymentExecutor: evmExecutor,
      evmChainId: config.evmChainId,
    });
    fundDeps = { chargeService: coinbaseChargeService, creditPoolService };
    logger.info('Fund phase: using real CoinbaseChargeService + EvmPaymentExecutor');
  } else {
    logger.info('Fund phase: using stub (missing evmPrivateKey)');
  }

  // ── Provision phase ─────────────────────────────────────────
  // Always uses real services — all deps are already constructed.
  const provisionDeps = {
    keyManagerService,
    distributionService,
    strategyService,
    dryRun: config.dryRun,
  };
  logger.info('Provision phase: using real services (KeyManager, Distribution, Strategy)');

  const phaseHandlers = createPhaseHandlerMap({
    claim: {
      bagsClient,
      strategyService,
      signAndSendClaim,
      dryRun: config.dryRun,
    },
    swap: {
      bagsClient,
      strategyService,
      signAndSendSwap,
      dryRun: config.dryRun,
    },
    allocate: {
      distributionService,
      strategyService,
      resolveHolders: (strategy) =>
        heliusClient.getTokenHolders(strategy.distributionToken),
    },
    bridge: bridgeDeps,
    fund: fundDeps,
    provision: provisionDeps,
  });
  const stateMachine = new StateMachine({
    auditService,
    runService,
    executionPolicy,
    phaseHandlers,
  });

  // Scheduler
  const schedulerService = new SchedulerService({
    strategyService,
    runService,
    stateMachine,
    executionPolicy,
    runLock,
    config,
  });

  // HTTP server
  const app = await buildApp({
    strategyService,
    runService,
    stateMachine,
    keyManagerService,
    creditPoolService,
    usageTrackingService,
    openRouterClient: orClient,
    db: dbConn,
    runLock,
    apiAuthToken: config.apiAuthToken,
    port: config.port,
    logLevel: config.logLevel,
    nodeEnv: config.nodeEnv,
  });

  // Start scheduler
  await schedulerService.start();

  // Start HTTP server
  const address = await app.listen({ port: config.port, host: '0.0.0.0' });

  logger.info(
    {
      address,
      port: config.port,
      scheduledStrategies: schedulerService.getScheduledCount(),
      dryRun: config.dryRun,
      claimSignerConfigured: !!config.signerPrivateKey,
      swapSignerConfigured: !!config.signerPrivateKey,
      evmPrivateKeyConfigured: !!evmPrivateKey,
      bridgeReal: !!bridgeDeps,
      fundReal: !!fundDeps,
      provisionReal: true,
    },
    'CreditBrain server started',
  );

  // Graceful shutdown
  const shutdown = async () => {
    app.log.info('Initiating graceful shutdown...');
    try {
      await schedulerService.stop();
      app.log.info('Scheduler stopped');
    } catch (err) {
      app.log.error({ err: err instanceof Error ? err.message : String(err) }, 'Error stopping scheduler');
    }

    runLock.releaseAll();
    app.log.info('Run locks released');

    try {
      await app.close();
      app.log.info('HTTP server closed');
    } catch (err) {
      app.log.error({ err: err instanceof Error ? err.message : String(err) }, 'Error closing server');
    }

    try {
      db.close();
      app.log.info('Database closed');
    } catch (err) {
      app.log.error({ err: err instanceof Error ? err.message : String(err) }, 'Error closing database');
    }

    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to start server');
  process.exit(1);
});
