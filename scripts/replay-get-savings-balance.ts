// Phase 7 real replay test: deterministically replays the saved
// artifacts/get-savings-balance.json against the live Credit Union
// Teller Console — no LLM anywhere in this path (see src/replay and
// tests/unit/replay-no-llm.test.ts). Run against a live instance:
//
//   npm run dev                                        # terminal 1
//   npx tsx scripts/replay-get-savings-balance.ts       # terminal 2
//
// Optional env overrides: TARGET_URL (default http://localhost:3000),
// MEMBER_ID (default 1001).

import { runReplay } from "../src/replay";
import { createPlaywrightSurface } from "../src/surface";

const TARGET_URL = process.env.TARGET_URL ?? "http://localhost:3000";
const MEMBER_ID = process.env.MEMBER_ID ?? "1001";

async function main() {
  console.log(`Artifact: artifacts/get-savings-balance.json`);
  console.log(`Inputs:   { memberId: "${MEMBER_ID}" }`);
  console.log(`Target:   ${TARGET_URL}`);
  console.log("Replaying deterministically (no LLM, no Anthropic API call)...\n");

  // headless: false so the browser window is visible for manual
  // verification — passing our own Surface makes us responsible for
  // closing it (runReplay() only closes a Surface it created itself).
  const surface = await createPlaywrightSurface({ headless: false });

  const { result, evidenceDir } = await runReplay(
    {
      artifactId: "get-savings-balance",
      inputs: { memberId: MEMBER_ID },
    },
    { surface },
  );

  await surface.close();

  console.log("=== Replay finished ===");
  console.log("runId:          ", result.runId);
  console.log("artifactId:     ", result.artifactId, "| version:", result.artifactVersion);
  console.log("inputs used:    ", JSON.stringify(result.inputs));
  console.log(
    "steps:          ",
    result.steps.map((s) => `${s.action}:${s.outcome.status}`).join(" -> "),
  );
  console.log("outputs:        ", JSON.stringify(result.outputs));
  console.log("checkpoint:     ", JSON.stringify(result.checkpoint));
  console.log("status:         ", result.status);
  if (result.error) console.log("error:          ", JSON.stringify(result.error));
  console.log("duration:       ", `${result.durationMs}ms`);
  console.log("evidence dir:   ", evidenceDir);

  if (result.status !== "success") {
    console.error("\nRESULT: FAIL — replay did not reach success.");
    process.exitCode = 1;
    return;
  }

  console.log("\nRESULT: PASS");
}

main().catch((err) => {
  console.error("Replay smoke test crashed:", err);
  process.exitCode = 1;
});
