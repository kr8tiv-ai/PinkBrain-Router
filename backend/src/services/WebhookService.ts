import pino from 'pino';
import { createHmac } from 'node:crypto';
import type { DatabaseConnection } from './Database.js';
import type { CreditRun, RunState } from '../types/index.js';

const logger = pino({ name: 'WebhookService' });

export interface WebhookRegistration {
  webhookId: string;
  url: string;
  events: RunState[];
  secret: string;
  active: boolean;
  createdAt: string;
}

export class WebhookService {
  constructor(private readonly db: DatabaseConnection) {
    this.ensureTable();
  }

  private ensureTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS webhooks (
        webhook_id TEXT PRIMARY KEY,
        url        TEXT NOT NULL,
        events     TEXT NOT NULL DEFAULT '["COMPLETE","FAILED"]',
        secret     TEXT NOT NULL,
        active     INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
  }

  register(url: string, events: RunState[], secret: string): WebhookRegistration {
    const webhookId = crypto.randomUUID();
    this.db
      .prepare('INSERT INTO webhooks (webhook_id, url, events, secret) VALUES (?, ?, ?, ?)')
      .run(webhookId, url, JSON.stringify(events), secret);

    logger.info({ webhookId, url, events }, 'Webhook registered');

    return {
      webhookId,
      url,
      events,
      secret,
      active: true,
      createdAt: new Date().toISOString(),
    };
  }

  list(): WebhookRegistration[] {
    const rows = this.db
      .prepare('SELECT * FROM webhooks WHERE active = 1')
      .all() as Array<{
        webhook_id: string;
        url: string;
        events: string;
        secret: string;
        active: number;
        created_at: string;
      }>;

    return rows.map((r) => ({
      webhookId: r.webhook_id,
      url: r.url,
      events: JSON.parse(r.events) as RunState[],
      secret: r.secret,
      active: r.active === 1,
      createdAt: r.created_at,
    }));
  }

  remove(webhookId: string): boolean {
    const result = this.db
      .prepare('UPDATE webhooks SET active = 0 WHERE webhook_id = ?')
      .run(webhookId);
    return (result.changes ?? 0) > 0;
  }

  /**
   * Fire webhooks for a given run state transition.
   * Non-blocking — failures are logged but don't affect the pipeline.
   */
  async fire(run: CreditRun): Promise<void> {
    const hooks = this.list().filter((h) => h.events.includes(run.state));

    if (hooks.length === 0) return;

    const payload = JSON.stringify({
      event: run.state,
      runId: run.runId,
      strategyId: run.strategyId,
      state: run.state,
      claimedSol: run.claimedSol,
      swappedUsdc: run.swappedUsdc,
      bridgedUsdc: run.bridgedUsdc,
      fundedUsdc: run.fundedUsdc,
      allocatedUsd: run.allocatedUsd,
      keysProvisioned: run.keysProvisioned,
      error: run.error,
      timestamp: new Date().toISOString(),
    });

    for (const hook of hooks) {
      try {
        const signature = createHmac('sha256', hook.secret).update(payload).digest('hex');

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);

        await fetch(hook.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-PinkBrain-Signature': `sha256=${signature}`,
            'X-PinkBrain-Event': run.state,
          },
          body: payload,
          signal: controller.signal,
        });

        clearTimeout(timeout);
        logger.info({ webhookId: hook.webhookId, event: run.state }, 'Webhook delivered');
      } catch (err) {
        logger.warn(
          { webhookId: hook.webhookId, url: hook.url, error: (err as Error).message },
          'Webhook delivery failed — non-blocking',
        );
      }
    }
  }
}
