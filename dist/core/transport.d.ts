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
export declare class Transport extends MemoryTransport {
    constructor(config: TransportConfig);
}
