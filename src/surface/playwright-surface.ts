import { chromium, type Browser, type Page, type Locator as PlaywrightLocator } from "playwright";
import type {
  Surface,
  Locator,
  LocatorStrategy,
  Observation,
  ObservedElement,
  SurfaceResult,
} from "./types";

export interface PlaywrightSurfaceOptions {
  headless?: boolean;
  /** Per-action timeout in milliseconds. Not a sleep — bounds Playwright's own auto-waiting. */
  defaultTimeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_OBSERVED_ELEMENTS = 200;
const MAX_TEXT_SNAPSHOT_LENGTH = 5_000;

const INTERACTIVE_SELECTOR = [
  "a[href]",
  "button",
  "input",
  "select",
  "textarea",
  "[role='button']",
  "[role='link']",
  "[role='textbox']",
  "[role='checkbox']",
  "[role='radio']",
].join(", ");

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function describeLocator(locator: Locator): string {
  const parts = locator.strategies.map((s) => {
    switch (s.type) {
      case "role":
        return `role=${s.role} name="${s.name}"`;
      case "label":
        return `label="${s.text}"`;
      case "text":
        return `text="${s.text}"`;
      case "attribute":
        return `${s.attribute}="${s.value}"`;
      case "css":
        return `css=${s.selector}`;
    }
  });
  const joined = parts.join(" | ");
  return locator.description ? `${locator.description} (${joined})` : joined;
}

function buildPlaywrightLocator(page: Page, strategy: LocatorStrategy): PlaywrightLocator {
  switch (strategy.type) {
    case "role":
      return page.getByRole(strategy.role as Parameters<Page["getByRole"]>[0], {
        name: strategy.name,
        exact: false,
      });
    case "label":
      return page.getByLabel(strategy.text, { exact: false });
    case "text":
      return page.getByText(strategy.text, { exact: strategy.exact ?? false });
    case "attribute":
      return page.locator(`[${strategy.attribute}="${strategy.value.replace(/"/g, '\\"')}"]`);
    case "css":
      return page.locator(strategy.selector);
  }
}

/**
 * DOM-based, accessibility-first element collection. Runs entirely inside
 * the page via evaluate() so only plain, serializable data crosses back —
 * never a DOM/CDP handle. Role and accessible-name computation here are a
 * deliberately simple approximation of the real accessibility tree (label
 * association, aria-label/aria-labelledby, then text/placeholder), which
 * is sufficient for role+name based locators without a clean DOM.
 */
// NOTE: this callback is serialized via Function.prototype.toString() and
// shipped into the browser sandbox by Playwright — only its own source
// text arrives there, not the rest of this module. Nested *named function
// declarations* here can trigger esbuild (via tsx) to emit a `__name()`
// helper call that only exists in the Node-side bundle, producing
// "ReferenceError: __name is not defined" inside the browser at runtime
// (this reproduced when run via `tsx`, though not under Vitest's own
// transform). Every helper below is therefore a plain arrow function
// assigned to a local const, and everything stays inside one flat
// function body — no nested declarations for Playwright to serialize
// incompletely.
async function collectObservedElements(page: Page): Promise<ObservedElement[]> {
  return page.evaluate(
    ({ selector, max }) => {
      const computeAccessibleName = (el: Element): string => {
        const ariaLabel = el.getAttribute("aria-label");
        if (ariaLabel) return ariaLabel.trim();

        const labelledBy = el.getAttribute("aria-labelledby");
        if (labelledBy) {
          const labelText = labelledBy
            .split(/\s+/)
            .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
            .filter(Boolean)
            .join(" ");
          if (labelText) return labelText;
        }

        const id = el.id;
        if (id) {
          const label = document.querySelector(`label[for="${CSS.escape(id)}"]`);
          if (label?.textContent) return label.textContent.trim();
        }

        const closestLabel = el.closest("label");
        if (closestLabel?.textContent) return closestLabel.textContent.trim();

        const tag = el.tagName.toLowerCase();
        if (tag === "input" || tag === "textarea") {
          const placeholder = el.getAttribute("placeholder");
          if (placeholder) return placeholder.trim();
        }

        return el.textContent?.trim() ?? "";
      };

      const computeRole = (el: Element): string => {
        const explicitRole = el.getAttribute("role");
        if (explicitRole) return explicitRole;

        const tag = el.tagName.toLowerCase();
        if (tag === "a") return "link";
        if (tag === "button") return "button";
        if (tag === "select") return "combobox";
        if (tag === "textarea") return "textbox";
        if (tag === "input") {
          const type = (el as HTMLInputElement).type;
          if (type === "submit" || type === "button") return "button";
          if (type === "checkbox") return "checkbox";
          if (type === "radio") return "radio";
          return "textbox";
        }
        return tag;
      };

      const elements = Array.from(document.querySelectorAll(selector)).slice(0, max);

      return elements.map((el, index) => {
        const tag = el.tagName.toLowerCase();
        const isFormField = tag === "input" || tag === "textarea" || tag === "select";
        const value = isFormField
          ? (el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value
          : undefined;
        const disabled = (el as HTMLInputElement).disabled === true;

        return {
          ref: `e${index}`,
          role: computeRole(el),
          name: computeAccessibleName(el),
          value,
          editable: isFormField && !disabled,
        };
      });
    },
    { selector: INTERACTIVE_SELECTOR, max: MAX_OBSERVED_ELEMENTS },
  );
}

async function collectVisibleText(page: Page): Promise<string> {
  const text = await page.evaluate(() => document.body.innerText);
  return text.length > MAX_TEXT_SNAPSHOT_LENGTH ? text.slice(0, MAX_TEXT_SNAPSHOT_LENGTH) : text;
}

async function readElementValue(locator: PlaywrightLocator): Promise<string> {
  const tag = await locator.evaluate((el) => el.tagName.toLowerCase());
  if (tag === "input" || tag === "textarea" || tag === "select") {
    return locator.inputValue();
  }
  const text = await locator.textContent();
  return (text ?? "").trim();
}

/**
 * Creates a live Surface backed by a single Playwright Chromium browser +
 * page, launched once here and reused for every subsequent call — see
 * Surface's docstring on why the session must not be recreated per action.
 */
export async function createPlaywrightSurface(
  options: PlaywrightSurfaceOptions = {},
): Promise<Surface> {
  const browser: Browser = await chromium.launch({ headless: options.headless ?? true });
  const page: Page = await browser.newPage();
  const timeoutMs = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  page.setDefaultTimeout(timeoutMs);

  // page.evaluate() ships a callback to the browser as raw source text
  // (Function.prototype.toString()) — only that text arrives, nothing
  // else from this module. Depending on how this project is run (tsx vs.
  // Vitest use different esbuild transforms), the compiled callback can
  // reference esbuild's own __name() helper (used to preserve fn.name),
  // which never travels with the shipped source and throws
  // "ReferenceError: __name is not defined" inside the browser. This
  // no-op shim — behaviorally identical to esbuild's helper, it just
  // returns fn unchanged — makes every evaluate() call in this file
  // resilient to that regardless of which transform compiled it.
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    if (typeof w.__name !== "function") {
      w.__name = (fn: unknown) => fn;
    }
  });

  let closed = false;

  async function observeInternal(): Promise<Observation> {
    const [elements, text] = await Promise.all([
      collectObservedElements(page),
      collectVisibleText(page),
    ]);
    return {
      url: page.url(),
      title: await page.title().catch(() => ""),
      elements,
      text,
    };
  }

  async function safeObservation(): Promise<Observation | undefined> {
    try {
      return await observeInternal();
    } catch {
      return undefined;
    }
  }

  async function resolve(
    locator: Locator,
  ): Promise<{ playwrightLocator: PlaywrightLocator; strategy: LocatorStrategy } | null> {
    for (const strategy of locator.strategies) {
      const candidate = buildPlaywrightLocator(page, strategy);
      try {
        const count = await candidate.count();
        if (count === 1) {
          return { playwrightLocator: candidate, strategy };
        }
        // 0 matches: try the next strategy. >1 matches: ambiguous — also
        // try the next, more specific strategy rather than guessing.
      } catch {
        // Strategy unusable in the current page state — try the next one.
      }
    }
    return null;
  }

  function closedError<T>(): SurfaceResult<T> {
    return { ok: false, error: { code: "SESSION_CLOSED", message: "Surface session has been closed." } };
  }

  async function elementNotFoundError<T>(locator: Locator): Promise<SurfaceResult<T>> {
    return {
      ok: false,
      error: {
        code: "ELEMENT_NOT_FOUND",
        message: `No unique element resolved for locator: ${describeLocator(locator)}`,
        observation: await safeObservation(),
      },
    };
  }

  const surface: Surface = {
    async navigate(url) {
      if (closed) return closedError();
      try {
        await page.goto(url, { waitUntil: "load", timeout: timeoutMs });
        return { ok: true, value: { url: page.url() } };
      } catch (err) {
        return { ok: false, error: { code: "NAVIGATION_FAILED", message: describeError(err) } };
      }
    },

    async observe() {
      if (closed) return closedError();
      try {
        return { ok: true, value: await observeInternal() };
      } catch (err) {
        return { ok: false, error: { code: "UNKNOWN", message: describeError(err) } };
      }
    },

    async click(locator) {
      if (closed) return closedError();
      const resolved = await resolve(locator);
      if (!resolved) return elementNotFoundError(locator);
      try {
        await resolved.playwrightLocator.click({ timeout: timeoutMs });
        return { ok: true, value: undefined };
      } catch (err) {
        return {
          ok: false,
          error: { code: "TIMEOUT", message: describeError(err), observation: await safeObservation() },
        };
      }
    },

    async type(locator, text) {
      if (closed) return closedError();
      const resolved = await resolve(locator);
      if (!resolved) return elementNotFoundError(locator);
      try {
        await resolved.playwrightLocator.fill(text, { timeout: timeoutMs });
        return { ok: true, value: undefined };
      } catch (err) {
        return {
          ok: false,
          error: { code: "TIMEOUT", message: describeError(err), observation: await safeObservation() },
        };
      }
    },

    async read(locator) {
      if (closed) return closedError();
      const resolved = await resolve(locator);
      if (!resolved) return elementNotFoundError(locator);
      try {
        const value = await readElementValue(resolved.playwrightLocator);
        return { ok: true, value };
      } catch (err) {
        return {
          ok: false,
          error: { code: "UNKNOWN", message: describeError(err), observation: await safeObservation() },
        };
      }
    },

    async screenshot() {
      if (closed) return closedError();
      try {
        const buffer = await page.screenshot({ type: "png" });
        return { ok: true, value: { base64: buffer.toString("base64") } };
      } catch (err) {
        return { ok: false, error: { code: "UNKNOWN", message: describeError(err) } };
      }
    },

    async close() {
      if (closed) return;
      closed = true;
      await browser.close();
    },
  };

  return surface;
}
