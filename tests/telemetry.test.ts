import { describe, it, expect, vi } from "vitest";
import { Telemetry } from "../src/telemetry.js";
import { TraceManager } from "../src/core/trace.js";
import type { ResolvedConfig } from "../src/config.js";

const cfg: ResolvedConfig = {
  endpoint: "http://x",
  headers: {},
  guardTimeoutMs: 50,
  guardDisabled: false,
  serviceVersion: "1.15.3",
};

function fakeTransport() {
  return { send: vi.fn().mockResolvedValue(undefined), flush: vi.fn().mockResolvedValue(undefined) };
}

function spanAttrs(payload: any): Record<string, unknown> {
  const map: Record<string, unknown> = {};
  for (const a of payload.resourceSpans[0].scopeSpans[0].spans[0].attributes) map[a.key] = Object.values(a.value)[0];
  return map;
}

describe("Telemetry", () => {
  it("lifecycle emits a span keyed to the session and flushes on session.idle", async () => {
    const t = fakeTransport();
    const tel = new Telemetry(t as any, new TraceManager(), cfg);
    await tel.lifecycle({ type: "session.idle", properties: { sessionID: "ses_1" } });
    expect(t.send).toHaveBeenCalledTimes(1);
    expect(t.flush).toHaveBeenCalledTimes(1);
    const a = spanAttrs(t.send.mock.calls[0][0]);
    expect(a["opencode.hook"]).toBe("event");
    expect(a["opencode.event_type"]).toBe("session.idle");
    expect(a["opencode.cwd"]).toBe(process.cwd());
    expect(a["ingest.type"]).toBe("opencode");
  });

  it("does not flush on a non-idle event", async () => {
    const t = fakeTransport();
    const tel = new Telemetry(t as any, new TraceManager(), cfg);
    await tel.lifecycle({ type: "message.updated", properties: { sessionID: "ses_1" } });
    expect(t.flush).not.toHaveBeenCalled();
  });

  it("toolBefore carries the guard decision", async () => {
    const t = fakeTransport();
    const tel = new Telemetry(t as any, new TraceManager(), cfg);
    await tel.toolBefore({ tool: "bash", sessionID: "s", callID: "c" }, { command: "ls" }, {
      decision: "DENY", reason: "rule", userMessage: null, durationMs: 1,
    });
    const a = spanAttrs(t.send.mock.calls[0][0]);
    expect(a["opencode.tool_name"]).toBe("bash");
    expect(a["opencode.tool_use_id"]).toBe("c");
    expect(a["opencode.tool_input"]).toBe('{"command":"ls"}');
    expect(a["pinta.guard.decision"]).toBe("deny");
  });

  // The guard leg (plugin.ts) and this leg describe the same invocation. Before
  // PTA-246 they named it differently — `method: "tool.execute.before"` there,
  // `kind: "tool.before"` here — and the ingest side could not line them up.
  it("names the hook exactly as the guard leg's method, and reports the same cwd", async () => {
    const t = fakeTransport();
    const tel = new Telemetry(t as any, new TraceManager(), cfg);
    await tel.toolBefore({ tool: "bash", sessionID: "s", callID: "c" }, { command: "ls" }, null);
    await tel.toolAfter({ tool: "bash", sessionID: "s", callID: "c" }, { title: "t", output: "ok" });
    const before = spanAttrs(t.send.mock.calls[0][0]);
    const after = spanAttrs(t.send.mock.calls[1][0]);
    expect(before["opencode.hook"]).toBe("tool.execute.before");
    expect(after["opencode.hook"]).toBe("tool.execute.after");
    for (const a of [before, after]) expect(a["opencode.cwd"]).toBe(process.cwd());
  });

  // A field carried under two names is a field whose two copies can disagree.
  it("sends each field under one name only", async () => {
    const t = fakeTransport();
    const tel = new Telemetry(t as any, new TraceManager(), cfg);
    await tel.toolBefore({ tool: "bash", sessionID: "s", callID: "c" }, { command: "ls" }, null);
    const a = spanAttrs(t.send.mock.calls[0][0]);
    for (const dropped of ["opencode.kind", "opencode.tool", "opencode.call_id", "opencode.args"]) {
      expect(a[dropped]).toBeUndefined();
    }
  });

  // M4 gate: BASH_CONTEXT_KEYS in core/otlp.ts has to track the field names
  // this file emits. Dropping a key there fails nothing on its own — the value
  // keeps flowing, unmasked — so assert the masking through the real pipeline.
  it("masks shell secrets in the tool payload", async () => {
    const t = fakeTransport();
    const tel = new Telemetry(t as any, new TraceManager(), cfg);
    await tel.toolBefore({ tool: "bash", sessionID: "s", callID: "c" },
      { command: "mysql -psecretpw" }, null);
    await tel.toolAfter({ tool: "bash", sessionID: "s", callID: "c" },
      { title: "t", output: "mysql -psecretpw" } as any);
    const input = spanAttrs(t.send.mock.calls[0][0])["opencode.tool_input"] as string;
    const response = spanAttrs(t.send.mock.calls[1][0])["opencode.tool_response"] as string;
    for (const text of [input, response]) {
      expect(text).toContain("[REDACTED:cli_password_short]");
      expect(text).not.toContain("secretpw");
    }
  });

  it("toolAfter records exit code", async () => {
    const t = fakeTransport();
    const tel = new Telemetry(t as any, new TraceManager(), cfg);
    await tel.toolAfter({ tool: "bash", sessionID: "s", callID: "c" }, { title: "t", output: "ok", metadata: { exit: 0, truncated: false } });
    const a = spanAttrs(t.send.mock.calls[0][0]);
    expect(a["opencode.exit"]).toBe(0);
    expect(a["opencode.hook"]).toBe("tool.execute.after");
    expect(a["opencode.tool_response"]).toBe("ok");
  });

  it("reuses the same trace across hooks of one session", async () => {
    const t = fakeTransport();
    const trace = new TraceManager();
    const tel = new Telemetry(t as any, trace, cfg);
    await tel.lifecycle({ type: "message.updated", properties: { sessionID: "ses_1" } });
    await tel.toolBefore({ tool: "bash", sessionID: "ses_1", callID: "c" }, {}, null);
    const t1 = t.send.mock.calls[0][0].resourceSpans[0].scopeSpans[0].spans[0].traceId;
    const t2 = t.send.mock.calls[1][0].resourceSpans[0].scopeSpans[0].spans[0].traceId;
    expect(t1).toBe(t2);
  });
});
