/**
 * Validates a structured action returned by the LLM (Phase 6) before it is
 * ever passed to a live Surface. Mirrors the shape/spirit of
 * src/artifact/validate.ts (collect every error, not just the first;
 * locator strategies validated the same way) but is self-contained here
 * since the two validators check different things — this one validates a
 * single in-flight decision, not a whole persisted artifact.
 *
 * This is the one place "an invalid or malformed model response" is
 * turned into a clean rejection instead of a thrown exception or a
 * silently-wrong Surface call.
 */
import type { AgentAction, AgentActionType } from "./types";

export interface ActionValidationError {
  path: string;
  message: string;
}

export type ActionValidationResult =
  | { valid: true; action: AgentAction }
  | { valid: false; errors: ActionValidationError[] };

const ACTION_TYPES: AgentActionType[] = ["navigate", "click", "type", "read", "finish", "fail"];
const LOCATOR_STRATEGY_TYPES = ["role", "label", "text", "attribute", "css"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireNonEmptyString(value: unknown, path: string, errors: ActionValidationError[]): void {
  if (typeof value !== "string" || value.trim() === "") {
    errors.push({ path, message: `${path} is required and must be a non-empty string.` });
  }
}

function validateLocatorStrategy(strategy: unknown, path: string, errors: ActionValidationError[]): void {
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
      requireNonEmptyString(strategy.role, `${path}.role`, errors);
      requireNonEmptyString(strategy.name, `${path}.name`, errors);
      break;
    case "label":
    case "text":
      requireNonEmptyString(strategy.text, `${path}.text`, errors);
      break;
    case "attribute":
      requireNonEmptyString(strategy.attribute, `${path}.attribute`, errors);
      requireNonEmptyString(strategy.value, `${path}.value`, errors);
      break;
    case "css":
      requireNonEmptyString(strategy.selector, `${path}.selector`, errors);
      break;
  }
}

function validateLocator(target: unknown, path: string, errors: ActionValidationError[]): void {
  if (!isRecord(target)) {
    errors.push({ path, message: `${path} is required and must be an object (a Locator).` });
    return;
  }
  if (!Array.isArray(target.strategies) || target.strategies.length === 0) {
    errors.push({ path: `${path}.strategies`, message: "strategies is required and must be a non-empty array." });
    return;
  }
  target.strategies.forEach((strategy, index) => {
    validateLocatorStrategy(strategy, `${path}.strategies[${index}]`, errors);
  });
}

/** Validates a raw, untyped value (typically a parsed tool-call input) as a structured AgentAction. */
export function validateAgentAction(raw: unknown): ActionValidationResult {
  const errors: ActionValidationError[] = [];

  if (!isRecord(raw)) {
    return { valid: false, errors: [{ path: "$", message: "Action must be an object." }] };
  }

  if (!ACTION_TYPES.includes(raw.action as AgentActionType)) {
    return {
      valid: false,
      errors: [{ path: "action", message: `action must be one of: ${ACTION_TYPES.join(", ")}.` }],
    };
  }

  switch (raw.action) {
    case "navigate":
      requireNonEmptyString(raw.url, "url", errors);
      break;
    case "click":
      validateLocator(raw.target, "target", errors);
      break;
    case "type":
      validateLocator(raw.target, "target", errors);
      requireNonEmptyString(raw.value, "value", errors);
      requireNonEmptyString(raw.inputRef, "inputRef", errors);
      break;
    case "read":
      validateLocator(raw.target, "target", errors);
      requireNonEmptyString(raw.outputRef, "outputRef", errors);
      break;
    case "finish":
      if (!Array.isArray(raw.outputRefs) || raw.outputRefs.length === 0) {
        errors.push({ path: "outputRefs", message: "outputRefs is required and must be a non-empty array." });
      } else {
        raw.outputRefs.forEach((ref, index) => {
          if (typeof ref !== "string" || ref.trim() === "") {
            errors.push({ path: `outputRefs[${index}]`, message: "each outputRef must be a non-empty string." });
          }
        });
      }
      requireNonEmptyString(raw.checkpointText, "checkpointText", errors);
      break;
    case "fail":
      requireNonEmptyString(raw.reason, "reason", errors);
      break;
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, action: raw as unknown as AgentAction };
}
