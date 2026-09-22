import { resolveConfig, type PintaOptions } from "./config.js";
import { Transport } from "./core/transport.js";
import { TraceManager } from "./core/trace.js";
import { attachGuard } from "@pinta-ai/core";
import { evaluateGuard, type GuardResult } from "./core/guard.js";
import { Telemetry, type OpencodeEvent, type ToolBeforeInput, type ToolAfterOutput } from "./telemetry.js";
import type { ChatMessageInput, ChatMessageOutput, ChatParamsInput, ChatParamsOutput } from "./model.js";

function warn(scope: string, err: unknown): void {
  process.stderr.write(`[pinta-opencode] ${scope}: ${(err as Error)?.message ?? String(err)}\n`);
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
 * - Telemetry (event / tool.execute.after): best-effort OTLP, never blocks.
 * - Governance (tool.execute.before): guard query; DENY → throw(reason), which
 *   blocks only that tool and surfaces the reason to the model (verified H-A1).
 *
 * Fail-open invariant: every telemetry/guard error is swallowed; the only
 * intentional throw is a guard DENY.
 */
export const PintaOpencode = async (_input: unknown, options?: PintaOptions) => {
  const config = resolveConfig(options ?? {});
  const transport = new Transport({ endpoint: config.endpoint, headers: config.headers });
  const trace = new TraceManager();
  const telemetry = new Telemetry(transport, trace, config);

  // Guard query + before-span emission, both fail-open. Returns the guard
  // decision (or null on any infra error) so the caller can throw on DENY.
  async function guardAndTrace(input: ToolBeforeInput, args: unknown): Promise<GuardResult | null> {
    let guard: GuardResult | null = null;
    try {
      // The span is built BEFORE the guard is asked, and the guard is asked
      // about that span. Since core 0.8.0 it is the one reading of the
      // invocation, judged by the manager through the same AgentEvent assembly
      // the backend stores it with. Until then the guard got a hand-picked
      // summary beside the span — `method` naming the opencode hook so the
      // manager would not take a tool called `read` for Claude Code's
      // (PTA-207), `cwd` so a relative target could be located (PTA-176) —
      // and the summary and the span were free to drift. Both facts are on
      // the span as `opencode.hook` and `opencode.cwd`.
      const payload = telemetry.toolBeforePayload(input, args);
      guard = await evaluateGuard(
        payload,
        config.guardEndpoint,
        { timeoutMs: config.guardTimeoutMs, token: config.relayToken, disabled: config.guardDisabled },
      );
      // The verdict rides on the span the guard judged — same spanId.
      await telemetry.send(attachGuard(payload, guard));
    } catch (err) {
      warn("tool.execute.before", err); // telemetry/guard infra errors are fail-open
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
      const guard = await guardAndTrace(input, output?.args);
      if (guard?.decision === "DENY") {
        throw new Error(guard.userMessage ?? guard.reason ?? "guard_deny");
      }
    },

    // tool-result telemetry.
    "tool.execute.after": failOpen("tool.execute.after", (input: ToolBeforeInput, output: ToolAfterOutput) =>
      telemetry.toolAfter(input, output),
    ),
  };
};

export default PintaOpencode;
