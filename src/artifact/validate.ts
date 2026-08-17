/**
 * Artifact validation (Phase 5).
 *
 * Collects every applicable error rather than stopping at the first one
 * (matches the project's existing validation style in src/app/validation.ts)
 * — useful, structured feedback for a human reviewer or a discovery/replay
 * caller, not a single opaque failure.
 */
import type {
  Artifact,
  ArtifactActionType,
  ArtifactValueType,
} from "./types";
import { ARTIFACT_TOP_LEVEL_KEYS, SUPPORTED_SCHEMA_VERSIONS } from "./types";

export interface ArtifactValidationError {
  path: string;
  message: string;
}

export type ArtifactValidationResult =
  | { valid: true; artifact: Artifact }
  | { valid: false; errors: ArtifactValidationError[] };

const VALUE_TYPES: ArtifactValueType[] = ["string", "number", "boolean"];
const ACTION_TYPES: ArtifactActionType[] = ["navigate", "type", "click", "read"];
const LOCATOR_STRATEGY_TYPES = ["role", "label", "text", "attribute", "css"];
const CHECKPOINT_CONDITION_TYPES = ["urlMatches", "elementVisible", "textPresent"];

// A well-formed parameter reference token, matched wherever it appears —
// embedded in a larger literal string is valid and expected (e.g. a
// checkpoint pattern like "/members/{{memberId}}"), not just as the
// entire value (e.g. a type step's value: "{{memberId}}").
const PARAM_REF_TOKEN = /\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g;
// Anything containing the delimiters at all is *attempting* to be a
// reference; after stripping every well-formed token, nothing resembling
// "{{" or "}}" should remain (catches "{{}}", "{{memberId", etc.).
const LOOKS_LIKE_REF = /\{\{|\}\}/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface LooseStepInfo {
  action: unknown;
  outputRef: unknown;
}

export function validateArtifact(input: unknown): ArtifactValidationResult {
  const errors: ArtifactValidationError[] = [];

  if (!isRecord(input)) {
    return { valid: false, errors: [{ path: "$", message: "Artifact must be a JSON object." }] };
  }

  // Strict schema: reject unknown top-level keys. This is what makes it
  // structurally impossible for a raw LLM transcript (or anything else
  // outside the contract) to ride along as part of an artifact.
  for (const key of Object.keys(input)) {
    if (!(ARTIFACT_TOP_LEVEL_KEYS as readonly string[]).includes(key)) {
      errors.push({ path: key, message: `Unknown field "${key}" is not part of the artifact schema.` });
    }
  }

  requireNonEmptyString(input, "id", errors);
  requireNonEmptyString(input, "name", errors);
  requireNonEmptyString(input, "description", errors);
  requireNonEmptyString(input, "version", errors);
  requireNonEmptyString(input, "createdAt", errors);

  if (typeof input.createdAt === "string" && input.createdAt.trim() !== "" && Number.isNaN(Date.parse(input.createdAt))) {
    errors.push({ path: "createdAt", message: `"${input.createdAt}" is not a valid ISO date.` });
  }

  if (typeof input.schemaVersion !== "string" || !input.schemaVersion) {
    errors.push({ path: "schemaVersion", message: "schemaVersion is required." });
  } else if (!(SUPPORTED_SCHEMA_VERSIONS as readonly string[]).includes(input.schemaVersion)) {
    errors.push({
      path: "schemaVersion",
      message: `Unsupported schema version "${input.schemaVersion}". Supported: ${SUPPORTED_SCHEMA_VERSIONS.join(", ")}.`,
    });
  }

  if (input.riskLevel !== "safe" && input.riskLevel !== "risky") {
    errors.push({ path: "riskLevel", message: 'riskLevel must be "safe" or "risky".' });
  }

  validateTarget(input.target, errors);

  const inputNames = validateInputs(input.inputs, errors);
  const stepIds = validateSteps(input.steps, errors, inputNames);
  validateOutputs(input.outputs, errors, stepIds);
  validateCheckpoint(input.checkpoint, errors, inputNames);
  validateBusinessOutcomes(input.businessOutcomes, errors, inputNames);

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, artifact: input as unknown as Artifact };
}

function requireNonEmptyString(input: Record<string, unknown>, field: string, errors: ArtifactValidationError[]): void {
  const value = input[field];
  if (typeof value !== "string" || value.trim() === "") {
    errors.push({ path: field, message: `${field} is required and must be a non-empty string.` });
  }
}

function validateTarget(target: unknown, errors: ArtifactValidationError[]): void {
  if (!isRecord(target)) {
    errors.push({ path: "target", message: "target is required and must be an object." });
    return;
  }
  if (typeof target.appId !== "string" || !target.appId) {
    errors.push({ path: "target.appId", message: "target.appId is required." });
  }
  if (typeof target.baseUrl !== "string" || !target.baseUrl) {
    errors.push({ path: "target.baseUrl", message: "target.baseUrl is required." });
  }
  if (target.surfaceType !== "web") {
    errors.push({ path: "target.surfaceType", message: 'target.surfaceType must be "web" (the only supported surface today).' });
  }
}

function validateInputs(inputs: unknown, errors: ArtifactValidationError[]): Set<string> {
  const names = new Set<string>();
  if (!Array.isArray(inputs)) {
    errors.push({ path: "inputs", message: "inputs is required and must be an array." });
    return names;
  }
  inputs.forEach((item, index) => {
    const path = `inputs[${index}]`;
    if (!isRecord(item)) {
      errors.push({ path, message: "Each input must be an object." });
      return;
    }
    if (typeof item.name !== "string" || !item.name) {
      errors.push({ path: `${path}.name`, message: "name is required." });
    } else {
      if (names.has(item.name)) {
        errors.push({ path: `${path}.name`, message: `Duplicate input name "${item.name}".` });
      }
      names.add(item.name);
    }
    if (!VALUE_TYPES.includes(item.type as ArtifactValueType)) {
      errors.push({ path: `${path}.type`, message: `type must be one of: ${VALUE_TYPES.join(", ")}.` });
    }
    if (typeof item.required !== "boolean") {
      errors.push({ path: `${path}.required`, message: "required must be a boolean." });
    }
  });
  return names;
}

function validateParamValue(
  value: unknown,
  path: string,
  errors: ArtifactValidationError[],
  inputNames: Set<string>,
  opts: { required: boolean },
): void {
  if (typeof value !== "string") {
    if (opts.required) {
      errors.push({ path, message: 'must be a string (a literal value or a "{{param}}" reference).' });
    }
    return;
  }
  if (opts.required && value === "") {
    errors.push({ path, message: "must not be empty." });
    return;
  }

  // Strip every well-formed {{name}} token; anything "{{"/"}}"-shaped
  // left over is a malformed reference (unclosed, empty name, etc.).
  const stripped = value.replace(PARAM_REF_TOKEN, "");
  if (LOOKS_LIKE_REF.test(stripped)) {
    errors.push({ path, message: `"${value}" contains a malformed parameter reference (expected "{{name}}").` });
    return;
  }

  for (const match of value.matchAll(PARAM_REF_TOKEN)) {
    const refName = match[1];
    if (!inputNames.has(refName)) {
      errors.push({ path, message: `References input "${refName}", which is not declared in inputs.` });
    }
  }
}

function validateLocator(target: unknown, path: string, errors: ArtifactValidationError[]): void {
  if (!isRecord(target)) {
    errors.push({ path, message: "target is required and must be an object (a Locator)." });
    return;
  }
  if (!Array.isArray(target.strategies) || target.strategies.length === 0) {
    errors.push({ path: `${path}.strategies`, message: "strategies is required and must be a non-empty array." });
    return;
  }
  target.strategies.forEach((strategy: unknown, index: number) => {
    validateLocatorStrategy(strategy, `${path}.strategies[${index}]`, errors);
  });
}

function validateLocatorStrategy(strategy: unknown, path: string, errors: ArtifactValidationError[]): void {
  if (!isRecord(strategy)) {
    errors.push({ path, message: "Each locator strategy must be an object." });
    return;
  }
  if (!LOCATOR_STRATEGY_TYPES.includes(strategy.type as string)) {
    errors.push({ path: `${path}.type`, message: `type must be one of: ${LOCATOR_STRATEGY_TYPES.join(", ")}.` });
    return;
  }
  switch (strategy.type) {
    case "role":
      if (typeof strategy.role !== "string" || !strategy.role) errors.push({ path: `${path}.role`, message: "role is required." });
      if (typeof strategy.name !== "string" || !strategy.name) errors.push({ path: `${path}.name`, message: "name is required." });
      break;
    case "label":
    case "text":
      if (typeof strategy.text !== "string" || !strategy.text) errors.push({ path: `${path}.text`, message: "text is required." });
      break;
    case "attribute":
      if (typeof strategy.attribute !== "string" || !strategy.attribute) {
        errors.push({ path: `${path}.attribute`, message: "attribute is required." });
      }
      if (typeof strategy.value !== "string" || !strategy.value) {
        errors.push({ path: `${path}.value`, message: "value is required." });
      }
      break;
    case "css":
      if (typeof strategy.selector !== "string" || !strategy.selector) {
        errors.push({ path: `${path}.selector`, message: "selector is required." });
      }
      break;
  }
}

function validateSteps(
  steps: unknown,
  errors: ArtifactValidationError[],
  inputNames: Set<string>,
): Map<number, LooseStepInfo> {
  const stepMap = new Map<number, LooseStepInfo>();
  if (!Array.isArray(steps) || steps.length === 0) {
    errors.push({ path: "steps", message: "steps is required and must be a non-empty array." });
    return stepMap;
  }

  const seenIds = new Set<number>();

  steps.forEach((item, index) => {
    const path = `steps[${index}]`;
    if (!isRecord(item)) {
      errors.push({ path, message: "Each step must be an object." });
      return;
    }

    if (typeof item.stepId !== "number") {
      errors.push({ path: `${path}.stepId`, message: "stepId is required and must be a number." });
    } else {
      if (seenIds.has(item.stepId)) {
        errors.push({ path: `${path}.stepId`, message: `Duplicate stepId ${item.stepId}.` });
      }
      seenIds.add(item.stepId);
      stepMap.set(item.stepId, { action: item.action, outputRef: item.outputRef });
    }

    if (!ACTION_TYPES.includes(item.action as ArtifactActionType)) {
      errors.push({ path: `${path}.action`, message: `action must be one of: ${ACTION_TYPES.join(", ")}.` });
      return; // can't validate action-specific fields without a known action
    }

    switch (item.action) {
      case "navigate":
        validateParamValue(item.url, `${path}.url`, errors, inputNames, { required: true });
        break;
      case "click":
        validateLocator(item.target, `${path}.target`, errors);
        break;
      case "type":
        validateLocator(item.target, `${path}.target`, errors);
        validateParamValue(item.value, `${path}.value`, errors, inputNames, { required: true });
        break;
      case "read":
        validateLocator(item.target, `${path}.target`, errors);
        if (typeof item.outputRef !== "string" || !item.outputRef) {
          errors.push({ path: `${path}.outputRef`, message: "outputRef is required for read steps." });
        }
        break;
    }
  });

  return stepMap;
}

function validateOutputs(
  outputs: unknown,
  errors: ArtifactValidationError[],
  stepIds: Map<number, LooseStepInfo>,
): void {
  if (!Array.isArray(outputs)) {
    errors.push({ path: "outputs", message: "outputs is required and must be an array." });
    return;
  }
  const names = new Set<string>();
  outputs.forEach((item, index) => {
    const path = `outputs[${index}]`;
    if (!isRecord(item)) {
      errors.push({ path, message: "Each output must be an object." });
      return;
    }
    if (typeof item.name !== "string" || !item.name) {
      errors.push({ path: `${path}.name`, message: "name is required." });
    } else {
      if (names.has(item.name)) {
        errors.push({ path: `${path}.name`, message: `Duplicate output name "${item.name}".` });
      }
      names.add(item.name);
    }
    if (!VALUE_TYPES.includes(item.type as ArtifactValueType)) {
      errors.push({ path: `${path}.type`, message: `type must be one of: ${VALUE_TYPES.join(", ")}.` });
    }
    if (typeof item.sourceStepId !== "number") {
      errors.push({ path: `${path}.sourceStepId`, message: "sourceStepId is required and must be a number." });
      return;
    }
    const sourceStep = stepIds.get(item.sourceStepId);
    if (!sourceStep) {
      errors.push({ path: `${path}.sourceStepId`, message: `sourceStepId ${item.sourceStepId} does not match any step.` });
    } else if (sourceStep.action !== "read") {
      errors.push({ path: `${path}.sourceStepId`, message: `Step ${item.sourceStepId} is not a "read" step.` });
    } else if (sourceStep.outputRef !== item.name) {
      errors.push({
        path: `${path}.sourceStepId`,
        message: `Step ${item.sourceStepId}'s outputRef ("${String(sourceStep.outputRef)}") does not match this output's name ("${item.name}").`,
      });
    }
  });
}

function validateCheckpointCondition(
  condition: unknown,
  path: string,
  errors: ArtifactValidationError[],
  inputNames: Set<string>,
): void {
  if (!isRecord(condition)) {
    errors.push({ path, message: "Each condition must be an object." });
    return;
  }
  if (!CHECKPOINT_CONDITION_TYPES.includes(condition.type as string)) {
    errors.push({ path: `${path}.type`, message: `type must be one of: ${CHECKPOINT_CONDITION_TYPES.join(", ")}.` });
    return;
  }
  switch (condition.type) {
    case "urlMatches":
      validateParamValue(condition.pattern, `${path}.pattern`, errors, inputNames, { required: true });
      break;
    case "textPresent":
      if (typeof condition.text !== "string" || !condition.text) {
        errors.push({ path: `${path}.text`, message: "text is required." });
      }
      break;
    case "elementVisible":
      validateLocator(condition.target, `${path}.target`, errors);
      break;
  }
}

function validateCheckpoint(checkpoint: unknown, errors: ArtifactValidationError[], inputNames: Set<string>): void {
  if (!isRecord(checkpoint)) {
    errors.push({ path: "checkpoint", message: "checkpoint is required and must be an object." });
    return;
  }
  if (!Array.isArray(checkpoint.all) || checkpoint.all.length === 0) {
    errors.push({ path: "checkpoint.all", message: "checkpoint.all is required and must be a non-empty array." });
    return;
  }
  checkpoint.all.forEach((condition: unknown, index: number) => {
    validateCheckpointCondition(condition, `checkpoint.all[${index}]`, errors, inputNames);
  });
}

function validateBusinessOutcomes(outcomes: unknown, errors: ArtifactValidationError[], inputNames: Set<string>): void {
  if (!Array.isArray(outcomes)) {
    errors.push({ path: "businessOutcomes", message: "businessOutcomes is required and must be an array." });
    return;
  }
  const codes = new Set<string>();
  outcomes.forEach((item, index) => {
    const path = `businessOutcomes[${index}]`;
    if (!isRecord(item)) {
      errors.push({ path, message: "Each business outcome must be an object." });
      return;
    }
    if (typeof item.code !== "string" || !item.code) {
      errors.push({ path: `${path}.code`, message: "code is required." });
    } else {
      if (codes.has(item.code)) {
        errors.push({ path: `${path}.code`, message: `Duplicate business outcome code "${item.code}".` });
      }
      codes.add(item.code);
    }
    if (typeof item.description !== "string" || !item.description) {
      errors.push({ path: `${path}.description`, message: "description is required." });
    }
    if (!Array.isArray(item.when) || item.when.length === 0) {
      errors.push({ path: `${path}.when`, message: "when is required and must be a non-empty array." });
      return;
    }
    item.when.forEach((condition: unknown, condIndex: number) => {
      validateCheckpointCondition(condition, `${path}.when[${condIndex}]`, errors, inputNames);
    });
  });
}
