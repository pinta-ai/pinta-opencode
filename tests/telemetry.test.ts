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
    expect(a["opencode.kind"]).toBe("event");
    expect(a["opencode.event_type"]).toBe("session.idle");
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
    expect(a["opencode.tool"]).toBe("bash");
    expect(a["pinta.guard.decision"]).toBe("deny");
  });

  it("toolAfter records exit code", async () => {
    const t = fakeTransport();
    const tel = new Telemetry(t as any, new TraceManager(), cfg);
    await tel.toolAfter({ tool: "bash", sessionID: "s", callID: "c" }, { title: "t", output: "ok", metadata: { exit: 0, truncated: false } });
    const a = spanAttrs(t.send.mock.calls[0][0]);
    expect(a["opencode.exit"]).toBe(0);
    expect(a["opencode.kind"]).toBe("tool.after");
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
