import { Transport } from "./core/transport.js";
import { TraceManager } from "./core/trace.js";
import { buildOtlpPayload } from "./core/otlp.js";
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
export class Telemetry {
  constructor(
    private transport: Transport,
    private trace: TraceManager,
    private config: ResolvedConfig,
  ) {}

  private async emit(name: string, sessionId: string | undefined, fields: Record<string, unknown>, guard?: GuardResult | null): Promise<void> {
    const traceId = this.trace.currentTrace(sessionId);
    const payload = buildOtlpPayload({ name, traceId, fields, guard, serviceVersion: this.config.serviceVersion });
    await this.transport.send(payload);
  }

  /** Lifecycle span from the `event` hook. Flushes the retry buffer on turn-END. */
  async lifecycle(ev: OpencodeEvent): Promise<void> {
    const props = ev.properties ?? {};
    const sessionId = typeof props.sessionID === "string" ? props.sessionID : undefined;
    await this.emit(`opencode.event.${ev.type ?? "unknown"}`, sessionId, {
      kind: "event",
      event_type: ev.type,
      session_id: sessionId,
      ...props,
    });
    if (ev.type === "session.idle") await this.transport.flush();
  }

  /** Tool span from `tool.execute.before`, carrying the guard decision. */
  async toolBefore(input: ToolBeforeInput, args: unknown, guard: GuardResult | null): Promise<void> {
    await this.emit(
      "opencode.tool.before",
      input.sessionID,
      { ...toolIdentity("tool.before", input), args },
      guard,
    );
  }

  /** Tool result span from `tool.execute.after`, incl. exit code / truncation. */
  async toolAfter(input: ToolBeforeInput, output: ToolAfterOutput): Promise<void> {
    const meta = output.metadata ?? {};
    await this.emit("opencode.tool.after", input.sessionID, {
      ...toolIdentity("tool.after", input),
      title: output.title,
      output: output.output,
      exit: meta.exit,
      truncated: meta.truncated,
    });
  }
}

/** Shared identity fields for both tool spans (kind + tool/session/call ids). */
function toolIdentity(kind: string, input: ToolBeforeInput): Record<string, unknown> {
  return { kind, tool: input.tool, session_id: input.sessionID, call_id: input.callID };
}
