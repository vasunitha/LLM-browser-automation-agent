import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "node:http";
import Database from "better-sqlite3";
import { applySchema } from "../../src/app/db/schema";
import { seedDatabase, KNOWN_MISSING_MEMBER_ID } from "../../src/app/db/seed";
import { createApp } from "../../src/app";

describe("Credit Union Teller Console — application", () => {
  let server: Server;
  let baseUrl: string;
  let db: Database.Database;

  beforeAll(async () => {
    db = new Database(":memory:");
    applySchema(db);
    seedDatabase(db);
    const app = createApp(db);

    server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("Expected the test server to bind to a numeric port.");
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(() => {
    server.close();
    db.close();
  });

  it("starts and serves the search page", async () => {
    const res = await fetch(`${baseUrl}/`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Member ID");
  });

  it("finds a valid member and displays details with the savings balance", async () => {
    const res = await fetch(`${baseUrl}/members/search`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ memberId: "1001" }).toString(),
      redirect: "follow",
    });
    expect(res.status).toBe(200);
    expect(res.url).toContain("/members/1001");
    const html = await res.text();
    expect(html).toContain("Member details loaded successfully.");
    expect(html).toContain("Savings Balance");
    expect(html).toContain("$482.17");
  });

  it("reports member-not-found as a business outcome, not a crash", async () => {
    const res = await fetch(`${baseUrl}/members/search`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ memberId: KNOWN_MISSING_MEMBER_ID }).toString(),
      redirect: "follow",
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Member Not Found");
    expect(html).toContain(KNOWN_MISSING_MEMBER_ID);
  });

  it("makes the sub-account form reachable for an active member", async () => {
    const res = await fetch(`${baseUrl}/members/1001/sub-account/new`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Open Sub-Account");
    expect(html).toContain("Initial Deposit");
  });

  it("reaches the confirmation screen for a valid sub-account submission", async () => {
    const res = await fetch(`${baseUrl}/members/1001/sub-account`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        accountType: "sub_savings",
        nickname: "Emergency Fund",
        initialDeposit: "100.00",
      }).toString(),
      redirect: "follow",
    });
    expect(res.status).toBe(200);
    expect(res.url).toContain("/confirmation");
    const html = await res.text();
    expect(html).toContain("Sub-account opened successfully.");
    expect(html).toContain("Emergency Fund");
  });

  it("shows validation errors for an invalid sub-account submission", async () => {
    const res = await fetch(`${baseUrl}/members/1001/sub-account`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        accountType: "sub_savings",
        nickname: "A",
        initialDeposit: "1.00",
      }).toString(),
      redirect: "follow",
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Please fix the errors below.");
    expect(html).toContain("Nickname must be between");
    expect(html).toContain("Initial deposit must be at least");
  });

  it("blocks sub-account opening for a restricted member (permission-blocked scenario)", async () => {
    const res = await fetch(`${baseUrl}/members/1003/sub-account/new`, { redirect: "follow" });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Action Not Permitted");
  });

  it("shows a large-deposit confirmation interstitial above the threshold (unexpected-dialog scenario)", async () => {
    const res = await fetch(`${baseUrl}/members/1002/sub-account`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        accountType: "sub_savings",
        nickname: "Big Deposit",
        initialDeposit: "15000.00",
      }).toString(),
      redirect: "follow",
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Confirm Large Deposit");
    expect(html).toContain("Confirm and Open Account");
  });

  it("completes the account after confirming a large deposit", async () => {
    const res = await fetch(`${baseUrl}/members/1002/sub-account/confirm-large-deposit`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        accountType: "sub_savings",
        nickname: "Big Deposit",
        initialDeposit: "15000.00",
      }).toString(),
      redirect: "follow",
    });
    expect(res.status).toBe(200);
    expect(res.url).toContain("/confirmation");
    const html = await res.text();
    expect(html).toContain("Sub-account opened successfully.");
  });
});
