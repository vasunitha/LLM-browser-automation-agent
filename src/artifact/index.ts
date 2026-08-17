/**
 * Artifact system module boundary (Phase 5 — implemented).
 *
 * Import from here, not from the individual files directly. See
 * ARCHITECTURE.md → "Structured artifact contract" for the full field-by-
 * field design rationale.
 */
export type {
  Artifact,
  ArtifactTarget,
  ArtifactInput,
  ArtifactOutput,
  ArtifactStep,
  NavigateStep,
  ClickStep,
  TypeStep,
  ReadStep,
  ArtifactActionType,
  ArtifactValueType,
  ParamValue,
  Checkpoint,
  CheckpointCondition,
  BusinessOutcome,
  RiskLevel,
} from "./types";
export { SUPPORTED_SCHEMA_VERSIONS, ARTIFACT_TOP_LEVEL_KEYS } from "./types";

export type { ArtifactValidationError, ArtifactValidationResult } from "./validate";
export { validateArtifact } from "./validate";

export { toJson, fromJson } from "./serialize";

export { ArtifactStore } from "./store";
