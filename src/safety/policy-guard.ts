/**
 * PolicyGuard (Phase 8) — the one place a run's target URL and risk level
 * are turned into a classification. Used identically by both
 * src/agent/index.ts (discovery) and src/replay/index.ts (replay) —
 * there is exactly one PolicyGuard implementation, not one per loop.
 */
import type { RiskLevel } from "../artifact/types";
import type { ActionClassification, PolicyConfig } from "./types";

export class PolicyGuard {
  private readonly allowedBaseUrls: string[];

  constructor(config: PolicyConfig) {
    this.allowedBaseUrls = config.allowedBaseUrls;
  }

  /** Is this specific URL within the allowlist? Checked on every navigate() call, not just once — see policy-surface.ts. */
  isUrlAllowed(url: string): boolean {
    return this.allowedBaseUrls.some((allowed) => url === allowed || url.startsWith(allowed));
  }

  /**
   * Classifies a whole run before it starts: "blocked" if its target
   * base URL isn't allowlisted at all (an approval prompt would be
   * pointless — the run can never proceed); otherwise "approval_required"
   * for a risky artifact/goal, or "safe" for anything else. This mirrors
   * ARCHITECTURE.md's "approve-once" design: risky work needs one
   * decision per run, not a re-prompt on every action.
   */
  classify(context: { baseUrl: string; riskLevel: RiskLevel }): ActionClassification {
    if (!this.isUrlAllowed(context.baseUrl)) {
      return "blocked";
    }
    return context.riskLevel === "risky" ? "approval_required" : "safe";
  }
}
