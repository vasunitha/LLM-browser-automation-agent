/**
 * Discovery evidence writer (Phase 6).
 *
 * Writes curated, reviewable evidence for one discovery run under
 * `evidence/discovery/<run-id>/` — a trace, the compiled artifact (only on
 * success), per-step screenshots, and a human-readable summary. This is
 * intentionally NOT a raw model transcript dump: everything written here
 * is already the structured DiscoveryTrace loop.ts produced (goal,
 * observation summaries, chosen actions, outcomes) — see PROJECT_PLAN.md
 * -> "Evidence directory policy" for why this directory is committed
 * rather than gitignored.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Artifact } from "../artifact/types";
import { toJson } from "../artifact/serialize";
import type { AgentAction, DiscoveryTrace } from "./types";

const DEFAULT_EVIDENCE_ROOT = "./evidence";

// Defense in depth: nothing in a DiscoveryTrace should ever contain an API
// key (model metadata is {provider, model} only; observations/actions are
// derived from the live page, never from process.env) — but this redaction
// pass runs over the trace regardless before it's written, so an
// accidentally key-shaped string anywhere in a future field can never
// reach committed evidence by construction.
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

function redactTrace(trace: DiscoveryTrace): DiscoveryTrace {
  return redactDeep(trace) as DiscoveryTrace;
}

function describeAction(action: AgentAction): string {
  switch (action.action) {
    case "navigate":
      return `navigate to "${action.url}"`;
    case "click":
      return `click "${action.target.description ?? summarizeLocator(action.target)}"`;
    case "type":
      return `type into "${action.target.description ?? summarizeLocator(action.target)}" (inputRef=${action.inputRef})`;
    case "read":
      return `read "${action.target.description ?? summarizeLocator(action.target)}" (outputRef=${action.outputRef})`;
    case "finish":
      return `finish (outputRefs=${JSON.stringify(action.outputRefs)})`;
    case "fail":
      return `fail ("${action.reason}")`;
  }
}

function summarizeLocator(target: { strategies: Array<Record<string, unknown>> }): string {
  const first = target.strategies[0];
  return first ? JSON.stringify(first) : "unknown target";
}

function buildSummaryMarkdown(trace: DiscoveryTrace, artifact?: Artifact): string {
  const lines: string[] = [];
  lines.push(`# Discovery run ${trace.runId}`);
  lines.push("");
  lines.push(`- **Goal:** "${trace.goal}"`);
  lines.push(`- **Target:** ${trace.target.baseUrl}`);
  lines.push(`- **Model:** ${trace.model.provider}/${trace.model.model}`);
  lines.push(`- **Timestamp:** ${trace.timestamp}`);
  lines.push(`- **Config:** maxSteps=${trace.config.maxSteps}, timeoutMs=${trace.config.timeoutMs}`);
  lines.push(`- **LLM decision steps:** ${trace.steps.length}`);
  lines.push(`- **Final outcome:** ${trace.finalOutcome.status}`);
  lines.push("");

  if (trace.policy) {
    lines.push("## Safety / approval decision (Phase 8)", "");
    lines.push(`- **Risk level:** ${trace.policy.riskLevel}`);
    lines.push(`- **Classification:** ${trace.policy.classification}`);
    if (trace.policy.approvalDecision) {
      lines.push(`- **Approval decision:** ${trace.policy.approvalDecision}`);
    }
    lines.push("");
  }

  lines.push(
    "## Step-by-step decisions",
    "",
    "Each numbered decision below was chosen by the model from the live " +
      "observation available at that point in the run — this sequence, " +
      "not a fixed script, is the evidence that the run was genuinely " +
      "LLM-driven. Full per-step observations are in trace.json.",
    "",
  );
  trace.steps.forEach((step) => {
    const outcome =
      step.outcome.status === "ok"
        ? step.outcome.value !== undefined
          ? `ok — "${step.outcome.value}"`
          : "ok"
        : `error [${step.outcome.code}] ${step.outcome.message}`;
    lines.push(`${step.stepNumber}. **${describeAction(step.action)}** -> ${outcome}`);
  });
  lines.push("");

  if (trace.finalOutcome.status === "success") {
    lines.push("## Result", "");
    lines.push(`- Reached: ${trace.finalOutcome.finalUrl}`);
    lines.push(`- Checkpoint text confirmed on page: "${trace.finalOutcome.checkpointText}"`);
    lines.push(`- Outputs: ${JSON.stringify(trace.finalOutcome.outputs)}`);
    lines.push("");
  } else if (trace.finalOutcome.status === "blocked") {
    lines.push("## Result", "", `- Blocked before completion: ${trace.finalOutcome.reason}`, "");
  } else {
    lines.push("## Result", "", `- Did not succeed (status: ${trace.finalOutcome.status}).`, "");
  }

  if (artifact) {
    lines.push("## Generated artifact", "");
    lines.push(`- id: \`${artifact.id}\`, version: ${artifact.version}, riskLevel: ${artifact.riskLevel}`);
    lines.push(`- inputs: ${artifact.inputs.map((i) => i.name).join(", ") || "(none)"}`);
    lines.push(`- outputs: ${artifact.outputs.map((o) => o.name).join(", ") || "(none)"}`);
    lines.push("- See `artifact.json` in this directory for the full compiled artifact.");
    lines.push("");
  }

  return lines.join("\n");
}

export interface EvidenceScreenshot {
  /** Short label used in the filename, e.g. "initial", "step-3", "final". */
  label: string;
  base64: string;
}

export interface WriteDiscoveryEvidenceInput {
  evidenceDir?: string;
  trace: DiscoveryTrace;
  artifact?: Artifact;
  screenshots?: EvidenceScreenshot[];
}

/** Writes one run's curated evidence and returns the run's directory path. */
export function writeDiscoveryEvidence(input: WriteDiscoveryEvidenceInput): string {
  const root = input.evidenceDir ?? DEFAULT_EVIDENCE_ROOT;
  const runDir = join(root, "discovery", input.trace.runId);
  const screenshotsDir = join(runDir, "screenshots");

  mkdirSync(screenshotsDir, { recursive: true });

  writeFileSync(join(runDir, "trace.json"), JSON.stringify(redactTrace(input.trace), null, 2), "utf8");

  if (input.artifact) {
    writeFileSync(join(runDir, "artifact.json"), toJson(input.artifact), "utf8");
  }

  (input.screenshots ?? []).forEach((shot, index) => {
    const filename = `${String(index).padStart(2, "0")}-${shot.label}.png`;
    writeFileSync(join(screenshotsDir, filename), Buffer.from(shot.base64, "base64"));
  });

  writeFileSync(join(runDir, "summary.md"), buildSummaryMarkdown(input.trace, input.artifact), "utf8");

  return runDir;
}
