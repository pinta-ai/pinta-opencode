// opencode-specific binding over the shared MemoryTransport in @pinta-ai/core.
// The plugin is long-lived and in-process, so this uses the IN-MEMORY transport
// (failed payloads buffered and re-sent batched on the next flush — never
// persisted to disk). Endpoint/headers are resolved from the init-time config
// passed to the constructor, NOT from late process.env reads: we hand the
// transport a resolveOptions closure that returns the captured config (or null
// to silently disable when no endpoint was configured).
import { MemoryTransport } from "@pinta-ai/core";

export interface TransportConfig {
  /** Full OTLP/HTTP traces URL. Undefined → telemetry silently disabled. */
  endpoint?: string;
  headers: Record<string, string>;
}

/**
 * Best-effort OTLP/HTTP transport with an in-memory retry buffer. Never throws;
 * failures are buffered and re-sent (batched) on the next event. Silent-disable
 * when no endpoint is configured.
 */
export class Transport extends MemoryTransport {
  constructor(config: TransportConfig) {
    super({
      logPrefix: "pinta-opencode",
      resolveOptions: () =>
        config.endpoint ? { endpoint: config.endpoint, headers: config.headers } : null,
    });
  }
}
