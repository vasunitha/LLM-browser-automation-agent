/**
 * Evidence / logging module boundary (Phase 8).
 *
 * Will write structured JSONL step logs, screenshots, and Playwright traces
 * under EVIDENCE_DIR for every discovery and replay run. Not implemented
 * yet — nothing is currently written to disk.
 */

export interface EvidenceEvent {
  ts: string;
  actor: "agent" | "human";
  stepIndex: number;
  action: string;
  result: "ok" | "error";
}

export class EvidenceLogger {
  // runId is accepted now so the constructor shape is settled; it isn't
  // stored as a field yet because nothing reads it until Phase 8.
  constructor(_runId: string) {}

  log(_event: EvidenceEvent): void {
    throw new Error("Evidence logger not implemented yet — planned for Phase 8 (Safety/Handoff/Evidence).");
  }
}
