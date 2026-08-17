import type { ApprovalDecider, ApprovalRequest } from "../../../src/handoff/types";

/** Always returns the same decision, and records every request it was asked to decide — for asserting whether/how often approval was actually requested. */
export function createFixedApprovalDecider(decision: "approved" | "denied"): ApprovalDecider & { requests: ApprovalRequest[] } {
  const requests: ApprovalRequest[] = [];
  const decider = ((request: ApprovalRequest) => {
    requests.push(request);
    return decision;
  }) as ApprovalDecider & { requests: ApprovalRequest[] };
  decider.requests = requests;
  return decider;
}
