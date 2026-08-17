/**
 * Deterministic checkpoint evaluation (Phase 7).
 *
 * Evaluated once, after every step has executed, against a *fresh*
 * observation — never inferred from the last step's own success. This is
 * what makes "do not consider a click successful merely because
 * Playwright did not throw" a structural guarantee: even if every step
 * returned {ok: true}, a run that ends up on the wrong page or missing
 * the expected text still fails here.
 */
import type { Checkpoint, CheckpointCondition } from "../artifact/types";
import type { Surface } from "../surface/types";
import { substituteParams } from "./substitute";
import type { ReplayCheckpointConditionResult, ReplayCheckpointResult } from "./types";

// Mirrors src/agent/loop.ts's normalizeForCheckpointMatch(): a real
// discovery run found that quoted page text can differ from the DOM's
// actual text only in whitespace/escaped-newline formatting. Replay
// checkpoints compare against real, unedited page text, so the same
// tolerance is applied here for the same reason.
function normalizeWhitespace(text: string): string {
  return text.replace(/\\n|\\r/g, " ").replace(/\s+/g, " ").trim();
}

function pathnameOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

async function evaluateCondition(
  condition: CheckpointCondition,
  surface: Surface,
  observationUrl: string,
  observationText: string,
  inputs: Record<string, string>,
): Promise<ReplayCheckpointConditionResult> {
  switch (condition.type) {
    case "urlMatches": {
      const pattern = substituteParams(condition.pattern, inputs);
      // Artifact url patterns are written as paths (e.g. "/members/{{memberId}}"),
      // matching how compile-artifact.ts derives them — compare against the
      // observed URL's pathname when the pattern looks like one, otherwise
      // fall back to a substring match against the full URL.
      const actual = pattern.startsWith("/") ? pathnameOf(observationUrl) : observationUrl;
      const satisfied = actual === pattern || observationUrl.includes(pattern);
      return {
        condition,
        satisfied,
        detail: satisfied ? undefined : `expected URL to match "${pattern}", observed "${actual}"`,
      };
    }
    case "textPresent": {
      const text = substituteParams(condition.text, inputs);
      const satisfied = normalizeWhitespace(observationText).includes(normalizeWhitespace(text));
      return { condition, satisfied, detail: satisfied ? undefined : `"${text}" was not found on the page` };
    }
    case "elementVisible": {
      // Surface has no standalone "does this resolve" check — read() is
      // the least destructive existing Surface method that both resolves
      // a locator and reports a clean structured failure if it doesn't,
      // so it doubles as the visibility check without bypassing Surface
      // or adding a new method to it.
      const result = await surface.read(condition.target);
      return { condition, satisfied: result.ok, detail: result.ok ? undefined : result.error.message };
    }
  }
}

/**
 * Evaluates an arbitrary list of conditions (ALL must hold) against a
 * fresh observation. Exported (not just used internally by
 * evaluateCheckpoint()) so Phase 8's business-outcome classification
 * (classify-outcome.ts) can reuse the exact same condition semantics for
 * `BusinessOutcome.when` — the schema's own doc comment already calls a
 * business outcome "a named alternative checkpoint," so it should be
 * evaluated by the same code, not a second parallel implementation.
 */
export async function evaluateConditions(
  conditions: CheckpointCondition[],
  surface: Surface,
  observationUrl: string,
  observationText: string,
  inputs: Record<string, string>,
): Promise<ReplayCheckpointResult> {
  const results: ReplayCheckpointConditionResult[] = [];
  for (const condition of conditions) {
    results.push(await evaluateCondition(condition, surface, observationUrl, observationText, inputs));
  }
  return { satisfied: results.every((c) => c.satisfied), conditions: results };
}

export async function evaluateCheckpoint(
  checkpoint: Checkpoint,
  surface: Surface,
  observationUrl: string,
  observationText: string,
  inputs: Record<string, string>,
): Promise<ReplayCheckpointResult> {
  return evaluateConditions(checkpoint.all, surface, observationUrl, observationText, inputs);
}
