/**
 * Human handoff — approval and intervention recording (Phase 8 — implemented).
 *
 * `HandoffController` is the one place a risky run's approve/deny
 * decision is requested and recorded, used identically by
 * src/agent/index.ts and src/replay/index.ts. See types.ts for why this
 * is deliberately scoped to explicit approval rather than a full live
 * co-browsing handoff.
 */
import type { ApprovalDecider, ApprovalDecision, ApprovalRequest, InterventionRecord } from "./types";

export class HandoffController {
  private readonly decider: ApprovalDecider;
  private readonly interventions: InterventionRecord[] = [];

  constructor(decider: ApprovalDecider) {
    this.decider = decider;
  }

  async requestApproval(request: ApprovalRequest): Promise<ApprovalDecision> {
    return this.decider(request);
  }

  /** Records that a run reached a state a human would need to look at in a real deployment — evidence/audit only, does not block or resume anything (see types.ts). */
  recordIntervention(runId: string, reason: string): InterventionRecord {
    const record: InterventionRecord = { runId, reason, timestamp: new Date().toISOString() };
    this.interventions.push(record);
    return record;
  }

  getInterventions(): InterventionRecord[] {
    return [...this.interventions];
  }
}

export type { ApprovalDecider, ApprovalDecision, ApprovalRequest, InterventionRecord } from "./types";
export { createCliApprovalDecider } from "./cli-decider";
