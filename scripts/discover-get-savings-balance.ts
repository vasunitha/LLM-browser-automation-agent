// Phase 6 real LLM discovery smoke test: drives a genuine, Claude-decided
// observe -> decide -> act loop (src/agent) against the live Credit Union
// Teller Console — no hardcoded action sequence, no faked response. Run
// against a live instance of the app:
//
//   npm run dev                                            # terminal 1
//   npx tsx scripts/discover-get-savings-balance.ts         # terminal 2
//
// Requires ANTHROPIC_API_KEY (and optionally ANTHROPIC_MODEL) set in .env
// — see .env.example. Optional env override: TARGET_URL.

import { runDiscovery } from "../src/agent";

const TARGET_URL = process.env.TARGET_URL ?? "http://localhost:3000";
const GOAL = "Look up member 1001 and read their current savings balance.";

async function main() {
  console.log(`Goal:   "${GOAL}"`);
  console.log(`Target: ${TARGET_URL}`);
  console.log("Running real LLM discovery (this opens a real Chromium session and calls the Anthropic API)...\n");

  const result = await runDiscovery({
    goal: GOAL,
    targetBaseUrl: TARGET_URL,
    capabilityId: "get-savings-balance",
  });

  console.log("=== Discovery finished ===");
  console.log("runId:          ", result.trace.runId);
  console.log("model:          ", `${result.trace.model.provider}/${result.trace.model.model}`);
  console.log("LLM decision steps:", result.trace.steps.length);
  console.log(
    "actions chosen: ",
    result.trace.steps.map((s) => s.action.action).join(" -> "),
  );
  console.log("final outcome:  ", JSON.stringify(result.trace.finalOutcome, null, 2));
  console.log("evidence dir:   ", result.evidenceDir);
  console.log("artifact id:    ", result.artifactId ?? "(none — run did not succeed)");

  if (result.trace.finalOutcome.status !== "success") {
    console.error("\nRESULT: FAIL — discovery did not reach a successful finish().");
    process.exitCode = 1;
    return;
  }

  console.log("\nRESULT: PASS");
}

main().catch((err) => {
  console.error("Discovery smoke test crashed:", err);
  process.exitCode = 1;
});
