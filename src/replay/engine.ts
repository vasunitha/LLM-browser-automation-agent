/**
 * Deterministic replay engine (Phase 7; extended Phase 8 with policy
 * enforcement, bounded retry, and business-outcome classification).
 *
 * Saved Artifact -> validate -> policy gate -> resolve runtime inputs ->
 * replay ordered steps (bounded retry on recoverable Surface errors) ->
 * observe/check results -> checkpoint validation -> business-outcome
 * classification -> SUCCESS/BUSINESS_OUTCOME/FAILURE. No LLM anywhere in
 * this file or any file it imports — see ARCHITECTURE.md -> "Deterministic
 * replay engine" and tests/unit/replay-no-llm.test.ts for the explicit
 * proof. This module depends only on the `Surface` *interface*, never
 * Playwright or any LLM provider SDK, the same discipline
 * src/agent/loop.ts follows for the discovery loop — which is exactly
 * what makes both exercisable with fakes in tests.
 */
import { randomUUID } from "node:crypto";
import type { Surface } from "../surface/types";
import type { Artifact, ArtifactStep } from "../artifact/types";
import { validateArtifact } from "../artifact/validate";
import { classifySurfaceError } from "../safety/classify-failure";
import { createPolicyEnforcedSurface } from "../safety/policy-surface";
import type { PolicyGuard } from "../safety/policy-guard";
import type { ApprovalDecider, ApprovalRequest } from "../handoff/types";
import { substituteParams } from "./substitute";
import { evaluateCheckpoint } from "./checkpoint";
import { classifyReplayOutcome } from "./classify-outcome";
import {
  DEFAULT_REPLAY_MAX_RETRIES,
  DEFAULT_REPLAY_TIMEOUT_MS,
  type ReplayConfig,
  type ReplayFinalStatus,
  type ReplayPolicyRecord,
  type ReplayResult,
  type ReplayStepResult,
} from "./types";

/** Optional Phase 8 policy gate. Omitted entirely, replayArtifact() behaves exactly as it did in Phase 7 (no policy enforcement at all) — preserves every existing caller/test. src/replay/index.ts supplies this by default for real runs. */
export interface ReplayPolicyOptions {
  guard: PolicyGuard;
  requestApproval: (request: ApprovalRequest) => ReturnType<ApprovalDecider>;
}

export interface ReplayArtifactInput {
  /**
   * Deliberately `unknown`, not `Artifact` — replayArtifact() runs this
   * through validateArtifact() itself, so an invalid artifact produces a
   * structured `{status: "invalid_artifact"}` ReplayResult, never a
   * thrown exception (required: "Invalid artifacts must fail cleanly
   * before execution").
   */
  artifact: unknown;
  inputs: Record<string, string>;
  surface: Surface;
  config?: ReplayConfig;
  runId?: string;
  /** Overridable for deterministic timeout tests — defaults to Date.now. */
  clock?: () => number;
  /** Fired after each recorded step attempt, so the orchestration layer (index.ts) can capture a screenshot without this module taking on filesystem concerns. Errors here are swallowed. */
  onStepRecorded?: (record: ReplayStepResult) => void | Promise<void>;
  policy?: ReplayPolicyOptions;
}

function resolveUrl(base: string, url: string): string {
  try {
    return new URL(url, base).toString();
  } catch {
    return url;
  }
}

function surfaceErrorToStatus(code: string): ReplayFinalStatus {
  switch (code) {
    case "ELEMENT_NOT_FOUND":
      return "target_not_found";
    case "NAVIGATION_FAILED":
      return "navigation_failed";
    case "UNKNOWN_ACTION":
      return "unknown_action";
    case "POLICY_BLOCKED":
      return "blocked";
    default:
      // TIMEOUT, SESSION_CLOSED, UNKNOWN
      return "action_failed";
  }
}

/**
 * Executes exactly one artifact step against the live Surface, with
 * runtime parameters substituted. Always returns attempt: 1 — a caller
 * retrying a recoverable failure (see replayArtifact()'s step loop below)
 * overrides that field itself; this function only knows about a single
 * attempt. Exported so its defensive "unsupported action" branch is
 * directly testable — the public replayArtifact() always validates the
 * whole artifact first, which already rejects any step outside
 * navigate/click/type/read, so that branch is unreachable via the public
 * API today. It exists anyway as defense in depth for any future caller
 * that builds a step object in-memory without going through
 * validateArtifact() first.
 */
export async function executeStep(
  step: ArtifactStep,
  surface: Surface,
  baseUrl: string,
  inputs: Record<string, string>,
): Promise<ReplayStepResult> {
  switch (step.action) {
    case "navigate": {
      const url = resolveUrl(baseUrl, substituteParams(step.url, inputs));
      const result = await surface.navigate(url);
      return {
        stepId: step.stepId,
        action: "navigate",
        attempt: 1,
        outcome: result.ok
          ? { status: "ok", value: result.value.url }
          : { status: "error", code: result.error.code, message: result.error.message },
      };
    }
    case "click": {
      const result = await surface.click(step.target);
      return {
        stepId: step.stepId,
        action: "click",
        attempt: 1,
        outcome: result.ok ? { status: "ok" } : { status: "error", code: result.error.code, message: result.error.message },
      };
    }
    case "type": {
      const value = substituteParams(step.value, inputs);
      const result = await surface.type(step.target, value);
      return {
        stepId: step.stepId,
        action: "type",
        attempt: 1,
        outcome: result.ok ? { status: "ok" } : { status: "error", code: result.error.code, message: result.error.message },
      };
    }
    case "read": {
      const result = await surface.read(step.target);
      return {
        stepId: step.stepId,
        action: "read",
        attempt: 1,
        outcome: result.ok
          ? { status: "ok", value: result.value }
          : { status: "error", code: result.error.code, message: result.error.message },
      };
    }
    default: {
      const unsupported = step as unknown as { action: string; stepId: number };
      return {
        stepId: unsupported.stepId,
        action: unsupported.action as ArtifactStep["action"],
        attempt: 1,
        outcome: { status: "error", code: "UNKNOWN_ACTION", message: `Unsupported step action "${unsupported.action}".` },
      };
    }
  }
}

export async function replayArtifact(input: ReplayArtifactInput): Promise<ReplayResult> {
  const runId = input.runId ?? randomUUID();
  const startedAt = new Date().toISOString();
  const clock = input.clock ?? Date.now;
  const startTime = clock();
  const timeoutMs = input.config?.timeoutMs ?? DEFAULT_REPLAY_TIMEOUT_MS;
  const maxRetries = input.config?.maxRetries ?? DEFAULT_REPLAY_MAX_RETRIES;

  // Set once policy is resolved (or left undefined if no policy gate was
  // supplied at all) and carried on every finish() call from that point
  // on, so evidence always shows what was decided, win or lose.
  let policyRecord: ReplayPolicyRecord | undefined;

  function finish(status: ReplayFinalStatus, partial: Partial<ReplayResult> = {}): ReplayResult {
    return {
      runId,
      artifactId: partial.artifactId ?? "(unknown)",
      artifactVersion: partial.artifactVersion ?? "(unknown)",
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: clock() - startTime,
      inputs: input.inputs,
      steps: partial.steps ?? [],
      outputs: partial.outputs ?? {},
      checkpoint: partial.checkpoint,
      policy: partial.policy ?? policyRecord,
      outcomeClassification: partial.outcomeClassification,
      status,
      error: partial.error,
    };
  }

  // 1. Validate artifact — before anything else, and before any Surface
  // call or policy check (an invalid artifact has no reliable target/risk
  // level to classify in the first place).
  const validation = validateArtifact(input.artifact);
  if (!validation.valid) {
    const message = validation.errors.map((e) => `${e.path}: ${e.message}`).join("; ");
    return finish("invalid_artifact", { error: { code: "INVALID_ARTIFACT", message } });
  }
  const artifact: Artifact = validation.artifact;

  // 1b. Policy gate (Phase 8) — resolved once, before any Surface call,
  // matching the "approve-once" design: a risky artifact is approved or
  // denied for the whole run, not re-asked per step.
  let effectiveSurface = input.surface;
  if (input.policy) {
    const classification = input.policy.guard.classify({
      baseUrl: artifact.target.baseUrl,
      riskLevel: artifact.riskLevel,
    });

    if (classification === "blocked") {
      policyRecord = { riskLevel: artifact.riskLevel, classification };
      return finish("blocked", {
        artifactId: artifact.id,
        artifactVersion: artifact.version,
        error: { code: "POLICY_BLOCKED", message: `Target "${artifact.target.baseUrl}" is not in the allowlist.` },
      });
    }

    let approved = classification === "safe";
    if (classification === "approval_required") {
      const decision = await input.policy.requestApproval({
        runId,
        kind: "replay",
        summary: `${artifact.id} (v${artifact.version})`,
        reason: `Artifact "${artifact.id}" is marked riskLevel: "risky" and requires explicit approval before replay.`,
      });
      approved = decision === "approved";
      policyRecord = { riskLevel: artifact.riskLevel, classification, approvalDecision: decision };
      if (!approved) {
        return finish("blocked", {
          artifactId: artifact.id,
          artifactVersion: artifact.version,
          error: { code: "POLICY_DENIED", message: `Approval was denied for risky artifact "${artifact.id}".` },
        });
      }
    } else {
      policyRecord = { riskLevel: artifact.riskLevel, classification };
    }

    effectiveSurface = createPolicyEnforcedSurface(input.surface, input.policy.guard, {
      riskLevel: artifact.riskLevel,
      approved,
    });
  }

  // 2. Resolve runtime inputs.
  for (const declared of artifact.inputs) {
    const supplied = input.inputs[declared.name];
    if (declared.required && (supplied === undefined || supplied === "")) {
      return finish("missing_input", {
        artifactId: artifact.id,
        artifactVersion: artifact.version,
        error: { code: "MISSING_INPUT", message: `Required input "${declared.name}" was not supplied.` },
      });
    }
    if (supplied !== undefined) {
      if (declared.type === "number" && Number.isNaN(Number(supplied))) {
        return finish("invalid_input", {
          artifactId: artifact.id,
          artifactVersion: artifact.version,
          error: { code: "INVALID_INPUT", message: `Input "${declared.name}" must be a number, got "${supplied}".` },
        });
      }
      if (declared.type === "boolean" && supplied !== "true" && supplied !== "false") {
        return finish("invalid_input", {
          artifactId: artifact.id,
          artifactVersion: artifact.version,
          error: {
            code: "INVALID_INPUT",
            message: `Input "${declared.name}" must be "true" or "false", got "${supplied}".`,
          },
        });
      }
    }
  }

  // 3. Replay ordered steps, through Surface, stopping immediately on the
  // first failed required step — replay never continues past a failure
  // and never falls back to asking anything else what to do next. A
  // step whose error is classified "recoverable" (Phase 8) gets a
  // bounded number of same-step retries first — still fully
  // deterministic (the identical action, not a different one an LLM
  // might choose), just tolerant of a transient timing issue.
  const stepResults: ReplayStepResult[] = [];
  const outputs: Record<string, string> = {};

  for (const step of artifact.steps) {
    if (clock() - startTime > timeoutMs) {
      return finish("timeout", {
        artifactId: artifact.id,
        artifactVersion: artifact.version,
        steps: stepResults,
        outputs,
        error: { code: "TIMEOUT", message: `Replay exceeded ${timeoutMs}ms.` },
      });
    }

    let record: ReplayStepResult | undefined;
    for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
      const base = await executeStep(step, effectiveSurface, artifact.target.baseUrl, input.inputs);
      record = { ...base, attempt };
      stepResults.push(record);
      if (input.onStepRecorded) {
        try {
          await input.onStepRecorded(record);
        } catch {
          // Evidence capture must never be able to break a replay run.
        }
      }
      if (record.outcome.status === "ok") break;
      if (classifySurfaceError(record.outcome.code) === "hard_failure") break;
      // else: recoverable and attempts remain -> loop retries the same step
    }

    // record is always assigned — the retry loop runs at least once (maxRetries + 1 >= 1).
    if (record!.outcome.status === "error") {
      return finish(surfaceErrorToStatus(record!.outcome.code), {
        artifactId: artifact.id,
        artifactVersion: artifact.version,
        steps: stepResults,
        outputs,
        error: { code: record!.outcome.code, message: record!.outcome.message },
      });
    }

    if (step.action === "read" && record!.outcome.value !== undefined) {
      outputs[step.outputRef] = record!.outcome.value;
    }
  }

  // 4. Observe/check results, then checkpoint validation — evaluated
  // fresh, separately from any individual step's own success, so a run
  // whose steps all returned {ok: true} but which ended up on the wrong
  // page or missing the expected text still does not count as success.
  const finalObservation = await effectiveSurface.observe();
  if (!finalObservation.ok) {
    return finish("unexpected_page_state", {
      artifactId: artifact.id,
      artifactVersion: artifact.version,
      steps: stepResults,
      outputs,
      error: { code: finalObservation.error.code, message: finalObservation.error.message },
    });
  }

  const checkpointResult = await evaluateCheckpoint(
    artifact.checkpoint,
    effectiveSurface,
    finalObservation.value.url,
    finalObservation.value.text,
    input.inputs,
  );

  if (!checkpointResult.satisfied) {
    // Phase 8: a failed checkpoint isn't automatically a hard failure —
    // check the artifact's declared businessOutcomes[] before concluding
    // that. See classify-outcome.ts.
    const classification = await classifyReplayOutcome(
      artifact,
      effectiveSurface,
      finalObservation.value.url,
      finalObservation.value.text,
      input.inputs,
    );

    if (classification.kind === "business_outcome") {
      return finish("business_outcome", {
        artifactId: artifact.id,
        artifactVersion: artifact.version,
        steps: stepResults,
        outputs,
        checkpoint: checkpointResult,
        outcomeClassification: classification,
      });
    }

    return finish("checkpoint_mismatch", {
      artifactId: artifact.id,
      artifactVersion: artifact.version,
      steps: stepResults,
      outputs,
      checkpoint: checkpointResult,
      outcomeClassification: classification,
      error: { code: "CHECKPOINT_MISMATCH", message: "One or more checkpoint conditions were not satisfied." },
    });
  }

  return finish("success", {
    artifactId: artifact.id,
    artifactVersion: artifact.version,
    steps: stepResults,
    outputs,
    checkpoint: checkpointResult,
    outcomeClassification: { kind: "success" },
  });
}
