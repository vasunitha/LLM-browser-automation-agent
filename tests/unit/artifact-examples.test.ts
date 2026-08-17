import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fromJson } from "../../src/artifact";

const ARTIFACTS_DIR = join(__dirname, "../../artifacts");

function loadExample(id: string) {
  const json = readFileSync(join(ARTIFACTS_DIR, `${id}.json`), "utf8");
  return fromJson(json);
}

describe("committed example artifacts", () => {
  // 17. get-savings-balance example validates
  it("artifacts/get-savings-balance.json validates", () => {
    const result = loadExample("get-savings-balance");
    if (!result.valid) {
      throw new Error(`get-savings-balance.json failed validation: ${JSON.stringify(result.errors, null, 2)}`);
    }
    expect(result.valid).toBe(true);
    expect(result.artifact.id).toBe("get-savings-balance");
    expect(result.artifact.riskLevel).toBe("safe");
  });

  // 18. open-sub-account example validates
  it("artifacts/open-sub-account.json validates", () => {
    const result = loadExample("open-sub-account");
    if (!result.valid) {
      throw new Error(`open-sub-account.json failed validation: ${JSON.stringify(result.errors, null, 2)}`);
    }
    expect(result.valid).toBe(true);
    expect(result.artifact.id).toBe("open-sub-account");
    expect(result.artifact.riskLevel).toBe("risky");
  });

  // 19. memberId is parameterized rather than tied to 1001
  it("get-savings-balance.json parameterizes memberId rather than hardcoding a specific member", () => {
    const result = loadExample("get-savings-balance");
    if (!result.valid) throw new Error("fixture invalid");

    const hasMemberIdInput = result.artifact.inputs.some((i) => i.name === "memberId" && i.required);
    expect(hasMemberIdInput).toBe(true);

    const typeStep = result.artifact.steps.find(
      (s) => s.action === "type" && s.target.strategies.some((st) => st.type === "role" && st.name === "Member ID"),
    );
    expect(typeStep).toBeDefined();
    expect((typeStep as { value: string }).value).toBe("{{memberId}}");

    // No literal seeded member ID in any executable step — the input's
    // "example" field is documentation for a human reviewer (like an
    // OpenAPI example) and is expected to contain "1001"; that's not the
    // same as the capability being operationally tied to that member.
    const stepsJson = JSON.stringify(result.artifact.steps);
    expect(stepsJson).not.toContain("1001");
    expect(result.artifact.inputs.find((i) => i.name === "memberId")?.example).toBe("1001");
  });

  it("open-sub-account.json parameterizes memberId, accountType, nickname, and initialDeposit", () => {
    const result = loadExample("open-sub-account");
    if (!result.valid) throw new Error("fixture invalid");

    const inputNames = result.artifact.inputs.map((i) => i.name).sort();
    expect(inputNames).toEqual(["accountType", "initialDeposit", "memberId", "nickname"].sort());

    const typeSteps = result.artifact.steps.filter((s) => s.action === "type") as Array<{ value: string }>;
    const values = typeSteps.map((s) => s.value).sort();
    expect(values).toEqual(["{{accountType}}", "{{initialDeposit}}", "{{memberId}}", "{{nickname}}"].sort());
  });
});
