/**
 * Business-outcome classification (Phase 8).
 *
 * When the checkpoint doesn't match, that isn't automatically a hard
 * failure — the artifact may declare `businessOutcomes` describing
 * legitimate non-success results (e.g. "no such member"). This is the
 * piece Phase 7 explicitly left unimplemented (see PROJECT_PLAN.md ->
 * "What Phase 7 actually implemented" -> "businessOutcomes matching —
 * still not implemented, scope clarified") — now built, reusing
 * checkpoint.ts's own condition evaluator rather than a second one, per
 * the schema's own framing of a business outcome as "a named alternative
 * checkpoint."
 */
import type { Artifact } from "../artifact/types";
import type { Surface } from "../surface/types";
import { evaluateConditions } from "./checkpoint";

export type ReplayOutcomeKind = "success" | "business_outcome" | "hard_failure";

export interface OutcomeClassificationResult {
  kind: ReplayOutcomeKind;
  businessOutcomeCode?: string;
  businessOutcomeDescription?: string;
}

/**
 * Call only after the checkpoint has already been evaluated and did not
 * satisfy — checks each declared businessOutcomes[] entry in order and
 * returns the first whose `when` conditions are all satisfied. No match
 * means this is a genuine hard failure, not an expected outcome.
 */
export async function classifyReplayOutcome(
  artifact: Artifact,
  surface: Surface,
  observationUrl: string,
  observationText: string,
  inputs: Record<string, string>,
): Promise<OutcomeClassificationResult> {
  for (const outcome of artifact.businessOutcomes) {
    const result = await evaluateConditions(outcome.when, surface, observationUrl, observationText, inputs);
    if (result.satisfied) {
      return {
        kind: "business_outcome",
        businessOutcomeCode: outcome.code,
        businessOutcomeDescription: outcome.description,
      };
    }
  }
  return { kind: "hard_failure" };
}
