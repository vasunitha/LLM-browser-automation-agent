import Database from "better-sqlite3";
import { mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { loadConfig } from "./env";

let db: Database.Database | undefined;

/**
 * Opens (or returns the already-open) SQLite connection for the target
 * application database. This is connection plumbing only — no schema or
 * tables are defined here. The banking application's schema is designed
 * in Phase 3.
 */
export function getDb(): Database.Database {
  if (db) return db;

  const config = loadConfig();
  const dir = dirname(config.dbPath);
  if (dir && dir !== "." && !existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  db = new Database(config.dbPath);
  db.pragma("journal_mode = WAL");
  return db;
}
