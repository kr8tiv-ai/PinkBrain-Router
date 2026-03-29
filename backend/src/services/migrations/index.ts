import { migration as migration001 } from './001_strategies.js';
import { migration as migration002 } from './002_runs.js';
import { migration as migration003 } from './003_audit_log.js';
import { migration as migration004 } from './004_user_keys.js';
import { migration as migration005 } from './005_allocation_snapshots.js';
import type { DatabaseConnection } from '../Database.js';

export interface Migration {
  version: number;
  name: string;
  up: (db: DatabaseConnection) => void;
}

export const migrations: Migration[] = [
  migration001,
  migration002,
  migration003,
  migration004,
  migration005,
];
