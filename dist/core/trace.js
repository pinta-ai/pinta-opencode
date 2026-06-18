// opencode-specific trace correlation. Unlike the short-lived hook adapters
// (whose TraceManager persists one trace id to disk), opencode is a long-lived
// in-process plugin, so traces live in an in-memory map keyed by sessionID for
// the instance lifetime — no file persistence. This is now the shared
// MemorySessionTraceManager from @pinta-ai/core, which matches opencode's
// requirements exactly (Map keyed by sessionID, default "default" key,
// FIFO cap at 200). Instantiated no-arg (`new TraceManager()`), and the
// optional `{ maxSessions? }` constructor arg is compatible with that.
export { MemorySessionTraceManager as TraceManager } from "@pinta-ai/core";
//# sourceMappingURL=trace.js.map