import { describe, it, expect } from "vitest";
import { runDiscoveryLoop } from "../../src/agent/loop";
import { PolicyGuard } from "../../src/safety/policy-guard";
import type { DiscoveryGoal, DiscoveryModelInfo } from "../../src/agent/types";
import { createFakeSurface } from "./fixtures/fake-surface";
import { createScriptedLlmClient } from "./fixtures/fake-llm-client";
import { createFixedApprovalDecider } from "./fixtures/fake-approval-decider";
import { wrapSurfaceWithSpy } from "./fixtures/spy-surface";

const ALLOWED_BASE_URL = "http://localhost:3000";
const MODEL_INFO: DiscoveryModelInfo = { provider: "anthropic", model: "claude-sonnet-5" };

const GOAL: DiscoveryGoal = {
  goal: "Look up member 1001 and read their current savings balance.",
  targetBaseUrl: ALLOWED_BASE_URL,
  capabilityId: "get-savings-balance",
};

const MEMBER_ID_LOCATOR = { strategies: [{ type: "role" as const, role: "textbox", name: "Member ID" }] };
const SEARCH_BUTTON_LOCATOR = { strategies: [{ type: "role" as const, role: "button", name: "Search" }] };
const BALANCE_LOCATOR = { strategies: [{ type: "css" as const, selector: "strong" }] };

const SUCCESS_SCRIPT = [
  { action: "type", target: MEMBER_ID_LOCATOR, value: "1001", inputRef: "memberId" },
  { action: "click", target: SEARCH_BUTTON_LOCATOR },
  { action: "read", target: BALANCE_LOCATOR, outputRef: "savingsBalance" },
  { action: "finish", outputRefs: ["savingsBalance"], checkpointText: "Member details loaded successfully." },
];

describe("runDiscoveryLoop — Phase 8 policy gate", () => {
  const guard = new PolicyGuard({ allowedBaseUrls: [ALLOWED_BASE_URL] });

  it("never requests approval for a safe (default) goal", async () => {
    const decider = createFixedApprovalDecider("denied");
    const trace = await runDiscoveryLoop({
      surface: createFakeSurface(),
      llmClient: createScriptedLlmClient(SUCCESS_SCRIPT),
      goal: GOAL, // riskLevel omitted -> defaults to "safe"
      modelInfo: MODEL_INFO,
      policy: { guard, requestApproval: decider },
    });

    expect(trace.finalOutcome.status).toBe("success");
    expect(decider.requests).toHaveLength(0);
    expect(trace.policy).toEqual({ riskLevel: "safe", classification: "safe" });
  });

  it("requests approval for a risky goal, and proceeds when approved", async () => {
    const decider = createFixedApprovalDecider("approved");
    const trace = await runDiscoveryLoop({
      surface: createFakeSurface(),
      llmClient: createScriptedLlmClient(SUCCESS_SCRIPT),
      goal: { ...GOAL, riskLevel: "risky" },
      modelInfo: MODEL_INFO,
      policy: { guard, requestApproval: decider },
    });

    expect(trace.finalOutcome.status).toBe("success");
    expect(decider.requests).toHaveLength(1);
    expect(trace.policy).toEqual({ riskLevel: "risky", classification: "approval_required", approvalDecision: "approved" });
  });

  it("blocks a risky goal with zero Surface calls when approval is denied — not even the bootstrap navigate runs", async () => {
    const decider = createFixedApprovalDecider("denied");
    const { surface: spy, calls } = wrapSurfaceWithSpy(createFakeSurface());

    const trace = await runDiscoveryLoop({
      surface: spy,
      llmClient: createScriptedLlmClient(SUCCESS_SCRIPT),
      goal: { ...GOAL, riskLevel: "risky" },
      modelInfo: MODEL_INFO,
      policy: { guard, requestApproval: decider },
    });

    expect(trace.finalOutcome).toEqual({ status: "blocked", reason: "Approval was denied for this risky discovery goal." });
    expect(trace.steps).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });

  it("blocks with zero Surface calls when the target base URL isn't allowlisted, without ever asking for approval", async () => {
    const decider = createFixedApprovalDecider("approved");
    const { surface: spy, calls } = wrapSurfaceWithSpy(createFakeSurface());

    const trace = await runDiscoveryLoop({
      surface: spy,
      llmClient: createScriptedLlmClient(SUCCESS_SCRIPT),
      goal: { ...GOAL, targetBaseUrl: "http://evil.example.com" },
      modelInfo: MODEL_INFO,
      policy: { guard, requestApproval: decider },
    });

    expect(trace.finalOutcome.status).toBe("blocked");
    expect(trace.steps).toHaveLength(0);
    expect(trace.policy?.classification).toBe("blocked");
    expect(decider.requests).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });

  it("without a policy option at all, behaves exactly as Phase 6/7 did — a risky goal just runs", async () => {
    const trace = await runDiscoveryLoop({
      surface: createFakeSurface(),
      llmClient: createScriptedLlmClient(SUCCESS_SCRIPT),
      goal: { ...GOAL, riskLevel: "risky" },
      modelInfo: MODEL_INFO,
      // no `policy` option supplied
    });

    expect(trace.finalOutcome.status).toBe("success");
    expect(trace.policy).toBeUndefined();
  });
});
