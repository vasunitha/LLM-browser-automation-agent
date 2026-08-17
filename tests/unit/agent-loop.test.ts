import { describe, it, expect } from "vitest";
import { runDiscoveryLoop } from "../../src/agent/loop";
import type { DiscoveryGoal, DiscoveryModelInfo } from "../../src/agent/types";
import {
  createAlwaysFailingSurface,
  createFakeSurface,
  createSessionClosedOnClickSurface,
} from "./fixtures/fake-surface";
import { createScriptedLlmClient, createThrowingLlmClient } from "./fixtures/fake-llm-client";

const MODEL_INFO: DiscoveryModelInfo = { provider: "anthropic", model: "claude-sonnet-5" };

const GOAL: DiscoveryGoal = {
  goal: "Look up member 1001 and read their current savings balance.",
  targetBaseUrl: "http://localhost:3000",
  capabilityId: "get-savings-balance",
};

const MEMBER_ID_LOCATOR = { strategies: [{ type: "role" as const, role: "textbox", name: "Member ID" }] };
const SEARCH_BUTTON_LOCATOR = { strategies: [{ type: "role" as const, role: "button", name: "Search" }] };
const BALANCE_LOCATOR = { strategies: [{ type: "css" as const, selector: "strong" }] };

describe("runDiscoveryLoop", () => {
  // 3. observation -> action -> execution loop, end to end, against a
  // scripted but genuinely stateful fake Surface (not a hardcoded trace).
  it("drives observe -> decide -> validate -> act through to a successful finish()", async () => {
    const surface = createFakeSurface();
    const llmClient = createScriptedLlmClient([
      { action: "type", target: MEMBER_ID_LOCATOR, value: "1001", inputRef: "memberId" },
      { action: "click", target: SEARCH_BUTTON_LOCATOR },
      { action: "read", target: BALANCE_LOCATOR, outputRef: "savingsBalance" },
      { action: "finish", outputRefs: ["savingsBalance"], checkpointText: "Member details loaded successfully." },
    ]);

    const trace = await runDiscoveryLoop({ surface, llmClient, goal: GOAL, modelInfo: MODEL_INFO });

    expect(trace.finalOutcome).toEqual({
      status: "success",
      outputs: { savingsBalance: "$482.17" },
      checkpointText: "Member details loaded successfully.",
      finalUrl: "http://localhost:3000/members/1001",
    });
    expect(trace.steps).toHaveLength(4);
    expect(trace.steps.every((s) => s.outcome.status === "ok")).toBe(true);
    expect(trace.goal).toBe(GOAL.goal);
    expect(trace.model).toEqual(MODEL_INFO);
  });

  it("records fail() as a failure outcome, not a thrown exception", async () => {
    const surface = createFakeSurface();
    const llmClient = createScriptedLlmClient([
      { action: "fail", reason: "The member search field never appeared." },
    ]);

    const trace = await runDiscoveryLoop({ surface, llmClient, goal: GOAL, modelInfo: MODEL_INFO });

    expect(trace.finalOutcome).toEqual({
      status: "failure",
      reason: "The member search field never appeared.",
    });
    expect(trace.steps).toHaveLength(1);
  });

  // 4. max-step stopping
  it("stops with max_steps_exceeded once the step budget is used up, without exceeding it", async () => {
    const surface = createAlwaysFailingSurface();
    const llmClient = createScriptedLlmClient([
      { action: "click", target: SEARCH_BUTTON_LOCATOR },
      { action: "click", target: SEARCH_BUTTON_LOCATOR },
      { action: "click", target: SEARCH_BUTTON_LOCATOR },
    ]);

    const trace = await runDiscoveryLoop({
      surface,
      llmClient,
      goal: GOAL,
      modelInfo: MODEL_INFO,
      config: { maxSteps: 3 },
    });

    expect(trace.finalOutcome).toEqual({ status: "max_steps_exceeded" });
    expect(trace.steps).toHaveLength(3);
    // Each recoverable Surface error was recorded, not treated as fatal —
    // this is what "max steps" bounds instead of the loop stopping early.
    expect(trace.steps.every((s) => s.outcome.status === "error" && s.outcome.code === "ELEMENT_NOT_FOUND")).toBe(
      true,
    );
  });

  // 5. timeout stopping (deterministic — no real waiting)
  it("stops with timeout once the injected clock reports elapsed time past timeoutMs", async () => {
    const surface = createFakeSurface();
    const llmClient = createScriptedLlmClient([{ action: "navigate", url: "/" }]);
    let calls = 0;
    const clock = () => {
      calls += 1;
      if (calls <= 2) return 0; // startTime, then the first in-loop check
      return 999_999; // every check after step 1 reports far past the deadline
    };

    const trace = await runDiscoveryLoop({
      surface,
      llmClient,
      goal: GOAL,
      modelInfo: MODEL_INFO,
      config: { timeoutMs: 100 },
      clock,
    });

    expect(trace.finalOutcome).toEqual({ status: "timeout" });
    expect(trace.steps).toHaveLength(1);
  });

  // 6. surface failure handling — SESSION_CLOSED is the one unrecoverable case
  it("stops immediately with surface_error on SESSION_CLOSED", async () => {
    const surface = createSessionClosedOnClickSurface();
    const llmClient = createScriptedLlmClient([{ action: "click", target: SEARCH_BUTTON_LOCATOR }]);

    const trace = await runDiscoveryLoop({
      surface,
      llmClient,
      goal: GOAL,
      modelInfo: MODEL_INFO,
      config: { maxSteps: 10 },
    });

    expect(trace.finalOutcome).toEqual({
      status: "surface_error",
      code: "SESSION_CLOSED",
      message: "Session was closed unexpectedly.",
    });
    expect(trace.steps).toHaveLength(1);
  });

  it("stops with surface_error when the initial bootstrap navigation itself fails", async () => {
    const surface = createFakeSurface();
    surface.navigate = async () => ({ ok: false, error: { code: "NAVIGATION_FAILED", message: "connection refused" } });
    const llmClient = createScriptedLlmClient([]);

    const trace = await runDiscoveryLoop({ surface, llmClient, goal: GOAL, modelInfo: MODEL_INFO });

    expect(trace.finalOutcome).toEqual({
      status: "surface_error",
      code: "NAVIGATION_FAILED",
      message: "connection refused",
    });
    expect(trace.steps).toHaveLength(0);
  });

  // 7. malformed model response handling
  it("stops with invalid_action when the model returns something that isn't a structured action", async () => {
    const surface = createFakeSurface();
    const llmClient = createScriptedLlmClient([{ foo: "bar" }]);

    const trace = await runDiscoveryLoop({ surface, llmClient, goal: GOAL, modelInfo: MODEL_INFO });

    expect(trace.finalOutcome.status).toBe("invalid_action");
    expect(trace.steps).toHaveLength(0);
  });

  it("stops with llm_error when the LLM client itself throws (provider failure)", async () => {
    const surface = createFakeSurface();
    const llmClient = createThrowingLlmClient("simulated rate limit");

    const trace = await runDiscoveryLoop({ surface, llmClient, goal: GOAL, modelInfo: MODEL_INFO });

    expect(trace.finalOutcome).toEqual({ status: "llm_error", message: "simulated rate limit" });
    expect(trace.steps).toHaveLength(0);
  });

  it("rejects finish() whose checkpointText is not actually present in the current observation", async () => {
    const surface = createFakeSurface();
    const llmClient = createScriptedLlmClient([
      { action: "finish", outputRefs: ["savingsBalance"], checkpointText: "This text is not on the page" },
    ]);

    const trace = await runDiscoveryLoop({ surface, llmClient, goal: GOAL, modelInfo: MODEL_INFO });

    expect(trace.finalOutcome.status).toBe("invalid_action");
    expect(trace.steps).toHaveLength(1);
    expect(trace.steps[0].outcome).toMatchObject({ status: "error", code: "CHECKPOINT_NOT_VERIFIED" });
  });

  // Found by the real Phase 6 smoke test: Claude sometimes quotes a
  // checkpointText containing a literal two-character "\n" (backslash + n)
  // where the real page has an actual newline byte — visually identical,
  // byte-different. Confirms the checkpoint match tolerates that.
  it("accepts finish() when checkpointText differs from the page only in whitespace/escaped-newline formatting", async () => {
    const surface = createFakeSurface();
    const llmClient = createScriptedLlmClient([
      { action: "type", target: MEMBER_ID_LOCATOR, value: "1001", inputRef: "memberId" },
      { action: "click", target: SEARCH_BUTTON_LOCATOR },
      { action: "read", target: BALANCE_LOCATOR, outputRef: "savingsBalance" },
      {
        action: "finish",
        outputRefs: ["savingsBalance"],
        // literal backslash-n (not a real newline) between the two lines,
        // exactly as observed from the real Anthropic API response —
        // "Member 1001\nSavings Balance:" is a real contiguous substring
        // of the fake surface's details-page text (see fake-surface.ts).
        checkpointText: "Member 1001\\nSavings Balance:",
      },
    ]);

    const trace = await runDiscoveryLoop({ surface, llmClient, goal: GOAL, modelInfo: MODEL_INFO });

    expect(trace.finalOutcome.status).toBe("success");
  });

  it("rejects finish() whose outputRefs reference a value that was never actually read", async () => {
    const surface = createFakeSurface();
    const llmClient = createScriptedLlmClient([
      { action: "finish", outputRefs: ["neverRead"], checkpointText: "Credit Union Teller Console" },
    ]);

    const trace = await runDiscoveryLoop({ surface, llmClient, goal: GOAL, modelInfo: MODEL_INFO });

    expect(trace.finalOutcome.status).toBe("invalid_action");
    expect(trace.steps[0].outcome).toMatchObject({ status: "error", code: "OUTPUT_REF_NOT_FOUND" });
  });

  it("calls onStepRecorded once per recorded step, and its failures don't break the run", async () => {
    const surface = createFakeSurface();
    const llmClient = createScriptedLlmClient([
      { action: "type", target: MEMBER_ID_LOCATOR, value: "1001", inputRef: "memberId" },
      { action: "fail", reason: "stopping here for the test" },
    ]);
    let calls = 0;

    const trace = await runDiscoveryLoop({
      surface,
      llmClient,
      goal: GOAL,
      modelInfo: MODEL_INFO,
      onStepRecorded: () => {
        calls += 1;
        throw new Error("evidence capture blew up");
      },
    });

    expect(calls).toBe(2);
    expect(trace.finalOutcome.status).toBe("failure");
  });
});
