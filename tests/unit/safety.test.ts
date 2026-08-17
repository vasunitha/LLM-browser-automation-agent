import { describe, it, expect } from "vitest";
import { PolicyGuard } from "../../src/safety/policy-guard";
import { classifySurfaceError } from "../../src/safety/classify-failure";
import { createPolicyEnforcedSurface } from "../../src/safety/policy-surface";
import { createFakeSurface } from "./fixtures/fake-surface";

const ALLOWED_BASE_URL = "http://localhost:3000";

describe("PolicyGuard.classify", () => {
  const guard = new PolicyGuard({ allowedBaseUrls: [ALLOWED_BASE_URL] });

  it("classifies a safe artifact/goal targeting an allowlisted URL as safe", () => {
    expect(guard.classify({ baseUrl: ALLOWED_BASE_URL, riskLevel: "safe" })).toBe("safe");
  });

  it("classifies a risky artifact/goal targeting an allowlisted URL as approval_required", () => {
    expect(guard.classify({ baseUrl: ALLOWED_BASE_URL, riskLevel: "risky" })).toBe("approval_required");
  });

  it("classifies anything targeting a non-allowlisted URL as blocked, regardless of risk level", () => {
    expect(guard.classify({ baseUrl: "http://evil.example.com", riskLevel: "safe" })).toBe("blocked");
    expect(guard.classify({ baseUrl: "http://evil.example.com", riskLevel: "risky" })).toBe("blocked");
  });

  it("isUrlAllowed() matches exact and prefixed URLs", () => {
    expect(guard.isUrlAllowed(ALLOWED_BASE_URL)).toBe(true);
    expect(guard.isUrlAllowed(`${ALLOWED_BASE_URL}/members/1001`)).toBe(true);
    expect(guard.isUrlAllowed("http://other-host:3000")).toBe(false);
  });
});

describe("classifySurfaceError", () => {
  it("classifies ordinary Surface errors as recoverable", () => {
    expect(classifySurfaceError("ELEMENT_NOT_FOUND")).toBe("recoverable");
    expect(classifySurfaceError("TIMEOUT")).toBe("recoverable");
    expect(classifySurfaceError("NAVIGATION_FAILED")).toBe("recoverable");
    expect(classifySurfaceError("UNKNOWN")).toBe("recoverable");
  });

  it("classifies SESSION_CLOSED and POLICY_BLOCKED as hard failures", () => {
    expect(classifySurfaceError("SESSION_CLOSED")).toBe("hard_failure");
    expect(classifySurfaceError("POLICY_BLOCKED")).toBe("hard_failure");
  });

  it("classifies any other/unknown code as a hard failure (fail safe, not fail open)", () => {
    expect(classifySurfaceError("UNKNOWN_ACTION")).toBe("hard_failure");
    expect(classifySurfaceError("SOMETHING_NEW")).toBe("hard_failure");
  });
});

describe("createPolicyEnforcedSurface", () => {
  const guard = new PolicyGuard({ allowedBaseUrls: [ALLOWED_BASE_URL] });

  it("blocks navigate() to a URL outside the allowlist, on every call, regardless of approval", async () => {
    const enforced = createPolicyEnforcedSurface(createFakeSurface(), guard, { riskLevel: "safe", approved: true });
    const result = await enforced.navigate("http://evil.example.com/");
    expect(result).toMatchObject({ ok: false, error: { code: "POLICY_BLOCKED" } });
  });

  it("allows navigate() to an allowlisted URL through", async () => {
    const enforced = createPolicyEnforcedSurface(createFakeSurface(), guard, { riskLevel: "safe", approved: true });
    const result = await enforced.navigate(`${ALLOWED_BASE_URL}/`);
    expect(result.ok).toBe(true);
  });

  it("blocks click()/type() when the run was not approved", async () => {
    const enforced = createPolicyEnforcedSurface(createFakeSurface(), guard, { riskLevel: "risky", approved: false });
    const clickResult = await enforced.click({ strategies: [{ type: "role", role: "button", name: "Search" }] });
    const typeResult = await enforced.type({ strategies: [{ type: "role", role: "textbox", name: "Member ID" }] }, "1001");
    expect(clickResult).toMatchObject({ ok: false, error: { code: "POLICY_BLOCKED" } });
    expect(typeResult).toMatchObject({ ok: false, error: { code: "POLICY_BLOCKED" } });
  });

  it("allows click()/type() through once approved", async () => {
    const enforced = createPolicyEnforcedSurface(createFakeSurface(), guard, { riskLevel: "risky", approved: true });
    const typeResult = await enforced.type({ strategies: [{ type: "role", role: "textbox", name: "Member ID" }] }, "1001");
    expect(typeResult.ok).toBe(true);
  });

  it("never gates read()/observe()/screenshot()/close() — none of them mutate the target", async () => {
    const enforced = createPolicyEnforcedSurface(createFakeSurface(), guard, { riskLevel: "risky", approved: false });
    const observeResult = await enforced.observe();
    const screenshotResult = await enforced.screenshot();
    expect(observeResult.ok).toBe(true);
    expect(screenshotResult.ok).toBe(true);
    await expect(enforced.close()).resolves.toBeUndefined();
  });
});
