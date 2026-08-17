/**
 * An in-memory fake Surface used by Phase 6 agent tests. Simulates just
 * enough of the get-savings-balance flow (search page -> member details)
 * to exercise the discovery loop without Playwright or a live server —
 * see ARCHITECTURE.md's "LLM discovery architecture" section for why
 * loop.ts is written against the Surface *interface* specifically so this
 * substitution is possible.
 */
import type { Locator, Observation, Surface, SurfaceResult } from "../../../src/surface/types";

// A valid, minimal 1x1 transparent PNG — real bytes, not a placeholder
// string, so evidence.ts's screenshot-writing path is exercised for real.
export const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function closedError<T>(): SurfaceResult<T> {
  return { ok: false, error: { code: "SESSION_CLOSED", message: "Fake surface session has been closed." } };
}

function isMemberIdField(locator: Locator): boolean {
  return locator.strategies.some(
    (s) => (s.type === "role" && s.role === "textbox" && s.name === "Member ID") || (s.type === "label" && s.text === "Member ID"),
  );
}

function isSearchButton(locator: Locator): boolean {
  return locator.strategies.some((s) => s.type === "role" && s.role === "button" && s.name === "Search");
}

function isBalanceValue(locator: Locator): boolean {
  return locator.strategies.some((s) => s.type === "css" && s.selector === "strong");
}

export interface FakeSurfaceOptions {
  baseUrl?: string;
  memberId?: string;
  balance?: string;
}

/**
 * Simulates: navigate("/") -> search page; type Member ID + click Search
 * -> member details page with a savings balance readable via {type:"css",
 * selector:"strong"} (the same locator the real app's own committed
 * artifacts use). Any other click/type/read is reported as
 * ELEMENT_NOT_FOUND, the same as the real PlaywrightSurface would for an
 * unresolvable locator.
 */
export function createFakeSurface(options: FakeSurfaceOptions = {}): Surface {
  const baseUrl = options.baseUrl ?? "http://localhost:3000";
  const memberId = options.memberId ?? "1001";
  const balance = options.balance ?? "$482.17";

  let page: "search" | "details" = "search";
  let closed = false;

  const searchObservation: Observation = {
    url: `${baseUrl}/`,
    title: "Credit Union Teller Console",
    elements: [
      { ref: "e0", role: "textbox", name: "Member ID", value: "", editable: true },
      { ref: "e1", role: "button", name: "Search", editable: true },
    ],
    text: "Credit Union Teller Console\nMember ID\nSearch",
  };

  const detailsObservation: Observation = {
    url: `${baseUrl}/members/${memberId}`,
    title: "Member Details",
    elements: [{ ref: "e0", role: "link", name: "Open Sub-Account", editable: true }],
    text: `Member details loaded successfully.\nMember ${memberId}\nSavings Balance: ${balance}`,
  };

  const surface: Surface = {
    async navigate(url) {
      if (closed) return closedError();
      page = url.includes("/members/") ? "details" : "search";
      return { ok: true, value: { url } };
    },

    async observe() {
      if (closed) return closedError();
      return { ok: true, value: page === "details" ? detailsObservation : searchObservation };
    },

    async click(locator) {
      if (closed) return closedError();
      if (isSearchButton(locator)) {
        page = "details";
        return { ok: true, value: undefined };
      }
      return {
        ok: false,
        error: { code: "ELEMENT_NOT_FOUND", message: `No unique element resolved for locator.` },
      };
    },

    async type(locator, _text) {
      if (closed) return closedError();
      if (isMemberIdField(locator)) {
        return { ok: true, value: undefined };
      }
      return {
        ok: false,
        error: { code: "ELEMENT_NOT_FOUND", message: `No unique element resolved for locator.` },
      };
    },

    async read(locator) {
      if (closed) return closedError();
      if (page === "details" && isBalanceValue(locator)) {
        return { ok: true, value: balance };
      }
      return {
        ok: false,
        error: { code: "ELEMENT_NOT_FOUND", message: `No unique element resolved for locator.` },
      };
    },

    async screenshot() {
      if (closed) return closedError();
      return { ok: true, value: { base64: TINY_PNG_BASE64 } };
    },

    async close() {
      closed = true;
    },
  };

  return surface;
}

/** A Surface whose every acting method (click/type/read) fails with ELEMENT_NOT_FOUND — useful for max-step/recoverable-error tests. */
export function createAlwaysFailingSurface(): Surface {
  let closed = false;
  const observation: Observation = {
    url: "http://localhost:3000/",
    title: "Credit Union Teller Console",
    elements: [{ ref: "e0", role: "textbox", name: "Member ID", value: "", editable: true }],
    text: "Credit Union Teller Console",
  };

  return {
    async navigate(url) {
      if (closed) return closedError();
      return { ok: true, value: { url } };
    },
    async observe() {
      if (closed) return closedError();
      return { ok: true, value: observation };
    },
    async click() {
      if (closed) return closedError();
      return { ok: false, error: { code: "ELEMENT_NOT_FOUND", message: "No unique element resolved." } };
    },
    async type() {
      if (closed) return closedError();
      return { ok: false, error: { code: "ELEMENT_NOT_FOUND", message: "No unique element resolved." } };
    },
    async read() {
      if (closed) return closedError();
      return { ok: false, error: { code: "ELEMENT_NOT_FOUND", message: "No unique element resolved." } };
    },
    async screenshot() {
      if (closed) return closedError();
      return { ok: true, value: { base64: TINY_PNG_BASE64 } };
    },
    async close() {
      closed = true;
    },
  };
}

/** A Surface whose next click() reports SESSION_CLOSED — the one Surface error loop.ts treats as unrecoverable. */
export function createSessionClosedOnClickSurface(): Surface {
  const base = createAlwaysFailingSurface();
  return {
    ...base,
    async click() {
      return { ok: false, error: { code: "SESSION_CLOSED", message: "Session was closed unexpectedly." } };
    },
  };
}
