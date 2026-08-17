import type { Artifact } from "../../../src/artifact/types";

/**
 * A minimal, self-contained artifact fixture for Phase 7 replay engine
 * tests — mirrors the shape of the real get-savings-balance capability
 * but is deliberately NOT read from artifacts/get-savings-balance.json.
 * That file is live Phase 6 discovery output and can change with every
 * new discovery run; the replay engine must work generically for any
 * validly-shaped artifact, so its own tests are pinned to a fixture the
 * test suite controls, not to whatever the last real run happened to
 * produce. Locators here match tests/unit/fixtures/fake-surface.ts's
 * createFakeSurface() (role/name for the form fields, `{type:"css",
 * selector:"strong"}` for the balance).
 */
export function buildReplayableArtifact(overrides: Partial<Artifact> = {}): Artifact {
  return {
    schemaVersion: "1.0",
    id: "get-savings-balance",
    name: "Get Savings Balance",
    description: "Test fixture mirroring the real get-savings-balance capability.",
    version: "1.0.0",
    createdAt: "2026-08-16T00:00:00.000Z",
    riskLevel: "safe",
    target: {
      appId: "credit-union-teller-console",
      baseUrl: "http://localhost:3000",
      surfaceType: "web",
    },
    inputs: [{ name: "memberId", type: "string", required: true, example: "1001" }],
    outputs: [{ name: "savingsBalance", type: "string", sourceStepId: 4 }],
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
        action: "click",
        target: { strategies: [{ type: "role", role: "button", name: "Search" }] },
      },
      {
        stepId: 4,
        action: "read",
        target: { strategies: [{ type: "css", selector: "strong" }] },
        outputRef: "savingsBalance",
      },
    ],
    checkpoint: {
      all: [
        { type: "urlMatches", pattern: "/members/{{memberId}}" },
        { type: "textPresent", text: "Member details loaded successfully." },
      ],
    },
    businessOutcomes: [
      {
        code: "MEMBER_NOT_FOUND",
        description: "No such member.",
        when: [{ type: "textPresent", text: "Member Not Found" }],
      },
    ],
    ...overrides,
  };
}
