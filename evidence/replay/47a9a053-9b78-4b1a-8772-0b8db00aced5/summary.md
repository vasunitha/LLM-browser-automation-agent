# Replay run 47a9a053-9b78-4b1a-8772-0b8db00aced5

**This is a deterministic replay — no LLM was invoked to decide any action.** Every step below executed the artifact's own pre-recorded, ordered steps with runtime inputs substituted in; nothing was decided live. See ARCHITECTURE.md -> "Deterministic replay engine" for the guarantee and how it's tested.

- **Artifact:** `get-savings-balance` (version 1.0.0)
- **Inputs:** {"memberId":"1001"}
- **Status:** success
- **Started:** 2026-08-16T21:47:11.931Z
- **Duration:** 1317ms

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

- id: `get-savings-balance`, version: 1.0.0, riskLevel: safe
- See `artifact.json` in this directory for the exact artifact that was replayed.
