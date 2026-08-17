/**
 * Fake LlmClient implementations for Phase 6 tests — no live Anthropic API
 * call anywhere in this file. loop.ts and index.ts only depend on the
 * LlmClient *interface* (decide()), so these substitute cleanly for
 * createAnthropicLlmClient() in every test.
 */
import type { DecideRequest, LlmClient } from "../../../src/agent/llm-client";

export type ScriptedStep = unknown | ((request: DecideRequest) => unknown);

/** Returns each scripted value (or the result of calling it, if it's a function) in order, one per decide() call. */
export function createScriptedLlmClient(script: ScriptedStep[]): LlmClient {
  let index = 0;
  return {
    async decide(request: DecideRequest): Promise<unknown> {
      if (index >= script.length) {
        throw new Error(`createScriptedLlmClient: script exhausted after ${script.length} step(s).`);
      }
      const step = script[index];
      index += 1;
      return typeof step === "function" ? (step as (r: DecideRequest) => unknown)(request) : step;
    },
  };
}

/** Always throws — simulates a provider-level failure (auth, network, rate limit). */
export function createThrowingLlmClient(message = "simulated provider failure"): LlmClient {
  return {
    async decide(): Promise<unknown> {
      throw new Error(message);
    },
  };
}
