import { describe, it, expect } from "vitest";
import { HandoffController } from "../../src/handoff";
import { createFixedApprovalDecider } from "./fixtures/fake-approval-decider";

describe("HandoffController", () => {
  it("requestApproval() delegates to the injected decider and returns its decision", async () => {
    const decider = createFixedApprovalDecider("approved");
    const controller = new HandoffController(decider);

    const decision = await controller.requestApproval({
      runId: "run-1",
      kind: "replay",
      summary: "open-sub-account (v1.0.0)",
      reason: "risky artifact",
    });

    expect(decision).toBe("approved");
    expect(decider.requests).toHaveLength(1);
    expect(decider.requests[0]).toMatchObject({ runId: "run-1", kind: "replay" });
  });

  it("propagates a denial decision unchanged", async () => {
    const controller = new HandoffController(createFixedApprovalDecider("denied"));
    const decision = await controller.requestApproval({
      runId: "run-2",
      kind: "discovery",
      summary: "goal text",
      reason: "risky goal",
    });
    expect(decision).toBe("denied");
  });

  it("records and lists interventions for evidence/audit purposes", () => {
    const controller = new HandoffController(createFixedApprovalDecider("approved"));
    controller.recordIntervention("run-3", "checkpoint never satisfied after 3 attempts");

    const interventions = controller.getInterventions();
    expect(interventions).toHaveLength(1);
    expect(interventions[0]).toMatchObject({ runId: "run-3", reason: "checkpoint never satisfied after 3 attempts" });
    expect(typeof interventions[0].timestamp).toBe("string");
  });

  it("getInterventions() returns a copy, not the live internal array", () => {
    const controller = new HandoffController(createFixedApprovalDecider("approved"));
    controller.recordIntervention("run-4", "reason");
    const first = controller.getInterventions();
    first.push({ runId: "tampered", reason: "should not persist", timestamp: "now" });
    expect(controller.getInterventions()).toHaveLength(1);
  });
});
