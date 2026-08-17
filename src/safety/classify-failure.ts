/**
 * Shared recoverable-vs-hard-failure classification for Surface errors
 * (Phase 8). Both src/agent/loop.ts and src/replay/engine.ts previously
 * each had their own ad hoc notion of this (loop.ts's inline
 * `code === "SESSION_CLOSED"` check; engine.ts had none at all — every
 * error was immediately fatal). Centralized here so both loops treat the
 * same failure the same way, and so "bounded recovery" means the same
 * thing in both places.
 */
import { RECOVERABLE_SURFACE_ERROR_CODES, type FailureClassification } from "./types";

/**
 * SESSION_CLOSED and POLICY_BLOCKED are the two codes treated as
 * unrecoverable: a closed browser session can't be retried into
 * existence, and a policy block means retrying the identical action
 * would just be refused again for the identical reason. Everything else
 * (ELEMENT_NOT_FOUND, TIMEOUT, NAVIGATION_FAILED, UNKNOWN) is worth a
 * bounded retry — a slow page, a transient timing issue, or a locator
 * that resolves once the page finishes settling are all real, common
 * causes behind those codes.
 */
// Accepts a plain string, not just SurfaceErrorCode — callers also feed it
// replay-internal codes like "UNKNOWN_ACTION" or "POLICY_BLOCKED" (neither
// a real SurfaceErrorCode), which correctly fall through to "hard_failure"
// since they're never in RECOVERABLE_SURFACE_ERROR_CODES.
export function classifySurfaceError(code: string): FailureClassification {
  return (RECOVERABLE_SURFACE_ERROR_CODES as readonly string[]).includes(code) ? "recoverable" : "hard_failure";
}
