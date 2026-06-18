import { buildOtlpPayload } from "./core/otlp.js";
/**
 * Maps opencode hook payloads to OTLP spans (verified payload shapes — SPEC §5).
 * Tool spans are built from tool.execute.before/after (richer: args, output,
 * exit) rather than the event bus; `event` covers lifecycle + turn boundaries.
 */
export class Telemetry {
    transport;
    trace;
    config;
    constructor(transport, trace, config) {
        this.transport = transport;
        this.trace = trace;
        this.config = config;
    }
    async emit(name, sessionId, fields, guard) {
        const traceId = this.trace.currentTrace(sessionId);
        const payload = buildOtlpPayload({ name, traceId, fields, guard, serviceVersion: this.config.serviceVersion });
        await this.transport.send(payload);
    }
    /** Lifecycle span from the `event` hook. Flushes the retry buffer on turn-END. */
    async lifecycle(ev) {
        const props = ev.properties ?? {};
        const sessionId = typeof props.sessionID === "string" ? props.sessionID : undefined;
        await this.emit(`opencode.event.${ev.type ?? "unknown"}`, sessionId, {
            kind: "event",
            event_type: ev.type,
            session_id: sessionId,
            ...props,
        });
        if (ev.type === "session.idle")
            await this.transport.flush();
    }
    /** Tool span from `tool.execute.before`, carrying the guard decision. */
    async toolBefore(input, args, guard) {
        await this.emit("opencode.tool.before", input.sessionID, { kind: "tool.before", tool: input.tool, session_id: input.sessionID, call_id: input.callID, args }, guard);
    }
    /** Tool result span from `tool.execute.after`, incl. exit code / truncation. */
    async toolAfter(input, output) {
        const meta = output.metadata ?? {};
        await this.emit("opencode.tool.after", input.sessionID, {
            kind: "tool.after",
            tool: input.tool,
            session_id: input.sessionID,
            call_id: input.callID,
            title: output.title,
            output: output.output,
            exit: meta.exit,
            truncated: meta.truncated,
        });
    }
}
//# sourceMappingURL=telemetry.js.map