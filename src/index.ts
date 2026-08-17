import { createApp } from "./app";
import { loadConfig } from "./config/env";
import { getDb } from "./config/db";
import { applySchema } from "./app/db/schema";

const config = loadConfig();
const db = getDb();
applySchema(db);
const app = createApp(db);

app.listen(config.port, () => {
  console.log(`[teller-console] listening on http://localhost:${config.port}`);
  console.log(`[teller-console] if this is a fresh database, run "npm run db:seed" first`);
});
