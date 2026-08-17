import { defineConfig } from "@playwright/test";

// Phase 3: webServer boots a dedicated instance of the Credit Union Teller
// Console on its own port against its own SQLite file (deterministically
// reseeded on every run via scripts/e2e-server.ts), so these specs
// exercise the real UI without touching your local dev database.
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3902",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npx tsx scripts/e2e-server.ts",
    url: "http://localhost:3902/health",
    env: {
      PORT: "3902",
      DB_PATH: "./data/e2e-test.db",
    },
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
});
