/**
 * Structured artifact contract (Phase 5).
 *
 * An Artifact is a typed, versioned, serializable description of a
 * capability — the record of a successful discovery run (Phase 6),
 * consumed by the deterministic replay engine (Phase 7). It is the
 * contract between "the model discovered this" and "the AI agent invokes
 * this in production" — reviewable by a human, callable by an agent, and
 * deliberately decoupled from how it was produced: nothing here is, or
 * ever contains, a raw LLM transcript.
 *
 * Locators are imported directly from surface/types (not the surface
 * barrel) so this module has zero relationship — even at the type level
 * — to playwright-surface.ts or the "playwright" package.
 */
import type { Locator } from "../surface/types";

export type ArtifactValueType = "string" | "number" | "boolean";

/** A step value that may be a literal, or a reference to a declared input, written as "{{name}}". */
export type ParamValue = string;

export interface ArtifactInput {
  name: string;
  type: ArtifactValueType;
  required: boolean;
  description?: string;
  example?: string;
}

export interface ArtifactOutput {
  name: string;
  type: ArtifactValueType;
  description?: string;
  /** The stepId of the `read` step that populates this output. */
  sourceStepId: number;
}

export type ArtifactActionType = "navigate" | "type" | "click" | "read";

interface ArtifactStepBase {
  stepId: number;
  action: ArtifactActionType;
  description?: string;
}

export interface NavigateStep extends ArtifactStepBase {
  action: "navigate";
  /** A literal path/URL, or a "{{param}}" reference. */
  url: ParamValue;
}

export interface ClickStep extends ArtifactStepBase {
  action: "click";
  target: Locator;
}

export interface TypeStep extends ArtifactStepBase {
  action: "type";
  target: Locator;
  /** A literal value, or a "{{param}}" reference. Also used for <select> controls — see ARCHITECTURE.md. */
  value: ParamValue;
}

export interface ReadStep extends ArtifactStepBase {
  action: "read";
  target: Locator;
  /** Must match the `name` of exactly one ArtifactOutput. */
  outputRef: string;
}

export type ArtifactStep = NavigateStep | ClickStep | TypeStep | ReadStep;

/**
 * A structured assertion, not prose — used by both the checkpoint (the
 * success condition) and business outcomes (expected non-success results
 * the caller still needs to know about). `pattern`/`text` may contain
 * "{{param}}" references, resolved against the invocation's inputs
 * before matching.
 */
export type CheckpointCondition =
  | { type: "urlMatches"; pattern: string }
  | { type: "elementVisible"; target: Locator }
  | { type: "textPresent"; text: string };

export interface Checkpoint {
  description?: string;
  /** All conditions must hold for the capability to be considered successful. */
  all: CheckpointCondition[];
}

/**
 * A legitimate, named result other than success — e.g. "no such member."
 * The replay engine (Phase 7) will check these before treating a
 * non-checkpoint end state as a hard failure. Establishing the contract
 * here; the runtime matching engine is Phase 7's job.
 */
export interface BusinessOutcome {
  /** SCREAMING_SNAKE_CASE, e.g. "MEMBER_NOT_FOUND". */
  code: string;
  description: string;
  /** Any one of these matching indicates this outcome. */
  when: CheckpointCondition[];
}

export type RiskLevel = "safe" | "risky";

export interface ArtifactTarget {
  appId: string;
  baseUrl: string;
  /** Only "web" exists today — the field itself is the extension seam for Phase 3.7's design story. */
  surfaceType: "web";
}

export interface Artifact {
  schemaVersion: string;
  id: string;
  name: string;
  description: string;
  /** The artifact's own version, independent of schemaVersion. */
  version: string;
  createdAt: string;
  riskLevel: RiskLevel;
  target: ArtifactTarget;
  inputs: ArtifactInput[];
  outputs: ArtifactOutput[];
  steps: ArtifactStep[];
  checkpoint: Checkpoint;
  businessOutcomes: BusinessOutcome[];
}

/** Schema versions this codebase can validate/load. Bump when the shape changes incompatibly. */
export const SUPPORTED_SCHEMA_VERSIONS = ["1.0"] as const;

/** The exact set of top-level keys a valid Artifact may have — enforced strictly so nothing else (e.g. a transcript) can ride along. */
export const ARTIFACT_TOP_LEVEL_KEYS = [
  "schemaVersion",
  "id",
  "name",
  "description",
  "version",
  "createdAt",
  "riskLevel",
  "target",
  "inputs",
  "outputs",
  "steps",
  "checkpoint",
  "businessOutcomes",
] as const;
