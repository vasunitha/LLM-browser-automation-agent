import { describe, it, expect } from "vitest";
import { toJson, fromJson } from "../../src/artifact";
import { buildValidArtifact } from "./fixtures/valid-artifact";

describe("artifact serialization", () => {
  // 12. serialization/deserialization round trip
  it("round-trips an artifact through JSON without losing data", () => {
    const original = buildValidArtifact();
    const json = toJson(original);
    const result = fromJson(json);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.artifact).toEqual(original);
    }
  });

  it("produces readable, indented JSON (not minified)", () => {
    const json = toJson(buildValidArtifact());
    expect(json).toContain("\n");
    expect(json).toContain("  \"id\": \"test-capability\"");
  });

  it("reports a structured error for malformed JSON rather than throwing", () => {
    const result = fromJson("{ not valid json");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0].message).toContain("Invalid JSON");
    }
  });

  it("runs deserialized artifacts through the same validation as any other input", () => {
    const invalid = { ...buildValidArtifact(), schemaVersion: "99.0" };
    const result = fromJson(JSON.stringify(invalid));
    expect(result.valid).toBe(false);
  });
});
