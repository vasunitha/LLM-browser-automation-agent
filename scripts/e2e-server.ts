// Boots a dedicated instance of the app for Playwright Test's webServer.
// PORT and DB_PATH are supplied via playwright.config.ts's webServer.env
// (real OS env vars on this process, set before Node even starts), so
// there is no import-ordering concern with dotenv here.
import { getDb } from "../src/config/db";
import { applySchema } from "../src/app/db/schema";
import { seedDatabase } from "../src/app/db/seed";
import { createApp } from "../src/app";
import { loadConfig } from "../src/config/env";

const config = loadConfig();
const db = getDb();
applySchema(db);
seedDatabase(db); // idempotent — always resets to the deterministic demo dataset

const app = createApp(db);
app.listen(config.port, () => {
  console.log(`[e2e-server] listening on http://localhost:${config.port}`);
});
