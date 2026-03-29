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
import { createSignAndSendClaim } from './engine/signAndSendClaim.js';
import { ExecutionPolicy } from './engine/ExecutionPolicy.js';
import { StateMachine } from './engine/StateMachine.js';
import { RunLock } from './engine/RunLock.js';
import { createPhaseHandlerMap } from './engine/phases/index.js';
import { SchedulerService } from './services/SchedulerService.js';
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

  const phaseHandlers = createPhaseHandlerMap({
    claim: {
      bagsClient,
      strategyService,
      signAndSendClaim,
      dryRun: config.dryRun,
    },
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
