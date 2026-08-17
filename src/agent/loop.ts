/**
 * The bounded discovery loop (Phase 6):
 *
 *   observe -> decide (LLM) -> validate -> act (Surface) -> observe -> ...
 *
 * until the model calls finish()/fail(), an invalid decision is received,
 * max steps or a timeout is hit, or an unrecoverable Surface error occurs.
 * This function only depends on the Surface and LlmClient *interfaces* —
 * never Playwright, never the Anthropic SDK directly — so it can be
 * exercised deterministically in tests with fakes for both (see
 * tests/unit/agent-loop.test.ts).
 */
import { randomUUID } from "node:crypto";
import type { Surface, SurfaceResult } from "../surface/types";
import { classifySurfaceError } from "../safety/classify-failure";
import { createPolicyEnforcedSurface } from "../safety/policy-surface";
import type { PolicyGuard } from "../safety/policy-guard";
import type { ApprovalDecider, ApprovalRequest } from "../handoff/types";
import type { LlmClient } from "./llm-client";
import { summarizeObservation } from "./observe";
import { validateAgentAction } from "./validate-action";
import {
  DEFAULT_MAX_STEPS,
  DEFAULT_TIMEOUT_MS,
  type AgentAction,
  type DiscoveryConfig,
  type DiscoveryFinalOutcome,
  type DiscoveryGoal,
  type DiscoveryModelInfo,
  type DiscoveryPolicyRecord,
  type DiscoveryStepRecord,
  type DiscoveryTrace,
  type ObservationSummary,
  type StepOutcome,
} from "./types";

/** Optional Phase 8 policy gate. Omitted entirely, runDiscoveryLoop() behaves exactly as it did in Phase 6/7 (no policy enforcement at all) — preserves every existing caller/test. src/agent/index.ts supplies this by default for real runs. */
export interface DiscoveryPolicyOptions {
  guard: PolicyGuard;
  requestApproval: (request: ApprovalRequest) => ReturnType<ApprovalDecider>;
}

export interface DiscoveryLoopInput {
  surface: Surface;
  llmClient: LlmClient;
  goal: DiscoveryGoal;
  modelInfo: DiscoveryModelInfo;
  config?: DiscoveryConfig;
  /** Overridable for deterministic tests — defaults to a fresh UUID. */
  runId?: string;
  /** Overridable for deterministic tests — defaults to the current ISO time. */
  timestamp?: string;
  /** Overridable for deterministic timeout tests — defaults to Date.now. */
  clock?: () => number;
  /**
   * Fired after each step is recorded, mainly so the real orchestration
   * layer (src/agent/index.ts) can capture a Surface screenshot per step
   * for evidence without this module taking on any filesystem/base64
   * concerns itself. Errors thrown here are swallowed — evidence capture
   * must never be able to break a discovery run.
   */
  onStepRecorded?: (record: DiscoveryStepRecord) => void | Promise<void>;
  policy?: DiscoveryPolicyOptions;
}

function resolveUrl(base: string, url: string): string {
  try {
    return new URL(url, base).toString();
  } catch {
    return url;
  }
}

/**
 * Normalizes whitespace before a checkpointText substring match. Found via
 * a real discovery run: Claude sometimes quotes a multi-line snippet with
 * a literal two-character "\n" (backslash + n) inside the tool-call string
 * instead of an actual newline byte — visually identical to a human, but a
 * byte-exact .includes() then fails even though the model is quoting the
 * real page content. Collapsing all whitespace (and any literal \n/\r
 * escapes) to single spaces on both sides keeps the check a genuine
 * "is this text really on the page" verification without being brittle to
 * that formatting difference.
 */
function normalizeForCheckpointMatch(text: string): string {
  return text
    .replace(/\\n|\\r/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function surfaceResultToOutcome<T>(result: SurfaceResult<T>, valueOf?: (value: T) => string): StepOutcome {
  if (result.ok) {
    return valueOf ? { status: "ok", value: valueOf(result.value) } : { status: "ok" };
  }
  return { status: "error", code: result.error.code, message: result.error.message };
}

async function executeSurfaceAction(
  surface: Surface,
  action: Extract<AgentAction, { action: "navigate" | "click" | "type" | "read" }>,
  baseUrl: string,
): Promise<StepOutcome> {
  switch (action.action) {
    case "navigate":
      return surfaceResultToOutcome(
        await surface.navigate(resolveUrl(baseUrl, action.url)),
        (v) => v.url,
      );
    case "click":
      return surfaceResultToOutcome(await surface.click(action.target));
    case "type":
      return surfaceResultToOutcome(await surface.type(action.target, action.value));
    case "read":
      return surfaceResultToOutcome(await surface.read(action.target), (v) => v);
  }
}

function findMostRecentSuccessfulRead(
  steps: DiscoveryStepRecord[],
  outputRef: string,
): string | undefined {
  for (let i = steps.length - 1; i >= 0; i -= 1) {
    const step = steps[i];
    if (step.action.action === "read" && step.action.outputRef === outputRef && step.outcome.status === "ok") {
      return step.outcome.value;
    }
  }
  return undefined;
}

export async function runDiscoveryLoop(input: DiscoveryLoopInput): Promise<DiscoveryTrace> {
  const { llmClient, goal, modelInfo } = input;
  const maxSteps = input.config?.maxSteps ?? DEFAULT_MAX_STEPS;
  const timeoutMs = input.config?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const clock = input.clock ?? Date.now;
  const runId = input.runId ?? randomUUID();
  const timestamp = input.timestamp ?? new Date().toISOString();
  const riskLevel = goal.riskLevel ?? "safe";

  const steps: DiscoveryStepRecord[] = [];
  // Definite-assignment assertion: every exit path below (return/break)
  // assigns this before buildTrace() reads it via closure — TS can't see
  // that across the closure boundary on its own.
  let finalOutcome!: DiscoveryFinalOutcome;
  let policyRecord: DiscoveryPolicyRecord | undefined;

  async function recordStep(record: DiscoveryStepRecord): Promise<void> {
    steps.push(record);
    if (input.onStepRecorded) {
      try {
        await input.onStepRecorded(record);
      } catch {
        // Evidence capture must never be able to break a discovery run.
      }
    }
  }

  const startTime = clock();

  // 0. Policy gate (Phase 8) — resolved once, before the bootstrap
  // navigate or any other Surface call, mirroring the replay engine's
  // gate: an approve-once decision for the whole run, not per action.
  let surface = input.surface;
  if (input.policy) {
    const classification = input.policy.guard.classify({ baseUrl: goal.targetBaseUrl, riskLevel });

    if (classification === "blocked") {
      policyRecord = { riskLevel, classification };
      finalOutcome = { status: "blocked", reason: `Target "${goal.targetBaseUrl}" is not in the allowlist.` };
      return buildTrace();
    }

    let approved = classification === "safe";
    if (classification === "approval_required") {
      const decision = await input.policy.requestApproval({
        runId,
        kind: "discovery",
        summary: goal.goal,
        reason: `Goal is marked riskLevel: "risky" and requires explicit approval before discovery.`,
      });
      approved = decision === "approved";
      policyRecord = { riskLevel, classification, approvalDecision: decision };
      if (!approved) {
        finalOutcome = { status: "blocked", reason: `Approval was denied for this risky discovery goal.` };
        return buildTrace();
      }
    } else {
      policyRecord = { riskLevel, classification };
    }

    surface = createPolicyEnforcedSurface(input.surface, input.policy.guard, { riskLevel, approved });
  }

  const initialNav = await surface.navigate(goal.targetBaseUrl);
  if (!initialNav.ok) {
    finalOutcome = { status: "surface_error", code: initialNav.error.code, message: initialNav.error.message };
    return buildTrace();
  }

  let stepNumber = 1;

  while (true) {
    if (clock() - startTime > timeoutMs) {
      finalOutcome = { status: "timeout" };
      break;
    }
    if (stepNumber > maxSteps) {
      finalOutcome = { status: "max_steps_exceeded" };
      break;
    }

    const obs = await surface.observe();
    if (!obs.ok) {
      finalOutcome = { status: "surface_error", code: obs.error.code, message: obs.error.message };
      break;
    }
    const observationSummary: ObservationSummary = summarizeObservation(obs.value);

    let rawDecision: unknown;
    try {
      rawDecision = await llmClient.decide({
        goal: goal.goal,
        stepNumber,
        maxSteps,
        observation: observationSummary,
        history: steps,
      });
    } catch (err) {
      finalOutcome = { status: "llm_error", message: err instanceof Error ? err.message : String(err) };
      break;
    }

    const validated = validateAgentAction(rawDecision);
    if (!validated.valid) {
      finalOutcome = {
        status: "invalid_action",
        message: validated.errors.map((e) => `${e.path}: ${e.message}`).join("; "),
      };
      break;
    }
    const action = validated.action;

    if (action.action === "fail") {
      await recordStep({ stepNumber, observation: observationSummary, action, outcome: { status: "ok" } });
      finalOutcome = { status: "failure", reason: action.reason };
      break;
    }

    if (action.action === "finish") {
      if (
        !normalizeForCheckpointMatch(observationSummary.visibleText).includes(
          normalizeForCheckpointMatch(action.checkpointText),
        )
      ) {
        await recordStep({
          stepNumber,
          observation: observationSummary,
          action,
          outcome: {
            status: "error",
            code: "CHECKPOINT_NOT_VERIFIED",
            message: "checkpointText was not found in the current page's visible text.",
          },
        });
        finalOutcome = {
          status: "invalid_action",
          message: `finish() checkpointText "${action.checkpointText}" was not found in the current observation.`,
        };
        break;
      }

      const outputs: Record<string, string> = {};
      let missingRef: string | undefined;
      for (const ref of action.outputRefs) {
        const value = findMostRecentSuccessfulRead(steps, ref);
        if (value === undefined) {
          missingRef = ref;
          break;
        }
        outputs[ref] = value;
      }

      if (missingRef !== undefined) {
        await recordStep({
          stepNumber,
          observation: observationSummary,
          action,
          outcome: {
            status: "error",
            code: "OUTPUT_REF_NOT_FOUND",
            message: `outputRef "${missingRef}" was not produced by a prior successful read action.`,
          },
        });
        finalOutcome = {
          status: "invalid_action",
          message: `finish() referenced outputRef "${missingRef}", which was never successfully read this run.`,
        };
        break;
      }

      await recordStep({ stepNumber, observation: observationSummary, action, outcome: { status: "ok" } });
      finalOutcome = {
        status: "success",
        outputs,
        checkpointText: action.checkpointText,
        finalUrl: observationSummary.url,
      };
      break;
    }

    const outcome = await executeSurfaceAction(surface, action, goal.targetBaseUrl);
    await recordStep({ stepNumber, observation: observationSummary, action, outcome });

    // A "hard_failure"-classified Surface error (Phase 8's shared
    // recoverable/hard classifier — see src/safety/classify-failure.ts;
    // today that's SESSION_CLOSED and POLICY_BLOCKED) is unrecoverable —
    // everything else (element not found, a timed-out click, a failed
    // navigation) is recorded and fed back into the next decide() call's
    // history so the model can see the failure and try a different
    // locator/approach, bounded by maxSteps/timeoutMs either way.
    if (outcome.status === "error" && classifySurfaceError(outcome.code) === "hard_failure") {
      finalOutcome = { status: "surface_error", code: outcome.code, message: outcome.message };
      break;
    }

    stepNumber += 1;
  }

  return buildTrace();

  function buildTrace(): DiscoveryTrace {
    return {
      runId,
      timestamp,
      goal: goal.goal,
      target: { baseUrl: goal.targetBaseUrl },
      model: modelInfo,
      config: { maxSteps, timeoutMs },
      policy: policyRecord,
      steps,
      finalOutcome,
    };
  }
}
