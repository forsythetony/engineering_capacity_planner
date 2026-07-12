import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { SCHEMA_SQL } from './schema.js';

export type Db = Database.Database;

export interface OpenDbOptions {
  /**
   * File path for the database, or `':memory:'` for an ephemeral in-memory DB
   * (used by tests). Defaults to `':memory:'`.
   */
  path?: string;
}

/**
 * Open a SQLite database, enable foreign-key enforcement, and ensure the schema
 * exists. Safe to call against an existing database file (the schema uses
 * `IF NOT EXISTS`).
 */
export function openDatabase(options: OpenDbOptions = {}): Db {
  const path = options.path ?? ':memory:';
  // Ensure the parent directory exists so a first run (fresh clone, no `data/`)
  // can create the file instead of crashing.
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA_SQL);
  return db;
}
