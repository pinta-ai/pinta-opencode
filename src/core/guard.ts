// opencode-specific binding over the shared guard in @pinta-ai/core. Preserves
// the historical opencode behavior: 50ms default timeout, a `pinta-opencode/
// <version>` User-Agent, and options passed explicitly (not read from
// process.env) because the plugin is a long-lived in-process module whose config
// is resolved at init, after this module is already imported.
//
// Since core 0.8.0 the guard is asked about the OTLP payload the plugin is
// about to relay — the same object, built first — rather than a hand-assembled
// summary of the invocation. See `plugin.ts`.
import { evaluateGuard as coreEvaluateGuard } from "@pinta-ai/core";
import type { GuardPayload, GuardResult } from "@pinta-ai/core";
import { ADAPTER_VERSION } from "./version.js";

export type { GuardPayload, GuardResult } from "@pinta-ai/core";

export interface GuardOptions {
  /** Hard timeout. 50ms default keeps the hook snappy; 300ms recommended in prod. */
  timeoutMs?: number;
  /** Sent as x-pinta-relay-token. */
  token?: string;
  /** Force-disable even if an endpoint is configured. */
  disabled?: boolean;
}

const DEFAULT_TIMEOUT_MS = 50;

// Self-identify to the manager's guard route so it can attribute calls to this
// adaptor (the route parses `pinta-*/<version>` out of the User-Agent). Derived
// from ADAPTER_VERSION rather than written out: a copy here shipped 0.7.0 on
// the 0.8.0 release, under a comment telling the reader to keep it in sync.
const GUARD_UA = `pinta-opencode/${ADAPTER_VERSION}`;

/**
 * Query the external guard policy server. Fail-open on every error path
 * (no endpoint / disabled / non-200 / timeout / throw → ALLOW). Options are
 * passed explicitly (not read from process.env) because the opencode plugin
 * is a long-lived in-process module whose config is resolved at init.
 */
export function evaluateGuard(
  payload: GuardPayload,
  endpoint: string | undefined,
  opts: GuardOptions = {},
): Promise<GuardResult | null> {
  return coreEvaluateGuard(payload, endpoint, {
    timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    token: opts.token,
    disabled: opts.disabled,
    userAgent: GUARD_UA,
  });
}
