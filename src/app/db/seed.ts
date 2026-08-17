import Database from "better-sqlite3";
import { getDb } from "../../config/db";
import { applySchema } from "./schema";

export interface SeedMember {
  id: string;
  firstName: string;
  lastName: string;
  status: "active" | "restricted";
  savingsBalanceCents: number;
}

// Deterministic, fake demo data — no real PII. IDs are small sequential
// numbers chosen to look obviously synthetic, not like real member/SSN
// formats.
export const SEED_MEMBERS: SeedMember[] = [
  {
    id: "1001",
    firstName: "Jordan",
    lastName: "Ramirez",
    status: "active",
    savingsBalanceCents: 48_217, // $482.17 — get-savings-balance happy path
  },
  {
    id: "1002",
    firstName: "Casey",
    lastName: "Nguyen",
    status: "active",
    savingsBalanceCents: 1_020_455, // $10,204.55 — open-sub-account happy path
  },
  {
    id: "1003",
    firstName: "Amari",
    lastName: "Chen",
    status: "restricted",
    savingsBalanceCents: 5_800, // $58.00 — permission-blocked scenario (still viewable, can't open a sub-account)
  },
];

// Deliberately not seeded — used by tests/demos to reliably exercise the
// member-not-found business outcome.
export const KNOWN_MISSING_MEMBER_ID = "9999";

/**
 * Idempotent: clears and re-inserts the fixed demo dataset, so this can be
 * called repeatedly (CLI reseed, e2e bootstrap, test setup) with identical
 * results every time.
 */
export function seedDatabase(db: Database.Database): void {
  const insertMember = db.prepare(
    `INSERT INTO members (id, first_name, last_name, status) VALUES (?, ?, ?, ?)`,
  );
  const insertAccount = db.prepare(
    `INSERT INTO accounts (id, member_id, account_type, nickname, balance_cents, status)
     VALUES (?, ?, ?, ?, ?, 'active')`,
  );

  const seedAll = db.transaction(() => {
    db.exec(`DELETE FROM accounts; DELETE FROM members;`);
    for (const member of SEED_MEMBERS) {
      insertMember.run(member.id, member.firstName, member.lastName, member.status);
      insertAccount.run(
        `SAV-${member.id}`,
        member.id,
        "savings",
        "Primary Savings",
        member.savingsBalanceCents,
      );
    }
  });

  seedAll();
}

// CLI entry point: `npm run db:seed` runs this file directly via tsx.
if (require.main === module) {
  const db = getDb();
  applySchema(db);
  seedDatabase(db);
  console.log(`Seeded ${SEED_MEMBERS.length} members into the database.`);
  db.close();
}
