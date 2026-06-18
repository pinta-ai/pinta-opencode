import type { GuardInput, GuardResult } from "@pinta-ai/core";
export type { GuardInput, GuardResult } from "@pinta-ai/core";
export interface GuardOptions {
    /** Hard timeout. 50ms default keeps the hook snappy; 300ms recommended in prod. */
    timeoutMs?: number;
    /** Sent as x-pinta-relay-token. */
    token?: string;
    /** Force-disable even if an endpoint is configured. */
    disabled?: boolean;
}
/**
 * Query the external guard policy server. Fail-open on every error path
 * (no endpoint / disabled / non-200 / timeout / throw → ALLOW). Options are
 * passed explicitly (not read from process.env) because the opencode plugin
 * is a long-lived in-process module whose config is resolved at init.
 */
export declare function evaluateGuard(input: GuardInput, endpoint: string | undefined, opts?: GuardOptions): Promise<GuardResult | null>;
