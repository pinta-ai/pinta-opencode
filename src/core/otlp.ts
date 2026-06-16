import crypto from "crypto";
import os from "os";
import { redact, truncate } from "./redact.js";
import type { GuardResult } from "./guard.js";

const SDK_VERSION = "0.2.1"; // keep in sync with package.json

export interface OtlpAttribute {
  key: string;
  value: { stringValue: string } | { intValue: number } | { doubleValue: number } | { boolValue: boolean };
}

export interface OtlpSpan {
  traceId: string;
  spanId: string;
  name: string;
  kind: number;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: OtlpAttribute[];
}

export interface ResourceSpans {
  resource: { attributes: OtlpAttribute[] };
  scopeSpans: Array<{ scope: { name: string; version: string }; spans: OtlpSpan[] }>;
}

export interface OtlpPayload {
  resourceSpans: ResourceSpans[];
}

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Convert a 26-char Crockford ULID into 32 lowercase hex chars for an OTLP traceId. */
export function ulidToTraceId(ulid: string): string {
  if (ulid.length !== 26) throw new Error(`ulidToTraceId: expected 26 chars, got ${ulid.length}`);
  let n = 0n;
  for (const ch of ulid) {
    const idx = CROCKFORD.indexOf(ch);
    if (idx < 0) throw new Error(`ulidToTraceId: invalid Crockford char "${ch}"`);
    n = (n << 5n) | BigInt(idx);
  }
  n &= (1n << 128n) - 1n;
  return n.toString(16).padStart(32, "0");
}

/** Generate a fresh 16-hex-char (8-byte) span ID. */
export function newSpanId(): string {
  return crypto.randomBytes(8).toString("hex");
}

/** Identifier/enum keys for which redaction is skipped (truncation still applies). */
const SKIP_REDACT_KEYS: ReadonlySet<string> = new Set([
  "opencode.kind",
  "opencode.event_type",
  "opencode.tool",
  "opencode.session_id", "opencode.sessionID",
  "opencode.call_id", "opencode.callID",
  "opencode.agent",
  "opencode.model",
  "opencode.exit",
  "opencode.truncated",
  "opencode.title",
]);

/** Keys that may carry shell command / tool payload text → bash redaction context. */
const BASH_CONTEXT_KEYS: ReadonlySet<string> = new Set([
  "opencode.args",
  "opencode.input",
  "opencode.output",
  "opencode.tool_input",
]);

function maybeRedactString(key: string, raw: string): string {
  const truncated = truncate(raw);
  if (SKIP_REDACT_KEYS.has(key)) return truncated;
  const context = BASH_CONTEXT_KEYS.has(key) ? ("bash" as const) : undefined;
  return redact(truncated, { context });
}

/** Convert a JS value into an OTLP attribute value. Returns null to omit. */
function toOtlpValue(key: string, v: unknown): OtlpAttribute["value"] | null {
  if (v === null || v === undefined) return null;
  switch (typeof v) {
    case "string":
      return { stringValue: maybeRedactString(key, v) };
    case "boolean":
      return { boolValue: v };
    case "number":
      return Number.isInteger(v) ? { intValue: v } : { doubleValue: v };
    case "object":
      try {
        return { stringValue: maybeRedactString(key, JSON.stringify(v)) };
      } catch {
        return { stringValue: maybeRedactString(key, String(v)) };
      }
    default:
      return { stringValue: maybeRedactString(key, String(v)) };
  }
}

/** Bronze flattening: every field becomes an `opencode.<key>` attribute, losslessly. */
function flattenFields(fields: Record<string, unknown>): OtlpAttribute[] {
  // Discriminator first so aware-backend's detectIngestType hits it cheaply.
  const out: OtlpAttribute[] = [{ key: "ingest.type", value: { stringValue: "opencode" } }];
  for (const [k, v] of Object.entries(fields)) {
    const key = `opencode.${k}`;
    const value = toOtlpValue(key, v);
    if (value === null) continue;
    out.push({ key, value });
  }
  return out;
}

function resourceAttrs(serviceVersion: string): OtlpAttribute[] {
  return [
    { key: "service.name", value: { stringValue: "opencode" } },
    { key: "service.version", value: { stringValue: serviceVersion } },
    { key: "telemetry.sdk.name", value: { stringValue: "pinta-opencode" } },
    { key: "telemetry.sdk.language", value: { stringValue: "nodejs" } },
    { key: "telemetry.sdk.version", value: { stringValue: SDK_VERSION } },
    { key: "process.pid", value: { intValue: process.pid } },
    { key: "process.owner", value: { stringValue: os.userInfo().username } },
    { key: "host.name", value: { stringValue: os.hostname() } },
    { key: "host.arch", value: { stringValue: os.arch() } },
  ];
}

export function buildOtlpPayload(args: {
  name: string;
  traceId: string; // ULID (26 chars)
  fields: Record<string, unknown>;
  serviceVersion: string;
  now?: number; // ms since epoch; injectable for tests
  guard?: GuardResult | null;
}): OtlpPayload {
  const ts = args.now ?? Date.now();
  const tsNano = (BigInt(ts) * 1_000_000n).toString();
  const attrs = flattenFields(args.fields);
  if (args.guard) {
    attrs.push(
      { key: "pinta.guard.decision", value: { stringValue: args.guard.decision.toLowerCase() } },
      { key: "pinta.guard.duration_ms", value: { intValue: args.guard.durationMs } },
    );
    if (args.guard.reason) attrs.push({ key: "pinta.guard.matched_rule", value: { stringValue: args.guard.reason } });
    if (args.guard.failOpenReason)
      attrs.push({ key: "pinta.guard.fail_open_reason", value: { stringValue: args.guard.failOpenReason } });
  }
  const span: OtlpSpan = {
    traceId: ulidToTraceId(args.traceId),
    spanId: newSpanId(),
    name: args.name,
    kind: 1, // SPAN_KIND_INTERNAL
    startTimeUnixNano: tsNano,
    endTimeUnixNano: tsNano,
    attributes: attrs,
  };
  return {
    resourceSpans: [
      {
        resource: { attributes: resourceAttrs(args.serviceVersion) },
        scopeSpans: [{ scope: { name: "pinta-opencode", version: SDK_VERSION }, spans: [span] }],
      },
    ],
  };
}

/** Concatenate per-event payloads' resourceSpans into one OTLP payload. */
export function mergeBatch(payloads: OtlpPayload[]): OtlpPayload {
  const out: ResourceSpans[] = [];
  for (const p of payloads) out.push(...p.resourceSpans);
  return { resourceSpans: out };
}
