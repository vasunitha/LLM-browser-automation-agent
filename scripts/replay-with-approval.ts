// Phase 8 manual verification: replays an artifact with the real
// PolicyGuard + a real, interactive CLI approval prompt (src/handoff's
// createCliApprovalDecider()) and a visible browser — so a human can
// watch the approve/deny gate actually take effect before any mutating
// Surface action runs.
//
//   npm run dev                                     # terminal 1
//   npx tsx scripts/replay-with-approval.ts          # terminal 2
//
// Env overrides:
//   ARTIFACT_ID   — default "open-sub-account" (the one committed risky
//                   artifact). Note: replaying it for real currently
//                   still hits the pre-existing, documented Phase 5
//                   limitation that Surface.type() can't fill a <select>
//                   (the Account Type field) — expected, not a Phase 8 bug;
//                   it demonstrates the approval gate correctly, which is
//                   what this script is for.
//   INPUTS_JSON   — JSON object of runtime inputs, e.g.
//                   '{"memberId":"1002","accountType":"sub_savings","nickname":"Test","initialDeposit":"50.00"}'
//   FORCE_RISK    — set to "risky" to override the loaded artifact's own
//                   riskLevel for this run only (never edits the file on
//                   disk) — lets you exercise the full approve -> success
//                   path against the safe, fully-working
//                   get-savings-balance artifact instead:
//                     ARTIFACT_ID=get-savings-balance FORCE_RISK=risky INPUTS_JSON='{"memberId":"1001"}' npx tsx scripts/replay-with-approval.ts

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createPlaywrightSurface } from "../src/surface";
import { replayArtifact, writeReplayEvidence } from "../src/replay";
import { PolicyGuard } from "../src/safety/policy-guard";
import { HandoffController, createCliApprovalDecider } from "../src/handoff";
import { loadConfig } from "../src/config/env";
import type { Artifact } from "../src/artifact/types";

const ARTIFACT_ID = process.env.ARTIFACT_ID ?? "open-sub-account";
const INPUTS: Record<string, string> = process.env.INPUTS_JSON
  ? JSON.parse(process.env.INPUTS_JSON)
  : { memberId: "1002", accountType: "sub_savings", nickname: "Vacation Fund", initialDeposit: "150.00" };

async function main() {
  const envConfig = loadConfig();
  const artifactPath = join("artifacts", `${ARTIFACT_ID}.json`);
  const rawArtifact = JSON.parse(readFileSync(artifactPath, "utf8")) as Artifact;

  if (process.env.FORCE_RISK === "risky") {
    console.log(`(FORCE_RISK=risky — overriding "${ARTIFACT_ID}"'s own riskLevel for this run only)`);
    rawArtifact.riskLevel = "risky";
  }

  console.log(`Artifact:  artifacts/${ARTIFACT_ID}.json (riskLevel: ${rawArtifact.riskLevel})`);
  console.log(`Inputs:    ${JSON.stringify(INPUTS)}`);
  console.log(`Allowlist: ${envConfig.allowlistBaseUrl}`);
  console.log("");

  const guard = new PolicyGuard({ allowedBaseUrls: [envConfig.allowlistBaseUrl] });
  const handoff = new HandoffController(createCliApprovalDecider());
  const surface = await createPlaywrightSurface({ headless: false });

  try {
    const result = await replayArtifact({
      artifact: rawArtifact,
      inputs: INPUTS,
      surface,
      policy: { guard, requestApproval: (request) => handoff.requestApproval(request) },
    });

    const evidenceDir = writeReplayEvidence({
      evidenceDir: envConfig.evidenceDir,
      result,
      artifact: result.status !== "invalid_artifact" ? rawArtifact : undefined,
    });

    console.log("=== Replay finished ===");
    console.log("status:      ", result.status);
    console.log("policy:      ", JSON.stringify(result.policy));
    console.log(
      "steps:       ",
      result.steps.map((s) => `${s.action}${s.attempt > 1 ? `(x${s.attempt})` : ""}:${s.outcome.status}`).join(" -> "),
    );
    if (result.error) console.log("error:       ", JSON.stringify(result.error));
    console.log("evidence dir:", evidenceDir);
  } finally {
    await surface.close();
  }
}

main().catch((err) => {
  console.error("Manual approval verification crashed:", err);
  process.exitCode = 1;
});
