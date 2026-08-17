import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { loadConfig } from "../../src/config/env";
import { createApp } from "../../src/app";
import { applySchema } from "../../src/app/db/schema";

describe("foundation", () => {
  it("loads config with sane defaults", () => {
    const config = loadConfig();
    expect(config.port).toBeGreaterThan(0);
    expect(config.dbPath).toBeTruthy();
    expect(config.evidenceDir).toBeTruthy();
  });

  it("creates an Express app instance", () => {
    const db = new Database(":memory:");
    applySchema(db);
    const app = createApp(db);
    expect(app).toBeTruthy();
    expect(typeof app.listen).toBe("function");
    db.close();
  });
});
