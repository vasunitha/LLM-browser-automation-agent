/**
 * Compacts a Surface Observation down to what's actually useful in an LLM
 * prompt (Phase 6). The Surface's own Observation is already bounded (200
 * elements, 5,000 chars of text — see ARCHITECTURE.md's "Observation
 * contract"), but a multi-step discovery prompt re-sends this on every
 * iteration, so it's trimmed further here: only elements with a
 * meaningful accessible name are useful for building a role/name locator,
 * and visible text rarely needs more than the first ~1,200 characters to
 * tell the model what state the page is in.
 */
import type { Observation } from "../surface/types";
import type { ObservationControlSummary, ObservationSummary } from "./types";

const MAX_CONTROLS = 40;
const MAX_TEXT_LENGTH = 1_200;

export function summarizeObservation(observation: Observation): ObservationSummary {
  const controls: ObservationControlSummary[] = observation.elements
    .filter((el) => el.name.trim() !== "")
    .slice(0, MAX_CONTROLS)
    .map((el) => ({
      role: el.role,
      name: el.name,
      ...(el.value !== undefined ? { value: el.value } : {}),
      ...(el.editable !== undefined ? { editable: el.editable } : {}),
    }));

  const visibleText =
    observation.text.length > MAX_TEXT_LENGTH
      ? `${observation.text.slice(0, MAX_TEXT_LENGTH)}…`
      : observation.text;

  return {
    url: observation.url,
    title: observation.title,
    controls,
    visibleText,
  };
}
