/**
 * Discovery agent — public entry point (Phase 6; extended Phase 8 with a
 * real PolicyGuard/HandoffController wired in by default).
 *
 * Wires the pieces together for a real run: a live PlaywrightSurface, the
 * real Anthropic-backed LlmClient, the bounded discovery loop (now
 * including the Phase 8 policy gate), deterministic artifact compilation
 * on success, and evidence capture — every one of those pieces is
 * independently unit-testable (see loop.ts, llm-client.ts,
 * compile-artifact.ts, evidence.ts) via the `dependencies` override below,
 * so this file itself stays a thin composition, not new logic.
 */
import type { Artifact } from "../artifact/types";
import { ArtifactStore } from "../artifact/store";
import { createPlaywrightSurface } from "../surface/playwright-surface";
import type { Surface } from "../surface/types";
import { loadConfig, type AppConfig } from "../config/env";
import { PolicyGuard } from "../safety/policy-guard";
import { HandoffController, createCliApprovalDecider, type ApprovalDecider } from "../handoff";
import { compileArtifactFromTrace } from "./compile-artifact";
import { writeDiscoveryEvidence, type EvidenceScreenshot } from "./evidence";
import { createAnthropicLlmClient, type LlmClient } from "./llm-client";
import { runDiscoveryLoop } from "./loop";
import type { DiscoveryConfig, DiscoveryGoal, DiscoveryModelInfo, DiscoveryResult } from "./types";

export interface RunDiscoveryDependencies {
  /** Supply a fake/pre-built Surface for tests — real runs create and own a PlaywrightSurface. */
  surface?: Surface;
  /** Supply a fake LlmClient for tests — real runs build one from ANTHROPIC_API_KEY/ANTHROPIC_MODEL. */
  llmClient?: LlmClient;
  modelInfo?: DiscoveryModelInfo;
  evidenceDir?: string;
  artifactsDir?: string;
  clock?: () => number;
  runId?: string;
  timestamp?: string;
  /** Supply a fake decider for tests — real runs prompt on the CLI by default (see src/handoff/cli-decider.ts). */
  approvalDecider?: ApprovalDecider;
  /** Supply a fake/pre-built PolicyGuard for tests — real runs build one from ALLOWLIST_BASE_URL (src/config/env.ts) by default. */
  policyGuard?: PolicyGuard;
}

function requireLlmClientFromEnv(envConfig: AppConfig): LlmClient {
  if (!envConfig.anthropicApiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Set it in .env to run real discovery, or pass a llmClient via " +
        "RunDiscoveryDependencies for tests (see tests/unit/fixtures/fake-llm-client.ts).",
    );
  }
  return createAnthropicLlmClient({ apiKey: envConfig.anthropicApiKey, model: envConfig.anthropicModel });
}

export async function runDiscovery(
  goal: DiscoveryGoal,
  config: DiscoveryConfig = {},
  dependencies: RunDiscoveryDependencies = {},
): Promise<DiscoveryResult> {
  const envConfig = loadConfig();

  const ownsSurface = dependencies.surface === undefined;
  const surface = dependencies.surface ?? (await createPlaywrightSurface({ headless: true }));
  const llmClient = dependencies.llmClient ?? requireLlmClientFromEnv(envConfig);
  const modelInfo: DiscoveryModelInfo =
    dependencies.modelInfo ?? { provider: "anthropic", model: envConfig.anthropicModel };

  const guard = dependencies.policyGuard ?? new PolicyGuard({ allowedBaseUrls: [envConfig.allowlistBaseUrl] });
  const handoff = new HandoffController(dependencies.approvalDecider ?? createCliApprovalDecider());

  try {
    const stepScreenshots: EvidenceScreenshot[] = [];

    const trace = await runDiscoveryLoop({
      surface,
      llmClient,
      goal,
      modelInfo,
      config,
      runId: dependencies.runId,
      timestamp: dependencies.timestamp,
      clock: dependencies.clock,
      policy: { guard, requestApproval: (request) => handoff.requestApproval(request) },
      onStepRecorded: async (record) => {
        const shot = await surface.screenshot();
        if (shot.ok) {
          stepScreenshots.push({ label: `step-${record.stepNumber}`, base64: shot.value.base64 });
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

    let artifact: Artifact | undefined;
    let artifactId: string | undefined;
    if (trace.finalOutcome.status === "success") {
      artifact = compileArtifactFromTrace(trace, { capabilityId: goal.capabilityId, appId: goal.appId });
      const store = new ArtifactStore(dependencies.artifactsDir);
      store.save(artifact);
      artifactId = artifact.id;
    }

    const evidenceDir = writeDiscoveryEvidence({
      evidenceDir: dependencies.evidenceDir ?? envConfig.evidenceDir,
      trace,
      artifact,
      screenshots: finalShot ? [...stepScreenshots, finalShot] : stepScreenshots,
    });

    return { trace, artifactId, evidenceDir };
  } finally {
    if (ownsSurface) {
      await surface.close();
    }
  }
}

export type {
  AgentAction,
  DiscoveryConfig,
  DiscoveryFinalOutcome,
  DiscoveryGoal,
  DiscoveryModelInfo,
  DiscoveryPolicyRecord,
  DiscoveryResult,
  DiscoveryStepRecord,
  DiscoveryTrace,
  ObservationSummary,
} from "./types";
export { compileArtifactFromTrace } from "./compile-artifact";
export { validateAgentAction } from "./validate-action";
export { summarizeObservation } from "./observe";
export { runDiscoveryLoop, type DiscoveryPolicyOptions } from "./loop";
export { createAnthropicLlmClient, LlmProviderError, type LlmClient, type DecideRequest } from "./llm-client";
export { writeDiscoveryEvidence, type EvidenceScreenshot } from "./evidence";
