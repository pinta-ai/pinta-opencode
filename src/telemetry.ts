import { Transport } from "./core/transport.js";
import { TraceManager } from "./core/trace.js";
import { attachGuard, type OtlpPayload } from "@pinta-ai/core";
import { buildOtlpPayload } from "./core/otlp.js";
import type { GuardResult } from "./core/guard.js";
import type { ResolvedConfig } from "./config.js";
import {
  ModelTracker, eventSessionID, modelFields, record,
  type ChatMessageInput, type ChatMessageOutput, type ChatParamsInput, type ToolModelInput,
} from "./model.js";

export interface OpencodeEvent {
  id?: string;
  type?: string;
  properties?: Record<string, unknown>;
}

export interface ToolBeforeInput extends ToolModelInput {}

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
  private models = new ModelTracker();

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

  chatMessage(input: ChatMessageInput, output?: ChatMessageOutput): void {
    this.models.chatMessage(input, output);
  }

  chatParams(input: ChatParamsInput): void {
    this.models.chatParams(input);
  }

  /** Lifecycle span from the `event` hook. Flushes the retry buffer on turn-END. */
  async lifecycle(ev: OpencodeEvent): Promise<void> {
    const props = record(ev.properties) ?? {};
    const sessionId = eventSessionID(ev.type, props);
    const model = this.models.event(ev.type, props);
    await this.emit(`opencode.event.${ev.type ?? "unknown"}`, sessionId, modelFields({
      hook: "event",
      event_type: ev.type,
      session_id: sessionId,
      cwd: process.cwd(),
      ...props,
    }, model));
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
      modelFields(
        { ...toolIdentity("tool.execute.before", input), tool_input: args },
        this.models.beforeTool(input),
      ),
    );
  }

  /** Tool span from `tool.execute.before`, carrying an already-known guard decision. */
  async toolBefore(input: ToolBeforeInput, args: unknown, guard: GuardResult | null): Promise<void> {
    await this.send(attachGuard(this.toolBeforePayload(input, args), guard));
  }

  /** Tool result span from `tool.execute.after`, incl. exit code / truncation. */
  async toolAfter(input: ToolBeforeInput, output: ToolAfterOutput): Promise<void> {
    const meta = output.metadata ?? {};
    await this.emit("opencode.tool.after", input.sessionID, modelFields({
      ...toolIdentity("tool.execute.after", input),
      title: output.title,
      tool_response: output.output,
      exit: meta.exit,
      truncated: meta.truncated,
    }, this.models.afterTool(input)));
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
    ...(input.model !== undefined ? { model: input.model } : {}),
    ...(input.modelID !== undefined ? { modelID: input.modelID } : {}),
    ...(input.providerID !== undefined ? { providerID: input.providerID } : {}),
    ...(input.agent !== undefined ? { agent: input.agent } : {}),
    ...(input.messageID !== undefined ? { message_id: input.messageID } : {}),
  };
}
