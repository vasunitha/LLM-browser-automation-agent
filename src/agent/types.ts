/**
 * Discovery agent — structured types (Phase 6).
 *
 * The LLM never emits free-form instructions or raw locators of its own
 * invention: every decision it returns is one of the six variants below,
 * matched 1:1 to Anthropic tool definitions in llm-client.ts. `target`
 * fields reuse `Locator` directly from `surface/types` (not redefined) —
 * the same reasoning as `src/artifact/types.ts` in Phase 5: one locator
 * vocabulary, shared by whatever resolves it.
 */
import type { Locator, Observation } from "../surface/types";
import type { RiskLevel } from "../artifact/types";
import type { ActionClassification } from "../safety/types";

export type AgentActionType = "navigate" | "click" | "type" | "read" | "finish" | "fail";

export interface AgentNavigateAction {
  action: "navigate";
  url: string;
}

export interface AgentClickAction {
  action: "click";
  target: Locator;
}

export interface AgentTypeAction {
  action: "type";
  target: Locator;
  /** The literal value actually typed into the field. */
  value: string;
  /**
   * The name this value should be parameterized as when compiled into an
   * artifact (e.g. "memberId") — required, not optional: this is what
   * lets artifact compilation stay a deterministic read of the agent's
   * own declared refs rather than a second LLM pass (see
   * ARCHITECTURE.md's "Artifact authoring" trade-off).
   */
  inputRef: string;
}

export interface AgentReadAction {
  action: "read";
  target: Locator;
  /** Name this value should be exposed as when compiled into an artifact (e.g. "savingsBalance"). */
  outputRef: string;
}

export interface AgentFinishAction {
  action: "finish";
  /**
   * outputRef names (declared by prior `read` actions this same run) that
   * together satisfy the goal. Values are looked up from the actual
   * Surface.read() results already recorded in the trace — never taken
   * from anything the model types directly into this action — so a
   * declared "success" can't smuggle in a fabricated value.
   */
  outputRefs: string[];
  /**
   * A verbatim snippet the model claims is currently visible on the page
   * as evidence the goal was reached. Checked against the most recent
   * real observation before the run is accepted as successful — see
   * loop.ts. This is what stands in for a checkpoint at discovery time;
   * "a click succeeded" is deliberately not sufficient on its own.
   */
  checkpointText: string;
  reasoning?: string;
}

export interface AgentFailAction {
  action: "fail";
  reason: string;
}

export type AgentAction =
  | AgentNavigateAction
  | AgentClickAction
  | AgentTypeAction
  | AgentReadAction
  | AgentFinishAction
  | AgentFailAction;

/** One interactive control as summarized for the LLM prompt — a further-compacted view of ObservedElement. */
export interface ObservationControlSummary {
  role: string;
  name: string;
  value?: string;
  editable?: boolean;
}

/**
 * The compact, bounded view of the live page actually sent to the LLM.
 * Built from the Surface's own already-bounded Observation, trimmed
 * further so a multi-step discovery prompt stays small and readable —
 * never the raw DOM, a screenshot, or CDP data.
 */
export interface ObservationSummary {
  url: string;
  title: string;
  controls: ObservationControlSummary[];
  visibleText: string;
}

export type StepOutcome =
  | { status: "ok"; value?: string }
  | { status: "error"; code: string; message: string };

/** One iteration of the loop, as recorded in the discovery trace. */
export interface DiscoveryStepRecord {
  stepNumber: number;
  observation: ObservationSummary;
  action: AgentAction;
  outcome: StepOutcome;
}

export interface DiscoveryGoal {
  /** Natural-language goal, e.g. "Look up member 1001 and read their current savings balance." */
  goal: string;
  /** Target application entry point, e.g. "http://localhost:3000". */
  targetBaseUrl: string;
  /** Capability id the compiled artifact should be saved/named as on success, e.g. "get-savings-balance". */
  capabilityId: string;
  appId?: string;
  /**
   * Declares whether this discovery run is expected to mutate the target
   * app — gates it through the Phase 8 PolicyGuard exactly like a
   * replay's Artifact.riskLevel does. Defaults to "safe" when omitted,
   * preserving every pre-Phase-8 caller's behavior unchanged (the one
   * real discovery run so far, get-savings-balance, is genuinely safe).
   */
  riskLevel?: RiskLevel;
}

export interface DiscoveryConfig {
  maxSteps?: number;
  timeoutMs?: number;
}

export const DEFAULT_MAX_STEPS = 15;
export const DEFAULT_TIMEOUT_MS = 120_000;

/** Metadata about the model/provider used for a run — safe to persist (no key, no transcript). */
export interface DiscoveryModelInfo {
  provider: "anthropic";
  model: string;
}

export type DiscoveryFinalOutcome =
  | { status: "success"; outputs: Record<string, string>; checkpointText: string; finalUrl: string }
  | { status: "failure"; reason: string }
  | { status: "max_steps_exceeded" }
  | { status: "timeout" }
  | { status: "invalid_action"; message: string }
  | { status: "surface_error"; code: string; message: string }
  | { status: "llm_error"; message: string }
  /** The run's target wasn't allowlisted, or a risky goal's approval was denied — refused before the loop ever started. See src/safety and src/handoff. */
  | { status: "blocked"; reason: string };

/** The policy classification and (if applicable) approval decision made for this run — see src/safety/policy-guard.ts and src/handoff. Recorded for evidence/audit, mirroring ReplayPolicyRecord. */
export interface DiscoveryPolicyRecord {
  riskLevel: RiskLevel;
  classification: ActionClassification;
  approvalDecision?: "approved" | "denied";
}

export interface DiscoveryTrace {
  runId: string;
  timestamp: string;
  goal: string;
  target: { baseUrl: string };
  model: DiscoveryModelInfo;
  config: { maxSteps: number; timeoutMs: number };
  /** Present whenever a policy check actually ran (i.e. runDiscoveryLoop() was given a `policy` option). */
  policy?: DiscoveryPolicyRecord;
  steps: DiscoveryStepRecord[];
  finalOutcome: DiscoveryFinalOutcome;
}

export interface DiscoveryResult {
  trace: DiscoveryTrace;
  /** Present only when finalOutcome.status === "success" and artifact compilation succeeded. */
  artifactId?: string;
  evidenceDir?: string;
}

/** Re-exported for convenience so callers of src/agent don't also need to import from surface/types directly. */
export type { Observation };
