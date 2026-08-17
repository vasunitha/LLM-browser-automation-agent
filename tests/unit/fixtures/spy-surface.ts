import type { Surface } from "../../../src/surface/types";

export interface RecordedCall {
  method: keyof Surface;
  args: unknown[];
}

/** Wraps a Surface, recording every call made through it — proves a caller (e.g. the replay engine) actually drove the given Surface rather than bypassing it. */
export function wrapSurfaceWithSpy(surface: Surface): { surface: Surface; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];

  const spy: Surface = {
    async navigate(url) {
      calls.push({ method: "navigate", args: [url] });
      return surface.navigate(url);
    },
    async observe() {
      calls.push({ method: "observe", args: [] });
      return surface.observe();
    },
    async click(locator) {
      calls.push({ method: "click", args: [locator] });
      return surface.click(locator);
    },
    async type(locator, text) {
      calls.push({ method: "type", args: [locator, text] });
      return surface.type(locator, text);
    },
    async read(locator) {
      calls.push({ method: "read", args: [locator] });
      return surface.read(locator);
    },
    async screenshot() {
      calls.push({ method: "screenshot", args: [] });
      return surface.screenshot();
    },
    async close() {
      calls.push({ method: "close", args: [] });
      return surface.close();
    },
  };

  return { surface: spy, calls };
}
