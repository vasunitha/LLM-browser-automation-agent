/**
 * Computer-use / browser layer module boundary (Phase 4).
 *
 * Import from here, not from ./types or ./playwright-surface directly.
 * Everything re-exported below is Playwright-free except
 * createPlaywrightSurface itself (a factory, not a type) — see types.ts
 * for the actual interface contract and playwright-surface.ts for the one
 * file in this module allowed to import the "playwright" package.
 */
export type {
  Surface,
  Locator,
  LocatorStrategy,
  ObservedElement,
  Observation,
  SurfaceError,
  SurfaceErrorCode,
  SurfaceResult,
} from "./types";

export { createPlaywrightSurface } from "./playwright-surface";
export type { PlaywrightSurfaceOptions } from "./playwright-surface";
