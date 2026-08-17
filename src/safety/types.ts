/**
 * Safety / policy types (Phase 8).
 *
 * Shared by both src/agent (discovery) and src/replay — this is the one
 * place "how do we classify an action/run" is defined, so both loops
 * enforce the same policy instead of each growing its own ad hoc rules.
 */
import type { RiskLevel } from "../artifact/types";
import type { SurfaceErrorCode } from "../surface/types";

/** The result of classifying one run (or one navigate() call) against policy. */
export type ActionClassification = "safe" | "approval_required" | "blocked";

export interface PolicyConfig {
  /** Base URLs a run is permitted to operate against. An exact match or prefix match against a navigated URL is allowed; anything else is blocked. */
  allowedBaseUrls: string[];
}

/** Whether a Surface-level failure is worth a bounded retry of the same action, or is fatal. */
export type FailureClassification = "recoverable" | "hard_failure";

export const RECOVERABLE_SURFACE_ERROR_CODES: readonly SurfaceErrorCode[] = [
  "ELEMENT_NOT_FOUND",
  "TIMEOUT",
  "NAVIGATION_FAILED",
  "UNKNOWN",
];

/** One policy decision made during a run, recorded for evidence/audit — see PolicyGuard.classify() and HandoffController.requestApproval(). */
export interface PolicyDecisionRecord {
  riskLevel: RiskLevel;
  classification: ActionClassification;
  /** Present only when classification was "approval_required" and a decision was actually requested. */
  approvalDecision?: "approved" | "denied";
  reason: string;
}
