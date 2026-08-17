import { describe, it, expect } from "vitest";
import { replayArtifact } from "../../src/replay/engine";
import { PolicyGuard } from "../../src/safety/policy-guard";
import { buildReplayableArtifact } from "./fixtures/replay-artifact";
import { createFakeSurface } from "./fixtures/fake-surface";
import { createFixedApprovalDecider } from "./fixtures/fake-approval-decider";
import type { Surface } from "../../src/surface/types";

const ALLOWED_BASE_URL = "http://localhost:3000";

/** Fails click() with a recoverable error `failCount` times, then delegates to a real fake surface. */
function createFlakySurface(failCount: number): Surface {
  const base = createFakeSurface();
  let calls = 0;
  return {
    ...base,
    async click(locator) {
      calls += 1;
      if (calls <= failCount) {
        return { ok: false, error: { code: "ELEMENT_NOT_FOUND", message: "not ready yet" } };
      }
      return base.click(locator);
    },
  };
}

describe("replayArtifact — Phase 8 policy gate", () => {
  const guard = new PolicyGuard({ allowedBaseUrls: [ALLOWED_BASE_URL] });

  it("never requests approval for a safe artifact", async () => {
    const decider = createFixedApprovalDecider("denied"); // if this were ever called, the run would incorrectly block
    const result = await replayArtifact({
      artifact: buildReplayableArtifact(), // riskLevel: "safe"
      inputs: { memberId: "1001" },
      surface: createFakeSurface(),
      policy: { guard, requestApproval: decider },
    });

    expect(result.status).toBe("success");
    expect(decider.requests).toHaveLength(0);
    expect(result.policy).toEqual({ riskLevel: "safe", classification: "safe" });
  });

  it("requests approval for a risky artifact, and proceeds when approved", async () => {
    const decider = createFixedApprovalDecider("approved");
    const result = await replayArtifact({
      artifact: buildReplayableArtifact({ riskLevel: "risky" }),
      inputs: { memberId: "1001" },
      surface: createFakeSurface(),
      policy: { guard, requestApproval: decider },
    });

    expect(result.status).toBe("success");
    expect(decider.requests).toHaveLength(1);
    expect(result.policy).toEqual({ riskLevel: "risky", classification: "approval_required", approvalDecision: "approved" });
  });

  it("blocks a risky artifact with zero Surface calls when approval is denied", async () => {
    const decider = createFixedApprovalDecider("denied");
    const { surface: spy, calls } = await import("./fixtures/spy-surface").then((m) => m.wrapSurfaceWithSpy(createFakeSurface()));

    const result = await replayArtifact({
      artifact: buildReplayableArtifact({ riskLevel: "risky" }),
      inputs: { memberId: "1001" },
      surface: spy,
      policy: { guard, requestApproval: decider },
    });

    expect(result.status).toBe("blocked");
    expect(result.steps).toHaveLength(0);
    expect(result.policy).toEqual({ riskLevel: "risky", classification: "approval_required", approvalDecision: "denied" });
    expect(calls).toHaveLength(0); // no navigate/click/type/read/observe was ever attempted
  });

  it("blocks with zero Surface calls when the target base URL isn't allowlisted, without ever asking for approval", async () => {
    const decider = createFixedApprovalDecider("approved");
    const { surface: spy, calls } = await import("./fixtures/spy-surface").then((m) => m.wrapSurfaceWithSpy(createFakeSurface()));

    const result = await replayArtifact({
      artifact: buildReplayableArtifact({ target: { appId: "x", baseUrl: "http://evil.example.com", surfaceType: "web" } }),
      inputs: { memberId: "1001" },
      surface: spy,
      policy: { guard, requestApproval: decider },
    });

    expect(result.status).toBe("blocked");
    expect(result.steps).toHaveLength(0);
    expect(result.policy?.classification).toBe("blocked");
    expect(decider.requests).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });

  it("without a policy option at all, behaves exactly as Phase 7 did — a risky artifact just runs", async () => {
    const result = await replayArtifact({
      artifact: buildReplayableArtifact({ riskLevel: "risky" }),
      inputs: { memberId: "1001" },
      surface: createFakeSurface(),
      // no `policy` option supplied
    });

    expect(result.status).toBe("success");
    expect(result.policy).toBeUndefined();
  });
});

describe("replayArtifact — Phase 8 bounded retry", () => {
  it("retries a step whose error is recoverable, up to maxRetries, and succeeds once the underlying issue clears", async () => {
    const result = await replayArtifact({
      artifact: buildReplayableArtifact(),
      inputs: { memberId: "1001" },
      surface: createFlakySurface(2), // click fails twice, then works
      config: { maxRetries: 2 },
    });

    expect(result.status).toBe("success");
    const clickAttempts = result.steps.filter((s) => s.action === "click");
    expect(clickAttempts.map((s) => s.attempt)).toEqual([1, 2, 3]);
    expect(clickAttempts[2].outcome.status).toBe("ok");
  });

  it("gives up once retries are exhausted", async () => {
    const result = await replayArtifact({
      artifact: buildReplayableArtifact(),
      inputs: { memberId: "1001" },
      surface: createFlakySurface(10), // never recovers within budget
      config: { maxRetries: 2 },
    });

    expect(result.status).toBe("target_not_found");
    const clickAttempts = result.steps.filter((s) => s.action === "click");
    expect(clickAttempts.map((s) => s.attempt)).toEqual([1, 2, 3]); // 1 initial + 2 retries, then give up
  });

  it("does not retry a hard failure (SESSION_CLOSED), even once", async () => {
    const surface = createFakeSurface();
    let clickCalls = 0;
    surface.click = async () => {
      clickCalls += 1;
      return { ok: false, error: { code: "SESSION_CLOSED", message: "closed" } };
    };

    const result = await replayArtifact({
      artifact: buildReplayableArtifact(),
      inputs: { memberId: "1001" },
      surface,
      config: { maxRetries: 5 },
    });

    expect(result.status).toBe("action_failed");
    expect(clickCalls).toBe(1);
  });
});

describe("replayArtifact — Phase 8 business-outcome classification, end to end", () => {
  it("reports business_outcome (not checkpoint_mismatch) when the artifact's businessOutcomes match the final page", async () => {
    const artifact = buildReplayableArtifact({
      checkpoint: { all: [{ type: "textPresent", text: "This will never appear" }] },
      businessOutcomes: [
        {
          code: "MEMBER_NOT_FOUND",
          description: "No such member.",
          when: [{ type: "textPresent", text: "Member details loaded successfully." }],
        },
      ],
    });

    const result = await replayArtifact({
      artifact,
      inputs: { memberId: "1001" },
      surface: createFakeSurface(),
    });

    expect(result.status).toBe("business_outcome");
    expect(result.outcomeClassification).toMatchObject({ kind: "business_outcome", businessOutcomeCode: "MEMBER_NOT_FOUND" });
    expect(result.error).toBeUndefined(); // an expected outcome, not an error
  });
});
