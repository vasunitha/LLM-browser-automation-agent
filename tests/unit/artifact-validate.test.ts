import { describe, it, expect } from "vitest";
import { validateArtifact } from "../../src/artifact";
import { buildValidArtifact } from "./fixtures/valid-artifact";

describe("validateArtifact", () => {
  // 1. valid artifact passes validation
  it("accepts a valid artifact", () => {
    const result = validateArtifact(buildValidArtifact());
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.artifact.id).toBe("test-capability");
    }
  });

  // 2. missing required fields fail
  it("rejects an artifact missing required top-level fields", () => {
    const artifact = structuredClone(buildValidArtifact()) as Record<string, unknown>;
    delete artifact.id;
    delete artifact.name;
    const result = validateArtifact(artifact);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.path === "id")).toBe(true);
      expect(result.errors.some((e) => e.path === "name")).toBe(true);
    }
  });

  // 3. unsupported version fails
  it("rejects an unsupported schemaVersion", () => {
    const artifact = { ...buildValidArtifact(), schemaVersion: "99.0" };
    const result = validateArtifact(artifact);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.path === "schemaVersion")).toBe(true);
    }
  });

  // 4. invalid action fails
  it("rejects a step with an unsupported action", () => {
    const artifact = structuredClone(buildValidArtifact());
    // @ts-expect-error deliberately invalid for the test
    artifact.steps[0].action = "hover";
    const result = validateArtifact(artifact);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.path === "steps[0].action")).toBe(true);
    }
  });

  // 5. invalid locator fails
  it("rejects a step whose locator has no strategies", () => {
    const artifact = structuredClone(buildValidArtifact());
    // @ts-expect-error deliberately invalid for the test
    artifact.steps[1].target = { strategies: [] };
    const result = validateArtifact(artifact);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.path === "steps[1].target.strategies")).toBe(true);
    }
  });

  it("rejects a locator strategy missing required fields for its type", () => {
    const artifact = structuredClone(buildValidArtifact());
    // @ts-expect-error deliberately invalid for the test — role strategy missing "name"
    artifact.steps[1].target = { strategies: [{ type: "role", role: "textbox" }] };
    const result = validateArtifact(artifact);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.path.endsWith(".name"))).toBe(true);
    }
  });

  // 6. invalid checkpoint fails
  it("rejects an empty checkpoint.all array", () => {
    const artifact = structuredClone(buildValidArtifact());
    artifact.checkpoint.all = [];
    const result = validateArtifact(artifact);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.path === "checkpoint.all")).toBe(true);
    }
  });

  it("rejects a checkpoint condition with an unsupported type", () => {
    const artifact = structuredClone(buildValidArtifact());
    // @ts-expect-error deliberately invalid for the test
    artifact.checkpoint.all = [{ type: "colorMatches", value: "blue" }];
    const result = validateArtifact(artifact);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.path === "checkpoint.all[0].type")).toBe(true);
    }
  });

  // 7. duplicate step IDs fail
  it("rejects duplicate step IDs", () => {
    const artifact = structuredClone(buildValidArtifact());
    artifact.steps[1].stepId = 1;
    const result = validateArtifact(artifact);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.message.includes("Duplicate stepId"))).toBe(true);
    }
  });

  // 8. valid parameter references pass
  it("accepts a well-formed {{param}} reference to a declared input", () => {
    const artifact = buildValidArtifact();
    expect((artifact.steps[1] as { value: string }).value).toBe("{{memberId}}");
    const result = validateArtifact(artifact);
    expect(result.valid).toBe(true);
  });

  // 9. reference to nonexistent input fails
  it("rejects a {{param}} reference to an input that isn't declared", () => {
    const artifact = structuredClone(buildValidArtifact());
    (artifact.steps[1] as { value: string }).value = "{{doesNotExist}}";
    const result = validateArtifact(artifact);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.message.includes('input "doesNotExist"'))).toBe(true);
    }
  });

  it("rejects a malformed parameter reference", () => {
    const artifact = structuredClone(buildValidArtifact());
    (artifact.steps[1] as { value: string }).value = "{{memberId";
    const result = validateArtifact(artifact);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.message.includes("malformed parameter reference"))).toBe(true);
    }
  });

  // 10. typed inputs validate
  it("rejects an input with an unsupported type", () => {
    const artifact = structuredClone(buildValidArtifact());
    // @ts-expect-error deliberately invalid for the test
    artifact.inputs[0].type = "date";
    const result = validateArtifact(artifact);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.path === "inputs[0].type")).toBe(true);
    }
  });

  it("rejects duplicate input names", () => {
    const artifact = structuredClone(buildValidArtifact());
    artifact.inputs.push({ name: "memberId", type: "string", required: false });
    const result = validateArtifact(artifact);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.message.includes("Duplicate input name"))).toBe(true);
    }
  });

  // 11. typed outputs validate
  it("rejects an output with an unsupported type", () => {
    const artifact = structuredClone(buildValidArtifact());
    // @ts-expect-error deliberately invalid for the test
    artifact.outputs[0].type = "date";
    const result = validateArtifact(artifact);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.path === "outputs[0].type")).toBe(true);
    }
  });

  it("rejects an output whose sourceStepId does not match any step", () => {
    const artifact = structuredClone(buildValidArtifact());
    artifact.outputs[0].sourceStepId = 999;
    const result = validateArtifact(artifact);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.message.includes("does not match any step"))).toBe(true);
    }
  });

  it("rejects an output whose sourceStepId points at a non-read step", () => {
    const artifact = structuredClone(buildValidArtifact());
    artifact.outputs[0].sourceStepId = 1; // step 1 is "navigate", not "read"
    const result = validateArtifact(artifact);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.message.includes('is not a "read" step'))).toBe(true);
    }
  });

  it("rejects an output whose name does not match its source step's outputRef", () => {
    const artifact = structuredClone(buildValidArtifact());
    artifact.outputs[0].name = "somethingElse";
    const result = validateArtifact(artifact);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.message.includes("does not match this output's name"))).toBe(true);
    }
  });

  // 20. artifact model does not contain a raw LLM transcript field
  it("rejects an artifact carrying an extra field such as a raw LLM transcript", () => {
    const artifact = { ...buildValidArtifact(), transcript: [{ role: "user", content: "look up member 1001" }] };
    const result = validateArtifact(artifact);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.path === "transcript")).toBe(true);
    }
  });

  it("rejects a non-object input outright", () => {
    const result = validateArtifact("not an artifact");
    expect(result.valid).toBe(false);
  });
});
