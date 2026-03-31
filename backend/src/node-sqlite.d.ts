/**
 * Type declarations for Node.js built-in node:sqlite module.
 * The node:sqlite API is experimental (Node 22.5+) and @types/node
 * does not yet include definitions for it.
 */
declare module 'node:sqlite' {
  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }

  export class StatementSync {
    run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  }
}
