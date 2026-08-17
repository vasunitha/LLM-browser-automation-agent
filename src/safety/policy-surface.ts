/**
 * A Surface decorator that enforces policy on every mutating call
 * (Phase 8) — "PolicyGuard in front of every Surface method call," made
 * concrete without touching Surface itself or either loop's control
 * flow: both src/agent/index.ts and src/replay/index.ts wrap the real
 * Surface with this before handing it to the loop/engine, so a blocked
 * action shows up as an ordinary POLICY_BLOCKED step failure — already
 * visible in evidence through the exact same step-recording path every
 * other Surface error goes through, no separate logging needed.
 *
 * - navigate(): checked on *every* call against the allowlist (a run's
 *   target can only be known step by step; a URL that drifts outside
 *   the allowlist mid-run is refused just as if it were the first one).
 * - click()/type() (the only mutating, non-navigation actions): refused
 *   unless `context.approved` — resolved once per run before this
 *   Surface is ever constructed (see PolicyGuard.classify() +
 *   HandoffController.requestApproval()), matching the "approve-once"
 *   design rather than re-prompting per action.
 * - read()/observe()/screenshot()/close(): always pass through — none of
 *   them mutate the target application.
 */
import type { RiskLevel } from "../artifact/types";
import type { Surface, SurfaceResult } from "../surface/types";
import type { PolicyGuard } from "./policy-guard";

export interface PolicyEnforcementContext {
  riskLevel: RiskLevel;
  /** Whether this run is cleared to perform mutating actions — true for a "safe" run, or a "risky" run that was explicitly approved. */
  approved: boolean;
}

function blockedResult<T>(message: string): SurfaceResult<T> {
  return { ok: false, error: { code: "POLICY_BLOCKED", message } };
}

export function createPolicyEnforcedSurface(
  surface: Surface,
  guard: PolicyGuard,
  context: PolicyEnforcementContext,
): Surface {
  return {
    async navigate(url) {
      if (!guard.isUrlAllowed(url)) {
        return blockedResult(`Navigation to "${url}" is outside the allowlist.`);
      }
      return surface.navigate(url);
    },
    async click(locator) {
      if (!context.approved) {
        return blockedResult("Mutating action refused: this risky run was not approved.");
      }
      return surface.click(locator);
    },
    async type(locator, text) {
      if (!context.approved) {
        return blockedResult("Mutating action refused: this risky run was not approved.");
      }
      return surface.type(locator, text);
    },
    async read(locator) {
      return surface.read(locator);
    },
    async observe() {
      return surface.observe();
    },
    async screenshot() {
      return surface.screenshot();
    },
    async close() {
      return surface.close();
    },
  };
}
