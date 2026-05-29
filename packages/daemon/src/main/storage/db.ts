/**
 * SQLite connection + migrations runner (plan Boundary 4 storage layer).
 *
 * Uses `better-sqlite3` — synchronous, ideal for the single-process Electron
 * main. The DB file lives under the macOS Application Support directory.
 */
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import Database from 'better-sqlite3';
import { MIGRATIONS } from './migrations/index.js';

export type Db = Database.Database;

/** App-data directory: `~/Library/Application Support/wdiot`. */
export function appDataDir(): string {
  return join(homedir(), 'Library', 'Application Support', 'wdiot');
}

/** Default DB file path: `~/Library/Application Support/wdiot/wdiot.db`. */
export function defaultDbPath(): string {
  return join(appDataDir(), 'wdiot.db');
}

/**
 * Open (or create) the WDIOT database, apply pragmas, and run pending
 * migrations. Pass `':memory:'` for tests.
 */
export function openDatabase(dbPath: string = defaultDbPath()): Db {
  if (dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true });
  }

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');

  runMigrations(db);
  return db;
}

/**
 * Apply every migration whose version is newer than the recorded
 * `user_version`. Each migration runs inside its own transaction.
 */
export function runMigrations(db: Db): void {
  const currentVersion = db.pragma('user_version', { simple: true }) as number;

  for (const migration of MIGRATIONS) {
    if (migration.version <= currentVersion) continue;

    const apply = db.transaction(() => {
      db.exec(migration.sql);
      db.pragma(`user_version = ${migration.version}`);
    });
    apply();
  }
}

/** Current schema version recorded in `user_version`. */
export function schemaVersion(db: Db): number {
  return db.pragma('user_version', { simple: true }) as number;
}
