import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArtifactStore } from "../../src/artifact";
import { buildValidArtifact } from "./fixtures/valid-artifact";

describe("ArtifactStore", () => {
  let dir: string;
  let store: ArtifactStore;

  beforeEach(() => {
    // Isolated temp directory per test — never touches the real,
    // committed artifacts/ directory.
    dir = mkdtempSync(join(tmpdir(), "artifact-store-test-"));
    store = new ArtifactStore(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  // 13. artifact store save/load
  it("saves and loads an artifact, preserving its contents", () => {
    const artifact = buildValidArtifact();
    store.save(artifact);
    const loaded = store.load(artifact.id);
    expect(loaded).toEqual(artifact);
  });

  it("refuses to save an invalid artifact", () => {
    const invalid = { ...buildValidArtifact(), schemaVersion: "99.0" };
    expect(() => store.save(invalid)).toThrow(/invalid artifact/i);
  });

  // 14. artifact store exists
  it("reports exists() correctly before and after saving", () => {
    const artifact = buildValidArtifact();
    expect(store.exists(artifact.id)).toBe(false);
    store.save(artifact);
    expect(store.exists(artifact.id)).toBe(true);
  });

  // 15. artifact store list
  it("lists saved artifact IDs, sorted", () => {
    store.save({ ...buildValidArtifact(), id: "zeta-capability" });
    store.save({ ...buildValidArtifact(), id: "alpha-capability" });
    expect(store.list()).toEqual(["alpha-capability", "zeta-capability"]);
  });

  it("list() returns an empty array when the store directory doesn't exist yet", () => {
    const freshDir = join(dir, "does-not-exist-yet");
    const freshStore = new ArtifactStore(freshDir);
    expect(freshStore.list()).toEqual([]);
  });

  // 16. missing artifact behavior
  it("load() throws a clear error for a nonexistent artifact id", () => {
    expect(() => store.load("nonexistent-capability")).toThrow(/was not found/i);
  });

  it("exists() returns false for a nonexistent artifact id", () => {
    expect(store.exists("nonexistent-capability")).toBe(false);
  });
});
