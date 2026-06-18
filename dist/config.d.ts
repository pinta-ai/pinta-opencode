/** Options object passed via `opencode.json` → `plugin:[["@pinta-ai/pinta-opencode", {…}]]`. */
export interface PintaOptions {
    /** Full OTLP/HTTP traces URL. */
    endpoint?: string;
    /** `key=val,key=val` request headers, or a parsed record. */
    headers?: string | Record<string, string>;
    /** Guard policy server URL. */
    guard?: string;
    /** Relay token (sent as x-pinta-relay-token). */
    token?: string;
    /** Guard client timeout in ms (default 50). */
    guardTimeoutMs?: number;
}
export interface ResolvedConfig {
    endpoint?: string;
    headers: Record<string, string>;
    guardEndpoint?: string;
    relayToken?: string;
    guardTimeoutMs: number;
    guardDisabled: boolean;
    serviceVersion: string;
}
/**
 * Resolve runtime config. Precedence: plugin options → process.env →
 * env-file (unset-only). Both options and env are visible at runtime (verified G5).
 */
export declare function resolveConfig(options?: PintaOptions): ResolvedConfig;
