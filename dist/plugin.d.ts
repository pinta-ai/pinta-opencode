import { type PintaOptions } from "./config.js";
import { type OpencodeEvent, type ToolBeforeInput, type ToolAfterOutput } from "./telemetry.js";
/**
 * pinta-opencode plugin entry. opencode invokes this once per instance with
 * `(input, options)` and keeps the returned hooks for the instance lifetime
 * (verified H-C1), so config + transport + trace state live in this closure.
 *
 * - Telemetry (event / tool.execute.after): best-effort OTLP, never blocks.
 * - Governance (tool.execute.before): guard query; DENY → throw(reason), which
 *   blocks only that tool and surfaces the reason to the model (verified H-A1).
 *
 * Fail-open invariant: every telemetry/guard error is swallowed; the only
 * intentional throw is a guard DENY.
 */
export declare const PintaOpencode: (_input: unknown, options?: PintaOptions) => Promise<{
    "chat.message": (input: {
        sessionID?: string;
    }) => Promise<void>;
    event: (input: {
        event?: OpencodeEvent;
    }) => Promise<void>;
    "tool.execute.before": (input: ToolBeforeInput, output: {
        args: unknown;
    }) => Promise<void>;
    "tool.execute.after": (input: ToolBeforeInput, output: ToolAfterOutput) => Promise<void>;
}>;
export default PintaOpencode;
