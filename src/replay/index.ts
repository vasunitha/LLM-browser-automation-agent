/**
 * Deterministic replay engine — public entry point (Phase 7; extended
 * Phase 8 with a real PolicyGuard/HandoffController wired in by default).
 *
 * Given a saved artifact id and runtime inputs, replays it deterministically
 * through a live Surface — no LLM anywhere in this module or anything it
 * imports (it never references an LLM provider SDK, the discovery agent
 * module, or any model-provider credential/config — see
 * tests/unit/replay-no-llm.test.ts for the explicit proof). Composition
 * mirrors src/agent/index.ts: a real PlaywrightSurface by default (or a
 * fake via `dependencies` for tests), the core engine (now including the
 * Phase 8 policy gate), then evidence capture — each piece independently
 * unit-testable.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Artifact } from "../artifact/types";
import { createPlaywrightSurface } from "../surface/playwright-surface";
import type { Surface } from "../surface/types";
import { loadConfig } from "../config/env";
import { PolicyGuard } from "../safety/policy-guard";
import { HandoffController, createCliApprovalDecider, type ApprovalDecider } from "../handoff";
import { replayArtifact } from "./engine";
import { writeReplayEvidence, type EvidenceScreenshot } from "./evidence";
import type { ReplayConfig, ReplayResult, ReplayStepResult } from "./types";

const DEFAULT_ARTIFACTS_DIR = "./artifacts";

export interface RunReplayInput {
  artifactId: string;
  inputs: Record<string, string>;
  config?: ReplayConfig;
}

export interface RunReplayDependencies {
  /** Supply a fake/pre-built Surface for tests — real runs create and own a PlaywrightSurface. */
  surface?: Surface;
  artifactsDir?: string;
  evidenceDir?: string;
  clock?: () => number;
  runId?: string;
  /** Supply a fake decider for tests — real runs prompt on the CLI by default (see src/handoff/cli-decider.ts). */
  approvalDecider?: ApprovalDecider;
  /** Supply a fake/pre-built PolicyGuard for tests — real runs build one from ALLOWLIST_BASE_URL (src/config/env.ts) by default. */
  policyGuard?: PolicyGuard;
}

export interface RunReplayResult {
  result: ReplayResult;
  evidenceDir: string;
}

function readArtifactFile(artifactsDir: string, artifactId: string): unknown {
  const path = join(artifactsDir, `${artifactId}.json`);
  if (!existsSync(path)) {
    // Deliberately shaped to fail validateArtifact() with a clear message
    // rather than throwing — a missing artifact file is handled by the
    // exact same "invalid artifact fails cleanly" contract as a malformed
    // one, not a special case.
    return { id: artifactId, __notFound: `No artifact file found at "${path}".` };
  }
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    return { id: artifactId, __malformedJson: err instanceof Error ? err.message : String(err) };
  }
}

export async function runReplay(
  input: RunReplayInput,
  dependencies: RunReplayDependencies = {},
): Promise<RunReplayResult> {
  const envConfig = loadConfig();
  const artifactsDir = dependencies.artifactsDir ?? DEFAULT_ARTIFACTS_DIR;

  const ownsSurface = dependencies.surface === undefined;
  const surface = dependencies.surface ?? (await createPlaywrightSurface({ headless: true }));

  const guard = dependencies.policyGuard ?? new PolicyGuard({ allowedBaseUrls: [envConfig.allowlistBaseUrl] });
  const handoff = new HandoffController(dependencies.approvalDecider ?? createCliApprovalDecider());

  try {
    const rawArtifact = readArtifactFile(artifactsDir, input.artifactId);
    const stepScreenshots: EvidenceScreenshot[] = [];

    const result = await replayArtifact({
      artifact: rawArtifact,
      inputs: input.inputs,
      surface,
      config: input.config,
      runId: dependencies.runId,
      clock: dependencies.clock,
      policy: { guard, requestApproval: (request) => handoff.requestApproval(request) },
      onStepRecorded: async (record: ReplayStepResult) => {
        const shot = await surface.screenshot();
        if (shot.ok) {
          stepScreenshots.push({ label: `step-${record.stepId}-attempt-${record.attempt}`, base64: shot.value.base64 });
        }
      },
    });

    let finalShot: EvidenceScreenshot | undefined;
    try {
      const shot = await surface.screenshot();
      if (shot.ok) finalShot = { label: "final", base64: shot.value.base64 };
    } catch {
      // Best-effort — evidence capture must never fail the run.
    }

    // Only attach the artifact snapshot once it's known to have validated
    // (result.status !== "invalid_artifact") — otherwise rawArtifact may
    // not even be a well-formed Artifact shape. A "blocked" result still
    // validated fine (the block happens after validation), so it still
    // gets a snapshot.
    const artifact: Artifact | undefined =
      result.status !== "invalid_artifact" ? (rawArtifact as Artifact) : undefined;

    const evidenceDir = writeReplayEvidence({
      evidenceDir: dependencies.evidenceDir ?? envConfig.evidenceDir,
      result,
      artifact,
      screenshots: finalShot ? [...stepScreenshots, finalShot] : stepScreenshots,
    });

    return { result, evidenceDir };
  } finally {
    if (ownsSurface) {
      await surface.close();
    }
  }
}

export type { ReplayArtifactInput, ReplayPolicyOptions } from "./engine";
export { replayArtifact, executeStep } from "./engine";
export type {
  ReplayResult,
  ReplayStepResult,
  ReplayStepOutcome,
  ReplayCheckpointResult,
  ReplayCheckpointConditionResult,
  ReplayFinalStatus,
  ReplayConfig,
  ReplayError,
  ReplayPolicyRecord,
  ReplayOutcomeClassification,
} from "./types";
export { writeReplayEvidence } from "./evidence";
export type { EvidenceScreenshot } from "./evidence";
export { substituteParams } from "./substitute";
export { evaluateCheckpoint } from "./checkpoint";
export { classifyReplayOutcome } from "./classify-outcome";
export type { OutcomeClassificationResult, ReplayOutcomeKind } from "./classify-outcome";
