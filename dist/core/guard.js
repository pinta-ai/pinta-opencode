// opencode-specific binding over the shared guard in @pinta-ai/core. Preserves
// the historical opencode behavior: 50ms default timeout, a `pinta-opencode/
// <version>` User-Agent, and options passed explicitly (not read from
// process.env) because the plugin is a long-lived in-process module whose config
// is resolved at init, after this module is already imported.
import { evaluateGuard as coreEvaluateGuard } from "@pinta-ai/core";
const DEFAULT_TIMEOUT_MS = 50;
// Self-identify to the manager's guard route so it can attribute calls to this
// adaptor (the route parses `pinta-*/<version>` out of the User-Agent). Keep the
// version in sync with package.json.
const GUARD_UA = "pinta-opencode/0.3.1";
/**
 * Query the external guard policy server. Fail-open on every error path
 * (no endpoint / disabled / non-200 / timeout / throw → ALLOW). Options are
 * passed explicitly (not read from process.env) because the opencode plugin
 * is a long-lived in-process module whose config is resolved at init.
 */
export function evaluateGuard(input, endpoint, opts = {}) {
    return coreEvaluateGuard(input, endpoint, {
        timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        token: opts.token,
        disabled: opts.disabled,
        userAgent: GUARD_UA,
    });
}
//# sourceMappingURL=guard.js.map