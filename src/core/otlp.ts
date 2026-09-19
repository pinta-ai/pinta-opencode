import os from "os";
import { ADAPTER_VERSION } from "./version.js";
import {
  attrsFromRecord,
  buildPayload,
  mergeBatch,
  ulidToTraceId,
  type AttrPolicy,
  type OtlpAttribute,
  type OtlpPayload,
} from "@pinta-ai/core";

// OTLP envelope + the redaction-aware attribute pipeline now live in
// @pinta-ai/core. This module keeps only the opencode-specific bits: the bronze
// field flattening (with the `ingest.type` discriminator + `opencode.` prefix),
// resource attributes, SDK version, and the redaction policy. The public API
// (buildOtlpPayload, mergeBatch, ulidToTraceId, OtlpPayload/OtlpAttribute types)
// is preserved so telemetry.ts and the tests need no changes.
export { mergeBatch, ulidToTraceId };
export type { OtlpAttribute, OtlpPayload };

// os.userInfo() throws on hosts with no passwd entry for the uid (containers,
// CI, service accounts). Memoize a safe fallback so span building never throws.
let cachedProcessOwner: string | undefined;
function processOwner(): string {
  if (cachedProcessOwner === undefined) {
    try {
      cachedProcessOwner = os.userInfo().username;
    } catch {
      cachedProcessOwner =
        process.env.USER ??
        process.env.LOGNAME ??
        (typeof process.getuid === "function" ? String(process.getuid()) : "unknown");
    }
  }
  return cachedProcessOwner;
}

const SDK_VERSION = ADAPTER_VERSION;

/** Identifier/enum keys for which redaction is skipped (truncation still applies). */
const SKIP_REDACT_KEYS: ReadonlySet<string> = new Set([
  "opencode.hook",
  "opencode.event_type",
  "opencode.tool_name",
  "opencode.session_id", "opencode.sessionID",
  "opencode.tool_use_id",
  "opencode.cwd",
  "opencode.agent",
  "opencode.model",
  "opencode.exit",
  "opencode.truncated",
  "opencode.title",
]);

/**
 * Keys that may carry shell command / tool payload text → bash redaction context.
 *
 * These have to track the field names telemetry.ts emits. A rename that misses
 * this set fails nothing on its own — the value keeps flowing, unmasked — so
 * telemetry.test.ts asserts the masking through the real pipeline.
 */
const BASH_CONTEXT_KEYS: ReadonlySet<string> = new Set([
  "opencode.tool_input",
  "opencode.tool_response",
]);

const ATTR_POLICY: AttrPolicy = {
  skipRedactKeys: SKIP_REDACT_KEYS,
  bashContextKeys: BASH_CONTEXT_KEYS,
};

/** Bronze flattening: every field becomes an `opencode.<key>` attribute, losslessly. */
function flattenFields(fields: Record<string, unknown>): OtlpAttribute[] {
  // Discriminator first so aware-backend's detectIngestType hits it cheaply.
  const out: OtlpAttribute[] = [{ key: "ingest.type", value: { stringValue: "opencode" } }];
  out.push(...attrsFromRecord(fields, "opencode", ATTR_POLICY));
  return out;
}

function resourceAttrs(serviceVersion: string | undefined): OtlpAttribute[] {
  return [
    { key: "service.name", value: { stringValue: "opencode" } },
    // Omitted when unresolved — the absence is the honest signal, not "unknown".
    // A placeholder is indistinguishable from a real value downstream (PTA-347).
    ...(serviceVersion
      ? [{ key: "service.version", value: { stringValue: serviceVersion } } as OtlpAttribute]
      : []),
    { key: "telemetry.sdk.name", value: { stringValue: "pinta-opencode" } },
    { key: "telemetry.sdk.language", value: { stringValue: "nodejs" } },
    { key: "telemetry.sdk.version", value: { stringValue: SDK_VERSION } },
    { key: "process.pid", value: { intValue: process.pid } },
    { key: "process.owner", value: { stringValue: processOwner() } },
    { key: "host.name", value: { stringValue: os.hostname() } },
    { key: "host.arch", value: { stringValue: os.arch() } },
  ];
}

export function buildOtlpPayload(args: {
  name: string;
  traceId: string; // ULID (26 chars)
  fields: Record<string, unknown>;
  /** Undefined when nothing could resolve it; the attribute is then omitted. */
  serviceVersion: string | undefined;
  now?: number; // ms since epoch; injectable for tests
}): OtlpPayload {
  return buildPayload({
    traceId: args.traceId,
    spanName: args.name,
    attributes: flattenFields(args.fields),
    resource: resourceAttrs(args.serviceVersion),
    scope: { name: "pinta-opencode", version: SDK_VERSION },
    now: args.now,
  });
}
