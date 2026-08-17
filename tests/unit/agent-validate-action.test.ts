import { describe, it, expect } from "vitest";
import { validateAgentAction } from "../../src/agent/validate-action";

describe("validateAgentAction", () => {
  // 1. valid LLM action parsing
  it("accepts a valid click action", () => {
    const result = validateAgentAction({
      action: "click",
      target: { strategies: [{ type: "role", role: "button", name: "Search" }] },
    });
    expect(result.valid).toBe(true);
  });

  it("accepts a valid type action with inputRef", () => {
    const result = validateAgentAction({
      action: "type",
      target: { strategies: [{ type: "role", role: "textbox", name: "Member ID" }] },
      value: "1001",
      inputRef: "memberId",
    });
    expect(result.valid).toBe(true);
  });

  it("accepts a valid read action with outputRef", () => {
    const result = validateAgentAction({
      action: "read",
      target: { strategies: [{ type: "css", selector: "strong" }] },
      outputRef: "savingsBalance",
    });
    expect(result.valid).toBe(true);
  });

  it("accepts a valid navigate action", () => {
    const result = validateAgentAction({ action: "navigate", url: "/" });
    expect(result.valid).toBe(true);
  });

  it("accepts a valid finish action", () => {
    const result = validateAgentAction({
      action: "finish",
      outputRefs: ["savingsBalance"],
      checkpointText: "Member details loaded successfully.",
    });
    expect(result.valid).toBe(true);
  });

  it("accepts a valid fail action", () => {
    const result = validateAgentAction({ action: "fail", reason: "The member search field never appeared." });
    expect(result.valid).toBe(true);
  });

  // 2. invalid LLM action rejection
  it("rejects an unsupported action type", () => {
    const result = validateAgentAction({ action: "scroll", target: {} });
    expect(result.valid).toBe(false);
  });

  it("rejects a type action missing inputRef", () => {
    const result = validateAgentAction({
      action: "type",
      target: { strategies: [{ type: "role", role: "textbox", name: "Member ID" }] },
      value: "1001",
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.path === "inputRef")).toBe(true);
    }
  });

  it("rejects a click action with an empty strategies array", () => {
    const result = validateAgentAction({ action: "click", target: { strategies: [] } });
    expect(result.valid).toBe(false);
  });

  it("rejects a locator strategy missing its required field (role without name)", () => {
    const result = validateAgentAction({
      action: "click",
      target: { strategies: [{ type: "role", role: "button" }] },
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.path.includes("name"))).toBe(true);
    }
  });

  it("rejects a finish action with an empty outputRefs array", () => {
    const result = validateAgentAction({ action: "finish", outputRefs: [], checkpointText: "done" });
    expect(result.valid).toBe(false);
  });

  it("rejects a finish action missing checkpointText", () => {
    const result = validateAgentAction({ action: "finish", outputRefs: ["savingsBalance"] });
    expect(result.valid).toBe(false);
  });

  it("rejects a fail action with an empty reason", () => {
    const result = validateAgentAction({ action: "fail", reason: "" });
    expect(result.valid).toBe(false);
  });

  // 7. malformed model response handling
  it("rejects a non-object response", () => {
    const result = validateAgentAction("click the search button");
    expect(result.valid).toBe(false);
  });

  it("rejects null", () => {
    const result = validateAgentAction(null);
    expect(result.valid).toBe(false);
  });

  it("rejects a response with no action field at all", () => {
    const result = validateAgentAction({ foo: "bar" });
    expect(result.valid).toBe(false);
  });
});
