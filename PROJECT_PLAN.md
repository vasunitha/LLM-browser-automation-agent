# Project Plan

## Objective

Build a small but real version of interface.ai's computer-use automation
system: an LLM discovers how to accomplish a natural-language goal against
a live, UI-only application; the successful run is recorded as a
structured, versioned, agent-invocable **artifact**; that artifact then
replays **deterministically** (no LLM in the decision loop) against new
input parameters, reporting a clear success/business-outcome/failure
result; and when either the discovery agent or the replay engine can't
safely proceed, the system escalates to a human who takes control of the
*same* live session and hands control back.

The through-line, unchanged from the assignment brief: **the model
discovers, the artifact becomes a reusable capability, deterministic
replay is how it gets invoked in production.**

## Scope

**In scope (core requirements, all required by the assignment):**

1. Goal-driven agent loop against a real, live UI (observe → decide → act)
2. A typed, versioned, serializable artifact schema — the focal point of
   the system design
3. Deterministic replay: typed inputs, typed outputs, checkpoint
   verification, and an explicit success / business-outcome / failure
   result contract
4. Safety guardrails: an explicit allowlist, a safe-vs-risky action
   distinction, and redaction of sensitive data from artifacts and logs
5. Evidence: a structured log of what happened and why, plus a richer
   signal (screenshot/trace) on failure
6. Human-in-the-loop escalation: detect "stuck," raise an intervention
   request with context, let a human take control of the live session,
   record what they did, hand control back
7. A credible **design** (not implementation) for heterogeneous surfaces
   (legacy web, desktop) and multi-tenant artifact reuse

**Target application:** a small local banking-style web app called the
**Credit Union Teller Console**, built by us — not a real bank system, not
a public site scraped under uncertain terms. It exposes exactly two
automatable capabilities, chosen to mirror the assignment's own example
goals:

- **`get-savings-balance`** (safe / read-only) — member search → member
  detail → savings balance extraction
- **`open-sub-account`** (risky / mutating) — member search → multi-field
  form → validation → confirmation screen

Both flows include real validation and business-outcome states (e.g. "no
such member," a validation error on the sub-account form), not just a
happy path.

**Explicitly minimal/mocked, and documented as such:**

- Operator console for human handoff: a CLI/bare page, not a real
  co-browsing UI
- Multi-tenant reuse: design-only, at most one canonicalization example
- Desktop/legacy-web surface: designed for via the `Surface` interface,
  never implemented

## The 10-phase implementation plan

1. **Architecture & Planning** — system design, artifact schema design,
   tech stack selection, this document. *(Complete.)*
2. **Foundation** — project scaffold, TypeScript/build config, module
   boundaries as placeholders, test runner config, base docs. *(Complete
   — this is the phase this document describes.)*
3. **Target Application** *(Complete — see "What Phase 3 actually
   implemented" below)* — the Credit Union Teller Console: the
   `get-savings-balance` and `open-sub-account` flows described above,
   SQLite-backed via a deterministic TypeScript seed script (`npm run
   db:seed`, fake data only, no real PII), deliberately without
   `data-testid` attributes, with real validation and business-outcome
   states, plus a permission-blocked scenario and an unexpected
   confirmation interstitial.
4. **Computer-Use Layer** *(Complete — see "What Phase 4 actually
   implemented" below)* — `Surface` interface implemented against
   Playwright: accessibility-first perception, action execution, locator
   fallback resolution.
5. **Artifact** *(Complete — see "What Phase 5 actually implemented"
   below)* — finalize and validate the artifact schema; a file-backed
   store (load/save/list); fixtures for tests.
6. **Discovery** *(Complete — see "What Phase 6 actually implemented"
   below)* — the LLM agent loop wired to the Claude API via tool-calling;
   the artifact compiler; a real discovery run for `get-savings-balance`
   executed against the live target app, with evidence captured under
   `evidence/discovery/`. (`open-sub-account` discovery was explicitly out
   of this phase's approved scope — see below.)
7. **Replay** *(Complete — see "What Phase 7 actually implemented" below)*
   — the deterministic replay engine: parameter substitution, locator
   resolution, per-step error handling, checkpoint verification, output
   extraction, structured result reporting. A real replay of
   `get-savings-balance` executed against the live target app, with
   evidence captured under `evidence/replay/`.
8. **Safety / Handoff / Evidence** — the policy guard (allowlist +
   risk-level enforcement) wired in front of every action in both loops;
   redaction; the human handoff controller (pause/cede/resume) and its
   mocked operator CLI; the JSONL/screenshot/trace evidence writer, which
   writes curated, committed output under `evidence/discovery/`,
   `evidence/replay/`, and `evidence/errors/` (scratch/runtime data goes
   elsewhere and stays gitignored — see "Evidence directory policy"
   below).
9. **Testing / Deployment** — unit tests, e2e regression tests against the
   target app, README/setup polish. (Deployment is intentionally minimal;
   see out-of-scope items below.)
10. **Submission** — REPORT.md using the seven required headings, final
    clean evidence capture under `evidence/discovery/`, `evidence/replay/`,
    and `evidence/errors/` (a success run and a run that hits an injected
    error/business-outcome path), repo cleanup, public push.

## Current status

**Phase 7 — Deterministic Replay — complete as of this commit, all tests
passing, including a real deterministic replay run (no LLM) against the
live app.** Phases 8–10 are not started. `src/safety` (minus one
mechanical type fix — see Phase 4 notes below), `src/handoff`, and
`src/evidence` remain Phase 2 placeholders that throw `Error("not
implemented yet")` if invoked — `src/agent` and `src/replay` are now real
— see README.md's status table for the per-component breakdown.

**Final verification (clean state):** `npm run build` (0 errors) →
`npm test` (**138/138** passed, 17 files — 113 from Phases 3/4/5/6
unchanged + 25 new Phase 7 tests) → `npm run test:e2e` (4/4 passed,
unaffected).

**Final verification, Phase 4 (still accurate):** manual verification
script (`scripts/manual-verify-phase4.ts`) driven against a live
`npm run dev` instance — navigate → search member `1001` → reach member
details → read savings balance (`$482.17`) — all via the Surface
abstraction only, result: **PASS**.

**Final verification, Phase 6 (real LLM discovery run, not a fake/mocked
one):** `npx tsx scripts/discover-get-savings-balance.ts` against a live
`npm run dev` instance, goal `"Look up member 1001 and read their current
savings balance."`, model `claude-sonnet-5` — the model itself chose
`type -> click -> read -> finish` (4 decision steps) from live
observations, with no scripted sequence anywhere in the discovery path.
Result: **PASS** — savings balance `$482.17`, artifact saved to
`artifacts/get-savings-balance.json` (parameterized: `memberId` is a
typed input; `"1001"` appears only as its `example` field, never inside
an executable step), evidence written to
`evidence/discovery/b6ff853d-cc18-4ba5-ac4a-fe622d81c585/`.

**Final verification, Phase 7 (real deterministic replay run, zero LLM
calls):** `npx tsx scripts/replay-get-savings-balance.ts` against a live
`npm run dev` instance — loaded `artifacts/get-savings-balance.json`
(the real Phase 6 discovery output above) from disk, substituted
`memberId = "1001"` into its steps, and executed `navigate -> type ->
click -> read` purely through the Surface abstraction, no LLM call, no
Anthropic API involved. Both checkpoint conditions (`urlMatches`,
`textPresent`) were satisfied against a fresh post-steps observation.
Result: **PASS** — savings balance `$482.17`, duration 1317ms, evidence
written to `evidence/replay/47a9a053-9b78-4b1a-8772-0b8db00aced5/`.

## What Phase 3 actually implemented

- **Schema** (`src/app/db/schema.ts`): `members` and `accounts` tables —
  see README.md → "Database schema" for the exact columns.
- **Seed** (`src/app/db/seed.ts`, run via `npm run db:seed`): 3
  deterministic fake members (`1001` active, `1002` active, `1003`
  restricted), each with one seeded `savings` account; member ID `9999`
  is deliberately never seeded, used to exercise member-not-found. No
  real PII. Idempotent — safe to re-run.
- **Repository** (`src/app/db/repository.ts`): typed data access —
  `findMemberById`, `listAccountsForMember`, `findAccountById`,
  `insertSubAccount`.
- **Validation** (`src/app/validation.ts`): sub-account form rules
  (account type must be `sub_savings`/`sub_checking`, nickname 2–40
  chars, deposit ≥ $25.00 and a valid dollar amount), reporting all
  applicable errors at once.
- **Routes/views** (`src/app/routes.ts`, `src/app/views/*.ejs`): both
  capability flows, each state on its own URL — search, member detail,
  not-found, sub-account form (with inline errors), permission-blocked,
  large-deposit confirmation interstitial, and final confirmation.
  Semantic HTML only (labeled fields, real button/link text), no
  `data-testid` anywhere, per the approved brief.
- **Error/exception scenarios implemented, exactly the four asked for**:
  member not found (business outcome, not a crash), invalid sub-account
  form input (inline validation errors), a permission-blocked scenario
  (restricted member `1003` cannot open a sub-account), and an unexpected
  confirmation interstitial (deposits ≥ $10,000 require an extra confirm
  step).
- **Tests**: `tests/unit/db.test.ts`, `tests/unit/validation.test.ts`,
  `tests/unit/app.test.ts` (24 tests total, Vitest, including a
  full-HTTP integration suite against an in-memory-DB server) plus
  `tests/e2e/get-savings-balance.spec.ts` and
  `tests/e2e/open-sub-account.spec.ts` (4 tests, Playwright Test, real
  Chromium against a dedicated auto-seeded server on port 3902).
- **Build fix required by the new views**: `tsc` does not copy `.ejs`
  files into `dist/`, so `npm run build` now also runs
  `scripts/copy-views.ts` to copy `src/app/views` into `dist/app/views`
  after compiling — otherwise `npm start` would 500 on every render.

**Known, deliberate gap vs. the original phase description above:** the
original Phase 3 bullet (written during Phase 1/2 planning) mentioned
"controlled failure-injection toggles (latency, session expiry)." The
detailed Phase 3 task brief that was actually approved asked for four
different concrete scenarios instead (member-not-found, invalid form,
permission-blocked, unexpected confirmation) and did not mention latency
or session-expiry simulation. Those four were built; latency/session-expiry
injection was **not** — it's deferred, most naturally revisited once the
computer-use layer (Phase 4) needs to handle "slow/failed load" per the
assignment's own runtime-error list (§1).

## What Phase 4 actually implemented

- **Surface interface** (`src/surface/types.ts`): `navigate`, `observe`,
  `click`, `type`, `read`, `screenshot`, `close` — named methods, not the
  single `act(action)` dispatcher sketched in Phase 1/2 planning (see
  ARCHITECTURE.md → "Computer-use Surface abstraction" for why this is
  the finalized shape). Zero dependency on the `playwright` package —
  enforced by a test, not just convention.
- **Playwright-backed implementation** (`src/surface/playwright-surface.ts`,
  new runtime dependency: `playwright`): launches one Chromium
  browser + page per `Surface` instance and reuses it for every call.
- **Locator abstraction**: an ordered `LocatorStrategy[]` fallback chain
  (role/name → label → text → attribute → CSS), resolved to exactly one
  match or treated as unresolved — no coordinate-based targeting anywhere,
  no `data-testid` dependency.
- **Observation contract**: a bounded, deliberate snapshot (`url`,
  `title`, up to 200 `elements` with role/name/value/editable, up to
  5,000 chars of visible text) built via a DOM walk, not raw browser
  internals.
- **Structured results**: every action returns
  `{ok: true, value} | {ok: false, error}` — nothing thrown for ordinary
  failures; failures carry a `code` and, where relevant, a best-effort
  observation for debugging.
- **Tests**: `tests/unit/surface.test.ts` — 13 tests covering session
  start, navigate, observe, click, type, read, screenshot, a structured
  failure on an unresolvable locator, a structured failure on an
  unreachable navigation target, session reuse across many sequential
  actions (including after a prior failure), a post-`close()` structured
  failure, and three tests statically enforcing that only
  `playwright-surface.ts` imports the `playwright` package.
- **Manual verification**: `scripts/manual-verify-phase4.ts`, a
  repeatable script (not a one-off) that drives the real running app
  through the Surface only — see "Final verification" above for the
  passing result.
- **A real bug found and fixed by manual verification, not by the
  automated suite**: `observe()` threw `ReferenceError: __name is not
  defined` when the exact same code ran via `tsx` instead of via
  Vitest's transform (an esbuild/Playwright interaction — see
  ARCHITECTURE.md for the detailed explanation and fix). Recorded
  explicitly because Phase 6/7 will also run outside of Vitest and would
  have hit the same failure silently.
- **One mechanical fix required elsewhere**: `src/safety/index.ts`
  imported an `Action` type from `src/surface` that no longer exists
  under the new interface; its placeholder now takes `unknown` — still a
  placeholder, still throws `not implemented`, just no longer referencing
  a type that Phase 4 legitimately removed.
- **tsconfig.json**: added `"DOM"` to `compilerOptions.lib` — required
  because `page.evaluate()` callbacks are type-checked as browser code;
  this only affects TypeScript's type-checking, not runtime behavior.

## What Phase 5 actually implemented

- **Schema** (`src/artifact/types.ts`): `Artifact` with exactly the
  fields the assignment's §3.2 asks for — id/schemaVersion/version,
  name/description, target, typed `inputs`/`outputs`, ordered `steps`
  (discriminated by `navigate`/`type`/`click`/`read` — exactly the four
  actions actually needed, no speculative ones), `checkpoint`, and
  `businessOutcomes`. `Locator` is imported from `surface/types`, not
  redefined, so artifacts speak the exact same locator vocabulary the
  Phase 4 `Surface` resolves against.
- **Parameterization**: `{{name}}` references, matched wherever they
  appear in a value (whole-value or embedded in a literal, e.g.
  `"/members/{{memberId}}"`), validated against declared `inputs`.
  `memberId` in both example artifacts is a typed input, never a
  hardcoded value in any step — only present once, as illustrative
  `example` metadata.
- **Validation** (`src/artifact/validate.ts`): collects every applicable
  error rather than stopping at the first (matches the app's own
  `validation.ts` philosophy). Enforces a strict top-level-key allowlist
  — an artifact with an unrecognized field (e.g. a `transcript`) fails
  validation outright, which is what makes "no raw LLM transcript in an
  artifact" a structural guarantee rather than a convention.
- **Serialization** (`src/artifact/serialize.ts`): `toJson()` (formatted,
  2-space indent, diff-and-GitHub-readable) / `fromJson()` (parses, then
  always re-validates — a round trip can never silently produce something
  that wouldn't itself pass validation).
- **Store** (`src/artifact/store.ts`): `ArtifactStore` — one JSON file
  per artifact (`{id}.json`) in a plain directory (default `./artifacts`,
  overridable — tests use an isolated temp dir). `save()` and `load()`
  both validate; `list()`/`exists()` are simple filesystem checks. No
  database, per the approved architecture.
- **Two committed example artifacts**, manually authored against the
  real running app (real routes, real button/label text, real locators)
  — **not** LLM-discovery output, which is explicitly Phase 6's job:
  - `artifacts/get-savings-balance.json` — safe, 4 steps, 1 typed input
    (`memberId`), 1 typed output (`savingsBalance`), 1 business outcome
    (`MEMBER_NOT_FOUND`).
  - `artifacts/open-sub-account.json` — risky, 8 steps, 4 typed inputs
    (`memberId`, `accountType`, `nickname`, `initialDeposit`), no
    outputs (checkpoint alone is the result — see the trade-offs table
    in ARCHITECTURE.md for why), 4 business outcomes
    (`MEMBER_NOT_FOUND`, `VALIDATION_FAILED`, `ACCOUNT_OPENING_BLOCKED`,
    `LARGE_DEPOSIT_CONFIRMATION_REQUIRED`).
- **Tests**: 35 new tests across `tests/unit/artifact-validate.test.ts`
  (20), `artifact-serialize.test.ts` (4), `artifact-store.test.ts` (7),
  and `artifact-examples.test.ts` (4) — covering every case listed in the
  approved Phase 5 brief, plus the two committed examples validating and
  being genuinely parameterized.
- **A real bug caught by the test suite itself, not manual review**: the
  first draft of parameter-reference validation only accepted a `{{name}}`
  reference as the *entire* string value, which rejected
  `get-savings-balance.json`'s own checkpoint pattern
  (`"/members/{{memberId}}"` — a reference embedded in literal text).
  Fixed by generalizing the match to find every well-formed token
  wherever it appears, still flagging genuinely malformed syntax (`{{}}`,
  unclosed `{{memberId`) — see ARCHITECTURE.md's trade-offs table.
- **Known limitation, deliberately deferred to Phase 7**: the recorded
  `type` step for the sub-account form's `<select>` (Account Type) will
  need Phase 7's replay engine to handle differently than a text input —
  Phase 4's `Surface.type()` calls Playwright's `.fill()`, which doesn't
  support `<select>` elements. Phase 5 never executes anything against a
  live `Surface`, so this couldn't be caught by Phase 5's own tests;
  recorded explicitly in ARCHITECTURE.md so Phase 7 finds it in the docs,
  not the hard way.

## What Phase 6 actually implemented

- **Structured action contract** (`src/agent/types.ts`): `AgentAction`,
  exactly six variants — `navigate`, `click`, `type`, `read`, `finish`,
  `fail` — each mapped 1:1 to an Anthropic tool definition
  (`src/agent/llm-client.ts`). `type`/`read` steps require the model to
  declare `inputRef`/`outputRef` (a short, generic name for what the
  value represents, e.g. `"memberId"`) alongside the literal value — this
  is what later lets artifact compilation stay a deterministic read of
  the model's own declared refs rather than a second LLM pass (the
  "Artifact authoring" decision from Phase 1/2 planning, followed exactly
  as originally specified — see ARCHITECTURE.md's trade-offs table).
  `click`/`type`/`read` targets are `Locator`, imported directly from
  `surface/types` (not redefined), the same pattern `src/artifact/types.ts`
  already established in Phase 5.
- **LLM client** (`src/agent/llm-client.ts`): `LlmClient` is a one-method
  interface (`decide()`); `createAnthropicLlmClient()` is the only file in
  `src/agent` that imports `@anthropic-ai/sdk`. Every decision is forced
  through `tool_choice: {type: "any"}` across the six tools above, so the
  model cannot return free-form prose in place of a structured action.
  Model name comes from `ANTHROPIC_MODEL` (`src/config/env.ts`, already
  wired in Phase 2) — not hardcoded, and not scattered across files.
- **Discovery loop** (`src/agent/loop.ts`): `runDiscoveryLoop()` — a
  bounded `observe -> decide -> validate -> act -> observe -> ...` loop
  depending only on the `Surface` and `LlmClient` *interfaces*, never
  Playwright or the Anthropic SDK directly, which is what makes it
  exercisable in tests with fakes for both. Stopping conditions: model
  calls `finish()` (verified, not assumed — see below) or `fail()`, max
  steps, timeout (via an injectable clock for deterministic tests), an
  invalid/malformed model response, a provider-level LLM error, or a
  Surface `SESSION_CLOSED` error (the one Surface failure treated as
  unrecoverable — every other Surface error, e.g. `ELEMENT_NOT_FOUND`, is
  recorded and fed back into the next `decide()` call's history so the
  model can see the failure and try a different locator, bounded by
  maxSteps/timeoutMs either way).
- **Verified success, not assumed**: `finish()` requires
  `checkpointText` — a snippet the model claims is visible on the current
  page — which is checked against the real, current observation before
  the run is accepted as successful, and `outputRefs` naming only values
  that were actually produced by a prior successful `read()` this run
  (never a value the model types directly into `finish()`). "A click
  succeeded" is deliberately not sufficient on its own, per the approved
  Phase 6 brief.
- **Deterministic artifact compilation** (`src/agent/compile-artifact.ts`):
  `compileArtifactFromTrace()` — no second LLM pass. Reads the trace's
  own declared `inputRef`/`outputRef`/literal values mechanically: each
  `type` step's literal value becomes an `ArtifactInput` (with the
  literal as `example`, not baked into the step); each step's value is
  replaced with its `{{inputRef}}` reference; the checkpoint's URL
  pattern is derived from the run's actual final URL with every input's
  literal example replaced by its reference. Only the successful path is
  compiled — any step whose Surface outcome was an error is exploration
  noise, dropped, not part of the reusable capability. `businessOutcomes`
  is left empty (`[]`) — a single successful run never exercises a
  member-not-found or validation-error branch, and inventing one would be
  exactly the "don't invent what wasn't earned" mistake already avoided
  for `open-sub-account`'s empty `outputs` in Phase 5. The compiled
  artifact is run through `validateArtifact()` before being returned.
- **Evidence** (`src/agent/evidence.ts`): `writeDiscoveryEvidence()`
  writes `evidence/discovery/<run-id>/{trace.json, artifact.json (only on
  success), summary.md, screenshots/*.png}`. `trace.json` is the
  structured `DiscoveryTrace` — goal, model metadata, per-step
  observation summaries, chosen actions, outcomes, final outcome — never
  a raw model transcript, and passed through a defense-in-depth
  redaction pass (`SECRET_PATTERNS`) before being written, even though
  nothing in a `DiscoveryTrace` should ever contain a key by
  construction (model metadata is `{provider, model}` only). `summary.md`
  lists every decision in order specifically so a reviewer can see, at a
  glance, that the sequence was chosen live rather than scripted.
  `.gitignore`'s blanket `evidence/` exclusion (a known gap flagged in
  Phase 5's edit of this document) was narrowed so curated evidence can
  actually be committed, per the "Evidence directory policy" below.
- **Entry point** (`src/agent/index.ts`): `runDiscovery(goal, config,
  dependencies?)` composes the pieces above — creates (and owns/closes) a
  real `PlaywrightSurface` and `AnthropicLlmClient` by default, or accepts
  fakes via `dependencies` for tests — runs the loop, compiles + saves an
  artifact on success, writes evidence, and returns
  `{trace, artifactId?, evidenceDir}`. This replaces the old Phase 2
  placeholder signature (`runDiscovery(goal): Promise<Artifact>`), which
  assumed every call succeeds; the real contract has to represent failure
  as a first-class outcome, not an exception.
- **Tests**: 41 new tests across `tests/unit/agent-validate-action.test.ts`
  (16), `agent-loop.test.ts` (12), `agent-compile-artifact.test.ts` (5),
  `agent-evidence.test.ts` (4), and `agent-run-discovery.test.ts` (4) —
  covering all 15 cases in the approved Phase 6 brief. No unit test makes
  a live Anthropic call: `tests/unit/fixtures/fake-llm-client.ts`
  (scripted/throwing fakes implementing `LlmClient`) and
  `tests/unit/fixtures/fake-surface.ts` (a small in-memory `Surface`
  simulating the get-savings-balance flow, plus always-failing/
  session-closed variants) stand in for the real Anthropic client and
  Playwright.
- **Real discovery run, not simulated**: `scripts/discover-get-savings-balance.ts`
  drove a real Anthropic API call (model `claude-sonnet-5`) against a live
  `npm run dev` instance for the goal `"Look up member 1001 and read their
  current savings balance."` The model itself chose
  `type -> click -> read -> finish` (4 steps) — no hardcoded sequence.
  Result: **PASS**, savings balance `$482.17`, artifact saved to
  `artifacts/get-savings-balance.json` (parameterized — see "What Phase 6
  actually established" trade-offs below), evidence written to
  `evidence/discovery/b6ff853d-cc18-4ba5-ac4a-fe622d81c585/`.
- **A real bug found and fixed by the real smoke test, not the automated
  suite**: the first live run's `finish()` call quoted
  `checkpointText: "SAVINGS BALANCE:\n\n$482.17"` — but with a literal
  two-character `\` + `n` where the real page has an actual newline byte
  (visually identical to a human, byte-different to `.includes()`). The
  exact-substring checkpoint check rejected a genuinely correct answer.
  Fixed with `normalizeForCheckpointMatch()` in `loop.ts` (collapses
  whitespace and literal `\n`/`\r` escapes on both sides before
  comparing) and a corresponding regression test; reran the full suite,
  then reran the real smoke test, which then passed. Recorded here
  because it's the same category of finding as Phase 4's `__name` bug and
  Phase 5's parameter-reference bug: something only a real run outside
  the automated suite's exact conditions could surface.
- **Known limitation, observed in the real artifact, not fixed**: the
  compiled `get-savings-balance.json`'s `read` step's second locator
  strategy is `{type: "text", text: "$482.17"}` — the model's own
  fallback choice, and it embeds the literal balance value it's reading,
  which won't generalize to another member's balance on replay. The
  first strategy (`{type: "label", text: "SAVINGS BALANCE:"}`) is more
  likely to resolve in practice since the balance isn't inside a
  `<label>`-associated form field, but this is a real gap in what the
  `Surface`/`Locator` vocabulary can express for "the value near this
  label" — worth Phase 7 (replay) or Phase 8 (safety review) attention
  when this artifact is actually replayed against a different member, not
  fixed here since Phase 6 doesn't touch replay and the artifact was
  deterministically compiled from the model's own real decision, not
  hand-edited.
- **`open-sub-account` discovery — explicitly out of this phase's
  scope**: the approved Phase 6 brief named `get-savings-balance` as "the
  first real discovery run"; a second, real `open-sub-account` discovery
  run (a risky/mutating, multi-field flow) was not attempted this phase
  and remains a natural candidate for the next discovery run, whenever
  it's approved.

## What Phase 7 actually implemented

- **Result types** (`src/replay/types.ts`): `ReplayResult` — `runId`,
  `artifactId`/`artifactVersion`, `startedAt`/`finishedAt`/`durationMs`,
  `inputs` used, ordered `steps` with structured outcomes, `outputs`,
  `checkpoint` (per-condition detail, not just a boolean), a
  `ReplayFinalStatus`, and `error` when applicable. Deliberately zero
  structural relationship to `src/agent/types.ts`'s `DiscoveryTrace` — no
  shared interface, no import of anything from `src/agent` — so "this ran
  through the LLM discovery loop" and "this ran through deterministic
  replay" can never be confused by type, only by construction.
- **Parameter substitution** (`src/replay/substitute.ts`): resolves every
  well-formed `{{name}}` token in a step's value/url (and a checkpoint
  condition's pattern/text) against the caller-supplied runtime inputs —
  the same token syntax `src/artifact/validate.ts` already validates
  artifacts against, applied here for real substitution. Deliberately its
  own five-line module rather than importing artifact's validation
  internals (which aren't exported) — cheaper than coupling the two.
- **Checkpoint evaluation** (`src/replay/checkpoint.ts`): evaluated once,
  after every step has executed, against a **fresh** observation — never
  inferred from the last step's own success. `urlMatches` compares against
  the observed URL's pathname (matching how `compile-artifact.ts` derives
  patterns); `textPresent` uses the same whitespace/escaped-newline
  tolerant match `src/agent/loop.ts` uses for the identical reason (a real
  Phase 6 run found quoted text can differ from DOM text only in
  formatting); `elementVisible` resolves the target via `Surface.read()`
  (the least-destructive existing Surface method that both resolves a
  locator and reports a clean structured failure if it doesn't — no new
  Surface method needed).
- **Engine** (`src/replay/engine.ts`): `replayArtifact()` — Saved Artifact
  → `validateArtifact()` → resolve runtime inputs (required/type-checked)
  → replay ordered steps through `Surface` → fresh observe/checkpoint →
  SUCCESS/FAILURE. Depends only on the `Surface` *interface*, never
  Playwright or any LLM provider SDK — the same discipline
  `src/agent/loop.ts` follows for discovery, which is what makes both
  exercisable with fakes in tests. `artifact` is accepted as `unknown`,
  not `Artifact` — validation failure becomes a structured
  `{status: "invalid_artifact"}` result, never a thrown exception. A
  failed required step stops replay immediately (no retry, no fallback,
  no "ask an LLM what to do") — the loop simply returns a failure result
  with everything executed so far.
- **Structured failure statuses**, each mapped from a real cause rather
  than a single generic "error": `invalid_artifact`, `missing_input`,
  `invalid_input` (a declared `number`/`boolean` input whose supplied
  string doesn't parse), `unknown_action`, `target_not_found`
  (`ELEMENT_NOT_FOUND`), `navigation_failed` (`NAVIGATION_FAILED`),
  `action_failed` (`TIMEOUT`/`SESSION_CLOSED`/`UNKNOWN`),
  `checkpoint_mismatch`, `timeout` (via an injectable clock, same pattern
  as `loop.ts`, so timeout tests never actually wait), and
  `unexpected_page_state` (the final post-steps `observe()` call itself
  fails, so the checkpoint can't even be evaluated).
- **"Not successful merely because nothing threw"**: satisfied two ways —
  every individual `Surface` call already returns a real structured
  `{ok, value|error}` result (not "didn't throw"), and more importantly
  the artifact's overall success is never inferred from any single step;
  it requires the independent post-steps checkpoint to pass, exactly as
  Phase 5's docs already committed to ("prevents a false success when an
  action silently no-ops") — see the dedicated test asserting a run whose
  every step returned `ok` still reports `checkpoint_mismatch`.
- **Evidence** (`src/replay/evidence.ts`): `writeReplayEvidence()` writes
  `evidence/replay/<run-id>/{result.json, artifact.json, summary.md,
  screenshots/*.png}` — `artifact.json` is a frozen snapshot of the exact
  artifact replayed (since `artifacts/*.json` can be overwritten by a
  later discovery run), and `summary.md` opens with an explicit,
  unambiguous statement — **"This is a deterministic replay — no LLM was
  invoked to decide any action."** — specifically so a reviewer can't
  mistake replay evidence for discovery evidence. Same defense-in-depth
  secret redaction pass as `src/agent/evidence.ts`.
- **Entry point** (`src/replay/index.ts`): `runReplay(artifactId, inputs,
  dependencies?)` — reads the artifact file directly (not through
  `ArtifactStore.load()`, which throws on an invalid file; replay needs
  the structured-failure path even for a missing/malformed artifact file,
  so a deliberately invalid placeholder object is fed to `replayArtifact()`
  instead, letting the one validation code path handle it), creates
  (and owns/closes) a real `PlaywrightSurface` by default or accepts a
  fake via `dependencies` for tests, replays, writes evidence, returns
  `{result, evidenceDir}`.
- **No LLM anywhere — proven, not just asserted**: `src/replay` contains
  no reference to an LLM provider SDK, the discovery agent module, or any
  model-provider credential/config, checked two ways in
  `tests/unit/replay-no-llm.test.ts`: (1) a static scan of every file
  under `src/replay` for forbidden substrings (an LLM SDK package name,
  an `../agent` import, `ANTHROPIC_API_KEY`/`ANTHROPIC_MODEL`,
  `createAnthropicLlmClient`), and (2) a full successful replay run with
  `ANTHROPIC_API_KEY` deleted from the environment — proving the LLM
  isn't just unused this run, no code path could reach it even if it
  wanted to (any accidental Anthropic client construction would throw
  immediately without a key, per `src/agent/index.ts`'s own guard).
- **Tests**: 25 new tests across `tests/unit/replay-engine.test.ts` (17),
  `replay-evidence.test.ts` (5), and `replay-no-llm.test.ts` (3) — covering
  all 16 cases in the approved Phase 7 brief plus the explicit
  determinism proof. Unit tests use a dedicated fixture artifact
  (`tests/unit/fixtures/replay-artifact.ts`) rather than the live
  `artifacts/get-savings-balance.json` — that file is Phase 6 discovery
  output and can change with every new discovery run, so the engine's own
  tests are pinned to a fixture the suite controls, matching the same
  reasoning `artifact-examples.test.ts` already applies in Phase 5.
- **Real replay run, not simulated**: `scripts/replay-get-savings-balance.ts`
  loaded the real, live `artifacts/get-savings-balance.json` and replayed
  it against a live `npm run dev` instance with `memberId = "1001"` — see
  "Final verification, Phase 7" above for the passing result. Notably,
  this exercised the real artifact's actual locator fallback chain
  (`{type: "label", text: "SAVINGS BALANCE:"}` failing to resolve, as
  expected — see the "Known limitation" note below — falling through to
  `{type: "text", text: "$482.17"}`, which succeeded) end to end for the
  first time; Phase 6 never executed this artifact against a live Surface
  a second time, only discovered it once.
- **Known limitation, observed again, still not fixed**: the same gap
  flagged in Phase 6 — the real artifact's `read` step's fallback locator
  strategy embeds the literal balance value discovered at recording time
  (`"$482.17"`), which won't resolve for a member with a different
  balance. The real Phase 7 replay above only exercises `memberId =
  "1001"`, the same member the artifact was discovered against, so this
  never surfaced as a failure — it would if replayed for a different
  member. Still a real gap in what the `Surface`/`Locator` vocabulary can
  express ("the value near this label"), not something Phase 7's replay
  engine itself can paper over — the engine faithfully executes whatever
  locator the artifact declares; fixing the underlying expressiveness gap
  would mean either enriching `Locator`/`Surface` (Phase 4's territory) or
  having discovery record a more general locator (Phase 6's), neither of
  which was in Phase 7's approved scope.

## Explicit out-of-scope / cut items

These are deliberate cuts, not oversights, made in line with the
assignment's own guidance that scaling infrastructure is not rewarded and
that a thin-but-real version of every requirement beats a polished subset:

- **No Docker / Docker Compose** — a single Node process plus a browser is
  the entire runtime; containerizing it teaches nothing about the actual
  problem this assignment is testing.
- **No PostgreSQL / Redis** — SQLite is sufficient for the target app's
  own data, and there's no shared/concurrent-access requirement that would
  justify a client-server database. No caching or pub/sub need exists.
- **No Kubernetes / microservices / queues** — the whole system runs as
  one process today; the one real service boundary (`Surface`) is already
  isolated behind an interface, so it could be split out later without a
  rewrite, but doing so now would be exactly the "prematurely building
  scaling infrastructure" the brief says isn't rewarded.
- **No real-time co-browsing product** — human handoff is a real
  pause/cede-control/resume mechanism on the actual live browser session,
  but the "operator console" is a CLI, not a built UI. Explicitly
  sanctioned by the assignment's own scope note.
- **No desktop surface implementation** — designed for (the `Surface`
  interface is surface-agnostic) but not built; only a web target is
  automated.
- **No LLM call anywhere in the replay path** — by design, not a cut, but
  worth stating: this is the one thing the assignment does not leave up
  to us. As of Phase 7, this is implemented and proven, not just planned
  — see "What Phase 7 actually implemented" → "No LLM anywhere — proven,
  not just asserted."
- **Anthropic SDK not yet installed** — nothing in Phase 2 calls it, so it
  isn't a dependency yet; it's added when the discovery agent is actually
  built in Phase 6, to keep the Phase 2 dependency set to only what's
  used today.

## Evidence directory policy (locked)

Curated evidence is a required deliverable (assignment §6, item 3) — it
must be visible in the public repo without the evaluator running
anything, so it cannot be entirely gitignored. Approved layout:

```
evidence/
  discovery/   # committed — logs + screenshots/traces from real discovery runs
  replay/      # committed — logs from replay runs, including a successful one
  errors/      # committed — a replay that hits an injected/business-outcome error
```

Only curated, final evidence lives under these three subdirectories, and
only these are committed. Raw/scratch run output, ad hoc local testing
artifacts, browser profile data, and build output are written outside
`evidence/` and stay gitignored.

**Resolved in Phase 6:** `.gitignore`'s blanket `evidence/` exclusion
(added in Phase 2, before this policy existed) has been narrowed — it no
longer ignores `evidence/` at all. Nothing currently writes scratch
output elsewhere under that directory, so there is nothing else to
exclude yet; if a future phase adds non-curated runtime output under
`evidence/`, ignore that specific subpath at that time rather than the
whole directory again.

## SQLite seed data policy (locked)

The target app's local database is populated by a deterministic
TypeScript seed script, run via `npm run db:seed`. It creates fake,
non-PII demo members and any other fixture data the `get-savings-balance`
and `open-sub-account` flows and later tests need. The script is
idempotent and reproducible — same output every run — and uses the
existing `src/config/db.ts` connection rather than a separate DB layer.
The resulting `data/app.db` file stays gitignored (per Phase 2's
`.gitignore`); only the seed script itself is committed.
