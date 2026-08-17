/**
 * Safety / policy module boundary (Phase 8 — implemented).
 *
 * Import from here, not from the individual files directly. See
 * ARCHITECTURE.md -> "Safety and policy" for the full design: allowlist +
 * risk classification (PolicyGuard), a shared recoverable-vs-hard-failure
 * classifier used by both the discovery loop and the replay engine, and a
 * Surface decorator that turns a classification into actual enforcement
 * without touching Surface or either loop's control flow.
 */
export type { ActionClassification, PolicyConfig, FailureClassification, PolicyDecisionRecord } from "./types";
export { RECOVERABLE_SURFACE_ERROR_CODES } from "./types";

export { PolicyGuard } from "./policy-guard";

export { classifySurfaceError } from "./classify-failure";

export { createPolicyEnforcedSurface, type PolicyEnforcementContext } from "./policy-surface";
