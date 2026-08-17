import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Server } from "node:http";
import Database from "better-sqlite3";
import { applySchema } from "../../src/app/db/schema";
import { seedDatabase } from "../../src/app/db/seed";
import { createApp } from "../../src/app";
import { createPlaywrightSurface } from "../../src/surface";
import type { Surface, Locator } from "../../src/surface";

describe("Surface module boundary — does not expose Playwright types", () => {
  // The Surface's public contract (types.ts, index.ts) must have zero
  // dependency on the "playwright" package, so any other implementation
  // (a different engine, or eventually a desktop surface) could satisfy
  // the same interface. This is enforced statically here rather than
  // relying on convention.
  it("types.ts does not import the 'playwright' package", () => {
    const src = readFileSync(join(__dirname, "../../src/surface/types.ts"), "utf8");
    expect(src).not.toMatch(/from ["']playwright["']/);
  });

  it("index.ts (the public entry point) does not import the 'playwright' package directly", () => {
    const src = readFileSync(join(__dirname, "../../src/surface/index.ts"), "utf8");
    expect(src).not.toMatch(/from ["']playwright["']/);
  });

  it("only playwright-surface.ts imports the 'playwright' package", () => {
    const src = readFileSync(join(__dirname, "../../src/surface/playwright-surface.ts"), "utf8");
    expect(src).toMatch(/from ["']playwright["']/);
  });
});

describe("PlaywrightSurface — driven entirely through the public Surface interface", () => {
  let server: Server;
  let baseUrl: string;
  let db: Database.Database;
  let surface: Surface;

  const memberIdField: Locator = {
    description: "Member ID field",
    strategies: [
      { type: "label", text: "Member ID" },
      { type: "role", role: "textbox", name: "Member ID" },
    ],
  };
  const searchButton: Locator = {
    description: "Search button",
    strategies: [{ type: "role", role: "button", name: "Search" }],
  };

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

    surface = await createPlaywrightSurface({ headless: true });
  }, 30_000);

  afterAll(async () => {
    await surface.close();
    server.close();
    db.close();
  });

  it("starts a browser/session that exposes the full Surface API", () => {
    expect(surface).toBeTruthy();
    expect(typeof surface.navigate).toBe("function");
    expect(typeof surface.observe).toBe("function");
    expect(typeof surface.click).toBe("function");
    expect(typeof surface.type).toBe("function");
    expect(typeof surface.read).toBe("function");
    expect(typeof surface.screenshot).toBe("function");
  });

  it("navigate() loads the target application", async () => {
    const result = await surface.navigate(`${baseUrl}/`);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.url).toContain(baseUrl);
    }
  });

  it("observe() returns structured, bounded UI state — not raw browser internals", async () => {
    const result = await surface.observe();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.url).toContain(baseUrl);
      expect(result.value.text).toContain("Credit Union Teller Console");
      const field = result.value.elements.find(
        (el) => el.role === "textbox" && el.name === "Member ID",
      );
      expect(field).toBeDefined();
      expect(field?.editable).toBe(true);
      // The contract is plain data — no functions/handles on any element.
      for (const el of result.value.elements) {
        expect(typeof el).toBe("object");
        expect(el).not.toHaveProperty("dispose");
      }
    }
  });

  it(
    "type() and click() drive the get-savings-balance workflow; observe() reflects the result",
    async () => {
      const typeResult = await surface.type(memberIdField, "1001");
      expect(typeResult.ok).toBe(true);

      const clickResult = await surface.click(searchButton);
      expect(clickResult.ok).toBe(true);

      const afterObserve = await surface.observe();
      expect(afterObserve.ok).toBe(true);
      if (afterObserve.ok) {
        expect(afterObserve.value.url).toContain("/members/1001");
        expect(afterObserve.value.text).toContain("Member details loaded successfully.");
      }
    },
    15_000,
  );

  it("read() extracts the savings balance text from the page", async () => {
    const balanceValue: Locator = {
      description: "Savings balance value",
      strategies: [{ type: "css", selector: "strong" }],
    };
    const result = await surface.read(balanceValue);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe("$482.17");
    }
  });

  it("screenshot() captures a valid PNG of the current page", async () => {
    const result = await surface.screenshot();
    expect(result.ok).toBe(true);
    if (result.ok) {
      const buffer = Buffer.from(result.value.base64, "base64");
      expect(buffer.length).toBeGreaterThan(100);
      // PNG file signature — confirms this is genuinely image data, not junk.
      expect(buffer.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    }
  });

  it("click() on a locator that matches nothing produces a structured failure, not a thrown error", async () => {
    const bogus: Locator = {
      description: "Nonexistent element",
      strategies: [{ type: "role", role: "button", name: "This Button Does Not Exist" }],
    };
    const result = await surface.click(bogus);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("ELEMENT_NOT_FOUND");
      expect(result.error.message).toBeTruthy();
      // Failure carries an observation for debugging, per the spec.
      expect(result.error.observation).toBeDefined();
    }
  });

  it("navigate() to an unreachable target produces a structured failure, not a thrown error", async () => {
    const result = await surface.navigate("http://127.0.0.1:1/definitely-not-listening");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("NAVIGATION_FAILED");
      expect(result.error.message).toBeTruthy();
    }
  });

  it(
    "the same session remains usable across many sequential actions, including after a prior failure",
    async () => {
      // Proves the browser/page from the failures above is still alive —
      // a fresh workflow run right after them, on the same Surface.
      await surface.navigate(`${baseUrl}/`);
      await surface.type(memberIdField, "9999");
      await surface.click(searchButton);
      const observed = await surface.observe();
      expect(observed.ok).toBe(true);
      if (observed.ok) {
        expect(observed.value.text).toContain("Member Not Found");
      }
    },
    15_000,
  );
});

describe("PlaywrightSurface — closed session", () => {
  it("actions after close() return a structured SESSION_CLOSED error, not a thrown exception", async () => {
    const surface = await createPlaywrightSurface({ headless: true });
    await surface.close();

    const result = await surface.observe();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("SESSION_CLOSED");
    }
  }, 15_000);
});
