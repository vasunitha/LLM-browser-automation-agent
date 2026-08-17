# Replay run 30e16d60-6028-406d-a58e-9e343874548f

**This is a deterministic replay — no LLM was invoked to decide any action.** Every step below executed the artifact's own pre-recorded, ordered steps with runtime inputs substituted in; nothing was decided live. See ARCHITECTURE.md -> "Deterministic replay engine" for the guarantee and how it's tested.

- **Artifact:** `open-sub-account` (version 1.0.0)
- **Inputs:** {"memberId":"1002","accountType":"sub_savings","nickname":"Vacation Fund","initialDeposit":"150.00"}
- **Status:** blocked
- **Started:** 2026-08-17T14:05:03.102Z
- **Duration:** 28984ms

## Safety / approval decision (Phase 8)

- **Risk level:** risky
- **Classification:** approval_required
- **Approval decision:** denied

## Step outcomes

(no steps executed — the run was blocked, or stopped before/during input resolution)

## Error

[POLICY_DENIED] Approval was denied for risky artifact "open-sub-account".

## Replayed artifact

- id: `open-sub-account`, version: 1.0.0, riskLevel: risky
- See `artifact.json` in this directory for the exact artifact that was replayed.
