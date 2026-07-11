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
  const db = new Database(options.path ?? ':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA_SQL);
  return db;
}
