import { resolveConfig } from "./config.js";
import { Transport } from "./core/transport.js";
import { TraceManager } from "./core/trace.js";
import { evaluateGuard } from "./core/guard.js";
import { Telemetry } from "./telemetry.js";
function warn(scope, err) {
    process.stderr.write(`[pinta-opencode] ${scope}: ${err?.message ?? String(err)}\n`);
}
/**
 * Wrap a hook body so every telemetry/guard error is swallowed (logged, not
 * rethrown) — the fail-open invariant. Returns a hook with the same signature.
 */
function failOpen(scope, fn) {
    return async (...args) => {
        try {
            await fn(...args);
        }
        catch (err) {
            warn(scope, err);
        }
    };
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
    // Guard query + before-span emission, both fail-open. Returns the guard
    // decision (or null on any infra error) so the caller can throw on DENY.
    async function guardAndTrace(input, args) {
        let guard = null;
        try {
            guard = await evaluateGuard({
                spanId: input.sessionID,
                toolName: input.tool,
                toolInput: args,
                rawTextFields: { toolInput: safeStringify(args) },
            }, config.guardEndpoint, { timeoutMs: config.guardTimeoutMs, token: config.relayToken, disabled: config.guardDisabled });
            await telemetry.toolBefore(input, args, guard);
        }
        catch (err) {
            warn("tool.execute.before", err); // telemetry/guard infra errors are fail-open
        }
        return guard;
    }
    return {
        // turn-START → rotate a new trace for this session.
        "chat.message": failOpen("chat.message", async (input) => {
            trace.newTrace(input?.sessionID);
        }),
        // lifecycle telemetry; flushes the retry buffer on session.idle (turn-END).
        event: failOpen("event", async (input) => {
            if (input?.event)
                await telemetry.lifecycle(input.event);
        }),
        // ★ governance gate: guard query → DENY throws (blocks just this tool).
        // Telemetry/guard-infra errors are fail-open; only a DENY decision escapes.
        "tool.execute.before": async (input, output) => {
            const guard = await guardAndTrace(input, output?.args);
            if (guard?.decision === "DENY") {
                throw new Error(guard.userMessage ?? guard.reason ?? "guard_deny");
            }
        },
        // tool-result telemetry.
        "tool.execute.after": failOpen("tool.execute.after", (input, output) => telemetry.toolAfter(input, output)),
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