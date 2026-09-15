import fs from "node:fs";
import path from "node:path";
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
  /** Undefined when nothing could resolve it; the OTLP attribute is omitted. */
  serviceVersion: string | undefined;
}

/** First non-empty value (option → env precedence), else undefined. */
function firstSet(...vals: (string | undefined)[]): string | undefined {
  return vals.find((v) => v) || undefined;
}

function resolveEndpoint(options: PintaOptions): string | undefined {
  const full = firstSet(
    options.endpoint,
    process.env.PINTA_OPENCODE_ENDPOINT,
    process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT,
  );
  if (full) return full.replace(/\/+$/, "");
  const base = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (base) return base.replace(/\/+$/, "") + "/v1/traces";
  return undefined;
}

/**
 * Resolve runtime config. Precedence: plugin options → process.env →
 * env-file (unset-only). Both options and env are visible at runtime (verified G5).
 */
/**
 * Resolve the opencode version.
 *
 * `OPENCODE_VERSION` was the only source read, and opencode does not set it.
 * Dumping the environment a real plugin sees (opencode 1.18.31, `opencode run`)
 * returned `OPENCODE=1`, `OPENCODE_PID` and `OPENCODE_CONFIG_DIR` — no version.
 * Nothing else in reach carries one either:
 *
 *   - the plugin input is `{client, project, worktree, directory,
 *     experimental_workspace, serverUrl, $}`, none of which holds a version
 *   - the SDK client's namespaces (`app.log/agents`, `project.list/current`,
 *     `config.get/update/providers`, `path.get`, `vcs.get`, `session.*`, …)
 *     expose no version call
 *   - `process.argv` is `["bun", "/$bunfs/root/src/index.js", …]`, a virtual
 *     path inside the single-file build, so argv cannot be walked
 *
 * `process.execPath` can be, and that is the one thing that does work: it is
 * `…/node_modules/opencode-ai/bin/opencode.exe`, so the package manifest is a
 * walk up from there. The walk matches on the package name rather than a fixed
 * depth, so a different install layout moves the answer instead of breaking it.
 *
 * `OPENCODE_VERSION` stays first as an explicit override.
 *
 * When nothing answers, the attribute is omitted rather than set to
 * `"unknown"`. A placeholder is indistinguishable from a real value downstream
 * (PTA-347), so the attribute's absence is the honest signal.
 */
const OPENCODE_PACKAGE_NAME = "opencode-ai";

function versionFromExecPath(): string | undefined {
  let dir = path.dirname(process.execPath);
  for (let i = 0; i < 5; i++) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")) as {
        name?: unknown;
        version?: unknown;
      };
      if (pkg.name === OPENCODE_PACKAGE_NAME && typeof pkg.version === "string" && pkg.version) {
        return pkg.version;
      }
    } catch {
      /* keep walking */
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

function resolveServiceVersion(): string | undefined {
  const explicit = process.env.OPENCODE_VERSION?.trim();
  if (explicit) return explicit;
  return versionFromExecPath();
}

export function resolveConfig(options: PintaOptions = {}): ResolvedConfig {
  loadEnvFile(); // lowest priority — fills only unset process.env keys

  const relayToken = firstSet(options.token, process.env.PINTA_OPENCODE_TOKEN);

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
    guardEndpoint: firstSet(options.guard, process.env.PINTA_OPENCODE_GUARD),
    relayToken,
    guardTimeoutMs,
    guardDisabled: process.env.PINTA_OPENCODE_GUARD_DISABLED === "1",
    serviceVersion: resolveServiceVersion(),
  };
}
