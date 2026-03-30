import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { migrations } from './migrations/index.js';

export interface StatementLike {
  run(...params: unknown[]): { changes?: number; lastInsertRowid?: unknown };
  get<T = unknown>(...params: unknown[]): T;
  all<T = unknown>(...params: unknown[]): T[];
}

export interface DatabaseConnection {
  prepare(sql: string): StatementLike;
  exec(sql: string): void;
  pragma(sql: string): void;
  transaction<T>(fn: () => T): () => T;
  close(): void;
}

class NodeSqliteConnection implements DatabaseConnection {
  constructor(private readonly db: any) {}

  prepare(sql: string): StatementLike {
    const statement = this.db.prepare(sql);
    return {
      run: (...params: unknown[]) => statement.run(...params),
      get: <T = unknown>(...params: unknown[]) => statement.get(...params) as T,
      all: <T = unknown>(...params: unknown[]) => statement.all(...params) as T[],
    };
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  pragma(sql: string): void {
    this.db.exec(`PRAGMA ${sql}`);
  }

  transaction<T>(fn: () => T): () => T {
    return () => {
      this.db.exec('BEGIN');
      try {
        const result = fn();
        this.db.exec('COMMIT');
        return result;
      } catch (error) {
        try {
          this.db.exec('ROLLBACK');
        } catch {}
        throw error;
      }
    };
  }

  close(): void {
    this.db.close();
  }
}

export class DatabaseError extends Error {
  constructor(
    public readonly operation: string,
    public readonly originalError: Error,
    public readonly params: Record<string, unknown>,
  ) {
    super(`Database ${operation} failed: ${originalError.message}`);
    this.name = 'DatabaseError';
  }
}

export class Database {
  private db: DatabaseConnection | null = null;
  private readonly dbPath: string;

  constructor({ dbPath }: { dbPath: string }) {
    this.dbPath = dbPath;
  }

  async init(): Promise<void> {
    this.ensureDirectory();
    await this.openConnection();
    this.configurePragmas();
    this.createMigrationsTable();
    this.runMigrations();
  }

  getDb(): DatabaseConnection {
    if (!this.db) {
      throw new DatabaseError(
        'getDb',
        new Error('Database not initialized. Call init() first.'),
        {},
      );
    }
    return this.db;
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  private ensureDirectory(): void {
    try {
      mkdirSync(dirname(this.dbPath), { recursive: true });
    } catch (err) {
      throw new DatabaseError('ensureDirectory', err as Error, { dbPath: this.dbPath });
    }
  }

  private async openConnection(): Promise<void> {
    try {
      const { DatabaseSync } = await import('node:sqlite');
      this.db = new NodeSqliteConnection(new DatabaseSync(this.dbPath));
    } catch (err) {
      throw new DatabaseError('open', err as Error, { dbPath: this.dbPath });
    }
  }

  private configurePragmas(): void {
    const db = this.getDb();
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }

  private createMigrationsTable(): void {
    this.getDb().exec(`
      CREATE TABLE IF NOT EXISTS _migrations (
        version INTEGER PRIMARY KEY,
        name    TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
  }

  private runMigrations(): void {
    const db = this.getDb();
    const applied = this.getAppliedVersions();
    const pending = migrations.filter((migration) => !applied.has(migration.version));

    pending.sort((a, b) => a.version - b.version);

    for (const migration of pending) {
      this.runMigration(db, migration);
    }

    if (pending.length > 0) {
      const names = pending.map((migration) => `v${migration.version} ${migration.name}`).join(', ');
      console.log(`[db] Applied migrations: ${names}`);
    }
  }

  private getAppliedVersions(): Set<number> {
    const rows = this.getDb()
      .prepare('SELECT version FROM _migrations ORDER BY version')
      .all() as Array<{ version: number }>;
    return new Set(rows.map((row) => row.version));
  }

  private runMigration(
    db: DatabaseConnection,
    migration: { version: number; name: string; up: (db: DatabaseConnection) => void },
  ): void {
    try {
      const insert = db.prepare('INSERT INTO _migrations (version, name) VALUES (?, ?)');
      const recordMigration = db.transaction(() => {
        migration.up(db);
        insert.run(migration.version, migration.name);
      });
      recordMigration();
      console.log(`[db] Migration v${migration.version} "${migration.name}" applied`);
    } catch (err) {
      throw new DatabaseError(
        'migrate',
        err as Error,
        { version: migration.version, name: migration.name },
      );
    }
  }
}
