import { Transport } from "./core/transport.js";
import { TraceManager } from "./core/trace.js";
import type { GuardResult } from "./core/guard.js";
import type { ResolvedConfig } from "./config.js";
export interface OpencodeEvent {
    id?: string;
    type?: string;
    properties?: Record<string, unknown>;
}
export interface ToolBeforeInput {
    tool: string;
    sessionID: string;
    callID: string;
}
export interface ToolAfterOutput {
    title?: string;
    output?: unknown;
    metadata?: Record<string, unknown>;
}
/**
 * Maps opencode hook payloads to OTLP spans (verified payload shapes — SPEC §5).
 * Tool spans are built from tool.execute.before/after (richer: args, output,
 * exit) rather than the event bus; `event` covers lifecycle + turn boundaries.
 */
export declare class Telemetry {
    private transport;
    private trace;
    private config;
    constructor(transport: Transport, trace: TraceManager, config: ResolvedConfig);
    private emit;
    /** Lifecycle span from the `event` hook. Flushes the retry buffer on turn-END. */
    lifecycle(ev: OpencodeEvent): Promise<void>;
    /** Tool span from `tool.execute.before`, carrying the guard decision. */
    toolBefore(input: ToolBeforeInput, args: unknown, guard: GuardResult | null): Promise<void>;
    /** Tool result span from `tool.execute.after`, incl. exit code / truncation. */
    toolAfter(input: ToolBeforeInput, output: ToolAfterOutput): Promise<void>;
}
