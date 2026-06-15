import { describe, it, expect } from "vitest";
import { buildOtlpPayload, ulidToTraceId } from "../src/core/otlp.js";

const ULID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

function attrs(p: ReturnType<typeof buildOtlpPayload>) {
  const map: Record<string, unknown> = {};
  for (const a of p.resourceSpans[0].scopeSpans[0].spans[0].attributes) {
    map[a.key] = Object.values(a.value)[0];
  }
  return map;
}

describe("otlp", () => {
  it("converts a ULID to a 32-hex traceId", () => {
    expect(ulidToTraceId(ULID)).toMatch(/^[0-9a-f]{32}$/);
  });

  it("flattens fields under opencode.* with ingest.type discriminator", () => {
    const p = buildOtlpPayload({
      name: "opencode.tool.before",
      traceId: ULID,
      fields: { kind: "tool.before", tool: "bash", session_id: "ses_1" },
      serviceVersion: "1.15.3",
    });
    const a = attrs(p);
    expect(a["ingest.type"]).toBe("opencode");
    expect(a["opencode.kind"]).toBe("tool.before");
    expect(a["opencode.tool"]).toBe("bash");
    expect(p.resourceSpans[0].resource.attributes.find((x) => x.key === "service.name")?.value).toEqual({ stringValue: "opencode" });
  });

  it("attaches guard attributes", () => {
    const p = buildOtlpPayload({
      name: "opencode.tool.before",
      traceId: ULID,
      fields: { kind: "tool.before" },
      serviceVersion: "x",
      guard: { decision: "DENY", reason: "rule_x", userMessage: null, durationMs: 3 },
    });
    const a = attrs(p);
    expect(a["pinta.guard.decision"]).toBe("deny");
    expect(a["pinta.guard.matched_rule"]).toBe("rule_x");
    expect(a["pinta.guard.duration_ms"]).toBe(3);
  });

  it("redacts secrets in bash-context fields", () => {
    const p = buildOtlpPayload({
      name: "opencode.tool.before",
      traceId: ULID,
      fields: { args: { command: "deploy --password=hunter2value" } },
      serviceVersion: "x",
    });
    const a = attrs(p) as Record<string, string>;
    expect(a["opencode.args"]).toContain("[REDACTED:cli_password_flag]");
    expect(a["opencode.args"]).not.toContain("hunter2value");
  });
});
