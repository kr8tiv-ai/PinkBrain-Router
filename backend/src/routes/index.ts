import type { FastifyInstance } from 'fastify';
import { healthRoutes } from './health.js';
import { strategyRoutes } from './strategies.js';
import { runRoutes } from './runs.js';
import { keyRoutes } from './keys.js';
import { creditPoolRoutes } from './credit-pool.js';
import { usageRoutes } from './usage.js';
import type { HealthDeps } from './health.js';
import type { StrategyRouteDeps } from './strategies.js';
import type { RunRouteDeps } from './runs.js';
import type { KeyRouteDeps } from './keys.js';
import type { CreditPoolRouteDeps } from './credit-pool.js';
import type { UsageRouteDeps } from './usage.js';

export interface AllRouteDeps extends
  HealthDeps,
  StrategyRouteDeps,
  RunRouteDeps,
  KeyRouteDeps,
  CreditPoolRouteDeps,
  UsageRouteDeps {}

export async function registerAllRoutes(
  app: FastifyInstance,
  deps: AllRouteDeps,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await healthRoutes(app as any, deps);
  await strategyRoutes(app, deps);
  await runRoutes(app, deps);
  await keyRoutes(app, deps);
  await creditPoolRoutes(app, deps);
  await usageRoutes(app, deps);
}

export { healthRoutes } from './health.js';
export { strategyRoutes } from './strategies.js';
export { runRoutes } from './runs.js';
export { keyRoutes } from './keys.js';
export { creditPoolRoutes } from './credit-pool.js';
export { usageRoutes } from './usage.js';
