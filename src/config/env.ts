import "dotenv/config";

export interface AppConfig {
  port: number;
  nodeEnv: string;
  dbPath: string;
  anthropicApiKey: string | undefined;
  anthropicModel: string;
  allowlistBaseUrl: string;
  evidenceDir: string;
}

/**
 * Loads configuration from environment variables (populated from .env via dotenv).
 * Only the fields needed by the Phase 2 foundation are actually consumed today;
 * the rest are read here so every later phase has one place to add to.
 */
export function loadConfig(): AppConfig {
  return {
    port: Number(process.env.PORT ?? 3000),
    nodeEnv: process.env.NODE_ENV ?? "development",
    dbPath: process.env.DB_PATH ?? "./data/app.db",
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || undefined,
    anthropicModel: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5",
    allowlistBaseUrl: process.env.ALLOWLIST_BASE_URL ?? "http://localhost:3000",
    evidenceDir: process.env.EVIDENCE_DIR ?? "./evidence",
  };
}
