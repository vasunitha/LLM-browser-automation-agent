/**
 * Human handoff types (Phase 8).
 *
 * Scoped deliberately: a full live co-browsing/CDP-attach handoff (a
 * human taking over the same live browser session mid-run) is explicitly
 * out of scope for this assignment (PROJECT_PLAN.md's own scope notes
 * sanction a minimal/mocked operator surface, not a built product). What
 * *is* implemented is the concrete, testable slice both Phase 8's brief
 * and ARCHITECTURE.md's "approve-once" design actually call for: an
 * explicit approve/deny decision, requested once per risky run, before
 * any mutating action executes.
 */
export type ApprovalDecision = "approved" | "denied";

export interface ApprovalRequest {
  runId: string;
  kind: "discovery" | "replay";
  /** Human-readable summary of what's being approved — the goal text (discovery) or the artifact id (replay). */
  summary: string;
  reason: string;
}

/** Pluggable so real usage can prompt a real human (see cli-decider.ts) while tests inject a fixed answer. */
export type ApprovalDecider = (request: ApprovalRequest) => Promise<ApprovalDecision> | ApprovalDecision;

/** One recorded escalation — a run hit a hard failure or was blocked and a human would need to look at it in a real deployment. Recorded for evidence/audit; does not itself pause or resume anything (there is no live handoff to resume in this system — see module docstring). */
export interface InterventionRecord {
  runId: string;
  reason: string;
  timestamp: string;
}
