import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runDiscovery } from "../../src/agent/index";
import { ArtifactStore } from "../../src/artifact/store";
import type { DiscoveryGoal } from "../../src/agent/types";
import { createFakeSurface } from "./fixtures/fake-surface";
import { createScriptedLlmClient } from "./fixtures/fake-llm-client";

const MEMBER_ID_LOCATOR = { strategies: [{ type: "role" as const, role: "textbox", name: "Member ID" }] };
const SEARCH_BUTTON_LOCATOR = { strategies: [{ type: "role" as const, role: "button", name: "Search" }] };
const BALANCE_LOCATOR = { strategies: [{ type: "css" as const, selector: "strong" }] };

const GOAL: DiscoveryGoal = {
  goal: "Look up member 1001 and read their current savings balance.",
  targetBaseUrl: "http://localhost:3000",
  capabilityId: "get-savings-balance",
};

describe("runDiscovery (full orchestration: loop -> compile -> store -> evidence)", () => {
  let evidenceDir: string;
  let artifactsDir: string;

  beforeEach(() => {
    evidenceDir = mkdtempSync(join(tmpdir(), "run-discovery-evidence-"));
    artifactsDir = mkdtempSync(join(tmpdir(), "run-discovery-artifacts-"));
  });

  afterEach(() => {
    rmSync(evidenceDir, { recursive: true, force: true });
    rmSync(artifactsDir, { recursive: true, force: true });
  });

  // 8. successful discovery produces an artifact (full pipeline)
  it("a successful run saves a valid, parameterized artifact and writes evidence", async () => {
    const surface = createFakeSurface();
    const llmClient = createScriptedLlmClient([
      { action: "type", target: MEMBER_ID_LOCATOR, value: "1001", inputRef: "memberId" },
      { action: "click", target: SEARCH_BUTTON_LOCATOR },
      { action: "read", target: BALANCE_LOCATOR, outputRef: "savingsBalance" },
      { action: "finish", outputRefs: ["savingsBalance"], checkpointText: "Member details loaded successfully." },
    ]);

    const result = await runDiscovery(GOAL, {}, { surface, llmClient, evidenceDir, artifactsDir });

    expect(result.trace.finalOutcome.status).toBe("success");
    expect(result.artifactId).toBe("get-savings-balance");

    const store = new ArtifactStore(artifactsDir);
    expect(store.exists("get-savings-balance")).toBe(true);
    const saved = store.load("get-savings-balance");
    expect(JSON.stringify(saved.steps)).not.toContain("1001");
    expect(saved.inputs.find((i) => i.name === "memberId")?.example).toBe("1001");

    expect(result.evidenceDir).toBeDefined();
    expect(existsSync(join(result.evidenceDir!, "trace.json"))).toBe(true);
    expect(existsSync(join(result.evidenceDir!, "artifact.json"))).toBe(true);
    const screenshotFiles = readdirSync(join(result.evidenceDir!, "screenshots"));
    expect(screenshotFiles.length).toBeGreaterThan(0);
  });

  // 10. failed discovery does NOT produce a successful artifact
  it("a failed run writes evidence but saves no artifact", async () => {
    const surface = createFakeSurface();
    const llmClient = createScriptedLlmClient([{ action: "fail", reason: "could not locate the member field" }]);

    const result = await runDiscovery(GOAL, {}, { surface, llmClient, evidenceDir, artifactsDir });

    expect(result.trace.finalOutcome.status).toBe("failure");
    expect(result.artifactId).toBeUndefined();

    const store = new ArtifactStore(artifactsDir);
    expect(store.list()).toEqual([]);
    expect(existsSync(join(result.evidenceDir!, "artifact.json"))).toBe(false);
    expect(existsSync(join(result.evidenceDir!, "trace.json"))).toBe(true);
  });

  it("a max-steps-exceeded run also writes evidence with no artifact", async () => {
    const surface = createFakeSurface();
    const llmClient = createScriptedLlmClient([{ action: "click", target: SEARCH_BUTTON_LOCATOR }]);

    const result = await runDiscovery(
      GOAL,
      { maxSteps: 1 },
      { surface, llmClient, evidenceDir, artifactsDir },
    );

    expect(result.trace.finalOutcome.status).toBe("max_steps_exceeded");
    expect(result.artifactId).toBeUndefined();
    const store = new ArtifactStore(artifactsDir);
    expect(store.list()).toEqual([]);
  });

  it("does not close a Surface it was not given ownership of", async () => {
    const surface = createFakeSurface();
    let closed = false;
    const originalClose = surface.close.bind(surface);
    surface.close = async () => {
      closed = true;
      await originalClose();
    };
    const llmClient = createScriptedLlmClient([{ action: "fail", reason: "test" }]);

    await runDiscovery(GOAL, {}, { surface, llmClient, evidenceDir, artifactsDir });

    expect(closed).toBe(false);
  });
});
