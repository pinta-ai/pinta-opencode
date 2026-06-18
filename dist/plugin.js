import { resolveConfig } from "./config.js";
import { Transport } from "./core/transport.js";
import { TraceManager } from "./core/trace.js";
import { evaluateGuard } from "./core/guard.js";
import { Telemetry } from "./telemetry.js";
function warn(scope, err) {
    process.stderr.write(`[pinta-opencode] ${scope}: ${err?.message ?? String(err)}\n`);
}
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
export const PintaOpencode = async (_input, options) => {
    const config = resolveConfig(options ?? {});
    const transport = new Transport({ endpoint: config.endpoint, headers: config.headers });
    const trace = new TraceManager();
    const telemetry = new Telemetry(transport, trace, config);
    return {
        // turn-START → rotate a new trace for this session.
        "chat.message": async (input) => {
            try {
                trace.newTrace(input?.sessionID);
            }
            catch (err) {
                warn("chat.message", err);
            }
        },
        // lifecycle telemetry; flushes the retry buffer on session.idle (turn-END).
        event: async (input) => {
            try {
                if (input?.event)
                    await telemetry.lifecycle(input.event);
            }
            catch (err) {
                warn("event", err);
            }
        },
        // ★ governance gate: guard query → DENY throws (blocks just this tool).
        "tool.execute.before": async (input, output) => {
            let guard = null;
            try {
                guard = await evaluateGuard({
                    spanId: input.sessionID,
                    toolName: input.tool,
                    toolInput: output?.args,
                    rawTextFields: { toolInput: safeStringify(output?.args) },
                }, config.guardEndpoint, { timeoutMs: config.guardTimeoutMs, token: config.relayToken, disabled: config.guardDisabled });
                await telemetry.toolBefore(input, output?.args, guard);
            }
            catch (err) {
                warn("tool.execute.before", err); // telemetry/guard infra errors are fail-open
            }
            if (guard?.decision === "DENY") {
                throw new Error(guard.userMessage ?? guard.reason ?? "guard_deny");
            }
        },
        // tool-result telemetry.
        "tool.execute.after": async (input, output) => {
            try {
                await telemetry.toolAfter(input, output);
            }
            catch (err) {
                warn("tool.execute.after", err);
            }
        },
    };
};
function safeStringify(v) {
    try {
        return typeof v === "string" ? v : JSON.stringify(v) ?? "";
    }
    catch {
        return String(v);
    }
}
export default PintaOpencode;
//# sourceMappingURL=plugin.js.map