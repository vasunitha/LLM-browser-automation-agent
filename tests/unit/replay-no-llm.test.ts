import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { replayArtifact } from "../../src/replay/engine";
import { runReplay } from "../../src/replay/index";
import { buildReplayableArtifact } from "./fixtures/replay-artifact";
import { createFakeSurface } from "./fixtures/fake-surface";

const REPLAY_SRC_DIR = join(__dirname, "../../src/replay");

describe("the replay engine never invokes an LLM", () => {
  // Static proof: no file under src/replay references the Anthropic SDK,
  // the discovery agent module, or any Anthropic env var — a much
  // stronger guarantee than "the tests happened not to trigger it," since
  // it's checked directly against the source that ships.
  it("no file under src/replay imports @anthropic-ai/sdk, ../agent, or reads an Anthropic env var", () => {
    const files = readdirSync(REPLAY_SRC_DIR).filter((f) => f.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(0);

    const forbidden = [/@anthropic-ai\/sdk/, /from ["']\.\.\/agent/, /ANTHROPIC_API_KEY/, /ANTHROPIC_MODEL/, /createAnthropicLlmClient/];

    for (const file of files) {
      const contents = readFileSync(join(REPLAY_SRC_DIR, file), "utf8");
      for (const pattern of forbidden) {
        expect(contents, `${file} unexpectedly matches ${pattern}`).not.toMatch(pattern);
      }
    }
  });

  // Dynamic proof: a full, successful replay works with ANTHROPIC_API_KEY
  // completely absent from the environment. If any code path in the
  // replay engine ever tried to construct an Anthropic client, it would
  // fail immediately without a key (see src/agent/index.ts's
  // requireLlmClientFromEnv) — so a passing replay here is direct
  // evidence that no such path exists, not just that this particular run
  // didn't happen to need one.
  it("replays successfully with ANTHROPIC_API_KEY unset — the LLM is not needed, not just unused", async () => {
    const original = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    try {
      const result = await replayArtifact({
        artifact: buildReplayableArtifact(),
        inputs: { memberId: "1001" },
        surface: createFakeSurface(),
      });
      expect(result.status).toBe("success");
    } finally {
      if (original !== undefined) process.env.ANTHROPIC_API_KEY = original;
    }
  });

  it("runReplay() (the full entry point) never touches ANTHROPIC_API_KEY, even with it unset", async () => {
    const original = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    try {
      const surface = createFakeSurface();
      const { writeFileSync, mkdtempSync } = await import("node:fs");
      const { tmpdir } = await import("node:os");
      const artifactsDir = mkdtempSync(join(tmpdir(), "no-llm-artifacts-"));
      const evidenceDir = mkdtempSync(join(tmpdir(), "no-llm-evidence-"));
      writeFileSync(join(artifactsDir, "get-savings-balance.json"), JSON.stringify(buildReplayableArtifact()), "utf8");

      const { result } = await runReplay(
        { artifactId: "get-savings-balance", inputs: { memberId: "1001" } },
        { surface, artifactsDir, evidenceDir },
      );

      expect(result.status).toBe("success");
    } finally {
      if (original !== undefined) process.env.ANTHROPIC_API_KEY = original;
    }
  });
});
