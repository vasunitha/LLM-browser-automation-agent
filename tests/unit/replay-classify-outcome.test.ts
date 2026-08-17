import { describe, it, expect } from "vitest";
import { classifyReplayOutcome } from "../../src/replay/classify-outcome";
import { buildReplayableArtifact } from "./fixtures/replay-artifact";
import { createFakeSurface } from "./fixtures/fake-surface";

describe("classifyReplayOutcome", () => {
  it("classifies as business_outcome when a declared businessOutcomes[] condition matches the observed page", async () => {
    const artifact = buildReplayableArtifact({
      businessOutcomes: [
        {
          code: "MEMBER_NOT_FOUND",
          description: "No such member.",
          when: [{ type: "textPresent", text: "Credit Union Teller Console" }],
        },
      ],
    });
    const surface = createFakeSurface(); // starts on the search page, whose text includes "Credit Union Teller Console"
    const obs = await surface.observe();
    if (!obs.ok) throw new Error("fixture observe failed");

    const result = await classifyReplayOutcome(artifact, surface, obs.value.url, obs.value.text, {});

    expect(result).toMatchObject({ kind: "business_outcome", businessOutcomeCode: "MEMBER_NOT_FOUND" });
  });

  it("classifies as hard_failure when no declared businessOutcomes[] condition matches", async () => {
    const artifact = buildReplayableArtifact({
      businessOutcomes: [
        {
          code: "MEMBER_NOT_FOUND",
          description: "No such member.",
          when: [{ type: "textPresent", text: "This text will never appear" }],
        },
      ],
    });
    const surface = createFakeSurface();
    const obs = await surface.observe();
    if (!obs.ok) throw new Error("fixture observe failed");

    const result = await classifyReplayOutcome(artifact, surface, obs.value.url, obs.value.text, {});

    expect(result).toEqual({ kind: "hard_failure" });
  });

  it("classifies as hard_failure when the artifact declares no businessOutcomes at all", async () => {
    const artifact = buildReplayableArtifact({ businessOutcomes: [] });
    const surface = createFakeSurface();
    const obs = await surface.observe();
    if (!obs.ok) throw new Error("fixture observe failed");

    const result = await classifyReplayOutcome(artifact, surface, obs.value.url, obs.value.text, {});

    expect(result).toEqual({ kind: "hard_failure" });
  });

  it("checks businessOutcomes in declared order and returns the first match", async () => {
    const artifact = buildReplayableArtifact({
      businessOutcomes: [
        { code: "FIRST", description: "first", when: [{ type: "textPresent", text: "nonexistent-xyz" }] },
        { code: "SECOND", description: "second", when: [{ type: "textPresent", text: "Credit Union Teller Console" }] },
      ],
    });
    const surface = createFakeSurface();
    const obs = await surface.observe();
    if (!obs.ok) throw new Error("fixture observe failed");

    const result = await classifyReplayOutcome(artifact, surface, obs.value.url, obs.value.text, {});

    expect(result.businessOutcomeCode).toBe("SECOND");
  });
});
