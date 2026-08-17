/**
 * Runtime parameter substitution for replay (Phase 7).
 *
 * Resolves every well-formed "{{name}}" reference in a ParamValue string
 * against caller-supplied runtime inputs — the same token syntax
 * src/artifact/validate.ts already validates artifacts against (see
 * PARAM_REF_TOKEN there), applied here for real substitution instead of
 * just validation. Kept as its own tiny, dependency-free module rather
 * than imported from src/artifact/validate.ts, which doesn't export its
 * regex — duplicating five characters of regex is cheaper than coupling
 * replay's substitution behavior to artifact's validation internals.
 */
const PARAM_REF_TOKEN = /\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g;

/** Replaces every "{{name}}" token with inputs[name]. A token whose name isn't supplied is left as-is (defensive — replayArtifact() already guarantees every declared input is resolved before this runs). */
export function substituteParams(value: string, inputs: Record<string, string>): string {
  return value.replace(PARAM_REF_TOKEN, (token, name: string) =>
    Object.prototype.hasOwnProperty.call(inputs, name) ? inputs[name] : token,
  );
}
