import { parseHeadersEnv } from "@pinta-ai/core";
import { loadEnvFile } from "./env-file.js";

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

function resolveEndpoint(options: PintaOptions): string | undefined {
  const full =
    options.endpoint ||
    process.env.PINTA_OPENCODE_ENDPOINT ||
    process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
  if (full) return full.replace(/\/+$/, "");
  const base = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (base) return base.replace(/\/+$/, "") + "/v1/traces";
  return undefined;
}

/**
 * Resolve runtime config. Precedence: plugin options → process.env →
 * env-file (unset-only). Both options and env are visible at runtime (verified G5).
 */
export function resolveConfig(options: PintaOptions = {}): ResolvedConfig {
  loadEnvFile(); // lowest priority — fills only unset process.env keys

  const relayToken = options.token || process.env.PINTA_OPENCODE_TOKEN || undefined;

  const headers = parseHeadersEnv(
    options.headers ?? process.env.PINTA_OPENCODE_HEADERS ?? process.env.OTEL_EXPORTER_OTLP_HEADERS,
  );
  // Auto-attach the relay token as a header if one is set and not already present.
  if (relayToken && !Object.keys(headers).some((k) => k.toLowerCase() === "x-pinta-relay-token")) {
    headers["x-pinta-relay-token"] = relayToken;
  }

  const guardTimeoutMs =
    options.guardTimeoutMs ?? (Number(process.env.PINTA_OPENCODE_GUARD_TIMEOUT_MS) || 50);

  return {
    endpoint: resolveEndpoint(options),
    headers,
    guardEndpoint: options.guard || process.env.PINTA_OPENCODE_GUARD || undefined,
    relayToken,
    guardTimeoutMs,
    guardDisabled: process.env.PINTA_OPENCODE_GUARD_DISABLED === "1",
    serviceVersion: process.env.OPENCODE_VERSION || "unknown",
  };
}
