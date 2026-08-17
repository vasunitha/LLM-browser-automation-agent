# Computer-Use Automation System

A system that lets an LLM discover how to accomplish a goal against a UI-only
application (no API), records the successful run as a versioned, typed
**artifact** (an agent-invocable capability), and then replays that artifact
**deterministically** — with no LLM in the loop — reporting success, an
expected business outcome, or a structured failure. When the system can't
safely proceed on its own, it escalates to a human who takes control of the
same live browser session and hands control back.

This project is built for the interface.ai take-home assignment
("Computer-Use Automation System"). Full design rationale lives in
[PROJECT_PLAN.md](./PROJECT_PLAN.md) and [ARCHITECTURE.md](./ARCHITECTURE.md).

## Status: Phase 7 — Deterministic Replay complete

The **Credit Union Teller Console** (Phase 3), the **Surface**
computer-use abstraction backed by Playwright (Phase 4), the
**structured artifact system** (Phase 5), the **LLM discovery agent**
(Phase 6), and the **deterministic replay engine** — executes a saved
artifact against new inputs with zero LLM involvement, verified against a
real replay run (Phase 7) — are all implemented and fully testable,
including a real Anthropic API discovery run and a real, LLM-free replay
run, both against the live app. Safety enforcement and human handoff are
still placeholders.

| Capability | Status |
|---|---|
| Express server boots, serves a health check | ✅ Working |
| Target banking application — `get-savings-balance`, `open-sub-account` | ✅ Working (Phase 3) |
| Computer-use / Playwright browser layer (`Surface`) | ✅ Working (Phase 4) |
| Artifact schema validation + store | ✅ Working (Phase 5) |
| LLM-driven discovery agent (Claude, forced tool-calling) | ✅ Working (Phase 6) |
| Discovery evidence (trace/artifact/screenshots per run) | ✅ Working (Phase 6) |
| Deterministic replay engine (zero LLM calls, proven) | ✅ Working (Phase 7) |
| Replay evidence (result/artifact/screenshots per run) | ✅ Working (Phase 7) |
| Safety allowlist / risky-action policy | ❌ Not built (Phase 8) |
| Human-in-the-loop handoff | ❌ Not built (Phase 8) |
| Evidence/JSONL logging (cross-cutting, safety/handoff) | ❌ Not built (Phase 8) |

See [PROJECT_PLAN.md](./PROJECT_PLAN.md) for the full 10-phase plan and
current status, and [ARCHITECTURE.md](./ARCHITECTURE.md) for how these
pieces are designed to fit together once built.

## Tech stack

TypeScript / Node.js, Express, EJS, SQLite (`better-sqlite3`), Playwright
(browser automation) + Playwright Test (e2e), Anthropic Claude API
(`@anthropic-ai/sdk`, real LLM discovery agent — never used by replay),
JSON artifacts on disk, Vitest (unit tests). No Docker, no Postgres/Redis,
no Kubernetes — see
ARCHITECTURE.md for why.

## Target application: Credit Union Teller Console

A small local banking-style web app (Express + EJS + SQLite) that the
computer-use agent will later operate. It supports exactly two
capabilities:

- **`get-savings-balance`** (safe / read-only) — search for a member by
  ID, view their details, read their savings balance.
- **`open-sub-account`** (risky / mutating) — search for a member, fill
  out a multi-field sub-account form, validate it, and reach a
  confirmation screen. No real financial transaction occurs.

Both flows include real business-outcome and validation states, not just
a happy path:

| Scenario | How it's triggered |
|---|---|
| Member not found | Search for member ID `9999` (deliberately not seeded) |
| Invalid sub-account form | Nickname under 2 characters, or a deposit below $25.00 |
| Permission-blocked action | Open a sub-account for member `1003` (seeded as `restricted`) |
| Unexpected confirmation interstitial | Submit a sub-account deposit of $10,000.00 or more |

The UI is styled with a custom CSS design system (tokens for color,
spacing, radius, and shadow — no framework, no external font/CDN
requests) so it reads as a polished internal fintech tool rather than
default browser HTML. Underneath the styling, every screen stays plain
semantic markup — real `<button>`/`<input>`/`<select>`/`<a href>`
elements, labeled form fields (`<label for>`), meaningful headings,
visible focus states — and deliberately **no `data-testid` attributes**,
so the UI stays realistic for the computer-use work in later phases and
the Phase 4 `Surface` keeps resolving every control by role, label, and
text exactly as before.

### Database schema

Two tables in SQLite (`src/app/db/schema.ts`):

- **`members`**: `id`, `first_name`, `last_name`, `status`
  (`active` | `restricted`), `created_at`
- **`accounts`**: `id`, `member_id`, `account_type`
  (`savings` | `checking` | `sub_savings` | `sub_checking`), `nickname`,
  `balance_cents`, `status` (`active` | `pending` | `closed`),
  `created_at`

Money is stored as integer cents to avoid floating-point issues.

## Computer-use layer

`src/surface` is a small, Playwright-free `Surface` interface —
`navigate`, `observe`, `click`, `type`, `read`, `screenshot`, `close` —
plus `createPlaywrightSurface()`, a Chromium-backed implementation. It
launches one browser/page and reuses that same live session across every
call. Elements are targeted through a `Locator`: an ordered fallback
chain (accessible role/name → label → text → attribute → CSS), never
coordinates and never `data-testid`. Every action returns a structured
`{ok, value}` / `{ok: false, error}` result — nothing is thrown for an
ordinary failure. See ARCHITECTURE.md → "Computer-use Surface
abstraction" for the full design.

Try it directly against a running instance:

```bash
npm run dev                                  # terminal 1 — starts the app
npx tsx scripts/manual-verify-phase4.ts       # terminal 2 — drives it via the Surface
```

This script navigates to the app, searches for member `1001`, reaches
the member details page, and reads the savings balance — purely through
the Surface abstraction, printing each step's structured result.

## Structured artifacts

`src/artifact` is the typed, versioned, serializable capability
contract — `validateArtifact()`, `toJson()`/`fromJson()`, and
`ArtifactStore` (save/load/list/exists, one JSON file per capability
under `artifacts/`). Locators reuse the exact same vocabulary the
Surface resolves against (imported directly from `surface/types`, not
redefined). See ARCHITECTURE.md → "Structured artifact contract" for the
full schema and design rationale.

Two committed artifacts, one of each kind this system now produces:

- **`artifacts/get-savings-balance.json`** — **real Phase 6 LLM
  discovery output**, not hand-written: generated by
  `compileArtifactFromTrace()` from a genuine Claude-driven run (see
  "LLM discovery agent" below). Safe, 1 typed input (`memberId`), 1
  typed output (`savingsBalance`). It superseded the original Phase 5
  hand-authored version of the same file the moment discovery actually
  ran for that capability — this is the intended architecture, not
  incidental: the artifact *is* what discovery produces.
- **`artifacts/open-sub-account.json`** — still the Phase 5 hand-authored
  reference artifact (risky, 4 typed inputs, no outputs, 4 declared
  business outcomes) — a real discovery run for this capability hasn't
  been executed yet.

Both are fully parameterized — `memberId` is a runtime input in every
step, never hardcoded to a specific seeded member (`1001` appears only
as an illustrative `example` value, never inside an executable step).
Inspect or validate them directly:

```bash
node -e "const {fromJson}=require('./dist/artifact'); console.log(fromJson(require('fs').readFileSync('artifacts/get-savings-balance.json','utf8')).valid)"
```

## LLM discovery agent

`src/agent` is a genuine `observe -> decide -> validate -> act` loop: on
every iteration, a compact snapshot of the live page is sent to Claude
via forced tool-calling (six structured tools —
`navigate`/`click`/`type`/`read`/`finish`/`fail`, `tool_choice: {type:
"any"}` so the model can't reply with free-form text), the chosen action
is validated, then executed against the real `Surface`. There is no
hardcoded action sequence anywhere in the loop — see ARCHITECTURE.md →
"LLM discovery agent" for the full design, including how `finish()` is
verified against the live page rather than trusted on the model's word.

A successful run is compiled into a Phase 5 artifact deterministically
(no second LLM pass — the model's own declared `inputRef`/`outputRef`
tool arguments are read back mechanically) and saved to `artifacts/`;
evidence (a structured trace, the compiled artifact, a human-readable
step-by-step summary, and per-step screenshots) is written to
`evidence/discovery/<run-id>/`.

Run a real discovery yourself:

```bash
npm run dev                                          # terminal 1 — starts the app
npx tsx scripts/discover-get-savings-balance.ts       # terminal 2 — real Claude-driven discovery
```

Requires `ANTHROPIC_API_KEY` set in `.env` (see `.env.example`) — this
makes a real, billed Anthropic API call and opens a real Chromium
session; nothing about it is mocked or scripted. A real run of this
script for the goal `"Look up member 1001 and read their current savings
balance."` (model `claude-sonnet-5`) chose `type -> click -> read ->
finish` — 4 decision steps, none hardcoded — reached the member details
page, read a savings balance of `$482.17`, and produced
`artifacts/get-savings-balance.json` and
`evidence/discovery/b6ff853d-cc18-4ba5-ac4a-fe622d81c585/`.

## Deterministic replay engine

`src/replay` executes a saved artifact against a live `Surface` with
**zero LLM calls** — `validate -> resolve runtime inputs -> replay
ordered steps -> checkpoint validation -> SUCCESS/FAILURE`. This is
proven, not just claimed: `tests/unit/replay-no-llm.test.ts` statically
scans every file under `src/replay` for any reference to an LLM SDK, the
discovery agent module, or an Anthropic env var, and separately runs a
full successful replay with `ANTHROPIC_API_KEY` deleted from the
environment entirely. See ARCHITECTURE.md → "Deterministic replay engine"
for the full design, including the eleven structured failure statuses
(`missing_input`, `target_not_found`, `checkpoint_mismatch`, `timeout`,
...) and why the checkpoint is re-verified against a fresh page
observation rather than inferred from the last step's own success.

Run a real replay yourself:

```bash
npm run dev                                        # terminal 1 — starts the app
npx tsx scripts/replay-get-savings-balance.ts       # terminal 2 — deterministic replay, no LLM
```

Optional env overrides: `TARGET_URL`, `MEMBER_ID`. No Anthropic API key
needed — this path never reads one. A real run of this script against
the live `artifacts/get-savings-balance.json` with `memberId = "1001"`
executed `navigate -> type -> click -> read`, satisfied both checkpoint
conditions, read a savings balance of `$482.17`, and produced
`evidence/replay/47a9a053-9b78-4b1a-8772-0b8db00aced5/` in 1317ms.

## Setup

```bash
npm install
npx playwright install chromium   # one-time browser download for Playwright Test
cp .env.example .env
npm run db:seed                    # populates SQLite with deterministic demo data
```

## Running it

```bash
npm run dev     # starts the server with hot reload (tsx watch)
npm run build   # compiles src/ -> dist/ with tsc, then copies EJS views into dist/
npm start       # runs the compiled build (dist/index.js)
npm run db:seed # (re)seeds the local database — safe to re-run any time
```

Once running (`npm run dev` or `npm start`), visit `http://localhost:3000/`.

### Manual demo path

(`get-savings-balance` can now also be driven by the real LLM agent
instead of by hand — see "LLM discovery agent" above. `open-sub-account`
is still manual-only; a real discovery run for it hasn't been executed.)

1. `npm run db:seed`, then `npm run dev`
2. Open `http://localhost:3000/`
3. **get-savings-balance**: enter Member ID `1001` → Search → see "Member
   details loaded successfully." and a Savings Balance of `$482.17`
4. Try Member ID `9999` → see the "Member Not Found" business-outcome page
5. **open-sub-account**: search `1002` → "Open Sub-Account" → fill in an
   account type, a nickname, and a deposit ≥ $25 → Search → reach "Sub-Account
   Opened"
6. Try a deposit under $25, or a 1-character nickname, to see validation
   errors on the same form
7. Try a deposit of $10,000+ to see the large-deposit confirmation
   interstitial
8. Try opening a sub-account for member `1003` to see the
   permission-blocked page

## Testing

```bash
npm test         # Vitest — unit + integration tests (tests/unit)
npm run test:e2e # Playwright Test — real-browser workflow tests (tests/e2e)
```

- **`tests/unit/db.test.ts`** — seed correctness: expected member/account
  rows exist, the not-found ID is absent, the restricted member is
  present, reseeding is idempotent.
- **`tests/unit/validation.test.ts`** — sub-account form validation rules
  (valid input, invalid account type, short nickname, deposit below
  minimum, non-numeric deposit, threshold edges).
- **`tests/unit/app.test.ts`** — the whole app driven over real HTTP
  (`fetch` against a `:memory:`-backed server): search happy path, member
  details + balance rendered, member-not-found business outcome,
  sub-account form reachable, valid submission reaches confirmation,
  invalid submission shows errors, restricted member is blocked,
  large-deposit interstitial appears and can be confirmed.
- **`tests/unit/surface.test.ts`** — the `Surface` abstraction driven
  through a real headless Chromium instance against the app: session
  start, navigate, observe (bounded structured state), click, type, read,
  screenshot (valid PNG), a structured failure for an unresolvable
  locator, a structured failure for an unreachable navigation target,
  session reuse across many sequential actions including after a prior
  failure, a structured failure after `close()`, and three tests that
  statically confirm only `playwright-surface.ts` imports the
  `playwright` package.
- **`tests/unit/artifact-validate.test.ts`** (20 tests) — every
  validation rule: missing fields, unsupported schema version, invalid
  action/locator/checkpoint, duplicate step IDs, dangling/malformed
  `{{param}}` references, typed input/output errors, and the strict
  top-level-key allowlist that makes an extra field (e.g. a transcript)
  fail validation outright.
- **`tests/unit/artifact-serialize.test.ts`** — JSON round-trip fidelity,
  readable formatting, malformed-JSON handling.
- **`tests/unit/artifact-store.test.ts`** — save/load/list/exists against
  an isolated temp directory, plus missing-artifact and invalid-artifact
  behavior.
- **`tests/unit/artifact-examples.test.ts`** — both committed artifacts
  validate, and `get-savings-balance.json` is confirmed genuinely
  parameterized (no seeded member ID inside any executable step).
- **`tests/unit/agent-validate-action.test.ts`** (16 tests) — every
  structured LLM action shape validates or is rejected correctly:
  malformed/non-object responses, an unsupported action name, missing
  required fields (including `inputRef`/`outputRef`), and invalid/empty
  locator strategies.
- **`tests/unit/agent-loop.test.ts`** (12 tests) — the bounded discovery
  loop against fake `Surface`/`LlmClient` implementations (no live
  Anthropic call): a full observe→decide→validate→act→finish cycle,
  `fail()` handling, max-steps stopping, deterministic timeout stopping
  (via an injectable clock), a `SESSION_CLOSED` Surface error stopping
  immediately vs. a recoverable one (`ELEMENT_NOT_FOUND`) letting the
  loop continue, malformed-response and provider-error handling, and
  `finish()` checkpoint/output verification (including the real
  whitespace/escaped-newline formatting quirk found by the live smoke
  test — see ARCHITECTURE.md).
- **`tests/unit/agent-compile-artifact.test.ts`** (5 tests) — a
  successful trace compiles to a valid, genuinely parameterized artifact
  (no literal input value leaks into a step); a non-successful trace is
  refused.
- **`tests/unit/agent-evidence.test.ts`** (4 tests) — the
  `evidence/discovery/<run-id>/` directory structure, and that an
  API-key-shaped string anywhere in a trace is redacted before being
  written.
- **`tests/unit/agent-run-discovery.test.ts`** (4 tests) — the full
  `runDiscovery()` orchestration (loop → compile → store → evidence) with
  fake dependencies: a successful run saves an artifact and writes
  evidence; a failed or max-steps-exceeded run writes evidence but saves
  no artifact; a caller-supplied `Surface` is never closed by
  `runDiscovery()` itself.
- **`tests/unit/replay-engine.test.ts`** (17 tests) — `replayArtifact()`
  against a fixture artifact and fake `Surface`: a valid artifact replays
  to success with `{{memberId}}` genuinely substituted before it ever
  reaches `Surface`; missing/invalid inputs, an invalid artifact (before
  any Surface call), an unsupported step action, target/navigation
  failures, a checkpoint mismatch even when every step returned `ok`,
  structured outputs, timeout, and that a failed required step stops
  replay immediately rather than continuing.
- **`tests/unit/replay-evidence.test.ts`** (5 tests) — the
  `evidence/replay/<run-id>/` directory structure (result/artifact/
  summary/screenshots), that a failed replay still writes evidence
  without an artifact snapshot when the artifact itself was invalid, and
  the full `runReplay()` orchestration (file read → replay → evidence).
- **`tests/unit/replay-no-llm.test.ts`** (3 tests) — the explicit
  determinism proof: a static scan of every file under `src/replay` for
  any reference to an LLM SDK/the discovery agent module/an Anthropic env
  var, plus a full successful replay run with `ANTHROPIC_API_KEY` deleted
  from the environment.
- **`tests/e2e/get-savings-balance.spec.ts`** and
  **`tests/e2e/open-sub-account.spec.ts`** — the same two workflows driven
  through a real Chromium browser via Playwright Test, against a
  dedicated, deterministically reseeded server instance
  (`scripts/e2e-server.ts`, port 3902, its own SQLite file so it never
  touches your local dev database).

## Project layout

See "Final folder structure" in the Phase 3/4/5/6/7 implementation
reports, or browse `src/` directly. `src/app` holds the target
application (routes, views, db schema/seed/repository, validation);
`src/surface` holds the computer-use `Surface` interface and its
Playwright-backed implementation; `src/artifact` holds the artifact
schema, validation, serialization, and filesystem store, with the two
committed reference artifacts under `artifacts/`; `src/agent` holds the
LLM discovery loop, the Anthropic tool-calling client, deterministic
artifact compilation, and the discovery evidence writer, with committed
evidence under `evidence/discovery/`; `src/replay` holds the
deterministic replay engine — parameter substitution, checkpoint
evaluation, step execution, and the replay evidence writer, with
committed evidence under `evidence/replay/` — which imports only
`src/surface` and `src/artifact`, never `src/agent` or any LLM SDK.
`src/safety`, `src/handoff`, and `src/evidence` remain Phase 2
placeholders — each throws `Error("not implemented yet")` with a
docblock stating which phase implements it.

## What's explicitly out of scope right now

Per the assignment's own guidance not to reward premature infrastructure:
no Docker, no Docker Compose, no Postgres, no Redis, no Kubernetes, no
microservices. See PROJECT_PLAN.md → "Explicit out-of-scope / cut items"
for the full list and reasoning.
