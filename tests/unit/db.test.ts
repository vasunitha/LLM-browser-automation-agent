import { describe, it, expect, beforeAll } from "vitest";
import Database from "better-sqlite3";
import { applySchema } from "../../src/app/db/schema";
import { seedDatabase, SEED_MEMBERS, KNOWN_MISSING_MEMBER_ID } from "../../src/app/db/seed";
import { findMemberById, listAccountsForMember } from "../../src/app/db/repository";

describe("database seed", () => {
  let db: Database.Database;

  beforeAll(() => {
    db = new Database(":memory:");
    applySchema(db);
    seedDatabase(db);
  });

  it("seeds the expected number of members", () => {
    const row = db.prepare("SELECT COUNT(*) as c FROM members").get() as { c: number };
    expect(row.c).toBe(SEED_MEMBERS.length);
  });

  it("seeds each demo member with a primary savings account matching the fixture balance", () => {
    for (const seedMember of SEED_MEMBERS) {
      const member = findMemberById(db, seedMember.id);
      expect(member).toBeDefined();
      expect(member?.status).toBe(seedMember.status);

      const accounts = listAccountsForMember(db, seedMember.id);
      const savings = accounts.find((a) => a.accountType === "savings");
      expect(savings).toBeDefined();
      expect(savings?.balanceCents).toBe(seedMember.savingsBalanceCents);
    }
  });

  it("does not seed the known-missing member id used to exercise not-found", () => {
    expect(findMemberById(db, KNOWN_MISSING_MEMBER_ID)).toBeUndefined();
  });

  it("includes at least one restricted member for the permission-blocked scenario", () => {
    const restricted = SEED_MEMBERS.filter((m) => m.status === "restricted");
    expect(restricted.length).toBeGreaterThan(0);
    for (const m of restricted) {
      expect(findMemberById(db, m.id)?.status).toBe("restricted");
    }
  });

  it("is idempotent — reseeding does not duplicate rows", () => {
    seedDatabase(db);
    seedDatabase(db);
    const row = db.prepare("SELECT COUNT(*) as c FROM members").get() as { c: number };
    expect(row.c).toBe(SEED_MEMBERS.length);
  });
});
