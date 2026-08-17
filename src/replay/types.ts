/**
 * Deterministic replay engine — result/status types (Phase 7, extended
 * Phase 8 with policy/approval and business-outcome classification).
 *
 * Deliberately has zero structural relationship to src/agent/types.ts's
 * DiscoveryTrace — a ReplayResult is its own, independent shape (no
 * shared interfaces, no import of anything from src/agent), so "this ran
 * through the LLM discovery loop" and "this ran through deterministic
 * replay" can never be confused by type alone, only by construction.
 */
import type { ArtifactActionType, CheckpointCondition, RiskLevel } from "../artifact/types";
import type { ActionClassification } from "../safety/types";

export type ReplayFinalStatus =
  | "success"
  | "invalid_artifact"
  | "missing_input"
  | "invalid_input"
  | "unknown_action"
  | "target_not_found"
  | "navigation_failed"
  | "action_failed"
  | "checkpoint_mismatch"
  | "timeout"
  | "unexpected_page_state"
  /** A declared businessOutcomes[] entry matched — an expected, non-success result (e.g. "no such member"), not a hard failure. See classify-outcome.ts. */
  | "business_outcome"
  /** The run's target wasn't allowlisted, or a risky run's approval was denied — refused before (or immediately upon) execution. See src/safety and src/handoff. */
  | "blocked";

export type ReplayStepOutcome =
  | { status: "ok"; value?: string }
  | { status: "error"; code: string; message: string };

export interface ReplayStepResult {
  stepId: number;
  action: ArtifactActionType;
  outcome: ReplayStepOutcome;
  /** 1 for a step's first attempt; >1 for a bounded retry of the same step after a recoverable Surface error (Phase 8) — see engine.ts. */
  attempt: number;
}

export interface ReplayCheckpointConditionResult {
  condition: CheckpointCondition;
  satisfied: boolean;
  detail?: string;
}

export interface ReplayCheckpointResult {
  satisfied: boolean;
  conditions: ReplayCheckpointConditionResult[];
}

export interface ReplayError {
  code: string;
  message: string;
}

/** The policy classification and (if applicable) approval decision made for this run — see src/safety/policy-guard.ts and src/handoff. Recorded for evidence/audit. */
export interface ReplayPolicyRecord {
  riskLevel: RiskLevel;
  classification: ActionClassification;
  approvalDecision?: "approved" | "denied";
}

export interface ReplayOutcomeClassification {
  kind: "success" | "business_outcome" | "hard_failure";
  businessOutcomeCode?: string;
  businessOutcomeDescription?: string;
}

/**
 * The result of one replay run. Independent of DiscoveryTrace by design
 * (see module docstring) — this is what a caller (a script, an evidence
 * writer, a future API) gets back, regardless of how the artifact being
 * replayed was originally produced.
 */
export interface ReplayResult {
  runId: string;
  artifactId: string;
  artifactVersion: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  inputs: Record<string, string>;
  steps: ReplayStepResult[];
  outputs: Record<string, string>;
  /** Present once step execution completes far enough to evaluate it (absent for e.g. invalid_artifact/missing_input/blocked). */
  checkpoint?: ReplayCheckpointResult;
  /** Present whenever a policy check actually ran — absent only for invalid_artifact (validation happens before policy is even consulted). */
  policy?: ReplayPolicyRecord;
  /** Present once the checkpoint has been evaluated — distinguishes a genuine hard failure from a matched business outcome. */
  outcomeClassification?: ReplayOutcomeClassification;
  status: ReplayFinalStatus;
  /** Present whenever status is a genuine failure — not set for the "business_outcome" status, which is an expected result, not an error. */
  error?: ReplayError;
}

export interface ReplayConfig {
  timeoutMs?: number;
  /** Bounded retries for a step whose Surface error is classified "recoverable" (see src/safety/classify-failure.ts) — 0 disables retrying. Default 2 (3 attempts total). */
  maxRetries?: number;
}

export const DEFAULT_REPLAY_TIMEOUT_MS = 60_000;
export const DEFAULT_REPLAY_MAX_RETRIES = 2;
