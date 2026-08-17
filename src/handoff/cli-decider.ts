/**
 * A real, interactive ApprovalDecider (Phase 8) — prompts on stdin/stdout
 * and blocks until a human types y/n. This is the "operator console" the
 * assignment sanctions as a CLI/bare interface rather than a built UI
 * (see PROJECT_PLAN.md's scope notes). Never used by tests — those inject
 * a fixed-answer fake decider instead (see tests/unit/fixtures/).
 */
import { createInterface } from "node:readline/promises";
import type { ApprovalDecider, ApprovalRequest } from "./types";

export function createCliApprovalDecider(): ApprovalDecider {
  return async (request: ApprovalRequest) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      console.log(`\n[APPROVAL REQUIRED] ${request.kind} run ${request.runId}`);
      console.log(`  ${request.summary}`);
      console.log(`  reason: ${request.reason}`);
      const answer = await rl.question("Approve this risky run? [y/N] ");
      const approved = answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes";
      console.log(approved ? "-> approved\n" : "-> denied\n");
      return approved ? "approved" : "denied";
    } finally {
      rl.close();
    }
  };
}
