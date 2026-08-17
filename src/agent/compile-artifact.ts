/**
 * Deterministic artifact compilation from a successful discovery trace
 * (Phase 6).
 *
 * This is intentionally NOT a second LLM pass — see ARCHITECTURE.md's
 * "Artifact authoring" trade-off (decided back in Phase 1/2 planning and
 * still followed here): the agent's own declared `inputRef`/`outputRef`
 * tool arguments, recorded on each successful step, are read back
 * mechanically to build typed inputs/outputs and a parameterized
 * checkpoint. Only the successful path is compiled — steps whose Surface
 * outcome was an error are exploration noise, not part of the reusable
 * capability, and are dropped here (see loop.ts: an ordinary Surface
 * error doesn't end the run, it's just fed back to the model as history).
 */
import type {
  Artifact,
  ArtifactInput,
  ArtifactOutput,
  ArtifactStep,
  RiskLevel,
} from "../artifact/types";
import { SUPPORTED_SCHEMA_VERSIONS } from "../artifact/types";
import { validateArtifact } from "../artifact/validate";
import type { DiscoveryTrace } from "./types";

export interface CompileArtifactOptions {
  capabilityId: string;
  name?: string;
  description?: string;
  appId?: string;
  riskLevel?: RiskLevel;
  version?: string;
  createdAt?: string;
}

function titleCase(id: string): string {
  return id
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}

function pathnameOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

/** Replaces every literal occurrence of a declared input's example value with its "{{name}}" reference — longest values first, to avoid a shorter value's replacement corrupting a longer one that contains it. */
function parameterize(text: string, inputs: ArtifactInput[]): string {
  const byDescendingLength = [...inputs].sort((a, b) => (b.example?.length ?? 0) - (a.example?.length ?? 0));
  let result = text;
  for (const input of byDescendingLength) {
    if (input.example) {
      result = result.split(input.example).join(`{{${input.name}}}`);
    }
  }
  return result;
}

export function compileArtifactFromTrace(trace: DiscoveryTrace, options: CompileArtifactOptions): Artifact {
  const finalOutcome = trace.finalOutcome;
  if (finalOutcome.status !== "success") {
    throw new Error(
      `Cannot compile an artifact from a non-successful discovery trace (finalOutcome.status: "${finalOutcome.status}").`,
    );
  }

  const inputs: ArtifactInput[] = [];
  const seenInputNames = new Set<string>();
  const artifactSteps: ArtifactStep[] = [];
  const readStepIdByOutputRef = new Map<string, number>();
  let nextStepId = 1;

  // The loop's own bootstrap navigation (to goal.targetBaseUrl) happens
  // before the LLM ever decides anything, so it isn't in trace.steps —
  // synthesized here as the artifact's first step, matching the pattern
  // of both Phase 5 example artifacts.
  artifactSteps.push({
    stepId: nextStepId++,
    action: "navigate",
    description: "Open the target application.",
    url: "/",
  });

  for (const step of trace.steps) {
    if (step.outcome.status !== "ok") continue;
    const action = step.action;

    switch (action.action) {
      case "navigate":
        artifactSteps.push({ stepId: nextStepId, action: "navigate", url: action.url });
        nextStepId += 1;
        break;
      case "click":
        artifactSteps.push({ stepId: nextStepId, action: "click", target: action.target });
        nextStepId += 1;
        break;
      case "type":
        if (!seenInputNames.has(action.inputRef)) {
          seenInputNames.add(action.inputRef);
          inputs.push({
            name: action.inputRef,
            type: "string",
            required: true,
            description: `Discovered input "${action.inputRef}", parameterized from a live discovery run.`,
            example: action.value,
          });
        }
        artifactSteps.push({
          stepId: nextStepId,
          action: "type",
          target: action.target,
          value: `{{${action.inputRef}}}`,
        });
        nextStepId += 1;
        break;
      case "read":
        artifactSteps.push({
          stepId: nextStepId,
          action: "read",
          target: action.target,
          outputRef: action.outputRef,
        });
        readStepIdByOutputRef.set(action.outputRef, nextStepId);
        nextStepId += 1;
        break;
    }
  }

  const outputs: ArtifactOutput[] = Object.keys(finalOutcome.outputs).map((name) => {
    const sourceStepId = readStepIdByOutputRef.get(name);
    if (sourceStepId === undefined) {
      // loop.ts only lets finish() succeed when every outputRef traces back
      // to an actual successful read step this run, so this indicates a
      // real bug in the compiler, not bad input from the model.
      throw new Error(`Internal error: no compiled "read" step produced output "${name}".`);
    }
    return {
      name,
      type: "string",
      sourceStepId,
      description: `Discovered output "${name}", parameterized from a live discovery run.`,
    };
  });

  const checkpointPattern = parameterize(pathnameOf(finalOutcome.finalUrl), inputs);

  const artifact: Artifact = {
    schemaVersion: SUPPORTED_SCHEMA_VERSIONS[0],
    id: options.capabilityId,
    name: options.name ?? titleCase(options.capabilityId),
    description:
      options.description ?? `Discovered by the Phase 6 LLM agent for the goal: "${trace.goal}"`,
    version: options.version ?? "1.0.0",
    createdAt: options.createdAt ?? new Date().toISOString(),
    riskLevel: options.riskLevel ?? "safe",
    target: {
      appId: options.appId ?? "credit-union-teller-console",
      baseUrl: trace.target.baseUrl,
      surfaceType: "web",
    },
    inputs,
    outputs,
    steps: artifactSteps,
    checkpoint: {
      description: "Verified against the discovery run's final URL and a confirmed on-page text snippet.",
      all: [
        { type: "urlMatches", pattern: checkpointPattern },
        { type: "textPresent", text: finalOutcome.checkpointText },
      ],
    },
    // Establishing business outcomes requires observing multiple divergent
    // runs (member-not-found, validation errors, etc.), which a single
    // successful discovery run never exercises — left empty rather than
    // fabricated, the same "don't invent what wasn't earned" reasoning
    // already applied to open-sub-account.json's empty outputs in Phase 5.
    businessOutcomes: [],
  };

  const result = validateArtifact(artifact);
  if (!result.valid) {
    const summary = result.errors.map((e) => `${e.path}: ${e.message}`).join("; ");
    throw new Error(`Compiled artifact failed validation (this indicates a compiler bug): ${summary}`);
  }

  return result.artifact;
}
