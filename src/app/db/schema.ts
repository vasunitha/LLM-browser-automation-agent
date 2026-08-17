import type Database from "better-sqlite3";

/**
 * Minimal schema for the Credit Union Teller Console — just enough to
 * support get-savings-balance (member + their savings account) and
 * open-sub-account (creating additional accounts for a member).
 */
export function applySchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS members (
      id TEXT PRIMARY KEY,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('active','restricted')) DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      member_id TEXT NOT NULL REFERENCES members(id),
      account_type TEXT NOT NULL CHECK (account_type IN ('savings','checking','sub_savings','sub_checking')),
      nickname TEXT,
      balance_cents INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL CHECK (status IN ('active','pending','closed')) DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_accounts_member_id ON accounts(member_id);
  `);
}
