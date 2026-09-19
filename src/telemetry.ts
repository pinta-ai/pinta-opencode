import { Transport } from "./core/transport.js";
import { TraceManager } from "./core/trace.js";
import { attachGuard, type OtlpPayload } from "@pinta-ai/core";
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

  private build(name: string, sessionId: string | undefined, fields: Record<string, unknown>): OtlpPayload {
    const traceId = this.trace.currentTrace(sessionId);
    return buildOtlpPayload({ name, traceId, fields, serviceVersion: this.config.serviceVersion });
  }

  /** Send a payload built by one of the `*Payload` methods (best-effort by the transport's contract). */
  async send(payload: OtlpPayload): Promise<void> {
    await this.transport.send(payload);
  }

  private async emit(name: string, sessionId: string | undefined, fields: Record<string, unknown>): Promise<void> {
    await this.send(this.build(name, sessionId, fields));
  }

  /** Lifecycle span from the `event` hook. Flushes the retry buffer on turn-END. */
  async lifecycle(ev: OpencodeEvent): Promise<void> {
    const props = ev.properties ?? {};
    const sessionId = typeof props.sessionID === "string" ? props.sessionID : undefined;
    await this.emit(`opencode.event.${ev.type ?? "unknown"}`, sessionId, {
      hook: "event",
      event_type: ev.type,
      session_id: sessionId,
      cwd: process.cwd(),
      ...props,
    });
    if (ev.type === "session.idle") await this.transport.flush();
  }

  /**
   * Tool span from `tool.execute.before`, before the guard has been asked. The
   * plugin asks the guard about this payload, attaches the verdict with
   * `attachGuard`, and sends the same object — so the span the manager judged
   * is the span the backend stores.
   */
  toolBeforePayload(input: ToolBeforeInput, args: unknown): OtlpPayload {
    return this.build(
      "opencode.tool.before",
      input.sessionID,
      { ...toolIdentity("tool.execute.before", input), tool_input: args },
    );
  }

  /** Tool span from `tool.execute.before`, carrying an already-known guard decision. */
  async toolBefore(input: ToolBeforeInput, args: unknown, guard: GuardResult | null): Promise<void> {
    await this.send(attachGuard(this.toolBeforePayload(input, args), guard));
  }

  /** Tool result span from `tool.execute.after`, incl. exit code / truncation. */
  async toolAfter(input: ToolBeforeInput, output: ToolAfterOutput): Promise<void> {
    const meta = output.metadata ?? {};
    await this.emit("opencode.tool.after", input.sessionID, {
      ...toolIdentity("tool.execute.after", input),
      title: output.title,
      tool_response: output.output,
      exit: meta.exit,
      truncated: meta.truncated,
    });
  }
}

/**
 * Shared identity fields for both tool spans.
 *
 * `hook` names the opencode hook this span arrived on. It is the same string
 * the guard leg sends as `method` from `plugin.ts`, so the before-the-fact and
 * after-the-fact halves of one invocation now name that invocation identically.
 *
 * `cwd` is opencode's own working directory — an in-process plugin shares it —
 * which is what the tool's relative paths resolve against. The guard leg has
 * always sent it; this leg never did, so a path could be judged before the act
 * and not after it.
 *
 * The key names match what the ingest parser reads, and match the other
 * adapters (see pinta-musecode's flattenEvent). Nothing is sent twice under two
 * names: the parser accepts the older spelling for the sake of installed copies
 * of this plugin, and a field carried under two names is a field whose two
 * copies can disagree.
 */
function toolIdentity(hook: string, input: ToolBeforeInput): Record<string, unknown> {
  return {
    hook,
    tool_name: input.tool,
    session_id: input.sessionID,
    tool_use_id: input.callID,
    cwd: process.cwd(),
  };
}
