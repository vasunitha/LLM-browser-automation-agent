/**
 * Computer-use / browser layer — public interface (Phase 4).
 *
 * This is the only module the rest of the system should depend on for
 * driving a live UI surface. It has zero dependency on Playwright (or any
 * other automation engine) — that's the seam that would let a different
 * implementation (a different browser engine, or eventually a desktop
 * surface) satisfy the same interface without touching callers. Only
 * playwright-surface.ts is allowed to import the "playwright" package.
 */

/** One way to identify an element, tried as part of an ordered fallback chain. */
export type LocatorStrategy =
  | { type: "role"; role: string; name: string }
  | { type: "label"; text: string }
  | { type: "text"; text: string; exact?: boolean }
  | { type: "attribute"; attribute: string; value: string }
  | { type: "css"; selector: string };

/**
 * How to find a single element on the page. Strategies are tried in
 * order; the first one that resolves to exactly one element wins. Put the
 * most robust strategy first — role/name, then label, then visible text,
 * then a stable attribute — and fall back to raw CSS only when nothing
 * more semantic is available.
 */
export interface Locator {
  strategies: LocatorStrategy[];
  /** Human-readable description, used in error messages and (later) evidence. */
  description?: string;
}

/** One interactive element as seen in the current observation. */
export interface ObservedElement {
  /** Opaque reference within this single observation — not a durable locator. */
  ref: string;
  role: string;
  name: string;
  value?: string;
  editable?: boolean;
}

/**
 * A compact, deliberate snapshot of the current page — enough for a future
 * LLM to decide what to do next, without forwarding raw browser internals
 * (full DOM, CDP objects, etc.) anywhere outside this module.
 */
export interface Observation {
  url: string;
  title: string;
  /** Interactive controls currently on the page (bounded — see playwright-surface.ts). */
  elements: ObservedElement[];
  /** Compact visible-text rendering of the page, for reading labels/results. */
  text: string;
}

export type SurfaceErrorCode =
  | "ELEMENT_NOT_FOUND"
  | "NAVIGATION_FAILED"
  | "TIMEOUT"
  | "SESSION_CLOSED"
  | "UNKNOWN"
  /**
   * A mutating action (navigate to a non-allowlisted URL, or click/type
   * without required approval) was refused by the Phase 8 PolicyGuard
   * before Playwright ever touched it — see src/safety/policy-surface.ts.
   * Kept in this same closed union (rather than a separate error type)
   * so every existing caller that switches on SurfaceErrorCode already
   * has to handle it via its `default` case, no silent gaps.
   */
  | "POLICY_BLOCKED";

export interface SurfaceError {
  code: SurfaceErrorCode;
  message: string;
  /** Best-effort page snapshot at the time of failure, for debugging. */
  observation?: Observation;
}

export type SurfaceResult<T> = { ok: true; value: T } | { ok: false; error: SurfaceError };

/**
 * The one abstraction between the agent/replay engine and a concrete UI
 * surface. A single Surface instance wraps one live browser session for
 * its whole lifetime (create once, act many times, close once) — later
 * phases (replay, human handoff) depend on that same session staying
 * alive across many calls, not a fresh one per action.
 */
export interface Surface {
  navigate(url: string): Promise<SurfaceResult<{ url: string }>>;
  observe(): Promise<SurfaceResult<Observation>>;
  click(locator: Locator): Promise<SurfaceResult<void>>;
  type(locator: Locator, text: string): Promise<SurfaceResult<void>>;
  read(locator: Locator): Promise<SurfaceResult<string>>;
  screenshot(): Promise<SurfaceResult<{ base64: string }>>;
  /** Releases the underlying browser session. Safe to call once when done. */
  close(): Promise<void>;
}
