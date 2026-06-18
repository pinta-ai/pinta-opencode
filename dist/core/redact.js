// Pure re-export of the shared redaction/truncation pipeline in @pinta-ai/core.
// opencode's copy was byte-identical, so this module just re-exposes the same
// public API the rest of the adaptor (and tests) import from "./redact.js".
export { redact, truncate, collectMatches, resolveOverlaps, applyMatches, PATTERNS, MAX_BYTES, } from "@pinta-ai/core";
//# sourceMappingURL=redact.js.map