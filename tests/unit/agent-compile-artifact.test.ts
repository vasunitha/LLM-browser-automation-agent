import { describe, it, expect } from "vitest";
import { compileArtifactFromTrace } from "../../src/agent/compile-artifact";
import { validateArtifact } from "../../src/artifact/validate";
import type { DiscoveryTrace } from "../../src/agent/types";

const MEMBER_ID_LOCATOR = { strategies: [{ type: "role" as const, role: "textbox", name: "Member ID" }] };
const SEARCH_BUTTON_LOCATOR = { strategies: [{ type: "role" as const, role: "button", name: "Search" }] };
const BALANCE_LOCATOR = { strategies: [{ type: "css" as const, selector: "strong" }] };

function buildSuccessfulTrace(): DiscoveryTrace {
  return {
    runId: "test-run-1",
    timestamp: "2026-08-16T00:00:00.000Z",
    goal: "Look up member 1001 and read their current savings balance.",
    target: { baseUrl: "http://localhost:3000" },
    model: { provider: "anthropic", model: "claude-sonnet-5" },
    config: { maxSteps: 15, timeoutMs: 120_000 },
    steps: [
      {
        stepNumber: 1,
        observation: { url: "http://localhost:3000/", title: "Search", controls: [], visibleText: "" },
        action: { action: "type", target: MEMBER_ID_LOCATOR, value: "1001", inputRef: "memberId" },
        outcome: { status: "ok" },
      },
      {
        stepNumber: 2,
        observation: { url: "http://localhost:3000/", title: "Search", controls: [], visibleText: "" },
        action: { action: "click", target: SEARCH_BUTTON_LOCATOR },
        outcome: { status: "ok" },
      },
      {
        stepNumber: 3,
        observation: {
          url: "http://localhost:3000/members/1001",
          title: "Details",
          controls: [],
          visibleText: "",
        },
        action: { action: "read", target: BALANCE_LOCATOR, outputRef: "savingsBalance" },
        outcome: { status: "ok", value: "$482.17" },
      },
      {
        stepNumber: 4,
        observation: {
          url: "http://localhost:3000/members/1001",
          title: "Details",
          controls: [],
          visibleText: "Member details loaded successfully.",
        },
        action: {
          action: "finish",
          outputRefs: ["savingsBalance"],
          checkpointText: "Member details loaded successfully.",
        },
        outcome: { status: "ok" },
      },
    ],
    finalOutcome: {
      status: "success",
      outputs: { savingsBalance: "$482.17" },
      checkpointText: "Member details loaded successfully.",
      finalUrl: "http://localhost:3000/members/1001",
    },
  };
}

describe("compileArtifactFromTrace", () => {
  // 8. successful discovery produces an artifact (compiler level)
  it("compiles a valid artifact from a successful trace", () => {
    const trace = buildSuccessfulTrace();
    const artifact = compileArtifactFromTrace(trace, { capabilityId: "get-savings-balance" });

    const result = validateArtifact(artifact);
    expect(result.valid).toBe(true);
    expect(artifact.id).toBe("get-savings-balance");
    expect(artifact.riskLevel).toBe("safe");
  });

  it("produces the expected steps, inputs, outputs, and checkpoint", () => {
    const trace = buildSuccessfulTrace();
    const artifact = compileArtifactFromTrace(trace, { capabilityId: "get-savings-balance" });

    // step 1 is the synthesized bootstrap navigate, then the three
    // successful LLM-decided steps (finish() is not a step action).
    expect(artifact.steps.map((s) => s.action)).toEqual(["navigate", "type", "click", "read"]);
    expect(artifact.steps[0]).toMatchObject({ stepId: 1, action: "navigate", url: "/" });

    expect(artifact.inputs).toHaveLength(1);
    expect(artifact.inputs[0]).toMatchObject({ name: "memberId", type: "string", required: true, example: "1001" });

    expect(artifact.outputs).toHaveLength(1);
    expect(artifact.outputs[0]).toMatchObject({ name: "savingsBalance", type: "string" });
    const readStep = artifact.steps.find((s) => s.action === "read");
    expect(artifact.outputs[0].sourceStepId).toBe(readStep?.stepId);

    expect(artifact.checkpoint.all).toContainEqual({ type: "urlMatches", pattern: "/members/{{memberId}}" });
    expect(artifact.checkpoint.all).toContainEqual({
      type: "textPresent",
      text: "Member details loaded successfully.",
    });
  });

  // 9. artifact remains parameterized
  it("never hardcodes the literal input value into an executable step", () => {
    const trace = buildSuccessfulTrace();
    const artifact = compileArtifactFromTrace(trace, { capabilityId: "get-savings-balance" });

    const stepsJson = JSON.stringify(artifact.steps);
    expect(stepsJson).not.toContain("1001");

    const typeStep = artifact.steps.find((s) => s.action === "type") as { value: string } | undefined;
    expect(typeStep?.value).toBe("{{memberId}}");
    expect(artifact.inputs[0].example).toBe("1001");
  });

  it("drops steps whose Surface outcome was an error — only the clean successful path is compiled", () => {
    const trace = buildSuccessfulTrace();
    trace.steps.splice(2, 0, {
      stepNumber: 99,
      observation: { url: "http://localhost:3000/", title: "Search", controls: [], visibleText: "" },
      action: { action: "click", target: { strategies: [{ type: "css", selector: "#does-not-exist" }] } },
      outcome: { status: "error", code: "ELEMENT_NOT_FOUND", message: "no match" },
    });

    const artifact = compileArtifactFromTrace(trace, { capabilityId: "get-savings-balance" });
    expect(artifact.steps.map((s) => s.action)).toEqual(["navigate", "type", "click", "read"]);
  });

  // 10. failed discovery does NOT produce a successful artifact
  it("throws rather than compiling an artifact from a non-successful trace", () => {
    const trace = buildSuccessfulTrace();
    trace.finalOutcome = { status: "failure", reason: "could not find the member" };

    expect(() => compileArtifactFromTrace(trace, { capabilityId: "get-savings-balance" })).toThrow(
      /non-successful/i,
    );
  });
});
