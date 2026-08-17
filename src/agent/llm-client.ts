/**
 * LLM decision client (Phase 6).
 *
 * `LlmClient` is the one seam between the discovery loop and a concrete
 * model provider — the loop only ever calls `decide()` and validates
 * whatever comes back through validate-action.ts. That split is what
 * makes the loop testable without a live Anthropic call: tests supply a
 * fake `LlmClient` (see tests/unit/fixtures/fake-llm-client.ts) that
 * returns scripted or deliberately malformed raw responses, exercising
 * exactly the same validation/loop code the real client feeds.
 *
 * `createAnthropicLlmClient()` is the only file in src/agent that imports
 * "@anthropic-ai/sdk" — every decision is forced through one of six tools
 * (tool_choice: {type: "any"}), one per AgentAction variant, so the model
 * cannot return free-form prose in place of a structured action.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { DiscoveryStepRecord, ObservationSummary } from "./types";

export interface DecideRequest {
  goal: string;
  stepNumber: number;
  maxSteps: number;
  observation: ObservationSummary;
  /** Prior steps this run, compacted — not the full raw model transcript. */
  history: DiscoveryStepRecord[];
}

/** Returns a raw, not-yet-validated decision — the loop runs it through validateAgentAction(). */
export interface LlmClient {
  decide(request: DecideRequest): Promise<unknown>;
}

/** Thrown for provider-level failures (auth, rate limit, network) — distinct from "the model returned something invalid." */
export class LlmProviderError extends Error {}

const LOCATOR_SCHEMA = {
  type: "object" as const,
  description:
    "How to find a single element on the page: an ordered list of strategies, most robust first. Build these from the `controls` shown in the observation — prefer {type:'role', role, name} matching a control's role/name exactly, then {type:'label', text} as a fallback. Use {type:'css', selector} only as an absolute last resort.",
  properties: {
    description: { type: "string" as const, description: "Short human-readable label for this target, e.g. \"Search button\"." },
    strategies: {
      type: "array" as const,
      minItems: 1,
      items: {
        type: "object" as const,
        properties: {
          type: { type: "string" as const, enum: ["role", "label", "text", "attribute", "css"] },
          role: { type: "string" as const, description: "Required when type is 'role', e.g. 'button', 'textbox', 'link'." },
          name: { type: "string" as const, description: "Required when type is 'role': the control's accessible name." },
          text: { type: "string" as const, description: "Required when type is 'label' or 'text'." },
          exact: { type: "boolean" as const },
          attribute: { type: "string" as const, description: "Required when type is 'attribute'." },
          value: { type: "string" as const, description: "Required when type is 'attribute'." },
          selector: { type: "string" as const, description: "Required when type is 'css'." },
        },
        required: ["type"],
      },
    },
  },
  required: ["strategies"],
};

const TOOLS: Anthropic.Tool[] = [
  {
    name: "navigate",
    description: "Go to a URL (absolute, or a path relative to the target base URL).",
    input_schema: {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"],
    },
  },
  {
    name: "click",
    description: "Click a single element on the current page.",
    input_schema: {
      type: "object",
      properties: { target: LOCATOR_SCHEMA },
      required: ["target"],
    },
  },
  {
    name: "type",
    description:
      "Type a value into a field. inputRef names what this value semantically represents (e.g. 'memberId') so it can later become a reusable, parameterized input — choose a name that generalizes, not one describing the literal value.",
    input_schema: {
      type: "object",
      properties: {
        target: LOCATOR_SCHEMA,
        value: { type: "string", description: "The literal value to type." },
        inputRef: { type: "string", description: "A short camelCase name for this value, e.g. 'memberId'." },
      },
      required: ["target", "value", "inputRef"],
    },
  },
  {
    name: "read",
    description:
      "Read the current value/text of an element. outputRef names what this value represents (e.g. 'savingsBalance').",
    input_schema: {
      type: "object",
      properties: {
        target: LOCATOR_SCHEMA,
        outputRef: { type: "string", description: "A short camelCase name for this value, e.g. 'savingsBalance'." },
      },
      required: ["target", "outputRef"],
    },
  },
  {
    name: "finish",
    description:
      "Declare the goal accomplished. outputRefs lists the outputRef name(s), from prior read actions this run, that satisfy the goal. checkpointText must be a short, single-line, verbatim snippet of text currently visible on the page (from the observation's visibleText) that proves success — it will be checked against the real page, so do not paraphrase, invent it, or span multiple lines.",
    input_schema: {
      type: "object",
      properties: {
        outputRefs: { type: "array", items: { type: "string" }, minItems: 1 },
        checkpointText: { type: "string" },
        reasoning: { type: "string" },
      },
      required: ["outputRefs", "checkpointText"],
    },
  },
  {
    name: "fail",
    description: "Declare that the goal cannot be accomplished from the current state, with a clear reason.",
    input_schema: {
      type: "object",
      properties: { reason: { type: "string" } },
      required: ["reason"],
    },
  },
];

const SYSTEM_PROMPT = `You are a computer-use discovery agent. You operate a real, live web application through a small, fixed set of structured tools — you never produce free-form instructions, and you never see raw HTML or pixels, only a compact snapshot of the current page (its URL, title, a list of interactive controls with role/name/value, and an excerpt of visible text).

On every turn you must call exactly one tool, chosen from what the current observation actually shows — never guess at a control that isn't listed. Prefer role+name locators built directly from the controls you're shown; fall back to a label locator; use css only if nothing else identifies the element.

When you use the "type" tool, also declare inputRef: a short, generic camelCase name for what that value represents (e.g. "memberId"), not a name describing its literal contents — this becomes a reusable parameter later. When you use the "read" tool, declare outputRef the same way for what you read (e.g. "savingsBalance").

Call "finish" only once the goal is genuinely satisfied — reference the outputRef(s) of values you actually read via the "read" tool, and quote an exact snippet of currently-visible page text as checkpointText proving success. Do not fabricate or paraphrase that snippet.

Call "fail" if the goal cannot be reached from the current state (e.g. a required control never appears after a reasonable number of attempts, or the flow reaches a dead end) — explain why in reason. Never repeat an action that already failed without changing your approach.`;

function buildUserMessage(request: DecideRequest): string {
  const historyLines = request.history.map((step) => {
    const { action } = step;
    const actionSummary =
      action.action === "type"
        ? `type(inputRef=${action.inputRef}) -> "${action.value}"`
        : action.action === "read"
          ? `read(outputRef=${action.outputRef})`
          : action.action === "finish"
            ? `finish(outputRefs=${JSON.stringify(action.outputRefs)})`
            : action.action === "fail"
              ? `fail("${action.reason}")`
              : action.action === "navigate"
                ? `navigate("${action.url}")`
                : "click(...)";
    const outcomeSummary =
      step.outcome.status === "ok"
        ? step.outcome.value !== undefined
          ? `ok, value="${step.outcome.value}"`
          : "ok"
        : `error [${step.outcome.code}] ${step.outcome.message}`;
    return `  step ${step.stepNumber}: ${actionSummary} -> ${outcomeSummary}`;
  });

  return JSON.stringify(
    {
      goal: request.goal,
      stepNumber: request.stepNumber,
      maxSteps: request.maxSteps,
      priorSteps: historyLines,
      currentObservation: request.observation,
    },
    null,
    2,
  );
}

export interface AnthropicLlmClientOptions {
  apiKey: string;
  model: string;
  maxTokens?: number;
}

export function createAnthropicLlmClient(options: AnthropicLlmClientOptions): LlmClient {
  const client = new Anthropic({ apiKey: options.apiKey });
  const maxTokens = options.maxTokens ?? 1024;

  return {
    async decide(request: DecideRequest): Promise<unknown> {
      let response: Anthropic.Message;
      try {
        response = await client.messages.create({
          model: options.model,
          max_tokens: maxTokens,
          system: SYSTEM_PROMPT,
          tools: TOOLS,
          tool_choice: { type: "any" },
          messages: [{ role: "user", content: buildUserMessage(request) }],
        });
      } catch (err) {
        if (err instanceof Anthropic.APIError) {
          throw new LlmProviderError(`Anthropic API error: ${err.message}`);
        }
        throw new LlmProviderError(`Anthropic request failed: ${err instanceof Error ? err.message : String(err)}`);
      }

      const toolUse = response.content.find(
        (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
      );
      if (!toolUse) {
        // No tool call at all (e.g. refusal, or the model replied with plain
        // text despite tool_choice: "any") — hand back a shape that will
        // fail validate-action.ts's action-enum check, so the loop stops
        // cleanly via the "invalid_action" outcome rather than throwing.
        return { action: "__no_tool_use__", stopReason: response.stop_reason };
      }

      return { action: toolUse.name, ...(toolUse.input as Record<string, unknown>) };
    },
  };
}
