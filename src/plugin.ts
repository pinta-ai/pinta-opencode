import { resolveConfig, type PintaOptions } from "./config.js";
import { Transport } from "./core/transport.js";
import { TraceManager } from "./core/trace.js";
import { attachGuard, buildOutputDenial, type OtlpPayload } from "@pinta-ai/core";
import { evaluateGuard, type GuardResult } from "./core/guard.js";
import { Telemetry, type OpencodeEvent, type ToolBeforeInput, type ToolAfterInput, type ToolAfterOutput } from "./telemetry.js";
import type { ChatMessageInput, ChatMessageOutput, ChatParamsInput, ChatParamsOutput } from "./model.js";

function warn(scope: string, err: unknown): void {
  process.stderr.write(`[pinta-opencode] ${scope}: ${(err as Error)?.message ?? String(err)}\n`);
}

/**
 * The text a tool-output DENY is built from: the builtin `output` string when
 * there is one, else the raw (MCP) result serialized. Mirrors what
 * `telemetry.toolAfterPayload` records as `opencode.tool_response`.
 */
function returnedText(output: ToolAfterOutput | undefined): string {
  if (typeof output?.output === "string") return output.output;
  return JSON.stringify(output?.output ?? output) ?? "";
}

/**
 * Wrap a hook body so every telemetry/guard error is swallowed (logged, not
 * rethrown) — the fail-open invariant. Returns a hook with the same signature.
 */
function failOpen<A extends unknown[]>(
  scope: string,
  fn: (...args: A) => Promise<void>,
): (...args: A) => Promise<void> {
  return async (...args: A) => {
    try {
      await fn(...args);
    } catch (err) {
      warn(scope, err);
    }
  };
}

/**
 * pinta-opencode plugin entry. opencode invokes this once per instance with
 * `(input, options)` and keeps the returned hooks for the instance lifetime
 * (verified H-C1), so config + transport + trace state live in this closure.
 *
 * - Lifecycle telemetry: best-effort OTLP, never blocks.
 * - Before/after governance: DENY throws outside the fail-open wrapper.
 *   After gates withhold returned output, not already-completed side effects.
 *
 * Fail-open invariant: every telemetry/guard error is swallowed; the only
 * intentional throw is a guard DENY.
 */
export const PintaOpencode = async (_input: unknown, options?: PintaOptions) => {
  const config = resolveConfig(options ?? {});
  const transport = new Transport({ endpoint: config.endpoint, headers: config.headers });
  const trace = new TraceManager();
  const telemetry = new Telemetry(transport, trace, config);

  async function guardAndTrace(
    hook: "tool.execute.before" | "tool.execute.after",
    build: () => OtlpPayload,
  ): Promise<GuardResult | null> {
    let guard: GuardResult | null = null;
    try {
      const payload = build();
      guard = await evaluateGuard(
        payload,
        config.guardEndpoint,
        { timeoutMs: config.guardTimeoutMs, token: config.relayToken, disabled: config.guardDisabled },
      );
      attachGuard(payload, guard);
      if (hook === "tool.execute.after" && guard) {
        payload.resourceSpans[0].scopeSpans[0].spans[0].attributes.push({
          key: "pinta.guard.target", value: { stringValue: "tool_output" },
        });
      }
      if (guard?.decision === "DENY") transport.defer(payload);
      else await telemetry.send(payload);
    } catch (err) {
      warn(hook, err);
    }
    return guard;
  }

  return {
    // turn-START → rotate a new trace for this session.
    "chat.message": failOpen("chat.message", async (input: ChatMessageInput, output?: ChatMessageOutput) => {
      trace.newTrace(input?.sessionID);
      telemetry.chatMessage(input, output);
    }),

    "chat.params": failOpen("chat.params", async (input: ChatParamsInput, _output?: ChatParamsOutput) => {
      telemetry.chatParams(input);
    }),

    // lifecycle telemetry; flushes the retry buffer on session.idle (turn-END).
    event: failOpen("event", async (input: { event?: OpencodeEvent }) => {
      if (input?.event) await telemetry.lifecycle(input.event);
    }),

    // ★ governance gate: guard query → DENY throws (blocks just this tool).
    // Telemetry/guard-infra errors are fail-open; only a DENY decision escapes.
    "tool.execute.before": async (input: ToolBeforeInput, output: { args: unknown }) => {
      const guard = await guardAndTrace("tool.execute.before", () => telemetry.toolBeforePayload(input, output?.args));
      if (guard?.decision === "DENY") {
        throw new Error(guard.userMessage ?? guard.reason ?? "guard_deny");
      }
    },

    // ★ output gate (PTA-695): a DENY hands the model the policy's own message
    // plus a fixed recovery hint. The one replacement channel verified on this
    // host is the throw (the tool shows as failed, the session continues). A
    // `mask` DENY is delivered as masked text only behind `outputMask`, and only
    // through the builtin `output` string — whether OpenCode reads a mutated
    // after-hook output back is not yet verified, and the masked text must never
    // ride inside the error (that is the channel the host echoes verbatim).
    "tool.execute.after": async (input: ToolAfterInput, output: ToolAfterOutput) => {
      const guard = await guardAndTrace("tool.execute.after", () => telemetry.toolAfterPayload(input, output));
      if (guard?.decision !== "DENY") return;
      const denial = buildOutputDenial({ original: returnedText(output), guard });
      if (denial.action === "mask" && config.outputMask && typeof output?.output === "string") {
        const delivered = `${denial.notice}\n\n${denial.guidance}\n\n${denial.text}`;
        output.output = delivered;
        if (output.metadata && typeof output.metadata.output === "string") output.metadata.output = delivered;
        return;
      }
      throw new Error(`${denial.notice}\n\n${denial.guidance}`);
    },
  };
};

export default PintaOpencode;
