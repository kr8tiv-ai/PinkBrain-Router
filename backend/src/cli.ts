import { Command } from 'commander';
import pino from 'pino';
import { Database } from './services/Database.js';
import { StrategyService } from './services/StrategyService.js';
import { RunService } from './services/RunService.js';
import { AuditService } from './services/AuditService.js';
import { ExecutionPolicy } from './engine/ExecutionPolicy.js';
import { StateMachine } from './engine/StateMachine.js';
import { createPhaseHandlerMap } from './engine/phases/index.js';
import { getConfig } from './config/index.js';

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
      const executionPolicy = new ExecutionPolicy(config);
      const phaseHandlers = createPhaseHandlerMap();
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

program.parse();
