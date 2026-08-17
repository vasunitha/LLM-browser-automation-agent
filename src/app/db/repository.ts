import type Database from "better-sqlite3";

export interface Member {
  id: string;
  firstName: string;
  lastName: string;
  status: "active" | "restricted";
}

export interface Account {
  id: string;
  memberId: string;
  accountType: string;
  nickname: string | null;
  balanceCents: number;
  status: string;
}

interface MemberRow {
  id: string;
  first_name: string;
  last_name: string;
  status: "active" | "restricted";
}

interface AccountRow {
  id: string;
  member_id: string;
  account_type: string;
  nickname: string | null;
  balance_cents: number;
  status: string;
}

function mapMember(row: MemberRow): Member {
  return { id: row.id, firstName: row.first_name, lastName: row.last_name, status: row.status };
}

function mapAccount(row: AccountRow): Account {
  return {
    id: row.id,
    memberId: row.member_id,
    accountType: row.account_type,
    nickname: row.nickname,
    balanceCents: row.balance_cents,
    status: row.status,
  };
}

export function findMemberById(db: Database.Database, memberId: string): Member | undefined {
  const row = db.prepare(`SELECT * FROM members WHERE id = ?`).get(memberId) as MemberRow | undefined;
  return row ? mapMember(row) : undefined;
}

export function listAccountsForMember(db: Database.Database, memberId: string): Account[] {
  const rows = db
    .prepare(`SELECT * FROM accounts WHERE member_id = ? ORDER BY created_at ASC, id ASC`)
    .all(memberId) as AccountRow[];
  return rows.map(mapAccount);
}

export function findAccountById(db: Database.Database, accountId: string): Account | undefined {
  const row = db.prepare(`SELECT * FROM accounts WHERE id = ?`).get(accountId) as AccountRow | undefined;
  return row ? mapAccount(row) : undefined;
}

export interface NewSubAccountInput {
  memberId: string;
  accountType: "sub_savings" | "sub_checking";
  nickname: string;
  balanceCents: number;
}

/**
 * Creates a new sub-account for a member. This is a demo/simulated
 * account opening only — no real financial transaction (no source account
 * is debited); the initial deposit becomes the new account's opening
 * balance directly.
 */
export function insertSubAccount(db: Database.Database, input: NewSubAccountInput): Account {
  const id = `SUB-${input.memberId}-${Date.now().toString(36).toUpperCase()}`;
  db.prepare(
    `INSERT INTO accounts (id, member_id, account_type, nickname, balance_cents, status)
     VALUES (?, ?, ?, ?, ?, 'active')`,
  ).run(id, input.memberId, input.accountType, input.nickname, input.balanceCents);

  const account = findAccountById(db, id);
  if (!account) {
    throw new Error("Failed to read back newly inserted sub-account.");
  }
  return account;
}
