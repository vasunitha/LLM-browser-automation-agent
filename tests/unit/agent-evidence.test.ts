import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeDiscoveryEvidence } from "../../src/agent/evidence";
import { compileArtifactFromTrace } from "../../src/agent/compile-artifact";
import type { DiscoveryTrace } from "../../src/agent/types";
import { TINY_PNG_BASE64 } from "./fixtures/fake-surface";

const MEMBER_ID_LOCATOR = { strategies: [{ type: "role" as const, role: "textbox", name: "Member ID" }] };
const BALANCE_LOCATOR = { strategies: [{ type: "css" as const, selector: "strong" }] };

function buildSuccessfulTrace(reasoning?: string): DiscoveryTrace {
  return {
    runId: "evidence-test-run",
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
        observation: {
          url: "http://localhost:3000/members/1001",
          title: "Details",
          controls: [],
          visibleText: "Member details loaded successfully.",
        },
        action: { action: "read", target: BALANCE_LOCATOR, outputRef: "savingsBalance" },
        outcome: { status: "ok", value: "$482.17" },
      },
      {
        stepNumber: 3,
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
          reasoning,
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

describe("writeDiscoveryEvidence", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "evidence-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  // 11. evidence directory/run structure
  it("writes trace.json, summary.md, artifact.json, and screenshots under evidence/discovery/<run-id>/", () => {
    const trace = buildSuccessfulTrace();
    const artifact = compileArtifactFromTrace(trace, { capabilityId: "get-savings-balance" });

    const runDir = writeDiscoveryEvidence({
      evidenceDir: dir,
      trace,
      artifact,
      screenshots: [{ label: "step-1", base64: TINY_PNG_BASE64 }, { label: "final", base64: TINY_PNG_BASE64 }],
    });

    expect(runDir).toBe(join(dir, "discovery", trace.runId));
    expect(existsSync(join(runDir, "trace.json"))).toBe(true);
    expect(existsSync(join(runDir, "artifact.json"))).toBe(true);
    expect(existsSync(join(runDir, "summary.md"))).toBe(true);

    const screenshotFiles = readdirSync(join(runDir, "screenshots"));
    expect(screenshotFiles).toHaveLength(2);
    expect(screenshotFiles.every((f) => f.endsWith(".png"))).toBe(true);

    const savedTrace = JSON.parse(readFileSync(join(runDir, "trace.json"), "utf8"));
    expect(savedTrace.runId).toBe(trace.runId);
    expect(savedTrace.goal).toBe(trace.goal);

    const summary = readFileSync(join(runDir, "summary.md"), "utf8");
    expect(summary).toContain(trace.goal);
    expect(summary).toContain("claude-sonnet-5");
    // The summary must show the ordered, per-step decisions — this is the
    // evidence a reviewer uses to confirm the run was genuinely LLM-driven.
    expect(summary).toContain("Step-by-step decisions");
  });

  it("writes no artifact.json when the run did not succeed", () => {
    const trace = buildSuccessfulTrace();
    trace.finalOutcome = { status: "failure", reason: "could not find the member" };

    const runDir = writeDiscoveryEvidence({ evidenceDir: dir, trace });

    expect(existsSync(join(runDir, "artifact.json"))).toBe(false);
    expect(existsSync(join(runDir, "trace.json"))).toBe(true);
  });

  // 12. sensitive configuration is not written to evidence
  it("redacts anything that looks like an API key before writing trace.json", () => {
    const fakeKey = "sk-ant-api03-THIS-LOOKS-LIKE-A-REAL-SECRET-KEY-VALUE";
    const trace = buildSuccessfulTrace(`I chose this because context mentioned ${fakeKey} accidentally.`);

    const runDir = writeDiscoveryEvidence({ evidenceDir: dir, trace });

    const raw = readFileSync(join(runDir, "trace.json"), "utf8");
    expect(raw).not.toContain(fakeKey);
    expect(raw).toContain("[REDACTED]");
  });

  // Phase 8: safety and approval decisions in evidence
  it("shows the policy classification and approval decision in summary.md when a policy check ran", () => {
    const trace = buildSuccessfulTrace();
    trace.policy = { riskLevel: "risky", classification: "approval_required", approvalDecision: "approved" };

    const runDir = writeDiscoveryEvidence({ evidenceDir: dir, trace });

    const summary = readFileSync(join(runDir, "summary.md"), "utf8");
    expect(summary).toContain("Safety / approval decision");
    expect(summary).toContain("risky");
    expect(summary).toContain("approval_required");
    expect(summary).toContain("approved");

    const savedTrace = JSON.parse(readFileSync(join(runDir, "trace.json"), "utf8"));
    expect(savedTrace.policy).toEqual(trace.policy);
  });

  it("never writes an ANTHROPIC_API_KEY-shaped field anywhere in the evidence directory", () => {
    const trace = buildSuccessfulTrace();
    const artifact = compileArtifactFromTrace(trace, { capabilityId: "get-savings-balance" });
    const runDir = writeDiscoveryEvidence({ evidenceDir: dir, trace, artifact });

    for (const file of ["trace.json", "artifact.json", "summary.md"]) {
      const contents = readFileSync(join(runDir, file), "utf8");
      expect(contents.toLowerCase()).not.toContain("anthropic_api_key");
      expect(contents).not.toMatch(/sk-ant-[a-zA-Z0-9_-]{10,}/);
    }
  });
});
