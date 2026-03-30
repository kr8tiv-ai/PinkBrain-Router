import { Command } from 'commander';
import pino from 'pino';
import { Connection, Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { Database } from './services/Database.js';
import { StrategyService } from './services/StrategyService.js';
import { RunService } from './services/RunService.js';
import { AuditService } from './services/AuditService.js';
import { KeyManagerService } from './services/KeyManagerService.js';
import { CreditPoolService } from './services/CreditPoolService.js';
import { DistributionService } from './services/DistributionService.js';
import { OpenRouterClient } from './clients/OpenRouterClient.js';
import { BagsClient } from './clients/BagsClient.js';
import { HeliusClient } from './clients/HeliusClient.js';
import { createSignAndSendClaim } from './engine/signAndSendClaim.js';
import { createSignAndSendSwap } from './engine/signAndSendSwap.js';
import { ExecutionPolicy } from './engine/ExecutionPolicy.js';
import { StateMachine } from './engine/StateMachine.js';
import { createPhaseHandlerMap } from './engine/phases/index.js';
import { CctpBridgeService } from './services/CctpBridgeService.js';
import { CoinbaseChargeService } from './services/CoinbaseChargeService.js';
import { BridgeKitClient } from './clients/BridgeKitClient.js';
import { EvmPaymentExecutor } from './clients/EvmPaymentExecutor.js';
import { getConfig } from './config/index.js';
import type { Strategy } from './types/index.js';

const logger = pino({ name: 'creditbrain-cli' });

const program = new Command();

program
  .name('creditbrain')
  .description('CreditBrain CLI — Fee-to-AI-credits pipeline')
  .version('0.1.0');

// create-strategy command
program
  .command('create-strategy')
  .description('Create a new credit strategy')
  .option('--owner <wallet>', 'Owner wallet address')
  .option('--source <source>', 'Fee source: CLAIMABLE_POSITIONS | PARTNER_FEES', 'CLAIMABLE_POSITIONS')
  .option('--distribution <mode>', 'Distribution mode', 'TOP_N_HOLDERS')
  .option('--top-n <number>', 'Number of top holders', '100')
  .option('--key-limit <usd>', 'Per-key spending limit in USD', '10')
  .option('--reserve <pct>', 'Credit pool reserve percentage', '10')
  .option('--threshold <sol>', 'Min SOL threshold to claim', '5')
  .action(async (opts) => {
    try {
      const config = getConfig();
      const db = new Database({ dbPath: config.databasePath });
      db.init();

      const strategyService = new StrategyService(db.getDb());

      if (!opts.owner) {
        logger.error('--owner wallet address is required');
        process.exit(1);
      }

      const strategy = strategyService.create({
        ownerWallet: opts.owner,
        source: opts.source as 'CLAIMABLE_POSITIONS' | 'PARTNER_FEES',
        distribution: opts.distribution as any,
        distributionTopN: parseInt(opts.topN, 10),
        keyConfig: {
          defaultLimitUsd: parseFloat(opts.keyLimit),
          limitReset: 'monthly',
          expiryDays: 365,
        },
        creditPoolReservePct: parseFloat(opts.reserve),
        minClaimThreshold: parseFloat(opts.threshold),
      });

      logger.info(
        { strategyId: strategy.strategyId, owner: strategy.ownerWallet, distribution: strategy.distribution },
        'Strategy created successfully',
      );

      console.log(`\n✅ Strategy created:`);
      console.log(`   ID:          ${strategy.strategyId}`);
      console.log(`   Owner:       ${strategy.ownerWallet}`);
      console.log(`   Source:      ${strategy.source}`);
      console.log(`   Distribution: ${strategy.distribution}`);
      console.log(`   Key Limit:   $${strategy.keyConfig.defaultLimitUsd}/key`);
      console.log(`   Reserve:     ${strategy.creditPoolReservePct}%`);
      console.log(`   Threshold:   ${strategy.minClaimThreshold} SOL\n`);

      db.close();
    } catch (error) {
      logger.error({ error: (error as Error).message }, 'Failed to create strategy');
      process.exit(1);
    }
  });

// list-strategies command
program
  .command('list-strategies')
  .description('List all credit strategies')
  .action(async () => {
    try {
      const config = getConfig();
      const db = new Database({ dbPath: config.databasePath });
      db.init();

      const strategyService = new StrategyService(db.getDb());
      const strategies = strategyService.getAll();

      if (strategies.length === 0) {
        console.log('\nNo strategies found. Create one with: creditbrain create-strategy\n');
      } else {
        console.log(`\n📊 Strategies (${strategies.length}):\n`);
        for (const s of strategies) {
          console.log(`  ${s.strategyId.slice(0, 8)}... | ${s.ownerWallet.slice(0, 8)}... | ${s.status} | ${s.distribution}`);
        }
        console.log('');
      }

      db.close();
    } catch (error) {
      logger.error({ error: (error as Error).message }, 'Failed to list strategies');
      process.exit(1);
    }
  });

// run command
program
  .command('run')
  .description('Execute a pipeline run for a strategy')
  .option('--strategy <id>', 'Strategy ID to run')
  .option('--resume <id>', 'Resume a failed run by ID')
  .action(async (opts) => {
    try {
      const config = getConfig();
      const db = new Database({ dbPath: config.databasePath });
      db.init();

      const dbConn = db.getDb();
      const strategyService = new StrategyService(dbConn);
      const runService = new RunService(dbConn);
      const auditService = new AuditService(dbConn);
      const executionPolicy = new ExecutionPolicy(config, dbConn);

      // OpenRouter client (shared by credit pool and key manager)
      const orClient = new OpenRouterClient(config.openrouterManagementKey);

      // Key manager for provision phase
      const keyManagerService = new KeyManagerService({ openRouterClient: orClient, db: dbConn });

      // Credit pool for allocate + fund phases
      const creditPoolService = new CreditPoolService(orClient, dbConn, config.creditPoolReservePct);

      // Helius client for holder resolution in allocate phase
      const heliusClient = new HeliusClient({
        apiKey: config.heliusApiKey,
        rpcUrl: config.heliusRpcUrl,
      });

      // Distribution service for allocate + provision phases
      const distributionService = new DistributionService({
        db: dbConn,
        creditPoolService,
      });

      // Claim phase dependencies
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
        bridgeDeps = { bridgeService: cctpBridgeService };
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

      let finalRun;

      if (opts.resume) {
        const existingRun = runService.getById(opts.resume);
        if (!existingRun) {
          logger.error({ runId: opts.resume }, 'Run not found');
          process.exit(1);
        }
        console.log(`\n🔄 Resuming run ${opts.resume}...\n`);
        finalRun = await stateMachine.resume(existingRun);
      } else if (opts.strategy) {
        const strategy = strategyService.getById(opts.strategy);
        if (!strategy) {
          logger.error({ strategyId: opts.strategy }, 'Strategy not found');
          process.exit(1);
        }
        console.log(`\n🚀 Starting pipeline run for strategy ${opts.strategy}...\n`);
        const run = runService.create(opts.strategy);
        finalRun = await stateMachine.execute(run);
      } else {
        logger.error('Either --strategy <id> or --resume <id> is required');
        process.exit(1);
      }

      if (finalRun) {
        console.log(`\n${finalRun.state === 'COMPLETE' ? '✅' : '❌'} Run ${finalRun.runId}: ${finalRun.state}`);
        if (finalRun.claimedSol) console.log(`   Claimed:     ${finalRun.claimedSol} SOL`);
        if (finalRun.swappedUsdc) console.log(`   Swapped:     $${finalRun.swappedUsdc} USDC`);
        if (finalRun.bridgedUsdc) console.log(`   Bridged:     $${finalRun.bridgedUsdc} USDC`);
        if (finalRun.fundedUsdc) console.log(`   Funded:      $${finalRun.fundedUsdc} credits`);
        if (finalRun.allocatedUsd) console.log(`   Allocated:   $${finalRun.allocatedUsd}`);
        if (finalRun.keysProvisioned) console.log(`   Provisioned: ${finalRun.keysProvisioned} new keys`);
        if (finalRun.keysUpdated) console.log(`   Updated:     ${finalRun.keysUpdated} keys`);
        if (finalRun.error) console.log(`   Error:       ${finalRun.error.code}: ${finalRun.error.detail}`);

        // Show audit log
        const auditLog = auditService.getByRunId(finalRun.runId);
        console.log(`\n📋 Audit Log (${auditLog.length} entries):`);
        for (const entry of auditLog) {
          console.log(`   ${entry.timestamp} | ${entry.phase} | ${entry.action}`);
        }
        console.log('');
      }

      db.close();
    } catch (error) {
      logger.error({ error: (error as Error).message }, 'Pipeline run failed');
      process.exit(1);
    }
  });

// status command
program
  .command('status')
  .description('Show status of a run')
  .option('--run <id>', 'Run ID')
  .option('--strategy <id>', 'Show latest run for strategy')
  .action(async (opts) => {
    try {
      const config = getConfig();
      const db = new Database({ dbPath: config.databasePath });
      db.init();

      const runService = new RunService(db.getDb());
      const auditService = new AuditService(db.getDb());

      let run;
      if (opts.run) {
        run = runService.getById(opts.run);
      } else if (opts.strategy) {
        run = runService.getLatestByStrategy(opts.strategy);
      }

      if (!run) {
        console.log('\nRun not found.\n');
        db.close();
        return;
      }

      console.log(`\n📋 Run Status:`);
      console.log(`   ID:          ${run.runId}`);
      console.log(`   Strategy:    ${run.strategyId}`);
      console.log(`   State:       ${run.state}`);
      console.log(`   Started:     ${run.startedAt}`);
      console.log(`   Finished:    ${run.finishedAt ?? '(in progress)'}`);
      if (run.error) console.log(`   Error:       ${run.error.code}: ${run.error.detail}`);
      console.log('');

      const auditLog = auditService.getByRunId(run.runId);
      if (auditLog.length > 0) {
        console.log(`   Phase History:`);
        for (const entry of auditLog) {
          console.log(`   ${entry.timestamp} | ${entry.phase} | ${entry.action}`);
        }
        console.log('');
      }

      db.close();
    } catch (error) {
      logger.error({ error: (error as Error).message }, 'Failed to get status');
      process.exit(1);
    }
  });

// update-strategy command
program
  .command('update-strategy')
  .description('Update an existing credit strategy')
  .requiredOption('--id <strategyId>', 'Strategy ID to update')
  .option('--distribution <mode>', 'Distribution mode')
  .option('--top-n <number>', 'Number of top holders')
  .option('--key-limit <usd>', 'Per-key spending limit in USD')
  .option('--reserve <pct>', 'Credit pool reserve percentage')
  .option('--threshold <sol>', 'Min SOL threshold to claim')
  .option('--status <status>', 'Strategy status (ACTIVE | PAUSED)')
  .action(async (opts) => {
    try {
      const config = getConfig();
      const db = new Database({ dbPath: config.databasePath });
      db.init();

      const strategyService = new StrategyService(db.getDb());

      const updates: Parameters<StrategyService['update']>[1] = {};

      if (opts.distribution) {
        updates.distributionMode = opts.distribution as Strategy['distribution'];
      }
      if (opts.topN) {
        updates.distributionTopN = parseInt(opts.topN, 10);
      }
      if (opts.keyLimit) {
        updates.keyConfig = {
          defaultLimitUsd: parseFloat(opts.keyLimit),
          limitReset: 'monthly',
          expiryDays: 365,
        };
      }
      if (opts.reserve) {
        updates.creditPoolReservePct = parseFloat(opts.reserve);
      }
      if (opts.threshold) {
        updates.minClaimThreshold = parseFloat(opts.threshold);
      }
      if (opts.status) {
        const validStatuses = ['ACTIVE', 'PAUSED'];
        if (!validStatuses.includes(opts.status)) {
          logger.error(`--status must be one of: ${validStatuses.join(', ')}`);
          process.exit(1);
        }
        updates.status = opts.status as 'ACTIVE' | 'PAUSED';
      }

      const strategy = strategyService.update(opts.id, updates);
      if (!strategy) {
        logger.error({ strategyId: opts.id }, 'Strategy not found');
        process.exit(1);
      }

      logger.info({ strategyId: strategy.strategyId }, 'Strategy updated successfully');
      console.log(`\n✅ Strategy updated:`);
      console.log(`   ID:           ${strategy.strategyId}`);
      console.log(`   Owner:        ${strategy.ownerWallet}`);
      console.log(`   Status:       ${strategy.status}`);
      console.log(`   Distribution: ${strategy.distribution}`);
      console.log(`   Key Limit:    $${strategy.keyConfig.defaultLimitUsd}/key`);
      console.log(`   Reserve:      ${strategy.creditPoolReservePct}%`);
      console.log(`   Threshold:    ${strategy.minClaimThreshold} SOL\n`);

      db.close();
    } catch (error) {
      logger.error({ error: (error as Error).message }, 'Failed to update strategy');
      process.exit(1);
    }
  });

// delete-strategy command
program
  .command('delete-strategy')
  .description('Delete a credit strategy')
  .requiredOption('--id <strategyId>', 'Strategy ID to delete')
  .action(async (opts) => {
    try {
      const config = getConfig();
      const db = new Database({ dbPath: config.databasePath });
      db.init();

      const strategyService = new StrategyService(db.getDb());
      const deleted = strategyService.delete(opts.id);

      if (!deleted) {
        logger.error({ strategyId: opts.id }, 'Strategy not found');
        process.exit(1);
      }

      logger.info({ strategyId: opts.id }, 'Strategy deleted successfully');
      console.log(`\n✅ Strategy ${opts.id} deleted.\n`);

      db.close();
    } catch (error) {
      logger.error({ error: (error as Error).message }, 'Failed to delete strategy');
      process.exit(1);
    }
  });

// list-keys command
program
  .command('list-keys')
  .description('List API keys from OpenRouter or keys for a strategy')
  .option('--strategy <id>', 'List keys for a specific strategy')
  .action(async (opts) => {
    try {
      const config = getConfig();
      const db = new Database({ dbPath: config.databasePath });
      db.init();

      if (opts.strategy) {
        const keyManagerService = new KeyManagerService({
          openRouterClient: new OpenRouterClient(config.openrouterManagementKey),
          db: db.getDb(),
        });
        const keys = keyManagerService.getKeysByStrategy(opts.strategy);
        if (keys.length === 0) {
          console.log(`\nNo keys found for strategy ${opts.strategy}.\n`);
        } else {
          console.log(`\n🔑 Keys for strategy ${opts.strategy} (${keys.length}):\n`);
          console.log('  Hash                             | Wallet                          | Limit   | Usage   | Status');
          console.log('  '.padEnd(33, '-') + '|' + ' '.padEnd(33, '-') + '|' + '--------|---------|--------');
          for (const k of keys) {
            const hash = k.openrouterKeyHash.length > 32
              ? k.openrouterKeyHash.slice(0, 32) + '...'
              : k.openrouterKeyHash.padEnd(32);
            const wallet = k.holderWallet.length > 32
              ? k.holderWallet.slice(0, 32) + '...'
              : k.holderWallet.padEnd(32);
            console.log(`  ${hash} | ${wallet} | $${String(k.spendingLimitUsd).padEnd(6)} | $${String(k.currentUsageUsd).padEnd(6)} | ${k.status}`);
          }
          console.log('');
        }
      } else {
        const orClient = new OpenRouterClient(config.openrouterManagementKey);
        const keys = await orClient.listKeys();
        if (keys.length === 0) {
          console.log('\nNo keys found on OpenRouter.\n');
        } else {
          console.log(`\n🔑 OpenRouter Keys (${keys.length}):\n`);
          console.log('  Hash                             | Name                            | Limit   | Usage   | Remaining | Status');
          console.log('  '.padEnd(33, '-') + '|' + ' '.padEnd(33, '-') + '|' + '--------|---------|-----------|--------');
          for (const k of keys) {
            const hash = k.hash.length > 32 ? k.hash.slice(0, 32) + '...' : k.hash.padEnd(32);
            const name = k.name.length > 32 ? k.name.slice(0, 32) + '...' : k.name.padEnd(32);
            console.log(`  ${hash} | ${name} | $${String(k.limit).padEnd(6)} | $${String(k.usage).padEnd(6)} | $${String(k.limit_remaining).padEnd(8)} | ${k.disabled ? 'DISABLED' : 'ACTIVE'}`);
          }
          console.log('');
        }
      }

      db.close();
    } catch (error) {
      logger.error({ error: (error as Error).message }, 'Failed to list keys');
      process.exit(1);
    }
  });

// pool-status command
program
  .command('pool-status')
  .description('Show credit pool status')
  .action(async () => {
    try {
      const config = getConfig();
      const db = new Database({ dbPath: config.databasePath });
      db.init();

      const orClient = new OpenRouterClient(config.openrouterManagementKey);
      const creditPoolService = new CreditPoolService(orClient, db.getDb());
      const status = await creditPoolService.getStatus();

      console.log('\n💰 Credit Pool Status:\n');
      console.log(`   Balance:    $${status.balance.toFixed(2)}`);
      console.log(`   Allocated:  $${status.allocated.toFixed(2)}`);
      console.log(`   Available:  $${status.available.toFixed(2)}`);
      console.log(`   Reserve:    $${status.reserve.toFixed(2)}`);
      console.log(`   Runway:     ${status.runway}\n`);

      db.close();
    } catch (error) {
      logger.error({ error: (error as Error).message }, 'Failed to get pool status');
      process.exit(1);
    }
  });

// health command
program
  .command('health')
  .description('Check dependency health (OpenRouter API, Database)')
  .action(async () => {
    try {
      const config = getConfig();
      const db = new Database({ dbPath: config.databasePath });
      db.init();

      console.log('\n🏥 Health Check:\n');

      // Database check
      let dbOk = true;
      try {
        db.getDb().prepare('SELECT 1').get();
      } catch (err) {
        dbOk = false;
        logger.error({ err: (err as Error).message }, 'Database unreachable');
      }

      // OpenRouter check
      let orOk = true;
      let orError = '';
      try {
        const orClient = new OpenRouterClient(config.openrouterManagementKey);
        await orClient.getAccountCredits();
      } catch (err) {
        orOk = false;
        orError = (err as Error).message;
      }

      const dbStatus = dbOk ? '✅ connected' : '❌ error';
      const orStatus = orOk ? '✅ connected' : `❌ unreachable (${orError})`;

      console.log(`   OpenRouter: ${orStatus}`);
      console.log(`   Database:   ${dbStatus}`);

      const overallOk = dbOk && orOk;
      console.log(`\n   Overall:    ${overallOk ? '✅ all healthy' : '⚠️  issues detected'}\n`);

      db.close();
      if (!overallOk) process.exit(1);
    } catch (error) {
      logger.error({ error: (error as Error).message }, 'Health check failed');
      process.exit(1);
    }
  });

program.parse();
