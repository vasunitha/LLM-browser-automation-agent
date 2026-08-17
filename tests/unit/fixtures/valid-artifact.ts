import type { Artifact } from "../../../src/artifact";

/**
 * A minimal but fully valid artifact, used as a base fixture across the
 * Phase 5 test suite. Returns a fresh object literal on every call (no
 * shared mutable state) — use structuredClone() only if you need to
 * mutate a nested field without calling this again.
 */
export function buildValidArtifact(): Artifact {
  return {
    schemaVersion: "1.0",
    id: "test-capability",
    name: "Test Capability",
    description: "A minimal valid artifact used for validation tests.",
    version: "1.0.0",
    createdAt: "2026-08-16T00:00:00.000Z",
    riskLevel: "safe",
    target: {
      appId: "credit-union-teller-console",
      baseUrl: "http://localhost:3000",
      surfaceType: "web",
    },
    inputs: [{ name: "memberId", type: "string", required: true, description: "Member ID" }],
    outputs: [{ name: "savingsBalance", type: "string", description: "Balance", sourceStepId: 3 }],
    steps: [
      { stepId: 1, action: "navigate", url: "/" },
      {
        stepId: 2,
        action: "type",
        target: { strategies: [{ type: "role", role: "textbox", name: "Member ID" }] },
        value: "{{memberId}}",
      },
      {
        stepId: 3,
        action: "read",
        target: { strategies: [{ type: "css", selector: "strong" }] },
        outputRef: "savingsBalance",
      },
    ],
    checkpoint: {
      all: [{ type: "textPresent", text: "Member details loaded successfully." }],
    },
    businessOutcomes: [
      {
        code: "MEMBER_NOT_FOUND",
        description: "No such member.",
        when: [{ type: "textPresent", text: "Member Not Found" }],
      },
    ],
  };
}
