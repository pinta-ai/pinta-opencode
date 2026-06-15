export interface GuardInput {
  spanId: string;
  toolName?: string;
  toolInput?: unknown;
  rawTextFields?: Record<string, string>;
}

export interface GuardResult {
  decision: "ALLOW" | "DENY" | "REVIEW";
  reason: string | null;
  // Pre-formatted message the manager wants surfaced to the LLM/user when
  // decision === 'DENY'. Null otherwise, or when talking to an older manager
  // that doesn't yet emit this field.
  userMessage: string | null;
  durationMs: number;
  failOpenReason?: "timeout" | "refused" | "error";
}

export interface GuardOptions {
  /** Hard timeout. 50ms default keeps the hook snappy; 300ms recommended in prod. */
  timeoutMs?: number;
  /** Sent as x-pinta-relay-token. */
  token?: string;
  /** Force-disable even if an endpoint is configured. */
  disabled?: boolean;
}

function sleep(ms: number): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => {
      const err = new Error("Guard request timed out");
      err.name = "TimeoutError";
      reject(err);
    }, ms),
  );
}

/**
 * Query the external guard policy server. Fail-open on every error path
 * (no endpoint / disabled / non-200 / timeout / throw → ALLOW). Options are
 * passed explicitly (not read from process.env) because the opencode plugin
 * is a long-lived in-process module whose config is resolved at init, after
 * this module is already imported.
 */
export async function evaluateGuard(
  input: GuardInput,
  endpoint: string | undefined,
  opts: GuardOptions = {},
): Promise<GuardResult | null> {
  if (!endpoint) return null;
  if (opts.disabled) return null;
  const timeoutMs = opts.timeoutMs ?? 50;
  const start = Date.now();
  try {
    const res = await Promise.race([
      fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-pinta-relay-token": opts.token ?? "",
        },
        body: JSON.stringify({ input }),
      }),
      sleep(timeoutMs),
    ]);
    if (res.status !== 200) {
      return { decision: "ALLOW", reason: null, userMessage: null, durationMs: Date.now() - start, failOpenReason: "error" };
    }
    const body = (await res.json()) as {
      decision: GuardResult["decision"];
      reason: string | null;
      userMessage?: string | null;
      durationMs?: number;
    };
    return {
      decision: body.decision,
      reason: body.reason,
      userMessage: body.userMessage ?? null,
      durationMs: body.durationMs ?? Date.now() - start,
    };
  } catch (err) {
    const reason: GuardResult["failOpenReason"] = (err as Error).name === "TimeoutError" ? "timeout" : "error";
    return { decision: "ALLOW", reason: null, userMessage: null, durationMs: Date.now() - start, failOpenReason: reason };
  }
}
