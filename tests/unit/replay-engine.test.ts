import { describe, it, expect } from "vitest";
import { replayArtifact, executeStep } from "../../src/replay/engine";
import { buildReplayableArtifact } from "./fixtures/replay-artifact";
import { createFakeSurface, createAlwaysFailingSurface } from "./fixtures/fake-surface";
import { wrapSurfaceWithSpy } from "./fixtures/spy-surface";

describe("replayArtifact", () => {
  // 1. valid artifact replays successfully
  it("replays a valid artifact against a live-shaped Surface to a successful result", async () => {
    const surface = createFakeSurface();
    const result = await replayArtifact({
      artifact: buildReplayableArtifact(),
      inputs: { memberId: "1001" },
      surface,
    });

    expect(result.status).toBe("success");
    expect(result.error).toBeUndefined();
    expect(result.artifactId).toBe("get-savings-balance");
    expect(result.artifactVersion).toBe("1.0.0");
  });

  // 2. runtime memberId is correctly substituted
  it("substitutes {{memberId}} with the real runtime value before acting on the Surface", async () => {
    const surface = createFakeSurface({ memberId: "1002", balance: "$1,234.56" });
    const { surface: spy, calls } = wrapSurfaceWithSpy(surface);

    const result = await replayArtifact({
      artifact: buildReplayableArtifact(),
      inputs: { memberId: "1002" },
      surface: spy,
    });

    expect(result.status).toBe("success");
    const typeCall = calls.find((c) => c.method === "type");
    expect(typeCall?.args[1]).toBe("1002"); // not the literal "{{memberId}}"
    expect(result.outputs.savingsBalance).toBe("$1,234.56");
  });

  // 3. replay uses Surface
  it("drives every step through the given Surface, not around it", async () => {
    const { surface: spy, calls } = wrapSurfaceWithSpy(createFakeSurface());

    await replayArtifact({ artifact: buildReplayableArtifact(), inputs: { memberId: "1001" }, surface: spy });

    const methodsUsed = new Set(calls.map((c) => c.method));
    expect(methodsUsed).toEqual(new Set(["navigate", "type", "click", "read", "observe"]));
  });

  // 5. missing required input fails cleanly
  it("fails cleanly with missing_input when a required input is not supplied", async () => {
    const result = await replayArtifact({
      artifact: buildReplayableArtifact(),
      inputs: {},
      surface: createFakeSurface(),
    });

    expect(result.status).toBe("missing_input");
    expect(result.error?.code).toBe("MISSING_INPUT");
    expect(result.steps).toHaveLength(0);
  });

  it("fails cleanly with invalid_input when a declared number input isn't numeric", async () => {
    const artifact = buildReplayableArtifact({
      inputs: [{ name: "memberId", type: "number", required: true, example: "1001" }],
    });
    const result = await replayArtifact({
      artifact,
      inputs: { memberId: "not-a-number" },
      surface: createFakeSurface(),
    });

    expect(result.status).toBe("invalid_input");
    expect(result.error?.code).toBe("INVALID_INPUT");
  });

  // 6. invalid artifact fails validation
  it("fails cleanly with invalid_artifact before making any Surface call", async () => {
    const { surface: spy, calls } = wrapSurfaceWithSpy(createFakeSurface());

    const result = await replayArtifact({
      artifact: { not: "a valid artifact" },
      inputs: {},
      surface: spy,
    });

    expect(result.status).toBe("invalid_artifact");
    expect(result.error?.code).toBe("INVALID_ARTIFACT");
    expect(calls).toHaveLength(0); // no Surface interaction at all before validation
  });

  it("fails cleanly with invalid_artifact when a step declares an unsupported action", async () => {
    const badArtifact = {
      ...buildReplayableArtifact(),
      steps: [{ stepId: 1, action: "scroll", url: "/" }],
    };
    const result = await replayArtifact({ artifact: badArtifact, inputs: { memberId: "1001" }, surface: createFakeSurface() });

    expect(result.status).toBe("invalid_artifact");
  });

  // 7. unknown action fails cleanly (execution-layer defense in depth —
  // validateArtifact() already rejects this at the artifact level, tested
  // above; this proves executeStep() itself also refuses to silently act
  // on an unsupported step, for any future caller that builds one without
  // going through validation first).
  it("executeStep() reports UNKNOWN_ACTION for a step whose action isn't one of the four supported ones", async () => {
    const surface = createFakeSurface();
    const bogusStep = { stepId: 9, action: "scroll" } as unknown as Parameters<typeof executeStep>[0];

    const record = await executeStep(bogusStep, surface, "http://localhost:3000", {});

    expect(record.outcome).toMatchObject({ status: "error", code: "UNKNOWN_ACTION" });
  });

  // 8. target/action failure is reported
  it("reports target_not_found when a step's locator never resolves", async () => {
    const artifact = buildReplayableArtifact({
      outputs: [],
      steps: [
        { stepId: 1, action: "navigate", url: "/" },
        {
          stepId: 2,
          action: "click",
          target: { strategies: [{ type: "css", selector: "#does-not-exist" }] },
        },
      ],
    });

    const result = await replayArtifact({
      artifact,
      inputs: { memberId: "1001" },
      surface: createAlwaysFailingSurface(),
      config: { maxRetries: 0 },
    });

    expect(result.status).toBe("target_not_found");
    expect(result.steps).toHaveLength(2);
    expect(result.steps[1].outcome).toMatchObject({ status: "error", code: "ELEMENT_NOT_FOUND" });
  });

  it("reports navigation_failed when the Surface can't reach the target URL", async () => {
    const surface = createFakeSurface();
    surface.navigate = async () => ({ ok: false, error: { code: "NAVIGATION_FAILED", message: "connection refused" } });

    const result = await replayArtifact({
      artifact: buildReplayableArtifact(),
      inputs: { memberId: "1001" },
      surface,
      config: { maxRetries: 0 },
    });

    expect(result.status).toBe("navigation_failed");
    expect(result.steps).toHaveLength(1);
  });

  it("does not silently continue past a failed required step", async () => {
    const artifact = buildReplayableArtifact();
    const result = await replayArtifact({
      artifact,
      inputs: { memberId: "1001" },
      surface: createAlwaysFailingSurface(),
      config: { maxRetries: 0 },
    });

    // navigate (step 1) succeeds on the always-failing surface, type (step 2) fails -> stop there
    expect(result.steps).toHaveLength(2);
    expect(result.status).not.toBe("success");
  });

  // 9. checkpoint mismatch is reported
  it("reports checkpoint_mismatch when steps all succeed but the final page doesn't satisfy the checkpoint", async () => {
    const artifact = buildReplayableArtifact({
      checkpoint: { all: [{ type: "textPresent", text: "This text will never appear on the page" }] },
    });

    const result = await replayArtifact({ artifact, inputs: { memberId: "1001" }, surface: createFakeSurface() });

    expect(result.status).toBe("checkpoint_mismatch");
    expect(result.checkpoint?.satisfied).toBe(false);
    expect(result.checkpoint?.conditions[0].satisfied).toBe(false);
  });

  it("does not consider the run successful merely because every step's Surface call returned ok", async () => {
    // All four steps succeed against the fake surface, but the checkpoint
    // demands a URL pattern that will never be reached.
    const artifact = buildReplayableArtifact({
      checkpoint: { all: [{ type: "urlMatches", pattern: "/members/9999" }] },
    });

    const result = await replayArtifact({ artifact, inputs: { memberId: "1001" }, surface: createFakeSurface() });

    expect(result.steps.every((s) => s.outcome.status === "ok")).toBe(true);
    expect(result.status).toBe("checkpoint_mismatch");
  });

  // 10. replay produces structured outputs
  it("populates outputs from read steps, keyed by outputRef", async () => {
    const result = await replayArtifact({
      artifact: buildReplayableArtifact(),
      inputs: { memberId: "1001" },
      surface: createFakeSurface(),
    });

    expect(result.outputs).toEqual({ savingsBalance: "$482.17" });
  });

  // 12. failed replay does not claim success
  it("never reports status success for any of the failure paths above", async () => {
    const failureCases = await Promise.all([
      replayArtifact({ artifact: { bad: true }, inputs: {}, surface: createFakeSurface() }),
      replayArtifact({ artifact: buildReplayableArtifact(), inputs: {}, surface: createFakeSurface() }),
      replayArtifact({
        artifact: buildReplayableArtifact({ checkpoint: { all: [{ type: "textPresent", text: "nope" }] } }),
        inputs: { memberId: "1001" },
        surface: createFakeSurface(),
      }),
    ]);
    expect(failureCases.every((r) => r.status !== "success")).toBe(true);
  });

  it("reports timeout when the injected clock reports elapsed time past timeoutMs", async () => {
    let calls = 0;
    const clock = () => {
      calls += 1;
      return calls === 1 ? 0 : 999_999;
    };

    const result = await replayArtifact({
      artifact: buildReplayableArtifact(),
      inputs: { memberId: "1001" },
      surface: createFakeSurface(),
      config: { timeoutMs: 100 },
      clock,
    });

    expect(result.status).toBe("timeout");
  });

  it("calls onStepRecorded once per executed step, and its failures don't break replay", async () => {
    let calls = 0;
    const result = await replayArtifact({
      artifact: buildReplayableArtifact(),
      inputs: { memberId: "1001" },
      surface: createFakeSurface(),
      onStepRecorded: () => {
        calls += 1;
        throw new Error("evidence capture blew up");
      },
    });

    expect(result.status).toBe("success");
    expect(calls).toBe(4);
  });
});
