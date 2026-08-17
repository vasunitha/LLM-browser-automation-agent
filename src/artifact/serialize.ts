/**
 * Artifact <-> JSON (Phase 5).
 *
 * Serialization always goes through validateArtifact() on the way back
 * in, so a round trip can never silently produce an artifact object that
 * wouldn't itself pass validation.
 */
import type { Artifact } from "./types";
import { validateArtifact, type ArtifactValidationResult } from "./validate";

/** Formatted, readable JSON — artifacts are meant to be reviewed in a diff/on GitHub, not minified. */
export function toJson(artifact: Artifact): string {
  return JSON.stringify(artifact, null, 2);
}

export function fromJson(json: string): ArtifactValidationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { valid: false, errors: [{ path: "$", message: `Invalid JSON: ${message}` }] };
  }
  return validateArtifact(parsed);
}
