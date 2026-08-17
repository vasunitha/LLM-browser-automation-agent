/**
 * Replay evidence writer (Phase 7).
 *
 * Writes curated, reviewable evidence for one replay run under
 * `evidence/replay/<run-id>/` — a structured result, a snapshot of the
 * exact artifact that was replayed, per-step screenshots, and a
 * human-readable summary that states plainly, up front, that this was a
 * deterministic replay with no LLM involved — see PROJECT_PLAN.md ->
 * "Evidence directory policy".
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Artifact } from "../artifact/types";
import { toJson } from "../artifact/serialize";
import type { ReplayResult } from "./types";

const DEFAULT_EVIDENCE_ROOT = "./evidence";

// Defense in depth, mirroring src/agent/evidence.ts — a ReplayResult
// should never contain a key by construction (replay never reads any
// model-provider credential at all), but this redaction pass runs
// regardless.
const SECRET_PATTERNS = [/sk-ant-[A-Za-z0-9_-]{10,}/g, /sk-[A-Za-z0-9]{20,}/g];

function redactString(value: string): string {
  return SECRET_PATTERNS.reduce((acc, pattern) => acc.replace(pattern, "[REDACTED]"), value);
}

function redactDeep(value: unknown): unknown {
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map(redactDeep);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = redactDeep(entry);
    }
    return out;
  }
  return value;
}

function buildSummaryMarkdown(result: ReplayResult, artifact?: Artifact): string {
  const lines: string[] = [];
  lines.push(`# Replay run ${result.runId}`);
  lines.push("");
  lines.push(
    "**This is a deterministic replay — no LLM was invoked to decide any action.** " +
      "Every step below executed the artifact's own pre-recorded, ordered steps with " +
      "runtime inputs substituted in; nothing was decided live. See " +
      "ARCHITECTURE.md -> \"Deterministic replay engine\" for the guarantee and how it's tested.",
  );
  lines.push("");
  lines.push(`- **Artifact:** \`${result.artifactId}\` (version ${result.artifactVersion})`);
  lines.push(`- **Inputs:** ${JSON.stringify(result.inputs)}`);
  lines.push(`- **Status:** ${result.status}`);
  lines.push(`- **Started:** ${result.startedAt}`);
  lines.push(`- **Duration:** ${result.durationMs}ms`);
  lines.push("");

  if (result.policy) {
    lines.push("## Safety / approval decision (Phase 8)", "");
    lines.push(`- **Risk level:** ${result.policy.riskLevel}`);
    lines.push(`- **Classification:** ${result.policy.classification}`);
    if (result.policy.approvalDecision) {
      lines.push(`- **Approval decision:** ${result.policy.approvalDecision}`);
    }
    lines.push("");
  }

  lines.push("## Step outcomes", "");
  if (result.steps.length === 0) {
    lines.push("(no steps executed — the run was blocked, or stopped before/during input resolution)");
  }
  result.steps.forEach((step) => {
    const outcome =
      step.outcome.status === "ok"
        ? step.outcome.value !== undefined
          ? `ok — "${step.outcome.value}"`
          : "ok"
        : `error [${step.outcome.code}] ${step.outcome.message}`;
    const attemptSuffix = step.attempt > 1 ? ` (attempt ${step.attempt})` : "";
    lines.push(`${step.stepId}. **${step.action}**${attemptSuffix} -> ${outcome}`);
  });
  lines.push("");

  if (result.checkpoint) {
    lines.push("## Checkpoint", "");
    result.checkpoint.conditions.forEach((c) => {
      lines.push(`- \`${c.condition.type}\`: ${c.satisfied ? "satisfied" : `NOT satisfied${c.detail ? ` — ${c.detail}` : ""}`}`);
    });
    lines.push("");
  }

  if (Object.keys(result.outputs).length > 0) {
    lines.push("## Outputs", "", "```json", JSON.stringify(result.outputs, null, 2), "```", "");
  }

  if (result.outcomeClassification && result.outcomeClassification.kind === "business_outcome") {
    lines.push("## Business outcome", "");
    lines.push(
      `- **${result.outcomeClassification.businessOutcomeCode}**: ${result.outcomeClassification.businessOutcomeDescription}`,
    );
    lines.push(
      "- This is a declared, expected non-success result (see the artifact's `businessOutcomes`), not a hard failure.",
    );
    lines.push("");
  }

  if (result.error) {
    lines.push("## Error", "", `[${result.error.code}] ${result.error.message}`, "");
  }

  if (artifact) {
    lines.push("## Replayed artifact", "");
    lines.push(`- id: \`${artifact.id}\`, version: ${artifact.version}, riskLevel: ${artifact.riskLevel}`);
    lines.push("- See `artifact.json` in this directory for the exact artifact that was replayed.");
    lines.push("");
  }

  return lines.join("\n");
}

export interface EvidenceScreenshot {
  label: string;
  base64: string;
}

export interface WriteReplayEvidenceInput {
  evidenceDir?: string;
  result: ReplayResult;
  /** A snapshot of the artifact actually replayed — frozen here since artifacts/*.json can be overwritten by a later discovery run. */
  artifact?: Artifact;
  screenshots?: EvidenceScreenshot[];
}

/** Writes one replay run's curated evidence and returns the run's directory path. */
export function writeReplayEvidence(input: WriteReplayEvidenceInput): string {
  const root = input.evidenceDir ?? DEFAULT_EVIDENCE_ROOT;
  const runDir = join(root, "replay", input.result.runId);
  const screenshotsDir = join(runDir, "screenshots");

  mkdirSync(screenshotsDir, { recursive: true });

  writeFileSync(join(runDir, "result.json"), JSON.stringify(redactDeep(input.result), null, 2), "utf8");

  if (input.artifact) {
    writeFileSync(join(runDir, "artifact.json"), toJson(input.artifact), "utf8");
  }

  (input.screenshots ?? []).forEach((shot, index) => {
    const filename = `${String(index).padStart(2, "0")}-${shot.label}.png`;
    writeFileSync(join(screenshotsDir, filename), Buffer.from(shot.base64, "base64"));
  });

  writeFileSync(join(runDir, "summary.md"), buildSummaryMarkdown(input.result, input.artifact), "utf8");

  return runDir;
}
