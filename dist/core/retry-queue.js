// opencode uses the in-memory retry buffer from @pinta-ai/core. The plugin is a
// long-lived in-process module (verified H-C1), so failed OTLP payloads are
// buffered in memory and flushed on the next event — never persisted to disk.
// core's MemoryRetryQueue is byte-identical to opencode's historical RetryQueue
// (same enqueue/drain/size, MAX_ENTRIES cap), so we alias it.
export { MemoryRetryQueue as RetryQueue } from "@pinta-ai/core";
//# sourceMappingURL=retry-queue.js.map