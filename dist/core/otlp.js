import os from "os";
import { attrsFromRecord, buildPayload, mergeBatch, ulidToTraceId, } from "@pinta-ai/core";
// OTLP envelope + the redaction-aware attribute pipeline now live in
// @pinta-ai/core. This module keeps only the opencode-specific bits: the bronze
// field flattening (with the `ingest.type` discriminator + `opencode.` prefix),
// resource attributes, SDK version, and the redaction policy. The public API
// (buildOtlpPayload, mergeBatch, ulidToTraceId, OtlpPayload/OtlpAttribute types)
// is preserved so telemetry.ts and the tests need no changes.
export { mergeBatch, ulidToTraceId };
const SDK_VERSION = "0.3.1"; // keep in sync with package.json
/** Identifier/enum keys for which redaction is skipped (truncation still applies). */
const SKIP_REDACT_KEYS = new Set([
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
const BASH_CONTEXT_KEYS = new Set([
    "opencode.args",
    "opencode.input",
    "opencode.output",
    "opencode.tool_input",
]);
const ATTR_POLICY = {
    skipRedactKeys: SKIP_REDACT_KEYS,
    bashContextKeys: BASH_CONTEXT_KEYS,
};
/** Bronze flattening: every field becomes an `opencode.<key>` attribute, losslessly. */
function flattenFields(fields) {
    // Discriminator first so aware-backend's detectIngestType hits it cheaply.
    const out = [{ key: "ingest.type", value: { stringValue: "opencode" } }];
    out.push(...attrsFromRecord(fields, "opencode", ATTR_POLICY));
    return out;
}
function resourceAttrs(serviceVersion) {
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
export function buildOtlpPayload(args) {
    return buildPayload({
        traceId: args.traceId,
        spanName: args.name,
        attributes: flattenFields(args.fields),
        resource: resourceAttrs(args.serviceVersion),
        scope: { name: "pinta-opencode", version: SDK_VERSION },
        now: args.now,
        guard: args.guard,
    });
}
//# sourceMappingURL=otlp.js.map