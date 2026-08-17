# Architecture

> **Status note:** this document describes the approved architecture.
> Phases 1–7 are implemented (target application, computer-use/Surface
> layer, structured artifact system, LLM discovery agent, deterministic
> replay engine) — see "Computer-use Surface abstraction", "Structured
> artifact contract", "LLM discovery agent", and "Deterministic replay
> engine" below for what's actually built. Everything else still phrased
> as "will do X" — safety enforcement, human handoff — remains a Phase 2
> placeholder. README.md's status table is the source of truth for
> exactly what runs today.

## High-level architecture

```
                    ┌─────────────────────────────┐
   goal, target ──▶ │        Discovery Agent        │──▶ Artifact Compiler ──▶ artifacts/*.json
                    │  (Claude Sonnet 5, tool-use)  │
                    └───────────────┬───────────────┘
                                    │ observe()/act()
   artifact + params ──▶  ┌─────────▼─────────┐
                          │   Surface (interface)  │◀── Replay Engine (no LLM)
                          │  PlaywrightSurface impl │
                          └─────────┬─────────┘
                                    │ CDP / browser context
                          ┌─────────▼─────────┐
                          │   Target Web App    │  (Express + SQLite)
                          └────────────────────┘

Cross-cutting, wrapping every Surface.act() call in both loops:
  PolicyGuard (allowlist + risk classification)
  Evidence Logger (JSONL + screenshots + trace)
  Handoff Controller (controller: agent|human, pause/resume)
```

Single Node process, in-process function calls, synchronous control flow.
The only real service boundary is `Surface` — that's the seam that would
let a desktop or legacy-web implementation swap in later without touching
the agent, replay engine, or artifact schema.

## Major components and responsibilities

| Component | Directory | Responsibility | Built in |
|---|---|---|---|
| Target application | `src/app` | The **Credit Union Teller Console** — the two capabilities being automated: `get-savings-balance` (member search → member detail → savings balance extraction, safe/read-only) and `open-sub-account` (member search → multi-field form → validation → confirmation screen, risky/mutating) | Phase 3 |
| Computer-use / browser layer | `src/surface` | `Surface` interface (`navigate`/`observe`/`click`/`type`/`read`/`screenshot`/`close`) plus `createPlaywrightSurface()`, a Chromium-backed implementation: DOM-based accessibility-first perception, ordered-locator resolution, structured per-action results | Phase 4 — complete |
| Artifact system | `src/artifact` | The versioned, typed capability schema; `validateArtifact()`, `toJson()`/`fromJson()`, and `ArtifactStore` (save/load/list/exists). Holds exactly two committed artifacts: `artifacts/get-savings-balance.json` and `artifacts/open-sub-account.json` | Phase 5 — complete |
| Discovery agent | `src/agent` | LLM-driven observe→decide→act loop against a live `Surface` (Claude via forced tool-calling); deterministically compiles a successful run into an artifact; writes discovery evidence | Phase 6 — complete |
| Replay engine | `src/replay` | Deterministic, LLM-free execution of a saved artifact against new params; structured result reporting; writes replay evidence | Phase 7 — complete |
| Safety / policy | `src/safety` | Allowlist enforcement and safe-vs-risky action gating in front of every `Surface.act()` call | Phase 8 |
| Human handoff | `src/handoff` | Pause/cede-control/resume between the agent or replay engine and a human operator on the same live session | Phase 8 |
| Evidence / logging | `src/evidence` | JSONL step logs, screenshots, and Playwright traces per run, written under the committed `evidence/discovery/`, `evidence/replay/`, `evidence/errors/` tree (see PROJECT_PLAN.md → Evidence directory policy) | Phase 8 |
| Config | `src/config` | Environment loading (`env.ts`) and SQLite connection setup (`db.ts`, no schema yet). A deterministic seed script (`npm run db:seed`, no real PII) populates demo data once the Phase 3 schema exists | Phase 2 (this phase) / seed script added Phase 3 |

## Computer-use Surface abstraction (Phase 4 — implemented)

`src/surface` is the one boundary between everything else in this system
and a concrete UI-driving engine. It has two files with a hard rule
enforced by a test (`tests/unit/surface.test.ts`): only
`playwright-surface.ts` may import the `playwright` package —
`types.ts` and `index.ts` (the public entry point) never do.

### Interface

```ts
interface Surface {
  navigate(url: string): Promise<SurfaceResult<{ url: string }>>;
  observe(): Promise<SurfaceResult<Observation>>;
  click(locator: Locator): Promise<SurfaceResult<void>>;
  type(locator: Locator, text: string): Promise<SurfaceResult<void>>;
  read(locator: Locator): Promise<SurfaceResult<string>>;
  screenshot(): Promise<SurfaceResult<{ base64: string }>>;
  close(): Promise<void>;
}
```

This supersedes the single-`act(action)`-dispatcher sketch from Phase
1/2's planning — named methods per operation is the shape actually
agreed on for Phase 4.

### Locator strategy

Every action that targets an element takes a `Locator`: an ordered list
of `LocatorStrategy` values, tried in sequence until one resolves to
**exactly one** element. An ambiguous match (more than one element) is
treated as a miss, not a guess — the resolver falls through to the next,
more specific strategy rather than risk acting on the wrong element:

1. `{ type: "role", role, name }` — accessible role + name (most robust)
2. `{ type: "label", text }` — associated `<label>` text
3. `{ type: "text", text, exact? }` — visible text content
4. `{ type: "attribute", attribute, value }` — a stable attribute, when one exists
5. `{ type: "css", selector }` — last resort only

There is deliberately no `data-testid`-specific strategy, because the
target app has none (Phase 3, by design) — role/name and label are what
actually carry the weight in practice, which is the point of building it
that way.

### Observation contract

```ts
interface Observation {
  url: string;
  title: string;
  elements: ObservedElement[]; // role, name, value, editable — bounded to 200
  text: string;                 // visible-text snapshot, bounded to 5,000 chars
}
```

Built via a single `page.evaluate()` DOM walk over interactive elements
(links, buttons, inputs, selects, textareas, and anything with an
explicit ARIA role) that computes each element's accessible name the same
way a screen reader would: `aria-label` → `aria-labelledby` → associated
`<label>` → enclosing `<label>` → placeholder → text content. Only this
small, serializable shape crosses back out of the browser — never a DOM
handle, CDP object, or anything unbounded. This runs a custom DOM walk
rather than Playwright's own `accessibility.snapshot()`/`ariaSnapshot()`
so the shape stays exactly this flat, bounded contract instead of that
API's own nested tree.

### Results and errors

Every action returns `SurfaceResult<T> = { ok: true; value: T } | { ok:
false; error: SurfaceError }` — nothing in this module throws for an
ordinary failure. `SurfaceError` carries a `code`
(`ELEMENT_NOT_FOUND` | `NAVIGATION_FAILED` | `TIMEOUT` | `SESSION_CLOSED`
| `UNKNOWN`), a message, and — for element-resolution failures — a
best-effort `Observation` of the page at the moment of failure, so a
caller (later: the discovery agent, replay engine, or evidence logger)
gets debuggable context without a second round trip.

### Session lifecycle

`createPlaywrightSurface()` launches exactly one Chromium browser + page
and returns a `Surface` closure over that single session — every method
call reuses it; nothing is re-launched per action. `close()` is the only
way to tear it down. This is deliberate: Phase 7 (replay) and Phase 8
(human handoff) both need to keep acting on — or handing off — the *same*
live session, not a fresh one per step.

### A concrete bug this surfaced, worth remembering for later phases

Manual verification (required by the Phase 4 brief, separate from the
automated suite) caught something Vitest didn't: running the exact same
Surface code via `tsx` as a standalone script instead of through Vitest's
own transform threw `ReferenceError: __name is not defined` inside
`observe()`. Playwright ships `page.evaluate()` callbacks to the browser
as raw source text; when compiled by esbuild (via `tsx`), that source can
reference esbuild's own `__name()` helper, which never travels with it.
Fixed with a one-time `page.addInitScript()` shim that defines a no-op
`__name` in the browser, independent of exactly which transform compiled
the callback. Worth remembering because Phase 6 (discovery agent) and
Phase 7 (replay) will also run outside of Vitest, and would otherwise hit
the same failure — this is exactly why the brief asks for manual
verification in addition to automated tests.

## Structured artifact contract (Phase 5 — implemented)

`src/artifact` is the typed, versioned, serializable description of a
capability — the contract between "the model discovered this" (Phase 6)
and "the AI agent invokes this in production" (Phase 7). Four files, one
responsibility each: `types.ts` (the shape), `validate.ts`
(`validateArtifact()`), `serialize.ts` (`toJson()`/`fromJson()`), `store.ts`
(`ArtifactStore`) — imported through `index.ts`, not directly.

### Schema, field by field

```ts
interface Artifact {
  schemaVersion: string;        // e.g. "1.0" — SUPPORTED_SCHEMA_VERSIONS gates what validates
  id: string;                   // capability id, e.g. "get-savings-balance"
  name: string;                 // human-readable
  description: string;          // human-readable
  version: string;               // the artifact's own semver, independent of schemaVersion
  createdAt: string;              // ISO 8601
  riskLevel: "safe" | "risky";
  target: { appId: string; baseUrl: string; surfaceType: "web" };
  inputs: ArtifactInput[];         // typed, named — what a caller supplies
  outputs: ArtifactOutput[];        // typed, named — what a caller gets back
  steps: ArtifactStep[];             // ordered, discriminated by action
  checkpoint: Checkpoint;              // the success condition
  businessOutcomes: BusinessOutcome[]; // named, expected non-success results
}
```

Why these fields and no others: every one directly answers a question the
assignment poses (§3.2) — `id`/`schemaVersion`/`version` make it
versioned and addressable; `name`/`description`/`target` make it
reviewable by a human without reading code; `inputs`/`outputs` are the
calling contract an agent invokes by name with typed args; `steps` (with
locators) is "how each target element/control is identified"; `checkpoint`
is the success condition; `businessOutcomes` is the expected-outcome
contract §3.3 asks replay to distinguish from hard failures.
`ARTIFACT_TOP_LEVEL_KEYS` is enforced as an **exhaustive allowlist** by
`validateArtifact()` — an artifact object with any other top-level key
(a `transcript` field, for instance) fails validation outright. That's
the structural guarantee behind "must NOT contain the raw LLM
transcript": it isn't a convention, it's unrepresentable.

### Actions

```ts
type ArtifactActionType = "navigate" | "type" | "click" | "read";
```

Exactly the four the brief named, no more. `observe`/`screenshot` from
the Surface interface aren't step actions — they're perception/evidence
operations the replay engine (Phase 7) will call implicitly around steps,
not discrete things a recorded capability declares. `type` is used
generically for "set this control's value," including the sub-account
form's `<select>` — see the "Known limitation" note below.

### Parameterization

A step value is a `ParamValue` (a plain string) that may be a literal
("/") or contain one or more `{{name}}` references to a declared input —
either as the entire value (`"value": "{{memberId}}"`, a `type` step) or
embedded in a larger literal (`"pattern": "/members/{{memberId}}"`, a
checkpoint condition). `validateArtifact()` strips every well-formed
`{{name}}` token from a value and (a) flags anything `{{`/`}}`-shaped
left over as a malformed reference, and (b) flags any stripped token
whose name isn't a declared input as a dangling reference. This is what
makes "`memberId` must be a typed runtime input, not permanently encoded
as 1001" a validation-time guarantee, not a review-time hope — see
`artifacts/get-savings-balance.json`, where `1001` appears exactly once,
as `inputs[0].example` (documentation for a human reviewer), and nowhere
in an executable step.

### Locator representation

Steps that target an element (`click`, `type`, `read`) carry a `Locator`
— **imported directly from `surface/types`, not redefined** — so an
artifact's "how each control is identified" is expressed in exactly the
vocabulary the Phase 4 `Surface` actually resolves against (role/name →
label → text → attribute → CSS, same fallback order, same "ambiguous
match is a miss" semantics). This import is type-only and reaches
`surface/types.ts` specifically, never the `surface` barrel — so
`src/artifact` has zero relationship, even at the type level, to
`playwright-surface.ts` or the `playwright` package.

### Checkpoint strategy

```ts
type CheckpointCondition =
  | { type: "urlMatches"; pattern: string }
  | { type: "elementVisible"; target: Locator }
  | { type: "textPresent"; text: string };

interface Checkpoint { description?: string; all: CheckpointCondition[] }
```

`all` is evaluated as a whole, after every step has run — the same
design already committed to in Phase 1 planning ("prevents a false
success when an action silently no-ops"). `get-savings-balance`'s
checkpoint checks *both* that the URL reached the specific requested
member (`urlMatches: "/members/{{memberId}}"`) *and* that the success
banner text is present — either alone would be weaker.

### Expected business outcomes

```ts
interface BusinessOutcome { code: string; description: string; when: CheckpointCondition[] }
```

Reuses the exact same `CheckpointCondition` vocabulary as the checkpoint
— a business outcome is structurally "a named alternative checkpoint,"
which is precisely what it is. `open-sub-account.json` declares four:
`MEMBER_NOT_FOUND`, `VALIDATION_FAILED`, `ACCOUNT_OPENING_BLOCKED`, and
`LARGE_DEPOSIT_CONFIRMATION_REQUIRED` — the last one is worth calling
out: the recorded 8-step flow never submits the large-deposit
confirmation interstitial, so a deposit at or above the $10,000
threshold is honestly represented as "this recorded flow doesn't cover
that path" rather than silently mismodeled as a hard failure. Only the
**contract** is established in Phase 5 — matching these conditions
against a live run's actual state is Phase 7's job.

### Storage strategy

`ArtifactStore` is one JSON file per artifact, named `{id}.json`, in a
plain directory (default `./artifacts`, overridable per-instance — tests
use an isolated temp directory). No database: artifacts are small,
versioned, meant to be human-reviewed in a git diff — a filesystem *is*
the right amount of infrastructure here, matching the project's existing
SQLite-not-Postgres reasoning. `save()` runs the artifact through
`validateArtifact()` before writing (refuses to persist something that
wouldn't itself load cleanly); `load()` runs it through the same
validation on the way back in — there is exactly one validation code
path, used on every write and every read.

### Relationship between Surface and Artifact

`Surface` is how the *live* action happens; `Artifact` is the *recorded
description* of a sequence of those actions plus how to recognize success.
Neither depends on the other at the type level except through the shared,
Playwright-free `Locator` vocabulary — Phase 5 never imports
`playwright-surface.ts`, and nothing in `src/artifact` calls a `Surface`
method. That's deliberate: Phase 7's replay engine is the layer that
will hold an `Artifact` in one hand and a live `Surface` in the other,
substituting parameters, resolving each step's `Locator` via
`surface.click()`/`.type()`/`.read()`, and evaluating the checkpoint —
Phase 5 only had to make sure both sides speak the same locator language
so that layer doesn't need a translation step.

### Known limitation, deliberately deferred to Phase 7

The sub-account form's Account Type field is a native `<select>`. The
example artifact records it as a `type` step (`"value": "{{accountType}}"`)
for schema consistency with every other field-filling step, but Phase
4's `Surface.type()` currently calls Playwright's `.fill()`, which does
not support `<select>` elements (Playwright requires `.selectOption()`
for those). This was never exercised because Phase 5 doesn't execute
anything against a live `Surface` — it's a real gap for Phase 7 to solve
(either by adding per-control-kind dispatch to `Surface`, or a control-
kind hint on the step), not something Phase 5 could discover through its
own tests. Recorded here so it isn't rediscovered the hard way later.

## LLM discovery agent (Phase 6 — implemented)

`src/agent` is the LLM-driven `observe -> decide -> validate -> act ->
observe -> ...` loop against a live `Surface`, compiling a successful run
into a Phase 5 `Artifact`. Six files, one responsibility each: `types.ts`
(the action/trace shapes), `observe.ts` (`summarizeObservation()`),
`validate-action.ts` (`validateAgentAction()`), `llm-client.ts` (the
`LlmClient` interface and the real Anthropic-backed implementation),
`loop.ts` (`runDiscoveryLoop()`), `compile-artifact.ts`
(`compileArtifactFromTrace()`), `evidence.ts` (`writeDiscoveryEvidence()`)
— composed by `index.ts`'s `runDiscovery()`.

### Why the discovery path is genuinely LLM-driven, not a scripted flow

Three things are true simultaneously, and all three are necessary for
that claim to hold, not just the first one:

1. **The model actually decides.** `loop.ts` contains no `if url ===
   "/members/..."` branching and no fixed action sequence anywhere. Every
   iteration hands the live `ObservationSummary` to `LlmClient.decide()`
   and does whatever comes back (once validated) — the real smoke test
   run (see PROJECT_PLAN.md → "What Phase 6 actually implemented") chose
   `type -> click -> read -> finish` for `get-savings-balance` because
   that's what the model decided from the search page's actual controls,
   not because the code knows that flow in advance.
2. **The action space is structured, not parsed prose.** The model
   cannot express "click the second button" as free text — it must call
   one of exactly six Anthropic tools (`navigate`/`click`/`type`/`read`/
   `finish`/`fail`), forced every turn via `tool_choice: {type: "any"}`
   (`llm-client.ts`). This is what makes "validate the action" a real,
   meaningful step (`validate-action.ts`) rather than a formality.
3. **Success is verified against the real page, not assumed from the
   model's say-so.** `finish()`'s `checkpointText` is checked against the
   *actual* current observation before the run counts as successful, and
   its `outputRefs` are resolved from values a prior `read()` actually
   got back from the live `Surface` — never from anything the model
   types directly into `finish()`. A model that hallucinates success
   without ever reading the right thing gets `invalid_action`, not a
   false "success."

### The action contract

```ts
type AgentAction =
  | { action: "navigate"; url: string }
  | { action: "click"; target: Locator }
  | { action: "type"; target: Locator; value: string; inputRef: string }
  | { action: "read"; target: Locator; outputRef: string }
  | { action: "finish"; outputRefs: string[]; checkpointText: string; reasoning?: string }
  | { action: "fail"; reason: string };
```

`target: Locator` is the exact same type `src/surface` resolves against
and `src/artifact` already reuses (Phase 5's pattern, extended one more
layer: one locator vocabulary, three consumers, never redefined).
`inputRef`/`outputRef` are **required**, not optional, on `type`/`read` —
the model must name what a value represents (e.g. `"memberId"`,
generically, not describing its literal contents) at the moment it acts,
which is what lets `compile-artifact.ts` build a parameterized artifact
by mechanically reading these back rather than needing a second LLM pass
to infer them after the fact (the "Artifact authoring" decision from
Phase 1/2 planning, followed exactly as originally specified).

`validateAgentAction()` (self-contained, not a reuse of
`src/artifact/validate.ts` since it validates a single in-flight decision
rather than a persisted artifact, though it checks locator strategies the
same way) rejects anything that isn't one of the six shapes above —
missing fields, an unsupported action name, an empty locator strategy
list, a non-object response, or no tool call at all (a refusal, or the
model replying with plain text despite `tool_choice: "any"` — handled by
`llm-client.ts` returning a shape guaranteed to fail validation, so the
loop still stops cleanly via `invalid_action` rather than throwing).

### Observation format

The `Surface`'s own `Observation` (already bounded — 200 elements, 5,000
chars, see "Computer-use Surface abstraction" above) is compacted further
by `summarizeObservation()` before it ever reaches a prompt: controls
without a meaningful accessible name are dropped, the element list is
capped at 40, and visible text is capped at 1,200 characters. This is
re-sent on *every* iteration of a multi-step run, so keeping it small
matters for both cost and the model's ability to actually use it — never
the raw DOM, a screenshot, or CDP data crosses out of `src/surface`.

### The bounded loop and its stopping conditions

`runDiscoveryLoop()` depends only on the `Surface` and `LlmClient`
*interfaces* — never Playwright, never `@anthropic-ai/sdk` directly —
which is what makes it exercisable in tests with fakes for both (see
`tests/unit/fixtures/fake-surface.ts`, `fake-llm-client.ts`). One
iteration is `observe() -> decide() -> validateAgentAction() -> act()`,
repeated until one of:

- the model calls `finish()` (and its `checkpointText`/`outputRefs` both
  verify against the real trace — see above) — **success**;
- the model calls `fail()` — **failure**, a legitimate outcome, not an
  exception;
- `stepNumber` exceeds a configurable `maxSteps` (default 15) —
  **max_steps_exceeded**;
- an injectable clock reports elapsed time past a configurable
  `timeoutMs` (default 120,000) — **timeout** — the clock is injected
  specifically so timeout tests never need to actually wait;
- the model's response fails `validateAgentAction()` — **invalid_action**;
- `LlmClient.decide()` itself throws (auth, rate limit, network) —
  **llm_error**;
- a `Surface` action returns `SESSION_CLOSED` — **surface_error**, the
  one Surface failure treated as unrecoverable. Every *other* Surface
  error (`ELEMENT_NOT_FOUND`, a timed-out click, a failed navigation) is
  recorded and fed back into the next `decide()` call's history instead
  of ending the run — the model gets a chance to see the failure and try
  a different locator, still bounded by `maxSteps`/`timeoutMs` either
  way. This is deliberately more permissive than "any Surface error ends
  the run": the assignment's own stopping-condition list says
  *unrecoverable* Surface error, which `SESSION_CLOSED` specifically is
  and a missed locator specifically isn't.

### Deterministic artifact compilation — still no LLM in this step

`compileArtifactFromTrace()` reads a successful `DiscoveryTrace` back
mechanically: each `type` step's `inputRef` becomes an `ArtifactInput`
(the literal value becomes its `example`, documentation only — never
baked into the compiled step, which instead gets `"{{inputRef}}"`); each
`read` step's `outputRef` becomes an `ArtifactOutput` pointing at that
step's compiled `stepId`; the checkpoint's `urlMatches` pattern is the
run's real final URL with every input's literal example value replaced by
its `{{name}}` reference. Only steps whose Surface outcome was `ok` are
compiled — a step the model tried and got `ELEMENT_NOT_FOUND` on before
succeeding differently is exploration noise, not part of the reusable
capability. `businessOutcomes` is deliberately left empty: a single
successful run never exercises a business-outcome branch, and inventing
one from nothing would repeat the exact mistake Phase 5 already avoided
for `open-sub-account`'s empty `outputs`. The result is run through the
same `validateArtifact()` every other artifact in this system goes
through before being accepted.

### Evidence strategy

`writeDiscoveryEvidence()` writes `evidence/discovery/<run-id>/`:
`trace.json` (the full structured `DiscoveryTrace` — goal, model
metadata, every observation summary/action/outcome, final outcome — run
through a defense-in-depth redaction pass for anything key-shaped before
being written, even though nothing in a trace should contain a key by
construction), `artifact.json` (only on success), `summary.md` (a
human-readable, ordered list of every decision the model made — this is
the artifact a reviewer actually reads to confirm the run was genuinely
LLM-driven, not a raw log dump), and `screenshots/*.png` (one per
recorded step plus a best-effort final capture). This is *not* a raw
model transcript: the trace only ever contains the structured
observation/action/outcome shapes this document already describes, never
the model's internal reasoning tokens or the full Anthropic request/
response payload — the same "no raw LLM transcript" guarantee Phase 5's
`ARTIFACT_TOP_LEVEL_KEYS` allowlist gives artifacts, applied here to
evidence by construction (there's simply nowhere in `DiscoveryTrace` for
a transcript to go) rather than by a schema check.

## Deterministic replay engine (Phase 7 — implemented)

`src/replay` executes a saved `Artifact` against a live `Surface` with no
LLM anywhere in the path: `Saved Artifact -> validateArtifact() -> resolve
runtime inputs -> replay ordered steps -> Surface actions -> observe/check
results -> checkpoint validation -> SUCCESS/FAILURE`. Six files, one
responsibility each: `types.ts` (`ReplayResult` and its independent
status/step/checkpoint shapes), `substitute.ts` (`substituteParams()`),
`checkpoint.ts` (`evaluateCheckpoint()`), `engine.ts`
(`replayArtifact()`, `executeStep()`), `evidence.ts`
(`writeReplayEvidence()`) — composed by `index.ts`'s `runReplay()`.

The artifact is the **contract** between discovery and replay — replay
never sees a raw LLM transcript (there is nowhere in `ReplayResult` for
one to go, and `src/replay` never imports the discovery agent module at
all), which stays decoupled both by where files are written and,
independently, by `validateArtifact()`'s strict top-level-key allowlist.

### No LLM anywhere — the central Phase 7 guarantee

`replayArtifact()` and everything it calls depends only on the `Surface`
*interface*. `src/replay` contains no reference to an LLM provider SDK,
the discovery agent module, or any model-provider credential/config —
proven, not just asserted, in `tests/unit/replay-no-llm.test.ts` two
ways: (1) a static scan of every file under `src/replay` for forbidden
substrings (an LLM SDK package name, an `../agent` import, the Anthropic
API-key/model env var names, the discovery client's constructor name),
and (2) a full successful replay run with the Anthropic API key deleted
from the environment entirely — proving the LLM isn't just unused this
particular run, but that no code path could reach it even if it tried
(constructing an Anthropic client without a key throws immediately, per
`src/agent/index.ts`'s own guard, so a passing replay under those
conditions is direct evidence, not an inference).

### Runtime input resolution

Each declared `ArtifactInput` is checked before any `Surface` call is
made: a missing required input fails as `missing_input`; a supplied value
that doesn't parse for its declared type (`number`/`boolean`) fails as
`invalid_input`. Only once every input checks out does
`substituteParams()` resolve `{{name}}` references — the exact same token
syntax Phase 5's `validateArtifact()` already checks artifacts against —
into each step's literal `value`/`url` and each checkpoint condition's
`pattern`/`text`, immediately before that step or check executes.

### Step execution and failure handling

`executeStep()` maps each of the four artifact actions onto the matching
`Surface` method (`navigate`/`click`/`type`/`read`), substituting
parameters first. A step's `SurfaceError.code` is translated into one of
the replay engine's own structured statuses —
`ELEMENT_NOT_FOUND -> target_not_found`, `NAVIGATION_FAILED ->
navigation_failed`, everything else (`TIMEOUT`/`SESSION_CLOSED`/`UNKNOWN`)
`-> action_failed` — and replay stops **immediately**: no retry, no
fallback, and specifically no "ask the LLM what to do" path, because
there is no LLM in this module to ask. An artifact whose `validateArtifact()`
pass somehow let an unsupported action through (it can't, today — this is
defense in depth for any future in-memory `Artifact` object built without
going through validation) is reported as `unknown_action` by
`executeStep()`'s own defensive default case.

### Checkpoint validation — not "nothing threw"

The requirement "do not consider a click successful merely because
Playwright did not throw" is satisfied two ways simultaneously: every
`Surface` call already returns a real structured `{ok, value|error}`
result (never just "didn't throw"), and — more importantly — overall
success is never inferred from any single step succeeding. After every
step executes, `evaluateCheckpoint()` runs against a **fresh**
`surface.observe()` call, independent of whatever the last step's own
result was: `urlMatches` compares against the observed URL's pathname,
`textPresent` against the observed page text (whitespace/escaped-newline
tolerant, same reasoning as `loop.ts`'s identical tolerance — see its
"A real bug found..." note in PROJECT_PLAN.md), and `elementVisible`
resolves the target via `Surface.read()` (the least-destructive existing
method that both resolves a locator and reports a clean failure if it
can't — no new Surface method needed). A run whose every step reported
`ok` but whose final page doesn't satisfy the checkpoint is reported as
`checkpoint_mismatch`, not success — this is exactly Phase 5's original
design intent for `checkpoint` ("prevents a false success when an action
silently no-ops"), now actually enforced.

### `businessOutcomes` matching — still not implemented, scope clarified

Earlier planning (Phase 1/2, and this document's own prior draft of this
section) anticipated Phase 7's replay engine would also match a run's
final state against an artifact's declared `businessOutcomes`, to
distinguish an expected business outcome (e.g. "no such member") from a
hard failure. **The approved Phase 7 brief did not ask for this** — its
required failure taxonomy is exactly the eleven statuses listed above,
none of which is "business outcome." Implementing `businessOutcomes`
matching now, unasked, would have been scope creep beyond "implement
ONLY Phase 7." It remains a real, valuable next step — the schema and
data (`artifact.businessOutcomes`) are already there, unused by
`replayArtifact()` today — flagged here explicitly rather than silently
dropped, exactly the same way Phase 3's deviation from its original
planning bullet was recorded rather than glossed over.

### Evidence

`writeReplayEvidence()` writes `evidence/replay/<run-id>/`: `result.json`
(the full `ReplayResult`, redacted through the same defense-in-depth
secret-pattern pass `src/agent/evidence.ts` uses), `artifact.json` (a
frozen snapshot of the exact artifact replayed — `artifacts/*.json` can
be overwritten by a later discovery run, so evidence keeps its own copy
rather than relying on that file staying put), `summary.md` (opens with
an explicit, unambiguous line — **"This is a deterministic replay — no
LLM was invoked to decide any action."** — specifically so a reviewer
can't mistake replay evidence for discovery evidence at a glance), and
`screenshots/*.png` (one per executed step plus a best-effort final
capture, the same pattern `src/agent/evidence.ts` uses for discovery).

### Relationship to the two committed artifacts

`get-savings-balance` (safe) and `open-sub-account` (risky) — see
PROJECT_PLAN.md → Scope for their exact flows, `artifacts/*.json` for the
committed files, and ARCHITECTURE.md's components table above. Only
`get-savings-balance` has actually been replayed for real (see
PROJECT_PLAN.md → "Final verification, Phase 7"); `open-sub-account`
was never discovered for real either (Phase 6's known scope gap), so a
real replay of it isn't possible yet — the engine itself has no
capability-specific logic, so it would work identically once that
artifact exists.

## Planned safety model

- An explicit **allowlist** (base URLs/routes, permitted action types),
  enforced by `PolicyGuard` in front of every `Surface.act()` call in
  *both* discovery and replay — not just checked once at authoring time.
- A **safe vs. risky** classification per artifact/step: safe = read-only,
  idempotent; risky = anything mutating. Risky artifacts require an
  approved state before they can replay unattended — reviewed once, not
  re-confirmed on every invocation, so a reliable capability stays cheap
  to call.
- **Redaction**: artifacts store only parameterized placeholders, never
  literal captured values, so there's nothing sensitive baked into a
  saved capability. Evidence logs pass through a redaction filter before
  being written to disk.

## Planned human-handoff model

A single `controller: "agent" | "human"` flag per run is the entire
control-transfer mechanism. Only the current controller may call
`Surface.act()`. On a stuck condition, the orchestrator writes an
intervention request (goal, current step, current observation, reason)
and leaves the browser session open rather than closing it — a human (via
a CLI-driven, intentionally mocked operator surface) then either watches
the same visible browser window directly or connects a second Playwright
client to the same session over CDP. Every action taken while `human` is
in control is logged in the same step format as agent actions, tagged by
actor, so the run's evidence stays one coherent timeline. An explicit
`resume` flips control back to `agent` or completes the replay.

## Important architectural decisions and trade-offs

| Decision | Choice | Why |
|---|---|---|
| Perception | Accessibility-tree-first, not screenshot+coordinates | More robust on non-clean-DOM apps, cheaper in tokens, and the same signal a desktop UIA/AX client would use later |
| Process/service boundary | Single process; `Surface` is the only real interface boundary | Nothing here needs a service split yet; splitting later doesn't require a rewrite because the seam already exists |
| Artifact authoring | Deterministic compilation from the discovery agent's own declared `input_ref`/`output_ref` tool args, not a second LLM pass | Keeps "no model in the loop" extending one step further than strictly required, and keeps artifact generation reproducible |
| Risky-action policy | Approve-once (draft→approved), not ask-a-human-every-time | Re-confirming an already-reviewed, routine mutation on every call would defeat the "reliably and cheaply" goal of the whole system |
| Evidence weight | Full Playwright trace on discovery + failures/handoff only, lightweight JSONL+screenshot on ordinary replay | Traces are heavy; a clean replay only needs enough to confirm what happened, not a full recording |
| SQLite over Postgres | SQLite | No concurrent-writer or shared-access requirement exists at this scale; a client-server DB would be unused infrastructure |
| No Docker | Plain `npm run dev` / `npm start` | The runtime is one Node process plus a browser; containerizing adds nothing to what's actually being evaluated here |
| Observation collection | Custom `page.evaluate()` DOM walk, not Playwright's `accessibility.snapshot()`/`ariaSnapshot()` | Full control over a flat, bounded, serializable shape rather than that API's own nested tree — same practical role/name signal without depending on its exact structure |
| Locator ambiguity | An N>1 match is treated as a miss and falls through to the next strategy | Acting on one of several ambiguous matches risks silently clicking the wrong element — safer to require a strategy that actually resolves uniquely |
| Session lifecycle | One browser/page per `Surface` instance, created once in `createPlaywrightSurface()`, reused for every call | Phase 7 (replay) and Phase 8 (handoff) need the same live session across many actions, not a fresh one per call |
| Artifact schema strictness | `validateArtifact()` rejects unknown top-level keys (exhaustive allowlist) rather than ignoring them | Makes "no raw LLM transcript in an artifact" a structural guarantee instead of a convention; also catches typos/drift early |
| Parameter reference syntax | Plain `{{name}}` tokens in ordinary strings, matched wherever they appear (whole-value or embedded) — not a templating library, not JSON Schema `$ref` | Human-readable in a raw JSON diff on GitHub; embedding is required for precise checkpoints like `"/members/{{memberId}}"`, not just whole-value substitution |
| Locator type reuse | `src/artifact` imports `Locator` from `surface/types` rather than redefining an equivalent shape | One vocabulary for "how to find a control," used identically by whatever eventually resolves it (Surface today, replay engine tomorrow) — avoids two schemas silently drifting apart |
| Artifact store validates on both save and load | Single validation code path, not "trust what's on disk" | A hand-edited or corrupted artifact file fails loudly on `load()`, not silently at replay time three steps in |
| `open-sub-account` outputs | Deliberately empty (`outputs: []`) | The brief explicitly cautions against inventing outputs; the confirmation page's account number isn't uniquely locatable without a fragile structural CSS selector, so the checkpoint alone is the result for this capability — revisit if Phase 6/7 need the generated account ID back |
| Replay failure taxonomy | Eleven specific statuses (`target_not_found`, `navigation_failed`, `checkpoint_mismatch`, `timeout`, ...) rather than one generic "failure" | A caller (or a human reading evidence) can tell *why* a replay failed without parsing a message string; each status traces back to one real cause |
| Replay `businessOutcomes` matching | Not implemented in Phase 7, despite earlier planning anticipating it | The approved Phase 7 brief's required failure taxonomy didn't include it; implementing it unasked would have been scope creep beyond "implement ONLY Phase 7" — the schema/data already exist, unused by `replayArtifact()` today |
| Replay evidence keeps its own artifact snapshot | `evidence/replay/<run-id>/artifact.json` is a frozen copy, not a reference to `artifacts/*.json` | `artifacts/*.json` can be overwritten by a later discovery run (as literally happened to `get-savings-balance.json` between Phase 5 and Phase 6); evidence must stay accurate to what actually ran, permanently |
| Replay artifact loading | `runReplay()` reads the artifact file directly rather than through `ArtifactStore.load()` | `ArtifactStore.load()` throws on an invalid/missing file; replay needs a structured `{status: "invalid_artifact"}` result even for a missing file, so a deliberately invalid placeholder is fed through the one `validateArtifact()` path inside `replayArtifact()` instead |

## What Phase 2 actually established

To be concrete about where the line between "designed" and "built"
currently sits: Phase 2 created the module boundaries above as
placeholders with the agreed-on function/type signatures, a working
Express + EJS entry point serving a health check, SQLite connection
plumbing with no schema, and the build/test tooling to develop the rest
of the system against. It did not implement any of the behavior described
in this document.

## What Phase 4 actually established

`src/surface/{types.ts, index.ts, playwright-surface.ts}` — the full
Surface interface and its Chromium-backed implementation, exactly as
described in "Computer-use Surface abstraction" above. `src/safety/index.ts`
required one small, mechanical fix as a direct consequence: it previously
imported an `Action` union type from `src/surface` that no longer exists
under the new named-methods interface; its placeholder `authorize()`
method now takes `unknown` instead, with a comment explaining why —
PolicyGuard's real parameter shape is still Phase 8's design decision to
make, not something Phase 4 should guess at. No other module referenced
the old surface types, and nothing else in this document changed —
`src/artifact`, `src/agent`, `src/replay`, `src/handoff`, and
`src/evidence` remain exactly the Phase 2 placeholders described above.

## What Phase 5 actually established


`src/artifact/{types.ts, validate.ts, serialize.ts, store.ts, index.ts}`
— the full artifact schema, strict validation, JSON serialization, and
the filesystem store, exactly as described in "Structured artifact
contract" above. `artifacts/get-savings-balance.json` and
`artifacts/open-sub-account.json` are the two committed, manually
authored reference artifacts (real routes, real locators, real
button/label text from the actual running app) — not LLM-discovery
output, which is Phase 6's job. The old `src/artifact/index.ts`
placeholder (a different, simpler `Artifact` shape with `loadArtifact`/
`saveArtifact` stubs that threw) was fully replaced; nothing else
depended on its exact field names, only its `Artifact` type name as a
type annotation on still-throwing placeholders in `src/agent` and
`src/replay`, which continue to compile unchanged. `src/surface`,
`src/app` were not touched. `src/agent`, `src/replay`, `src/safety`,
`src/handoff`, and `src/evidence` remain exactly the Phase 2 placeholders
described above.

## What Phase 6 actually established

`src/agent/{types.ts, observe.ts, validate-action.ts, llm-client.ts,
loop.ts, compile-artifact.ts, evidence.ts, index.ts}` — the full LLM
discovery loop, forced-tool-calling Anthropic client, deterministic
artifact compiler, and discovery evidence writer, exactly as described in
"LLM discovery agent" above. The old `src/agent/index.ts` placeholder
(`runDiscovery(goal): Promise<Artifact>`, which assumed every call
succeeds) was fully replaced by `runDiscovery(goal, config,
dependencies?): Promise<DiscoveryResult>`, which represents failure as a
first-class outcome instead of an exception. `artifacts/get-savings-balance.json`
was overwritten by real discovery output for the first time — the
committed file at that path is no longer the Phase 5 hand-authored
example; `artifacts/open-sub-account.json` is unchanged (still Phase 5's
hand-authored example — a real discovery run for it wasn't attempted this
phase). `src/surface`, `src/artifact`, `src/app` were not touched.
`src/replay`, `src/safety`, `src/handoff`, and `src/evidence` remain
exactly the Phase 2 placeholders described above.

## What Phase 7 actually established

`src/replay/{types.ts, substitute.ts, checkpoint.ts, engine.ts,
evidence.ts, index.ts}` — the full deterministic replay engine, exactly
as described in "Deterministic replay engine" above. The old
`src/replay/index.ts` placeholder (a `replay(artifact, params)` stub with
its own, different `ReplayResult` shape distinguishing
`success`/`business_outcome`/`failure`) was fully replaced; nothing else
depended on its exact shape, only the fact that `src/agent`'s and
`src/handoff`'s own placeholders imported an `Artifact` type from
`src/artifact` directly, never anything from `src/replay`, so neither
needed to change. `src/surface`, `src/artifact`, `src/agent`, `src/app`
were not touched — `replayArtifact()` reuses `Surface` and
`validateArtifact()` exactly as they already existed, no changes required
to either. `src/safety`, `src/handoff`, and `src/evidence` remain exactly
the Phase 2 placeholders described above.
