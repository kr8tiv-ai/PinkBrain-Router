import type { FastifyInstance } from 'fastify';
import { healthRoutes } from './health.js';
import { strategyRoutes } from './strategies.js';
import { runRoutes } from './runs.js';
import { keyRoutes } from './keys.js';
import { creditPoolRoutes } from './credit-pool.js';
import { usageRoutes } from './usage.js';
import { statsRoutes } from './stats.js';
import type { HealthDeps } from './health.js';
import type { StrategyRouteDeps } from './strategies.js';
import type { RunRouteDeps } from './runs.js';
import type { KeyRouteDeps } from './keys.js';
import type { CreditPoolRouteDeps } from './credit-pool.js';
import type { UsageRouteDeps } from './usage.js';
import type { StatsRouteDeps } from './stats.js';

export interface AllRouteDeps extends
  HealthDeps,
  StrategyRouteDeps,
  RunRouteDeps,
  KeyRouteDeps,
  CreditPoolRouteDeps,
  UsageRouteDeps,
  StatsRouteDeps {}

export async function registerAllRoutes(
  app: FastifyInstance,
  deps: AllRouteDeps,
): Promise<void> {
  await app.register(
    async (api) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await healthRoutes(api as any, deps);
      await strategyRoutes(api, deps);
      await runRoutes(api, deps);
      await keyRoutes(api, deps);
      await creditPoolRoutes(api, deps);
      await usageRoutes(api, deps);
      await statsRoutes(api, deps);
    },
    { prefix: '/api' },
  );
}

export { healthRoutes } from './health.js';
export { strategyRoutes } from './strategies.js';
export { runRoutes } from './runs.js';
export { keyRoutes } from './keys.js';
export { creditPoolRoutes } from './credit-pool.js';
export { usageRoutes } from './usage.js';
export { statsRoutes } from './stats.js';
