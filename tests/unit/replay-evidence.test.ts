import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { replayArtifact } from "../../src/replay/engine";
import { runReplay } from "../../src/replay/index";
import { writeReplayEvidence } from "../../src/replay/evidence";
import { buildReplayableArtifact } from "./fixtures/replay-artifact";
import { createFakeSurface } from "./fixtures/fake-surface";

describe("replay evidence and full runReplay() orchestration", () => {
  let evidenceDir: string;
  let artifactsDir: string;

  beforeEach(() => {
    evidenceDir = mkdtempSync(join(tmpdir(), "replay-evidence-"));
    artifactsDir = mkdtempSync(join(tmpdir(), "replay-artifacts-"));
  });

  afterEach(() => {
    rmSync(evidenceDir, { recursive: true, force: true });
    rmSync(artifactsDir, { recursive: true, force: true });
  });

  // 11. successful replay produces evidence
  it("writes result.json, artifact.json, summary.md, and screenshots under evidence/replay/<run-id>/", async () => {
    const result = await replayArtifact({
      artifact: buildReplayableArtifact(),
      inputs: { memberId: "1001" },
      surface: createFakeSurface(),
    });

    const runDir = writeReplayEvidence({
      evidenceDir,
      result,
      artifact: buildReplayableArtifact(),
      screenshots: [{ label: "final", base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=" }],
    });

    expect(runDir).toBe(join(evidenceDir, "replay", result.runId));
    expect(existsSync(join(runDir, "result.json"))).toBe(true);
    expect(existsSync(join(runDir, "artifact.json"))).toBe(true);
    expect(existsSync(join(runDir, "summary.md"))).toBe(true);
    expect(readdirSync(join(runDir, "screenshots")).length).toBeGreaterThan(0);

    const savedResult = JSON.parse(readFileSync(join(runDir, "result.json"), "utf8"));
    expect(savedResult.status).toBe("success");
    expect(savedResult.runId).toBe(result.runId);

    const summary = readFileSync(join(runDir, "summary.md"), "utf8");
    expect(summary).toContain("deterministic replay");
    expect(summary.toLowerCase()).toContain("no llm was invoked");
  });

  it("still writes evidence for a failed replay, without an artifact snapshot when the artifact itself was invalid", async () => {
    const result = await replayArtifact({ artifact: { bad: true }, inputs: {}, surface: createFakeSurface() });

    const runDir = writeReplayEvidence({ evidenceDir, result });

    expect(existsSync(join(runDir, "result.json"))).toBe(true);
    expect(existsSync(join(runDir, "artifact.json"))).toBe(false);
    const savedResult = JSON.parse(readFileSync(join(runDir, "result.json"), "utf8"));
    expect(savedResult.status).toBe("invalid_artifact");
  });

  // Phase 8: safety and approval decisions in evidence
  it("shows the policy classification and approval decision in summary.md and result.json when a policy check ran", async () => {
    const { PolicyGuard } = await import("../../src/safety/policy-guard");
    const { createFixedApprovalDecider } = await import("./fixtures/fake-approval-decider");
    const guard = new PolicyGuard({ allowedBaseUrls: ["http://localhost:3000"] });

    const result = await replayArtifact({
      artifact: buildReplayableArtifact({ riskLevel: "risky" }),
      inputs: { memberId: "1001" },
      surface: createFakeSurface(),
      policy: { guard, requestApproval: createFixedApprovalDecider("approved") },
    });

    const runDir = writeReplayEvidence({ evidenceDir, result, artifact: buildReplayableArtifact({ riskLevel: "risky" }) });

    const summary = readFileSync(join(runDir, "summary.md"), "utf8");
    expect(summary).toContain("Safety / approval decision");
    expect(summary).toContain("risky");
    expect(summary).toContain("approval_required");
    expect(summary).toContain("approved");

    const savedResult = JSON.parse(readFileSync(join(runDir, "result.json"), "utf8"));
    expect(savedResult.policy).toEqual({ riskLevel: "risky", classification: "approval_required", approvalDecision: "approved" });
  });

  // Full orchestration: runReplay() reads the artifact file, replays it,
  // and writes evidence — exercised with a real artifact file on disk so
  // the file-reading path (not just replayArtifact() directly) is covered.
  it("runReplay() loads the artifact by id from artifactsDir, replays it, and writes evidence", async () => {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(join(artifactsDir, "get-savings-balance.json"), JSON.stringify(buildReplayableArtifact()), "utf8");

    const surface = createFakeSurface();
    const { result, evidenceDir: runEvidenceDir } = await runReplay(
      { artifactId: "get-savings-balance", inputs: { memberId: "1001" } },
      { surface, artifactsDir, evidenceDir },
    );

    expect(result.status).toBe("success");
    expect(existsSync(join(runEvidenceDir, "result.json"))).toBe(true);
    expect(existsSync(join(runEvidenceDir, "artifact.json"))).toBe(true);
  });

  it("runReplay() reports invalid_artifact cleanly when the artifact file doesn't exist", async () => {
    const { result } = await runReplay(
      { artifactId: "does-not-exist", inputs: {} },
      { surface: createFakeSurface(), artifactsDir, evidenceDir },
    );

    expect(result.status).toBe("invalid_artifact");
  });

  it("does not close a Surface it was not given ownership of", async () => {
    const surface = createFakeSurface();
    let closed = false;
    const originalClose = surface.close.bind(surface);
    surface.close = async () => {
      closed = true;
      await originalClose();
    };
    const { writeFileSync } = await import("node:fs");
    writeFileSync(join(artifactsDir, "get-savings-balance.json"), JSON.stringify(buildReplayableArtifact()), "utf8");

    await runReplay({ artifactId: "get-savings-balance", inputs: { memberId: "1001" } }, { surface, artifactsDir, evidenceDir });

    expect(closed).toBe(false);
  });
});
