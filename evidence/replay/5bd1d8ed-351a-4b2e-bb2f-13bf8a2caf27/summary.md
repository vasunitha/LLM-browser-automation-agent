# Replay run 5bd1d8ed-351a-4b2e-bb2f-13bf8a2caf27

**This is a deterministic replay — no LLM was invoked to decide any action.** Every step below executed the artifact's own pre-recorded, ordered steps with runtime inputs substituted in; nothing was decided live. See ARCHITECTURE.md -> "Deterministic replay engine" for the guarantee and how it's tested.

- **Artifact:** `get-savings-balance` (version 1.0.0)
- **Inputs:** {"memberId":"1001"}
- **Status:** success
- **Started:** 2026-08-17T14:12:09.815Z
- **Duration:** 9302ms

## Safety / approval decision (Phase 8)

- **Risk level:** risky
- **Classification:** approval_required
- **Approval decision:** approved

## Step outcomes

1. **navigate** -> ok — "http://localhost:3000/"
2. **type** -> ok
3. **click** -> ok
4. **read** -> ok — "$482.17"

## Checkpoint

- `urlMatches`: satisfied
- `textPresent`: satisfied

## Outputs

```json
{
  "savingsBalance": "$482.17"
}
```

## Replayed artifact

- id: `get-savings-balance`, version: 1.0.0, riskLevel: risky
- See `artifact.json` in this directory for the exact artifact that was replayed.
